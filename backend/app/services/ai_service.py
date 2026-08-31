import json
from datetime import date, timedelta

import httpx

from app.config import settings

EXERCISE_SCHEMA = '{"name": "name", "sets": 3, "reps": 10, "reps_max": 12, "weight": null, "rir_target": 2, "duration_seconds": null, "notes": null}'

GOAL_SCHEMA = """{
    "title": "short descriptive title",
    "description": "detailed goal description",
    "metric_name": "metric being tracked or null",
    "current_value": number or null,
    "target_value": number or null,
    "unit": "unit or null",
    "start_date": "today ISO date",
    "target_date": "ISO date or null"
  }"""

PLAN_SCHEMA = f"""{{
  "goal": {GOAL_SCHEMA},
  "plan": [
    {{
      "week_number": 1,
      "day_of_week": 0,
      "activity": "activity name",
      "duration_minutes": 30,
      "notes": "details or null",
      "frequency_hint": null,
      "exercises": [ {EXERCISE_SCHEMA} ]
    }}
  ]
}}"""

QUESTIONS_PROMPT = """You are an AI fitness coach. Given a user's goal, generate up to 8 short clarifying questions to build a complete coaching profile.

Return ONLY valid JSON — no markdown, no code fences, no extra text.

{"questions": ["q1", "q2", ...]}

Cover the most important of: primary goal specifics, current weight, height, body-fat %, muscle mass, training experience, sessions per week, available days, available equipment, preferred session duration, exercise preferences, exercises they dislike or cannot do, cardio preferences, lifestyle/activity level, injuries/limitations."""

PLAN_PROMPT = f"""You are an AI fitness coach. Given a user's goal and their answers, create a structured multi-week plan.

Return ONLY valid JSON — no markdown, no code fences, no extra text.

Schema:
{PLAN_SCHEMA}

Rules:
- day_of_week: 0=Mon..6=Sun. Use null + frequency_hint for flexible ("3x/week").
- CRITICAL: A day CAN and SHOULD have multiple plan entries if multiple activities happen on that day.
  For example, if the user does lifting and a 60-min walk on Monday, output TWO separate objects in the 'plan' array:
  1) {{"week_number": 1, "day_of_week": 0, "activity": "Push & Abs", "duration_minutes": 60, "exercises": [...]}}
  2) {{"week_number": 1, "day_of_week": 0, "activity": "Daily Walk", "duration_minutes": 60, "notes": "60 min brisk walk", "exercises": []}}
  Never combine multiple activities into a single entry title or hide an activity in the notes.
- The plan MUST span at least 12 weeks (or the user's stated duration). For EACH week, list ALL of its daily activities.
- For every STRENGTH workout you MUST include "exercises": at least 4-6 specific exercises with sets, rep range (reps..reps_max), weight (when known), rir_target.
- For cardio-like items (walk/HIIT/etc.) put targets in notes (e.g. "8,000 steps") and skip exercises (exercises: []).
- Progress the plan week-by-week (load increases, rep increases, etc.).
- today is {date.today().isoformat()}"""

REFINE_PROMPT = f"""You are an AI fitness coach refining an existing plan. The current plan JSON is provided as context.

If NOT finalizing: respond conversationally — answer questions, suggest tweaks, ask clarifying questions.

If finalizing: return ONLY valid JSON with the FULL updated plan using this schema:
{PLAN_SCHEMA}

Rules:
- day_of_week: 0=Mon..6=Sun. Null + frequency_hint for flexible days.
- CRITICAL: If a day has multiple activities (e.g. lifting AND daily walking, or HIIT AND walking), emit EACH activity as its own separate entry in the 'plan' array with the same week_number and day_of_week.
- Every STRENGTH workout MUST include the "exercises" array (name, sets, reps..reps_max, weight, rir_target).
- For walking, cardio, or recovery: emit separate entries with duration_minutes and exercises: [].
- Include ALL weeks of the plan (weeks 1..12) and ALL activities, modified based on the conversation.
"""

COACH_PROMPT = """You are the user's personal AI fitness coach, deeply connected to their data.

You receive:
1. Their goal and profile.
2. The current plan (calendar entries + exercises with set/rep/RIR targets).
3. Recent workout session logs (weights, reps, RIR).
4. Body measurements (weight, fat, muscle).

Talk like a coach: concise, data-grounded, concrete. Reference their actual numbers when relevant.

When the user asks for a program change (swap an exercise, train fewer/more days, shorter sessions,
add cardio, equipment changes, etc.): confirm what you'll change in plain language and tell them to
press "Finalize plan" to apply it to their calendar. Do NOT output JSON in this conversation."""

INSIGHTS_PROMPT = """You are an AI fitness coach analysing a user's actual training and body data.

You receive JSON containing:
- goal (target metric, current value, week number)
- body_latest and weight_history (weight, fat %, muscle %)
- windows.last_7_days and windows.last_14_days: workouts logged, sets, total volume (kg),
  failure sets (RIR 0), average RIR, schedule adherence, body composition change
- exercise_history: recent sessions per exercise (top weight, reps, volume, best RIR)

Cross-reference the windows. Judge, for example: is progress fast enough for the goal? is the user
under-recovered or over-reaching (many failure sets, falling volume/performance)? is an exercise
plateaued and worth swapping or progressing? is adherence realistic? is muscle being kept while fat drops?

Return ONLY valid JSON — no markdown, no code fences:
{
  "severity": "good" | "watch" | "warning",
  "headline": "short verdict (max 60 chars)",
  "assessment": "2-4 sentences citing real numbers from the data",
  "observations": ["specific data-backed observation", "..."],
  "recommendations": ["concrete next action", "..."],
  "exercise_notes": [
    {
      "exercise": "Bench Press",
      "note": "why",
      "action": "keep" | "increase_load" | "increase_reps" | "swap" | "deload",
      "suggested_weight_kg": 82.5 or null,
      "suggested_reps_min": 8 or null,
      "suggested_reps_max": 10 or null,
      "suggested_rir": 2 or null
    }
  ]
}

Rules:
- Only state what the data supports; if something has no data, say it's missing instead of inventing it.
- For every exercise with logged weight, include an exercise_note and suggested_weight_kg for next week.
- Be balanced: a clearly under-loaded session can justify progression, but consider repeated trends when available.
- Do not increase through frequent RIR 0, missed sessions, declining performance, or recovery warnings.
- Increase only after repeated successful sessions at the top of the rep range with the prescribed RIR.
- Normal increases are 1-2.5 kg for upper-body lifts and 2.5-5 kg for lower-body compounds.
- Use action "keep" and the current working weight when evidence is insufficient.
- Suggested reps and RIR should describe next week's working target, not the completed session.
- 2-5 observations and 1-4 recommendations."""


async def _call_ai(messages: list[dict]) -> str:
    key = settings.ai_api_key
    if not key:
        raise ValueError("AI_API_KEY is not set. Set it to your API key.")
    async with httpx.AsyncClient(timeout=600) as client:
        try:
            resp = await client.post(
                f"{settings.ai_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.ai_model,
                    "messages": messages,
                    "temperature": 0.7,
                },
            )
        except httpx.ReadTimeout:
            raise RuntimeError(
                f"AI API did not respond within 600s (model: {settings.ai_model}). "
                "The free model may be overloaded. Try again later or switch to a different model."
            )
        if not resp.is_success:
            body = resp.text[:500]
            raise RuntimeError(f"AI API returned {resp.status_code}: {body}")
        try:
            data = resp.json()
            return data["choices"][0]["message"]["content"]
        except (KeyError, json.JSONDecodeError) as e:
            body = resp.text[:500]
            raise RuntimeError(f"Failed to parse AI response (status {resp.status_code}): {e} | body: {body}")


def _parse(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        raw = raw.rsplit("```", 1)[0]
        raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        import re
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            candidate = match.group(0)
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                candidate = re.sub(r",(\s*[}\]])", r"\1", candidate)
                return json.loads(candidate)
        raise


def _optional_number(value, cast):
    if value is None:
        return None
    try:
        return cast(value)
    except (TypeError, ValueError):
        return None


async def generate_questions(user_input: str) -> list[str]:
    content = await _call_ai([
        {"role": "system", "content": QUESTIONS_PROMPT},
        {"role": "user", "content": user_input},
    ])
    data = _parse(content)
    return data["questions"][:8]


async def generate_plan(user_input: str, qa: list[dict] | None = None) -> dict:
    context = f"Goal: {user_input}\n"
    if qa:
        context += "\nAnswers:\n"
        for item in qa:
            context += f"Q: {item['question']}\nA: {item['answer']}\n"
    content = await _call_ai([
        {"role": "system", "content": PLAN_PROMPT},
        {"role": "user", "content": context},
    ])
    return _parse(content)


def to_date(val: str | None) -> date | None:
    if val:
        try:
            return date.fromisoformat(val)
        except (ValueError, TypeError):
            return None
    return None


def normalize_start_date(value: date | None) -> date:
    """Plans always start on a Monday, and never in the past (calendar weeks must line up)."""
    today = date.today()
    monday_this_week = today - timedelta(days=today.weekday())
    if value is None or value < monday_this_week:
        return monday_this_week
    return value - timedelta(days=value.weekday())


def _exercise_payload(ed: dict) -> dict:
    return {
        "name": ed.get("name") or "Exercise",
        "sets": ed.get("sets"),
        "reps": ed.get("reps"),
        "reps_max": ed.get("reps_max"),
        "weight": ed.get("weight"),
        "rir_target": ed.get("rir_target"),
        "duration_seconds": ed.get("duration_seconds"),
        "notes": ed.get("notes"),
    }


def _split_compound_activity(activity: str) -> list[str]:
    import re
    # Split on '+' always (e.g. 'Push + Walking')
    if "+" in activity:
        parts = [p.strip() for p in activity.split("+") if p.strip()]
        if len(parts) > 1:
            return parts

    # Split on '&' or ' and ' ONLY when one side is cardio/walking/recovery and not just a muscle group like 'Push & Abs'
    cardio_kw = r"\b(walk|walking|cardio|steps|recovery\s*walk|hiit|running|jogging)\b"
    muscle_kw = r"\b(abs|core|triceps|biceps|shoulders|delts|calves|glutes)\b"

    for sep in [" & ", " and "]:
        if sep in activity:
            parts = [p.strip() for p in activity.split(sep) if p.strip()]
            if len(parts) == 2:
                # If one side is cardio/walk/hiit and the other is NOT just a sub-muscle group:
                has_cardio = bool(re.search(cardio_kw, parts[0], re.I) or re.search(cardio_kw, parts[1], re.I))
                is_sub_muscle = bool(re.fullmatch(muscle_kw, parts[1], re.I))
                if has_cardio and not is_sub_muscle:
                    return parts

    return [activity]


def _parse_plan_items(items: list) -> list:
    """Normalize AI plan items:
    1. Split compound activities ('Push + Walking', 'HIIT 1 & Recovery Walk') into separate entries.
    2. Extract hidden daily walking mentioned in notes into its own separate plan entry for that day.
    3. Ensure exercises are attached only to strength workouts.
    """
    import re

    normalized: list[dict] = []
    seen_walk_days: set[tuple[int, int | None]] = set()

    for item in items or []:
        if not isinstance(item, dict):
            continue

        raw_activity = str(item.get("activity") or "").strip()
        week_num = int(item.get("week_number") or 1)
        dow = item.get("day_of_week")
        notes = str(item.get("notes") or "").strip()

        sub_activities = _split_compound_activity(raw_activity)

        for idx, act in enumerate(sub_activities):
            elem = dict(item)
            elem["activity"] = act
            is_str = _looks_strength(act)
            elem["exercises"] = item.get("exercises") if (is_str or (not is_str and not _looks_pure_cardio(act) and idx == 0)) else []
            if _looks_pure_cardio(act) and not is_str:
                elem["exercises"] = []
                if "walk" in act.lower() and not elem.get("duration_minutes"):
                    elem["duration_minutes"] = 60
            normalized.append(elem)

            if "walk" in act.lower():
                seen_walk_days.add((week_num, dow))

        # Check if the notes mention a separate daily/recovery walk that wasn't given its own item
        walk_in_notes_match = re.search(
            r"(?:complete\s+)?(?:daily\s+)?(?:(\d+)[\s-]*min(?:ute)?\s+)?(?:brisk\s+|recovery\s+)?walk(?:ing)?(?:\s+separately)?",
            notes,
            re.IGNORECASE,
        )
        if walk_in_notes_match and (week_num, dow) not in seen_walk_days:
            # Only if the current activity is not already a walk
            if not any("walk" in a.lower() for a in sub_activities):
                mins = int(walk_in_notes_match.group(1)) if walk_in_notes_match.group(1) else 60
                walk_entry = {
                    "week_number": week_num,
                    "day_of_week": dow,
                    "activity": f"Walk — {mins} min",
                    "duration_minutes": mins,
                    "notes": "Daily brisk walk",
                    "frequency_hint": None,
                    "exercises": [],
                }
                normalized.append(walk_entry)
                seen_walk_days.add((week_num, dow))

    return normalized


def _looks_pure_cardio(activity: str) -> bool:
    import re
    return bool(re.search(r"^\s*(?:daily\s+|recovery\s+|brisk\s+)?(?:walk|walking|hiit|cardio|jogging|running)\b", activity, re.IGNORECASE)) and not _looks_strength(activity)


def _looks_strength(activity: str) -> bool:
    import re
    return bool(re.search(r"push|pull|leg|upper|lower|strength|workout|gym|chest|back|arms|core|shoulder|biceps|triceps|full.?body", activity, re.IGNORECASE))


async def create_goal_with_plan(ai_output: dict, session, raw_json: dict | None = None) -> dict:
    from app.models.goal import Goal
    from app.models.plan import PlanEntry
    from app.models.exercise import Exercise

    goal_data = ai_output["goal"]
    plan_entries = _parse_plan_items(ai_output.get("plan", []))

    start = normalize_start_date(to_date(goal_data.get("start_date")))

    goal = Goal(
        title=goal_data.get("title", "Fitness Goal"),
        description=goal_data.get("description"),
        metric_name=goal_data.get("metric_name"),
        current_value=goal_data.get("current_value"),
        target_value=goal_data.get("target_value"),
        unit=goal_data.get("unit"),
        start_date=start,
        target_date=to_date(goal_data.get("target_date")),
        ai_response=raw_json,
    )
    session.add(goal)
    await session.flush()

    entries = []
    for pe in plan_entries:
        exercises_data = pe.get("exercises", []) or []
        entry = PlanEntry(
            goal_id=goal.id,
            week_number=pe.get("week_number", 1),
            day_of_week=pe.get("day_of_week"),
            activity=pe.get("activity", "Activity"),
            duration_minutes=pe.get("duration_minutes"),
            notes=pe.get("notes"),
            frequency_hint=pe.get("frequency_hint"),
        )
        session.add(entry)
        await session.flush()

        exercises = []
        for i, ed in enumerate(exercises_data):
            payload = _exercise_payload(ed)
            ex = Exercise(plan_entry_id=entry.id, order_index=i, **payload)
            session.add(ex)
            exercises.append(ex)
        await session.flush()

        entries.append({
            "id": str(entry.id),
            "week_number": entry.week_number,
            "day_of_week": entry.day_of_week,
            "activity": entry.activity,
            "duration_minutes": entry.duration_minutes,
            "notes": entry.notes,
            "frequency_hint": entry.frequency_hint,
            "completed": entry.completed,
            "exercises": [
                {
                    "id": str(ex.id), "name": ex.name, "sets": ex.sets, "reps": ex.reps,
                    "reps_max": ex.reps_max, "weight": ex.weight, "rir_target": ex.rir_target,
                    "duration_seconds": ex.duration_seconds, "order_index": ex.order_index,
                    "completed": ex.completed, "notes": ex.notes,
                }
                for ex in exercises
            ],
        })

    await session.commit()
    await session.refresh(goal)

    return {
        "goal": {
            "id": str(goal.id),
            "title": goal.title,
            "description": goal.description,
            "metric_name": goal.metric_name,
            "current_value": goal.current_value,
            "target_value": goal.target_value,
            "unit": goal.unit,
            "start_date": str(goal.start_date) if goal.start_date else None,
            "target_date": str(goal.target_date) if goal.target_date else None,
        },
        "entries": entries,
    }


async def continue_plan(user_message: str, current_plan: dict, history: list | None = None, finalize: bool = False) -> str | dict:
    plan_json = json.dumps(current_plan, indent=2)
    history = history or []
    messages = [{"role": "system", "content": REFINE_PROMPT}]
    messages.append({"role": "user", "content": f"Current plan:\n{plan_json}"})
    for h in history:
        messages.append({"role": h["role"], "content": h["text"]})
    if finalize:
        messages.append({"role": "user", "content": f"{user_message}\n\nFinalize: return the COMPLETE updated plan JSON only."})
    else:
        messages.append({"role": "user", "content": user_message})

    content = await _call_ai(messages)
    if finalize:
        return _parse(content)
    return content


async def coach_reply(user_message: str, context: dict, history: list[dict]) -> dict:
    messages = [{"role": "system", "content": COACH_PROMPT}]
    messages.append({"role": "user", "content": f"Coach context:\n{json.dumps(context, indent=2)}"})
    for h in history:
        messages.append({"role": h["role"], "content": h["text"]})
    messages.append({"role": "user", "content": user_message})
    content = (await _call_ai(messages)).strip()
    # Some models still answer with {"type": "message", "message": ...}; unwrap it.
    if content.startswith("{"):
        try:
            parsed = _parse(content)
            if isinstance(parsed, dict) and parsed.get("message"):
                content = str(parsed["message"])
        except Exception:
            pass
    return {"type": "message", "message": content}


MIN_PLAN_WEEKS = 4


async def analyze_training(data: dict) -> dict:
    """Ask the AI to interpret the 7/14-day training + body data package."""
    content = await _call_ai([
        {"role": "system", "content": INSIGHTS_PROMPT},
        {"role": "user", "content": json.dumps(data, indent=2, default=str)},
    ])
    parsed = _parse(content)
    if not isinstance(parsed, dict) or not parsed.get("assessment"):
        raise ValueError("AI returned an unusable analysis")
    parsed.setdefault("severity", "good")
    parsed.setdefault("headline", "Training insight")
    parsed.setdefault("observations", [])
    parsed.setdefault("recommendations", [])
    parsed.setdefault("exercise_notes", [])
    # keep the response tidy for the UI
    parsed["observations"] = [str(o) for o in parsed["observations"]][:6]
    parsed["recommendations"] = [str(r) for r in parsed["recommendations"]][:5]
    notes = []
    for n in parsed["exercise_notes"][:6]:
        if isinstance(n, dict) and n.get("exercise"):
            notes.append({
                "exercise": str(n["exercise"]),
                "note": str(n.get("note") or ""),
                "action": str(n.get("action") or "keep"),
                "suggested_weight_kg": _optional_number(n.get("suggested_weight_kg"), float),
                "suggested_reps_min": _optional_number(n.get("suggested_reps_min"), int),
                "suggested_reps_max": _optional_number(n.get("suggested_reps_max"), int),
                "suggested_rir": _optional_number(n.get("suggested_rir"), int),
            })
    parsed["exercise_notes"] = notes
    return parsed


def max_week(plan_items: list) -> int:
    return max((int(i.get("week_number") or 1) for i in plan_items if isinstance(i, dict)), default=0)


def plan_summary(plan_items: list) -> dict:
    weeks = {int(i.get("week_number") or 1) for i in plan_items if isinstance(i, dict)}
    exercises = sum(len(i.get("exercises") or []) for i in plan_items if isinstance(i, dict))
    return {"weeks": len(weeks), "activities": len(plan_items), "exercises": exercises}


async def coach_finalize(user_message: str, context: dict, history: list[dict]) -> dict:
    plan_json = json.dumps({"goal": context.get("goal", {}), "plan": context.get("plan", [])}, indent=2)

    def build(extra: str | None = None) -> list[dict]:
        messages = [{"role": "system", "content": REFINE_PROMPT}]
        messages.append({"role": "user", "content": f"Current plan:\n{plan_json}"})
        for h in history:
            messages.append({"role": h["role"], "content": h["text"]})
        instructions = (
            f"{user_message}\n\n"
            "FINALIZE NOW. Return ONLY the JSON object described in the schema — no prose, no code fences.\n"
            f"It MUST contain at least {MIN_PLAN_WEEKS} distinct week_number values (target 12 weeks).\n"
            "If a day contains multiple activities (e.g. lifting workout AND daily walking, or HIIT AND walking), "
            "emit EACH activity as its own separate object in the 'plan' array with the corresponding week_number and day_of_week.\n"
            "Never hide activities in notes or combine them into a single string.\n"
            "Every strength workout MUST include an 'exercises' array with sets, reps, rir_target."
        )
        if extra:
            instructions += f"\n\n{extra}"
        messages.append({"role": "user", "content": instructions})
        return messages

    ai_output = _parse(await _call_ai(build()))
    plan_items = ai_output.get("plan") or []

    # One retry when the model returned a single-week (or empty) plan.
    if max_week(plan_items) < MIN_PLAN_WEEKS:
        retry_note = (
            f"Your previous answer only covered {max_week(plan_items)} week(s). "
            "Return the FULL program again, repeating each week explicitly with its own week_number "
            "(1..12) and all activities. Do not summarize or say 'repeat week 1'."
        )
        try:
            retried = _parse(await _call_ai(build(retry_note)))
            if max_week(retried.get("plan") or []) > max_week(plan_items):
                ai_output = retried
        except Exception:
            pass
    return ai_output


async def update_goal_with_plan(ai_output: dict, session, goal_id, raw_json: dict | None = None) -> dict:
    from app.models.goal import Goal
    from app.models.plan import PlanEntry
    from app.models.exercise import Exercise
    from sqlalchemy import delete

    goal = await session.get(Goal, goal_id)
    if not goal:
        raise ValueError("Goal not found")

    goal_data = ai_output["goal"]
    plan_entries = _parse_plan_items(ai_output.get("plan", []))

    if goal_data.get("title"):
        goal.title = goal_data["title"]
    if goal_data.get("description"):
        goal.description = goal_data["description"]
    if goal_data.get("metric_name") is not None:
        goal.metric_name = goal_data["metric_name"]
    if goal_data.get("current_value") is not None:
        goal.current_value = goal_data["current_value"]
    if goal_data.get("target_value") is not None:
        goal.target_value = goal_data["target_value"]
    if goal_data.get("unit") is not None:
        goal.unit = goal_data["unit"]
    goal.start_date = normalize_start_date(to_date(goal_data.get("start_date")) or goal.start_date)
    if goal_data.get("target_date"):
        goal.target_date = to_date(goal_data["target_date"])
    goal.ai_response = raw_json

    await session.execute(
        delete(PlanEntry).where(PlanEntry.goal_id == goal_id)
    )
    await session.flush()

    entries = []
    for pe in plan_entries:
        exercises_data = pe.get("exercises", []) or []
        entry = PlanEntry(
            goal_id=goal.id,
            week_number=pe.get("week_number", 1),
            day_of_week=pe.get("day_of_week"),
            activity=pe.get("activity", "Activity"),
            duration_minutes=pe.get("duration_minutes"),
            notes=pe.get("notes"),
            frequency_hint=pe.get("frequency_hint"),
        )
        session.add(entry)
        await session.flush()

        exercises = []
        for i, ed in enumerate(exercises_data):
            payload = _exercise_payload(ed)
            ex = Exercise(plan_entry_id=entry.id, order_index=i, **payload)
            session.add(ex)
            exercises.append(ex)
        await session.flush()

        entries.append({
            "id": str(entry.id),
            "week_number": entry.week_number,
            "day_of_week": entry.day_of_week,
            "activity": entry.activity,
            "duration_minutes": entry.duration_minutes,
            "notes": entry.notes,
            "frequency_hint": entry.frequency_hint,
            "completed": entry.completed,
            "exercises": [
                {"id": str(ex.id), "name": ex.name, "sets": ex.sets, "reps": ex.reps,
                 "reps_max": ex.reps_max, "weight": ex.weight, "rir_target": ex.rir_target,
                 "duration_seconds": ex.duration_seconds, "order_index": ex.order_index,
                 "completed": ex.completed, "notes": ex.notes}
                for ex in exercises
            ],
        })

    await session.commit()
    await session.refresh(goal)

    return {
        "goal": {
            "id": str(goal.id),
            "title": goal.title,
            "description": goal.description,
            "metric_name": goal.metric_name,
            "current_value": goal.current_value,
            "target_value": goal.target_value,
            "unit": goal.unit,
            "start_date": str(goal.start_date) if goal.start_date else None,
            "target_date": str(goal.target_date) if goal.target_date else None,
        },
        "entries": entries,
    }

