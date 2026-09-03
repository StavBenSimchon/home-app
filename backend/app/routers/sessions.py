import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models.exercise import Exercise
from app.models.plan import PlanEntry
from app.models.session import SetLog, WorkoutExerciseLog, WorkoutSession
from app.schemas.session import (
    EditableLoggedSet,
    ExerciseLogItem,
    ExerciseLogUpdate,
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
        .options(
            selectinload(WorkoutSession.set_logs),
            selectinload(WorkoutSession.exercise_logs).selectinload(WorkoutExerciseLog.set_logs),
        )
        .where(WorkoutSession.id == session_id)
        .execution_options(populate_existing=True)
    )
    ws = result.scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=404, detail="Session not found")
    return ws


async def _get_session(goal_id: uuid.UUID, session_id: uuid.UUID, db: AsyncSession) -> WorkoutSession:
    ws = await _load_session(db, session_id)
    if ws.goal_id != goal_id:
        raise HTTPException(status_code=404, detail="Session not found")
    return ws


async def _get_exercise_log(
    goal_id: uuid.UUID,
    exercise_log_id: uuid.UUID,
    session: AsyncSession,
) -> WorkoutExerciseLog:
    result = await session.execute(
        select(WorkoutExerciseLog)
        .options(
            selectinload(WorkoutExerciseLog.set_logs),
            selectinload(WorkoutExerciseLog.session),
        )
        .join(WorkoutSession, WorkoutExerciseLog.session_id == WorkoutSession.id)
        .where(WorkoutExerciseLog.id == exercise_log_id, WorkoutSession.goal_id == goal_id)
        .execution_options(populate_existing=True)
    )
    log = result.scalar_one_or_none()
    if not log:
        raise HTTPException(status_code=404, detail="Exercise log not found")
    return log


def _log_response(log: WorkoutExerciseLog) -> ExerciseLogItem:
    sets = [
        LoggedSet(
            set_number=sl.set_number,
            weight=sl.weight,
            reps=sl.reps,
            rir=sl.rir,
            failure=sl.rir == 0,
        )
        for sl in sorted(log.set_logs, key=lambda item: item.set_number)
    ]
    weights = [item.weight for item in sets if item.weight is not None]
    return ExerciseLogItem(
        id=log.id,
        session_id=log.session_id,
        source_exercise_id=log.source_exercise_id,
        exercise_name=log.exercise_name,
        activity=log.session.activity_name,
        performed_at=log.performed_at,
        sets=sets,
        top_weight=max(weights) if weights else None,
        total_reps=sum(item.reps or 0 for item in sets),
        failure_sets=[item.set_number for item in sets if item.failure],
    )


@router.get("/log", response_model=list[ExerciseLogItem])
async def exercise_log(
    goal_id: uuid.UUID,
    limit: int = 100,
    session: AsyncSession = Depends(get_session),
):
    """Finished exercise snapshots. Mutable plan rows are not involved."""
    result = await session.execute(
        select(WorkoutExerciseLog)
        .options(
            selectinload(WorkoutExerciseLog.set_logs),
            selectinload(WorkoutExerciseLog.session),
        )
        .join(WorkoutSession, WorkoutExerciseLog.session_id == WorkoutSession.id)
        .where(
            WorkoutSession.goal_id == goal_id,
            WorkoutExerciseLog.completed_at.is_not(None),
        )
        .order_by(WorkoutExerciseLog.performed_at.desc(), WorkoutExerciseLog.exercise_name)
        .limit(limit)
    )
    return [_log_response(item) for item in result.scalars()]


@router.patch("/log/{exercise_log_id}", response_model=ExerciseLogItem)
async def update_exercise_log(
    goal_id: uuid.UUID,
    exercise_log_id: uuid.UUID,
    payload: ExerciseLogUpdate,
    session: AsyncSession = Depends(get_session),
):
    """Edit a history snapshot explicitly from the Workout tab."""
    log = await _get_exercise_log(goal_id, exercise_log_id, session)
    if payload.performed_at is not None:
        log.performed_at = payload.performed_at
    if payload.exercise_name is not None:
        name = payload.exercise_name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Exercise name cannot be empty")
        log.exercise_name = name
    if payload.sets is not None:
        await session.execute(delete(SetLog).where(SetLog.exercise_log_id == log.id))
        await session.flush()
        seen: set[int] = set()
        for item in sorted(payload.sets, key=lambda row: row.set_number):
            if item.set_number in seen:
                raise HTTPException(status_code=422, detail="Set numbers must be unique")
            seen.add(item.set_number)
            session.add(SetLog(
                session_id=log.session_id,
                exercise_log_id=log.id,
                exercise_id=log.source_exercise_id,
                set_number=item.set_number,
                weight=item.weight,
                reps=item.reps,
                rir=item.rir,
            ))
    await session.commit()
    updated = await _get_exercise_log(goal_id, exercise_log_id, session)
    return _log_response(updated)


@router.delete("/log/{exercise_log_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_exercise_log(
    goal_id: uuid.UUID,
    exercise_log_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    """The only API that deletes a finished exercise and its set history."""
    log = await _get_exercise_log(goal_id, exercise_log_id, session)
    await session.delete(log)
    await session.commit()


@router.post("/entries/{entry_id}", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def open_session(
    goal_id: uuid.UUID,
    entry_id: uuid.UUID,
    payload: SessionStartRequest,
    session: AsyncSession = Depends(get_session),
):
    entry = await _get_entry(goal_id, entry_id, session)
    performed_at = payload.performed_at or date.today()
    existing = await session.execute(
        select(WorkoutSession)
        .options(
            selectinload(WorkoutSession.set_logs),
            selectinload(WorkoutSession.exercise_logs).selectinload(WorkoutExerciseLog.set_logs),
        )
        .where(
            WorkoutSession.goal_id == goal_id,
            WorkoutSession.plan_entry_id == entry_id,
            WorkoutSession.performed_at == performed_at,
        )
        .order_by(WorkoutSession.created_at)
    )
    ws = existing.scalars().first()
    if ws:
        return ws

    ws = WorkoutSession(
        goal_id=goal_id,
        plan_entry_id=entry_id,
        activity_name=entry.activity,
        performed_at=performed_at,
    )
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
    exercise = await session.get(Exercise, exercise_id)
    if not exercise or exercise.plan_entry_id != entry_id:
        raise HTTPException(status_code=404, detail="Exercise not found")
    query = (
        select(WorkoutExerciseLog)
        .options(selectinload(WorkoutExerciseLog.set_logs))
        .join(WorkoutSession, WorkoutExerciseLog.session_id == WorkoutSession.id)
        .where(
            WorkoutSession.goal_id == goal_id,
            func.lower(WorkoutExerciseLog.exercise_name) == exercise.name.lower(),
            WorkoutExerciseLog.completed_at.is_not(None),
        )
        .order_by(WorkoutExerciseLog.performed_at.desc())
    )
    if before:
        query = query.where(WorkoutExerciseLog.performed_at < before)
    log = (await session.execute(query)).scalars().first()
    if not log:
        return None
    return PreviousPerformance(
        exercise_id=exercise_id,
        performed_at=log.performed_at,
        sets=[
            PreviousSet(set_number=sl.set_number, weight=sl.weight, reps=sl.reps, rir=sl.rir)
            for sl in sorted(log.set_logs, key=lambda item: item.set_number)
        ],
    )


async def _get_or_create_exercise_log(
    session: AsyncSession,
    ws: WorkoutSession,
    exercise: Exercise,
) -> WorkoutExerciseLog:
    result = await session.execute(
        select(WorkoutExerciseLog).where(
            WorkoutExerciseLog.session_id == ws.id,
            WorkoutExerciseLog.source_exercise_id == exercise.id,
        )
    )
    log = result.scalar_one_or_none()
    if log:
        return log
    log = WorkoutExerciseLog(
        session_id=ws.id,
        source_exercise_id=exercise.id,
        exercise_name=exercise.name,
        performed_at=ws.performed_at,
        order_index=exercise.order_index,
        target_sets=exercise.sets,
        target_reps=exercise.reps,
        target_reps_max=exercise.reps_max,
        target_weight=exercise.weight,
        target_rir=exercise.rir_target,
    )
    session.add(log)
    await session.flush()
    return log


async def _upsert_set(
    db: AsyncSession,
    ws: WorkoutSession,
    exercise_log: WorkoutExerciseLog,
    item: SetLogWrite,
) -> SetLog:
    result = await db.execute(
        select(SetLog).where(
            SetLog.exercise_log_id == exercise_log.id,
            SetLog.set_number == item.set_number,
        )
    )
    sl = result.scalar_one_or_none()
    if sl is None:
        sl = SetLog(
            session_id=ws.id,
            exercise_log_id=exercise_log.id,
            exercise_id=exercise_log.source_exercise_id,
            set_number=item.set_number,
        )
        db.add(sl)
    sl.weight = item.weight
    sl.reps = item.reps
    sl.rir = item.rir
    sl.completed = item.completed
    return sl


async def _write_sets(session: AsyncSession, ws: WorkoutSession, sets: list[SetLogWrite]) -> int:
    exercise_ids = {item.exercise_id for item in sets}
    if not exercise_ids:
        return 0
    result = await session.execute(select(Exercise).where(Exercise.id.in_(exercise_ids)))
    exercises = {exercise.id: exercise for exercise in result.scalars()}
    exercise_logs: dict[uuid.UUID, WorkoutExerciseLog] = {}
    written = 0
    for item in sets:
        exercise = exercises.get(item.exercise_id)
        if not exercise or exercise.plan_entry_id != ws.plan_entry_id:
            raise HTTPException(status_code=422, detail="Exercise does not belong to this session's plan entry")
        if item.weight is None and item.reps is None and item.rir is None:
            continue
        exercise_log = exercise_logs.get(exercise.id)
        if not exercise_log:
            exercise_log = await _get_or_create_exercise_log(session, ws, exercise)
            exercise_logs[exercise.id] = exercise_log
        await _upsert_set(session, ws, exercise_log, item)
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
    ws = await _get_session(goal_id, session_id, session)
    exercise = await session.get(Exercise, exercise_id)
    if not exercise or exercise.plan_entry_id != ws.plan_entry_id:
        raise HTTPException(status_code=404, detail="Exercise not found in this workout")
    sets = [item for item in payload.sets if item.exercise_id == exercise_id]
    await _write_sets(session, ws, sets)
    log = await _get_or_create_exercise_log(session, ws, exercise)
    log.completed_at = datetime.now(timezone.utc)
    exercise.completed = True
    await session.commit()
    return await _load_session(session, ws.id)


@router.post("/{session_id}/exercises/{exercise_id}/unfinish", response_model=SessionResponse)
async def unfinish_exercise(
    goal_id: uuid.UUID,
    session_id: uuid.UUID,
    exercise_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    await _get_session(goal_id, session_id, session)
    raise HTTPException(
        status_code=409,
        detail="Finished exercise history is immutable here. Edit or delete it explicitly in the Workout tab.",
    )


@router.post("/{session_id}/complete", response_model=SessionResponse)
async def complete_session(
    goal_id: uuid.UUID,
    session_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    ws = await _get_session(goal_id, session_id, session)
    ws.status = "completed"
    if ws.plan_entry_id:
        entry = await session.get(PlanEntry, ws.plan_entry_id)
        if entry:
            entry.completed = True
    await session.commit()
    return await _load_session(session, ws.id)
