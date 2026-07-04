import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.plan import PlanEntry
from app.schemas.plan import PlanEntryCreate, PlanEntryResponse, PlanEntryUpdate

router = APIRouter(prefix="/goals/{goal_id}/plans", tags=["plans"])


@router.get("/", response_model=list[PlanEntryResponse])
async def list_plan_entries(
    goal_id: uuid.UUID, session: AsyncSession = Depends(get_session)
):
    result = await session.execute(
        select(PlanEntry)
        .where(PlanEntry.goal_id == goal_id)
        .order_by(PlanEntry.week_number, PlanEntry.day_of_week)
    )
    return result.scalars().all()


@router.post("/", response_model=PlanEntryResponse, status_code=status.HTTP_201_CREATED)
async def create_plan_entry(
    goal_id: uuid.UUID,
    payload: PlanEntryCreate,
    session: AsyncSession = Depends(get_session),
):
    if payload.goal_id != goal_id:
        raise HTTPException(status_code=422, detail="goal_id mismatch")
    entry = PlanEntry(**payload.model_dump())
    session.add(entry)
    await session.commit()
    await session.refresh(entry)
    return entry


@router.get("/{entry_id}", response_model=PlanEntryResponse)
async def get_plan_entry(
    goal_id: uuid.UUID,
    entry_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    entry = await session.get(PlanEntry, entry_id)
    if not entry or entry.goal_id != goal_id:
        raise HTTPException(status_code=404, detail="Plan entry not found")
    return entry


@router.patch("/{entry_id}", response_model=PlanEntryResponse)
async def update_plan_entry(
    goal_id: uuid.UUID,
    entry_id: uuid.UUID,
    payload: PlanEntryUpdate,
    session: AsyncSession = Depends(get_session),
):
    entry = await session.get(PlanEntry, entry_id)
    if not entry or entry.goal_id != goal_id:
        raise HTTPException(status_code=404, detail="Plan entry not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    await session.commit()
    await session.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan_entry(
    goal_id: uuid.UUID,
    entry_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    entry = await session.get(PlanEntry, entry_id)
    if not entry or entry.goal_id != goal_id:
        raise HTTPException(status_code=404, detail="Plan entry not found")
    await session.delete(entry)
    await session.commit()
