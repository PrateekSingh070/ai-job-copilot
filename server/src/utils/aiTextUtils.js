export function parseKeywords(jobDescription) {
  const words = jobDescription
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 4);
  return [...new Set(words)].slice(0, 12);
}

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
