import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class PlanEntryBase(BaseModel):
    goal_id: uuid.UUID
    week_number: int
    day_of_week: int | None = None
    activity: str
    duration_minutes: int | None = None
    notes: str | None = None
    frequency_hint: str | None = None


class PlanEntryCreate(PlanEntryBase):
    pass


class PlanEntryUpdate(BaseModel):
    week_number: int | None = None
    day_of_week: int | None = None
    activity: str | None = None
    duration_minutes: int | None = None
    notes: str | None = None
    frequency_hint: str | None = None
    completed: bool | None = None


class PlanEntryResponse(PlanEntryBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    completed: bool
    created_at: datetime
