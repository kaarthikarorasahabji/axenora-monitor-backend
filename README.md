---
title: Axenora Monitor Backend
emoji: "📊"
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# Axenora Monitor Backend

Production Node.js backend powering the **Axenora** employee monitoring and
workforce-analytics system, built by **Kaarthik Arora** for **Axenora AI**.

It is one half of the Axenora platform. The other half is the
[Axenora CRM Backend](https://github.com/kaarthikarorasahabji/axenora-crm-backend),
which embeds this monitor for live workforce visibility inside the CRM.

---

## Live deployments

| Component | URL |
|-----------|-----|
| Monitor API (this backend) | https://monitor-api.axenoraai.in |
| Hugging Face Space | https://huggingface.co/spaces/kaarthikdassarora/axenora-monitor-backend |
| Health checks | `GET /health`, `GET /api/health` |

---

## What it does

The Axenora Monitor is a multi-tenant workforce monitoring platform. A desktop
agent runs on each employee machine and streams activity, screenshots, and live
frames to this backend, which aggregates them into attendance records,
timesheets, productivity analytics, and real-time presence for managers.

### Activity & monitoring
- **Activity tracking** — per-employee application/window activity ingested
  from the desktop agent.
- **Screenshots & recordings** — periodic screenshots and session recordings,
  with configurable retention and automatic cleanup.
- **Live frames & presence** — real-time screen frames and online/offline
  presence over Socket.IO.

### Attendance & shifts
- **Attendance** — automatic check-in/out derived from activity, plus
  daily attendance rollups and an auto-checkout safety net.
- **Shifts & holidays** — shift definitions, per-employee shift assignment,
  and a holiday calendar.
- **Leave requests** — employee leave submission and review.
- **Timesheets** — computed working-hours timesheets per employee/day.

### Analytics & governance
- **Analytics** — productivity scoring driven by app-category rules
  (productive / unproductive / neutral).
- **Alerts** — threshold-based alerts (idle time, blocked-app usage, etc.).
- **Blocked apps & sites** — policy lists enforced by the agent.
- **Audit log** — tamper-evident record of administrative actions.

### Integration
- **CRM webhooks** — pushes events to the
  [Axenora CRM](https://github.com/kaarthikarorasahabji/axenora-crm-backend)
  via a signed webhook queue, and accepts embedded-login from the CRM through a
  shared secret so managers move between the two systems seamlessly.
- **API tokens** — scoped server-to-server tokens for the integration.

---

## Multi-tenancy & scale

- **Company-scoped** data and sockets — no cross-tenant leakage.
- Designed for **multiple worker processes** behind a Redis adapter for
  Socket.IO fan-out.
- **Object storage** for screenshots/recordings via MinIO (S3-compatible),
  with retention scheduling to control storage cost.

---

## Security

- **JWT access + refresh tokens** with separate signing secrets.
- **bcrypt** password hashing and **TOTP** 2FA (`otplib` + QR).
- **Helmet**, CORS allow-listing, and **rate limiting** on auth-sensitive
  routes.
- **Audit logging** of admin actions.

---

## Tech stack

- **Runtime**: Node.js, Express
- **Realtime**: Socket.IO
- **Database**: PostgreSQL via Sequelize (schema-scoped)
- **Cache / pub-sub**: Redis
- **Object storage**: MinIO (S3-compatible)
- **Auth**: jsonwebtoken, bcryptjs, otplib
- **Desktop agent**: bundled Windows installer (`dist/Axenora-WorkMonitor-Setup.exe`, tracked via Git LFS)
- **Deploy**: Docker on Hugging Face Spaces (`app_port: 7860`)

---

## Project layout

```
src/
├── server.js            # HTTP + Socket.IO bootstrap
├── app.js               # Express app and middleware wiring
├── routes/              # auth, admin, agent, dashboard, attendance,
│                        #   shifts, alerts, integrations, self
├── services/            # analytics, attendance, alerts, storage, recordings,
│                        #   liveFrames, retention, webhookQueue, redis, email
├── models/              # ~18 Sequelize models (User, Activity, Screenshot,
│                        #   AttendanceSession, Shift, Alert, AuditLog, ...)
├── sockets/             # live.js — realtime presence & frames
├── middleware/
└── utils/
db/                      # migrations / db setup
dist/                    # desktop agent + installer (Git LFS)
scripts/                 # maintenance scripts
tests/
Dockerfile / Dockerfile.hf
```

---

## Running locally

```bash
# 1. Create and fill the environment file
cp .env.example .env

# 2. Install dependencies
npm install

# 3. Run database migrations (and optional seed)
npm run migrate
npm run seed   # optional: seed an initial admin

# 4. Start the server
npm start      # or: npm run dev  (nodemon)
```

### Required environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `DB_SCHEMA` | Schema used for this tenant/deployment |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Access-token signing key |
| `REFRESH_TOKEN_SECRET` | Refresh-token signing key |
| `ALLOWED_ORIGINS` | CORS allow-list |
| `CRM_ORIGIN` | Origin of the Axenora CRM frontend |
| `CRM_WEBHOOK_URL` | CRM endpoint for outbound webhooks |
| `CRM_WEBHOOK_SECRET` | Signing secret for CRM webhooks |
| `INTEGRATION_API_KEY` | Server-to-server key shared with the CRM |
| `EMBED_LOGIN_SECRET` | Secret for CRM-embedded login |

See `.env.example` and `.env.production.example` for the complete list
(including MinIO/storage configuration).

---

## Deployment

The repo deploys as a Docker Space on Hugging Face. Push to the HF remote to
release; configure the secrets above in the Space settings. The container
serves on port `7860` and exposes `GET /health` and `GET /api/health`.

> Note: the desktop agent binaries under `dist/` are stored with **Git LFS**.
> Ensure `git lfs` is installed before cloning/pushing.

---

Built by **Kaarthik Arora** · **Axenora AI**
