import type { JwtPayload } from "jsonwebtoken";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: JwtPayload & { sub: string; email: string };
    }
  }
}

export {};
