import bcrypt from "bcryptjs";
import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../utils/http.js";
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../utils/jwt.js";
import { env } from "../../config/env.js";

export async function issueTokenPair(userId, email) {
  const accessToken = signAccessToken({ sub: userId, email });
  const refreshToken = signRefreshToken({ sub: userId, email });
  const tokenHash = hashToken(refreshToken);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + env.REFRESH_TOKEN_TTL_DAYS);

  await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt },
  });

  return { accessToken, refreshToken };
}

export async function registerUser(input) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  });
  if (existing) {
    throw new ApiError(409, "EMAIL_EXISTS", "Email already in use");
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
    },
  });
  const tokens = await issueTokenPair(user.id, user.email);
  return {
    user: { id: user.id, name: user.name, email: user.email },
    ...tokens,
  };
}

export async function loginUser(input) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Same error for "no such user" and "wrong password" so we never reveal
  // which emails are registered.
  if (!user) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  // Opportunistic cleanup: expired rows are dead weight — they can never be
  // rotated and reuse detection only needs revoked-but-unexpired rows. Doing
  // it on login keeps the table bounded without needing a cron job.
  // Fire-and-forget so a slow delete never delays the login response.
  void prisma.refreshToken
    .deleteMany({
      where: { userId: user.id, expiresAt: { lt: new Date() } },
    })
    .catch(() => {});

  const tokens = await issueTokenPair(user.id, user.email);
  return {
    user: { id: user.id, name: user.name, email: user.email },
    ...tokens,
  };
}

export async function rotateRefreshToken(currentRefreshToken) {
  let payload;
  try {
    payload = verifyRefreshToken(currentRefreshToken);
  } catch {
    throw new ApiError(
      401,
      "INVALID_REFRESH_TOKEN",
      "Refresh token expired or invalid",
    );
  }
  const tokenHash = hashToken(currentRefreshToken);

  // Atomically claim the token: flipping `revoked` false→true in a single
  // conditional update means exactly one of any concurrent refreshes wins.
  // The old check-then-update pair had a race where two requests could both
  // read revoked=false and both rotate.
  const claimed = await prisma.refreshToken.updateMany({
    where: { tokenHash, revoked: false, expiresAt: { gt: new Date() } },
    data: { revoked: true },
  });

  if (claimed.count === 0) {
    // The claim failed. If the row exists and is already revoked, this token
    // was rotated before and is now being replayed — either the user's copy
    // or a thief's. We can't tell which side is the attacker, so revoke the
    // whole family: every live token for this user dies and both sides must
    // log in again. This is what makes `replacedBy` reuse detection
    // actionable rather than just recorded.
    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { userId: true, revoked: true },
    });
    if (storedToken?.revoked) {
      await prisma.refreshToken.updateMany({
        where: { userId: storedToken.userId, revoked: false },
        data: { revoked: true },
      });
    }
    throw new ApiError(
      401,
      "INVALID_REFRESH_TOKEN",
      "Refresh token expired or revoked",
    );
  }

  // Revoke-then-issue, not issue-then-revoke: if we crash between the two
  // steps the user re-logs-in (annoying but safe) instead of two refresh
  // tokens being valid at once.
  const newTokens = await issueTokenPair(payload.sub, payload.email);
  await prisma.refreshToken.updateMany({
    where: { tokenHash },
    data: { replacedBy: hashToken(newTokens.refreshToken) },
  });

  return newTokens;
}

export async function revokeRefreshToken(refreshToken) {
  if (!refreshToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken) },
    data: { revoked: true },
  });
}
