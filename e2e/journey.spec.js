import { test, expect } from "@playwright/test";

// Credentials reused by every test that registers a brand-new account.
const TEST_PASSWORD = "E2EPass123!";

// The URL import box is referenced by its placeholder in several tests.
const IMPORT_URL_PLACEHOLDER =
  "Import job post by URL (LinkedIn, Indeed, company careers page)";

// Longer timeout for steps that wait on backend/AI responses.
const BACKEND_WAIT = { timeout: 20_000 };

// Fail fast with a clear message if the API/database aren't reachable,
// so a broken environment doesn't look like a broken test.
async function assertE2eBackendReady() {
  const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:4000";

  const health = await fetch(`${apiBase}/health`);
  if (!health.ok) {
    throw new Error(
      `E2E preflight failed: API health endpoint unavailable (${health.status}). Start server before running Playwright.`,
    );
  }

  const loginProbe = await fetch(`${apiBase}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "preflight-check@example.com",
      password: TEST_PASSWORD,
    }),
  });
  if (loginProbe.status >= 500) {
    const body = await loginProbe.text();
    throw new Error(
      `E2E preflight failed: backend cannot reach database (status ${loginProbe.status}). ` +
        `Check Postgres availability and DATABASE_URL. Response: ${body.slice(0, 240)}`,
    );
  }
}

// Register a unique account and wait for the dashboard to load.
async function registerFreshUser(page) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const email = `e2e-${suffix}@example.com`;

  await page.goto("/register");
  await page.getByTestId("register-name").fill("E2E User");
  await page.getByTestId("register-email").fill(email);
  await page.getByTestId("register-password").fill(TEST_PASSWORD);
  await page.getByTestId("register-submit").click();

  await expect(
    page.getByRole("heading", { name: "AI Job Application Copilot" }),
  ).toBeVisible();
}

// Paste a job URL into the import box and submit it.
async function importJobByUrl(page, url) {
  await page.getByPlaceholder(IMPORT_URL_PLACEHOLDER).fill(url);
  await page.getByRole("button", { name: "Import URL" }).click();
}

test.describe("authenticated job pipeline", () => {
  test.beforeAll(async () => {
    await assertE2eBackendReady();
  });

  test("register, add job, move column, logout", async ({ page }) => {
    await registerFreshUser(page);

    // Add a job to the board.
    await page.getByTestId("add-job-company").fill("Contoso");
    await page.getByTestId("add-job-role").fill("Software Engineer");
    await page.getByTestId("add-job-submit").click();

    const contosoCard = page
      .getByTestId("job-card")
      .filter({ hasText: "Contoso" })
      .first();
    await expect(contosoCard).toBeVisible();

    // Drag the card into the Interview column.
    const interviewColumn = page.getByTestId("column-INTERVIEW");
    await contosoCard.dragTo(interviewColumn);
    await expect(interviewColumn.getByText("Contoso")).toBeVisible(BACKEND_WAIT);

    // Log out and confirm we land back on the login screen.
    await page.getByTestId("logout-button").click();
    await expect(page.getByRole("heading", { name: "Login" })).toBeVisible();
  });

  test("url import shows duplicate warning and follow-up tools", async ({
    page,
  }) => {
    await registerFreshUser(page);

    // First import creates the job.
    await importJobByUrl(page, "https://example.com");
    await expect(
      page.getByRole("heading", { name: "example" }),
    ).toBeVisible(BACKEND_WAIT);

    // Importing the same URL again should surface a duplicate warning.
    await importJobByUrl(page, "https://example.com");
    await expect(page.getByText(/Duplicate warning:/)).toBeVisible(BACKEND_WAIT);

    // Generate a follow-up email template.
    await page
      .getByRole("button", { name: "Follow-up email template" })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Follow-up email template" }),
    ).toBeVisible();
    await expect(page.getByText(/Subject: Follow-up on/)).toBeVisible();

    // Schedule a follow-up and confirm the date field gets populated.
    await page
      .getByRole("button", { name: "Follow up in 5 days" })
      .first()
      .click();
    const followUpInput = page
      .getByTestId("job-card")
      .first()
      .locator('input[type="datetime-local"]')
      .first();
    await expect(followUpInput).not.toHaveValue("", BACKEND_WAIT);
  });

  test("mock interview interactive flow returns score summary", async ({
    page,
  }) => {
    await registerFreshUser(page);

    // Open the AI workspace and provide role, resume, and job description.
    await page.getByRole("button", { name: "AI Workspace" }).click();
    await page.getByPlaceholder("Target role").fill("Backend Engineer");
    await page
      .getByPlaceholder("Paste resume text...")
      .fill(
        "Built Node and TypeScript APIs, optimized PostgreSQL queries, and shipped production features with tests across multiple projects.",
      );
    await page
      .getByPlaceholder("Paste job description...")
      .fill(
        "We need a backend engineer with Node, TypeScript, PostgreSQL, API reliability, and cross-functional collaboration experience.",
      );

    // Start the mock interview.
    await page.getByRole("button", { name: "Start Mock Interview" }).click();
    await expect(page.getByText("Mock interview mode")).toBeVisible(BACKEND_WAIT);

    // Answer a question and confirm a score comes back.
    await page
      .getByPlaceholder("Type your interview answer...")
      .fill(
        "First I assess the issue impact, then isolate root cause using logs and metrics, and finally ship a tested fix. Result: reduced incident time by 40%.",
      );
    await page.getByRole("button", { name: "Submit answer" }).click();
    await expect(page.getByText(/Latest score:/)).toBeVisible(BACKEND_WAIT);

    // Request the overall summary.
    await page.getByRole("button", { name: "Get summary" }).click();
    await expect(page.getByText(/Overall:/)).toBeVisible(BACKEND_WAIT);
  });
});
