# Requirements Document

## Introduction

The `ai-job-copilot` project is a full-stack TypeScript application (~90% TypeScript by GitHub Linguist measure) organized as an npm workspace monorepo with `client`, `server`, and `shared` packages, plus a `extension` browser extension and `e2e` Playwright suite. This feature migrates the entire codebase from TypeScript to plain JavaScript (and JSX for React) so that GitHub Linguist reports less than 1% TypeScript for the repository, while preserving all existing runtime behavior, tests, and build/deploy capability.

The migration converts every `.ts` source file to `.js` and every `.tsx` file to `.jsx`, strips all TypeScript-only syntax (type annotations, interfaces, type aliases, generics, enums, access modifiers, non-null assertions, ambient declarations), removes or replaces TypeScript build tooling and configuration, and updates package manifests, scripts, and lint configuration accordingly. Runtime libraries that happen to be authored in TypeScript upstream (for example Zod and Prisma) are retained because they ship as consumable JavaScript packages and are not counted against the repository's own source.

## Glossary

- **Migration_System**: The overall process and tooling that converts the repository from TypeScript to JavaScript, defined by this specification.
- **Source_File**: A first-party `.ts` or `.tsx` file authored within the repository (excluding `node_modules` and generated output).
- **JS_File**: A `.js` or `.jsx` file produced by converting a Source_File.
- **Type_Syntax**: TypeScript-only language constructs including type annotations, interface declarations, type aliases, generic type parameters, enums, parameter property/access modifiers, `as` type assertions, non-null (`!`) assertions, `declare` statements, and `import type` / `export type` statements.
- **Ambient_Declaration_File**: A TypeScript `.d.ts` file that provides types without runtime code (for example `server/src/types/express.d.ts`).
- **Workspace**: One of the npm workspace or subproject roots: `client`, `server`, `shared`, `extension`, and the repository-root `e2e` / Playwright configuration.
- **Build_Config**: A configuration file controlling compilation, bundling, testing, or linting (for example `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `tailwind.config.ts`, `prisma.config.ts`, `eslint.config.js`).
- **Runtime_Behavior**: The externally observable behavior of the application, including HTTP API request/response contracts, React UI behavior, Zod validation results, and Prisma database operations.
- **TypeScript_Percentage**: The proportion of the repository classified as TypeScript by GitHub Linguist.
- **Verification_Gate**: The set of commands (lint, unit tests, build, e2e) used to confirm the migrated codebase remains functional.

## Requirements

### Requirement 1: Convert all TypeScript source files to JavaScript

**User Story:** As a repository maintainer, I want every first-party TypeScript source file converted to JavaScript, so that the codebase no longer relies on TypeScript compilation.

#### Acceptance Criteria

1. WHERE a `.ts` Source_File is not an Ambient_Declaration_File, THE Migration_System SHALL convert it to a `.js` JS_File with the same base name and directory location.
2. THE Migration_System SHALL convert every `.tsx` Source_File to a `.jsx` JS_File with the same base name and directory location.
3. WHEN a Source_File is converted, THE Migration_System SHALL remove all Type_Syntax from the resulting JS_File, including type annotations, interface and type-alias declarations, generic type parameters, non-null assertions, type casts, and type-only imports and exports, WHILE preserving every value-level import and export statement unchanged.
4. WHEN a Source_File is converted, THE Migration_System SHALL preserve the Runtime_Behavior of that file such that, for identical inputs, the resulting JS_File produces identical return values, externally observable side effects, and control-flow execution order as the original Source_File.
5. THE Migration_System SHALL convert Source_Files across all Workspaces, including `client`, `server`, `shared`, `extension`, and `e2e`.
6. WHERE a Source_File contains a TypeScript enum, THE Migration_System SHALL replace the enum with an equivalent JavaScript runtime construct that preserves every enum member name and its associated value and remains accessible at runtime by the same member references.
7. IF a Source_File is an Ambient_Declaration_File, THEN THE Migration_System SHALL remove it without producing a corresponding JS_File.
8. IF a Source_File cannot be converted, THEN THE Migration_System SHALL halt conversion of that file, retain the original Source_File unchanged, and report the failure with an indication identifying the affected file and the reason for failure.
9. WHEN the migration completes, THE Migration_System SHALL reduce the TypeScript_Percentage to 0 across all Workspaces, with no remaining `.ts` or `.tsx` Source_File other than Ambient_Declaration_Files that have been removed.

### Requirement 2: Remove ambient type declaration files

**User Story:** As a repository maintainer, I want ambient `.d.ts` files removed or replaced, so that no TypeScript-only declaration files remain in the source tree.

#### Acceptance Criteria

1. THE Migration_System SHALL remove every first-party Ambient_Declaration_File (every first-party `.d.ts` file, excluding `node_modules` and generated output) across all Workspaces, such that zero first-party `.d.ts` files remain in the repository source tree.
2. WHERE an Ambient_Declaration_File declares type augmentations for properties that application code assigns to a runtime object (for example the `requestId` and `user` properties augmented onto the Express `Request` in `server/src/types/express.d.ts`), THE Migration_System SHALL ensure the corresponding runtime property assignments remain present and functional in a JS_File.
3. IF an Ambient_Declaration_File contains only compile-time constructs (`declare`, `interface`, `type`, and `import type` statements) with no executable statements, THEN THE Migration_System SHALL remove the Ambient_Declaration_File without creating any replacement declaration file or type-only module.
4. WHEN a first-party Ambient_Declaration_File is removed, THE Migration_System SHALL preserve the Runtime_Behavior that depended on the runtime object the removed file described.

### Requirement 3: Update import and module references

**User Story:** As a developer, I want all module references updated to the new file extensions and paths, so that the application resolves modules correctly at runtime.

#### Acceptance Criteria

1. WHEN a JS_File imports another converted module using an import specifier that ends in an explicit `.ts` or `.tsx` extension, THE Migration_System SHALL rewrite only the extension portion of that specifier to `.js` or `.jsx` respectively, preserving the remainder of the path unchanged.
2. WHERE an import specifier references a converted module without an explicit `.ts` or `.tsx` extension, THE Migration_System SHALL leave the specifier unchanged.
3. WHEN a Source_File contains `import type` or `export type` statements, THE Migration_System SHALL remove those statements in their entirety from the resulting JS_File.
4. WHEN a Source_File imports a binding that is referenced only within Type_Syntax, THE Migration_System SHALL remove that unused binding from the resulting JS_File's import statement, removing the entire import statement if no bindings remain.
5. THE Migration_System SHALL preserve every import and export binding that is referenced by at least one executable (non-type) statement, keeping the binding name and count unchanged.
6. IF an import or export references a module path that cannot be resolved after conversion, THEN THE Migration_System SHALL leave that reference unchanged, record it, and emit an error indication identifying the affected file and reference, and SHALL continue processing remaining references.

### Requirement 4: Convert build and tooling configuration to JavaScript

**User Story:** As a developer, I want build, test, and bundler configuration converted away from TypeScript, so that the toolchain runs without a TypeScript compiler.

#### Acceptance Criteria

1. THE Migration_System SHALL remove every first-party `tsconfig.json` and TypeScript project reference config from all Workspaces, and SHALL remove any reference to those removed files from package scripts and remaining Build_Configs.
2. WHEN a Build_Config is authored as a `.ts`, `.mts`, or `.cts` file, THE Migration_System SHALL convert that Build_Config to a JavaScript file whose resolved configuration values are identical to the original and whose associated tool command completes with the same exit status and the same emitted output artifacts as before conversion.
3. THE Migration_System SHALL update ESLint configuration so that linting targets `.js` and `.jsx` files and SHALL remove the `@typescript-eslint` parser and plugin from both the ESLint configuration and the Workspace dependencies, such that an ESLint run reports zero errors attributable to the removed parser or plugin.
4. WHERE a Build_Config references a TypeScript-specific plugin or preset, THE Migration_System SHALL replace that reference with a JavaScript-compatible equivalent that preserves the original resolved configuration behavior.
5. IF a referenced TypeScript-specific plugin or preset has no JavaScript-compatible equivalent, THEN THE Migration_System SHALL leave the original Build_Config unmodified and SHALL emit an indication identifying the unconvertible reference.
6. WHEN conversion of all Build_Configs completes, THE Migration_System SHALL ensure that no `.ts`, `.mts`, or `.cts` Build_Config file remains in any Workspace.

### Requirement 5: Update package manifests and scripts

**User Story:** As a developer, I want package manifests and npm scripts updated, so that install, build, lint, and test commands operate on the JavaScript codebase.

#### Acceptance Criteria

1. WHERE a TypeScript-only development dependency (`typescript`, `ts-node`, `tsx`, any `@types/*`, or any `@typescript-eslint/*`) is no longer referenced by any import/require statement, script command string, or consumed configuration in a Workspace, THE Migration_System SHALL remove that dependency from that Workspace `package.json`.
2. IF a TypeScript-only development dependency slated for removal is still referenced by an import/require, script command, or consumed configuration, THEN THE Migration_System SHALL retain that dependency and record a Verification_Gate finding identifying the dependency and the remaining reference.
3. WHEN an npm script invokes the TypeScript compiler (`tsc`) as a build step, THE Migration_System SHALL update that script so that no `tsc` token remains, the non-`tsc` steps are preserved in their original order, and the script produces the equivalent JavaScript output artifacts.
4. THE Migration_System SHALL remove the `typecheck` script and each of its per-Workspace variants from the repository-root `package.json`, leaving all other root scripts unchanged.
5. WHEN a lint or test script targets `.ts` or `.tsx` file extensions, including via an extension flag such as `--ext .ts,.tsx`, THE Migration_System SHALL update that script to target `.js` and `.jsx` extensions.
6. WHEN a file-matching configuration block (for example a `lint-staged` glob or a Prisma seed command) references `.ts` or `.tsx` paths, THE Migration_System SHALL update that block to reference the corresponding `.js` or `.jsx` paths.
7. WHERE a runtime execution script relies on a TypeScript loader (for example `tsx`) to run a `.ts` entry point, THE Migration_System SHALL update that script to run the converted `.js` entry point with the JavaScript runtime.
8. THE Migration_System SHALL retain runtime dependencies that ship as JavaScript packages, including `zod` and `@prisma/client`.
9. WHEN the root install, build, lint, and test commands are run after the manifests are updated, THE Migration_System SHALL ensure they complete successfully without invoking `tsc`, `ts-node`, or `tsx`, otherwise recording a Verification_Gate finding identifying the failing command.

### Requirement 6: Preserve application runtime behavior

**User Story:** As an end user, I want the migrated application to behave exactly as before, so that no functionality is lost during the migration.

#### Acceptance Criteria

1. WHEN the migrated `server` Workspace receives an HTTP request that the pre-migration server accepted, THE migrated application SHALL respond with the same HTTP status, headers, and response body as the pre-migration application for identical request input and server state.
2. WHEN a user performs an interaction in the migrated `client` Workspace, THE migrated application SHALL produce the same rendered output, component state, and navigation outcome as the pre-migration application for the identical interaction and state.
3. WHEN a value is validated against a Zod schema in the `server`, `shared`, or `client` Workspace, THE migrated application SHALL produce the same accept-or-reject result and the same parsed output as the pre-migration application for identical input.
4. WHEN the migrated `server` Workspace performs a Prisma database operation, THE migrated application SHALL produce the same result set as the pre-migration application for identical database state.
5. WHEN the migrated application receives an input that the pre-migration application accepted, THE migrated application SHALL accept that input and produce the equivalent successful outcome.
6. WHEN the migrated application receives an input that the pre-migration application rejected, THE migrated application SHALL reject that input with the same error response and SHALL NOT persist the rejected input.

### Requirement 7: Pass the verification gate

**User Story:** As a maintainer, I want the migrated codebase to pass linting, tests, and builds, so that I can confirm the migration did not break the project.

#### Acceptance Criteria

1. WHEN the repository lint command is run against the migrated codebase across all Workspaces, THE Verification_Gate SHALL complete with a success exit status and report zero lint errors.
2. WHEN the server unit test suite is run against the migrated codebase, THE Verification_Gate SHALL report zero failed and zero errored tests.
3. WHEN the client unit test suite is run against the migrated codebase, THE Verification_Gate SHALL report zero failed and zero errored tests.
4. WHEN the repository build command is run against the migrated codebase, THE Verification_Gate SHALL complete the build of every Workspace with a success exit status.
5. WHEN the Playwright e2e suite is run against the migrated codebase, THE Verification_Gate SHALL pass every e2e journey step that passed prior to migration.
6. IF any Verification_Gate stage (lint, unit tests, build, or e2e) does not complete successfully, THEN THE Verification_Gate SHALL fail and produce an indication identifying the failing stage.

### Requirement 8: Achieve the TypeScript percentage target

**User Story:** As the requester, I want GitHub to report less than 1% TypeScript for the repository, so that the project is classified as a JavaScript project.

#### Acceptance Criteria

1. WHEN GitHub Linguist analyzes the migrated repository, THE Migration_System SHALL ensure the reported TypeScript_Percentage is strictly less than 1.0% (i.e., 0.00% up to but excluding 1.00%), measured over the same set of Source_Files that GitHub Linguist counts by default (excluding files marked as generated, vendored, or documentation).
2. WHEN the Verification_Gate measures the repository, THE Migration_System SHALL contain zero first-party `.ts` and `.tsx` Source_Files, where first-party excludes generated build output and any files under third-party `node_modules` directories.
3. WHERE a TypeScript stub file is retained because a third-party tool requires it to operate, THE Migration_System SHALL limit such retained stub files to a maximum of 5 files totaling no more than 200 lines combined, so that the reported TypeScript_Percentage remains strictly less than 1.0%.
4. IF the reported TypeScript_Percentage is greater than or equal to 1.0% when the Verification_Gate runs, THEN THE Migration_System SHALL fail the Verification_Gate and produce an error indication identifying the remaining TypeScript Source_Files that contribute to the percentage, without deleting or altering existing repository files.
5. IF one or more first-party `.ts` or `.tsx` Source_Files remain in the repository when the Verification_Gate runs, THEN THE Migration_System SHALL fail the Verification_Gate and produce an error indication listing each remaining first-party TypeScript Source_File.
