import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetState, state } from "./test/prismaMock.js";
import { signAccessToken } from "./utils/jwt.js";

vi.mock("./db/prisma.js", () => ({ prisma: prismaMock }));

const { app } = await import("./app.js");

// AI_PROVIDER is "mock" in tests (see src/test/setupEnv.js), so no network calls.
const token = () => signAccessToken({ sub: "u1", email: "owner@x.com" });

const validPayload = {
  resumeText:
    "- Built project A with React and Node\n- Improved load time by 25 percent",
  jobDescription:
    "Looking for React TypeScript developer with REST API and PostgreSQL skills. Build scalable apps.",
  targetRole: "Frontend Engineer",
  tone: "impactful",
};

describe("POST /ai/resume-tailor", () => {
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

  it("returns tailored bullets, keywords and a match score", async () => {
    const res = await request(app)
      .post("/ai/resume-tailor")
      .set("Authorization", `Bearer ${token()}`)
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.data.model).toBe("mock");
    const { rewrittenBullets, extractedKeywords, matchScore, explanation } =
      res.body.data.output;
    expect(rewrittenBullets.length).toBeGreaterThan(0);
    expect(rewrittenBullets[0]).toContain("Frontend Engineer");
    expect(extractedKeywords.length).toBeGreaterThan(0);
    expect(matchScore).toBeGreaterThanOrEqual(0);
    expect(matchScore).toBeLessThanOrEqual(100);
    expect(typeof explanation).toBe("string");
  });

  it("rejects payloads that are too short", async () => {
    const res = await request(app)
      .post("/ai/resume-tailor")
      .set("Authorization", `Bearer ${token()}`)
      .send({
        resumeText: "too short",
        jobDescription: "also short",
        targetRole: "Frontend Engineer",
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/ai/resume-tailor").send(validPayload);
    expect(res.status).toBe(401);
  });
});
