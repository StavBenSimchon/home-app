import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.coach import AIInsight
from app.models.goal import Goal
from app.schemas.progress import ProgressResponse
from app.schemas.progress import ConsistencyStats  # noqa: F401
from app.services import insights as insights_service
from app.services.actions import apply_action

router = APIRouter(prefix="/goals/{goal_id}/insights", tags=["insights"])


@router.post("/generate", response_model=dict)
async def generate(goal_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    created = await insights_service.generate_insights(session, goal_id)
    if not created:
        return {"type": "none", "message": "Everything looks good today. No new insights.", "insights": []}
    return {"type": "created", "insights": [_to_dict(i) for i in created]}


@router.get("/", response_model=list)
async def list_insights(goal_id: uuid.UUID, status: str = "open", session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(AIInsight)
        .where(AIInsight.goal_id == goal_id, AIInsight.status == status)
        .order_by(AIInsight.created_at.desc())
    )
    return [_to_dict(i) for i in result.scalars()]


def _to_dict(i: AIInsight) -> dict:
    return {
        "id": str(i.id),
        "goal_id": str(i.goal_id),
        "kind": i.kind,
        "severity": i.severity,
        "title": i.title,
        "body": i.body,
        "action": i.action,
        "status": i.status,
        "created_at": i.created_at.isoformat() if i.created_at else None,
    }


@router.post("/{insight_id}/dismiss")
async def dismiss_insight(goal_id: uuid.UUID, insight_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    ins = await session.get(AIInsight, insight_id)
    if not ins or ins.goal_id != goal_id:
        raise HTTPException(status_code=404, detail="Insight not found")
    ins.status = "dismissed"
    await session.commit()
    return _to_dict(ins)


@router.post("/{insight_id}/apply")
async def apply_insight(goal_id: uuid.UUID, insight_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    ins = await session.get(AIInsight, insight_id)
    if not ins or ins.goal_id != goal_id:
        raise HTTPException(status_code=404, detail="Insight not found")
    if ins.status != "open":
        raise HTTPException(status_code=409, detail="Insight is not open")
    if not ins.action:
        raise HTTPException(status_code=422, detail="Insight has no action to apply")
    try:
        await apply_action(session, goal_id, ins.action)
        ins.status = "applied"
        await session.commit()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to apply action: {e}")
    return _to_dict(ins)


@router.get("/weekly")
async def weekly_review(goal_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    goal = await session.get(Goal, goal_id)
    progress = await insights_service.gather_progress(session, goal_id)
    weights = await insights_service.latest_weights(session)
    return insights_service.build_weekly_review(goal, progress, weights)


progress_router = APIRouter(prefix="/goals/{goal_id}/progress", tags=["progress"])


@progress_router.get("/", response_model=ProgressResponse)
async def get_progress(goal_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    return await insights_service.gather_progress(session, goal_id)
