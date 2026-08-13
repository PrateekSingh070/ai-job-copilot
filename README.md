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
                                 +--> Groq / OpenAI / Anthropic (or local mocks)
```

- `client/` — the React single-page app
- `server/` — the REST API and database layer
- `docs/` — architecture and AI-layer design notes

## Quick start

Requirements: Node 22+, Docker (for the database).

```bash
# 1. Install dependencies (npm workspaces — one install for both apps)
npm install

# 2. Start PostgreSQL 16 with pgvector
docker compose up -d

# 3. Configure the environment
cp .env.example .env
#    - generate the two JWT secrets:
#      node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#    - for real AI output, set GROQ_API_KEY (free at https://console.groq.com/keys)
#      or leave AI_PROVIDER=mock to run fully offline

# 4. Create the schema and seed demo data
npm --prefix server run prisma:migrate
npm --prefix server run prisma:seed

# 5. Run both apps (API on :4000, SPA on :5173)
npm run dev
```

Log in with the seeded demo account (see `server/prisma/seed.js`) or register a new one.

## AI providers

Set `AI_PROVIDER` in `.env`:

| Provider    | Needs                              | Notes                                        |
| ----------- | ---------------------------------- | -------------------------------------------- |
| `mock`      | nothing                            | Deterministic offline output; used by tests   |
| `groq`      | `GROQ_API_KEY`                     | Free tier, fast; default model llama-3.3-70b |
| `openai`    | `OPENAI_API_KEY`                   | Default model gpt-4o-mini                    |
| `anthropic` | `ANTHROPIC_API_KEY`                | Default model claude-3-5-sonnet-latest       |

Embeddings for the RAG chat are a separate switch (`EMBEDDING_PROVIDER`): `mock` is a
deterministic lexical baseline that works offline; `openai` uses text-embedding-3-small.
Groq has no embeddings API, so `mock` is the right pairing with `AI_PROVIDER=groq`.

Never commit `.env` — it is gitignored, and `.env.example` documents every variable.

## Tests and linting

```bash
npm test        # server (vitest + supertest, no database needed) and client
npm run lint    # eslint on both apps
```

The server suite runs entirely against an in-memory Prisma stand-in and the mock AI
provider, so it needs no network and no database. CI runs both suites on every push.

## Deployment notes

- `server/Dockerfile` and `client/Dockerfile` build production images; `vercel.json`
  files support a split Vercel deployment.
- The auth and AI rate limiters use an in-memory store keyed by user id. On a
  single server that is exactly right; on serverless (many instances) each instance
  keeps its own counters, so consider a shared store (e.g. Upstash Redis) if you
  need strict limits there.
- Set `SENTRY_DSN` to ship unexpected 500s to Sentry; without it error reporting is
  a no-op.

## License

MIT — see [LICENSE](./LICENSE).
