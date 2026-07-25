# AI Job Application Copilot

A full-stack job application tracker. Users register, add the jobs they've applied to,
move them across a Kanban board as they progress, see their conversion metrics, and
use one AI feature that rewrites resume bullets for a specific job posting.

**Stack:** React (Vite) + Tailwind on the frontend, Express + Prisma + PostgreSQL on the
backend, Zod for validation, JWT for auth. Everything is plain JavaScript (ESM).

## How it fits together

```
Browser (React)  --HTTP-->  Express API  --Prisma-->  PostgreSQL
                                 |
                                 +--> OpenAI / Anthropic (or a local mock)
```

- `client/` — the React single-page app
- `server/` — the REST API and database layer

## API

| Method | Route | What it does |
|---|---|---|
| GET | `/health` | Liveness check |
| POST | `/auth/register` | Create an account, return an access token |
| POST | `/auth/login` | Log in, return an access token |
| POST | `/auth/refresh` | Rotate the refresh token, issue a new access token |
| POST | `/auth/logout` | Revoke the refresh token |
| GET | `/auth/me` | Current user |
| GET | `/jobs` | List the user's jobs (filter by company/status/date, paginated) |
| POST | `/jobs` | Create a job |
| PATCH | `/jobs/:id` | Update a job (used by the Kanban drag-and-drop) |
| DELETE | `/jobs/:id` | Delete a job |
| GET | `/jobs/metrics/summary` | Totals, stage distribution, interview rate, offer rate |
| POST | `/ai/resume-tailor` | Rewrite resume bullets for a job description |

Every response uses the same envelope: `{ success, data, meta? }` on success and
`{ success: false, error: { code, message } }` on failure.

## Auth design (the part worth explaining)

- **Access token**: short-lived JWT, returned in the response body and held in memory
  on the client. Never written to `localStorage`.
- **Refresh token**: long-lived, sent as an `httpOnly` cookie so JavaScript can't read it.
- **Rotation**: each refresh revokes the old token row and records `replacedBy`, so a
  replayed token is detectable. See `server/src/modules/auth/auth.service.js`.
- On a `401`, the client calls `/auth/refresh` once and retries the original request.
  Concurrent 401s queue behind that single refresh — see `client/src/lib/api.js`.

## Data model

Three tables (`server/prisma/schema.prisma`):

- `User` — name, email, password hash
- `RefreshToken` — one row per issued refresh token, for rotation and revocation
- `JobApplication` — company, role, status (`APPLIED`/`INTERVIEW`/`OFFER`/`REJECTED`), notes

Ownership is enforced on every job route: queries always filter by `userId`, and a job
belonging to someone else returns `404` (not `403`) so we don't leak which ids exist.

## The AI feature

`POST /ai/resume-tailor` takes a resume, a job description and a target role, then returns
rewritten bullets, extracted keywords, a match score and an explanation.

`AI_PROVIDER` selects the backend:

- `mock` (default) — a deterministic local implementation, so the app and its tests run
  with no API key
- `openai` / `anthropic` — real calls; the response is parsed and validated against a Zod
  schema, so callers get the same shape either way

Free text is sanitized and length-capped before it goes into a prompt
(`server/src/utils/aiPromptSanitize.js`).

## Running it

```bash
cp .env.example .env
npm install

# start Postgres, then:
npm --prefix server run prisma:migrate
npm --prefix server run prisma:seed

npm run dev          # client on :5173, API on :4000
```

Demo login: `demo@copilot.local` / `DemoPass123!`

```bash
npm test     # 24 tests (20 server, 4 client)
npm run lint
npm run build
```

## Layout

```
client/src
  main.jsx                  React entry point
  App.jsx                   Routes
  providers/AuthProvider    Login/register/logout + session bootstrap
  routes/ProtectedRoute     Redirects anonymous users to /login
  lib/api.js                Axios instance + refresh-on-401 retry
  pages/LoginPage           Email/password sign in
  pages/RegisterPage        Account creation
  pages/DashboardPage       Metrics, add-job form, filters, pagination, tabs
  components/KanbanBoard    Four columns, HTML5 drag-and-drop
  components/ResumeTailor   The AI feature
  components/MetricCard     Single stat card
  ui/                       Tailwind class constants + inline SVG icons

server/src
  index.js                  Boots the HTTP server
  app.js                    Express setup: security, CORS, logging, rate limit, routes
  config/env.js             Validates environment variables on startup
  db/prisma.js              Prisma client singleton
  middleware/               auth (JWT), validate (Zod), errorHandler, requestId, rate limit
  modules/auth/             Register, login, refresh rotation, logout
  modules/jobs/             Job CRUD, filtering, metrics
  modules/ai/               Resume tailoring (mock + real providers)
  shared/index.js           Zod schemas for every request shape
  utils/                    ApiError, response helpers, JWT, sanitizers
```
