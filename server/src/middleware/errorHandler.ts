import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "../utils/ApiError.js";
import { sendError } from "../utils/response.js";

export function notFoundHandler(req: Request, res: Response) {
  return sendError(res, 404, "NOT_FOUND", `Route ${req.path} not found`);
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
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
