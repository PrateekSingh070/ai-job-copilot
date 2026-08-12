# AI Job Application Copilot

Production-ready full-stack portfolio project for freshers to track jobs and generate AI-assisted application assets.

## Features

- JWT auth with access token + refresh token rotation via httpOnly cookies
- Kanban job tracker with status drag/drop, filtering, pagination, and ownership checks
- AI endpoints for resume tailoring, cover letter generation, and interview prep
- AI generation history with version restore
- Dashboard metrics: total applications, stage distribution, interview rate, offer rate
- PDF export for generated outputs
- Typed API contract with Zod validation and consistent response shape
- Docker + docker-compose setup for local full-stack deployment

## Architecture

- `client/` React + TypeScript + Tailwind (`react-query`, route guards, Kanban + AI workspace)
- `server/` Express + TypeScript + Prisma + PostgreSQL
- `shared/` Zod schemas and shared TS contracts

## Quick Start

1. Copy env:
   - `cp .env.example .env`
2. Install dependencies:
   - `npm install`
   - `npm --prefix client install`
   - `npm --prefix server install`
   - `npm --prefix shared install`
   - `npm --prefix extension install`
3. Start Postgres (local or Docker):
   - `docker compose up -d postgres redis`
4. Run Prisma:
   - `npm --prefix server run prisma:generate`
   - `npm --prefix server run prisma:migrate -- --name init`
   - `npm --prefix server run prisma:seed`
5. Start apps:
   - `npm run dev`
6. Open:
   - Client: `http://localhost:5173`
   - API: `http://localhost:4000`

## Demo User (local dev)

- email: `demo@copilot.local`
- password: `DemoPass123!`

## Environment Variables

See `.env.example`.

### Switch from mock to real AI

Set one provider in `.env` and restart the server:

- OpenAI
  - `AI_PROVIDER=openai`
  - `OPENAI_API_KEY=<your_key>`
  - optional: `OPENAI_MODEL=gpt-4o-mini`

- Anthropic
  - `AI_PROVIDER=anthropic`
  - `ANTHROPIC_API_KEY=<your_key>`
  - optional: `ANTHROPIC_MODEL=claude-3-5-sonnet-latest`

The AI endpoints now send prompt templates to the selected provider and enforce structured JSON output with server-side validation.
You can reduce spend with:

- `AI_MAX_INPUT_CHARS`
- `AI_MAX_OUTPUT_TOKENS_RESUME`
- `AI_MAX_OUTPUT_TOKENS_COVER`
- `AI_MAX_OUTPUT_TOKENS_INTERVIEW`
- `AI_RATE_LIMIT_PER_MINUTE`

## API (high level)

- Auth: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`
- Jobs: `GET /jobs`, `POST /jobs`, `PATCH /jobs/:id`, `DELETE /jobs/:id`, `GET /jobs/metrics/summary`
- AI: `POST /ai/resume-tailor`, `POST /ai/cover-letter`, `POST /ai/interview-prep`, `GET /ai/history`, `POST /ai/history/:id/restore`
- Export: `POST /exports/pdf`
- Health: `GET /health`

## Quality & Testing

- Lint:
  - `npm run lint`
- Tests:
  - `npm run test`
- Server tests cover auth flow, job ownership, AI response shape.
- Client test covers login + create job flow.

## Browser Extension

- Build before loading unpacked extension:
  - `npm --prefix extension run build`
- In Chrome, use **Load unpacked** and select `extension/dist` (not `extension/src`).

## Deployment Guidance

### Local full stack

- `docker compose up --build`

### Production options

- API + DB: Render / Railway / Fly
- Client static app: Vercel / Netlify / Cloudflare Pages
- Set secure env vars in host dashboard
- Use managed PostgreSQL + Redis
- Set `CORS_ORIGIN` to your frontend domain

## Screenshots

- `docs/screenshots/dashboard.png` (placeholder)
- `docs/screenshots/kanban.png` (placeholder)
- `docs/screenshots/ai-workspace.png` (placeholder)
