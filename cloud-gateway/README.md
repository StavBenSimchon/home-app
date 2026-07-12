# Cloud Gateway

Go-based API gateway with user authentication (Turso/SQLite), mTLS agent verification, and route-based proxying to LAN agents.

## Architecture

```
Browser ──HTTPS (Let's Encrypt)──→ Gateway ──WSS+mTLS (self-signed CA)──→ LAN Agent → LAN Services
```

## Features

- User authentication via Turso (SQLite) with bcrypt + JWT
- mTLS for agent connections (self-signed CA)
- Route-based proxying with prefix stripping
- WebSocket tunnel with request/response correlation
- TLS support (Let's Encrypt or any cert)

## Setup

### 1. Environment Variables

```bash
export LISTEN_ADDR=:8443
export TLS_CERT=/path/to/fullchain.pem      # Let's Encrypt
export TLS_KEY=/path/to/privkey.pem         # Let's Encrypt
export TURSO_URL=libsql://your-db.turso.io
export TURSO_TOKEN=your-turso-token
export JWT_SECRET=your-jwt-secret
export AGENT_CA_CERT=/path/to/ca.crt        # Self-signed CA for agent mTLS
export ROUTES=/home-app=home-app,/grafana=grafana,/prometheus=prometheus
```

### 2. Create Users

```bash
go run cmd/gateway/main.go -create-user admin:yourpassword
```

### 3. Run

```bash
go run cmd/gateway/main.go
```

## Routing

Routes are configured via `ROUTES` env var (comma-separated `prefix=service`):

| Browser URL | Service | Agent receives |
|-------------|---------|---------------|
| `/home-app/api/goals` | `home-app` | `GET /api/goals` |
| `/grafana/dashboards` | `grafana` | `GET /dashboards` |
| `/prometheus/api/v1` | `prometheus` | `GET /api/v1` |

The gateway strips the prefix and tags the service name. The agent looks up the service URL and forwards.

## API

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/login` | GET | None | Login page |
| `/login` | POST | None | Authenticate → JWT |
| `/health` | GET | None | Gateway health + agent count |
| `/ws` | GET | mTLS | WebSocket for LAN agents |
| `/<service>/*` | ALL | JWT | Proxy to LAN agent |

## Generating mTLS Certificates

```bash
# 1. Create private CA
openssl genrsa -out ca.key 4096
openssl req -x509 -new -key ca.key -days 3650 -out ca.crt -subj "/CN=Home App CA"

# 2. Create agent client cert
openssl genrsa -out agent.key 2048
openssl req -new -key agent.key -out agent.csr -subj "/CN=lan-agent"
openssl x509 -req -in agent.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out agent.crt -days 365

# 3. Deploy
# Gateway:  ca.crt → AGENT_CA_CERT
# Agent:    agent.crt → CERT_FILE, agent.key → KEY_FILE, ca.crt → CA_FILE
```
