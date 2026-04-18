import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import Redis from "ioredis";
import { env } from "../config/env.js";

let redisClient: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redisClient === undefined) {
    if (!env.REDIS_URL) {
      redisClient = null;
    } else {
      redisClient = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
        lazyConnect: true,
        connectTimeout: 10_000,
      });
    }
  }
  return redisClient;
}

/**
 * Strict rate limit for /auth/login and /auth/register.
 * Uses Redis when REDIS_URL is set; otherwise falls back to in-memory store.
 */
export const authCredentialsLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  store: (() => {
    // Vitest (and local dev without a live Redis) should not eagerly connect during module import.
    // On Vercel, prefer the in-memory store: Redis-backed limiters have caused cold-start hangs with some Redis URLs.
    if (
      process.env.VITEST === "true" ||
      env.NODE_ENV !== "production" ||
      !env.REDIS_URL ||
      process.env.VERCEL === "1"
    ) {
      return undefined;
    }
    const redis = getRedis();
    if (!redis) return undefined;
    try {
      return new RedisStore({
        // ioredis call signature differs slightly from node-redis; cast for rate-limit-redis compatibility.
        sendCommand: ((...args: string[]) => {
          const [first, ...rest] = args;
          return redis.call(first, ...rest);
        }) as import("rate-limit-redis").SendCommandFn,
      });
    } catch (error) {
      // Fall back to memory store in dev if Redis boot/connection is unavailable.
      console.warn(
        "Auth limiter Redis unavailable, falling back to in-memory store",
        error,
      );
      return undefined;
    }
  })(),
});
