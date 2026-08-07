import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetState, state } from "./test/prismaMock.js";
import { signAccessToken } from "./utils/jwt.js";

vi.mock("./db/prisma.js", () => ({ prisma: prismaMock }));

// Retrieval is stubbed: pgvector similarity cannot be emulated in-memory, and
// faking a ranking would only test the fake. The real SQL — including tenant
// isolation — is verified against a live pgvector container. What this file
// covers is the route contract around retrieval.
const { searchSimilarJobsMock, reindexUserJobsMock } = vi.hoisted(() => ({
  searchSimilarJobsMock: vi.fn(),
  reindexUserJobsMock: vi.fn(),
}));
vi.mock("./modules/ai/ragIndex.js", () => ({
  searchSimilarJobs: searchSimilarJobsMock,
  reindexUserJobs: reindexUserJobsMock,
  indexJobSafely: vi.fn().mockResolvedValue({ indexed: true }),
}));

const { app } = await import("./app.js");

const token = () => signAccessToken({ sub: "u1", email: "owner@x.com" });

const RETRIEVED = [
  {
    jobId: "job-1",
    content:
      "Company: Acme\nRole: Frontend Engineer\nStatus: APPLIED\nDescription: React and TypeScript.",
    score: 0.82,
  },
  {
    jobId: "job-2",
    content:
      "Company: Nova\nRole: Full Stack Developer\nStatus: INTERVIEW\nDescription: Node and React.",
    score: 0.64,
  },
];

describe("POST /ai/chat", () => {
  beforeEach(() => {
    resetState();
    searchSimilarJobsMock.mockReset();
    reindexUserJobsMock.mockReset();
    state.users.push({
      id: "u1",
      name: "Owner",
      email: "owner@x.com",
      passwordHash: "hash",
      createdAt: new Date(),
    });
  });

  it("answers from retrieved applications and cites them", async () => {
    searchSimilarJobsMock.mockResolvedValue(RETRIEVED);

    const res = await request(app)
      .post("/ai/chat")
      .set("Authorization", `Bearer ${token()}`)
      .send({ message: "Which of my applications mention React?" });

    expect(res.status).toBe(201);
    expect(res.body.data.model).toBe("mock");
    expect(res.body.data.retrievedCount).toBe(2);

    const { answer, citedJobIds } = res.body.data.output;
    expect(answer).toContain("Frontend Engineer");
    expect(answer).toContain("Acme");
    expect(citedJobIds).toEqual(["job-1", "job-2"]);
  });

  it("scopes retrieval to the authenticated user", async () => {
    searchSimilarJobsMock.mockResolvedValue([]);

    await request(app)
      .post("/ai/chat")
      .set("Authorization", `Bearer ${token()}`)
      .send({ message: "anything" });

    // The user id comes from the token, never from the request body.
    expect(searchSimilarJobsMock).toHaveBeenCalledWith("u1", "anything");
  });

  it("says so plainly when nothing matches", async () => {
    searchSimilarJobsMock.mockResolvedValue([]);

    const res = await request(app)
      .post("/ai/chat")
      .set("Authorization", `Bearer ${token()}`)
      .send({ message: "Do I have any Rust jobs?" });

    expect(res.status).toBe(201);
    expect(res.body.data.retrievedCount).toBe(0);
    expect(res.body.data.output.answer).toMatch(/could not find/i);
    expect(res.body.data.output.citedJobIds).toEqual([]);
  });

  it("accepts prior conversation turns", async () => {
    searchSimilarJobsMock.mockResolvedValue(RETRIEVED);

    const res = await request(app)
      .post("/ai/chat")
      .set("Authorization", `Bearer ${token()}`)
      .send({
        message: "Which are still open?",
        history: [
          { role: "user", content: "Which mention React?" },
          { role: "assistant", content: "Two of them." },
        ],
      });

    expect(res.status).toBe(201);
  });

  it("rejects a history longer than ten turns", async () => {
    const history = Array.from({ length: 11 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn ${i}`,
    }));

    const res = await request(app)
      .post("/ai/chat")
      .set("Authorization", `Bearer ${token()}`)
      .send({ message: "hi", history });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an empty message", async () => {
    const res = await request(app)
      .post("/ai/chat")
      .set("Authorization", `Bearer ${token()}`)
      .send({ message: "" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/ai/chat").send({ message: "hi" });
    expect(res.status).toBe(401);
  });
});

describe("POST /ai/reindex", () => {
  beforeEach(() => {
    resetState();
    reindexUserJobsMock.mockReset();
    state.users.push({
      id: "u1",
      name: "Owner",
      email: "owner@x.com",
      passwordHash: "hash",
      createdAt: new Date(),
    });
  });

  it("rebuilds embeddings for the caller and reports a summary", async () => {
    reindexUserJobsMock.mockResolvedValue({ total: 3, indexed: 2, skipped: 1 });

    const res = await request(app)
      .post("/ai/reindex")
      .set("Authorization", `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ total: 3, indexed: 2, skipped: 1 });
    expect(reindexUserJobsMock).toHaveBeenCalledWith("u1");
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/ai/reindex");
    expect(res.status).toBe(401);
  });
});
