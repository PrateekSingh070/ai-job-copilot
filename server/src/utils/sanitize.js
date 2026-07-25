import sanitizeHtml from "sanitize-html";

// Two sanitizers for two destinations. `sanitizeText` cleans values on their
// way into the database; `sanitizeForAiPrompt` cleans values on their way into
// an LLM prompt, which needs stricter handling.

/** Strips HTML from free text before it is stored. */
export function sanitizeText(input) {
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
  }).trim();
}

/**
 * Strips HTML/script, control characters, and homoglyph noise before text is
 * interpolated into an LLM prompt, then caps the length to bound token cost.
 */
export function sanitizeForAiPrompt(input, maxLen) {
  const stripped = sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
  });
  // Strip C0 controls except TAB/LF/CR; keep newlines for resume/job text fidelity.
  /* eslint-disable no-control-regex */
  const noControls = stripped.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  /* eslint-enable no-control-regex */
  // NFKC folds full-width and look-alike characters down to plain ASCII, so an
  // instruction written in Cyrillic look-alikes cannot slip past a filter.
  const normalized = noControls.normalize("NFKC");
  return normalized.slice(0, maxLen).trim();
}
