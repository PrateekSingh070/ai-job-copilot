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

// Google and GitHub only differ by which authorize URL / token exchange runs,
// so the "start" and "callback" handlers are built from shared factories.
function startAuthorizeRedirect(getAuthorizeUrl) {
  return (_req, res, next) => {
    try {
      res.redirect(getAuthorizeUrl());
    } catch (error) {
      next(error);
    }
  };
}

function handleOAuthCallback(completeOAuth) {
  return async (req, res, next) => {
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
      const result = await completeOAuth(code);
      setRefreshTokenCookie(res, result.refreshToken);
      // Hand the access token back to the SPA via the URL fragment so it never
      // hits the server logs; the refresh token stays in the httpOnly cookie.
      const target = `${env.FRONTEND_URL}/oauth/callback#access_token=${encodeURIComponent(result.accessToken)}`;
      res.redirect(target);
    } catch (error) {
      next(error);
    }
  };
}

router.get("/google", startAuthorizeRedirect(getGoogleAuthorizeUrl));
router.get("/google/callback", handleOAuthCallback(completeGoogleOAuth));
router.get("/github", startAuthorizeRedirect(getGithubAuthorizeUrl));
router.get("/github/callback", handleOAuthCallback(completeGithubOAuth));

export const oauthRouter = router;
