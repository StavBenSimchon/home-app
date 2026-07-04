from fastapi import APIRouter

from app.routers import ai, goals, plans, exercises

api_router = APIRouter(prefix="/api")
api_router.include_router(goals.router)
api_router.include_router(plans.router)
api_router.include_router(exercises.router)
api_router.include_router(ai.router)
