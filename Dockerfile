# Production image: API + Vite SPA (same origin). Requires DATABASE_URL at runtime (Postgres with pgvector).
# Debian slim (not Alpine): Vite 8 / Rolldown needs glibc optional bindings.
FROM node:22-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY shared shared
COPY server server
COPY client client

# Workspace `shared` has `prepare` → build; sources must exist before npm ci.
RUN npm ci

# Work around npm optional-deps bug: native bindings missing under workspaces in Docker.
RUN npm install @rolldown/binding-linux-x64-gnu@1.0.0-rc.12 lightningcss-linux-x64-gnu@1.32.0 --no-save

# Prisma 7 loads prisma.config.ts which requires DATABASE_URL even for `generate`.
ARG DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV DATABASE_URL=$DATABASE_URL
RUN npm --prefix server run prisma:generate

# Same-origin API: browser calls the same host as the page.
ENV VITE_API_URL=
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV CLIENT_STATIC_DIR=/app/client/dist

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/server ./server
COPY --from=builder /app/client/dist ./client/dist

WORKDIR /app/server

EXPOSE 4000

CMD ["sh", "-c", "npx prisma generate && npx prisma migrate deploy && node dist/index.js"]
