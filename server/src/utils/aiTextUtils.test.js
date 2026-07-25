import { describe, expect, it } from "vitest";
import {
  extractFirstJsonObject,
  parseKeywords,
  scoreMatch,
} from "./aiTextUtils.js";

describe("aiTextUtils", () => {
  it("extracts keywords from a job description", () => {
    const k = parseKeywords(
      "We need a senior TypeScript engineer familiar with PostgreSQL, React, and distributed systems.",
    );
    expect(k.length).toBeGreaterThan(0);
    expect(
      k.some((w) => w.includes("typescript") || w.includes("engineer")),
    ).toBe(true);
  });

  it("scores resume keyword overlap", () => {
    const keywords = ["typescript", "react", "postgres"];
    const { score } = scoreMatch(
      "Built apps with TypeScript and React daily.",
      keywords,
    );
    expect(score).toBeGreaterThan(0);
  });

  it("extracts JSON from fenced code blocks", () => {
    const raw = 'Here you go:\n```json\n{"a":1}\n```';
    expect(extractFirstJsonObject(raw)).toBe('{"a":1}');
  });
});
