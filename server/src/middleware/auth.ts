import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError.js";
import { verifyAccessToken } from "../utils/jwt.js";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
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
