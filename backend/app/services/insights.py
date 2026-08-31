import uuid
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.coach import AIInsight
from app.models.exercise import Exercise
from app.models.goal import Goal
from app.models.plan import PlanEntry
from app.models.session import SetLog, WorkoutSession
from app.models.weight import WeightEntry
from app.schemas.progress import (
    ConsistencyStats,
    ExercisePoint,
    ExerciseTrend,
    ProgressResponse,
)


def current_week(goal: Goal | None) -> int:
    start = goal.start_date if goal else None
    if not start:
        return 1
    diff = (date.today() - start).days
    return max(1, diff // 7 + 1)


def _entry_date(goal: Goal, entry: PlanEntry) -> date | None:
    if not goal.start_date or entry.day_of_week is None:
        return None
    return goal.start_date + timedelta(days=(entry.week_number - 1) * 7 + entry.day_of_week)


def _streak(entries: list[PlanEntry], goal: Goal | None) -> int:
    """Count consecutive past days (up to today) with all planned activities completed."""
    if not goal or not goal.start_date:
        return 0
    today = date.today()
    planned_by_date: dict[date, list[PlanEntry]] = defaultdict(list)
    for e in entries:
        d = _entry_date(goal, e)
        if d is not None and d <= today:
            planned_by_date[d].append(e)

    streak = 0
    day = today
    # don't break the streak for an incomplete today
    if day in planned_by_date and not all(e.completed for e in planned_by_date[day]):
        day -= timedelta(days=1)
    while day in planned_by_date:
        if all(e.completed for e in planned_by_date[day]):
            streak += 1
            day -= timedelta(days=1)
        else:
            break
    return streak


async def gather_progress(session: AsyncSession, goal_id: uuid.UUID) -> ProgressResponse:
    goal = await session.get(Goal, goal_id)
    entries_result = await session.execute(
        select(PlanEntry).where(PlanEntry.goal_id == goal_id)
    )
    entries = entries_result.scalars().all()
    planned = len(entries)
    completed = sum(1 for e in entries if e.completed)
    rate = round((completed / planned) * 100, 1) if planned else 0.0
    streak = _streak(entries, goal)

    weekly: list[dict] = []
    by_week: dict[int, list[PlanEntry]] = defaultdict(list)
    for e in entries:
        by_week[e.week_number].append(e)
    for wn in sorted(by_week):
        wk = by_week[wn]
        weekly.append({
            "week": wn,
            "planned": len(wk),
            "completed": sum(1 for e in wk if e.completed),
        })

    # strength trends
    ex_result = await session.execute(
        select(Exercise)
        .join(PlanEntry, Exercise.plan_entry_id == PlanEntry.id)
        .where(PlanEntry.goal_id == goal_id)
    )
    ex_names = {ex.id: ex.name for ex in ex_result.scalars()}

    sessions_result = await session.execute(
        select(WorkoutSession)
        .options(selectinload(WorkoutSession.set_logs))
        .join(PlanEntry, WorkoutSession.plan_entry_id == PlanEntry.id)
        .where(PlanEntry.goal_id == goal_id)
        .order_by(WorkoutSession.performed_at)
    )
    sessions_list = sessions_result.scalars().all()

    by_exercise: dict[uuid.UUID, dict[date, list[SetLog]]] = defaultdict(lambda: defaultdict(list))
    for ws in sessions_list:
        for sl in ws.set_logs:
            by_exercise[sl.exercise_id][ws.performed_at].append(sl)

    trends: list[ExerciseTrend] = []
    for ex_id, by_date in by_exercise.items():
        points = []
        for d, sets in sorted(by_date.items()):
            weights = [s.weight for s in sets if s.weight is not None]
            reps = [s.reps for s in sets if s.reps is not None]
            rirs = [s.rir for s in sets if s.rir is not None]
            points.append(ExercisePoint(
                date=d,
                top_weight=max(weights) if weights else None,
                top_reps=max(reps) if reps else None,
                best_rir=min(rirs) if rirs else None,
                set_count=len(sets),
            ))
        trends.append(ExerciseTrend(exercise_name=ex_names.get(ex_id, "Exercise"), points=points))
    trends.sort(key=lambda t: t.exercise_name)

    return ProgressResponse(
        consistency=ConsistencyStats(
            planned=planned,
            completed=completed,
            completion_rate=rate,
            current_streak=streak,
            weekly=weekly,
        ),
        trends=trends,
    )


async def latest_weights(session: AsyncSession, limit: int = 2) -> list[WeightEntry]:
    result = await session.execute(
        select(WeightEntry).order_by(WeightEntry.measured_at.desc()).limit(limit)
    )
    return list(result.scalars().all())


async def generate_insights(session: AsyncSession, goal_id: uuid.UUID) -> list[AIInsight]:
    """Rule-based analysis engine. Creates insights when notable and not already open."""
    goal = await session.get(Goal, goal_id)
    if not goal:
        return []

    progress = await gather_progress(session, goal_id)
    weights = await latest_weights(session)
    open_result = await session.execute(
        select(AIInsight.title).where(AIInsight.goal_id == goal_id, AIInsight.status == "open")
    )
    open_titles = {row[0] for row in open_result.all()}

    created: list[AIInsight] = []

    def add(kind: str, severity: str, title: str, body: str):
        if title in open_titles:
            return
        ins = AIInsight(goal_id=goal_id, kind=kind, severity=severity, title=title, body=body)
        session.add(ins)
        created.append(ins)

    c = progress.consistency
    # low completion this week
    cur_week = current_week(goal)
    this_week = next((w for w in c.weekly if w["week"] == cur_week), None)
    if this_week and this_week["planned"] >= 3:
        missed = this_week["planned"] - this_week["completed"]
        if missed >= 2 and this_week["completed"] / this_week["planned"] < 0.5:
            add("schedule", "warning",
                "Low workout completion this week",
                f"You've completed {this_week['completed']} of {this_week['planned']} planned activities "
                f"this week. If the schedule is too demanding, tell your coach and finalize a lighter plan.")

    # body trend
    if len(weights) >= 2:
        newest, previous = weights[0], weights[1]
        delta = round(newest.weight_kg - previous.weight_kg, 1)
        if abs(delta) >= 0.5:
            direction = "down" if delta < 0 else "up"
            add("daily", "good",
                f"Weight is trending {direction}",
                f"Weight changed by {delta:+.1f} kg ({previous.weight_kg} → {newest.weight_kg} kg) "
                f"since your last measurement.")

    # exercise plateaus / improvements
    for trend in progress.trends:
        weights_pts = [p.top_weight for p in trend.points[-5:] if p.top_weight is not None]
        if len(weights_pts) < 3:
            continue
        flat = len(set(weights_pts[-3:])) == 1
        improving = weights_pts[-1] > weights_pts[0] and all(
            w2 >= w1 for w1, w2 in zip(weights_pts, weights_pts[1:]))
        if flat:
            add("plateau", "warning",
                f"{trend.exercise_name} plateau",
                f"Your {trend.exercise_name} top weight has been {weights_pts[-1]:.1f} kg for the last "
                f"3 sessions. Consider increasing reps or adding a small load increase.")
        elif improving:
            add("daily", "good",
                f"{trend.exercise_name} improving",
                f"{trend.exercise_name} progressed from {weights_pts[0]:.1f} kg to {weights_pts[-1]:.1f} kg "
                f"across your last {len(weights_pts)} sessions. Keep the current progression.")

    await session.commit()
    for ins in created:
        await session.refresh(ins)
    return created


def build_weekly_review(goal: Goal | None, progress: ProgressResponse, weights: list[WeightEntry]) -> dict:
    c = progress.consistency
    metrics = {
        "workout_completion": c.completion_rate,
        "completed": c.completed,
        "planned": c.planned,
        "streak": c.current_streak,
    }
    if len(weights) >= 2:
        metrics["weight_change"] = round(weights[0].weight_kg - weights[1].weight_kg, 1)
        if weights[0].fat_percentage is not None and weights[1].fat_percentage is not None:
            metrics["fat_change"] = round(weights[0].fat_percentage - weights[1].fat_percentage, 1)
        if weights[0].muscle_percentage is not None and weights[1].muscle_percentage is not None:
            metrics["muscle_change"] = round(weights[0].muscle_percentage - weights[1].muscle_percentage, 1)

    improving = []
    for trend in progress.trends:
        pts = [p.top_weight for p in trend.points if p.top_weight is not None]
        if len(pts) >= 2 and pts[-1] > pts[0]:
            improving.append(f"{trend.exercise_name} {pts[0]:.1f}→{pts[-1]:.1f} kg")

    parts = []
    if c.planned:
        parts.append(f"Workout completion is {c.completion_rate:.0f}% ({c.completed}/{c.planned}).")
    if "weight_change" in metrics:
        parts.append(f"Weight changed {metrics['weight_change']:+.1f} kg.")
    if improving:
        parts.append("Strength improving: " + ", ".join(improving[:3]) + ".")
    if not parts:
        parts.append("Not enough data yet. Complete workouts and log body measurements to get a weekly review.")

    recommendation = "Keep the current program." if c.completion_rate >= 70 else \
        "Completion is low — consider shortening workouts or reducing weekly frequency."
    return {"metrics": metrics, "summary": " ".join(parts), "recommendation": recommendation}


# --------------------------------------------------------------------------------------
# Deep analysis: crosses logged workout data with body metrics and schedule adherence
# over 7-day and 14-day windows, then hands it to the AI for interpretation.
# --------------------------------------------------------------------------------------

WINDOWS = {"last_7_days": 7, "last_14_days": 14}


def _volume(sets: list[SetLog]) -> float:
    return round(sum((s.weight or 0) * (s.reps or 0) for s in sets), 1)


def _avg(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 2) if values else None


async def build_analysis_data(session: AsyncSession, goal_id: uuid.UUID) -> dict:
    """Assemble everything the coach needs to judge progress (no AI call here)."""
    goal = await session.get(Goal, goal_id)
    today = date.today()

    entries_result = await session.execute(
        select(PlanEntry).where(PlanEntry.goal_id == goal_id)
    )
    entries = entries_result.scalars().all()
    entry_by_id = {e.id: e for e in entries}

    sessions_result = await session.execute(
        select(WorkoutSession)
        .options(selectinload(WorkoutSession.set_logs))
        .join(PlanEntry, WorkoutSession.plan_entry_id == PlanEntry.id)
        .where(PlanEntry.goal_id == goal_id)
        .order_by(WorkoutSession.performed_at)
    )
    sessions = sessions_result.scalars().all()

    ex_result = await session.execute(
        select(Exercise)
        .join(PlanEntry, Exercise.plan_entry_id == PlanEntry.id)
        .where(PlanEntry.goal_id == goal_id)
    )
    ex_names = {ex.id: ex.name for ex in ex_result.scalars()}

    weights_result = await session.execute(
        select(WeightEntry).order_by(WeightEntry.measured_at)
    )
    weights = list(weights_result.scalars().all())

    def window(days: int) -> dict:
        cutoff = today - timedelta(days=days)
        win_sessions = [ws for ws in sessions if ws.performed_at >= cutoff]
        all_sets = [sl for ws in win_sessions for sl in ws.set_logs]

        # per-exercise detail inside the window
        per_ex: dict[str, dict] = {}
        for ws in win_sessions:
            for sl in ws.set_logs:
                name = ex_names.get(sl.exercise_id, "Exercise")
                bucket = per_ex.setdefault(name, {
                    "exercise": name, "sessions": 0, "sets": 0, "volume_kg": 0.0,
                    "top_weight": None, "rirs": [], "failure_sets": 0, "dates": [],
                })
                bucket["sets"] += 1
                bucket["volume_kg"] += (sl.weight or 0) * (sl.reps or 0)
                if sl.weight is not None:
                    bucket["top_weight"] = max(bucket["top_weight"] or 0, sl.weight)
                if sl.rir is not None:
                    bucket["rirs"].append(sl.rir)
                    if sl.rir == 0:
                        bucket["failure_sets"] += 1
                if str(ws.performed_at) not in bucket["dates"]:
                    bucket["dates"].append(str(ws.performed_at))
        for bucket in per_ex.values():
            bucket["sessions"] = len(bucket["dates"])
            bucket["volume_kg"] = round(bucket["volume_kg"], 1)
            bucket["avg_rir"] = _avg([float(r) for r in bucket.pop("rirs")])

        # adherence: scheduled entries whose date falls inside the window
        planned = completed = 0
        for e in entries:
            d = _entry_date(goal, e) if goal else None
            if d is None or not (cutoff <= d <= today):
                continue
            planned += 1
            if e.completed:
                completed += 1

        win_weights = [w for w in weights if w.measured_at >= cutoff]
        body_change = {}
        if len(win_weights) >= 2:
            first, last = win_weights[0], win_weights[-1]
            body_change["weight_kg"] = round(last.weight_kg - first.weight_kg, 2)
            if first.fat_percentage is not None and last.fat_percentage is not None:
                body_change["fat_pct"] = round(last.fat_percentage - first.fat_percentage, 2)
                body_change["fat_kg"] = round(
                    last.weight_kg * last.fat_percentage / 100 - first.weight_kg * first.fat_percentage / 100, 2)
            if first.muscle_percentage is not None and last.muscle_percentage is not None:
                body_change["muscle_pct"] = round(last.muscle_percentage - first.muscle_percentage, 2)
                body_change["muscle_kg"] = round(
                    last.weight_kg * last.muscle_percentage / 100 - first.weight_kg * first.muscle_percentage / 100, 2)

        return {
            "days": days,
            "workouts_logged": len(win_sessions),
            "sets_logged": len(all_sets),
            "total_volume_kg": _volume(all_sets),
            "failure_sets": sum(1 for s in all_sets if s.rir == 0),
            "avg_rir": _avg([float(s.rir) for s in all_sets if s.rir is not None]),
            "planned_activities": planned,
            "completed_activities": completed,
            "adherence_pct": round(completed / planned * 100, 1) if planned else None,
            "measurements": len(win_weights),
            "body_change": body_change,
            "exercises": sorted(per_ex.values(), key=lambda b: b["exercise"]),
        }

    latest = weights[-1] if weights else None
    per_exercise_history: list[dict] = []
    by_ex: dict[str, list[dict]] = defaultdict(list)
    for ws in sessions:
        grouped: dict[uuid.UUID, list[SetLog]] = defaultdict(list)
        for sl in ws.set_logs:
            grouped[sl.exercise_id].append(sl)
        for ex_id, sets in grouped.items():
            weights_in_set = [s.weight for s in sets if s.weight is not None]
            rirs = [s.rir for s in sets if s.rir is not None]
            reps = [s.reps for s in sets if s.reps is not None]
            by_ex[ex_names.get(ex_id, "Exercise")].append({
                "date": str(ws.performed_at),
                "sets": len(sets),
                "top_weight": max(weights_in_set) if weights_in_set else None,
                "total_reps": sum(s.reps or 0 for s in sets),
                "avg_reps": _avg([float(r) for r in reps]),
                "volume_kg": _volume(sets),
                "best_rir": min(rirs) if rirs else None,
                "avg_rir": _avg([float(r) for r in rirs]),
                "failure_sets": sum(1 for s in sets if s.rir == 0),
            })
    for name, history in sorted(by_ex.items()):
        per_exercise_history.append({"exercise": name, "history": history[-6:]})

    return {
        "today": str(today),
        "goal": {
            "title": goal.title if goal else None,
            "description": goal.description if goal else None,
            "metric": goal.metric_name if goal else None,
            "current_value": goal.current_value if goal else None,
            "target_value": goal.target_value if goal else None,
            "unit": goal.unit if goal else None,
            "start_date": str(goal.start_date) if goal and goal.start_date else None,
            "target_date": str(goal.target_date) if goal and goal.target_date else None,
            "current_week": current_week(goal),
        },
        "body_latest": {
            "weight_kg": latest.weight_kg if latest else None,
            "fat_pct": latest.fat_percentage if latest else None,
            "muscle_pct": latest.muscle_percentage if latest else None,
            "measured_at": str(latest.measured_at) if latest else None,
        },
        "windows": {name: window(days) for name, days in WINDOWS.items()},
        "exercise_history": per_exercise_history,
        "weight_history": [
            {"date": str(w.measured_at), "weight_kg": w.weight_kg,
             "fat_pct": w.fat_percentage, "muscle_pct": w.muscle_percentage}
            for w in weights[-10:]
        ],
    }


def has_enough_data(data: dict) -> bool:
    w14 = data["windows"]["last_14_days"]
    return bool(w14["sets_logged"] or w14["measurements"] or w14["planned_activities"])


def fallback_analysis(data: dict) -> dict:
    """Deterministic analysis used when the AI is unavailable."""
    w7 = data["windows"]["last_7_days"]
    w14 = data["windows"]["last_14_days"]
    observations: list[str] = []
    recommendations: list[str] = []
    severity = "good"

    if w7["workouts_logged"]:
        observations.append(
            f"{w7['workouts_logged']} workouts logged in 7 days "
            f"({w7['sets_logged']} sets, {w7['total_volume_kg']:.0f} kg total volume)."
        )
    else:
        observations.append("No workouts logged in the last 7 days.")
        severity = "warning"
        recommendations.append("Log your next session from the Calendar so progress can be tracked.")

    if w7["adherence_pct"] is not None:
        observations.append(
            f"Schedule adherence: {w7['adherence_pct']:.0f}% this week "
            f"({w7['completed_activities']}/{w7['planned_activities']} activities)."
        )
        if w7["adherence_pct"] < 60:
            severity = "warning"
            recommendations.append("Adherence is low — consider fewer or shorter sessions per week.")

    prev_volume = round(w14["total_volume_kg"] - w7["total_volume_kg"], 1)
    if prev_volume > 0 and w7["total_volume_kg"] > 0:
        delta = round((w7["total_volume_kg"] - prev_volume) / prev_volume * 100, 1)
        observations.append(f"Training volume changed {delta:+.0f}% versus the previous week.")
        if delta < -25:
            severity = "warning" if severity != "warning" else severity
            recommendations.append("Volume dropped sharply — check whether fatigue or schedule is the cause.")

    if w7["failure_sets"] >= 4:
        severity = "warning"
        observations.append(f"{w7['failure_sets']} sets taken to failure (RIR 0) in 7 days.")
        recommendations.append("Frequent failure training raises fatigue — aim for RIR 1–2 on most sets.")

    body7 = w7["body_change"]
    if body7.get("weight_kg") is not None:
        observations.append(f"Body weight {body7['weight_kg']:+.1f} kg over 7 days.")
    if body7.get("fat_kg") is not None:
        observations.append(f"Fat mass {body7['fat_kg']:+.1f} kg, muscle mass {body7.get('muscle_kg', 0):+.1f} kg (7 days).")
    if not w14["measurements"]:
        recommendations.append("Log body measurements weekly so body-composition trends can be analysed.")

    # plateau detection across recent sessions
    for ex in data["exercise_history"]:
        tops = [h["top_weight"] for h in ex["history"] if h["top_weight"] is not None]
        if len(tops) >= 3 and len(set(tops[-3:])) == 1:
            observations.append(f"{ex['exercise']} top weight unchanged for 3 sessions ({tops[-1]:.1f} kg).")
            recommendations.append(f"Add load or reps on {ex['exercise']}, or swap it for a variation.")
            severity = "watch" if severity == "good" else severity

    if not recommendations:
        recommendations.append("Keep the current plan — progression looks reasonable.")

    headline = {
        "good": "Everything looks good",
        "watch": "Something to watch",
        "warning": "Needs attention",
    }[severity]

    return {
        "severity": severity,
        "headline": headline,
        "assessment": " ".join(observations[:3]) or "Not enough data yet to assess progress.",
        "observations": observations,
        "recommendations": recommendations,
        "exercise_notes": [],
        "source": "rules",
    }


def _exercise_key(name: str) -> str:
    return "".join(ch.lower() for ch in name if ch.isalnum())


def _round_load(value: float) -> float:
    """Round to a practical 0.5 kg increment without assuming specific equipment."""
    return round(value * 2) / 2


def _bounded_load(suggested: float, current: float, decision: str) -> float:
    """Reject only implausible jumps; normal coaching decisions remain flexible."""
    low = current * (0.80 if decision == "deload" else 0.90)
    high = current * 1.10
    return _round_load(max(low, min(high, suggested)))


def _default_progression(history: list[dict], upcoming: Exercise) -> tuple[str, float | None, str]:
    """Balanced fallback when the AI omits a target for a logged exercise."""
    weighted = [h for h in history if h.get("top_weight") is not None]
    if not weighted:
        return "keep", upcoming.weight, "No logged working weight yet; keep the programmed target."

    latest = weighted[-1]
    current = float(latest["top_weight"])
    avg_reps = latest.get("avg_reps")
    avg_rir = latest.get("avg_rir")
    failures = int(latest.get("failure_sets") or 0)
    target_top = upcoming.reps_max or upcoming.reps
    target_rir = upcoming.rir_target if upcoming.rir_target is not None else 2

    if failures >= 2 or (avg_rir is not None and avg_rir < 0.5):
        return "deload", _round_load(current * 0.95), "Repeated failure or very low RIR suggests a small load reduction."

    if (
        target_top is not None
        and avg_reps is not None
        and avg_reps >= target_top
        and avg_rir is not None
        and avg_rir >= max(1, target_rir)
    ):
        return "increase_load", _round_load(current * 1.025), "Top of the rep range was reached with adequate RIR."

    if target_top is not None and avg_reps is not None and avg_reps < target_top:
        return "increase_reps", current, "Keep the load and progress reps toward the top of the range."

    return "keep", current, "Performance supports keeping the current working load."


async def build_progression_preview(
    session: AsyncSession,
    goal_id: uuid.UUID,
    data: dict,
    analysis: dict,
) -> list[dict]:
    """Build next-week targets from AI advice, with broad bounds against accidental jumps."""
    goal = await session.get(Goal, goal_id)
    if not goal:
        return []
    next_week = current_week(goal) + 1

    result = await session.execute(
        select(Exercise)
        .join(PlanEntry, Exercise.plan_entry_id == PlanEntry.id)
        .where(PlanEntry.goal_id == goal_id, PlanEntry.week_number == next_week)
        .order_by(PlanEntry.day_of_week, Exercise.order_index)
    )
    upcoming = list(result.scalars())
    if not upcoming:
        return []

    history_by_name = {
        _exercise_key(item["exercise"]): item["history"]
        for item in data.get("exercise_history", [])
        if item.get("exercise")
    }
    advice_by_name = {
        _exercise_key(item["exercise"]): item
        for item in analysis.get("exercise_notes", [])
        if isinstance(item, dict) and item.get("exercise")
    }

    # One target per exercise name; the apply step updates every matching occurrence next week.
    targets: list[dict] = []
    seen: set[str] = set()
    for ex in upcoming:
        key = _exercise_key(ex.name)
        if key in seen:
            continue
        seen.add(key)
        history = history_by_name.get(key, [])
        if not history:
            continue

        default_decision, default_weight, default_reason = _default_progression(history, ex)
        advice = advice_by_name.get(key, {})
        decision = str(advice.get("action") or default_decision)
        if decision not in {"keep", "increase_load", "increase_reps", "deload", "swap"}:
            decision = default_decision

        latest_weight = next(
            (float(h["top_weight"]) for h in reversed(history) if h.get("top_weight") is not None),
            None,
        )
        suggested = advice.get("suggested_weight_kg")
        try:
            suggested = float(suggested) if suggested is not None else default_weight
        except (TypeError, ValueError):
            suggested = default_weight
        target_weight = (
            _bounded_load(suggested, latest_weight, decision)
            if suggested is not None and latest_weight is not None
            else suggested
        )

        reps_min = advice.get("suggested_reps_min")
        reps_max = advice.get("suggested_reps_max")
        rir = advice.get("suggested_rir")
        try:
            reps_min = max(1, min(100, int(reps_min))) if reps_min is not None else ex.reps
        except (TypeError, ValueError):
            reps_min = ex.reps
        try:
            reps_max = max(reps_min or 1, min(100, int(reps_max))) if reps_max is not None else ex.reps_max
        except (TypeError, ValueError):
            reps_max = ex.reps_max
        try:
            rir = max(0, min(5, int(rir))) if rir is not None else ex.rir_target
        except (TypeError, ValueError):
            rir = ex.rir_target

        targets.append({
            "exercise": ex.name,
            "week_number": next_week,
            "decision": decision,
            "current_weight_kg": latest_weight,
            "target_weight_kg": target_weight,
            "reps_min": reps_min,
            "reps_max": reps_max,
            "rir_target": rir,
            "reason": str(advice.get("note") or default_reason),
        })
    return targets


async def apply_progression_targets(
    session: AsyncSession,
    goal_id: uuid.UUID,
    insight: AIInsight,
) -> dict:
    payload = insight.payload or {}
    if payload.get("progression_applied_at"):
        return {
            "updated": 0,
            "week_number": payload.get("progression_week"),
            "already_applied": True,
        }
    targets = payload.get("progression_targets") or []
    if not targets:
        raise ValueError("This insight has no next-week targets to apply")

    week_number = int(targets[0]["week_number"])
    result = await session.execute(
        select(Exercise)
        .join(PlanEntry, Exercise.plan_entry_id == PlanEntry.id)
        .where(PlanEntry.goal_id == goal_id, PlanEntry.week_number == week_number)
    )
    exercises = list(result.scalars())
    target_by_name = {_exercise_key(t["exercise"]): t for t in targets}

    updated = 0
    for ex in exercises:
        target = target_by_name.get(_exercise_key(ex.name))
        if not target:
            continue
        ex.weight = target.get("target_weight_kg")
        ex.reps = target.get("reps_min")
        ex.reps_max = target.get("reps_max")
        ex.rir_target = target.get("rir_target")
        updated += 1

    from datetime import datetime, timezone
    insight.payload = {
        **payload,
        "progression_applied_at": datetime.now(timezone.utc).isoformat(),
        "progression_week": week_number,
        "progression_updated_exercises": updated,
    }
    await session.commit()
    await session.refresh(insight)
    return {"updated": updated, "week_number": week_number, "already_applied": False}


async def analyze(session: AsyncSession, goal_id: uuid.UUID, force: bool = False) -> AIInsight | None:
    """Create (or reuse today's) deep analysis insight for a goal."""
    goal = await session.get(Goal, goal_id)
    if not goal:
        return None

    if not force:
        existing = await session.execute(
            select(AIInsight)
            .where(AIInsight.goal_id == goal_id, AIInsight.kind == "analysis", AIInsight.status == "open")
            .order_by(AIInsight.created_at.desc())
            .limit(1)
        )
        latest = existing.scalar_one_or_none()
        if latest and latest.created_at and latest.created_at.date() == date.today():
            return latest

    data = await build_analysis_data(session, goal_id)

    if not has_enough_data(data):
        result = {
            "severity": "info",
            "headline": "Not enough data yet",
            "assessment": (
                "I need a bit of history first: finish an exercise from the Calendar and log a body "
                "measurement in Progress. Then I can compare your last 7 and 14 days."
            ),
            "observations": [],
            "recommendations": [
                "Open today's workout in the Calendar and log your sets.",
                "Add a body measurement (weight, fat %, muscle %) in Progress.",
            ],
            "exercise_notes": [],
            "source": "rules",
        }
    else:
        from app.services.ai_service import analyze_training
        try:
            result = await analyze_training(data)
            result["source"] = "ai"
        except Exception as e:  # AI unavailable/invalid → deterministic analysis
            print(f"insights analyze: falling back to rules ({e})", flush=True)
            result = fallback_analysis(data)

    progression_targets = await build_progression_preview(session, goal_id, data, result)

    ins = AIInsight(
        goal_id=goal_id,
        kind="analysis",
        severity=str(result.get("severity") or "good")[:20],
        title=str(result.get("headline") or "Training insight")[:255],
        body=str(result.get("assessment") or ""),
        payload={
            **result,
            "metrics": {
                "last_7_days": data["windows"]["last_7_days"],
                "last_14_days": data["windows"]["last_14_days"],
            },
            "progression_targets": progression_targets,
            "progression_week": current_week(goal) + 1,
            "progression_applied_at": None,
        },
    )
    session.add(ins)
    await session.commit()
    await session.refresh(ins)
    return ins
