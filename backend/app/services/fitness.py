"""Business logic for fitness planning."""

import uuid
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.goal import Goal
from app.models.plan import PlanEntry


async def get_goal_with_plan(
    goal_id: uuid.UUID, session: AsyncSession
) -> dict | None:
    goal = await session.get(Goal, goal_id)
    if not goal:
        return None

    result = await session.execute(
        select(PlanEntry)
        .where(PlanEntry.goal_id == goal_id)
        .order_by(PlanEntry.week_number, PlanEntry.day_of_week)
    )
    entries = result.scalars().all()

    plan_by_week = defaultdict(list)
    for entry in entries:
        plan_by_week[entry.week_number].append(
            {
                "id": str(entry.id),
                "day_of_week": entry.day_of_week,
                "activity": entry.activity,
                "duration_minutes": entry.duration_minutes,
                "notes": entry.notes,
                "frequency_hint": entry.frequency_hint,
            }
        )

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
        "plan": {
            str(week): entries
            for week, entries in sorted(plan_by_week.items())
        },
    }
