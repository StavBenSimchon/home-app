import os
from collections.abc import AsyncGenerator
from urllib.parse import urlsplit, urlunsplit

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_session
from app.main import app

# Tests need Postgres (set DATABASE_URL), but they must NEVER touch the app database:
# everything runs against a dedicated "<db>_test" database that is created on demand.
APP_DATABASE_URL = os.environ["DATABASE_URL"]


def _test_database_url(url: str) -> str:
    parts = urlsplit(url)
    name = parts.path.lstrip("/")
    if name.endswith("_test"):
        return url
    return urlunsplit((parts.scheme, parts.netloc, f"/{name}_test", parts.query, parts.fragment))


TEST_DATABASE_URL = _test_database_url(APP_DATABASE_URL)
TEST_DB_NAME = urlsplit(TEST_DATABASE_URL).path.lstrip("/")

_created = False


async def _ensure_test_database() -> None:
    """CREATE DATABASE <db>_test if missing (runs once per test session)."""
    global _created
    if _created:
        return
    admin = create_async_engine(APP_DATABASE_URL, isolation_level="AUTOCOMMIT")
    try:
        async with admin.connect() as conn:
            exists = await conn.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": TEST_DB_NAME}
            )
            if not exists:
                await conn.execute(text(f'CREATE DATABASE "{TEST_DB_NAME}"'))
    finally:
        await admin.dispose()
    _created = True


@pytest_asyncio.fixture
async def engine():
    await _ensure_test_database()
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def session(engine) -> AsyncGenerator[AsyncSession, None]:
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as s:
        yield s


@pytest_asyncio.fixture
async def client(session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_session():
        yield session

    app.dependency_overrides[get_session] = override_get_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
def anyio_backend():
    return "asyncio"
