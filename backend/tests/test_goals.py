import uuid

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_goal(client: AsyncClient):
    payload = {
        "title": "Fat Loss Journey",
        "description": "Reduce body fat from 25% to 10%",
        "metric_name": "Body Fat %",
        "current_value": 25.0,
        "target_value": 10.0,
        "unit": "%",
        "start_date": "2026-07-01",
        "target_date": "2027-01-01",
    }
    resp = await client.post("/goals/", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Fat Loss Journey"
    assert data["current_value"] == 25.0
    assert data["target_value"] == 10.0
    assert "id" in data


@pytest.mark.asyncio
async def test_list_goals(client: AsyncClient):
    resp = await client.get("/goals/")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_get_goal(client: AsyncClient):
    create = await client.post(
        "/goals/",
        json={"title": "Test Goal"},
    )
    goal_id = create.json()["id"]

    resp = await client.get(f"/goals/{goal_id}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Test Goal"


@pytest.mark.asyncio
async def test_get_goal_not_found(client: AsyncClient):
    resp = await client.get(f"/goals/{uuid.uuid4()}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_goal(client: AsyncClient):
    create = await client.post(
        "/goals/",
        json={"title": "Old Title"},
    )
    goal_id = create.json()["id"]

    resp = await client.patch(
        f"/goals/{goal_id}",
        json={"title": "New Title", "current_value": 20.0},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "New Title"
    assert data["current_value"] == 20.0


@pytest.mark.asyncio
async def test_delete_goal(client: AsyncClient):
    create = await client.post(
        "/goals/",
        json={"title": "Delete Me"},
    )
    goal_id = create.json()["id"]

    resp = await client.delete(f"/goals/{goal_id}")
    assert resp.status_code == 204
