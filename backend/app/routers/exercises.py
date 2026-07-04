import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.plan import PlanEntry
from app.models.exercise import Exercise
from app.schemas.exercise import ExerciseCreate, ExerciseResponse, ExerciseUpdate

router = APIRouter(prefix="/goals/{goal_id}/plans/{entry_id}/exercises", tags=["exercises"])


async def _get_entry(goal_id: uuid.UUID, entry_id: uuid.UUID, session: AsyncSession):
    entry = await session.get(PlanEntry, entry_id)
    if not entry or entry.goal_id != goal_id:
        raise HTTPException(status_code=404, detail="Plan entry not found")
    return entry


@router.get("/", response_model=list[ExerciseResponse])
async def list_exercises(
    goal_id: uuid.UUID, entry_id: uuid.UUID, session: AsyncSession = Depends(get_session)
):
    await _get_entry(goal_id, entry_id, session)
    result = await session.execute(
        select(Exercise)
        .where(Exercise.plan_entry_id == entry_id)
        .order_by(Exercise.order_index)
    )
    return result.scalars().all()


@router.post("/", response_model=ExerciseResponse, status_code=status.HTTP_201_CREATED)
async def create_exercise(
    goal_id: uuid.UUID,
    entry_id: uuid.UUID,
    payload: ExerciseCreate,
    session: AsyncSession = Depends(get_session),
):
    await _get_entry(goal_id, entry_id, session)
    if payload.plan_entry_id != entry_id:
        raise HTTPException(status_code=422, detail="plan_entry_id mismatch")
    ex = Exercise(**payload.model_dump())
    session.add(ex)
    await session.commit()
    await session.refresh(ex)
    return ex


@router.patch("/{exercise_id}", response_model=ExerciseResponse)
async def update_exercise(
    goal_id: uuid.UUID,
    entry_id: uuid.UUID,
    exercise_id: uuid.UUID,
    payload: ExerciseUpdate,
    session: AsyncSession = Depends(get_session),
):
    await _get_entry(goal_id, entry_id, session)
    ex = await session.get(Exercise, exercise_id)
    if not ex or ex.plan_entry_id != entry_id:
        raise HTTPException(status_code=404, detail="Exercise not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(ex, field, value)
    await session.commit()
    await session.refresh(ex)
    return ex


@router.delete("/{exercise_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_exercise(
    goal_id: uuid.UUID,
    entry_id: uuid.UUID,
    exercise_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    await _get_entry(goal_id, entry_id, session)
    ex = await session.get(Exercise, exercise_id)
    if not ex or ex.plan_entry_id != entry_id:
        raise HTTPException(status_code=404, detail="Exercise not found")
    await session.delete(ex)
    await session.commit()
