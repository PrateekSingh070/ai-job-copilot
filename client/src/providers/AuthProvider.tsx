import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../lib/api";
import { clearAccessToken, getAccessToken, setAccessToken } from "../lib/token";
import type { User } from "../types";

type AuthContextType = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    const onSessionExpired = () => {
      clearAccessToken();
      setUser(null);
    };
    window.addEventListener("auth:session-expired", onSessionExpired);
    return () =>
      window.removeEventListener("auth:session-expired", onSessionExpired);
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      loading,
      async login(email: string, password: string) {
        const res = await api.post("/auth/login", { email, password });
        setAccessToken(res.data.data.accessToken);
        setUser(res.data.data.user);
      },
      async register(name: string, email: string, password: string) {
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
