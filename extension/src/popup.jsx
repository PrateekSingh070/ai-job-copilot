import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const DEFAULT_API = "http://localhost:4000";
const DEFAULT_APP = "http://localhost:5173";

// Inline styles kept together so the JSX below stays easy to scan.
const styles = {
  container: { width: 340, padding: 12, fontFamily: "system-ui, sans-serif" },
  heading: { margin: "0 0 8px", fontSize: 16 },
  intro: { margin: "0 0 8px", fontSize: 12, color: "#475569" },
  label: { display: "block", fontSize: 12, marginBottom: 4 },
  labelSpaced: { display: "block", fontSize: 12, marginTop: 8, marginBottom: 4 },
  input: { width: "100%", marginBottom: 8 },
  textarea: { width: "100%" },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    fontSize: 12,
  },
  primaryButton: { marginTop: 8, width: "100%" },
  fullWidthButton: { width: "100%" },
  divider: { margin: "12px 0", borderColor: "#e2e8f0" },
  status: { margin: "8px 0 0", fontSize: 12, color: "#334155" },
};

function Popup() {
  const [token, setToken] = useState("");
  const [apiUrl, setApiUrl] = useState(DEFAULT_API);
  const [appUrl, setAppUrl] = useState(DEFAULT_APP);
  const [importUrl, setImportUrl] = useState("");
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [message, setMessage] = useState("");

  // Load any previously saved settings when the popup opens.
  useEffect(() => {
    void chrome.storage.local
      .get([
        "copilotAccessToken",
        "copilotApiUrl",
        "copilotAppUrl",
        "copilotRemindersEnabled",
      ])
      .then((saved) => {
        if (typeof saved.copilotAccessToken === "string")
          setToken(saved.copilotAccessToken);
        if (typeof saved.copilotApiUrl === "string")
          setApiUrl(saved.copilotApiUrl);
        if (typeof saved.copilotAppUrl === "string")
          setAppUrl(saved.copilotAppUrl);
        if (typeof saved.copilotRemindersEnabled === "boolean")
          setRemindersEnabled(saved.copilotRemindersEnabled);
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
    // Let the background worker know whether reminders are on.
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
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(
          payload.error?.message ?? `Import failed (${response.status})`,
        );
      }
      setImportUrl("");
      setMessage(payload.meta?.duplicateMessage ?? "Job imported successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    }
  }

  async function checkRemindersNow() {
    chrome.runtime.sendMessage({ type: "copilot/check-reminders-now" });
    setMessage("Reminder check started.");
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>Copilot session</h2>
      <p style={styles.intro}>
        Paste your access token from the web app (localStorage) or capture it
        from network responses.
      </p>

      <label style={styles.label}>API base</label>
      <input
        value={apiUrl}
        onChange={(e) => setApiUrl(e.target.value)}
        style={styles.input}
      />

      <label style={styles.label}>Access token</label>
      <textarea
        value={token}
        onChange={(e) => setToken(e.target.value)}
        rows={4}
        style={styles.textarea}
      />

      <label style={styles.labelSpaced}>App base</label>
      <input
        value={appUrl}
        onChange={(e) => setAppUrl(e.target.value)}
        placeholder={DEFAULT_APP}
        style={styles.input}
      />

      <label style={styles.checkboxLabel}>
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
        style={styles.primaryButton}
      >
        Save
      </button>

      <hr style={styles.divider} />

      <label style={styles.label}>Import job by URL</label>
      <input
        value={importUrl}
        onChange={(e) => setImportUrl(e.target.value)}
        placeholder="https://..."
        style={styles.input}
      />

      <button
        type="button"
        onClick={() => void importByUrl()}
        style={styles.fullWidthButton}
      >
        Import URL
      </button>

      <button
        type="button"
        onClick={() => void checkRemindersNow()}
        style={styles.primaryButton}
      >
        Check reminders now
      </button>

      {message ? (
        <p style={styles.status} role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Popup />);
