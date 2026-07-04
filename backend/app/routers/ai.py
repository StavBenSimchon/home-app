import traceback
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.services.ai_service import generate_questions, generate_plan, create_goal_with_plan, continue_plan, update_goal_with_plan

router = APIRouter(prefix="/ai", tags=["ai"])


class ChatRequest(BaseModel):
    prompt: str


class QAPair(BaseModel):
    question: str
    answer: str


class PlanRequest(BaseModel):
    prompt: str
    qa: list[QAPair] = []


class HistoryItem(BaseModel):
    role: str
    text: str


class ContinueRequest(BaseModel):
    goal_id: str
    prompt: str
    finalize: bool = False
    history: list[HistoryItem] = []


@router.post("/questions")
async def ai_questions(payload: ChatRequest):
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt is required")
    try:
        questions = await generate_questions(payload.prompt)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI service error: {e}")
    return {"questions": questions}


@router.post("/continue")
async def ai_continue(payload: ContinueRequest, session: AsyncSession = Depends(get_session)):
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt is required")
    try:
        from app.models.goal import Goal
        from sqlalchemy import select
        goal_id = uuid.UUID(payload.goal_id)
        result = await session.execute(select(Goal).where(Goal.id == goal_id))
        goal = result.scalar_one_or_none()
        if not goal:
            raise HTTPException(status_code=404, detail="Goal not found")
        current_plan = goal.ai_response or {}
        history = [{"role": h.role, "text": h.text} for h in payload.history]
        if payload.finalize:
            ai_output = await continue_plan(payload.prompt, current_plan, history=history, finalize=True)
            if "goal" not in ai_output or "plan" not in ai_output:
                raise HTTPException(status_code=502, detail="AI returned invalid format")
            result = await update_goal_with_plan(ai_output, session, goal_id, raw_json=ai_output)
            return {"type": "finalized", **result}
        else:
            reply = await continue_plan(payload.prompt, current_plan, history=history, finalize=False)
            return {"type": "message", "message": reply}
    except HTTPException:
        raise
    except Exception as e:
        tb = traceback.format_exc()
        print(f"AI continue error: {tb}", flush=True)
        msg = str(e) or repr(e)
        raise HTTPException(status_code=502, detail=f"AI service error: {msg}")


@router.post("/plan")
async def ai_plan(payload: PlanRequest, session: AsyncSession = Depends(get_session)):
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt is required")

    try:
        qa_list = [{"question": q.question, "answer": q.answer} for q in payload.qa]
        ai_output = await generate_plan(payload.prompt, qa_list)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI service error: {e}")

    if "goal" not in ai_output:
        raise HTTPException(status_code=502, detail="AI returned invalid format")

    try:
        result = await create_goal_with_plan(ai_output, session, raw_json=ai_output)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save plan: {e}")

    return result
