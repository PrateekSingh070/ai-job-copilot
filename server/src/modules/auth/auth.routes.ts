import { Router } from "express";
import { loginSchema, registerSchema } from "../../shared/index.js";
import { validateBody } from "../../middleware/validate.js";
import {
  loginUser,
  registerUser,
  revokeRefreshToken,
  rotateRefreshToken,
} from "./auth.service.js";
import { sendSuccess } from "../../utils/response.js";
import { ApiError } from "../../utils/ApiError.js";
import { requireAuth } from "../../middleware/auth.js";
import { prisma } from "../../db/prisma.js";
import { authCredentialsLimiter } from "../../middleware/authRateLimit.js";
import { oauthRouter } from "./oauth.routes.js";
import {
  clearRefreshTokenCookie,
  refreshCookieName,
  setRefreshTokenCookie,
} from "./refreshCookie.js";

const router = Router();

router.post(
  "/register",
  authCredentialsLimiter,
  validateBody(registerSchema),
  async (req, res) => {
    const result = await registerUser(req.body);
    setRefreshTokenCookie(res, result.refreshToken);

    return sendSuccess(
      res,
      {
        user: result.user,
        accessToken: result.accessToken,
      },
      201,
    );
  },
);

router.post(
  "/login",
  authCredentialsLimiter,
  validateBody(loginSchema),
  async (req, res) => {
    const result = await loginUser(req.body);
    setRefreshTokenCookie(res, result.refreshToken);
    return sendSuccess(res, {
      user: result.user,
      accessToken: result.accessToken,
    });
  },
);

router.post("/refresh", async (req, res) => {
  const refreshToken = req.cookies?.[refreshCookieName] as string | undefined;
  if (!refreshToken) {
    throw new ApiError(401, "INVALID_REFRESH_TOKEN", "Refresh token missing");
  }

  const newTokens = await rotateRefreshToken(refreshToken);
  setRefreshTokenCookie(res, newTokens.refreshToken);

  return sendSuccess(res, {
    accessToken: newTokens.accessToken,
  });
});

router.post("/logout", async (req, res) => {
  const refreshToken = req.cookies?.[refreshCookieName] as string | undefined;
  await revokeRefreshToken(refreshToken);
  clearRefreshTokenCookie(res);
  return sendSuccess(res, { loggedOut: true });
});

router.use("/oauth", oauthRouter);

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { id: true, name: true, email: true, createdAt: true },
  });
  if (!user) {
    throw new ApiError(404, "USER_NOT_FOUND", "User not found");
  }
  return sendSuccess(res, user);
});

export const authRouter = router;
