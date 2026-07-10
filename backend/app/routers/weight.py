import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.weight import WeightEntry
from app.schemas.weight import WeightCreate, WeightResponse, WeightUpdate

router = APIRouter(prefix="/weight", tags=["weight"])


@router.get("/", response_model=list[WeightResponse])
async def list_weight(session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(WeightEntry).order_by(WeightEntry.measured_at)
    )
    return result.scalars().all()


@router.post("/", response_model=WeightResponse, status_code=status.HTTP_201_CREATED)
async def create_weight(
    payload: WeightCreate, session: AsyncSession = Depends(get_session)
):
    data = payload.model_dump()
    if data.get("measured_at") is None:
        data["measured_at"] = date.today()
    entry = WeightEntry(**data)
    session.add(entry)
    await session.commit()
    await session.refresh(entry)
    return entry


@router.patch("/{entry_id}", response_model=WeightResponse)
async def update_weight(
    entry_id: uuid.UUID,
    payload: WeightUpdate,
    session: AsyncSession = Depends(get_session),
):
    entry = await session.get(WeightEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    await session.commit()
    await session.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_weight(
    entry_id: uuid.UUID, session: AsyncSession = Depends(get_session)
):
    entry = await session.get(WeightEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    await session.delete(entry)
    await session.commit()
