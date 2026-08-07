import { sanitizeText } from "../../utils/sanitize.js";

// Turning a job posting page into something worth sending to a model. Most of
// a careers page is navigation, cookie banners and footer links; feeding all of
// it to the LLM wastes tokens and buries the actual description.

/** Blocks whose *contents* are noise, not just their tags. */
const DROP_BLOCKS =
  /<(script|style|noscript|nav|header|footer|svg|iframe|form|aside)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Tags that mark a structural break, so text either side shouldn't run together. */
const BLOCK_BOUNDARY = /<\/?(p|div|section|article|li|tr|h[1-6]|br|hr)\b[^>]*>/gi;

/**
 * Any whitespace that isn't a newline. Written as a negated class rather than
 * a list of characters because `&nbsp;` decodes to U+00A0 and job pages are
 * full of them — matching only ASCII space and tab would leave those behind as
 * visible padding that survives the per-line trim below.
 */
const HORIZONTAL_SPACE = /[^\S\n]+/g;

/**
 * `<title>` is the single most reliable signal on a job page — it's almost
 * always "Role — Company" or "Company: Role", and it's the one thing that
 * survives every template.
 */
export function extractTitle(html) {
  return firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
}

/** First `<h1>`, which on a job page is usually the role by itself. */
export function extractHeading(html) {
  return firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
}

/**
 * Shared tail for the two single-element extractors: decode, collapse runs of
 * whitespace to single spaces, and cap the length. Collapsing matters here as
 * much as in the body — these strings are what company/role are parsed out of,
 * and "Staff  Engineer" shouldn't become the role.
 */
function firstMatch(html, pattern) {
  const match = String(html ?? "").match(pattern);
  if (!match) return "";
  return sanitizeText(match[1])
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Strip a page down to readable text.
 *
 * Reuses `sanitizeText` for the actual tag-stripping and entity-decoding rather
 * than repeating that logic — this function's job is only to decide *what* to
 * keep and to preserve enough structure that the model can still see paragraph
 * boundaries.
 */
export function htmlToText(html, maxChars = 12000) {
  const withoutNoise = String(html ?? "").replace(DROP_BLOCKS, " ");

  // Insert newlines at block edges before stripping tags, or "…apply now" and
  // "Requirements" run together into one unreadable line.
  const withBreaks = withoutNoise.replace(BLOCK_BOUNDARY, "\n");

  return sanitizeText(withBreaks)
    .replace(HORIZONTAL_SPACE, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .slice(0, maxChars);
}

/**
 * Everything the extraction step needs from a fetched page, in one object.
 * Title and heading are kept separate from the body because they're far
 * higher-signal for company/role than any line in the description.
 */
export function parseJobPage(html) {
  return {
    title: extractTitle(html),
    heading: extractHeading(html),
    text: htmlToText(html),
  };
}
