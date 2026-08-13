import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Same order as src/config/env.js: root .env wins, server/.env is the
// fallback. A bare `dotenv/config` would only look in the server directory
// and miss the root file the README tells you to create.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDir, "../.env") });
dotenv.config({ path: path.resolve(currentDir, ".env") });

// `prisma generate` runs in environments with no database configured (CI,
// Vercel builds) — only migrate/seed genuinely need a reachable DATABASE_URL.
// The strict env() helper throws at CONFIG LOAD time when the variable is
// absent, which broke every build on machines without a .env. Fall back to a
// syntactically-valid placeholder so generate works anywhere; commands that
// actually connect will still fail loudly (on connection) if the real URL is
// missing.
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.js",
  },
  datasource: {
    url: databaseUrl,
  },
});
