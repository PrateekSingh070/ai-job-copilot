import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetState, state } from "./test/prismaMock.js";
import { signAccessToken } from "./utils/jwt.js";

vi.mock("./db/prisma.js", () => ({ prisma: prismaMock }));

const { app } = await import("./app.js");

const authHeader = (userId, email) => [
  "Authorization",
  `Bearer ${signAccessToken({ sub: userId, email })}`,
];

describe("Jobs endpoints", () => {
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

  it("creates, lists, updates and deletes own job", async () => {
    const auth = authHeader("u1", "owner@x.com");

    const createRes = await request(app)
      .post("/jobs")
      .set(...auth)
      .send({ company: "Acme", role: "Engineer", status: "APPLIED" });
    expect(createRes.status).toBe(201);
    const jobId = createRes.body.data.id;

    const listRes = await request(app)
      .get("/jobs")
      .set(...auth);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.meta).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 1,
    });

    const patchRes = await request(app)
      .patch(`/jobs/${jobId}`)
      .set(...auth)
      .send({ status: "INTERVIEW" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.status).toBe("INTERVIEW");

    const deleteRes = await request(app)
      .delete(`/jobs/${jobId}`)
      .set(...auth);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.data.deleted).toBe(true);
  });

  it("filters by status and company and paginates", async () => {
    const auth = authHeader("u1", "owner@x.com");
    for (const job of [
      { company: "Acme", role: "Engineer", status: "APPLIED" },
      { company: "Acme Labs", role: "Designer", status: "INTERVIEW" },
      { company: "Nova", role: "Engineer", status: "APPLIED" },
    ]) {
      await request(app)
        .post("/jobs")
        .set(...auth)
        .send(job);
    }

    const statusRes = await request(app)
      .get("/jobs?status=APPLIED")
      .set(...auth);
    expect(statusRes.body.meta.total).toBe(2);

    const companyRes = await request(app)
      .get("/jobs?company=acme")
      .set(...auth);
    expect(companyRes.body.meta.total).toBe(2);

    const pageRes = await request(app)
      .get("/jobs?page=2&pageSize=2")
      .set(...auth);
    expect(pageRes.body.data).toHaveLength(1);
    expect(pageRes.body.meta.total).toBe(3);
  });

  it("blocks access to another user's job", async () => {
    state.jobs.push({
      id: "job-1",
      userId: "u2",
      company: "SecretCorp",
      role: "Role",
      status: "APPLIED",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const auth = authHeader("u1", "owner@x.com");
    const patchRes = await request(app)
      .patch("/jobs/job-1")
      .set(...auth)
      .send({ status: "OFFER" });
    expect(patchRes.status).toBe(404);

    const deleteRes = await request(app)
      .delete("/jobs/job-1")
      .set(...auth);
    expect(deleteRes.status).toBe(404);

    const listRes = await request(app)
      .get("/jobs")
      .set(...auth);
    expect(listRes.body.data).toHaveLength(0);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/jobs");
    expect(res.status).toBe(401);
  });

  it("summarises metrics for the caller", async () => {
    const auth = authHeader("u1", "owner@x.com");
    for (const status of ["APPLIED", "APPLIED", "INTERVIEW", "OFFER"]) {
      await request(app)
        .post("/jobs")
        .set(...auth)
        .send({ company: "Acme", role: "Engineer", status });
    }

    const res = await request(app)
      .get("/jobs/metrics/summary")
      .set(...auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      totalApplications: 4,
      stageDistribution: { APPLIED: 2, INTERVIEW: 1, OFFER: 1 },
      interviewRate: 25,
      offerRate: 25,
    });
  });

  it("returns zeroed metrics when there are no applications", async () => {
    const res = await request(app)
      .get("/jobs/metrics/summary")
      .set(...authHeader("u1", "owner@x.com"));
    expect(res.body.data).toEqual({
      totalApplications: 0,
      stageDistribution: {},
      interviewRate: 0,
      offerRate: 0,
    });
  });

  it("rejects invalid job input", async () => {
    const res = await request(app)
      .post("/jobs")
      .set(...authHeader("u1", "owner@x.com"))
      .send({ company: "", role: "Engineer" });
    expect(res.status).toBe(400);
  });
});
