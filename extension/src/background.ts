const DEFAULT_API = "http://localhost:4000";
const DEFAULT_APP = "http://localhost:5173";
const REMINDER_ALARM_NAME = "copilot-reminder-check";
const REMINDER_INTERVAL_MINUTES = 30;
const DEDUPE_WINDOW_MS = 1000 * 60 * 60 * 12;

type Reminder = {
  jobId: string;
  type: string;
  dueAt: string;
  message: string;
};

function ensureReminderAlarm() {
  chrome.alarms.create(REMINDER_ALARM_NAME, {
    periodInMinutes: REMINDER_INTERVAL_MINUTES,
    delayInMinutes: 0.2,
  });
}

function normalizeApiBase(url: string): string {
  const trimmed = (url || DEFAULT_API).trim();
  return trimmed.replace(/\/$/, "");
}

function deriveAppBase(
  apiBase: string,
  explicitAppBase: string | undefined,
): string {
  if (explicitAppBase && explicitAppBase.trim())
    return explicitAppBase.trim().replace(/\/$/, "");
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

async function maybeNotifyReminders() {
  const values = await chrome.storage.local.get([
    "copilotAccessToken",
    "copilotApiUrl",
    "copilotRemindersEnabled",
    "copilotReminderSeen",
    "copilotNotificationTargets",
    "copilotAppUrl",
  ]);
  const token =
    typeof values.copilotAccessToken === "string"
      ? values.copilotAccessToken.trim()
      : "";
  if (!token) return;

  const remindersEnabled = values.copilotRemindersEnabled !== false;
  if (!remindersEnabled) return;

  const apiBase = normalizeApiBase(
    typeof values.copilotApiUrl === "string"
      ? values.copilotApiUrl
      : DEFAULT_API,
  );
  const response = await fetch(`${apiBase}/jobs/reminders`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return;
  const payload = (await response.json()) as {
    success?: boolean;
    data?: Reminder[];
  };
  if (!payload.success || !Array.isArray(payload.data)) return;

  const now = Date.now();
  const dueSoon = payload.data.filter((item) => {
    const dueAt = new Date(item.dueAt).getTime();
    return !Number.isNaN(dueAt) && dueAt <= now + 1000 * 60 * 60 * 24;
  });

  const previousSeen =
    values.copilotReminderSeen && typeof values.copilotReminderSeen === "object"
      ? (values.copilotReminderSeen as Record<string, number>)
      : {};
  const nextSeen: Record<string, number> = {};
  const previousTargets =
    values.copilotNotificationTargets &&
    typeof values.copilotNotificationTargets === "object"
      ? (values.copilotNotificationTargets as Record<string, { jobId: string }>)
      : {};
  const nextTargets: Record<string, { jobId: string }> = {};

  Object.entries(previousSeen).forEach(([key, seenAt]) => {
    if (typeof seenAt === "number" && now - seenAt < DEDUPE_WINDOW_MS) {
      nextSeen[key] = seenAt;
      if (previousTargets[key]) nextTargets[key] = previousTargets[key];
    }
  });

  for (const reminder of dueSoon.slice(0, 5)) {
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

chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (!notificationId.startsWith("copilot-")) return;
  const values = await chrome.storage.local.get([
    "copilotNotificationTargets",
    "copilotApiUrl",
    "copilotAppUrl",
  ]);
  const targets =
    values.copilotNotificationTargets &&
    typeof values.copilotNotificationTargets === "object"
      ? (values.copilotNotificationTargets as Record<string, { jobId: string }>)
      : {};
  const target = targets[notificationId];
  const apiBase = normalizeApiBase(
    typeof values.copilotApiUrl === "string"
      ? values.copilotApiUrl
      : DEFAULT_API,
  );
  const appBase = deriveAppBase(
    apiBase,
    typeof values.copilotAppUrl === "string" ? values.copilotAppUrl : undefined,
  );
  const url = target?.jobId
    ? `${appBase}/?tab=jobs&jobId=${encodeURIComponent(target.jobId)}`
    : `${appBase}/?tab=jobs`;
  await chrome.tabs.create({ url });
  await chrome.notifications.clear(notificationId);
});
