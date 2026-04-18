import type { Response } from "express";
import { env } from "../../config/env.js";

export const refreshCookieName = "refresh_token";

function crossOriginAuthCookies(): boolean {
  if (env.NODE_ENV !== "production") return false;
  try {
    const frontHost = new URL(env.FRONTEND_URL).hostname;
    const apiHost = new URL(env.SERVER_PUBLIC_URL).hostname;
    if (frontHost !== apiHost) return true;
    // API on Vercel but FRONTEND_URL still default — split client/API hosts need `SameSite=None`.
    if (
      process.env.VERCEL === "1" &&
      apiHost.endsWith(".vercel.app") &&
      frontHost === "localhost"
    ) {
      return true;
    }
    return false;
  } catch {
    return process.env.VERCEL === "1";
  }
}

export function setRefreshTokenCookie(res: Response, token: string): void {
  const cross = crossOriginAuthCookies();
  res.cookie(refreshCookieName, token, {
    httpOnly: true,
    secure: cross ? true : process.env.NODE_ENV === "production",
    sameSite: cross ? "none" : "lax",
    path: "/auth",
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
}

export function clearRefreshTokenCookie(res: Response): void {
  const cross = crossOriginAuthCookies();
  res.clearCookie(refreshCookieName, {
    path: "/auth",
    sameSite: cross ? "none" : "lax",
    secure: cross ? true : process.env.NODE_ENV === "production",
  });
}
