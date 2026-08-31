# AGENTS.md

## Project
Multi-service "home-app" platform. The fitness module is an **AI coaching app**: AI Coach creates/manages a plan → Calendar schedules it → Workout tracks execution → Progress shows results → AI analyzes and adjusts.

## Layout
- `backend/` — FastAPI + SQLAlchemy + Postgres. Tests and app run in Docker (uv for deps). 
- `frontend/` — React + Vite. Fitness app is `src/components/fitness/*` (5 tabs: AI Coach, Calendar, Workout, Progress, Profile).
- `docker-compose.yml` — services `db`, `backend`, `frontend`, plus `backend-test` (one-off pytest runner against Postgres).

## Backend
- Use `nerdctl compose -p home-app up -d db` for the DB.
- Test command (runs and exits): `nerdctl compose -p home-app up -d --force-recreate backend-test` (after `build`), then check logs.
- Every feature must have a test. `conftest.py` connects to `DATABASE_URL` (Postgres only).
- `routers/__init__.py` aggregates routers with **no `/api` prefix** — the Vite dev proxy strips `/api`.
- New tables/columns are added as idempotent DDL in `database.py:init_db` (project convention; not alembic).
- Cross-dialect SQL types use `app/models/types.py` (GUID, JSONBCompat).
- AI endpoints call OpenCode Zen (`AI_*` env vars).

## Frontend
- Run `npm i` + `npm run dev` (in Docker: use the dev target). Vitest setup configured in `vite.config.ts`.
- `src/api.ts` — typed client for all backend routes.

## Conventions
- Backend/frontend must build in Docker (no host-side tooling).
- `nerdctl` (not `docker`/`docker compose`) — compose file driven with `-p home-app`.
- Don't commit git unless explicitly asked.
