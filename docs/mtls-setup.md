# mTLS Certificate Setup

This guide walks through creating a self-signed Certificate Authority (CA) and client certificates for mTLS between the cloud gateway and LAN agent.

## Overview

```
Gateway (VPS)          LAN Agent (your PC)
┌──────────────┐       ┌──────────────────┐
│ ca.crt       │       │ agent.crt        │
│ (verifies    │←mTLS→ │ agent.key        │
│  agent certs)│       │ ca.crt (optional)│
└──────────────┘       └──────────────────┘
```

| File | Where it goes | Purpose |
|------|---------------|---------|
| `ca.key` | Keep on your machine ONLY (NEVER deploy) | CA private key to sign certs |
| `ca.crt` | Gateway (`AGENT_CA_CERT`) | Verifies agent client certs |
| `agent.crt` | Agent (`CERT_FILE`) | Agent's client certificate |
| `agent.key` | Agent (`KEY_FILE`) | Agent's private key |
| `ca.crt` (copy) | Agent (`CA_FILE`, optional) | Verifies gateway TLS cert |

## Step 1: Create the CA

The CA is your private trust root. Keep `ca.key` safe — anyone with it can sign new agent certs.

```bash
# Generate CA private key
openssl genrsa -out ca.key 4096

# Create CA certificate (valid 10 years)
openssl req -x509 -new -key ca.key -days 3650 -out ca.crt \
  -subj "/CN=Home App Tunnel CA/O=HomeApp"

# Verify
openssl x509 -in ca.crt -text -noout | head -20
```

**Output:**
- `ca.key` — CA private key (KEEP SECRET, never deploy)
- `ca.crt` — CA certificate (deploy to gateway)

## Step 2: Create Agent Client Certificate

Each agent gets its own client certificate signed by your CA.

```bash
# Generate agent private key
openssl genrsa -out agent.key 2048

# Create certificate signing request (CSR)
openssl req -new -key agent.key -out agent.csr \
  -subj "/CN=lan-agent/O=HomeApp"

# Sign the CSR with your CA (valid 1 year)
openssl x509 -req -in agent.csr \
  -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out agent.crt -days 365

# Verify
openssl x509 -in agent.crt -text -noout | head -20
```

**Output:**
- `agent.key` — Agent private key (deploy to agent, keep secret)
- `agent.crt` — Agent client certificate (deploy to agent)
- `agent.csr` — Can be deleted (temporary)

## Step 3: Create Additional Agent Certs (Optional)

If you have multiple agents, create separate certs for each:

```bash
# Agent 2
openssl genrsa -out agent2.key 2048
openssl req -new -key agent2.key -out agent2.csr -subj "/CN=lan-agent-2/O=HomeApp"
openssl x509 -req -in agent2.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out agent2.crt -days 365
```

## Step 4: Verify the Certificate Chain

```bash
# Verify agent cert was signed by your CA
openssl verify -CAfile ca.crt agent.crt

# Should output:
# agent.crt: OK
```

## Step 5: Deploy

### Gateway (VPS)

```bash
# Copy ca.crt to the VPS
scp ca.crt root@your-vps:/opt/gateway/certs/ca.crt

# Set environment variable
export AGENT_CA_CERT=/opt/gateway/certs/ca.crt
```

### LAN Agent (Kubernetes Secret)

```bash
# Create k8s secret from the cert files
kubectl create secret generic lan-agent-certs \
  --from-file=agent.crt \
  --from-file=agent.key \
  --from-file=ca.crt \
  -n home-app
```

### LAN Agent (Docker / standalone)

```bash
export CERT_FILE=/path/to/agent.crt
export KEY_FILE=/path/to/agent.key
export CA_FILE=/path/to/ca.crt
```

## Certificate Renewal

Agent certificates expire after 1 year. To renew:

```bash
# Create new CSR with existing key
openssl req -new -key agent.key -out agent-new.csr -subj "/CN=lan-agent/O=HomeApp"

# Sign new cert
openssl x509 -req -in agent-new.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out agent.crt -days 365

# Redeploy agent.crt to the agent (restart agent)
```

## Security Notes

- **Never** deploy `ca.key` to any server
- Store `ca.key` offline (USB drive, password manager, etc.)
- If `agent.key` is compromised, create a new agent cert and revoke the old one
- The CA cert (`ca.crt`) is not secret — it only verifies, not signs
- Each agent should have its own cert (don't share across agents)

## Troubleshooting

### "client certificate required"

The gateway didn't receive a client cert. Check:
- Agent has `CERT_FILE` and `KEY_FILE` set
- Files are readable by the agent process
- Agent is connecting via `wss://` (not `ws://`)

### "failed to verify certificate"

The agent's cert wasn't signed by the gateway's CA. Check:
- `ca.crt` on gateway matches the CA that signed `agent.crt`
- Run `openssl verify -CAfile ca.crt agent.crt` locally

### "certificate has expired"

Renew the agent certificate (see above).
