/**
 * API origin for axios. `VITE_API_URL` (build-time) wins when set.
 * When the SPA is served from the default Vercel hosts for this project,
 * fall back to the paired API deployment so production works without
 * extra dashboard configuration.
 */
export function resolveApiBaseUrl(): string {
  const explicit = import.meta.env.VITE_API_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && import.meta.env.PROD) {
    const { protocol, hostname } = window.location;
    if (
      protocol === "https:" &&
      hostname.endsWith(".vercel.app") &&
      hostname.startsWith("ai-job-copilot-client")
    ) {
      return "https://ai-job-copilot-api.vercel.app";
    }
  }
  return "http://localhost:4000";
}
