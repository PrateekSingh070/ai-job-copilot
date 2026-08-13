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

// One schema for every env var the server reads. Parsing at boot means a bad
// config fails fast instead of surfacing as a runtime error later.
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
  AI_PROVIDER: z.enum(["mock", "openai", "anthropic", "groq"]).default("mock"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(4000),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AI_MAX_OUTPUT_TOKENS_RESUME: z.coerce.number().int().positive().default(450),
  AI_MAX_OUTPUT_TOKENS_LETTER: z.coerce.number().int().positive().default(900),
  AI_MAX_OUTPUT_TOKENS_GAP: z.coerce.number().int().positive().default(600),
  AI_MAX_OUTPUT_TOKENS_CHAT: z.coerce.number().int().positive().default(700),
  AI_MAX_OUTPUT_TOKENS_IMPORT: z.coerce.number().int().positive().default(800),
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(8),
  EMBEDDING_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  EMBEDDING_MODEL: z.string().optional(),
  IMPORT_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  IMPORT_MAX_HTML_BYTES: z.coerce.number().int().positive().default(2_000_000),
  RAG_TOP_K: z.coerce.number().int().positive().default(6),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(900_000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  SERVER_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  SENTRY_DSN: z.string().optional(),
  /** Absolute path to Vite `client/dist` for production (same-origin API + SPA). */
  CLIENT_STATIC_DIR: z.string().optional(),
});

export const env = envSchema.parse(process.env);
