import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every rejection is the same generic 400 — asserting on the code rather than a
// distinguishing message is the point: a caller must not be able to tell
// "blocked private IP" from "connection refused".
const BLOCKED = { statusCode: 400, code: "IMPORT_URL_BLOCKED" };

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({
  default: { lookup: lookupMock },
  lookup: lookupMock,
}));

const { fetchJobPage } = await import("./urlFetcher.js");

const originalFetch = globalThis.fetch;

/** Minimal Response stand-in: a single-chunk stream plus the headers we read. */
function htmlResponse(html, { status = 200, headers = {} } = {}) {
  let sent = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "text/html; charset=utf-8", ...headers }),
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true };
          sent = true;
          return { done: false, value: Buffer.from(html) };
        },
        cancel: async () => {},
      }),
    },
  };
}

function publicDns() {
  lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
}

describe("fetchJobPage — SSRF defences", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rejects non-http(s) schemes without touching the network", async () => {
    await expect(fetchJobPage("file:///etc/passwd")).rejects.toMatchObject(BLOCKED);
    await expect(fetchJobPage("ftp://example.com/x")).rejects.toMatchObject(BLOCKED);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects a malformed URL", async () => {
    await expect(fetchJobPage("not a url")).rejects.toMatchObject(BLOCKED);
  });

  it("rejects localhost and internal suffixes by name", async () => {
    for (const url of [
      "http://localhost:4000/health",
      "http://api.local/jobs",
      "http://vault.internal/secret",
    ]) {
      await expect(fetchJobPage(url)).rejects.toMatchObject(BLOCKED);
    }
    // Blocked on the name alone — no DNS lookup should even be attempted.
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects private and reserved IP literals", async () => {
    const literals = [
      "http://127.0.0.1/",
      "http://10.1.2.3/",
      "http://172.16.5.4/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/", // cloud metadata
      "http://[::1]/",
      "http://[fd00::1]/",
    ];
    for (const url of literals) {
      await expect(fetchJobPage(url)).rejects.toMatchObject(BLOCKED);
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects an IPv4-mapped IPv6 form of the metadata address", async () => {
    await expect(
      fetchJobPage("http://[::ffff:169.254.169.254]/"),
    ).rejects.toMatchObject(BLOCKED);
  });

  it("rejects a public hostname that resolves to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(fetchJobPage("http://evil.example.com/")).rejects.toMatchObject(
      BLOCKED,
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects when any one of several records is private", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ]);
    await expect(fetchJobPage("http://mixed.example.com/")).rejects.toMatchObject(
      BLOCKED,
    );
  });

  it("re-validates every redirect hop", async () => {
    publicDns();
    globalThis.fetch.mockResolvedValueOnce({
      status: 302,
      ok: false,
      headers: new Headers({ location: "http://169.254.169.254/latest/meta-data/" }),
    });

    // The redirect target is a blocked literal, so the second hop never fetches.
    await expect(fetchJobPage("http://example.com/job")).rejects.toMatchObject(
      BLOCKED,
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("never asks the runtime to follow redirects itself", async () => {
    publicDns();
    globalThis.fetch.mockResolvedValue(htmlResponse("<html>ok</html>"));

    await fetchJobPage("http://example.com/job");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("gives up after too many redirects", async () => {
    publicDns();
    globalThis.fetch.mockResolvedValue({
      status: 302,
      ok: false,
      headers: new Headers({ location: "http://example.com/next" }),
    });

    await expect(fetchJobPage("http://example.com/job")).rejects.toMatchObject(
      BLOCKED,
    );
  });

  it("rejects a non-HTML content type", async () => {
    publicDns();
    globalThis.fetch.mockResolvedValue(
      htmlResponse("{}", { headers: { "content-type": "application/json" } }),
    );

    await expect(fetchJobPage("http://example.com/api")).rejects.toMatchObject(
      BLOCKED,
    );
  });

  it("rejects an oversized content-length before reading the body", async () => {
    publicDns();
    globalThis.fetch.mockResolvedValue(
      htmlResponse("<html></html>", {
        headers: { "content-length": String(50 * 1024 * 1024) },
      }),
    );

    await expect(fetchJobPage("http://example.com/huge")).rejects.toMatchObject(
      BLOCKED,
    );
  });

  it("collapses a network failure into the same generic error", async () => {
    publicDns();
    globalThis.fetch.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.1:22"));

    await expect(fetchJobPage("http://example.com/job")).rejects.toMatchObject(
      BLOCKED,
    );
    // The upstream message must not reach the caller.
    await expect(fetchJobPage("http://example.com/job")).rejects.not.toMatchObject(
      { message: expect.stringContaining("ECONNREFUSED") },
    );
  });

  it("returns HTML for a public host", async () => {
    publicDns();
    const html = "<html><body><h1>Senior Engineer</h1></body></html>";
    globalThis.fetch.mockResolvedValue(htmlResponse(html));

    const result = await fetchJobPage("http://example.com/job");

    expect(result.html).toBe(html);
    expect(result.finalUrl).toBe("http://example.com/job");
  });
});
