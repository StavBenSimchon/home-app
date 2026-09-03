import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.types import GUID


class WorkoutSession(Base):
    __tablename__ = "workout_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID, primary_key=True, default=uuid.uuid4
    )
    goal_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("goals.id", ondelete="CASCADE"), nullable=False
    )
    plan_entry_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID, ForeignKey("plan_entries.id", ondelete="SET NULL")
    )
    activity_name: Mapped[str] = mapped_column(String(255), nullable=False)
    performed_at: Mapped[date] = mapped_column(Date, nullable=False)
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="in_progress")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    set_logs: Mapped[list["SetLog"]] = relationship(
        back_populates="session", cascade="all, delete-orphan",
        order_by="SetLog.created_at"
    )
    exercise_logs: Mapped[list["WorkoutExerciseLog"]] = relationship(
        back_populates="session", cascade="all, delete-orphan",
        order_by="WorkoutExerciseLog.order_index"
    )


class WorkoutExerciseLog(Base):
    """Immutable exercise identity/prescription snapshot for workout history."""
    __tablename__ = "workout_exercise_logs"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("workout_sessions.id", ondelete="CASCADE"), nullable=False
    )
    source_exercise_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID, ForeignKey("exercises.id", ondelete="SET NULL")
    )
    exercise_name: Mapped[str] = mapped_column(String(255), nullable=False)
    performed_at: Mapped[date] = mapped_column(Date, nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    target_sets: Mapped[int | None] = mapped_column(Integer)
    target_reps: Mapped[int | None] = mapped_column(Integer)
    target_reps_max: Mapped[int | None] = mapped_column(Integer)
    target_weight: Mapped[float | None] = mapped_column(Float)
    target_rir: Mapped[int | None] = mapped_column(Integer)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    session: Mapped["WorkoutSession"] = relationship(back_populates="exercise_logs")
    set_logs: Mapped[list["SetLog"]] = relationship(
        back_populates="exercise_log", cascade="all, delete-orphan",
        order_by="SetLog.set_number"
    )


class SetLog(Base):
    __tablename__ = "set_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID, primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("workout_sessions.id", ondelete="CASCADE"), nullable=False
    )
    exercise_log_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID, ForeignKey("workout_exercise_logs.id", ondelete="CASCADE")
    )
    exercise_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID, ForeignKey("exercises.id", ondelete="SET NULL")
    )
    set_number: Mapped[int] = mapped_column(Integer, nullable=False)
    weight: Mapped[float | None] = mapped_column(Float)
    reps: Mapped[int | None] = mapped_column(Integer)
    rir: Mapped[int | None] = mapped_column(Integer)
    completed: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    session: Mapped["WorkoutSession"] = relationship(back_populates="set_logs")
    exercise_log: Mapped["WorkoutExerciseLog | None"] = relationship(back_populates="set_logs")
