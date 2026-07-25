// Text helpers used only by the AI module: the first two power the offline
// mock provider, the third pulls JSON back out of a model's reply.

/** Rough keyword extraction: long-ish words, deduped, capped at 12. */
export function parseKeywords(jobDescription) {
  const words = jobDescription
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 4);
  return [...new Set(words)].slice(0, 12);
}

/** Percentage of job keywords that appear anywhere in the resume. */
export function scoreMatch(resumeText, keywords) {
  const lowered = resumeText.toLowerCase();
  const hits = keywords.filter((kw) => lowered.includes(kw)).length;
  const score = Math.min(
    100,
    Math.round((hits / Math.max(keywords.length, 1)) * 100),
  );
  return {
    score,
    explanation: `Detected ${hits} of ${keywords.length} critical job keywords in your resume.`,
  };
}

/**
 * Models are asked for bare JSON and routinely return it wrapped in a ```json
 * fence or prefixed with prose. Try the fence, then the outermost braces, then
 * give up and let JSON.parse report the failure.
 */
export function extractFirstJsonObject(raw) {
  const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) return fencedMatch[1].trim();

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }
  return raw.trim();
}
