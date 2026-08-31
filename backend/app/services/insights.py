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

    def add(kind: str, severity: str, title: str, body: str, action: dict | None = None):
        if title in open_titles:
            return
        ins = AIInsight(goal_id=goal_id, kind=kind, severity=severity, title=title, body=body, action=action)
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
                f"this week. If the schedule is too demanding, I can reduce the load.",
                action={"type": "change_frequency", "params": {}})

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
