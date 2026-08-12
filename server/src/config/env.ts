import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const serverEnvPath = path.resolve(currentDir, "../../.env");
const rootEnvPath = path.resolve(currentDir, "../../../.env");

// Load root-level .env first, then server/.env as fallback.
dotenv.config({ path: rootEnvPath });
dotenv.config({ path: serverEnvPath });

const envSchema = z.object({
  NODE_ENV: z
    .string()
    .default("development")
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.enum(["development", "test", "production"])),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:5173,http://localhost:5174"),
  AI_PROVIDER: z.enum(["mock", "openai", "anthropic"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(4000),
  AI_MAX_OUTPUT_TOKENS_RESUME: z.coerce.number().int().positive().default(450),
  AI_MAX_OUTPUT_TOKENS_COVER: z.coerce.number().int().positive().default(550),
  AI_MAX_OUTPUT_TOKENS_INTERVIEW: z.coerce
    .number()
    .int()
    .positive()
    .default(700),
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(8),
  REDIS_URL: z.string().optional(),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(900_000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  SERVER_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  OAUTH_STATE_SECRET: z.string().min(16).optional(),
  SENTRY_DSN: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  /** Absolute path to Vite `client/dist` for production (same-origin API + SPA). */
  CLIENT_STATIC_DIR: z.string().optional(),
});

export const env = envSchema.parse(process.env);
