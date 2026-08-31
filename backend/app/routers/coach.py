import traceback
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models.coach import CoachMessage
from app.models.exercise import Exercise
from app.models.goal import Goal
from app.models.plan import PlanEntry
from app.models.session import SetLog, WorkoutSession
from app.models.weight import WeightEntry
from app.services.ai_service import coach_finalize, coach_reply
from app.services.actions import apply_action

router = APIRouter(prefix="/coach", tags=["coach"])


class CoachChatRequest(BaseModel):
    goal_id: str | None = None
    message: str
    history: list[dict] = []


class CoachApplyRequest(BaseModel):
    goal_id: str
    action: dict


def _default_goal_query():
    return select(Goal).order_by(Goal.created_at).limit(1)


async def _resolve_goal(session: AsyncSession, goal_id: str | None) -> Goal:
    if goal_id:
        try:
            gid = uuid.UUID(goal_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid goal_id")
        goal = await session.get(Goal, gid)
    else:
        result = await session.execute(_default_goal_query())
        goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found. Create a plan first.")
    return goal


def _serialize_entries(entries: list[PlanEntry]) -> list[dict]:
    return [
        {
            "week_number": e.week_number,
            "day_of_week": e.day_of_week,
            "activity": e.activity,
            "duration_minutes": e.duration_minutes,
            "notes": e.notes,
            "frequency_hint": e.frequency_hint,
            "completed": e.completed,
            "exercises": [
                {
                    "id": str(ex.id),
                    "name": ex.name,
                    "sets": ex.sets,
                    "reps": ex.reps,
                    "reps_max": ex.reps_max,
                    "weight": ex.weight,
                    "rir_target": ex.rir_target,
                    "duration_seconds": ex.duration_seconds,
                    "notes": ex.notes,
                }
                for ex in sorted(e.exercises, key=lambda x: x.order_index)
            ],
        }
        for e in entries
    ]


async def _load_context(session: AsyncSession, goal: Goal) -> dict:
    entries_result = await session.execute(
        select(PlanEntry)
        .options(selectinload(PlanEntry.exercises))
        .where(PlanEntry.goal_id == goal.id)
        .order_by(PlanEntry.week_number, PlanEntry.day_of_week)
    )
    plan = _serialize_entries(entries_result.scalars().all())

    sessions_result = await session.execute(
        select(WorkoutSession)
        .options(selectinload(WorkoutSession.set_logs))
        .join(PlanEntry, WorkoutSession.plan_entry_id == PlanEntry.id)
        .where(PlanEntry.goal_id == goal.id)
        .order_by(WorkoutSession.performed_at.desc())
        .limit(8)
    )
    recent = []
    for ws in sessions_result.scalars():
        recent.append({
            "performed_at": str(ws.performed_at),
            "plan_entry_id": str(ws.plan_entry_id),
            "status": ws.status,
            "sets": [
                {"exercise_id": str(sl.exercise_id), "set_number": sl.set_number,
                 "weight": sl.weight, "reps": sl.reps, "rir": sl.rir}
                for sl in ws.set_logs
            ],
        })

    weight_result = await session.execute(
        select(WeightEntry).order_by(WeightEntry.measured_at.desc()).limit(10)
    )
    weights = [
        {"weight_kg": w.weight_kg, "fat": w.fat_percentage, "muscle": w.muscle_percentage,
         "measured_at": str(w.measured_at)}
        for w in weight_result.scalars()
    ]

    return {
        "goal": {
            "title": goal.title, "description": goal.description,
            "metric_name": goal.metric_name, "current_value": goal.current_value,
            "target_value": goal.target_value, "unit": goal.unit,
            "start_date": str(goal.start_date) if goal.start_date else None,
            "target_date": str(goal.target_date) if goal.target_date else None,
        },
        "plan": plan,
        "recent_sessions": recent,
        "weights": weights,
    }


async def _persist_message(session: AsyncSession, goal_id: uuid.UUID, role: str, text: str):
    session.add(CoachMessage(goal_id=goal_id, role=role, text=text))


@router.post("/chat")
async def chat(payload: CoachChatRequest, session: AsyncSession = Depends(get_session)):
    if not payload.message.strip():
        raise HTTPException(status_code=400, detail="Message is required")
    try:
        goal = await _resolve_goal(session, payload.goal_id)
        context = await _load_context(session, goal)
        history = [{"role": h.get("role", "user"), "text": h.get("text", "")} for h in payload.history[-20:]]
        try:
            result = await coach_reply(payload.message, context, history)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"AI service error: {e}")

        rl = result if isinstance(result, dict) else {"type": "message", "message": str(result)}
        await _persist_message(session, goal.id, "user", payload.message)
        await _persist_message(session, goal.id, "assistant", rl.get("message", ""))
        await session.commit()
        return rl
    except HTTPException:
        raise
    except Exception as e:
        print(f"coach chat error: {traceback.format_exc()}", flush=True)
        raise HTTPException(status_code=502, detail=f"Coach error: {e}")


@router.post("/finalize")
async def finalize(payload: CoachChatRequest, session: AsyncSession = Depends(get_session)):
    try:
        goal = await _resolve_goal(session, payload.goal_id)
        context = await _load_context(session, goal)
        history = [{"role": h.get("role", "user"), "text": h.get("text", "")} for h in payload.history[-20:]]
        try:
            ai_output = await coach_finalize(payload.message, context, history)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"AI service error: {e}")
        if "goal" not in ai_output or "plan" not in ai_output:
            raise HTTPException(status_code=502, detail="AI returned invalid format")

        from app.services.ai_service import update_goal_with_plan
        result = await update_goal_with_plan(ai_output, session, goal.id, raw_json=ai_output)
        await _persist_message(session, goal.id, "assistant", "Plan updated.")
        await session.commit()
        return {"type": "finalized", **result}
    except HTTPException:
        raise
    except Exception as e:
        print(f"coach finalize error: {traceback.format_exc()}", flush=True)
        raise HTTPException(status_code=502, detail=f"Coach error: {e}")


@router.post("/actions")
async def apply(payload: CoachApplyRequest, session: AsyncSession = Depends(get_session)):
    try:
        gid = uuid.UUID(payload.goal_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid goal_id")
    goal = await session.get(Goal, gid)
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    try:
        result = await apply_action(session, gid, payload.action)
        await session.commit()
        return {"applied": True, "result": result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to apply action: {e}")


@router.get("/history")
async def history(goal_id: str, session: AsyncSession = Depends(get_session)):
    try:
        gid = uuid.UUID(goal_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid goal_id")
    result = await session.execute(
        select(CoachMessage)
        .where(CoachMessage.goal_id == gid)
        .order_by(CoachMessage.created_at)
        .limit(60)
    )
    return [{"role": m.role, "text": m.text, "created_at": m.created_at.isoformat()} for m in result.scalars()]
