# User Management Guide

The auth-service has no registration page. Users are created via API. This guide shows how to create users and give them access.

## Overview

```
Auth Service (LAN)
├── POST /auth/users     → Create user
├── GET  /auth/users      → List users
├── DELETE /auth/users/{id} → Delete user
└── POST /auth/login     → Login (used by gateway)
```

## Prerequisites

- Auth service running on the LAN (accessible via `SERVICE_AUTH_SERVICE` in the LAN agent)
- The LAN agent is connected to the cloud gateway
- PostgreSQL is running with the `users` table (auto-created on startup)

## Method 1: Direct API (from LAN)

If you're on the LAN network, you can call the auth service directly:

### Create a user

```bash
curl -X POST http://localhost:8000/auth/users \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your-strong-password",
    "role": "admin"
  }'
```

**Response:**
```json
{
  "id": "a1b2c3d4-...",
  "username": "admin",
  "role": "admin",
  "created_at": "2026-07-14T19:00:00Z"
}
```

### List users

```bash
curl http://localhost:8000/auth/users
```

### Delete a user

```bash
curl -X DELETE http://localhost:8000/auth/users/a1b2c3d4-...
```

## Method 2: Via the Gateway (from internet)

Once the gateway and LAN agent are running, you can create users through the tunnel.

**Note:** The `/auth/users` endpoint is behind the gateway's JWT auth. You need to login first, then use the token.

### Step 1: Create the first user (bootstrap)

The first user must be created directly on the LAN (Method 1), because you can't get a JWT without a user.

### Step 2: Login via the gateway

```bash
curl -X POST https://gateway.yourdomain.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your-strong-password"
  }'
```

Wait — the gateway's `/login` endpoint handles this differently. Let me clarify:

```bash
# The gateway's /login endpoint (NOT /auth/login)
curl -X POST https://gateway.yourdomain.com/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your-strong-password"
  }'
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

### Step 3: Create more users (using the token)

```bash
# Save the token
TOKEN="eyJhbGciOiJIUzI1NiIs..."

# Create a new user
curl -X POST https://gateway.yourdomain.com/auth/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "tammy",
    "password": "their-password",
    "role": "user"
  }'
```

### Step 4: List all users

```bash
curl https://gateway.yourdomain.com/auth/users \
  -H "Authorization: Bearer $TOKEN"
```

### Step 5: Delete a user

```bash
curl -X DELETE https://gateway.yourdomain.com/auth/users/{user_id} \
  -H "Authorization: Bearer $TOKEN"
```

## Roles

Currently two roles are supported:

| Role | Access |
|------|--------|
| `admin` | Can create/delete users + access all services |
| `user` | Can access services (no user management) |

The gateway forwards `X-User-Role` header to all services. Services can use this to enforce their own authorization.

## Quick Bootstrap Script

Run this on your LAN machine to create the first user:

```bash
#!/bin/bash
# bootstrap-user.sh
# Run on the LAN where auth-service is accessible

AUTH_URL=${AUTH_URL:-"http://localhost:8000"}

echo "Creating admin user..."
read -p "Username: " USERNAME
read -s -p "Password: " PASSWORD
echo

curl -X POST "$AUTH_URL/auth/users" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\",\"role\":\"admin\"}"

echo
echo "User created. You can now login at the gateway."
```

```bash
chmod +x bootstrap-user.sh
./bootstrap-user.sh
```

## User Access Flow

```
1. Admin creates user via API
2. User goes to https://gateway.yourdomain.com/login
3. User enters username + password
4. Gateway → (tunnel) → auth-service → verifies password
5. Gateway signs JWT → returns to browser
6. User accesses services with JWT:
   https://gateway.yourdomain.com/home-app/...
   https://gateway.yourdomain.com/grafana/...
```

## Password Requirements

Currently no password policy is enforced. For better security, add validation in the auth-service:

- Minimum 8 characters
- Mix of letters and numbers
- No common passwords

This can be added to the `create_user` endpoint in `auth-service/app/routers/auth.py`.

## Security Notes

- Passwords are hashed with bcrypt (never stored in plain text)
- JWT tokens expire after 7 days
- Login is rate-limited (5 attempts per 60 seconds per username)
- Failed logins don't reveal whether the username exists
- The gateway never sees the password hash — only the auth-service does
