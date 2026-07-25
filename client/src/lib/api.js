import axios from "axios";
import { clearAccessToken, getAccessToken, setAccessToken } from "./token";
import { resolveApiBaseUrl } from "./apiBaseUrl";

const API_URL = resolveApiBaseUrl();

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
// fresh token (or rejected together if the refresh fails).
let refreshing = false;
let queue = [];

function notifySessionExpired() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("auth:session-expired"));
}

function notifyAiRateLimited(message) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("ai:rate-limited", { detail: { message } }),
  );
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (
      error?.response?.status === 429 &&
      error?.response?.data?.error?.code === "AI_RATE_LIMITED"
    ) {
      notifyAiRateLimited(
        error?.response?.data?.error?.message ??
          "AI request limit reached. Please wait and try again.",
      );
      throw error;
    }
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
