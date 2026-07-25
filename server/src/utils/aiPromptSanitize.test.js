import { describe, expect, it } from "vitest";
import { sanitizeForAiPrompt } from "./aiPromptSanitize.js";

describe("sanitizeForAiPrompt", () => {
  it("strips HTML and control characters", () => {
    const out = sanitizeForAiPrompt(
      "Hello <script>alert(1)</script> world\x00",
      200,
    );
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("\x00");
  });

  it("respects max length", () => {
    const long = "a".repeat(500);
    expect(sanitizeForAiPrompt(long, 10).length).toBe(10);
  });
});
