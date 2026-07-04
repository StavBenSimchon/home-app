import json
from datetime import date

import httpx

from app.config import settings

QUESTIONS_PROMPT = """You are a fitness planner AI. Given a user's goal, generate 5 clarifying questions to create a better plan.

Return ONLY valid JSON — no markdown, no code fences, no extra text.

{"questions": ["q1", "q2", "q3", "q4", "q5"]}

Cover: workout location, available equipment, days per week, time per session, injuries/limitations, fitness level."""

PLAN_PROMPT = """You are a fitness planner AI. Given a user's goal and their answers to clarifying questions, create a structured weekly plan.

Return ONLY valid JSON — no markdown, no code fences, no extra text.

Schema:
{
  "goal": {
    "title": "short descriptive title",
    "description": "detailed goal description",
    "metric_name": "metric being tracked or null",
    "current_value": number or null,
    "target_value": number or null,
    "unit": "unit or null",
    "start_date": "today ISO date",
    "target_date": "ISO date or null"
  },
  "plan": [
    {
      "week_number": 1,
      "day_of_week": 0,
      "activity": "activity name",
      "duration_minutes": 30,
      "notes": "details or null",
      "frequency_hint": null,
      "exercises": [
        {"name": "exercise name", "sets": 3, "reps": 12, "weight": null, "duration_seconds": null}
      ]
    }
  ]
}

Rules:
- day_of_week: 0=Mon..6=Sun. Use null + frequency_hint for flexible ("3x/week").
- For daily activities, create 7 entries.
- Make the plan progressive.
- Include exercises array for workout activities with sets/reps.
- today is 2026-07-04
"""


async def _call_ai(messages: list[dict]) -> str:
    key = settings.ai_api_key
    if not key:
        raise ValueError("AI_API_KEY is not set. Set it to your Zen API key from https://opencode.ai/auth")
    async with httpx.AsyncClient(timeout=300) as client:
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
                f"AI API did not respond within 300s (model: {settings.ai_model}). "
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


async def generate_questions(user_input: str) -> list[str]:
    content = await _call_ai([
        {"role": "system", "content": QUESTIONS_PROMPT},
        {"role": "user", "content": user_input},
    ])
    data = _parse(content)
    return data["questions"][:5]


async def generate_plan(user_input: str, qa: list[dict] | None = None) -> dict:
    context = f"Goal: {user_input}\n"
    if qa:
        context += "\nClarifying answers:\n"
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


async def create_goal_with_plan(ai_output: dict, session, raw_json: dict | None = None) -> dict:
    from app.models.goal import Goal
    from app.models.plan import PlanEntry
    from app.models.exercise import Exercise

    goal_data = ai_output["goal"]
    plan_entries = ai_output.get("plan", [])

    start = to_date(goal_data.get("start_date"))
    if not start and plan_entries:
        start = date.today()

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
        exercises_data = pe.pop("exercises", []) or []
        entry = PlanEntry(
            goal_id=goal.id,
            week_number=pe["week_number"],
            day_of_week=pe.get("day_of_week"),
            activity=pe["activity"],
            duration_minutes=pe.get("duration_minutes"),
            notes=pe.get("notes"),
            frequency_hint=pe.get("frequency_hint"),
        )
        session.add(entry)
        await session.flush()

        exercises = []
        for i, ed in enumerate(exercises_data):
            ex = Exercise(
                plan_entry_id=entry.id,
                name=ed["name"],
                sets=ed.get("sets"),
                reps=ed.get("reps"),
                weight=ed.get("weight"),
                duration_seconds=ed.get("duration_seconds"),
                order_index=i,
                notes=ed.get("notes"),
            )
            session.add(ex)
            exercises.append(ex)

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
                    "id": str(ex.id),
                    "name": ex.name,
                    "sets": ex.sets,
                    "reps": ex.reps,
                    "weight": ex.weight,
                    "duration_seconds": ex.duration_seconds,
                    "order_index": ex.order_index,
                    "completed": ex.completed,
                    "notes": ex.notes,
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


CONTINUE_PROMPT = """You are a fitness planner AI helping refine an existing plan.

You have the current plan JSON as context. The user wants to discuss changes.

If NOT finalizing: respond conversationally — answer questions, suggest tweaks, ask clarifying questions.

If finalizing: Return ONLY valid JSON with the UPDATED full plan using EXACTLY this schema:
{
  "goal": {
    "title": "title",
    "description": "description",
    "metric_name": "metric or null",
    "current_value": number or null,
    "target_value": number or null,
    "unit": "unit or null",
    "start_date": "ISO date",
    "target_date": "ISO date or null"
  },
  "plan": [
    {
      "week_number": 1,
      "day_of_week": 0,
      "activity": "name",
      "duration_minutes": 30,
      "notes": "details or null",
      "frequency_hint": null,
      "exercises": [
        {"name": "name", "sets": 3, "reps": 12, "weight": null, "duration_seconds": null}
      ]
    }
  ]
}

Rules:
- day_of_week: 0=Mon..6=Sun. Null + frequency_hint for flexible days.
- Include ALL activities, modified based on the conversation.
- today is 2026-07-04
"""


async def continue_plan(user_message: str, current_plan: dict, history: list | None = None, finalize: bool = False) -> str | dict:
    plan_json = json.dumps(current_plan, indent=2)
    history = history or []
    messages = [{"role": "system", "content": CONTINUE_PROMPT}]
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


async def update_goal_with_plan(ai_output: dict, session, goal_id, raw_json: dict | None = None) -> dict:
    from app.models.goal import Goal
    from app.models.plan import PlanEntry
    from app.models.exercise import Exercise
    from sqlalchemy import delete

    goal = await session.get(Goal, goal_id)
    if not goal:
        raise ValueError("Goal not found")

    goal_data = ai_output["goal"]
    plan_entries = ai_output.get("plan", [])

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
    if goal_data.get("start_date"):
        goal.start_date = to_date(goal_data["start_date"])
    if goal_data.get("target_date"):
        goal.target_date = to_date(goal_data["target_date"])
    goal.ai_response = raw_json

    await session.execute(
        delete(PlanEntry).where(PlanEntry.goal_id == goal_id)
    )
    await session.flush()

    entries = []
    for pe in plan_entries:
        exercises_data = pe.pop("exercises", []) or []
        entry = PlanEntry(
            goal_id=goal.id,
            week_number=pe["week_number"],
            day_of_week=pe.get("day_of_week"),
            activity=pe["activity"],
            duration_minutes=pe.get("duration_minutes"),
            notes=pe.get("notes"),
            frequency_hint=pe.get("frequency_hint"),
        )
        session.add(entry)
        await session.flush()

        exercises = []
        for i, ed in enumerate(exercises_data):
            ex = Exercise(
                plan_entry_id=entry.id,
                name=ed["name"],
                sets=ed.get("sets"),
                reps=ed.get("reps"),
                weight=ed.get("weight"),
                duration_seconds=ed.get("duration_seconds"),
                order_index=i,
                notes=ed.get("notes"),
            )
            session.add(ex)
            exercises.append(ex)

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
                 "weight": ex.weight, "duration_seconds": ex.duration_seconds,
                 "order_index": ex.order_index, "completed": ex.completed, "notes": ex.notes}
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
