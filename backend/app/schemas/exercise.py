import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ExerciseBase(BaseModel):
    plan_entry_id: uuid.UUID
    name: str
    sets: int | None = None
    reps: int | None = None
    weight: float | None = None
    duration_seconds: int | None = None
    order_index: int = 0
    notes: str | None = None


class ExerciseCreate(ExerciseBase):
    pass


class ExerciseUpdate(BaseModel):
    name: str | None = None
    sets: int | None = None
    reps: int | None = None
    weight: float | None = None
    duration_seconds: int | None = None
    order_index: int | None = None
    completed: bool | None = None
    notes: str | None = None


class ExerciseResponse(ExerciseBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    completed: bool
    created_at: datetime
