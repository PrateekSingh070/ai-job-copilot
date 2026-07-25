import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";

/**
 * Strict per-IP limit for /auth/login and /auth/register so credential
 * stuffing gets throttled. Uses the default in-memory store, which is fine
 * for a single API instance. Disabled in tests so suites stay independent.
 */
export const authCredentialsLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
});
