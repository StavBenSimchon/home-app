import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class WeightCreate(BaseModel):
    weight_kg: float
    fat_percentage: float | None = None
    muscle_percentage: float | None = None
    measured_at: date | None = None


class WeightResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    weight_kg: float
    fat_percentage: float | None
    muscle_percentage: float | None
    measured_at: date
    created_at: datetime
