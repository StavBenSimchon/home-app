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
