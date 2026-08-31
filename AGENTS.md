# AGENTS.md

## Project
Multi-service "home-app" platform. The fitness module is an **AI coaching app**: AI Coach creates/manages a plan → Calendar schedules it → Workout tracks execution → Progress shows results → AI analyzes and adjusts.

## Layout
- `backend/` — FastAPI + SQLAlchemy + Postgres. Tests and app run in Docker (uv for deps). 
- `frontend/` — React + Vite. Fitness app is `src/components/fitness/*` (5 tabs: AI Coach, Calendar, Workout, Progress, Profile).
- `docker-compose.yml` — services `db`, `backend`, `frontend`, plus `backend-test` (one-off pytest runner against Postgres).

## Backend
- Use `nerdctl compose -p home-app up -d db` for the DB.
- Every feature must have a test; `tests/conftest.py` requires `DATABASE_URL` (Postgres). To run tests, run pytest inside the `backend` image/container with `DATABASE_URL` set in `.env`.
- `routers/__init__.py` aggregates routers without a prefix. `main.py` mounts them at `/` and `/api`: local Vite/nginx strips `/api`, while the Kubernetes Gateway forwards it unchanged.
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
