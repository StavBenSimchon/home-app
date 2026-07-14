# LAN Agent

Python reverse tunnel agent. Connects to cloud gateway via mTLS WebSocket and forwards requests to LAN services based on service name.

## Architecture

```
Cloud Gateway ←(WSS+mTLS)→ LAN Agent → LAN Services (k8s DNS)
```

## Features

- mTLS client certificate authentication
- Service name → URL mapping (via env vars)
- Request/response correlation via ID
- Heartbeats (ping/pong every 30s, 90s read deadline)
- Auto-reconnect with exponential backoff
- No inbound ports exposed

## Setup

### Install

```bash
pip install -e .
```

### Configure Services

```bash
export SERVICE_AUTH_SERVICE=http://auth-service.home-app.svc:8000
export SERVICE_HOME_APP=http://home-app-backend.home-app.svc:8000
export SERVICE_GRAFANA=http://grafana.monitoring.svc:3000
```

### Configure mTLS

```bash
export CERT_FILE=/path/to/agent.crt
export KEY_FILE=/path/to/agent.key
export CA_FILE=/path/to/ca.crt
export GATEWAY_URL=wss://gateway.example.com:8443/ws
```

### Run

```bash
lan-agent
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_URL` | `wss://localhost:8443/ws` | Cloud gateway WebSocket URL |
| `AGENT_ID` | Auto-generated | Unique agent identifier |
| `CERT_FILE` | Required | Agent client certificate (mTLS) |
| `KEY_FILE` | Required | Agent private key (mTLS) |
| `CA_FILE` | Optional | CA cert to verify gateway TLS |
| `SERVICE_*` | Required | Service name → URL mapping |
| `RECONNECT_DELAY` | `5` | Initial reconnect delay (seconds) |
| `MAX_RECONNECT_DELAY` | `60` | Max reconnect delay (seconds) |
| `REQUEST_TIMEOUT` | `60` | Request timeout (seconds) |

## Kubernetes Deployment

```yaml
env:
  - name: SERVICE_AUTH_SERVICE
    value: "http://auth-service.home-app.svc:8000"
  - name: SERVICE_HOME_APP
    value: "http://home-app-backend.home-app.svc:8000"
  - name: CERT_FILE
    value: "/certs/agent.crt"
  - name: KEY_FILE
    value: "/certs/agent.key"
  - name: CA_FILE
    value: "/certs/ca.crt"
  - name: GATEWAY_URL
    value: "wss://gateway.example.com:8443/ws"
volumeMounts:
  - name: certs
    mountPath: /certs
    readOnly: true
volumes:
  - name: certs
    secret:
      secretName: lan-agent-certs
```
