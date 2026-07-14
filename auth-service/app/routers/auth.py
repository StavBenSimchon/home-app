import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import User
from app.schemas import CreateUserRequest, LoginRequest, LoginResponse, UserResponse
from app.rate_limit import login_limiter

import bcrypt

router = APIRouter()


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest):
    client_key = f"login:{payload.username}"

    if login_limiter.is_rate_limited(client_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Try again in 60 seconds.",
        )

    from app.database import async_session_factory

    async with async_session_factory() as session:
        result = await session.execute(
            select(User).where(User.username == payload.username)
        )
        user = result.scalar_one_or_none()

        if not user or not bcrypt.checkpw(
            payload.password.encode(), user.password_hash.encode()
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
            )

        login_limiter.reset(client_key)

        return LoginResponse(
            user_id=str(user.id),
            username=user.username,
            role=user.role,
        )


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(payload: CreateUserRequest):
    from app.database import async_session_factory

    hashed = bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode()

    user = User(
        id=uuid.uuid4(),
        username=payload.username,
        password_hash=hashed,
        role=payload.role,
    )

    async with async_session_factory() as session:
        session.add(user)
        try:
            await session.commit()
        except Exception:
            await session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username already exists",
            )
        await session.refresh(user)
        return user


@router.get("/users", response_model=list[UserResponse])
async def list_users():
    from app.database import async_session_factory

    async with async_session_factory() as session:
        result = await session.execute(select(User).order_by(User.created_at))
        return result.scalars().all()


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: uuid.UUID):
    from app.database import async_session_factory

    async with async_session_factory() as session:
        user = await session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        await session.delete(user)
        await session.commit()
