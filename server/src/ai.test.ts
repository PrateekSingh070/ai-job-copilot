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

describe("AI endpoints", () => {
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

  it("returns structured resume tailor output", async () => {
    const token = signAccessToken({ sub: "u1", email: "owner@x.com" });
    const res = await request(app)
      .post("/ai/resume-tailor")
      .set("Authorization", `Bearer ${token}`)
      .send({
        resumeText:
          "- Built project A with React and Node\n- Improved load time by 25%",
        jobDescription:
          "Looking for React TypeScript developer with REST API and PostgreSQL skills. Build scalable apps.",
        targetRole: "Frontend Engineer",
        tone: "impactful",
      });
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.data.output.rewrittenBullets)).toBe(true);
    expect(Array.isArray(res.body.data.output.extractedKeywords)).toBe(true);
    expect(typeof res.body.data.output.matchScore).toBe("number");
  });

  it("validates interview prep payload", async () => {
    const token = signAccessToken({ sub: "u1", email: "owner@x.com" });
    const res = await request(app)
      .post("/ai/interview-prep")
      .set("Authorization", `Bearer ${token}`)
      .send({
        jobDescription: "too short",
        candidateBackground: "also short",
      });
    expect(res.status).toBe(400);
  });

  it("returns structured resume tailor JSON output", async () => {
    const token = signAccessToken({ sub: "u1", email: "owner@x.com" });
    const res = await request(app)
      .post("/ai/resume-tailor-structured")
      .set("Authorization", `Bearer ${token}`)
      .send({
        resumeJson: {
          summary: "Full-stack engineer",
          skills: ["React", "TypeScript", "Node.js", "PostgreSQL"],
          experience: [
            {
              company: "Acme",
              role: "Software Engineer",
              points: [
                "Built dashboard features",
                "Improved API response time by 20%",
              ],
            },
          ],
          projects: [
            {
              name: "Analytics Portal",
              points: [
                "Implemented data visualizations",
                "Reduced load times by 30%",
              ],
            },
          ],
        },
        jobDescription:
          "Looking for a software engineer with TypeScript, React, REST APIs, and SQL optimization experience.",
      });
    expect(res.status).toBe(201);
    expect(typeof res.body.data.output.summary).toBe("string");
    expect(Array.isArray(res.body.data.output.skills)).toBe(true);
    expect(Array.isArray(res.body.data.output.experience)).toBe(true);
  });

  it("returns resume html payload from structured JSON", async () => {
    const token = signAccessToken({ sub: "u1", email: "owner@x.com" });
    const res = await request(app)
      .post("/ai/resume-html")
      .set("Authorization", `Bearer ${token}`)
      .send({
        resumeJson: {
          summary: "Backend engineer focused on APIs and reliability.",
          skills: ["TypeScript", "Node.js", "PostgreSQL"],
          experience: [
            {
              company: "Acme",
              role: "Software Engineer",
              updated_points: ["Built APIs with validation and tests."],
            },
          ],
          projects: [],
        },
      });
    expect(res.status).toBe(201);
    expect(typeof res.body.data.output.html).toBe("string");
    expect(res.body.data.output.html.toLowerCase()).toContain("<html");
  });

  it("returns provider status payload", async () => {
    const token = signAccessToken({ sub: "u1", email: "owner@x.com" });
    const res = await request(app)
      .get("/ai/provider-status")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.provider).toBeTruthy();
    expect(["connected", "key_missing", "mock_mode"]).toContain(
      res.body.data.status,
    );
  });
});
