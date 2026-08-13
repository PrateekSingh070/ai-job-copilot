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

