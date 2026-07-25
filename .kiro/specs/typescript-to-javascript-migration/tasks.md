# Implementation Plan: TypeScript to JavaScript Migration

## Overview

This plan converts the `ai-job-copilot` monorepo from TypeScript to plain JavaScript/JSX through a mechanical type-stripping, file-rename, and tooling-cleanup operation. Work proceeds workspace by workspace in dependency order — `shared` first (consumed by `client` and `server`), then `server`, `client`, `extension`, and `e2e`, followed by root configuration/scripts and a full verification gate. The `detype` CLI (a dev-only tool, never a project dependency) strips types and renames files, Prettier normalizes output, and manual cleanup handles awkward constructs. ESM is preserved everywhere; no module-system change occurs. Three property-based tests using `fast-check` verify the input-varying aspects of the migration.

## Tasks

- [ ] 1. Set up migration tooling and inventory
  - [ ] 1.1 Establish the migration toolchain and capture the pre-migration baseline
    - Add `detype` and `fast-check` as dev-only tooling available to the migration (do NOT add `detype` as a project dependency in any shipped `package.json`)
    - Enumerate all first-party `.ts`/`.tsx` source files and `.d.ts` files per workspace (`client`, `server`, `shared`, `extension`, `e2e`), excluding `node_modules` and generated output, to produce the conversion inventory
    - Capture a snapshot of the pre-migration value-level export surface (exported binding names per module) to serve as the oracle for Property 1
    - Record a failure-reporting convention `{ file, reason }` for any file that cannot be converted
    - _Requirements: 1.5, 1.8_

- [ ] 2. Migrate the `shared` workspace
  - [ ] 2.1 Convert `shared` source to JavaScript
    - Strip all type syntax from `shared/src/index.ts` and rename to `shared/src/index.js`, erasing generic parameters (e.g. `successResponseSchema<T extends ...>`) while preserving every value-level import/export
    - Delete the original `.ts` file after conversion; run Prettier normalization
    - _Requirements: 1.1, 1.3, 1.4, 3.3, 3.5_

  - [ ] 2.2 Retarget the `@copilot/shared` package manifest
    - Change `"main"` from `dist/index.js` to `src/index.js`, remove the `"types"` field
    - Remove the `build` and `prepare` scripts; update the `lint` script to target `.js` (drop `--ext .ts`)
    - Remove TypeScript-only dev dependencies (`typescript`, any `@types/*`, `@typescript-eslint/*`) that are no longer referenced; retain runtime JS packages such as `zod`
    - _Requirements: 4.1, 5.1, 5.3, 5.5_

  - [ ]* 2.3 Write property test for Zod schema validation boundaries
    - **Property 3: Zod schema validation boundaries are preserved**
    - Use `fast-check` (min 100 iterations, `numRuns: 100`) over generated inputs for `registerSchema`, `loginSchema`, `jobCreateSchema`, `jobQuerySchema`; assert accept/reject matches documented constraints (presence, length bounds, email/url format, enum membership) and that accepted inputs reflect declared defaults/coercions
    - Tag: `Feature: typescript-to-javascript-migration, Property 3: Zod schema validation boundaries are preserved`
    - **Validates: Requirements 6.3**

- [ ] 3. Migrate the `server` workspace
  - [ ] 3.1 Convert `server` source and test files to JavaScript
    - Strip types and rename every `server/src/**/*.ts` (including `*.test.ts`) and `prisma/seed.ts` to `.js`, erasing `as`/`satisfies`/non-null assertions and annotations while preserving value-level imports/exports; server internal imports already carry `.js` specifiers and resolve unchanged
    - Delete originals after conversion; run Prettier normalization
    - _Requirements: 1.1, 1.3, 1.4, 3.3, 3.5_

  - [ ] 3.2 Remove the ambient declaration file and confirm runtime assignments
    - Delete `server/src/types/express.d.ts` without producing any replacement declaration file
    - Verify the runtime property assignments it described remain present in JS: `req.requestId` in `middleware/requestId.js` and `req.user` in `middleware/auth.js`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 3.3 Convert `server` build configs to JavaScript
    - Convert `server/vitest.config.ts` → `.js`, changing `include` glob `src/**/*.test.ts` → `src/**/*.test.js`
    - Convert `server/prisma.config.ts` → `.js`, updating `seed` from `tsx prisma/seed.ts` → `node prisma/seed.js`
    - Ensure no `.ts`/`.mts`/`.cts` config remains in the workspace
    - _Requirements: 4.2, 4.4, 4.6_

  - [ ] 3.4 Update `server` package manifest scripts and dependencies
    - `dev`: `tsx watch src/index.ts` → `node --watch src/index.js`; `start`: `node dist/index.js` → `node src/index.js`
    - `build`: `prisma generate && tsc -p tsconfig.json` → `prisma generate` (no `tsc` token); `lint`: drop `--ext .ts`; `prisma:seed` and `prisma.seed`: `tsx prisma/seed.ts` → `node prisma/seed.js`
    - Remove unreferenced TypeScript-only dev deps (`typescript`, `ts-node`, `tsx`, `@types/*`, `@typescript-eslint/*`); retain `zod`, `@prisma/client`, `@prisma/adapter-pg`
    - _Requirements: 5.1, 5.3, 5.5, 5.6, 5.7, 5.8_

  - [ ] 3.5 Update the `server` ESLint flat config
    - Remove `@typescript-eslint` parser/plugin imports, `parser`/`parserOptions.project` settings, and all `@typescript-eslint/*` rules; re-enable core `no-unused-vars` with `argsIgnorePattern: "^_"`
    - Change `files` globs from `.ts` to `.js`/`.jsx`
    - _Requirements: 4.3_

- [ ] 4. Checkpoint - shared and server converted
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Migrate the `client` workspace
  - [ ] 5.1 Convert `client` source to JavaScript/JSX
    - Rename `.tsx` → `.jsx` (App, main, pages, providers, routes, `ui/icons`) and `.ts` → `.js` (`lib/*`, `test/setup`, `ui/theme`), stripping types and erasing the non-null assertion in `main.tsx` (`getElementById("app")!`)
    - Remove `client/src/types.ts` entirely (type-only module) along with the `import type` statements that reference it (e.g. in `theme`, `AuthProvider`); extensionless imports resolve unchanged under Vite
    - Delete originals after conversion; run Prettier normalization
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.3, 3.4, 3.5_

  - [ ] 5.2 Convert `client` build configs to JavaScript
    - Convert `vite.config.ts` → `.js`; `vitest.config.ts` → `.js` with `include` glob `src/**/*.test.tsx` → `src/**/*.test.jsx`
    - Convert `tailwind.config.ts` → `.js`, removing `import type { Config }`/`satisfies Config` and changing the `content` glob `./src/**/*.{ts,tsx}` → `./src/**/*.{js,jsx}`; leave `postcss.config.cjs` unchanged
    - Ensure no `.ts`/`.mts`/`.cts` config remains in the workspace
    - _Requirements: 4.2, 4.4, 4.6_

  - [ ] 5.3 Update `client` package manifest scripts and dependencies
    - `build`: `tsc && vite build` → `vite build`; `lint`: `eslint src --ext .ts,.tsx` → `eslint src`
    - Remove unreferenced TypeScript-only dev deps (`typescript`, `@types/*`, `@typescript-eslint/*`); retain React/runtime packages
    - _Requirements: 5.1, 5.3, 5.5, 5.8_

  - [ ] 5.4 Update the `client` ESLint flat config
    - Remove `@typescript-eslint` parser/plugin and rules; keep `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh`; enable JSX via espree (`parserOptions.ecmaFeatures.jsx`)
    - Change `files` globs from `.{ts,tsx}` to `.{js,jsx}`; re-enable core `no-unused-vars` with `argsIgnorePattern: "^_"`
    - _Requirements: 4.3_

- [ ] 6. Migrate the `extension` workspace
  - [ ] 6.1 Convert `extension` source and update the popup HTML reference
    - Rename `src/background.ts`/`src/content.ts` → `.js` and `src/popup.tsx` → `popup.jsx`, stripping types
    - Update `src/popup.html` `<script>` src from `popup.tsx` → `popup.jsx`
    - Delete originals after conversion; run Prettier normalization
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.3, 3.5_

  - [ ] 6.2 Convert the `extension` Vite config to JavaScript
    - Convert `extension/vite.config.ts` → `.js`, updating rollup inputs `src/content.ts`/`src/background.ts` → `.js`
    - Ensure no `.ts`/`.mts`/`.cts` config remains in the workspace
    - _Requirements: 4.2, 4.4, 4.6_

  - [ ] 6.3 Update `extension` package manifest scripts and dependencies
    - `build`: `tsc --noEmit && vite build` → `vite build`
    - Remove unreferenced TypeScript-only dev deps (`typescript`, `@types/*`, `@typescript-eslint/*`)
    - _Requirements: 5.1, 5.3, 5.8_

- [ ] 7. Migrate the `e2e` suite and root Playwright config
  - [ ] 7.1 Convert the e2e journey spec to JavaScript
    - Strip types and rename `e2e/journey.spec.ts` → `e2e/journey.spec.js`; run Prettier normalization
    - _Requirements: 1.1, 1.3, 1.4, 3.3, 3.5_

  - [ ] 7.2 Convert the root Playwright config to JavaScript
    - Convert `playwright.config.ts` → `playwright.config.js` (body is plain JS already); ensure no `.ts` config remains at root
    - _Requirements: 4.2, 4.6_

- [ ] 8. Remove TypeScript project configs and update root manifest
  - [ ] 8.1 Delete all `tsconfig` files and remove references to them
    - Delete every first-party `tsconfig.json` across workspaces and `server/tsconfig.eslint.json`; remove any remaining references to these files from package scripts and Build_Configs
    - Confirm zero first-party `.d.ts` files remain in the source tree
    - _Requirements: 4.1, 2.1_

  - [ ] 8.2 Update the root `package.json` scripts and dependencies
    - Remove the `typecheck` script and all its per-workspace variants, leaving other root scripts unchanged
    - Update `lint-staged` globs `*.{ts,tsx,...}`/`server/src/**/*.{ts,tsx}` → `.{js,jsx,...}`/`server/src/**/*.{js,jsx}`
    - Remove unreferenced root-level TypeScript-only dev deps (`typescript`, `@typescript-eslint/*`, `@types/*`)
    - _Requirements: 5.1, 5.4, 5.6_

- [ ] 9. Rewrite explicit import specifiers and verify the rewriter
  - [ ] 9.1 Run the import-specifier rewriter across converted files
    - For any import/export specifier ending in an explicit `.ts`/`.tsx` extension, rewrite only the extension to `.js`/`.jsx`, leaving extensionless specifiers unchanged; record and report any specifier that cannot be resolved and continue
    - This is largely a safety net given server imports already use `.js` and client/extension imports are extensionless
    - _Requirements: 3.1, 3.2, 3.6_

  - [ ]* 9.2 Write property test for the import-specifier rewriter
    - **Property 2: Import-specifier rewriting changes only explicit TypeScript extensions**
    - Use `fast-check` (min 100 iterations, `numRuns: 100`) over generated path strings; assert trailing `.ts`→`.js` and `.tsx`→`.jsx` with the preceding path byte-for-byte identical, and any non-`.ts`/`.tsx` specifier returned unchanged
    - Tag: `Feature: typescript-to-javascript-migration, Property 2: Import-specifier rewriting changes only explicit TypeScript extensions`
    - **Validates: Requirements 3.1, 3.2**

- [ ] 10. Verify conversion surface preservation
  - [ ]* 10.1 Write property test for value-level export/import surface preservation
    - **Property 1: Value-level export/import surface is preserved**
    - Use `fast-check` (min 100 iterations, `numRuns: 100`) over the converted module set; for each module, parse original (from the baseline snapshot) and converted files and assert the set of value-level exported binding names is equal, and every value-level import binding referenced by an executable statement remains present with the same name and count
    - Tag: `Feature: typescript-to-javascript-migration, Property 1: Value-level export/import surface is preserved`
    - **Validates: Requirements 1.3, 3.5**

- [ ] 11. Run the full verification gate
  - [ ] 11.1 Execute the verification gate and measure the TypeScript percentage
    - Run repository lint (zero errors, no `@typescript-eslint`), server unit tests, client unit tests, build of every workspace (no `tsc`/`tsx`/`ts-node`), and the Playwright e2e suite; fail with an indication of the failing stage if any stage does not succeed
    - Run static counts: zero first-party `.ts`/`.tsx` files, zero first-party `.d.ts` files, no `tsc`/`tsx`/`ts-node` tokens in manifests/scripts, no remaining `.ts`/`.mts`/`.cts` build configs
    - Measure TypeScript percentage (Linguist or file-extension proxy) and confirm strictly < 1.0%; on failure, report the remaining TypeScript files without deleting or altering repository files
    - _Requirements: 5.9, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.2, 8.4, 8.5_

- [ ] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster path; core migration tasks are never optional.
- Each task references specific requirement sub-clauses for traceability.
- The three property-based tests use `fast-check` with a minimum of 100 iterations and the required `Feature: ...` tag; they are the only PBT tasks because behavior preservation of individual files is verified by the existing test suites, build, and e2e (the correct oracle), not by generated inputs.
- `detype` is a migration-time dev CLI only and must never appear as a dependency in any shipped `package.json`.
- ESM is preserved throughout; no `package.json` `"type"` field changes.
- Checkpoints ensure incremental validation at natural workspace boundaries.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "3.2", "5.1", "6.1", "7.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.3", "3.4", "3.5", "5.2", "5.3", "5.4", "6.2", "6.3", "7.2", "8.1", "8.2"] },
    { "id": 3, "tasks": ["9.1"] },
    { "id": 4, "tasks": ["9.2", "10.1"] },
    { "id": 5, "tasks": ["11.1"] }
  ]
}
```
