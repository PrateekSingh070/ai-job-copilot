import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { jobsRouter } from "./modules/jobs/jobs.routes.js";
import { aiRouter } from "./modules/ai/ai.routes.js";
import { sendSuccess } from "./utils/response.js";

/** Paths handled by the API — other GET requests receive the SPA shell. */
function isApiPath(requestPath) {
  if (requestPath === "/health") return true;
  return /^\/(auth|jobs|ai)(\/|$)/.test(requestPath);
}

function mountClientSpa(app, staticDir) {
  const resolved = path.resolve(staticDir);
  if (!fs.existsSync(resolved)) {
    console.warn(
      `CLIENT_STATIC_DIR missing or not found (${resolved}); skipping static hosting`,
    );
    return;
  }
  app.use(express.static(resolved, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || isApiPath(req.path)) {
      next();
      return;
    }
    res.sendFile(path.join(resolved, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}

export const app = express();
app.set("trust proxy", 1);
const allowedOrigins = env.CORS_ORIGIN.split(",").map((origin) =>
  origin.trim(),
);

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin/server-to-server calls (no Origin header), the
      // configured origins, and any localhost port while developing.
      const isLocalhostDevOrigin =
        env.NODE_ENV === "development" &&
        Boolean(origin?.startsWith("http://localhost:"));
      if (!origin || allowedOrigins.includes(origin) || isLocalhostDevOrigin) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS origin not allowed"));
    },
    credentials: true,
  }),
);
app.use(requestIdMiddleware);
app.use(
  morgan(":method :url :status - :response-time ms", {
    skip: (req) => req.url.includes("health"),
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
// Coarse global limit (120 req/min per IP). Auth and AI routes add their own
// stricter limiters on top of this.
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.get("/health", (_req, res) =>
  sendSuccess(res, { status: "ok", uptime: Math.round(process.uptime()) }),
);
app.use("/auth", authRouter);
app.use("/jobs", jobsRouter);
app.use("/ai", aiRouter);

if (env.NODE_ENV === "production" && env.CLIENT_STATIC_DIR) {
  mountClientSpa(app, env.CLIENT_STATIC_DIR);
}

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
