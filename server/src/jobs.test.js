import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetState, state } from "./test/prismaMock.js";
import { signAccessToken } from "./utils/jwt.js";

process.env.NODE_ENV = "test";
process.env.PORT = "4001";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.JWT_ACCESS_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
process.env.JWT_REFRESH_SECRET = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
process.env.CORS_ORIGIN = "http://localhost:5173";

vi.mock("./db/prisma.js", () => ({ prisma: prismaMock }));

const { app } = await import("./app.js");

describe("Jobs endpoints", () => {
  beforeEach(async () => {
    resetState();
    state.users.push({
      id: "u1",
      name: "Owner",
      email: "owner@x.com",
      passwordHash: "hash",
      createdAt: new Date(),
    });
    state.users.push({
      id: "u2",
      name: "Other",
      email: "other@x.com",
      passwordHash: "hash",
      createdAt: new Date(),
    });
  });

  it("creates and updates own job", async () => {
    const token = signAccessToken({ sub: "u1", email: "owner@x.com" });

    const createRes = await request(app)
      .post("/jobs")
      .set("Authorization", `Bearer ${token}`)
      .send({ company: "Acme", role: "Engineer", status: "APPLIED" });
    expect(createRes.status).toBe(201);

    const patchRes = await request(app)
      .patch(`/jobs/${createRes.body.data.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "INTERVIEW" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.status).toBe("INTERVIEW");
  });

  it("exports csv and returns recent activity", async () => {
    const token = signAccessToken({ sub: "u1", email: "owner@x.com" });
    await request(app)
      .post("/jobs")
      .set("Authorization", `Bearer ${token}`)
      .send({ company: "Acme", role: "Engineer", status: "APPLIED" });

    const csvRes = await request(app)
      .get("/jobs/export/csv")
      .set("Authorization", `Bearer ${token}`);
    expect(csvRes.status).toBe(200);
    expect(String(csvRes.headers["content-type"])).toMatch(/text\/csv/);
    expect(csvRes.text).toContain("company,role,status");
    expect(csvRes.text).toContain("Acme");

    const actRes = await request(app)
      .get("/jobs/activity/recent")
      .set("Authorization", `Bearer ${token}`);
    expect(actRes.status).toBe(200);
    expect(actRes.body.data.items.length).toBeGreaterThan(0);
  });

  it("blocks access to another user's job", async () => {
    state.jobs.push({
      id: "job-1",
      userId: "u2",
      company: "SecretCorp",
      role: "Role",
      status: "APPLIED",
      starred: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const token = signAccessToken({ sub: "u1", email: "owner@x.com" });
    const deleteRes = await request(app)
      .delete("/jobs/job-1")
      .set("Authorization", `Bearer ${token}`);
    expect(deleteRes.status).toBe(404);
  });
});
