import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import async_session_factory
from app.services import jobs
from app.services.ai_service import (
    continue_plan,
    create_goal_with_plan,
    generate_plan,
    generate_questions,
    update_goal_with_plan,
)

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


# AI calls can take minutes. To stay clear of proxy timeouts, POST endpoints
# only enqueue the work (202 + job_id); clients poll GET /ai/jobs/{job_id}.


@router.post("/questions", status_code=202)
async def ai_questions(payload: ChatRequest):
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt is required")

    async def work():
        questions = await generate_questions(payload.prompt)
        return {"questions": questions}

    return {"job_id": jobs.start_job(work)}


@router.post("/continue", status_code=202)
async def ai_continue(payload: ContinueRequest):
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt is required")

    history = [{"role": h.role, "text": h.text} for h in payload.history]

    async def work():
        from app.models.goal import Goal
        from sqlalchemy import select

        async with async_session_factory() as session:
            goal_id = uuid.UUID(payload.goal_id)
            result = await session.execute(select(Goal).where(Goal.id == goal_id))
            goal = result.scalar_one_or_none()
            if not goal:
                raise ValueError("Goal not found")
            current_plan = goal.ai_response or {}
            if payload.finalize:
                ai_output = await continue_plan(payload.prompt, current_plan, history=history, finalize=True)
                if "goal" not in ai_output or "plan" not in ai_output:
                    raise ValueError("AI returned invalid format")
                result = await update_goal_with_plan(ai_output, session, goal_id, raw_json=ai_output)
                return {"type": "finalized", **result}
            reply = await continue_plan(payload.prompt, current_plan, history=history, finalize=False)
            return {"type": "message", "message": reply}

    return {"job_id": jobs.start_job(work)}


@router.post("/plan", status_code=202)
async def ai_plan(payload: PlanRequest):
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt is required")

    qa_list = [{"question": q.question, "answer": q.answer} for q in payload.qa]

    async def work():
        ai_output = await generate_plan(payload.prompt, qa_list)
        if "goal" not in ai_output:
            raise ValueError("AI returned invalid format")
        async with async_session_factory() as session:
            return await create_goal_with_plan(ai_output, session, raw_json=ai_output)

    return {"job_id": jobs.start_job(work)}


@router.get("/jobs/{job_id}")
async def ai_job(job_id: str):
    job = jobs.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
