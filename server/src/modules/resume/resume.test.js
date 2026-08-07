import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetState, state } from "../../test/prismaMock.js";
import { signAccessToken } from "../../utils/jwt.js";

vi.mock("../../db/prisma.js", () => ({ prisma: prismaMock }));

const { app } = await import("../../app.js");

const token = () => signAccessToken({ sub: "u1", email: "owner@x.com" });

describe("Resume API", () => {
  beforeEach(() => {
    resetState();
    state.users.push({
      id: "u1",
      name: "Owner",
      email: "owner@x.com",
      passwordHash: "hash",
      createdAt: new Date(),
    });
  });

  it("GET /resume returns null when none saved", async () => {
    const res = await request(app)
      .get("/resume")
      .set("Authorization", `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it("PUT /resume creates a new resume", async () => {
    const res = await request(app)
      .put("/resume")
      .set("Authorization", `Bearer ${token()}`)
      .send({
        title: "My Software Resume",
        content: "a".repeat(100),
      });

    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe("u1");
    expect(res.body.data.title).toBe("My Software Resume");
    expect(state.resumes).toHaveLength(1);
  });

  it("PUT /resume updates an existing resume on second call", async () => {
    await request(app)
      .put("/resume")
      .set("Authorization", `Bearer ${token()}`)
      .send({ content: "first version with 50+ chars so it passes validation" });

    const res = await request(app)
      .put("/resume")
      .set("Authorization", `Bearer ${token()}`)
      .send({ content: "updated version with 50+ chars so it passes the min" });

    expect(res.status).toBe(200);
    expect(res.body.data.content).toContain("updated version");
    expect(state.resumes).toHaveLength(1);
  });

  it("DELETE /resume removes the saved resume", async () => {
    await request(app)
      .put("/resume")
      .set("Authorization", `Bearer ${token()}`)
      .send({ content: "x".repeat(60) });

    const res = await request(app)
      .delete("/resume")
      .set("Authorization", `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);
    expect(state.resumes).toHaveLength(0);
  });

  it("rejects content shorter than 50 characters", async () => {
    const res = await request(app)
      .put("/resume")
      .set("Authorization", `Bearer ${token()}`)
      .send({ content: "too short" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .get("/resume")
      .expect(401);

    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
