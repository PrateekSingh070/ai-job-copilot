import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:4000/health",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      // Allow localhost CORS while Playwright boots the dev stack (CI sets NODE_ENV=test globally).
      NODE_ENV: "development",
      // Disable Redis-backed auth rate limiter during local E2E boot.
      REDIS_URL: "",
    },
  },
});
