// Migration inventory + export-surface baseline generator.
// Dev-only migration tooling (Task 1.1). Not shipped, not a dependency.
// Enumerates first-party .ts/.tsx/.mts/.cts/.d.ts files per workspace and
// snapshots the value-level export surface of each source module (oracle for Property 1).
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const EXCLUDE_DIR = new Set(["node_modules", "dist", ".kiro", ".git", "artifacts", "build", "out", "coverage", ".husky"]);
const TS_EXT = new Set([".ts", ".tsx", ".mts", ".cts"]);

async function walk(dir, acc = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (EXCLUDE_DIR.has(e.name)) continue;
      await walk(full, acc);
    } else if (e.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

function toRel(full) {
  return path.relative(ROOT, full).split(path.sep).join("/");
}

function workspaceOf(rel) {
  const seg = rel.split("/")[0];
  if (["client", "server", "shared", "extension", "e2e"].includes(seg)) return seg;
  return "root";
}

const CONFIG_RE = /\.config\.[mc]?ts$/;
function classify(rel) {
  const base = rel.split("/").pop();
  if (base.endsWith(".d.ts")) return "ambientDeclaration";
  if (CONFIG_RE.test(base) || /^playwright\.config\.[mc]?ts$/.test(base)) return "buildConfig";
  if (base.endsWith(".tsx")) return "sourceTsx";
  return "sourceTs"; // .ts / .mts / .cts source
}

// Strip comments and string/template literals (replace with spaces) to reduce
// false matches when scanning for export/import keywords.
function stripNoise(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let state = "code"; // code | line | block | s | d | t
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; out += "  "; i += 2; continue; }
      if (c === "/" && c2 === "*") { state = "block"; out += "  "; i += 2; continue; }
      if (c === "'") { state = "s"; out += " "; i++; continue; }
      if (c === '"') { state = "d"; out += " "; i++; continue; }
      if (c === "`") { state = "t"; out += " "; i++; continue; }
      out += c; i++; continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; out += "\n"; i++; continue; }
      out += " "; i++; continue;
    }
    if (state === "block") {
      if (c === "*" && c2 === "/") { state = "code"; out += "  "; i += 2; continue; }
      out += c === "\n" ? "\n" : " "; i++; continue;
    }
    // string states
    const quote = state === "s" ? "'" : state === "d" ? '"' : "`";
    if (c === "\\") { out += "  "; i += 2; continue; }
    if (c === quote) { state = "code"; out += " "; i++; continue; }
    out += c === "\n" ? "\n" : " "; i++; continue;
  }
  return out;
}

// Extract value-level export binding names from source (type-only exports excluded).
function extractExports(src) {
  const code = stripNoise(src);
  const names = new Set();
  let hasDefault = false;
  let starReexport = false;

  // export default ...
  if (/\bexport\s+default\b/.test(code)) hasDefault = true;

  // export [async] function [*] NAME
  for (const m of code.matchAll(/\bexport\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // export [abstract] class NAME
  for (const m of code.matchAll(/\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // export const/let/var declarations (may declare multiple comma-separated bindings before '=')
  for (const m of code.matchAll(/\bexport\s+(?:const|let|var)\s+([^;=\n]+?)\s*=/g)) {
    // handle simple identifiers and comma lists; skip destructuring complexity conservatively
    const decl = m[1].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(decl)) {
      names.add(decl);
    } else if (/^[A-Za-z_$][\w$ ,]*$/.test(decl)) {
      decl.split(",").map((s) => s.trim()).filter(Boolean).forEach((s) => {
        if (/^[A-Za-z_$][\w$]*$/.test(s)) names.add(s);
      });
    } else {
      // destructuring export - capture identifiers
      for (const im of decl.matchAll(/[A-Za-z_$][\w$]*/g)) names.add(im[0]);
    }
  }
  // export { a, b as c } (exclude `export type { ... }`)
  for (const m of code.matchAll(/\bexport\s+(type\s+)?\{([^}]*)\}/g)) {
    if (m[1]) continue; // export type { ... }
    const inner = m[2];
    inner.split(",").forEach((part) => {
      const seg = part.trim();
      if (!seg) return;
      if (/^type\s+/.test(seg)) return; // inline `type X` specifier
      const asMatch = seg.match(/(?:\S+)\s+as\s+([A-Za-z_$][\w$]*)/);
      if (asMatch) { names.add(asMatch[1]); return; }
      const id = seg.match(/^([A-Za-z_$][\w$]*)/);
      if (id) names.add(id[1]);
    });
  }
  // export * [as NS] from '...'
  for (const m of code.matchAll(/\bexport\s+\*\s+(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\b/g)) {
    if (m[1]) names.add(m[1]);
    else starReexport = true;
  }

  return {
    exportNames: [...names].sort(),
    hasDefaultExport: hasDefault,
    hasStarReexport: starReexport,
  };
}

async function main() {
  const all = await walk(ROOT);
  const tsFiles = all
    .filter((f) => TS_EXT.has(path.extname(f)) || f.endsWith(".d.ts"))
    .map(toRel)
    .sort();

  const workspaces = { client: [], server: [], shared: [], extension: [], e2e: [], root: [] };
  const inventoryFiles = [];
  const baseline = {};

  for (const rel of tsFiles) {
    const ws = workspaceOf(rel);
    const category = classify(rel);
    const targetExt = rel.endsWith(".tsx") ? ".jsx" : ".js";
    const targetPath = category === "ambientDeclaration"
      ? null
      : rel.replace(/\.(tsx|ts|mts|cts)$/, targetExt);

    const rec = { path: rel, workspace: ws, category, targetPath };
    inventoryFiles.push(rec);
    workspaces[ws].push(rel);

    if (category === "sourceTs" || category === "sourceTsx") {
      const src = await fs.readFile(path.join(ROOT, rel), "utf8");
      baseline[rel] = extractExports(src);
    }
  }

  const counts = {
    total: inventoryFiles.length,
    sourceTs: inventoryFiles.filter((r) => r.category === "sourceTs").length,
    sourceTsx: inventoryFiles.filter((r) => r.category === "sourceTsx").length,
    buildConfig: inventoryFiles.filter((r) => r.category === "buildConfig").length,
    ambientDeclaration: inventoryFiles.filter((r) => r.category === "ambientDeclaration").length,
    byWorkspace: Object.fromEntries(Object.entries(workspaces).map(([k, v]) => [k, v.length])),
  };

  const inventory = {
    generatedAt: new Date().toISOString(),
    root: ROOT.split(path.sep).join("/"),
    description: "First-party TypeScript conversion inventory for the TS->JS migration. Excludes node_modules and generated output (dist/build/out/coverage).",
    excludedDirectories: [...EXCLUDE_DIR].sort(),
    failureReportingConvention: {
      shape: { file: "string (repo-relative path)", reason: "string (human-readable cause)" },
      note: "Any Source_File that cannot be converted is left unchanged and reported as { file, reason } (Requirement 1.8).",
    },
    counts,
    files: inventoryFiles,
  };

  await fs.writeFile("migration-inventory.json", JSON.stringify(inventory, null, 2) + "\n");

  const baselineDoc = {
    generatedAt: new Date().toISOString(),
    description: "Pre-migration value-level export surface per source module. Oracle for Property 1 (export-surface preservation). Type-only exports are intentionally excluded.",
    moduleCount: Object.keys(baseline).length,
    modules: baseline,
  };
  await fs.writeFile("migration-export-baseline.json", JSON.stringify(baselineDoc, null, 2) + "\n");

  console.log(JSON.stringify(counts, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
