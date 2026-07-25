import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  api,
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Set as soon as a sign-in or sign-out happens. The boot-time refresh below
  // may still be in flight at that point, and its result is stale the moment
  // the user acts, so every await in it checks this before touching state.
  const supersededRef = useRef(false);

  // On first load there is never an access token in memory, so trade the
  // httpOnly refresh cookie for a fresh one before asking who the user is.
  // No cookie means no session, and we fall through to the login screen.
  useEffect(() => {
    const bootstrap = async () => {
      try {
        if (!getAccessToken()) {
          const refreshed = await api.post("/auth/refresh");
          if (supersededRef.current) return;
          setAccessToken(refreshed.data.data.accessToken);
        }
        const me = await api.get("/auth/me");
        if (supersededRef.current) return;
        setUser(me.data.data);
      } catch {
        if (supersededRef.current) return;
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
        supersededRef.current = true;
        const res = await api.post("/auth/login", { email, password });
        setAccessToken(res.data.data.accessToken);
        setUser(res.data.data.user);
      },
      async register(name, email, password) {
        supersededRef.current = true;
        const res = await api.post("/auth/register", { name, email, password });
        setAccessToken(res.data.data.accessToken);
        setUser(res.data.data.user);
      },
      async logout() {
        supersededRef.current = true;
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
