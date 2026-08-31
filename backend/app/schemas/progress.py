import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class InsightResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    goal_id: uuid.UUID
    kind: str
    severity: str
    title: str
    body: str
    action: dict | None
    status: str
    created_at: datetime


class CoachMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str
    text: str
    created_at: datetime


class ExercisePoint(BaseModel):
    date: date
    top_weight: float | None
    top_reps: int | None
    best_rir: int | None
    set_count: int


class ExerciseTrend(BaseModel):
    exercise_name: str
    points: list[ExercisePoint]


class ConsistencyStats(BaseModel):
    planned: int
    completed: int
    completion_rate: float
    current_streak: int
    weekly: list[dict]


class ProgressResponse(BaseModel):
    consistency: ConsistencyStats
    trends: list[ExerciseTrend]
