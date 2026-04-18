import sanitizeHtml from "sanitize-html";

/**
 * Strips HTML/script, control characters, and homoglyph noise before text is interpolated into LLM prompts.
 */
export function sanitizeForAiPrompt(input: string, maxLen: number): string {
  const stripped = sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
  });
  // Strip C0 controls except TAB/LF/CR; keep newlines for resume/job text fidelity.
  /* eslint-disable no-control-regex */
  const noControls = stripped.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  /* eslint-enable no-control-regex */
  const normalized = noControls.normalize("NFKC");
  return normalized.slice(0, maxLen).trim();
}
