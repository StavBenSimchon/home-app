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
    exercise_log_id: uuid.UUID | None = None
    exercise_id: uuid.UUID | None
    set_number: int
    weight: float | None
    reps: int | None
    rir: int | None
    completed: bool
    created_at: datetime
    updated_at: datetime


class WorkoutExerciseLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID
    source_exercise_id: uuid.UUID | None
    exercise_name: str
    performed_at: date
    order_index: int
    target_sets: int | None
    target_reps: int | None
    target_reps_max: int | None
    target_weight: float | None
    target_rir: int | None
    completed_at: datetime | None
    set_logs: list[SetLogResponse] = []


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    goal_id: uuid.UUID
    plan_entry_id: uuid.UUID | None
    activity_name: str
    performed_at: date
    duration_minutes: int | None
    status: str
    created_at: datetime
    updated_at: datetime
    set_logs: list[SetLogResponse] = []
    exercise_logs: list[WorkoutExerciseLogResponse] = []


class SessionStartRequest(BaseModel):
    performed_at: date | None = None


class LogSetRequest(BaseModel):
    sets: list[SetLogWrite]


class FinishExerciseRequest(BaseModel):
    sets: list[SetLogWrite] = []
    performed_at: date | None = None


class PreviousSet(BaseModel):
    set_number: int
    weight: float | None
    reps: int | None
    rir: int | None


class PreviousPerformance(BaseModel):
    exercise_id: uuid.UUID
    performed_at: date
    sets: list[PreviousSet]


class LoggedSet(BaseModel):
    set_number: int
    weight: float | None
    reps: int | None
    rir: int | None
    failure: bool


class ExerciseLogItem(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    source_exercise_id: uuid.UUID | None
    exercise_name: str
    activity: str
    performed_at: date
    sets: list[LoggedSet]
    top_weight: float | None
    total_reps: int
    failure_sets: list[int]


class EditableLoggedSet(BaseModel):
    set_number: int
    weight: float | None = None
    reps: int | None = None
    rir: int | None = None


class ExerciseLogUpdate(BaseModel):
    performed_at: date | None = None
    exercise_name: str | None = None
    sets: list[EditableLoggedSet] | None = None
