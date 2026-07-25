// Two sanitizers for two destinations. `sanitizeText` cleans values on their
// way into the database; `sanitizeForAiPrompt` cleans values on their way into
// an LLM prompt, which needs stricter handling.
//
// Implemented without sanitize-html: that package's CJS entry `require()`s
// htmlparser2, which is ESM-only, and Vercel's serverless loader crashes with
// ERR_REQUIRE_ESM. We only ever strip every tag, so a small local helper is
// enough and keeps the serverless bundle free of that incompatibility.

/** Strip every HTML tag and decode the common named entities. */
function stripHtml(input) {
  return String(input ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    );
}

/** Strips HTML from free text before it is stored. */
export function sanitizeText(input) {
  return stripHtml(input).trim();
}

/**
 * Strips HTML/script, control characters, and homoglyph noise before text is
 * interpolated into an LLM prompt, then caps the length to bound token cost.
 */
export function sanitizeForAiPrompt(input, maxLen) {
  const stripped = stripHtml(input);
  // Strip C0 controls except TAB/LF/CR; keep newlines for resume/job text fidelity.
  /* eslint-disable no-control-regex */
  const noControls = stripped.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  /* eslint-enable no-control-regex */
  // NFKC folds full-width and look-alike characters down to plain ASCII, so an
  // instruction written in Cyrillic look-alikes cannot slip past a filter.
  const normalized = noControls.normalize("NFKC");
  return normalized.slice(0, maxLen).trim();
}
