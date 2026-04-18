import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/ApiError.js";
import { issueTokenPair } from "./auth.service.js";

type OAuthUserResult = {
  user: { id: string; name: string; email: string };
  accessToken: string;
  refreshToken: string;
};

function requireStateSecret() {
  if (!env.OAUTH_STATE_SECRET || env.OAUTH_STATE_SECRET.length < 16) {
    throw new ApiError(
      501,
      "OAUTH_NOT_CONFIGURED",
      "Set OAUTH_STATE_SECRET (16+ chars) for OAuth.",
    );
  }
}

function requireOAuthSecrets(provider: "google" | "github") {
  requireStateSecret();
  if (
    provider === "google" &&
    (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
  ) {
    throw new ApiError(
      501,
      "OAUTH_NOT_CONFIGURED",
      "Google OAuth client id/secret are not configured.",
    );
  }
  if (
    provider === "github" &&
    (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET)
  ) {
    throw new ApiError(
      501,
      "OAUTH_NOT_CONFIGURED",
      "GitHub OAuth client id/secret are not configured.",
    );
  }
}

function signPayload(payload: string): string {
  const mac = crypto.createHmac("sha256", env.OAUTH_STATE_SECRET!);
  mac.update(payload);
  return `${payload}.${mac.digest("base64url")}`;
}

function verifySignedPayload(token: string): string | null {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto
    .createHmac("sha256", env.OAUTH_STATE_SECRET!)
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return payload;
}

export function createOAuthState(): string {
  requireStateSecret();
  const body = JSON.stringify({
    exp: Date.now() + 10 * 60 * 1000,
    n: crypto.randomUUID(),
  });
  const payload = Buffer.from(body, "utf8").toString("base64url");
  return signPayload(payload);
}

export function assertValidOAuthState(state: string | undefined): void {
  requireStateSecret();
  if (!state) {
    throw new ApiError(400, "OAUTH_STATE_INVALID", "Missing OAuth state");
  }
  const payload = verifySignedPayload(state);
  if (!payload) {
    throw new ApiError(400, "OAUTH_STATE_INVALID", "Invalid OAuth state");
  }
  const parsed = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as { exp: number };
  if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) {
    throw new ApiError(400, "OAUTH_STATE_EXPIRED", "OAuth state expired");
  }
}

export function getGoogleAuthorizeUrl(): string {
  requireOAuthSecrets("google");
  const redirectUri = `${env.SERVER_PUBLIC_URL}/auth/oauth/google/callback`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: createOAuthState(),
    access_type: "offline",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function getGithubAuthorizeUrl(): string {
  requireOAuthSecrets("github");
  const redirectUri = `${env.SERVER_PUBLIC_URL}/auth/oauth/github/callback`;
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID!,
    redirect_uri: redirectUri,
    scope: "read:user user:email",
    state: createOAuthState(),
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

async function upsertOAuthUser(params: {
  provider: string;
  providerAccountId: string;
  email: string;
  name: string;
}): Promise<OAuthUserResult> {
  const existingAccount = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: params.provider,
        providerAccountId: params.providerAccountId,
      },
    },
    include: { user: true },
  });

  if (existingAccount) {
    const tokens = await issueTokenPair(
      existingAccount.user.id,
      existingAccount.user.email,
    );
    return {
      user: {
        id: existingAccount.user.id,
        name: existingAccount.user.name,
        email: existingAccount.user.email,
      },
      ...tokens,
    };
  }

  const userByEmail = await prisma.user.findUnique({
    where: { email: params.email },
  });
  if (userByEmail) {
    await prisma.account.create({
      data: {
        userId: userByEmail.id,
        provider: params.provider,
        providerAccountId: params.providerAccountId,
      },
    });
    const tokens = await issueTokenPair(userByEmail.id, userByEmail.email);
    return {
      user: {
        id: userByEmail.id,
        name: userByEmail.name,
        email: userByEmail.email,
      },
      ...tokens,
    };
  }

  const user = await prisma.user.create({
    data: {
      name: params.name,
      email: params.email,
      passwordHash: null,
      accounts: {
        create: {
          provider: params.provider,
          providerAccountId: params.providerAccountId,
        },
      },
    },
  });

  const tokens = await issueTokenPair(user.id, user.email);
  return {
    user: { id: user.id, name: user.name, email: user.email },
    ...tokens,
  };
}

export async function completeGoogleOAuth(
  code: string,
): Promise<OAuthUserResult> {
  requireOAuthSecrets("google");
  const redirectUri = `${env.SERVER_PUBLIC_URL}/auth/oauth/google/callback`;
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID!,
    client_secret: env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) {
    throw new ApiError(
      400,
      "OAUTH_TOKEN_FAILED",
      "Google token exchange failed",
    );
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new ApiError(
      400,
      "OAUTH_TOKEN_FAILED",
      "Google token response missing access_token",
    );
  }

  const profileRes = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    },
  );
  if (!profileRes.ok) {
    throw new ApiError(
      400,
      "OAUTH_PROFILE_FAILED",
      "Google profile request failed",
    );
  }
  const profile = (await profileRes.json()) as {
    sub: string;
    email?: string;
    name?: string;
  };
  if (!profile.email) {
    throw new ApiError(
      400,
      "OAUTH_EMAIL_REQUIRED",
      "Google account email is required",
    );
  }

  return upsertOAuthUser({
    provider: "google",
    providerAccountId: profile.sub,
    email: profile.email,
    name: profile.name?.trim() || profile.email.split("@")[0] || "User",
  });
}

export async function completeGithubOAuth(
  code: string,
): Promise<OAuthUserResult> {
  requireOAuthSecrets("github");
  const redirectUri = `${env.SERVER_PUBLIC_URL}/auth/oauth/github/callback`;
  const body = new URLSearchParams({
    code,
    client_id: env.GITHUB_CLIENT_ID!,
    client_secret: env.GITHUB_CLIENT_SECRET!,
    redirect_uri: redirectUri,
  });

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!tokenRes.ok) {
    throw new ApiError(
      400,
      "OAUTH_TOKEN_FAILED",
      "GitHub token exchange failed",
    );
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new ApiError(
      400,
      "OAUTH_TOKEN_FAILED",
      "GitHub token response missing access_token",
    );
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "ai-job-copilot",
    },
  });
  if (!userRes.ok) {
    throw new ApiError(
      400,
      "OAUTH_PROFILE_FAILED",
      "GitHub profile request failed",
    );
  }
  const ghUser = (await userRes.json()) as {
    id: number;
    name?: string | null;
    login: string;
  };

  const emailsRes = await fetch("https://api.github.com/user/emails", {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "ai-job-copilot",
    },
  });
  if (!emailsRes.ok) {
    throw new ApiError(
      400,
      "OAUTH_PROFILE_FAILED",
      "GitHub emails request failed",
    );
  }
  const emails = (await emailsRes.json()) as Array<{
    email: string;
    primary?: boolean;
    verified?: boolean;
  }>;
  const primary =
    emails.find((e) => e.primary && e.verified) ??
    emails.find((e) => e.verified) ??
    emails[0];
  if (!primary?.email) {
    throw new ApiError(
      400,
      "OAUTH_EMAIL_REQUIRED",
      "GitHub account needs a verified email",
    );
  }

  return upsertOAuthUser({
    provider: "github",
    providerAccountId: String(ghUser.id),
    email: primary.email,
    name: ghUser.name?.trim() || ghUser.login,
  });
}
