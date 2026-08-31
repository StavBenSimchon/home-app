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
async def test_insights_have_no_actions(client: AsyncClient):
    """Insights are informational only — program changes go through coach finalize."""
    goal_id, _, _, _ = await _mk_goal_with_session(client)
    await client.post("/weight/", json={"weight_kg": 80})
    await client.post("/weight/", json={"weight_kg": 79})
    await client.post(f"/goals/{goal_id}/insights/generate")
    listed = await client.get(f"/goals/{goal_id}/insights/?status=open")
    assert listed.status_code == 200
    for ins in listed.json():
        assert ins.get("action") is None


@pytest.mark.asyncio
async def test_coach_actions_endpoint_is_gone(client: AsyncClient):
    goal_id = (await client.post("/goals/", json={"title": "G"})).json()["id"]
    resp = await client.post("/coach/actions", json={"goal_id": goal_id, "action": {"type": "whatever"}})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_open_session_is_idempotent_per_day(client: AsyncClient):
    goal_id, entry_id, _, session_id = await _mk_goal_with_session(client)
    again = await client.post(f"/goals/{goal_id}/sessions/entries/{entry_id}", json={})
    assert again.status_code in (200, 201)
    assert again.json()["id"] == session_id


@pytest.mark.asyncio
async def test_finish_exercise_logs_sets_and_marks_done(client: AsyncClient):
    goal_id, entry_id, ex_id, session_id = await _mk_goal_with_session(client)
    resp = await client.post(
        f"/goals/{goal_id}/sessions/{session_id}/exercises/{ex_id}/finish",
        json={"sets": [
            {"exercise_id": ex_id, "set_number": 1, "weight": 80, "reps": 10, "rir": 2},
            {"exercise_id": ex_id, "set_number": 2, "weight": 80, "reps": 8, "rir": 0},
        ]},
    )
    assert resp.status_code == 200
    assert len(resp.json()["set_logs"]) == 2

    exercises = (await client.get(f"/goals/{goal_id}/plans/{entry_id}/exercises/")).json()
    assert exercises[0]["completed"] is True


@pytest.mark.asyncio
async def test_unfinish_exercise_removes_logs(client: AsyncClient):
    goal_id, entry_id, ex_id, session_id = await _mk_goal_with_session(client)
    await client.post(
        f"/goals/{goal_id}/sessions/{session_id}/exercises/{ex_id}/finish",
        json={"sets": [{"exercise_id": ex_id, "set_number": 1, "weight": 80, "reps": 10, "rir": 2}]},
    )
    resp = await client.post(f"/goals/{goal_id}/sessions/{session_id}/exercises/{ex_id}/unfinish")
    assert resp.status_code == 200
    assert resp.json()["set_logs"] == []

    exercises = (await client.get(f"/goals/{goal_id}/plans/{entry_id}/exercises/")).json()
    assert exercises[0]["completed"] is False


@pytest.mark.asyncio
async def test_exercise_log_feed(client: AsyncClient):
    goal_id, _, ex_id, session_id = await _mk_goal_with_session(client)
    await client.post(
        f"/goals/{goal_id}/sessions/{session_id}/exercises/{ex_id}/finish",
        json={"sets": [
            {"exercise_id": ex_id, "set_number": 1, "weight": 80, "reps": 10, "rir": 2},
            {"exercise_id": ex_id, "set_number": 2, "weight": 82.5, "reps": 6, "rir": 0},
        ]},
    )
    resp = await client.get(f"/goals/{goal_id}/sessions/log")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    item = items[0]
    assert item["exercise_name"] == "Bench Press"
    assert item["top_weight"] == 82.5
    assert item["total_reps"] == 16
    assert item["failure_sets"] == [2]
    assert item["sets"][1]["failure"] is True


@pytest.mark.asyncio
async def test_finish_rejects_foreign_exercise(client: AsyncClient):
    goal_id, _, _, session_id = await _mk_goal_with_session(client)
    other_entry = (await client.post(f"/goals/{goal_id}/plans/", json={
        "goal_id": goal_id, "week_number": 1, "day_of_week": 3, "activity": "Other",
    })).json()
    other_ex = (await client.post(f"/goals/{goal_id}/plans/{other_entry['id']}/exercises/", json={
        "plan_entry_id": other_entry["id"], "name": "Squat", "sets": 3,
    })).json()
    resp = await client.post(
        f"/goals/{goal_id}/sessions/{session_id}/exercises/{other_ex['id']}/finish",
        json={"sets": [{"exercise_id": other_ex["id"], "set_number": 1, "weight": 100, "reps": 5, "rir": 1}]},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_analysis_data_crosses_windows(client: AsyncClient, session):
    """7/14-day windows must aggregate logged sets, volume, failures and adherence."""
    goal_id, entry_id, ex_id, session_id = await _mk_goal_with_session(client)
    await client.post(
        f"/goals/{goal_id}/sessions/{session_id}/exercises/{ex_id}/finish",
        json={"sets": [
            {"exercise_id": ex_id, "set_number": 1, "weight": 80, "reps": 10, "rir": 2},
            {"exercise_id": ex_id, "set_number": 2, "weight": 80, "reps": 8, "rir": 0},
        ]},
    )
    await client.post("/weight/", json={"weight_kg": 80, "fat_percentage": 20, "muscle_percentage": 40})

    import uuid as _uuid

    from app.services.insights import build_analysis_data, has_enough_data

    data = await build_analysis_data(session, _uuid.UUID(goal_id))
    w7 = data["windows"]["last_7_days"]
    assert w7["workouts_logged"] == 1
    assert w7["sets_logged"] == 2
    assert w7["total_volume_kg"] == 80 * 10 + 80 * 8
    assert w7["failure_sets"] == 1
    assert w7["avg_rir"] == 1.0
    assert w7["exercises"][0]["exercise"] == "Bench Press"
    assert w7["exercises"][0]["top_weight"] == 80
    assert data["windows"]["last_14_days"]["sets_logged"] == 2
    assert has_enough_data(data) is True


@pytest.mark.asyncio
async def test_analyze_endpoint_returns_payload_and_dedupes(client: AsyncClient):
    """Without an AI key the endpoint must still return a usable rule-based analysis."""
    goal_id, _, ex_id, session_id = await _mk_goal_with_session(client)
    await client.post(
        f"/goals/{goal_id}/sessions/{session_id}/exercises/{ex_id}/finish",
        json={"sets": [{"exercise_id": ex_id, "set_number": 1, "weight": 80, "reps": 10, "rir": 0}]},
    )

    resp = await client.post(f"/goals/{goal_id}/insights/analyze")
    assert resp.status_code == 200
    body = resp.json()
    assert body["kind"] == "analysis"
    payload = body["payload"]
    assert payload["assessment"]
    assert payload["recommendations"]
    assert payload["metrics"]["last_7_days"]["sets_logged"] == 1
    assert payload["metrics"]["last_14_days"]["days"] == 14

    # same day → reuse, unless forced
    again = await client.post(f"/goals/{goal_id}/insights/analyze")
    assert again.json()["id"] == body["id"]
    forced = await client.post(f"/goals/{goal_id}/insights/analyze?force=true")
    assert forced.json()["id"] != body["id"]


@pytest.mark.asyncio
async def test_progression_preview_and_apply_updates_next_week_only(client: AsyncClient):
    goal_id, entry_id, ex_id, session_id = await _mk_goal_with_session(client)
    # Current session reaches the top of the range at the target RIR.
    await client.post(
        f"/goals/{goal_id}/sessions/{session_id}/exercises/{ex_id}/finish",
        json={"sets": [
            {"exercise_id": ex_id, "set_number": 1, "weight": 80, "reps": 10, "rir": 2},
            {"exercise_id": ex_id, "set_number": 2, "weight": 80, "reps": 10, "rir": 2},
            {"exercise_id": ex_id, "set_number": 3, "weight": 80, "reps": 10, "rir": 2},
        ]},
    )
    week2 = (await client.post(f"/goals/{goal_id}/plans/", json={
        "goal_id": goal_id, "week_number": 2, "day_of_week": 0, "activity": "Workout A — Upper",
    })).json()
    week2_ex = (await client.post(f"/goals/{goal_id}/plans/{week2['id']}/exercises/", json={
        "plan_entry_id": week2["id"], "name": "Bench Press", "sets": 3,
        "reps": 8, "reps_max": 10, "weight": 80, "rir_target": 2,
    })).json()

    analysis = await client.post(f"/goals/{goal_id}/insights/analyze?force=true")
    assert analysis.status_code == 200
    targets = analysis.json()["payload"]["progression_targets"]
    assert len(targets) == 1
    assert targets[0]["exercise"] == "Bench Press"
    assert targets[0]["week_number"] == 2
    assert targets[0]["decision"] == "increase_load"
    assert targets[0]["target_weight_kg"] == 82.0

    applied = await client.post(
        f"/goals/{goal_id}/insights/{analysis.json()['id']}/apply-progression"
    )
    assert applied.status_code == 200
    assert applied.json()["updated"] == 1
    assert applied.json()["week_number"] == 2

    week2_after = await client.get(f"/goals/{goal_id}/plans/{week2['id']}/exercises/")
    changed = next(e for e in week2_after.json() if e["id"] == week2_ex["id"])
    assert changed["weight"] == 82.0
    assert changed["reps"] == 8
    assert changed["reps_max"] == 10
    assert changed["rir_target"] == 2

    # Historical/current-week prescription is untouched, and apply is idempotent.
    current = await client.get(f"/goals/{goal_id}/plans/{entry_id}/exercises/")
    assert next(e for e in current.json() if e["id"] == ex_id)["weight"] == 80
    again = await client.post(
        f"/goals/{goal_id}/insights/{analysis.json()['id']}/apply-progression"
    )
    assert again.json()["already_applied"] is True


def test_progression_load_bounds_only_block_implausible_jumps():
    from app.services.insights import _bounded_load

    assert _bounded_load(82.5, 80, "increase_load") == 82.5
    assert _bounded_load(120, 80, "increase_load") == 88.0  # max +10%
    assert _bounded_load(60, 80, "deload") == 64.0  # deload floor -20%


@pytest.mark.asyncio
async def test_analyze_with_no_data_explains_what_is_missing(client: AsyncClient):
    goal_id = (await client.post("/goals/", json={"title": "Fresh"})).json()["id"]
    resp = await client.post(f"/goals/{goal_id}/insights/analyze")
    assert resp.status_code == 200
    payload = resp.json()["payload"]
    assert resp.json()["severity"] == "info"
    assert "Calendar" in " ".join(payload["recommendations"])


def test_fallback_analysis_flags_failure_and_plateau():
    from app.services.insights import fallback_analysis

    data = {
        "windows": {
            "last_7_days": {
                "days": 7, "workouts_logged": 3, "sets_logged": 12, "total_volume_kg": 5000.0,
                "failure_sets": 5, "avg_rir": 0.5, "planned_activities": 5, "completed_activities": 2,
                "adherence_pct": 40.0, "measurements": 1, "body_change": {"weight_kg": -0.4}, "exercises": [],
            },
            "last_14_days": {
                "days": 14, "workouts_logged": 6, "sets_logged": 24, "total_volume_kg": 11000.0,
                "failure_sets": 7, "avg_rir": 1.0, "planned_activities": 10, "completed_activities": 6,
                "adherence_pct": 60.0, "measurements": 2, "body_change": {"weight_kg": -0.8}, "exercises": [],
            },
        },
        "exercise_history": [
            {"exercise": "Bench Press", "history": [
                {"date": "2026-08-10", "top_weight": 80.0},
                {"date": "2026-08-17", "top_weight": 80.0},
                {"date": "2026-08-24", "top_weight": 80.0},
            ]},
        ],
    }
    result = fallback_analysis(data)
    assert result["severity"] == "warning"
    joined = " ".join(result["observations"] + result["recommendations"])
    assert "failure" in joined.lower()
    assert "Bench Press" in joined
    assert "adherence" in joined.lower()


def test_normalize_start_date_never_in_the_past_and_is_monday():
    from datetime import date, timedelta

    from app.services.ai_service import normalize_start_date

    today = date.today()
    monday = today - timedelta(days=today.weekday())

    # None → this week's Monday
    assert normalize_start_date(None) == monday
    # Past date (AI hallucinating last year) → this week's Monday
    assert normalize_start_date(date(2020, 3, 5)) == monday
    # Future date → snapped back to its own Monday
    future = today + timedelta(days=20)
    got = normalize_start_date(future)
    assert got.weekday() == 0 and got <= future


def test_plan_summary_and_max_week():
    from app.services.ai_service import max_week, plan_summary

    plan = [
        {"week_number": 1, "activity": "Push", "exercises": [{"name": "Bench"}, {"name": "Fly"}]},
        {"week_number": 1, "activity": "Walk"},
        {"week_number": 2, "activity": "Push", "exercises": [{"name": "Bench"}]},
    ]
    assert max_week(plan) == 2
    assert plan_summary(plan) == {"weeks": 2, "activities": 3, "exercises": 3}


def test_parse_plan_items_splits_combined_activities():
    from app.services.ai_service import _parse_plan_items

    # 1. Plus separator
    items = _parse_plan_items([
        {"week_number": 1, "day_of_week": 0, "activity": "Push Day + Walking",
         "exercises": [{"name": "Bench Press"}]},
    ])
    assert len(items) == 2
    names = [i["activity"] for i in items]
    assert names == ["Push Day", "Walking"]
    strength = next(i for i in items if i["activity"] == "Push Day")
    walking = next(i for i in items if i["activity"] == "Walking")
    assert strength["exercises"] and walking["exercises"] == []

    # 2. '&' separator between cardio and walk
    items_hiit = _parse_plan_items([
        {"week_number": 1, "day_of_week": 2, "activity": "HIIT 1 & Recovery Walk",
         "duration_minutes": 75, "exercises": [{"name": "Assault Bike"}]},
    ])
    assert len(items_hiit) == 2
    assert items_hiit[0]["activity"] == "HIIT 1"
    assert items_hiit[1]["activity"] == "Recovery Walk"

    # 3. Muscle groups like 'Push & Abs' should NOT be split into walk
    items_abs = _parse_plan_items([
        {"week_number": 1, "day_of_week": 0, "activity": "Push & Abs",
         "exercises": [{"name": "Bench Press"}, {"name": "Leg Raise"}]},
    ])
    assert len(items_abs) == 1
    assert items_abs[0]["activity"] == "Push & Abs"
    assert len(items_abs[0]["exercises"]) == 2

    # 4. Notes mentioning daily walk should extract an extra Walk entry
    items_notes = _parse_plan_items([
        {"week_number": 1, "day_of_week": 0, "activity": "Pull",
         "notes": "Upper back, lats, and bicep volume. Complete daily 60-min brisk walk separately.",
         "exercises": [{"name": "Lat Pulldown"}]},
    ])
    assert len(items_notes) == 2
    assert items_notes[0]["activity"] == "Pull"
    assert items_notes[1]["activity"] == "Walk — 60 min"
    assert items_notes[1]["duration_minutes"] == 60


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
