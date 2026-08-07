# AI Job Application Copilot

A full-stack job application tracker with AI-powered features. Users register, add jobs,
move them across a Kanban board, track conversion metrics, and use AI to tailor resumes,
generate cover letters, analyze skill gaps, import jobs from URLs, and chat over their
entire pipeline using semantic search.

**Stack:** React 19 (Vite) + Tailwind on the frontend, Express 5 + Prisma 7 + PostgreSQL 16
+ pgvector on the backend, Zod for validation, JWT for auth. Everything is plain JavaScript (ESM).

```
Browser (React)  --HTTP-->  Express API  --Prisma-->  PostgreSQL + pgvector
                                 |
                                 +--> OpenAI / Anthropic (or local mocks)
```

- `client/` — the React single-page app
- `server/` — the REST API and database layer

## Documentation

| Document | What's in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Diagrams for the system, the middleware chain, the auth flow and the data model |
| [docs/AI_LAYER.md](docs/AI_LAYER.md) | Every AI endpoint, the provider abstraction, and the RAG pipeline |
| [docs/INTERVIEW_NOTES.md](docs/INTERVIEW_NOTES.md) | A walkthrough script, an end-to-end request trace, and known limitations |
| [docs/FRONTEND_INTERVIEW.md](docs/FRONTEND_INTERVIEW.md) | The client in depth: data fetching, auth, optimistic updates, and the weak spots |

## Running it

```bash
cp .env.example .env      # then set DATABASE_URL and the two JWT secrets
npm install

# The pgvector image is required — the chat feature stores embeddings in a
# `vector` column, which stock postgres:16 cannot create.
docker run -d --name copilot-db -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=copilot pgvector/pgvector:pg16

npm --prefix server run prisma:migrate    # also enables the vector extension
npm --prefix server run prisma:seed

npm run dev          # client on :5173, API on :4000
```

Demo login: `demo@copilot.local` / `DemoPass123!`

Every AI feature works out of the box with no API key: `AI_PROVIDER` defaults to `mock`,
a deterministic local implementation, and embeddings fall back to a hash-based vector.
Set `AI_PROVIDER` to `openai` or `anthropic` with the matching key to use a real model.

Seeded jobs have no embeddings until you index them — click **Reindex** on the Ask tab
(or `POST /ai/reindex`) once after seeding. Jobs created afterwards are indexed on write.

```bash
npm test     # 92 tests (88 server, 4 client)
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
| GET | `/resume` | Fetch the saved master resume |
| PUT | `/resume` | Create or replace the saved master resume |
| DELETE | `/resume` | Delete the saved resume |
| POST | `/ai/resume-tailor` | Rewrite resume bullets for a job description |
| POST | `/ai/cover-letter` | Draft a cover letter from the resume and a job |
| POST | `/ai/skill-gap` | Compare resume skills against a posting's requirements |
| POST | `/ai/import-job` | Fetch a posting URL and extract company/role/description |
| POST | `/ai/chat` | Answer a question using semantic search over the user's jobs |
| POST | `/ai/reindex` | Rebuild embeddings for the caller's jobs |

Every response uses the same envelope: `{ success, data, meta? }` on success and
`{ success: false, error: { code, message } }` on failure.

Ownership is enforced on every job route: queries always filter by `userId`, and a job
belonging to someone else returns `404` (not `403`) so we don't leak which ids exist.
The same rule governs retrieval — `/ai/chat` takes the user id from the JWT, never from
the request body, so one user's question can never surface another user's applications.

`/ai/import-job` fetches a URL the user supplies, so it validates against SSRF: HTTP(S)
only, DNS resolved and checked against private ranges before connecting, redirects
re-validated per hop, and the response body size-capped.

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
  components/ResumeTailor   Rewrites resume bullets for one job
  components/ResumeProfile  Saved master resume, reused by the other AI tabs
  components/CoverLetter    Cover letter drafting
  components/SkillGap       Matched / missing skill breakdown
  components/JobImport      Paste a posting URL, prefill the add-job form
  components/PipelineChat   Chat over every tracked application
  components/TabBar         Shared tab switcher
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
  modules/resume/           Saved master resume CRUD
  modules/ai/               All AI features (mock + real providers)
    ai.service.js           Prompt building and provider dispatch
    aiFetch.js              Shared timeout/retry wrapper for provider calls
    embeddings.service.js   Embedding provider + deterministic hash fallback
    ragIndex.js             Embedding writes + pgvector similarity search
    resumeContext.js        Resolves the saved resume for the AI endpoints
  modules/scraper/          urlFetcher.js — SSRF-hardened fetch for job import
  shared/index.js           Zod schemas for every request shape
  utils/http.js             ApiError + the response envelope
  utils/jwt.js              Sign/verify access and refresh tokens
  utils/sanitize.js         HTML stripping for storage and for prompts
```
