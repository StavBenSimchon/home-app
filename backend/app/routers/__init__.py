from fastapi import APIRouter

from app.routers import ai, coach, goals, insights, plans, exercises, sessions, weight

# No "/api" prefix: the dev/prod proxy strips it before requests reach this app.
api_router = APIRouter()
api_router.include_router(goals.router)
api_router.include_router(plans.router)
api_router.include_router(exercises.router)
api_router.include_router(ai.router)
api_router.include_router(weight.router)
api_router.include_router(sessions.router)
api_router.include_router(coach.router)
api_router.include_router(insights.router)
api_router.include_router(insights.progress_router)
