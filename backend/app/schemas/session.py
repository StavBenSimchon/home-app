import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class SetLogWrite(BaseModel):
    exercise_id: uuid.UUID
    set_number: int
    weight: float | None = None
    reps: int | None = None
    rir: int | None = None
    completed: bool = True


class SetLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID
    exercise_id: uuid.UUID
    set_number: int
    weight: float | None
    reps: int | None
    rir: int | None
    completed: bool
    created_at: datetime
    updated_at: datetime


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    plan_entry_id: uuid.UUID
    performed_at: date
    duration_minutes: int | None
    status: str
    created_at: datetime
    updated_at: datetime
    set_logs: list[SetLogResponse] = []


class SessionStartRequest(BaseModel):
    performed_at: date | None = None


class LogSetRequest(BaseModel):
    sets: list[SetLogWrite]


class PreviousSet(BaseModel):
    set_number: int
    weight: float | None
    reps: int | None
    rir: int | None


class PreviousPerformance(BaseModel):
    exercise_id: uuid.UUID
    performed_at: date
    sets: list[PreviousSet]
