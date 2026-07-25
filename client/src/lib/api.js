import axios from "axios";

// Everything about talking to the API lives here: where it is, how the access
// token is held, and how an expired token is renewed transparently.

/**
 * API origin for axios. `VITE_API_URL` (build-time) wins when set.
 * When the SPA is served from the default Vercel hosts for this project,
 * fall back to the paired API deployment so production works without
 * extra dashboard configuration.
 */
function resolveApiBaseUrl() {
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

const API_URL = resolveApiBaseUrl();

// The access token lives in a module variable and is never written to
// localStorage or a script-readable cookie, so an XSS payload has nothing to
// steal. The trade-off is that a page reload starts with no token, so
// AuthProvider exchanges the httpOnly refresh cookie for a new one on boot.
let accessToken = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token ?? null;
}

export function clearAccessToken() {
  accessToken = null;
}

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Only one token refresh should be in flight at a time. While it runs, other
// requests that hit a 401 wait in `queue` and are replayed once we have a
// fresh token (or rejected together if the refresh fails). Without this, every
// concurrent 401 would refresh separately, and since the server rotates and
// revokes on each refresh, all but one would fail and log the user out.
let refreshing = false;
let queue = [];

function notifySessionExpired() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("auth:session-expired"));
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Give up on anything that isn't an auth failure, or that we've already
    // retried once (prevents infinite refresh loops).
    if (error?.response?.status !== 401 || error.config._retry) {
      throw error;
    }
    // A refresh is already running: wait for it, then retry this request.
    if (refreshing) {
      await new Promise((resolve, reject) => queue.push({ resolve, reject }));
      return api(error.config);
    }
    refreshing = true;
    error.config._retry = true;
    try {
      // Exchange the httpOnly refresh cookie for a new access token, then
      // release every queued request so they can retry with it.
      const refresh = await axios.post(
        `${API_URL}/auth/refresh`,
        {},
        { withCredentials: true },
      );
      setAccessToken(refresh.data.data.accessToken);
      queue.forEach((item) => item.resolve());
      queue = [];
      return api(error.config);
    } catch (refreshError) {
      // Refresh failed: drop the token and tell the app the session is over.
      queue.forEach((item) => item.reject(refreshError));
      queue = [];
      clearAccessToken();
      notifySessionExpired();
      throw refreshError;
    } finally {
      refreshing = false;
    }
  },
);
