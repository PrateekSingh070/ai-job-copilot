import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5174";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";
const EMAIL = process.env.E2E_EMAIL || "demo@copilot.local";
const PASSWORD = process.env.E2E_PASSWORD || "DemoPass123!";

const TARGET_ROLE = "Full Stack Intern";
const COMPANY = "Browser E2E Labs";
const ROLE = "Full Stack Intern";

const RESUME_TEXT =
  "Built React + Node features, improved page performance by 30%, and collaborated across product and engineering.";
const JOB_DESC =
  "Looking for a full stack intern to build React UI features, Node APIs, write tests, and support production quality.";

const outDir = path.join(process.cwd(), "artifacts", "e2e-journey");
const downloadsDir = path.join(outDir, "downloads");

/** @type {{step:number,title:string,pass:boolean,observation:string,error?:string}[]} */
const results = [];

async function ensureDirs() {
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(downloadsDir, { recursive: true });
}

async function screenshot(page, step) {
  const file = path.join(outDir, `${String(step).padStart(2, "0")}.png`);
  await page.screenshot({ path: file, fullPage: true });
}

function pushResult(step, title, pass, observation, error) {
  results.push({ step, title, pass, observation, ...(error ? { error } : {}) });
}

async function getObservation(page) {
  const title = (await page.title()) || "(no title)";
  const h1 = await page.locator("h1").first().textContent().catch(() => "");
  const h3s = await page
    .locator("h3")
    .allTextContents()
    .then((arr) => arr.slice(0, 5).join(" | "))
    .catch(() => "");
  return `URL=${page.url()} | title=${title} | h1=${(h1 || "").trim()} | h3=${h3s.trim()}`;
}

async function runStep(step, title, page, fn) {
  try {
    await fn();
    await screenshot(page, step);
    pushResult(step, title, true, await getObservation(page));
  } catch (err) {
    await screenshot(page, step).catch(() => {});
    pushResult(step, title, false, await getObservation(page).catch(() => "Could not capture page observation"), String(err));
  }
}

async function main() {
  await ensureDirs();
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);

  // Preflight backend reachability before UI flow.
  await page.request.get(`${BACKEND_URL}/auth/me`);

  // 1. Open app, verify login page.
  await runStep(1, "Open app, verify login page", page, async () => {
    await page.goto(FRONTEND_URL, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Login" }).waitFor();
    await page.getByRole("button", { name: "Sign in" }).waitFor();
  });

  // 2. Login with credentials.
  await runStep(2, "Login with credentials", page, async () => {
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");
  });

  // 3. Verify dashboard loads.
  await runStep(3, "Verify dashboard loads", page, async () => {
    await page.getByRole("heading", { name: "AI Job Application Copilot" }).waitFor();
    await page.getByRole("button", { name: "Job Tracker" }).waitFor();
    await page.getByText("Total Applications").waitFor();
  });

  // 4. Create job in APPLIED.
  await runStep(4, `Create job (${COMPANY}/${ROLE}) in APPLIED`, page, async () => {
    await page.getByPlaceholder("Company").fill(COMPANY);
    await page.getByPlaceholder("Role").fill(ROLE);
    await page.locator("form select").first().selectOption("APPLIED");
    await page.getByRole("button", { name: "Add Job" }).click();
    await page.getByText(COMPANY).first().waitFor();
  });

  // 5. Verify card appears in APPLIED.
  await runStep(5, "Verify card appears in APPLIED", page, async () => {
    const appliedColumn = page.locator("div", {
      has: page.getByRole("heading", { name: "APPLIED" }),
    });
    await appliedColumn.getByText(COMPANY).first().waitFor();
    await appliedColumn.getByText(ROLE).first().waitFor();
  });

  // 6. Move card to INTERVIEW and verify persisted after refresh.
  await runStep(6, "Move card to INTERVIEW and verify persistence after refresh", page, async () => {
    const appliedColumn = page.locator("div", {
      has: page.getByRole("heading", { name: "APPLIED" }),
    });
    const interviewColumn = page.locator("div", {
      has: page.getByRole("heading", { name: "INTERVIEW" }),
    });
    const card = appliedColumn.locator("article", { hasText: COMPANY }).first();
    await card.dragTo(interviewColumn.locator("h3", { hasText: "INTERVIEW" }));
    await interviewColumn.getByText(COMPANY).first().waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await interviewColumn.getByText(COMPANY).first().waitFor();
  });

  // 7. Open AI Workspace.
  await runStep(7, "Open AI Workspace", page, async () => {
    await page.getByRole("button", { name: "AI Workspace" }).click();
    await page.getByText("Resume Tailor + Cover Letter + Interview Prep").waitFor();
  });

  // 8. Fill target role, resume text, job description.
  await runStep(8, "Fill target role, resume text, job description", page, async () => {
    await page.getByPlaceholder("Target role").fill(TARGET_ROLE);
    await page.getByPlaceholder("Paste resume text...").fill(RESUME_TEXT);
    await page.getByPlaceholder("Paste job description...").fill(JOB_DESC);
  });

  // 9. Generate Resume Bullets, verify output.
  await runStep(9, "Generate Resume Bullets and verify output", page, async () => {
    await page.getByRole("button", { name: "Generate Resume Bullets" }).click();
    await page.waitForTimeout(500);
    const val = await page.getByPlaceholder("Paste resume text...").inputValue();
    if (!val || val.length < 20) throw new Error("Resume output did not populate.");
  });

  // 10. Generate Cover Letter, verify output.
  await runStep(10, "Generate Cover Letter and verify output", page, async () => {
    await page.getByRole("button", { name: "Generate Cover Letter" }).click();
    await page.waitForTimeout(500);
    const val = await page.getByPlaceholder("Editable cover letter...").inputValue();
    if (!val || val.length < 20) throw new Error("Cover letter output did not populate.");
  });

  // 11. Generate Interview Prep, verify output.
  await runStep(11, "Generate Interview Prep and verify output", page, async () => {
    await page.getByRole("button", { name: "Generate Interview Prep" }).click();
    await page.waitForTimeout(500);
    const val = await page.getByPlaceholder("Editable interview prep JSON...").inputValue();
    if (!val || val.length < 20) throw new Error("Interview prep output did not populate.");
  });

  // 12. Export Cover Letter PDF and verify download triggered.
  await runStep(12, "Export Cover Letter PDF and verify download", page, async () => {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      page.getByRole("button", { name: "Export Cover Letter PDF" }).click(),
    ]);
    const target = path.join(downloadsDir, "cover-letter.pdf");
    await download.saveAs(target);
  });

  // 13. Export Interview Prep PDF and verify download triggered.
  await runStep(13, "Export Interview Prep PDF and verify download", page, async () => {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      page.getByRole("button", { name: "Export Interview Prep PDF" }).click(),
    ]);
    const target = path.join(downloadsDir, "interview-prep.pdf");
    await download.saveAs(target);
  });

  // 14. Use one Restore in Generation History and verify success behavior.
  await runStep(14, "Use Restore in Generation History and verify success behavior", page, async () => {
    await page.getByRole("heading", { name: "Generation History" }).waitFor();
    const restoreButton = page.getByRole("button", { name: "Restore" }).first();
    await restoreButton.waitFor();
    const restoreResponse = page.waitForResponse(
      (resp) => resp.url().includes("/ai/history/") && resp.url().includes("/restore"),
      { timeout: 15000 },
    );
    await restoreButton.click();
    const resp = await restoreResponse;
    if (!resp.ok()) throw new Error(`Restore failed with status ${resp.status()}`);
  });

  const reportPath = path.join(outDir, "report.json");
  await fs.writeFile(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), "utf8");

  await context.close();
  await browser.close();

  const failed = results.filter((r) => !r.pass);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, reportPath }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
