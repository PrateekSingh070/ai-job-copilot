import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetState } from "./test/prismaMock.js";

process.env.NODE_ENV = "test";
process.env.PORT = "4001";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.JWT_ACCESS_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
process.env.JWT_REFRESH_SECRET = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
process.env.CORS_ORIGIN = "http://localhost:5173";

vi.mock("./db/prisma.js", () => ({ prisma: prismaMock }));

const { app } = await import("./app.js");

describe("Auth flow", () => {
  beforeEach(() => {
    resetState();
  });

  it("registers, logs in, refreshes and logs out", async () => {
    const registerRes = await request(app).post("/auth/register").send({
      name: "Test User",
      email: "test@example.com",
      password: "Password123!",
    });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.success).toBe(true);
    expect(registerRes.body.data.accessToken).toBeTruthy();
    expect(registerRes.headers["set-cookie"]).toBeTruthy();

    const loginRes = await request(app).post("/auth/login").send({
      email: "test@example.com",
      password: "Password123!",
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers["set-cookie"][0];
    expect(cookie).toContain("refresh_token=");

    const refreshRes = await request(app)
      .post("/auth/refresh")
      .set("Cookie", cookie);
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.accessToken).toBeTruthy();

    const logoutRes = await request(app)
      .post("/auth/logout")
      .set("Cookie", cookie);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.data.loggedOut).toBe(true);
  });
});
