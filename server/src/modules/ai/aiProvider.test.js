import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercises the real provider paths (which the mock provider normally skips)
// by replacing globalThis.fetch. Covers the JSON shapes models actually return,
// plus the failure modes aiFetch.js is built to handle: timeouts, retries on
// transient errors, and no-retry on client errors.

const originalFetch = globalThis.fetch;

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Shape OpenAI's chat completions endpoint returns. */
function openAiReply(content) {
  return jsonResponse({ choices: [{ message: { content } }] });
}

const validOutput = {
  rewrittenBullets: [
    "Built a React dashboard used by 5k people",
    "Cut API latency by 40 percent with query tuning",
    "Shipped a CI pipeline that caught regressions early",
  ],
  extractedKeywords: ["react", "node", "postgres", "typescript", "rest"],
  matchScore: 78,
  explanation:
    "Strong overlap on frontend skills, lighter on infrastructure experience.",
};

const input = {
  resumeText:
    "- Built project A with React and Node\n- Improved load time by 25 percent",
  jobDescription:
    "Looking for a React TypeScript developer with REST API and PostgreSQL skills.",
  targetRole: "Frontend Engineer",
  tone: "impactful",
};

describe("AI provider paths", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    // Keep retries fast so the suite doesn't wait on real backoff.
    process.env.AI_MAX_RETRIES = "2";
    process.env.AI_REQUEST_TIMEOUT_MS = "50";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.AI_PROVIDER = "mock";
    process.env.OPENAI_API_KEY = "";
    delete process.env.AI_MAX_RETRIES;
    delete process.env.AI_REQUEST_TIMEOUT_MS;
  });

  it("parses a clean JSON response", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(openAiReply(JSON.stringify(validOutput)));

    const { generateResumeTailor } = await import("./ai.service.js");
    const result = await generateResumeTailor(input);

    expect(result.model).toBe("gpt-4o-mini");
    expect(result.output.matchScore).toBe(78);
    expect(result.output.rewrittenBullets).toHaveLength(3);
  });

  it("calls Groq's OpenAI-compatible endpoint with JSON mode", async () => {
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "test-groq-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(openAiReply(JSON.stringify(validOutput)));
    globalThis.fetch = fetchMock;

    const { generateResumeTailor } = await import("./ai.service.js");
    const result = await generateResumeTailor(input);

    expect(result.model).toBe("llama-3.3-70b-versatile");
    expect(result.output.matchScore).toBe(78);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(options.headers.Authorization).toBe("Bearer test-groq-key");
    const body = JSON.parse(options.body);
    expect(body.response_format).toEqual({ type: "json_object" });

    delete process.env.GROQ_API_KEY;
  });

  it("parses JSON wrapped in a markdown fence", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        openAiReply(
          "Here's the result:\n```json\n" +
            JSON.stringify(validOutput) +
            "\n```",
        ),
      );

    const { generateResumeTailor } = await import("./ai.service.js");
    const result = await generateResumeTailor(input);

    expect(result.output.matchScore).toBe(78);
  });

  it("rejects a response that violates the output schema", async () => {
    // matchScore out of range and too few bullets.
    globalThis.fetch = vi.fn().mockResolvedValue(
      openAiReply(
        JSON.stringify({
          ...validOutput,
          matchScore: 500,
          rewrittenBullets: ["too few"],
        }),
      ),
    );

    const { generateResumeTailor } = await import("./ai.service.js");
    await expect(generateResumeTailor(input)).rejects.toThrow();
  });

  it("retries a 429 and succeeds on the next attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers(),
        text: async () => "rate limited",
      })
      .mockResolvedValueOnce(openAiReply(JSON.stringify(validOutput)));
    globalThis.fetch = fetchMock;

    const { generateResumeTailor } = await import("./ai.service.js");
    const result = await generateResumeTailor(input);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.output.matchScore).toBe(78);
  });

  it("does not retry a 400 — a bad request fails the same way every time", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
      text: async () => "invalid model",
    });
    globalThis.fetch = fetchMock;

    const { generateResumeTailor } = await import("./ai.service.js");
    await expect(generateResumeTailor(input)).rejects.toMatchObject({
      statusCode: 502,
      code: "OPENAI_API_ERROR",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a timeout as a 504 after exhausting retries", async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      return Promise.reject(error);
    });
    globalThis.fetch = fetchMock;

    const { generateResumeTailor } = await import("./ai.service.js");
    await expect(generateResumeTailor(input)).rejects.toMatchObject({
      statusCode: 504,
      code: "AI_TIMEOUT",
    });
    // Initial attempt plus AI_MAX_RETRIES.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("requires an API key before making any request", async () => {
    process.env.OPENAI_API_KEY = "";
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const { generateResumeTailor } = await import("./ai.service.js");
    await expect(generateResumeTailor(input)).rejects.toMatchObject({
      code: "OPENAI_KEY_MISSING",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
