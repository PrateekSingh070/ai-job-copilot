import { Router } from "express";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/ApiError.js";
import {
  assertValidOAuthState,
  completeGithubOAuth,
  completeGoogleOAuth,
  getGithubAuthorizeUrl,
  getGoogleAuthorizeUrl,
} from "./oauth.service.js";
import { setRefreshTokenCookie } from "./refreshCookie.js";

const router = Router();

function oauthProviderStatus() {
  const stateConfigured = Boolean(
    env.OAUTH_STATE_SECRET && env.OAUTH_STATE_SECRET.length >= 16,
  );
  const googleConfigured = Boolean(
    stateConfigured && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
  );
  const githubConfigured = Boolean(
    stateConfigured && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET,
  );
  return {
    stateConfigured,
    googleConfigured,
    githubConfigured,
  };
}

router.get("/status", (_req, res) => {
  res.json({
    success: true,
    data: oauthProviderStatus(),
  });
});

router.get("/google", (_req, res, next) => {
  try {
    res.redirect(getGoogleAuthorizeUrl());
  } catch (error) {
    next(error);
  }
});

router.get("/google/callback", async (req, res, next) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    assertValidOAuthState(state);
    if (!code) {
      throw new ApiError(
        400,
        "OAUTH_CODE_MISSING",
        "Missing authorization code",
      );
    }
    const result = await completeGoogleOAuth(code);
    setRefreshTokenCookie(res, result.refreshToken);
    const target = `${env.FRONTEND_URL}/oauth/callback#access_token=${encodeURIComponent(result.accessToken)}`;
    res.redirect(target);
  } catch (error) {
    next(error);
  }
});

router.get("/github", (_req, res, next) => {
  try {
    res.redirect(getGithubAuthorizeUrl());
  } catch (error) {
    next(error);
  }
});

router.get("/github/callback", async (req, res, next) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    assertValidOAuthState(state);
    if (!code) {
      throw new ApiError(
        400,
        "OAUTH_CODE_MISSING",
        "Missing authorization code",
      );
    }
    const result = await completeGithubOAuth(code);
    setRefreshTokenCookie(res, result.refreshToken);
    const target = `${env.FRONTEND_URL}/oauth/callback#access_token=${encodeURIComponent(result.accessToken)}`;
    res.redirect(target);
  } catch (error) {
    next(error);
  }
});

export const oauthRouter = router;
