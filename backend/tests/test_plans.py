import uuid

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_plan_entry(client: AsyncClient):
    goal_resp = await client.post(
        "/goals/",
        json={"title": "Fitness Goal"},
    )
    goal_id = goal_resp.json()["id"]

    payload = {
        "goal_id": goal_id,
        "week_number": 1,
        "day_of_week": 0,
        "activity": "Walk",
        "duration_minutes": 30,
    }
    resp = await client.post(f"/goals/{goal_id}/plans/", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["activity"] == "Walk"
    assert data["week_number"] == 1


@pytest.mark.asyncio
async def test_list_plan_entries(client: AsyncClient):
    goal_resp = await client.post("/goals/", json={"title": "G"})
    goal_id = goal_resp.json()["id"]

    await client.post(
        f"/goals/{goal_id}/plans/",
        json={"goal_id": goal_id, "week_number": 1, "day_of_week": 1, "activity": "Run"},
    )
    resp = await client.get(f"/goals/{goal_id}/plans/")
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) >= 1
    assert entries[0]["activity"] == "Run"


@pytest.mark.asyncio
async def test_get_plan_entry(client: AsyncClient):
    goal_resp = await client.post("/goals/", json={"title": "G"})
    goal_id = goal_resp.json()["id"]

    create = await client.post(
        f"/goals/{goal_id}/plans/",
        json={"goal_id": goal_id, "week_number": 1, "day_of_week": 2, "activity": "Swim"},
    )
    entry_id = create.json()["id"]

    resp = await client.get(f"/goals/{goal_id}/plans/{entry_id}")
    assert resp.status_code == 200
    assert resp.json()["activity"] == "Swim"


@pytest.mark.asyncio
async def test_update_plan_entry(client: AsyncClient):
    goal_resp = await client.post("/goals/", json={"title": "G"})
    goal_id = goal_resp.json()["id"]

    create = await client.post(
        f"/goals/{goal_id}/plans/",
        json={"goal_id": goal_id, "week_number": 1, "day_of_week": 3, "activity": "Yoga"},
    )
    entry_id = create.json()["id"]

    resp = await client.patch(
        f"/goals/{goal_id}/plans/{entry_id}",
        json={"activity": "Power Yoga", "duration_minutes": 45},
    )
    assert resp.status_code == 200
    assert resp.json()["activity"] == "Power Yoga"
    assert resp.json()["duration_minutes"] == 45


@pytest.mark.asyncio
async def test_delete_plan_entry(client: AsyncClient):
    goal_resp = await client.post("/goals/", json={"title": "G"})
    goal_id = goal_resp.json()["id"]

    create = await client.post(
        f"/goals/{goal_id}/plans/",
        json={"goal_id": goal_id, "week_number": 1, "day_of_week": 4, "activity": "Rest"},
    )
    entry_id = create.json()["id"]

    resp = await client.delete(f"/goals/{goal_id}/plans/{entry_id}")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_goal_id_mismatch(client: AsyncClient):
    fake_goal_id = str(uuid.uuid4())
    payload = {
        "goal_id": fake_goal_id,
        "week_number": 1,
        "activity": "Test",
    }
    resp = await client.post(f"/goals/{uuid.uuid4()}/plans/", json=payload)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_plan_entry_not_found(client: AsyncClient):
    goal_resp = await client.post("/goals/", json={"title": "G"})
    goal_id = goal_resp.json()["id"]

    resp = await client.get(f"/goals/{goal_id}/plans/{uuid.uuid4()}")
    assert resp.status_code == 404
