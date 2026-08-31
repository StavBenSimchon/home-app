import uuid

import pytest
from httpx import AsyncClient


async def _mk_goal_with_session(client: AsyncClient) -> tuple[str, str, str, str]:
    """Create goal → plan entry → exercise → session. Returns ids."""
    goal_id = (await client.post("/goals/", json={"title": "Fat loss"})).json()["id"]
    entry_id = (await client.post(f"/goals/{goal_id}/plans/", json={
        "goal_id": goal_id, "week_number": 1, "day_of_week": 0, "activity": "Workout A — Upper",
    })).json()["id"]
    ex_id = (await client.post(f"/goals/{goal_id}/plans/{entry_id}/exercises/", json={
        "plan_entry_id": entry_id, "name": "Bench Press", "sets": 3, "reps": 8, "reps_max": 10,
        "weight": 80, "rir_target": 2,
    })).json()["id"]
    session_id = (await client.post(
        f"/goals/{goal_id}/sessions/entries/{entry_id}", json={}
    )).json()["id"]
    return goal_id, entry_id, ex_id, session_id


@pytest.mark.asyncio
async def test_exercise_rep_range_fields(client: AsyncClient):
    goal_id, entry_id, ex_id, _ = await _mk_goal_with_session(client)
    resp = await client.get(f"/goals/{goal_id}/plans/{entry_id}/exercises/")
    assert resp.status_code == 200
    exercises = resp.json()
    assert exercises[0]["reps_max"] == 10
    assert exercises[0]["rir_target"] == 2


@pytest.mark.asyncio
async def test_log_sets_and_previous(client: AsyncClient):
    goal_id, entry_id, ex_id, session_id = await _mk_goal_with_session(client)

    resp = await client.post(f"/goals/{goal_id}/sessions/{session_id}/sets", json={"sets": [
        {"exercise_id": ex_id, "set_number": 1, "weight": 80, "reps": 10, "rir": 2},
        {"exercise_id": ex_id, "set_number": 2, "weight": 80, "reps": 9, "rir": 1},
    ]})
    assert resp.status_code == 200
    logs = resp.json()["set_logs"]
    assert len(logs) == 2
    assert logs[0]["reps"] == 10

    # previous performance endpoint
    prev = await client.get(
        f"/goals/{goal_id}/sessions/entries/{entry_id}/previous?exercise_id={ex_id}")
    assert prev.status_code == 200
    assert prev.json()["sets"][0]["weight"] == 80


@pytest.mark.asyncio
async def test_log_set_upsert(client: AsyncClient):
    goal_id, entry_id, ex_id, session_id = await _mk_goal_with_session(client)
    await client.post(f"/goals/{goal_id}/sessions/{session_id}/sets", json={"sets": [
        {"exercise_id": ex_id, "set_number": 1, "weight": 80, "reps": 10, "rir": 2},
    ]})
    await client.post(f"/goals/{goal_id}/sessions/{session_id}/sets", json={"sets": [
        {"exercise_id": ex_id, "set_number": 1, "weight": 82.5, "reps": 9, "rir": 1},
    ]})
    resp = await client.post(f"/goals/{goal_id}/sessions/{session_id}/sets", json={"sets": []})
    resp = await client.post(f"/goals/{goal_id}/sessions/{session_id}/sets", json={"sets": []})
    assert len(resp.json()["set_logs"]) == 1
    assert resp.json()["set_logs"][0]["weight"] == 82.5


@pytest.mark.asyncio
async def test_complete_session_marks_entry(client: AsyncClient):
    goal_id, entry_id, ex_id, session_id = await _mk_goal_with_session(client)
    resp = await client.post(f"/goals/{goal_id}/sessions/{session_id}/complete")
    assert resp.status_code == 200
    assert resp.json()["status"] == "completed"
    entry = await client.get(f"/goals/{goal_id}/plans/{entry_id}")
    assert entry.json()["completed"] is True


@pytest.mark.asyncio
async def test_progress_endpoint(client: AsyncClient):
    goal_id, entry_id, ex_id, session_id = await _mk_goal_with_session(client)
    await client.post(f"/goals/{goal_id}/sessions/{session_id}/sets", json={"sets": [
        {"exercise_id": ex_id, "set_number": 1, "weight": 80, "reps": 10, "rir": 2},
    ]})
    resp = await client.get(f"/goals/{goal_id}/progress/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["consistency"]["planned"] == 1
    names = [t["exercise_name"] for t in data["trends"]]
    assert "Bench Press" in names


@pytest.mark.asyncio
async def test_insights_generate_list_dismiss(client: AsyncClient):
    goal_id, _, _, _ = await _mk_goal_with_session(client)
    # add weight so an insight can form
    await client.post("/weight/", json={"weight_kg": 80})
    await client.post("/weight/", json={"weight_kg": 79})
    gen = await client.post(f"/goals/{goal_id}/insights/generate")
    assert gen.status_code == 200

    listed = await client.get(f"/goals/{goal_id}/insights/?status=open")
    assert listed.status_code == 200
    if listed.json():
        ins_id = listed.json()[0]["id"]
        dismiss = await client.post(f"/goals/{goal_id}/insights/{ins_id}/dismiss")
        assert dismiss.status_code == 200
        assert dismiss.json()["status"] == "dismissed"


@pytest.mark.asyncio
async def test_coach_action_replace_exercise(client: AsyncClient):
    goal_id, entry_id, _, _ = await _mk_goal_with_session(client)
    resp = await client.post("/coach/actions", json={
        "goal_id": goal_id,
        "action": {"type": "replace_exercise", "params": {"old_name": "Bench Press", "new_name": "Dumbbell Press"}},
    })
    assert resp.status_code == 200
    assert resp.json()["result"]["replaced"] == 1
    exercises = (await client.get(f"/goals/{goal_id}/plans/{entry_id}/exercises/")).json()
    assert exercises[0]["name"] == "Dumbbell Press"


@pytest.mark.asyncio
async def test_coach_action_add_walking(client: AsyncClient):
    goal_id = (await client.post("/goals/", json={"title": "G"})).json()["id"]
    resp = await client.post("/coach/actions", json={
        "goal_id": goal_id,
        "action": {"type": "add_walking_session", "params": {"steps": "8,000"}},
    })
    assert resp.status_code == 200
    entries = (await client.get(f"/goals/{goal_id}/plans/")).json()
    assert any("Walk" in e["activity"] for e in entries)


@pytest.mark.asyncio
async def test_coach_chat_requires_goal(client: AsyncClient):
    # With no goals, the coach should return 404 without any AI call.
    resp = await client.post("/coach/chat", json={"message": "Hello"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_coach_chat_with_goal_returns_message_or_502(client: AsyncClient):
    # When a goal exists, the coach routes to the AI; without an AI_API_KEY we get a 502.
    goal_id = (await client.post("/goals/", json={"title": "G"})).json()["id"]
    resp = await client.post("/coach/chat", json={"goal_id": goal_id, "message": "Hello"})
    assert resp.status_code in (200, 502)


@pytest.mark.asyncio
async def test_weekly_review(client: AsyncClient):
    goal_id = (await client.post("/goals/", json={"title": "G"})).json()["id"]
    resp = await client.get(f"/goals/{goal_id}/insights/weekly")
    assert resp.status_code == 200
    assert "summary" in resp.json()
