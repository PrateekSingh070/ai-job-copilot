const DEFAULT_API = "http://localhost:4000";

// Longest text we send for each field, matching the API's limits.
const MAX_DESCRIPTION_LENGTH = 10000;
const MAX_NOTES_LENGTH = 3000;

// Fall back to the site's domain (e.g. "acme" from "www.acme.com") when we
// can't find a real company name on the page.
function parseCompanyFromHost(hostname) {
  return hostname.replace(/^www\./, "").split(".")[0] || "Unknown company";
}

// Best-effort scrape of the current page for a job title, company, and
// description. Uses LinkedIn-specific selectors first, then generic fallbacks.
function textFromPage() {
  const title =
    document.querySelector("h1")?.textContent?.trim() ??
    document.title?.split(/[-|]/)[0]?.trim() ??
    "Unknown role";

  const company =
    document.querySelector("[data-company-name]")?.textContent?.trim() ??
    document
      .querySelector(".jobs-unified-top-card__company-name a")
      ?.textContent?.trim() ??
    parseCompanyFromHost(location.hostname);

  // Prefer a meaningful text selection; otherwise use the top of the page.
  const selectedText = window.getSelection()?.toString().trim();
  const bodySnippet = document.body?.innerText?.slice(0, 3200) ?? "";
  const description =
    selectedText && selectedText.length > 80 ? selectedText : bodySnippet;

  return { title, company, description };
}

async function getSavedCredentials() {
  const { copilotAccessToken, copilotApiUrl } = await chrome.storage.local.get([
    "copilotAccessToken",
    "copilotApiUrl",
  ]);

  const apiBase =
    typeof copilotApiUrl === "string" && copilotApiUrl.length > 0
      ? copilotApiUrl
      : DEFAULT_API;
  const token =
    typeof copilotAccessToken === "string" ? copilotAccessToken : "";

  return { apiBase, token };
}

async function postJob(payload) {
  const { apiBase, token } = await getSavedCredentials();
  if (!token) {
    throw new Error(
      "Missing access token. Open the extension popup and save your token.",
    );
  }

  const response = await fetch(`${apiBase.replace(/\/$/, "")}/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      company: payload.company,
      role: payload.role,
      jobUrl: payload.jobUrl,
      source: "browser-extension",
      jobDescription: payload.notes?.slice(0, MAX_DESCRIPTION_LENGTH),
      status: "APPLIED",
      notes: payload.notes?.slice(0, MAX_NOTES_LENGTH),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error ${response.status}: ${body}`);
  }

  const json = await response.json();
  // The API returns a friendly message when the job looks like a duplicate.
  return json.meta?.duplicateMessage ?? null;
}

// Scrape the current page and save it as a job, updating the button label
// to reflect success, a duplicate warning, or failure.
async function saveCurrentPage(button) {
  try {
    const { title, company, description } = textFromPage();
    const duplicateWarning = await postJob({
      company,
      role: title,
      jobUrl: location.href,
      notes: description ? description.slice(0, MAX_NOTES_LENGTH) : undefined,
    });
    button.textContent = duplicateWarning
      ? "Added (duplicate warning)"
      : "Added ✓";
  } catch (error) {
    button.textContent = "Failed";
    console.error(error);
  }

  setTimeout(() => {
    button.textContent = "Save Job to Copilot";
  }, 2000);
}

function injectFloatingButton() {
  if (document.getElementById("copilot-apply-btn")) return;

  const button = document.createElement("button");
  button.id = "copilot-apply-btn";
  button.type = "button";
  button.textContent = "Save Job to Copilot";

  Object.assign(button.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    padding: "10px 14px",
    borderRadius: "999px",
    border: "1px solid #0284c7",
    background: "#e0f2fe",
    color: "#0f172a",
    fontSize: "12px",
    fontWeight: "600",
    cursor: "pointer",
    zIndex: "2147483647",
  });

  button.addEventListener("click", () => {
    void saveCurrentPage(button);
  });

  document.body.appendChild(button);
}

// Wait for the DOM if the page is still loading, otherwise inject right away.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => injectFloatingButton(), {
    once: true,
  });
} else {
  injectFloatingButton();
}
