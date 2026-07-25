import { defineConfig } from "vitest/config";

// Root-level vitest config for repository-wide migration verification property tests.
// Workspace-scoped tests (client/server/shared) run via their own configs; this config
// only picks up the migration verification property tests under scripts/.
export default defineConfig({
  test: {
    include: ["scripts/**/*.property.test.js"],
  },
});
