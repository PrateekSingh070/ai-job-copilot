import type { NextFunction, Request, Response } from "express";
import { nanoid } from "nanoid";

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.requestId = nanoid(12);
  res.setHeader("X-Request-Id", req.requestId);
  next();
}
