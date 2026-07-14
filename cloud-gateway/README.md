# Cloud Gateway

Stateless Go API gateway. No database. JWT signing/verification + WebSocket tunnel relay + rate limiting + security headers.

## Architecture

```
Browser ──HTTPS──→ Gateway (JWT + rate limit + security) ──WSS+mTLS──→ LAN Agent → Services
```

**The gateway has NO database connection.** It only:
1. Verifies JWT tokens
2. Proxies requests to LAN agent via WebSocket tunnel
3. Signs JWT tokens after successful login (login is proxied to auth-service)

## Features

- Stateless (no DB, no credentials on the VPS)
- JWT auth (signs tokens after auth-service confirms login)
- mTLS for agent connections (self-signed CA)
- Rate limiting (5/min on login, 1000/min on proxy)
- Request size limits (10MB max body, 4KB login)
- Security headers (HSTS, X-Frame-Options, CSP, etc.)
- CORS support
- Agent connection limit (max 2 agents)
- Route-based proxying with prefix stripping
- TLS support (Let's Encrypt)

## Setup

### Environment Variables

```bash
export LISTEN_ADDR=:8443
export TLS_CERT=/path/to/fullchain.pem
export TLS_KEY=/path/to/privkey.pem
export JWT_SECRET=your-jwt-secret
export AGENT_CA_CERT=/path/to/ca.crt
export ALLOWED_ORIGIN=https://yourdomain.com
export ROUTES=/auth=auth-service,/home-app=home-app,/grafana=grafana
```

### Run

```bash
go run cmd/gateway/main.go
```

## How Login Works

```
Browser → POST /login (username, password)
  → Gateway forwards to LAN agent → auth-service → checks password in PostgreSQL
  → Returns {user_id, username, role}
  → Gateway signs JWT with JWT_SECRET
  → Returns {token: "eyJ..."} to browser
```

The gateway never sees the password hash — it only gets the auth-service response.

## Routing

| Browser URL | Service | Agent receives |
|-------------|---------|---------------|
| `/auth/login` | `auth-service` | `POST /login` |
| `/home-app/api/goals` | `home-app` | `GET /api/goals` |
| `/grafana/dashboards` | `grafana` | `GET /dashboards` |

## API

| Endpoint | Auth | Rate Limit | Description |
|----------|------|------------|-------------|
| `/login` | None | 5/min | Login page / POST credentials |
| `/health` | None | None | Health check |
| `/ws` | mTLS | None | WebSocket for LAN agents |
| `/<service>/*` | JWT | 1000/min | Proxy to LAN agent |

## Generating mTLS Certificates

```bash
# CA
openssl genrsa -out ca.key 4096
openssl req -x509 -new -key ca.key -days 3650 -out ca.crt -subj "/CN=Home App CA"

# Agent client cert
openssl genrsa -out agent.key 2048
openssl req -new -key agent.key -out agent.csr -subj "/CN=lan-agent"
openssl x509 -req -in agent.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out agent.crt -days 365
```
