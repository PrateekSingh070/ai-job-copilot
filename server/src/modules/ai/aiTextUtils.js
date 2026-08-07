// Text helpers used only by the AI module: the first two power the offline
// mock provider, the third pulls JSON back out of a model's reply.

/**
 * Words that clear the length filter but carry no signal about what a role
 * actually needs. Without this, "looking", "developer" and "experience" rank
 * as extracted "skills" in every job description, which reads as noise in the
 * skill-gap output and pads the tailor's keyword list.
 *
 * Deliberately small and hand-picked: a full NLP stop-word list would also
 * drop genuinely useful terms, and job descriptions are short enough that the
 * common offenders are a closed set.
 */
const STOP_WORDS = new Set([
  "about",
  "across",
  "after",
  "against",
  "along",
  "among",
  "around",
  "because",
  "before",
  "being",
  "below",
  "between",
  "candidate",
  "company",
  "could",
  "developer",
  "during",
  "engineer",
  "every",
  "experience",
  "first",
  "from",
  "great",
  "have",
  "having",
  "help",
  "highly",
  "including",
  "into",
  "join",
  "just",
  "level",
  "like",
  "looking",
  "make",
  "many",
  "member",
  "might",
  "more",
  "most",
  "much",
  "must",
  "need",
  "opportunity",
  "other",
  "over",
  "part",
  "position",
  "prefer",
  "preferred",
  "role",
  "same",
  "seeking",
  "should",
  "since",
  "some",
  "strong",
  "such",
  "team",
  "than",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "until",
  "using",
  "very",
  "well",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "will",
  "with",
  "within",
  "would",
  "years",
  "your",
]);

/** Rough keyword extraction: long-ish words, deduped, stop-words removed. */
export function parseKeywords(jobDescription) {
  const words = jobDescription
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 4 && !STOP_WORDS.has(word));
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
