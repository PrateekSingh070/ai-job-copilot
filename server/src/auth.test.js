import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetState } from "./test/prismaMock.js";

vi.mock("./db/prisma.js", () => ({ prisma: prismaMock }));

const { app } = await import("./app.js");

describe("Auth flow", () => {
  beforeEach(() => {
    resetState();
  });

  it("registers, logs in, reads /me, refreshes and logs out", async () => {
    const registerRes = await request(app).post("/auth/register").send({
      name: "Test User",
      email: "test@example.com",
      password: "Password123!",
    });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.data.accessToken).toBeTruthy();
    expect(registerRes.headers["set-cookie"]).toBeTruthy();

    const loginRes = await request(app).post("/auth/login").send({
      email: "test@example.com",
      password: "Password123!",
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers["set-cookie"][0];
    expect(cookie).toContain("refresh_token=");
    expect(cookie).toContain("HttpOnly");

    const meRes = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.data.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.email).toBe("test@example.com");

    const refreshRes = await request(app)
      .post("/auth/refresh")
      .set("Cookie", cookie);
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.accessToken).toBeTruthy();

    // The old refresh token was rotated, so replaying it must fail.
    const replayRes = await request(app)
      .post("/auth/refresh")
      .set("Cookie", cookie);
    expect(replayRes.status).toBe(401);

    const logoutRes = await request(app)
      .post("/auth/logout")
      .set("Cookie", cookie);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.data.loggedOut).toBe(true);
  });

  it("rejects duplicate emails and bad credentials", async () => {
    const payload = {
      name: "Test User",
      email: "dupe@example.com",
      password: "Password123!",
    };
    await request(app).post("/auth/register").send(payload);

    const duplicateRes = await request(app)
      .post("/auth/register")
      .send(payload);
    expect(duplicateRes.status).toBe(409);

    const wrongPasswordRes = await request(app)
      .post("/auth/login")
      .send({ email: "dupe@example.com", password: "WrongPass123!" });
    expect(wrongPasswordRes.status).toBe(401);
  });

  it("requires a valid access token on /auth/me", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  // Regression: refresh tokens used to be signed from `{ sub, email }` alone.
  // JWT `iat` is in whole seconds, so two refreshes inside the same second
  // produced an identical token, an identical sha256 hash, and a unique
  // constraint violation surfacing as a 500. A `jti` claim keeps them unique.
  it("survives several refreshes within the same second", async () => {
    const registerRes = await request(app).post("/auth/register").send({
      name: "Rapid User",
      email: "rapid@example.com",
      password: "Password123!",
    });
    let cookie = registerRes.headers["set-cookie"][0];
    const seen = new Set([cookie.split(";")[0]]);

    for (let i = 0; i < 4; i += 1) {
      const res = await request(app).post("/auth/refresh").set("Cookie", cookie);
      expect(res.status).toBe(200);
      cookie = res.headers["set-cookie"][0];
      const value = cookie.split(";")[0];
      expect(seen.has(value)).toBe(false);
      seen.add(value);
    }
  });

  // Reuse detection: presenting an already-rotated token means it leaked, so
  // the server revokes the user's entire token family — the thief's newer
  // token must die along with the replayed one.
  it("revokes the whole token family when a rotated token is replayed", async () => {
    const registerRes = await request(app).post("/auth/register").send({
      name: "Family User",
      email: "family@example.com",
      password: "Password123!",
    });
    const oldCookie = registerRes.headers["set-cookie"][0];

    // Rotate once: oldCookie is now revoked, newCookie is the live token.
    const rotateRes = await request(app)
      .post("/auth/refresh")
      .set("Cookie", oldCookie);
    expect(rotateRes.status).toBe(200);
    const newCookie = rotateRes.headers["set-cookie"][0];

    // Replay the old token — must fail AND poison the family.
    const replayRes = await request(app)
      .post("/auth/refresh")
      .set("Cookie", oldCookie);
    expect(replayRes.status).toBe(401);

    // The otherwise-valid new token is now dead too.
    const afterRes = await request(app)
      .post("/auth/refresh")
      .set("Cookie", newCookie);
    expect(afterRes.status).toBe(401);
  });

  it("rejects invalid register input", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ name: "T", email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("Health check", () => {
  it("reports ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ok");
  });
});

describe("CORS", () => {
  it("rejects a disallowed origin with a clean 403", async () => {
    const res = await request(app)
      .get("/health")
      .set("Origin", "http://evil.example.com");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CORS_ORIGIN_NOT_ALLOWED");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows a configured origin with credentials", async () => {
    const res = await request(app)
      .get("/health")
      .set("Origin", "http://localhost:5173");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});
