# LAN Agent

Python reverse tunnel agent. Connects to the cloud gateway via WebSocket and forwards requests to a local application.

## Architecture

```
Cloud Gateway ←(WSS)→ LAN Agent → Local App
```

The agent initiates an outbound connection only. No inbound ports needed.

## Features

- Persistent WebSocket connection to cloud gateway
- Forwards HTTP requests to local application
- Request/response correlation via ID
- Heartbeats (ping/pong)
- Auto-reconnect with exponential backoff
- No inbound ports exposed

## Setup

```bash
pip install -e .
```

## Run

```bash
export GATEWAY_URL=ws://your-cloud-gateway:8080/ws
export LOCAL_URL=http://localhost:3000
lan-agent
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_URL` | `ws://localhost:8080/ws` | Cloud gateway WebSocket URL |
| `LOCAL_URL` | `http://localhost:3000` | Local application URL |
| `AGENT_ID` | Auto-generated | Unique agent identifier |
| `AGENT_TOKEN` | Empty | Auth token for gateway |
| `RECONNECT_DELAY` | `5` | Initial reconnect delay (seconds) |
| `MAX_RECONNECT_DELAY` | `60` | Max reconnect delay (seconds) |
| `REQUEST_TIMEOUT` | `60` | Request timeout (seconds) |
