import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const DEFAULT_API = "http://localhost:4000";
const DEFAULT_APP = "http://localhost:5173";

function Popup() {
  const [token, setToken] = useState("");
  const [apiUrl, setApiUrl] = useState(DEFAULT_API);
  const [appUrl, setAppUrl] = useState(DEFAULT_APP);
  const [importUrl, setImportUrl] = useState("");
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void chrome.storage.local
      .get([
        "copilotAccessToken",
        "copilotApiUrl",
        "copilotAppUrl",
        "copilotRemindersEnabled",
      ])
      .then((v) => {
        if (typeof v.copilotAccessToken === "string")
          setToken(v.copilotAccessToken);
        if (typeof v.copilotApiUrl === "string") setApiUrl(v.copilotApiUrl);
        if (typeof v.copilotAppUrl === "string") setAppUrl(v.copilotAppUrl);
        if (typeof v.copilotRemindersEnabled === "boolean")
          setRemindersEnabled(v.copilotRemindersEnabled);
      });
  }, []);

  async function save() {
    await chrome.storage.local.set({
      copilotAccessToken: token.trim(),
      copilotApiUrl: apiUrl.trim() || DEFAULT_API,
      copilotAppUrl: appUrl.trim() || DEFAULT_APP,
      copilotRemindersEnabled: remindersEnabled,
    });
    setMessage("Session settings saved.");
    chrome.runtime.sendMessage({
      type: "copilot/update-reminders-enabled",
      enabled: remindersEnabled,
    });
  }

  async function importByUrl() {
    const base = (apiUrl.trim() || DEFAULT_API).replace(/\/$/, "");
    if (!token.trim()) {
      setMessage("Set access token first.");
      return;
    }
    if (!importUrl.trim()) {
      setMessage("Enter a job URL to import.");
      return;
    }
    setMessage("Importing...");
    try {
      const response = await fetch(`${base}/jobs/import-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ url: importUrl.trim() }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: { message?: string };
        meta?: { duplicateMessage?: string };
      };
      if (!response.ok || !payload.success) {
        throw new Error(
          payload.error?.message ?? `Import failed (${response.status})`,
        );
      }
      setImportUrl("");
      setMessage(
        payload.meta?.duplicateMessage ?? "Job imported successfully.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    }
  }

  async function checkRemindersNow() {
    chrome.runtime.sendMessage({ type: "copilot/check-reminders-now" });
    setMessage("Reminder check started.");
  }

  return (
    <div
      style={{ width: 340, padding: 12, fontFamily: "system-ui, sans-serif" }}
    >
      <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Copilot session</h2>
      <p style={{ margin: "0 0 8px", fontSize: 12, color: "#475569" }}>
        Paste your access token from the web app (localStorage) or capture it
        from network responses.
      </p>
      <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
        API base
      </label>
      <input
        value={apiUrl}
        onChange={(e) => setApiUrl(e.target.value)}
        style={{ width: "100%", marginBottom: 8 }}
      />
      <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
        Access token
      </label>
      <textarea
        value={token}
        onChange={(e) => setToken(e.target.value)}
        rows={4}
        style={{ width: "100%" }}
      />
      <label
        style={{
          display: "block",
          fontSize: 12,
          marginTop: 8,
          marginBottom: 4,
        }}
      >
        App base
      </label>
      <input
        value={appUrl}
        onChange={(e) => setAppUrl(e.target.value)}
        placeholder={DEFAULT_APP}
        style={{ width: "100%", marginBottom: 8 }}
      />
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 8,
          fontSize: 12,
        }}
      >
        <input
          type="checkbox"
          checked={remindersEnabled}
          onChange={(e) => setRemindersEnabled(e.target.checked)}
        />
        Browser reminder notifications
      </label>
      <button
        type="button"
        onClick={() => void save()}
        style={{ marginTop: 8, width: "100%" }}
      >
        Save
      </button>
      <hr style={{ margin: "12px 0", borderColor: "#e2e8f0" }} />
      <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
        Import job by URL
      </label>
      <input
        value={importUrl}
        onChange={(e) => setImportUrl(e.target.value)}
        placeholder="https://..."
        style={{ width: "100%", marginBottom: 8 }}
      />
      <button
        type="button"
        onClick={() => void importByUrl()}
        style={{ width: "100%" }}
      >
        Import URL
      </button>
      <button
        type="button"
        onClick={() => void checkRemindersNow()}
        style={{ marginTop: 8, width: "100%" }}
      >
        Check reminders now
      </button>
      {message ? (
        <p
          style={{ margin: "8px 0 0", fontSize: 12, color: "#334155" }}
          role="status"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
