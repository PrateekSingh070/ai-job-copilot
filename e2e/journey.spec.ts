import { test, expect } from "@playwright/test";

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
      password: "E2EPass123!",
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

async function registerFreshUser(page: import("@playwright/test").Page) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const email = `e2e-${suffix}@example.com`;
  await page.goto("/register");
  await page.getByTestId("register-name").fill("E2E User");
  await page.getByTestId("register-email").fill(email);
  await page.getByTestId("register-password").fill("E2EPass123!");
  await page.getByTestId("register-submit").click();
  await expect(
    page.getByRole("heading", { name: "AI Job Application Copilot" }),
  ).toBeVisible();
}

test.describe("authenticated job pipeline", () => {
  test.beforeAll(async () => {
    await assertE2eBackendReady();
  });

  test("register, add job, move column, logout", async ({ page }) => {
    await registerFreshUser(page);

    await page.getByTestId("add-job-company").fill("Contoso");
    await page.getByTestId("add-job-role").fill("Software Engineer");
    await page.getByTestId("add-job-submit").click();

    await expect(
      page.getByTestId("job-card").filter({ hasText: "Contoso" }).first(),
    ).toBeVisible();

    const card = page
      .getByTestId("job-card")
      .filter({ hasText: "Contoso" })
      .first();
    const interviewColumn = page.getByTestId("column-INTERVIEW");
    await card.dragTo(interviewColumn);

    await expect(interviewColumn.getByText("Contoso")).toBeVisible({
      timeout: 20_000,
    });

    await page.getByTestId("logout-button").click();
    await expect(page.getByRole("heading", { name: "Login" })).toBeVisible();
  });

  test("url import shows duplicate warning and follow-up tools", async ({
    page,
  }) => {
    await registerFreshUser(page);

    await page
      .getByPlaceholder(
        "Import job post by URL (LinkedIn, Indeed, company careers page)",
      )
      .fill("https://example.com");
    await page.getByRole("button", { name: "Import URL" }).click();
    await expect(page.getByRole("heading", { name: "example" })).toBeVisible({
      timeout: 20_000,
    });

    await page
      .getByPlaceholder(
        "Import job post by URL (LinkedIn, Indeed, company careers page)",
      )
      .fill("https://example.com");
    await page.getByRole("button", { name: "Import URL" }).click();
    await expect(page.getByText(/Duplicate warning:/)).toBeVisible({
      timeout: 20_000,
    });

    await page
      .getByRole("button", { name: "Follow-up email template" })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Follow-up email template" }),
    ).toBeVisible();
    await expect(page.getByText(/Subject: Follow-up on/)).toBeVisible();

    await page
      .getByRole("button", { name: "Follow up in 5 days" })
      .first()
      .click();
    const followUpInput = page
      .getByTestId("job-card")
      .first()
      .locator('input[type="datetime-local"]')
      .first();
    await expect(followUpInput).not.toHaveValue("", { timeout: 20_000 });
  });

  test("mock interview interactive flow returns score summary", async ({
    page,
  }) => {
    await registerFreshUser(page);

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

    await page.getByRole("button", { name: "Start Mock Interview" }).click();
    await expect(page.getByText("Mock interview mode")).toBeVisible({
      timeout: 20_000,
    });

    await page
      .getByPlaceholder("Type your interview answer...")
      .fill(
        "First I assess the issue impact, then isolate root cause using logs and metrics, and finally ship a tested fix. Result: reduced incident time by 40%.",
      );
    await page.getByRole("button", { name: "Submit answer" }).click();
    await expect(page.getByText(/Latest score:/)).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole("button", { name: "Get summary" }).click();
    await expect(page.getByText(/Overall:/)).toBeVisible({ timeout: 20_000 });
  });
});
