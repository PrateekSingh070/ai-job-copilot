# ADR-001: Separate Vercel projects for client and API

- **Status:** Accepted
- **Date:** 2026-06-01
- **Owner:** Prateek Singh

## Context

AI Job Copilot is a TypeScript monorepo with three workspaces: `client` (React + Vite + Tailwind SPA), `server` (Express + Prisma + PostgreSQL API), and `shared` (Zod schemas used by both).

The first deployment was attempted as a **single Vercel project** running the root `npm run build`. It failed:

- The root build triggers the server build, and the server requires `DATABASE_URL` at build time (Prisma client generation + `migrate deploy`).
- A unified build had no clean way to scope environment variables per package, and the client and API have fundamentally different runtimes (static SPA vs. serverless functions).

## Decision

Split the monorepo into **two Vercel projects**, each with its own root directory and build pipeline:

| Project | Root      | Build command                                              | Output               |
| ------- | --------- | ---------------------------------------------------------- | -------------------- |
| Client  | `client/` | `vite build`                                               | Static SPA           |
| API     | `server/` | `prisma migrate deploy && prisma db seed && npm run build` | Serverless functions |

The client resolves the API base URL via `VITE_API_URL`, falling back to the production API domain when deployed on Vercel.

## Consequences

**Positive**

- Clean, isolated build contexts — env vars scoped to the package that needs them.
- Independent deploy cadence; a client-only change doesn't rebuild/migrate the API.
- Matches the natural runtime boundary (static vs. serverless).

**Negative / tradeoffs**

- Two projects to manage instead of one.
- A shared env contract (`VITE_API_URL` ↔ API domain) must be kept in sync across both projects.

## Lessons

Map each package's **build-time dependencies** before choosing a deploy topology. The single-project approach optimized for "fewer moving parts," but the architecture actually wanted separation; the constraint surfaced only at the first failed build.
