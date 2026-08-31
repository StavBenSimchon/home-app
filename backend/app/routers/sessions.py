import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models.exercise import Exercise
from app.models.plan import PlanEntry
from app.models.session import SetLog, WorkoutSession
from app.schemas.session import (
    LogSetRequest,
    PreviousPerformance,
    PreviousSet,
    SessionResponse,
    SessionStartRequest,
    SetLogWrite,
)
router = APIRouter(prefix="/goals/{goal_id}/sessions", tags=["sessions"])


async def _get_entry(goal_id: uuid.UUID, entry_id: uuid.UUID, session: AsyncSession) -> PlanEntry:
    result = await session.execute(
        select(PlanEntry).where(PlanEntry.id == entry_id, PlanEntry.goal_id == goal_id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Plan entry not found")
    return entry


async def _get_session(goal_id: uuid.UUID, session_id: uuid.UUID, db: AsyncSession) -> WorkoutSession:
    result = await db.execute(
        select(WorkoutSession)
        .options(selectinload(WorkoutSession.set_logs))
        .where(WorkoutSession.id == session_id)
    )
    ws = result.scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=404, detail="Session not found")
    # verify the session belongs to the goal
    await _get_entry(goal_id, ws.plan_entry_id, db)
    return ws


@router.post("/entries/{entry_id}", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def start_session(
    goal_id: uuid.UUID,
    entry_id: uuid.UUID,
    payload: SessionStartRequest,
    session: AsyncSession = Depends(get_session),
):
    await _get_entry(goal_id, entry_id, session)
    ws = WorkoutSession(plan_entry_id=entry_id, performed_at=payload.performed_at or date.today())
    session.add(ws)
    await session.commit()
    result = await session.execute(
        select(WorkoutSession)
        .options(selectinload(WorkoutSession.set_logs))
        .where(WorkoutSession.id == ws.id)
    )
    return result.scalar_one()


@router.get("/entries/{entry_id}/previous", response_model=PreviousPerformance | None)
async def previous_performance(
    goal_id: uuid.UUID,
    entry_id: uuid.UUID,
    exercise_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    await _get_entry(goal_id, entry_id, session)
    result = await session.execute(
        select(WorkoutSession)
        .options(selectinload(WorkoutSession.set_logs))
        .where(WorkoutSession.plan_entry_id == entry_id)
        .order_by(WorkoutSession.performed_at.desc())
    )
    for ws in result.scalars():
        sets = [sl for sl in ws.set_logs if sl.exercise_id == exercise_id]
        if not sets:
            continue
        return PreviousPerformance(
            exercise_id=exercise_id,
            performed_at=ws.performed_at,
            sets=[
                PreviousSet(set_number=sl.set_number, weight=sl.weight, reps=sl.reps, rir=sl.rir)
                for sl in sorted(sets, key=lambda s: s.set_number)
            ],
        )
    return None


@router.post("/{session_id}/sets", response_model=SessionResponse)
async def log_sets(
    goal_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: LogSetRequest,
    session: AsyncSession = Depends(get_session),
):
    ws = await _get_session(goal_id, session_id, session)
    exercise_ids = {s.exercise_id for s in payload.sets}
    result = await session.execute(select(Exercise).where(Exercise.id.in_(exercise_ids)))
    exercises = {e.id: e for e in result.scalars()}

    for item in payload.sets:
        ex = exercises.get(item.exercise_id)
        if not ex or ex.plan_entry_id != ws.plan_entry_id:
            raise HTTPException(status_code=422, detail="Exercise does not belong to this session's plan entry")
        if item.weight is None and item.reps is None and item.rir is None:
            continue  # nothing recorded for this set
        await _upsert_set(session, ws.id, SetLogWrite(**item.model_dump()))
        ex.completed = True

    if payload.sets:
        await session.commit()
    fresh = await session.execute(
        select(WorkoutSession)
        .options(selectinload(WorkoutSession.set_logs))
        .where(WorkoutSession.id == ws.id)
        .execution_options(populate_existing=True)
    )
    return fresh.scalar_one()


async def _upsert_set(db: AsyncSession, session_id: uuid.UUID, item: SetLogWrite) -> SetLog:
    result = await db.execute(
        select(SetLog).where(
            SetLog.session_id == session_id,
            SetLog.exercise_id == item.exercise_id,
            SetLog.set_number == item.set_number,
        )
    )
    sl = result.scalar_one_or_none()
    if sl is None:
        sl = SetLog(
            session_id=session_id,
            exercise_id=item.exercise_id,
            set_number=item.set_number,
        )
        db.add(sl)
    sl.weight = item.weight
    sl.reps = item.reps
    sl.rir = item.rir
    sl.completed = item.completed
    return sl


@router.post("/{session_id}/complete", response_model=SessionResponse)
async def complete_session(
    goal_id: uuid.UUID,
    session_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    ws = await _get_session(goal_id, session_id, session)
    ws.status = "completed"
    entry = await session.get(PlanEntry, ws.plan_entry_id)
    if entry:
        entry.completed = True
    await session.commit()
    return await _get_session(goal_id, session_id, session)
