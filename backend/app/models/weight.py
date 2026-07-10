import uuid
from datetime import date, datetime

from sqlalchemy import DateTime, Date, Float, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WeightEntry(Base):
    __tablename__ = "weight_entries"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    weight_kg: Mapped[float] = mapped_column(Float, nullable=False)
    fat_percentage: Mapped[float | None] = mapped_column(Float)
    muscle_percentage: Mapped[float | None] = mapped_column(Float)
    measured_at: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
