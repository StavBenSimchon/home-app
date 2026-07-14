# Auth Service

Python FastAPI authentication service. Owns the `users` table in PostgreSQL. Handles login, user creation, and password verification.

## Architecture

```
Cloud Gateway → LAN Agent → Auth Service → PostgreSQL (users table)
```

The gateway proxies login requests to this service. The auth service verifies the password against PostgreSQL and returns `{user_id, username, role}`. The gateway then signs the JWT.

## Features

- User management (create, list, delete)
- bcrypt password hashing
- Rate limiting on login (5 attempts per 60 seconds per username)
- PostgreSQL async (asyncpg)
- Health check endpoint

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/login` | POST | Verify credentials → `{user_id, username, role}` |
| `/auth/users` | POST | Create user (username, password, role) |
| `/auth/users` | GET | List all users |
| `/auth/users/{id}` | DELETE | Delete user |
| `/health` | GET | Health check |

## Setup

### Environment Variables

```bash
export DATABASE_URL=postgresql+asyncpg://homeapp:homeapp_dev@localhost:5432/homeapp
export JWT_SECRET=change-me-in-production  # not used here, gateway signs JWT
```

### Create First User

```bash
curl -X POST http://localhost:8000/auth/users \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"yourpassword","role":"admin"}'
```

### Run

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Docker

```bash
docker build -t auth-service .
docker run -p 8000:8000 -e DATABASE_URL=... auth-service
```
