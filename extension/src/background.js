const DEFAULT_API = "http://localhost:4000";
const DEFAULT_APP = "http://localhost:5173";
const REMINDER_ALARM_NAME = "copilot-reminder-check";
const REMINDER_INTERVAL_MINUTES = 30;

// How long we remember that a reminder was already shown, so we don't
// notify the user about the same thing more than once in that window.
const DEDUPE_WINDOW_MS = 1000 * 60 * 60 * 12;
const DUE_SOON_WINDOW_MS = 1000 * 60 * 60 * 24;
const MAX_NOTIFICATIONS_PER_CHECK = 5;

// Small helpers to read loosely-typed values out of chrome.storage.local.
function readString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readObject(value) {
  return value && typeof value === "object" ? value : {};
}

// Storage can hold a trailing slash or extra whitespace; normalize to a
// clean base URL so we can safely append paths.
function normalizeApiBase(url) {
  const trimmed = (url || DEFAULT_API).trim();
  return trimmed.replace(/\/$/, "");
}

// Figure out where the web app lives. Prefer an explicit app URL; otherwise
// guess it from the API URL by swapping the dev API port (4000) for the
// dev app port (5173).
function deriveAppBase(apiBase, explicitAppBase) {
  if (explicitAppBase && explicitAppBase.trim()) {
    return explicitAppBase.trim().replace(/\/$/, "");
  }

  try {
    const parsed = new URL(apiBase);
    if (parsed.port === "4000") parsed.port = "5173";
    if (!parsed.port && parsed.hostname === "localhost") parsed.port = "5173";
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_APP;
  }
}

function ensureReminderAlarm() {
  chrome.alarms.create(REMINDER_ALARM_NAME, {
    periodInMinutes: REMINDER_INTERVAL_MINUTES,
    delayInMinutes: 0.2,
  });
}

// Fetch reminders that are due and turn the ones we haven't shown yet into
// browser notifications.
async function maybeNotifyReminders() {
  const stored = await chrome.storage.local.get([
    "copilotAccessToken",
    "copilotApiUrl",
    "copilotRemindersEnabled",
    "copilotReminderSeen",
    "copilotNotificationTargets",
    "copilotAppUrl",
  ]);

  const token = readString(stored.copilotAccessToken).trim();
  if (!token) return;

  // Reminders default to on; only skip when explicitly disabled.
  if (stored.copilotRemindersEnabled === false) return;

  const reminders = await fetchDueReminders(stored.copilotApiUrl, token);
  if (!reminders) return;

  const now = Date.now();
  const dueSoon = reminders.filter((item) => {
    const dueAt = new Date(item.dueAt).getTime();
    return !Number.isNaN(dueAt) && dueAt <= now + DUE_SOON_WINDOW_MS;
  });

  // Start from the reminders we've recently shown, dropping anything older
  // than the dedupe window so it can be shown again later.
  const previousSeen = readObject(stored.copilotReminderSeen);
  const previousTargets = readObject(stored.copilotNotificationTargets);
  const nextSeen = {};
  const nextTargets = {};

  Object.entries(previousSeen).forEach(([key, seenAt]) => {
    if (typeof seenAt === "number" && now - seenAt < DEDUPE_WINDOW_MS) {
      nextSeen[key] = seenAt;
      if (previousTargets[key]) nextTargets[key] = previousTargets[key];
    }
  });

  for (const reminder of dueSoon.slice(0, MAX_NOTIFICATIONS_PER_CHECK)) {
    const dedupeKey = `${reminder.jobId}:${reminder.type}:${reminder.dueAt}`;
    if (nextSeen[dedupeKey]) continue;

    const notificationId = `copilot-${dedupeKey}`;
    await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("copilot-icon.svg"),
      title: "AI Job Copilot reminder",
      message: reminder.message,
      priority: 1,
    });

    nextSeen[dedupeKey] = now;
    nextTargets[notificationId] = { jobId: reminder.jobId };
  }

  await chrome.storage.local.set({
    copilotReminderSeen: nextSeen,
    copilotNotificationTargets: nextTargets,
  });
}

// Returns the list of reminders from the API, or null if the request failed
// or the response wasn't in the expected shape.
async function fetchDueReminders(apiUrl, token) {
  const apiBase = normalizeApiBase(readString(apiUrl, DEFAULT_API));
  const response = await fetch(`${apiBase}/jobs/reminders`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;

  const payload = await response.json();
  if (!payload.success || !Array.isArray(payload.data)) return null;
  return payload.data;
}

// Open the web app to the job a clicked notification points at.
async function openNotificationTarget(notificationId) {
  const stored = await chrome.storage.local.get([
    "copilotNotificationTargets",
    "copilotApiUrl",
    "copilotAppUrl",
  ]);

  const targets = readObject(stored.copilotNotificationTargets);
  const target = targets[notificationId];

  const apiBase = normalizeApiBase(readString(stored.copilotApiUrl, DEFAULT_API));
  const appBase = deriveAppBase(
    apiBase,
    typeof stored.copilotAppUrl === "string" ? stored.copilotAppUrl : undefined,
  );

  const url = target?.jobId
    ? `${appBase}/?tab=jobs&jobId=${encodeURIComponent(target.jobId)}`
    : `${appBase}/?tab=jobs`;

  await chrome.tabs.create({ url });
  await chrome.notifications.clear(notificationId);
}

chrome.runtime.onInstalled.addListener(() => {
  ensureReminderAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  ensureReminderAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== REMINDER_ALARM_NAME) return;
  void maybeNotifyReminders();
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object" || !("type" in message)) return;

  if (message.type === "copilot/check-reminders-now") {
    void maybeNotifyReminders();
    return;
  }

  if (message.type === "copilot/update-reminders-enabled") {
    if (typeof message.enabled === "boolean") {
      void chrome.storage.local.set({
        copilotRemindersEnabled: message.enabled,
      });
    }
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith("copilot-")) return;
  void openNotificationTarget(notificationId);
});
