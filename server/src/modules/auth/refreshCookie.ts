import type { Response } from "express";
import { env } from "../../config/env.js";

export const refreshCookieName = "refresh_token";

function crossOriginAuthCookies(): boolean {
  if (env.NODE_ENV !== "production") return false;
  // Split client/API on Vercel is the common case — always use third-party cookie rules.
  if (process.env.VERCEL === "1") return true;
  try {
    const frontHost = new URL(env.FRONTEND_URL).hostname;
    const apiHost = new URL(env.SERVER_PUBLIC_URL).hostname;
    return frontHost !== apiHost;
  } catch {
    return false;
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
