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
import { exportRouter } from "./modules/export/export.routes.js";
import { resumesRouter } from "./modules/resumes/resumes.routes.js";
import { sendSuccess } from "./utils/response.js";

/** Paths handled by the API — other GET requests receive the SPA shell. */
function isApiPath(requestPath: string): boolean {
  if (requestPath === "/health") return true;
  return /^\/(auth|jobs|ai|exports|resumes)(\/|$)/.test(requestPath);
}

function mountClientSpa(app: express.Application, staticDir: string) {
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

/** Vercel preview + production client hosts for the default project names. */
function isDefaultDeployedClientOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return (
    origin.startsWith("https://ai-job-copilot-client") &&
    origin.endsWith(".vercel.app")
  );
}

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      const isLocalhostDevOrigin =
        env.NODE_ENV === "development" &&
        Boolean(origin?.startsWith("http://localhost:"));
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        isLocalhostDevOrigin ||
        isDefaultDeployedClientOrigin(origin)
      ) {
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
app.use("/exports", exportRouter);
app.use("/resumes", resumesRouter);

if (env.NODE_ENV === "production" && env.CLIENT_STATIC_DIR) {
  mountClientSpa(app, env.CLIENT_STATIC_DIR);
}

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
