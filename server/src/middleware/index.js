import { nanoid } from "nanoid";
import { rateLimit } from "express-rate-limit";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { ApiError, sendError } from "../utils/http.js";
import { verifyAccessToken } from "../utils/jwt.js";

// Every cross-cutting concern the API has, in the order app.js applies them.

/** Tags each request so a log line and a 500 can be traced to each other. */
export function requestIdMiddleware(req, res, next) {
  req.requestId = nanoid(12);
  res.setHeader("X-Request-Id", req.requestId);
  next();
}

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

/** Rejects anything without a valid access token; sets `req.user`. */
export function requireAuth(req, _res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : undefined;

  if (!token) {
    throw new ApiError(401, "UNAUTHORIZED", "Missing access token");
  }

  try {
    req.user = verifyAccessToken(token);
    return next();
  } catch {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid or expired access token");
  }
}

// Parsing through a Zod schema replaces the request data with the parsed
// result, so handlers downstream can trust types, defaults and coercions.

export function validateBody(schema) {
  return (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
}

export function validateQuery(schema) {
  // Express 5 makes `req.query` a getter, so the parsed value goes on
  // `res.locals` instead of being assigned back.
  return (req, res, next) => {
    res.locals.validatedQuery = schema.parse(req.query);
    next();
  };
}

export function notFoundHandler(req, res) {
  return sendError(res, 404, "NOT_FOUND", `Route ${req.path} not found`);
}

/**
 * The only place an error becomes a response. Handlers throw; this decides the
 * status. Anything unrecognised is logged with its request id and reported as
 * a generic 500, so internals never leak to the client.
 */
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid request input",
      err.issues,
    );
  }

  if (err instanceof ApiError) {
    return sendError(res, err.statusCode, err.code, err.message, err.details);
  }

  console.error(`[${req.requestId}]`, err);
  return sendError(res, 500, "INTERNAL_SERVER_ERROR", "Something went wrong");
}
