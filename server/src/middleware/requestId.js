import { nanoid } from "nanoid";

export function requestIdMiddleware(req, res, next) {
  req.requestId = nanoid(12);
  res.setHeader("X-Request-Id", req.requestId);
  next();
}
