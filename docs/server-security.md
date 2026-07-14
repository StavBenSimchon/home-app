# Server Security Guide

How to secure a Hetzner (or any) VPS running the cloud gateway.

## Overview

The VPS runs:
- Cloud gateway (Go) on ports 80/443
- SSH on port 22

Everything else should be blocked.

## Step 1: Initial Setup

```bash
# SSH into the server
ssh root@your-server-ip

# Update everything
apt update && apt upgrade -y

# Install essentials
apt install -y ufw fail2ban unattended-upgrades curl
```

## Step 2: SSH Key Only (Disable Password)

```bash
# On your local machine, copy SSH key to server
ssh-copy-id root@your-server-ip

# Test that key login works
ssh root@your-server-ip

# Disable password authentication
nano /etc/ssh/sshd_config
```

Set these in `sshd_config`:
```
PasswordAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
```

```bash
# Restart SSH
systemctl restart sshd
```

**Test in a new terminal before closing the current one!** Make sure you can still SSH in.

## Step 3: Firewall (UFW)

```bash
# Default deny everything
ufw default deny incoming
ufw default allow outgoing

# Allow SSH
ufw allow 22/tcp

# Allow HTTP and HTTPS (for gateway + Let's Encrypt)
ufw allow 80/tcp
ufw allow 443/tcp

# Enable
ufw enable

# Verify
ufw status verbose
```

**Output should show:**
```
22/tcp                     ALLOW IN    Anywhere
80/tcp                     ALLOW IN    Anywhere
443/tcp                   ALLOW IN    Anywhere
```

## Step 4: Fail2Ban (Brute Force Protection)

```bash
# Create custom config
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = 22

# Protect against HTTP brute force
[nginx-http-auth]
enabled = true
port = http,https
filter = nginx-http-auth
logpath = /var/log/nginx/error.log
maxretry = 3
EOF

# Restart
systemctl restart fail2ban
systemctl enable fail2ban
```

## Step 5: Automatic Security Updates

```bash
# Enable unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# Verify
cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id} ${distro_codename}-security";
    "${distro_id}ESMApps ${distro_codename}-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF

# Enable
systemctl enable unattended-upgrades
```

## Step 6: Let's Encrypt TLS

```bash
# Install certbot
apt install -y certbot

# Get certificate (stop gateway first if running on 443)
systemctl stop gateway  # if running

# Get cert
certbot certonly --standalone -d gateway.yourdomain.com

# Certificates will be at:
# /etc/letsencrypt/live/gateway.yourdomain.com/fullchain.pem
# /etc/letsencrypt/live/gateway.yourdomain.com/privkey.pem
```

### Auto-renewal

```bash
# Test renewal
certbot renew --dry-run

# Add cron job
echo "0 3 * * * certbot renew --quiet --deploy-hook 'systemctl restart gateway'" | crontab -
```

## Step 7: Deploy Gateway

```bash
# Create directory
mkdir -p /opt/gateway/certs
mkdir -p /opt/gateway/web

# Copy files
scp cloud-gateway binary root@server:/opt/gateway/
scp -r web/ root@server:/opt/gateway/
scp ca.crt root@server:/opt/gateway/certs/

# Create systemd service
cat > /etc/systemd/system/gateway.service << 'EOF'
[Unit]
Description=Cloud Gateway
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/gateway
ExecStart=/opt/gateway/gateway
Environment=LISTEN_ADDR=:443
Environment=TLS_CERT=/etc/letsencrypt/live/gateway.yourdomain.com/fullchain.pem
Environment=TLS_KEY=/etc/letsencrypt/live/gateway.yourdomain.com/privkey.pem
Environment=JWT_SECRET=your-jwt-secret-here
Environment=AGENT_CA_CERT=/opt/gateway/certs/ca.crt
Environment=ALLOWED_ORIGIN=https://yourdomain.com
Environment=ROUTES=/auth=auth-service,/home-app=home-app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
systemctl daemon-reload
systemctl enable gateway
systemctl start gateway

# Check logs
journalctl -u gateway -f
```

## Step 8: Verify Security

```bash
# Check open ports
ss -tlnp

# Should only show:
# 22 (SSH)
# 443 (HTTPS gateway)

# Check firewall
ufw status

# Check fail2ban
fail2ban-client status sshd

# Test SSL
curl -vI https://gateway.yourdomain.com/health 2>&1 | grep -E "SSL|TLS|HTTP"

# Should show TLS 1.3 and HTTP 2 200
```

## Security Checklist

- [ ] SSH key only (password disabled)
- [ ] Firewall: only 22, 80, 443 open
- [ ] Fail2ban running
- [ ] Automatic security updates enabled
- [ ] Let's Encrypt TLS with auto-renewal
- [ ] mTLS CA cert deployed (`AGENT_CA_CERT`)
- [ ] JWT_SECRET is a strong random string
- [ ] Gateway running as systemd service (auto-restart)
- [ ] No database on the VPS
- [ ] No credentials on the VPS (except JWT secret + CA cert)

## What the VPS Contains

| File/Config | Sensitive? | Purpose |
|-------------|-----------|---------|
| `ca.crt` | No (public cert) | Verifies agent client certs |
| `JWT_SECRET` (env) | Yes | Signs/verifies browser tokens |
| Let's Encrypt certs | No | Browser TLS |
| `web/login.html` | No | Login page |

**If the VPS is compromised:**
- Attacker gets `JWT_SECRET` → can mint fake tokens
- Attacker gets `ca.crt` → can verify (not create) agent certs
- Attacker does NOT get: passwords, DB access, or agent private keys

**Recovery:**
1. Rotate `JWT_SECRET` (invalidates all tokens, users re-login)
2. VPS is stateless — just redeploy
3. No data loss (all data is on your LAN)
