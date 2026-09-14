# CLAUDE.md

Context for Claude Code when working in this repository.

## What this is

**FPOWS** (Fire Protection Operations Web System) — an internal tool for **REDMEN / Redadair Fire Protection** that automates field-operations reporting. It pulls live job data from the **simPRO API**, serves a login-gated web dashboard, and emails an automated daily summary to management.

- Live domain: **https://fpows.redadair.com.au**
- Hosting: **Google Cloud Run** (project `fpows-500123`, service `bryan-fpows`, region `australia-southeast1`)
- Daily report fired by **Google Cloud Scheduler** (6:00 AM Asia/Manila) hitting `/api/trigger-manager-report`

## Tech stack

- **Node.js 20** (ES modules — `"type": "module"`), **Express 5** — all backend logic lives in one file: `server.js`
- Frontend is a single static `index.html` (vanilla HTML/CSS/JS), served by Express
- **simPRO API** as the data source (REST, Bearer token auth, via `axios`)
- **Google OAuth 2.0** for login (`google-auth-library`), restricted to `@redadair.com.au` emails
- **Nodemailer** over Gmail SMTP (port 465) for report emails
- `node-cron` for the in-process daily schedule; `helmet`, `express-rate-limit`, `express-session` for hardening

## Running locally

```powershell
npm install                 # node_modules is not committed
Copy-Item .env.example .env # then fill in real secrets
npm start                   # node server.js → http://localhost:3000
npm run dev                 # same, with --watch auto-reload
```

- **`NODE_ENV` must NOT be `production` locally** — otherwise `.env` is skipped (`server.js:18`) and OAuth redirects to the live domain instead of `localhost:3000`.
- Server **throws on startup** if `SIMPRO_BASE_URL` or `SIMPRO_ACCESS_TOKEN` are missing (`server.js:115`).

## Deploying

```powershell
.\deploy\deploy.ps1   # reads .env, deploys to Cloud Run, (re)creates the 6am scheduler job + uptime check
```

## Environment variables

See `.env.example` for the full annotated list. Every var is read via `process.env.*` near the top of `server.js` (lines 38–47) and passed through a `cleanEnv()` sanitizer. Required to boot: `SIMPRO_BASE_URL`, `SIMPRO_ACCESS_TOKEN`. Also needed for full function: `SMTP_USER`/`SMTP_PASS` (Gmail app password), `MANAGER_EMAIL`, `ADMIN_API_KEY`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`.

## Project structure

```
server.js                 # thin entry point: build app, register cron, listen
src/
  config.js               # env loading + cleanEnv + derived paths + OAuth client (fails fast)
  state.js                # shared in-memory cache (active customers)
  app.js                  # Express app assembly — middleware + router wiring ORDER lives here
  services/
    simpro.js             # getSimpro() — simPRO GET helper w/ 429 retry
    mailer.js             # getTransporter() + sendMailWithRetry()
    text.js               # decodeHtmlEntities, cleanDescriptionForClient, fullDescriptionForStaff
    fpow.js               # fetchFpowData() (core aggregation) + syncAssetDates()
    report.js             # sendManagerDailyReport()
    mcp.js                # FastMCP get_fpow_data tool (registered, not HTTP-served)
  middleware/
    auth.js               # requireAuth (session gate), requireApiKey (admin)
    rateLimit.js          # searchLimiter, emailLimiter, adminLimiter
  routes/
    pages.routes.js       # '/', '/version.txt'  (mounted BEFORE static)
    auth.routes.js        # /auth/*  — @redadair.com.au gate is here
    jobs.routes.js        # /api/job/:id
    customers.routes.js   # /api/customers/search, /:id/jobs, /api/latest-job, /api/schedules/today, /api/debug-cache
    email.routes.js       # /api/send-email, /api/logs, /api/delete-history
    presence.routes.js    # /api/presence/*  (+ in-memory presenceMap & cleanup interval)
    system.routes.js      # /api/ping, /health, /api/trigger-manager-report
  jobs/
    cron.js               # 6 AM Asia/Manila daily report schedule
public/                   # served web app: index.html, docs.html, logo.png, version.txt
data/                     # runtime read/write: email_history.jsonl, last_daily_report.txt
deploy/                   # deploy.ps1, take_screenshots.ps1, cloud-sql-proxy.exe
tests/                    # test_*.js developer scripts
scripts/                  # one-off diagnostic/maintenance scripts (+ scratch/, samples/)
docs/                     # documentation & generated artifacts (briefs, plans, PDFs)
```

## Agent (separate, optional — `agent/`)

`agent/` is a **standalone** Google ADK (Python) agent — "FRED" — deployable to
**Vertex AI Agent Engine** (managed sessions/memory/logging), powered by Gemini.
It is **not** part of the Node app and requires no UI/feature changes; it
integrates by calling the FPOWS REST API as **read-only tools** (no email/send
tool by design).

- Auth: the agent authenticates server-to-server via the `x-agent-key` header,
  checked in `src/middleware/auth.js` against `AGENT_API_KEY`. Set the same
  secret in FPOWS `.env` and `agent/.env`.
- The dashboard's built-in FRED widget is a separate, client-side rule-based
  helper (no LLM). Wiring it to this deployed agent is an optional future step.
- New FPOWS env flags: `AGENT_API_KEY` (programmatic API auth) and `DEV_NO_AUTH`
  (local-only login bypass; ignored when `NODE_ENV=production`).

## Conventions & gotchas

- **Middleware/route ORDER matters and is centralised in `src/app.js`:** helmet → json → session → `requireAuth` → auth routes → `pagesRouter` (the `/` shell) → `express.static(public/)` → API routers. The `/` route must stay before static.
- **Adding an endpoint:** create/extend a `src/routes/*.routes.js` router and mount it in `src/app.js`. Services (simPRO, mail, aggregation) go under `src/services/`.
- **Shared state:** the active-customers cache lives in `src/state.js` as `cache.customers` / `cache.customersTime` (mutated by the customers route, read by latest-job/debug-cache).
- **Admin endpoints** are guarded by `requireApiKey` — pass `ADMIN_API_KEY` via `x-admin-key` header or `?key=` query.
- `/health`, `/api/ping`, `/auth/*`, and `/api/trigger-manager-report` bypass the session gate (`requireAuth` in `src/middleware/auth.js`).
- `server.js` re-exports `sendManagerDailyReport` (imported by `scripts/trigger_manual.js`, which pulls from `src/services/report.js` directly to avoid booting the server).
- **Static serving is scoped to `public/`** (not the repo root) — this both keeps URLs working and avoids exposing repo files like `env.yaml`.
- **Testing caution:** never exercise `/api/send-email` or `/api/trigger-manager-report` in tests — they send real email to clients/management. Boot-test with read-only endpoints (`/health`, `/api/ping`) only.
- **Secrets hygiene:** `.env` and `env.yaml` are git-ignored. `env.yaml` still contains a real-looking simPRO token in git history — treat as compromised / rotate.
- Timezone for the schedule is **Asia/Manila**, recipient is `MANAGER_EMAIL`.
