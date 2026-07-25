// Pure, framework-free helpers used by the dashboard.
// Keeping this logic out of the components lets the UI files stay focused on
// rendering. Nothing here touches React state, so each function can be read
// and reasoned about on its own.

// Pipeline stages, in the order the Kanban columns are rendered.
export const statuses = ["APPLIED", "INTERVIEW", "OFFER", "REJECTED"];

// Human-readable label shown on each Kanban column header.
export const statusLabels = {
  APPLIED: "Applied",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  REJECTED: "Rejected",
};

// Avatar background/text color for a job card, keyed by pipeline status.
export const avatarToneByStatus = {
  APPLIED: "bg-sky-400/15 text-sky-300",
  INTERVIEW: "bg-violet-400/15 text-violet-300",
  OFFER: "bg-emerald-400/15 text-emerald-300",
  REJECTED: "bg-rose-400/15 text-rose-300",
};

// Pull the API's error message out of an axios error, falling back to a
// friendly default when the server didn't send one.
export function extractApiErrorMessage(error, fallback) {
  if (!error || typeof error !== "object") return fallback;
  const message = error.response?.data?.error?.message;
  return typeof message === "string" && message.trim().length > 0
    ? message
    : fallback;
}
