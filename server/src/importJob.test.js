import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetState, state } from "./test/prismaMock.js";
import { signAccessToken } from "./utils/jwt.js";

vi.mock("./db/prisma.js", () => ({ prisma: prismaMock }));

// Stub the fetcher rather than the network: the SSRF logic has its own
// dedicated suite, and this file is about the route's contract.
const { fetchJobPageMock } = vi.hoisted(() => ({ fetchJobPageMock: vi.fn() }));
vi.mock("./modules/scraper/urlFetcher.js", () => ({
  fetchJobPage: fetchJobPageMock,
}));

const { app } = await import("./app.js");

const token = () => signAccessToken({ sub: "u1", email: "owner@x.com" });

const JOB_HTML = `
<html>
  <head><title>Senior Backend Engineer — Nova Systems</title></head>
  <body>
    <nav>Home Careers Contact</nav>
    <h1>Senior Backend Engineer</h1>
    <div>
      <p>We are hiring a backend engineer in Bengaluru. Remote friendly.</p>
      <p>Compensation is $150,000 - $190,000 per year.</p>
      <p>You will build distributed services with Node and PostgreSQL.</p>
    </div>
    <footer>Privacy policy</footer>
    <script>window.analytics = 1;</script>
  </body>
</html>`;

describe("POST /ai/import-job", () => {
  beforeEach(() => {
    resetState();
    fetchJobPageMock.mockReset();
    state.users.push({
      id: "u1",
      name: "Owner",
      email: "owner@x.com",
      passwordHash: "hash",
      createdAt: new Date(),
    });
  });

  it("extracts structured fields from a fetched page", async () => {
    fetchJobPageMock.mockResolvedValue({
      html: JOB_HTML,
      finalUrl: "https://nova.example.com/jobs/42",
    });

    const res = await request(app)
      .post("/ai/import-job")
      .set("Authorization", `Bearer ${token()}`)
      .send({ url: "https://nova.example.com/jobs/42" });

    expect(res.status).toBe(201);
    expect(res.body.data.model).toBe("mock");

    const { company, role, jobDescription, confidence, jobUrl } =
      res.body.data.output;
    expect(role).toBe("Senior Backend Engineer");
    expect(company).toBe("Nova Systems");
    expect(jobDescription).toContain("distributed services");
    expect(confidence).toBeGreaterThan(50);
    // The resolved URL comes back so the client can prefill jobUrl.
    expect(jobUrl).toBe("https://nova.example.com/jobs/42");
  });

  it("strips nav, footer and script content out of the description", async () => {
    fetchJobPageMock.mockResolvedValue({
      html: JOB_HTML,
      finalUrl: "https://nova.example.com/jobs/42",
    });

    const res = await request(app)
      .post("/ai/import-job")
      .set("Authorization", `Bearer ${token()}`)
      .send({ url: "https://nova.example.com/jobs/42" });

    const { jobDescription } = res.body.data.output;
    expect(jobDescription).not.toContain("Privacy policy");
    expect(jobDescription).not.toContain("window.analytics");
    expect(jobDescription).not.toContain("Home Careers Contact");
  });

  it("picks up salary and location when the page states them", async () => {
    fetchJobPageMock.mockResolvedValue({
      html: JOB_HTML,
      finalUrl: "https://nova.example.com/jobs/42",
    });

    const res = await request(app)
      .post("/ai/import-job")
      .set("Authorization", `Bearer ${token()}`)
      .send({ url: "https://nova.example.com/jobs/42" });

    expect(res.body.data.output.salaryRange).toMatch(/150,000/);
    expect(res.body.data.output.location).toMatch(/remote/i);
  });

  it("accepts pasted text without fetching anything", async () => {
    const res = await request(app)
      .post("/ai/import-job")
      .set("Authorization", `Bearer ${token()}`)
      .send({
        rawText:
          "Frontend Engineer at Acme Labs. We need React and TypeScript skills. Hybrid in Pune.",
      });

    expect(res.status).toBe(201);
    expect(fetchJobPageMock).not.toHaveBeenCalled();
    expect(res.body.data.output.jobDescription).toContain("React");
  });

  it("rejects a request with both url and rawText", async () => {
    const res = await request(app)
      .post("/ai/import-job")
      .set("Authorization", `Bearer ${token()}`)
      .send({
        url: "https://example.com/job",
        rawText: "x".repeat(60),
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a request with neither url nor rawText", async () => {
    const res = await request(app)
      .post("/ai/import-job")
      .set("Authorization", `Bearer ${token()}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("surfaces a blocked URL as a generic 400", async () => {
    const { ApiError } = await import("./utils/http.js");
    fetchJobPageMock.mockRejectedValue(
      new ApiError(400, "IMPORT_URL_BLOCKED", "That URL could not be fetched."),
    );

    const res = await request(app)
      .post("/ai/import-job")
      .set("Authorization", `Bearer ${token()}`)
      .send({ url: "http://169.254.169.254/latest/meta-data/" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("IMPORT_URL_BLOCKED");
  });

  it("never writes a job row — extraction is review-then-save", async () => {
    fetchJobPageMock.mockResolvedValue({
      html: JOB_HTML,
      finalUrl: "https://nova.example.com/jobs/42",
    });

    await request(app)
      .post("/ai/import-job")
      .set("Authorization", `Bearer ${token()}`)
      .send({ url: "https://nova.example.com/jobs/42" });

    expect(state.jobs).toHaveLength(0);
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/ai/import-job")
      .send({ url: "https://example.com/job" });

    expect(res.status).toBe(401);
  });
});
