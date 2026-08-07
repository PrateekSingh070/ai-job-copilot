import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetState, state } from "./test/prismaMock.js";
import { signAccessToken } from "./utils/jwt.js";

vi.mock("./db/prisma.js", () => ({ prisma: prismaMock }));

const { app } = await import("./app.js");

// AI_PROVIDER is "mock" in tests (see src/test/setupEnv.js), so no network calls.
const token = () => signAccessToken({ sub: "u1", email: "owner@x.com" });

const jobDescription =
  "Looking for a React TypeScript developer with REST API and PostgreSQL skills. " +
  "You will build scalable web apps and collaborate with a product team.";

const resumeText =
  "- Built project A with React and Node\n- Improved load time by 25 percent";

describe("POST /ai/cover-letter", () => {
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

  it("generates a letter from an explicit resumeText", async () => {
    const res = await request(app)
      .post("/ai/cover-letter")
      .set("Authorization", `Bearer ${token()}`)
      .send({ company: "Acme Labs", role: "Frontend Engineer", jobDescription, resumeText });

    expect(res.status).toBe(201);
    expect(res.body.data.model).toBe("mock");

    const { letterBody, subjectLine, wordCount, keyPointsUsed } =
      res.body.data.output;
    expect(letterBody.length).toBeGreaterThanOrEqual(3);
    expect(letterBody[0]).toContain("Acme Labs");
    expect(letterBody[0]).toContain("Frontend Engineer");
    expect(subjectLine).toContain("Acme Labs");
    expect(wordCount).toBeGreaterThan(50);
    expect(keyPointsUsed.length).toBeGreaterThan(0);
  });

  it("falls back to the saved resume when resumeText is omitted", async () => {
    state.resumes.push({
      id: "r1",
      userId: "u1",
      title: "My resume",
      content: resumeText.padEnd(60, " "),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .post("/ai/cover-letter")
      .set("Authorization", `Bearer ${token()}`)
      .send({ company: "Nova Systems", role: "Backend Engineer", jobDescription });

    expect(res.status).toBe(201);
    expect(res.body.data.output.letterBody[0]).toContain("Nova Systems");
  });

  it("returns RESUME_REQUIRED when there is no resume anywhere", async () => {
    const res = await request(app)
      .post("/ai/cover-letter")
      .set("Authorization", `Bearer ${token()}`)
      .send({ company: "Acme", role: "Engineer", jobDescription });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("RESUME_REQUIRED");
  });

  it("addresses a named hiring manager when one is given", async () => {
    const res = await request(app)
      .post("/ai/cover-letter")
      .set("Authorization", `Bearer ${token()}`)
      .send({
        company: "Acme",
        role: "Engineer",
        jobDescription,
        resumeText,
        hiringManager: "Priya Sharma",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.output.letterBody[0]).toContain("Dear Priya Sharma,");
  });

  it("rejects a job description that is too short", async () => {
    const res = await request(app)
      .post("/ai/cover-letter")
      .set("Authorization", `Bearer ${token()}`)
      .send({
        company: "Acme",
        role: "Engineer",
        jobDescription: "too short",
        resumeText,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/ai/cover-letter")
      .send({ company: "Acme", role: "Engineer", jobDescription, resumeText });

    expect(res.status).toBe(401);
  });
});
