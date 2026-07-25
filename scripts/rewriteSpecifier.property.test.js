// Feature: typescript-to-javascript-migration, Property 2: Import-specifier rewriting changes only explicit TypeScript extensions
//
// Validates: Requirements 3.1, 3.2
//
// Property 2: For any import/export specifier string, the specifier rewriter
// SHALL (a) rewrite a trailing ".ts" to ".js" and a trailing ".tsx" to ".jsx"
// while leaving the entire preceding path prefix byte-for-byte identical, and
// (b) return any specifier that does not end in ".ts"/".tsx" completely
// unchanged.

import { describe, it } from "vitest";
import fc from "fast-check";
import { rewriteSpecifier } from "./rewriteSpecifier.mjs";

describe("rewriteSpecifier (Property 2)", () => {
  it("(a) rewrites trailing .ts -> .js and .tsx -> .jsx, preserving the preceding path byte-for-byte", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.constantFrom(".ts", ".tsx"),
        (prefix, ext) => {
          const spec = prefix + ext;
          const result = rewriteSpecifier(spec);

          const expectedExt = ext === ".tsx" ? ".jsx" : ".js";
          const expected = prefix + expectedExt;

          // Result equals the untouched prefix + rewritten extension.
          if (result !== expected) {
            return false;
          }
          // The preceding path prefix is byte-for-byte identical.
          if (result.slice(0, prefix.length) !== prefix) {
            return false;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("(b) returns any non-.ts/.tsx specifier completely unchanged", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !s.endsWith(".ts") && !s.endsWith(".tsx")),
        (spec) => {
          return rewriteSpecifier(spec) === spec;
        },
      ),
      { numRuns: 100 },
    );
  });
});
