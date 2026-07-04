import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class GoalBase(BaseModel):
    title: str
    description: str | None = None
    metric_name: str | None = None
    current_value: float | None = None
    target_value: float | None = None
    unit: str | None = None
    start_date: date | None = None
    target_date: date | None = None


class GoalCreate(GoalBase):
    pass


class GoalUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    metric_name: str | None = None
    current_value: float | None = None
    target_value: float | None = None
    unit: str | None = None
    start_date: date | None = None
    target_date: date | None = None


class GoalResponse(GoalBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    ai_response: dict | None = None
