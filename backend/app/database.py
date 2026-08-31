import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

engine = create_async_engine(settings.database_url, echo=False)
async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_session() -> AsyncSession:
    async with async_session_factory() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    async with engine.begin() as conn:
        import app.models  # noqa: F401

        await conn.run_sync(Base.metadata.create_all)

        await conn.execute(text("ALTER TABLE plan_entries ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT FALSE"))
        await conn.execute(text("ALTER TABLE goals ADD COLUMN IF NOT EXISTS ai_response JSONB"))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS exercises (
                id UUID PRIMARY KEY,
                plan_entry_id UUID NOT NULL REFERENCES plan_entries(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                sets INTEGER,
                reps INTEGER,
                weight FLOAT,
                duration_seconds INTEGER,
                order_index INTEGER NOT NULL DEFAULT 0,
                completed BOOLEAN NOT NULL DEFAULT FALSE,
                notes TEXT,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS weight_entries (
                id UUID PRIMARY KEY,
                weight_kg FLOAT NOT NULL,
                fat_percentage FLOAT,
                muscle_percentage FLOAT,
                measured_at DATE NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text("ALTER TABLE exercises ADD COLUMN IF NOT EXISTS reps_max INTEGER"))
        await conn.execute(text("ALTER TABLE exercises ADD COLUMN IF NOT EXISTS rir_target INTEGER"))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS workout_sessions (
                id UUID PRIMARY KEY,
                plan_entry_id UUID NOT NULL REFERENCES plan_entries(id) ON DELETE CASCADE,
                performed_at DATE NOT NULL,
                duration_minutes INTEGER,
                status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS set_logs (
                id UUID PRIMARY KEY,
                session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
                exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
                set_number INTEGER NOT NULL,
                weight FLOAT,
                reps INTEGER,
                rir INTEGER,
                completed BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS coach_messages (
                id UUID PRIMARY KEY,
                goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
                role VARCHAR(20) NOT NULL,
                text TEXT NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ai_insights (
                id UUID PRIMARY KEY,
                goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
                kind VARCHAR(30) NOT NULL DEFAULT 'daily',
                severity VARCHAR(20) NOT NULL DEFAULT 'good',
                title VARCHAR(255) NOT NULL,
                body TEXT NOT NULL,
                action JSONB,
                status VARCHAR(20) NOT NULL DEFAULT 'open',
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )
        """))
