import sanitizeHtml from "sanitize-html";

export function sanitizeText(input) {
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
  }).trim();
}
