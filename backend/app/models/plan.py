import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PlanEntry(Base):
    __tablename__ = "plan_entries"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    goal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("goals.id", ondelete="CASCADE"), nullable=False
    )
    week_number: Mapped[int] = mapped_column(Integer, nullable=False)
    day_of_week: Mapped[int | None] = mapped_column(Integer)
    activity: Mapped[str] = mapped_column(String(255), nullable=False)
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    frequency_hint: Mapped[str | None] = mapped_column(String(100))
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    goal: Mapped["Goal"] = relationship(back_populates="plan_entries")
    exercises: Mapped[list["Exercise"]] = relationship(
        back_populates="plan_entry", cascade="all, delete-orphan",
        order_by="Exercise.order_index"
    )
