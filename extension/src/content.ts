function parseCompanyFromHost(hostname: string): string {
  return hostname.replace(/^www\./, "").split(".")[0] || "Unknown company";
}

function textFromPage(): {
  title: string;
  company: string;
  description: string;
} {
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
  const selectedText = window.getSelection()?.toString().trim();
  const bodySnippet = document.body?.innerText?.slice(0, 3200) ?? "";
  const description =
    selectedText && selectedText.length > 80 ? selectedText : bodySnippet;
  return { title, company, description };
}

async function postJob(payload: {
  company: string;
  role: string;
  jobUrl: string;
  notes?: string;
}) {
  const { copilotAccessToken, copilotApiUrl } = await chrome.storage.local.get([
    "copilotAccessToken",
    "copilotApiUrl",
  ]);
  const base =
    typeof copilotApiUrl === "string" && copilotApiUrl.length > 0
      ? copilotApiUrl
      : "http://localhost:4000";
  const token =
    typeof copilotAccessToken === "string" ? copilotAccessToken : "";
  if (!token) {
    throw new Error(
      "Missing access token. Open the extension popup and save your token.",
    );
  }

  const res = await fetch(`${base.replace(/\/$/, "")}/jobs`, {
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
      jobDescription: payload.notes?.slice(0, 10000),
      status: "APPLIED",
      notes: payload.notes?.slice(0, 3000),
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`API error ${res.status}: ${t}`);
  }
  const json = (await res.json()) as { meta?: { duplicateMessage?: string } };
  return json.meta?.duplicateMessage ?? null;
}

function injectFloatingButton() {
  if (document.getElementById("copilot-apply-btn")) return;
  const btn = document.createElement("button");
  btn.id = "copilot-apply-btn";
  btn.type = "button";
  btn.textContent = "Save Job to Copilot";
  btn.style.position = "fixed";
  btn.style.right = "16px";
  btn.style.bottom = "16px";
  btn.style.padding = "10px 14px";
  btn.style.borderRadius = "999px";
  btn.style.border = "1px solid #0284c7";
  btn.style.background = "#e0f2fe";
  btn.style.color = "#0f172a";
  btn.style.fontSize = "12px";
  btn.style.fontWeight = "600";
  btn.style.cursor = "pointer";
  btn.style.zIndex = "2147483647";
  btn.addEventListener("click", () => {
    void (async () => {
      try {
        const { title, company, description } = textFromPage();
        const duplicateWarning = await postJob({
          company,
          role: title,
          jobUrl: location.href,
          notes: description ? description.slice(0, 3000) : undefined,
        });
        btn.textContent = duplicateWarning
          ? "Added (duplicate warning)"
          : "Added ✓";
      } catch (e) {
        btn.textContent = "Failed";
        console.error(e);
      }
      setTimeout(() => {
        btn.textContent = "Save Job to Copilot";
      }, 2000);
    })();
  });
  document.body.appendChild(btn);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => injectFloatingButton(), {
    once: true,
  });
} else {
  injectFloatingButton();
}
