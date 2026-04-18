import bcrypt from "bcryptjs";
import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../utils/ApiError.js";
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../utils/jwt.js";
import { env } from "../../config/env.js";

export async function issueTokenPair(userId: string, email: string) {
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

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}) {
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

export async function loginUser(input: { email: string; password: string }) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  if (!user.passwordHash) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  const tokens = await issueTokenPair(user.id, user.email);
  return {
    user: { id: user.id, name: user.name, email: user.email },
    ...tokens,
  };
}

export async function rotateRefreshToken(currentRefreshToken: string) {
  let payload: { sub: string; email: string };
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

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
  });
  if (
    !storedToken ||
    storedToken.revoked ||
    storedToken.expiresAt < new Date()
  ) {
    throw new ApiError(
      401,
      "INVALID_REFRESH_TOKEN",
      "Refresh token expired or revoked",
    );
  }

  const newTokens = await issueTokenPair(payload.sub, payload.email);
  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: {
      revoked: true,
      replacedBy: hashToken(newTokens.refreshToken),
    },
  });

  return newTokens;
}

export async function revokeRefreshToken(refreshToken?: string) {
  if (!refreshToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken) },
    data: { revoked: true },
  });
}
