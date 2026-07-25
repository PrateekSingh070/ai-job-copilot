# AI Job Application Copilot

A full-stack job application tracker. Users register, add the jobs they've applied to,
move them across a Kanban board as they progress, see their conversion metrics, and
use one AI feature that rewrites resume bullets for a specific job posting.

**Stack:** React (Vite) + Tailwind on the frontend, Express + Prisma + PostgreSQL on the
backend, Zod for validation, JWT for auth. Everything is plain JavaScript (ESM).

```
Browser (React)  --HTTP-->  Express API  --Prisma-->  PostgreSQL
                                 |
                                 +--> OpenAI / Anthropic (or a local mock)
```

- `client/` — the React single-page app
- `server/` — the REST API and database layer

## Documentation

| Document | What's in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Diagrams for the system, the middleware chain, the auth flow and the data model |
| [docs/AI_LAYER.md](docs/AI_LAYER.md) | How `POST /ai/resume-tailor` works, and why each step exists |
| [docs/INTERVIEW_NOTES.md](docs/INTERVIEW_NOTES.md) | A walkthrough script, an end-to-end request trace, and known limitations |
| [docs/FRONTEND_INTERVIEW.md](docs/FRONTEND_INTERVIEW.md) | The client in depth: data fetching, auth, optimistic updates, and the weak spots |

## Running it

```bash
cp .env.example .env      # then set DATABASE_URL and the two JWT secrets
npm install

# Any PostgreSQL 16 will do; this is the quickest:
docker run -d --name copilot-db -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=copilot postgres:16-alpine

npm --prefix server run prisma:migrate
npm --prefix server run prisma:seed

npm run dev          # client on :5173, API on :4000
```

Demo login: `demo@copilot.local` / `DemoPass123!`

The AI feature works out of the box with no API key: `AI_PROVIDER` defaults to `mock`,
a deterministic local implementation. Set it to `openai` or `anthropic` with the matching
key to use a real model.

```bash
npm test     # 30 tests (26 server, 4 client)
npm run lint
npm run build
```

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

Ownership is enforced on every job route: queries always filter by `userId`, and a job
belonging to someone else returns `404` (not `403`) so we don't leak which ids exist.

## Layout

```
client/src
  main.jsx                  React entry point
  App.jsx                   Routes
  providers/AuthProvider    Login/register/logout + session bootstrap
  routes/ProtectedRoute     Redirects anonymous users to /login
  lib/api.js                Base URL, access token, axios + refresh-on-401 retry
  lib/dashboardHelpers.js   Pure helpers shared by the dashboard components
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
  middleware/index.js       requestId, auth, validation, rate limit, error handling
  modules/auth/             Register, login, refresh rotation, logout
  modules/jobs/             Job CRUD, filtering, metrics
  modules/ai/               Resume tailoring (mock + real providers)
  shared/index.js           Zod schemas for every request shape
  utils/http.js             ApiError + the response envelope
  utils/jwt.js              Sign/verify access and refresh tokens
  utils/sanitize.js         HTML stripping for storage and for prompts
```
