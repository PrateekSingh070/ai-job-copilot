// Import-specifier rewriter for the TypeScript -> JavaScript migration.
//
// Pure function: given an import/export specifier string, rewrite only an
// explicit trailing TypeScript extension:
//   - a trailing ".ts"  -> ".js"
//   - a trailing ".tsx" -> ".jsx"
// while leaving the entire preceding path prefix byte-for-byte identical.
// Any specifier that does not end in ".ts"/".tsx" is returned unchanged.
//
// This implements Component 2 of the design (Import specifier rewriter) and
// Property 2 (Import-specifier rewriting changes only explicit TypeScript
// extensions). See Requirements 3.1 and 3.2.

/**
 * @param {string} spec - The import/export specifier string.
 * @returns {string} The rewritten specifier.
 */
export function rewriteSpecifier(spec) {
  // Check ".tsx" before ".ts". A string ending in ".tsx" does not end in
  // ".ts" (it ends in "sx"), so the two branches are mutually exclusive, but
  // ordering the more specific extension first keeps intent explicit.
  if (spec.endsWith(".tsx")) {
    return spec.slice(0, -".tsx".length) + ".jsx";
  }
  if (spec.endsWith(".ts")) {
    return spec.slice(0, -".ts".length) + ".js";
  }
  return spec;
}
