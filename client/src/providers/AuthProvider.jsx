import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { clearAccessToken, getAccessToken, setAccessToken } from "../lib/token";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On first load, restore the session from a stored access token (if any) by
  // asking the API who the current user is.
  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    const bootstrap = async () => {
      try {
        const me = await api.get("/auth/me");
        setUser(me.data.data);
      } catch {
        clearAccessToken();
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    void bootstrap();
  }, []);

  // The API layer fires "auth:session-expired" when a token refresh fails.
  // Clear the user so the app falls back to the login screen.
  useEffect(() => {
    const onSessionExpired = () => {
      clearAccessToken();
      setUser(null);
    };
    window.addEventListener("auth:session-expired", onSessionExpired);
    return () =>
      window.removeEventListener("auth:session-expired", onSessionExpired);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      async login(email, password) {
        const res = await api.post("/auth/login", { email, password });
        setAccessToken(res.data.data.accessToken);
        setUser(res.data.data.user);
      },
      async register(name, email, password) {
        const res = await api.post("/auth/register", { name, email, password });
        setAccessToken(res.data.data.accessToken);
        setUser(res.data.data.user);
      },
      async logout() {
        try {
          await api.post("/auth/logout");
        } catch {
          // best-effort logout; local cleanup still executes
        }
        clearAccessToken();
        setUser(null);
      },
    }),
    [loading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}
