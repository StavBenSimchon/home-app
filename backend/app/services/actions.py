import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.plan import PlanEntry

HIIT_RE = re.compile(r"\bhiit\b", re.IGNORECASE)
WALK_RE = re.compile(r"\bwalk", re.IGNORECASE)
STRENGTH_RE = re.compile(r"strength|workout|upper|lower|push|pull|legs|full.?body", re.IGNORECASE)


async def _entries(session: AsyncSession, goal_id: uuid.UUID) -> list[PlanEntry]:
    result = await session.execute(
        select(PlanEntry)
        .options(selectinload(PlanEntry.exercises))
        .where(PlanEntry.goal_id == goal_id)
        .order_by(PlanEntry.week_number, PlanEntry.day_of_week)
    )
    return list(result.scalars())


async def apply_action(session: AsyncSession, goal_id: uuid.UUID, action: dict) -> dict:
    action_type = action.get("type")
    params = action.get("params") or {}
    entries = await _entries(session, goal_id)

    if action_type == "remove_hiit_this_week":
        week = max((e.week_number for e in entries), default=1)
        removed = []
        for e in entries:
            if e.week_number == week and e.activity and HIIT_RE.search(e.activity):
                removed.append(e.activity)
                await session.delete(e)
        if not removed:
            raise ValueError("No HIIT session found this week")
        await session.flush()
        return {"removed": removed}

    if action_type == "add_walking_session":
        week_num = max((e.week_number for e in entries), default=1)
        steps = (params.get("steps")) or "6,000"
        entry = PlanEntry(
            goal_id=goal_id,
            week_number=week_num,
            day_of_week=params.get("day_of_week"),
            activity=f"Walk — {steps} steps",
            duration_minutes=params.get("duration_minutes") or 45,
            frequency_hint=None if params.get("day_of_week") is not None else "1x this week",
        )
        session.add(entry)
        await session.flush()
        return {"added": entry.activity}

    if action_type == "replace_exercise":
        old_name = params.get("old_name") or params.get("exercise") or ""
        new_name = params.get("new_name") or params.get("replacement") or old_name
        if not old_name or not new_name or old_name == new_name:
            raise ValueError("Specify the exercise to replace and its replacement")
        pattern = re.compile(re.escape(old_name), re.IGNORECASE)
        replaced = 0
        for e in entries:
            for ex in e.exercises:
                if pattern.search(ex.name or ""):
                    ex.name = new_name
                    replaced += 1
        if replaced == 0:
            raise ValueError(f"Exercise '{old_name}' not found in the plan")
        await session.flush()
        return {"replaced": replaced, "from": old_name, "to": new_name}

    if action_type == "shorten_workout":
        scope = params.get("scope")
        factor = float(params.get("factor") or 0.75)
        changed = []
        for e in entries:
            if scope and scope.lower() not in (e.activity or "").lower():
                continue
            for ex in e.exercises:
                if ex.sets and ex.sets > 2:
                    ex.sets = max(2, int(round(ex.sets * factor)))
                    changed.append(ex.name)
            if e.duration_minutes and e.duration_minutes > 20:
                e.duration_minutes = int(round(e.duration_minutes * factor))
        if not changed:
            raise ValueError("No exercises to shorten")
        await session.flush()
        return {"shortened_exercises": len(changed)}

    if action_type == "change_frequency":
        target = params.get("strength_per_week")
        if not target:
            raise ValueError("Specify target strength sessions per week")
        target = int(target)
        week = _current_week(entries=entries)
        strength = [e for e in entries if e.week_number == week and e.activity and STRENGTH_RE.search(e.activity)]
        flex = [e for e in entries if e.week_number == week and e.day_of_week is None and e not in strength]
        current = len(strength) + len(flex)
        if current == target:
            return {"message": f"Already at {target} sessions per week"}
        if current > target:
            # remove extra flexible sessions first, then fixed ones
            removable = flex + [e for e in strength if e.day_of_week is None]
            to_remove = removable[: current - target]
            if len(to_remove) < current - target:
                fixed = [e for e in strength if e.day_of_week is not None]
                to_remove = to_remove + fixed[: current - target - len(to_remove)]
            for e in to_remove:
                await session.delete(e)
            await session.flush()
            return {"removed": [e.activity for e in to_remove], "new_frequency": target}
        raise ValueError("Increasing frequency is not supported by this action yet")

    raise ValueError(f"Unsupported action type: {action_type}")
