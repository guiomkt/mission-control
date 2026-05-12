# Deploy — Mission Control on the OpenClaw VPS

> Target host: `srv1375161` (Hostinger), `31.97.173.51`.
> Tunnel: existing `cloudflared` on the host (3cc520f6-…fafed).
> Hostname: `mc.2be.com.br`.
> Access: Cloudflare Access policy, allowlist `rafael@2be.com.br`.

This document is the runbook a human (or future-Claude) follows to bring
the panel up cleanly. Re-run it on a fresh box and you should end with
the panel reachable at `https://mc.2be.com.br` behind Access.

## 0. Prerequisites

On the VPS:

- Docker + Compose plugin installed (Hostinger ships these).
- The `openclaw-kozw` container is already running — we'll mount its data
  volume read-only into our container.
- `cloudflared` daemon running with the existing tunnel token (already true).
- An empty path at `/docker/mission-control/`.

Locally (from your dev machine):

- `gh` authenticated as `guiomkt`.
- SSH config alias `hostinger` working (see `~/.ssh/config`).

## 1. Lay the deploy directory on the VPS

```bash
ssh hostinger 'sudo mkdir -p /docker/mission-control && sudo chown $USER /docker/mission-control'
```

Clone the hardened fork **next to** the deploy dir so compose's
build context (`../mission-control-src`) resolves:

```bash
ssh hostinger '
  cd /docker
  git clone -b hardening/v1 https://github.com/guiomkt/mission-control.git mission-control-src
'
```

Copy `docker-compose.yml` from the repo into the deploy dir (kept apart
so the repo can be rebased without disturbing live config):

```bash
ssh hostinger 'cp /docker/mission-control-src/docker-compose.yml /docker/mission-control/docker-compose.yml'
```

## 2. Generate the `.env`

The repo's `.env.example` lists every variable. Production minimum:

```env
ADMIN_PASSWORD=<random 24+ char string>
SESSION_SECRET=<random 48 char base64>
OPENCLAW_DIR=/workspace
OPENCLAW_WORKSPACE=/workspace/workspace
AUDIT_LOG_PATH=/app/data/audit.log
NEXT_PUBLIC_AGENT_NAME=Mission Control
NEXT_PUBLIC_APP_TITLE=Mission Control
```

Generate them locally and scp:

```bash
ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)
SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')

cat > /tmp/mc.env <<EOF
ADMIN_PASSWORD=$ADMIN_PASSWORD
SESSION_SECRET=$SESSION_SECRET
OPENCLAW_DIR=/workspace
OPENCLAW_WORKSPACE=/workspace/workspace
AUDIT_LOG_PATH=/app/data/audit.log
NEXT_PUBLIC_AGENT_NAME=Mission Control
NEXT_PUBLIC_APP_TITLE=Mission Control
EOF

scp /tmp/mc.env hostinger:/docker/mission-control/.env
ssh hostinger 'chmod 600 /docker/mission-control/.env && rm -f /tmp/mc.env'
rm /tmp/mc.env
```

Save the `ADMIN_PASSWORD` to your password manager before deleting the local copy.

## 3. Build and bring it up

```bash
ssh hostinger '
  cd /docker/mission-control
  docker compose pull --ignore-pull-failures
  docker compose up -d --build
  docker compose ps
'
```

First build takes ~2–4 min (Next.js compile + sqlite native build).

## 4. Sanity-check inside the box

```bash
ssh hostinger '
  echo "--- container status"
  docker ps --filter name=mission-control --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
  echo
  echo "--- /login should be HTTP 200 with auth cookie not set"
  curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3017/login
  echo
  echo "--- /api/health should be 200 JSON"
  curl -sS http://127.0.0.1:3017/api/health
  echo
  echo "--- /api/agents without cookie must be 401"
  curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3017/api/agents
'
```

If anything is off, `docker compose logs -f` is the first stop.

## 5. Cloudflare tunnel → `mc.2be.com.br`

The existing tunnel uses token-based config (the daemon stores nothing
locally; routes live in the Zero Trust dashboard).

In the Cloudflare dashboard:

1. **Zero Trust → Networks → Tunnels** → open the existing tunnel
   (`3cc520f6-dcfc-4457-a3d9-e15b6bd7faed`).
2. **Public Hostname → Add a public hostname:**
   - Subdomain: `mc`
   - Domain: `2be.com.br`
   - Service: `HTTP`
   - URL: `localhost:3017`
   - Additional settings → HTTP Host Header: `mc.2be.com.br`
3. Click **Save hostname**.

DNS happens automatically (Cloudflare creates a CNAME to the tunnel).

## 6. Cloudflare Access policy

1. **Zero Trust → Access → Applications → Add an application → Self-hosted.**
2. Application name: `Mission Control`
3. Session duration: `24 hours` (matches the JWT TTL inside the app).
4. Application domain: `mc.2be.com.br`
5. Save.
6. **Policies → Add a policy:**
   - Name: `Operator`
   - Action: `Allow`
   - Include: `Emails` → `rafael@2be.com.br`
7. Save.

The app login screen shows up only after Cloudflare Access lets you
through, so two factors are stacked.

## 7. First login

Go to `https://mc.2be.com.br`. Cloudflare prompts for your email (PIN by
email or your IdP if configured). Then you see the app's `/login` page
— paste the `ADMIN_PASSWORD` from step 2.

## 8. Rolling forward / rollback

Forward:

```bash
ssh hostinger '
  cd /docker/mission-control-src
  git fetch origin
  git checkout <new-branch-or-tag>
  cd /docker/mission-control
  docker compose up -d --build
'
```

Rollback (image-level):

```bash
ssh hostinger '
  cd /docker/mission-control-src
  git checkout <previous-sha>
  cd /docker/mission-control
  docker compose up -d --build
'
```

If a build is fundamentally broken, stop the service and revert the
public hostname routing in the Cloudflare dashboard to point elsewhere
while you fix it locally.

## 9. Logs and audit

- App logs: `docker compose logs -f` (rotated at 10MB × 5).
- Audit log (login/logout/cron attempts): `docker exec mission-control cat /app/data/audit.log`.
- Workspace volume is read-only; the panel cannot corrupt OpenClaw state.

## 10. Tearing it down

```bash
ssh hostinger '
  cd /docker/mission-control
  docker compose down
  docker volume rm mission-control-data
'
# In Cloudflare: remove the Public Hostname and the Access Application.
```
