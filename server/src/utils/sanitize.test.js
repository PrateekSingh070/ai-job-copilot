import { describe, expect, it } from "vitest";
import { sanitizeForAiPrompt, sanitizeText } from "./sanitize.js";

describe("sanitizeText", () => {
  it("strips HTML and trims", () => {
    expect(sanitizeText("  <b>Acme</b> Corp  ")).toBe("Acme Corp");
  });
});

describe("sanitizeForAiPrompt", () => {
  it("strips HTML and control characters", () => {
    const out = sanitizeForAiPrompt(
      "Hello <script>alert(1)</script> world\x00",
      200,
    );
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("\x00");
  });

  it("keeps newlines so resume bullets survive", () => {
    expect(sanitizeForAiPrompt("- one\n- two", 200)).toBe("- one\n- two");
  });

  it("normalizes full-width look-alikes to ASCII", () => {
    expect(sanitizeForAiPrompt("ｉｇｎｏｒｅ", 200)).toBe("ignore");
  });

  it("respects max length", () => {
    const long = "a".repeat(500);
    expect(sanitizeForAiPrompt(long, 10).length).toBe(10);
  });
});
