import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models.exercise import Exercise
from app.models.plan import PlanEntry
from app.models.session import SetLog, WorkoutSession
from app.schemas.session import (
    ExerciseLogItem,
    FinishExerciseRequest,
    LoggedSet,
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


async def _load_session(db: AsyncSession, session_id: uuid.UUID) -> WorkoutSession:
    result = await db.execute(
        select(WorkoutSession)
        .options(selectinload(WorkoutSession.set_logs))
        .where(WorkoutSession.id == session_id)
        .execution_options(populate_existing=True)
    )
    ws = result.scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=404, detail="Session not found")
    return ws


async def _get_session(goal_id: uuid.UUID, session_id: uuid.UUID, db: AsyncSession) -> WorkoutSession:
    ws = await _load_session(db, session_id)
    await _get_entry(goal_id, ws.plan_entry_id, db)  # ownership check
    return ws


@router.get("/log", response_model=list[ExerciseLogItem])
async def exercise_log(
    goal_id: uuid.UUID,
    limit: int = 100,
    session: AsyncSession = Depends(get_session),
):
    """Feed of logged (finished) exercises — the Workout tab's history."""
    result = await session.execute(
        select(WorkoutSession, SetLog, Exercise, PlanEntry)
        .join(SetLog, SetLog.session_id == WorkoutSession.id)
        .join(Exercise, Exercise.id == SetLog.exercise_id)
        .join(PlanEntry, PlanEntry.id == WorkoutSession.plan_entry_id)
        .where(PlanEntry.goal_id == goal_id)
        .order_by(WorkoutSession.performed_at.desc(), Exercise.order_index, SetLog.set_number)
    )

    grouped: dict[tuple[uuid.UUID, uuid.UUID], dict] = {}
    for ws, sl, ex, entry in result.all():
        key = (ws.id, ex.id)
        item = grouped.setdefault(key, {
            "session_id": ws.id,
            "exercise_id": ex.id,
            "exercise_name": ex.name,
            "activity": entry.activity,
            "performed_at": ws.performed_at,
            "sets": [],
        })
        item["sets"].append(LoggedSet(
            set_number=sl.set_number,
            weight=sl.weight,
            reps=sl.reps,
            rir=sl.rir,
            failure=sl.rir == 0,
        ))

    items: list[ExerciseLogItem] = []
    for data in grouped.values():
        sets = sorted(data["sets"], key=lambda s: s.set_number)
        weights = [s.weight for s in sets if s.weight is not None]
        items.append(ExerciseLogItem(
            **{**data, "sets": sets},
            top_weight=max(weights) if weights else None,
            total_reps=sum(s.reps or 0 for s in sets),
            failure_sets=[s.set_number for s in sets if s.failure],
        ))

    items.sort(key=lambda i: (i.performed_at, i.exercise_name), reverse=True)
    return items[:limit]


@router.post("/entries/{entry_id}", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def open_session(
    goal_id: uuid.UUID,
    entry_id: uuid.UUID,
    payload: SessionStartRequest,
    session: AsyncSession = Depends(get_session),
):
    """Open (or reuse) the session for this plan entry on the given day."""
    await _get_entry(goal_id, entry_id, session)
    performed_at = payload.performed_at or date.today()

    existing = await session.execute(
        select(WorkoutSession)
        .options(selectinload(WorkoutSession.set_logs))
        .where(WorkoutSession.plan_entry_id == entry_id, WorkoutSession.performed_at == performed_at)
        .order_by(WorkoutSession.created_at)
    )
    ws = existing.scalars().first()
    if ws:
        return ws

    ws = WorkoutSession(plan_entry_id=entry_id, performed_at=performed_at)
    session.add(ws)
    await session.commit()
    return await _load_session(session, ws.id)


@router.get("/entries/{entry_id}/previous", response_model=PreviousPerformance | None)
async def previous_performance(
    goal_id: uuid.UUID,
    entry_id: uuid.UUID,
    exercise_id: uuid.UUID,
    before: date | None = None,
    session: AsyncSession = Depends(get_session),
):
    await _get_entry(goal_id, entry_id, session)
    query = (
        select(WorkoutSession)
        .options(selectinload(WorkoutSession.set_logs))
        .join(PlanEntry, PlanEntry.id == WorkoutSession.plan_entry_id)
        .where(PlanEntry.goal_id == goal_id)
        .order_by(WorkoutSession.performed_at.desc())
    )
    if before:
        query = query.where(WorkoutSession.performed_at < before)
    result = await session.execute(query)
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
        sl = SetLog(session_id=session_id, exercise_id=item.exercise_id, set_number=item.set_number)
        db.add(sl)
    sl.weight = item.weight
    sl.reps = item.reps
    sl.rir = item.rir
    sl.completed = item.completed
    return sl


async def _write_sets(session: AsyncSession, ws: WorkoutSession, sets: list[SetLogWrite]) -> int:
    exercise_ids = {s.exercise_id for s in sets}
    if not exercise_ids:
        return 0
    result = await session.execute(select(Exercise).where(Exercise.id.in_(exercise_ids)))
    exercises = {e.id: e for e in result.scalars()}

    written = 0
    for item in sets:
        ex = exercises.get(item.exercise_id)
        if not ex or ex.plan_entry_id != ws.plan_entry_id:
            raise HTTPException(status_code=422, detail="Exercise does not belong to this session's plan entry")
        if item.weight is None and item.reps is None and item.rir is None:
            continue
        await _upsert_set(session, ws.id, item)
        written += 1
    return written


@router.post("/{session_id}/sets", response_model=SessionResponse)
async def log_sets(
    goal_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: LogSetRequest,
    session: AsyncSession = Depends(get_session),
):
    ws = await _get_session(goal_id, session_id, session)
    if await _write_sets(session, ws, payload.sets):
        await session.commit()
    return await _load_session(session, ws.id)


@router.post("/{session_id}/exercises/{exercise_id}/finish", response_model=SessionResponse)
async def finish_exercise(
    goal_id: uuid.UUID,
    session_id: uuid.UUID,
    exercise_id: uuid.UUID,
    payload: FinishExerciseRequest,
    session: AsyncSession = Depends(get_session),
):
    """Log the entered sets for one exercise and mark it done."""
    ws = await _get_session(goal_id, session_id, session)
    ex = await session.get(Exercise, exercise_id)
    if not ex or ex.plan_entry_id != ws.plan_entry_id:
        raise HTTPException(status_code=404, detail="Exercise not found in this workout")

    sets = [s for s in payload.sets if s.exercise_id == exercise_id]
    await _write_sets(session, ws, sets)
    ex.completed = True
    await session.commit()
    return await _load_session(session, ws.id)


@router.post("/{session_id}/exercises/{exercise_id}/unfinish", response_model=SessionResponse)
async def unfinish_exercise(
    goal_id: uuid.UUID,
    session_id: uuid.UUID,
    exercise_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    """Undo: drop this exercise's logged sets for the session so the log stays truthful."""
    ws = await _get_session(goal_id, session_id, session)
    ex = await session.get(Exercise, exercise_id)
    if not ex or ex.plan_entry_id != ws.plan_entry_id:
        raise HTTPException(status_code=404, detail="Exercise not found in this workout")

    await session.execute(
        delete(SetLog).where(SetLog.session_id == ws.id, SetLog.exercise_id == exercise_id)
    )
    ex.completed = False
    await session.commit()
    return await _load_session(session, ws.id)


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
    return await _load_session(session, ws.id)
