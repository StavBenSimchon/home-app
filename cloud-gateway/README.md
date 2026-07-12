# Cloud Gateway

Go-based API gateway with user authentication (Turso/SQLite) and WebSocket tunnel to LAN agents.

## Architecture

```
Browser → Cloud Gateway (AuthN + Proxy) → LAN Agent → Local App
```

## Features

- User authentication via Turso (SQLite-compatible)
- JWT token-based sessions
- WebSocket tunnel to LAN agents
- Request proxying with timeout
- Login page (browser-based)

## Setup

1. Create a Turso database at https://turso.tech
2. Set environment variables:

```bash
export TURSO_URL=libsql://your-db.turso.io
export TURSO_TOKEN=your-token
export JWT_SECRET=your-secret
export AGENT_TOKEN=your-agent-token
```

3. Create a user:

```bash
# After starting the gateway, use the CLI:
go run cmd/gateway/main.go -create-user admin mypassword
```

## Run

```bash
cd cmd/gateway
go run .
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/login` | GET | Login page |
| `/login` | POST | Authenticate, returns JWT |
| `/health` | GET | Gateway health + agent count |
| `/ws` | GET | WebSocket endpoint for LAN agents |
| `/*` | ALL | Proxy to LAN agent (requires auth) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LISTEN_ADDR` | `:8080` | Listen address |
| `TURSO_URL` | Required | Turso database URL |
| `TURSO_TOKEN` | Required | Turso auth token |
| `JWT_SECRET` | `change-me` | JWT signing secret |
| `AGENT_TOKEN` | Empty | Token for LAN agent auth |
