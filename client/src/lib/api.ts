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

let refreshing = false;
let queue: Array<{ resolve: () => void; reject: (error: unknown) => void }> =
  [];

function notifySessionExpired() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("auth:session-expired"));
}

function notifyAiRateLimited(message: string) {
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
    if (error?.response?.status !== 401 || error.config._retry) {
      throw error;
    }
    if (refreshing) {
      await new Promise<void>((resolve, reject) =>
        queue.push({ resolve, reject }),
      );
      return api(error.config);
    }
    refreshing = true;
    error.config._retry = true;
    try {
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
