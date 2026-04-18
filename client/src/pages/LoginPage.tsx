import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { API_BASE_URL } from "../lib/config";
import { api } from "../lib/api";

type OAuthStatus = {
  googleConfigured: boolean;
  githubConfigured: boolean;
};

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("demo@copilot.local");
  const [password, setPassword] = useState("DemoPass123!");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>({
    googleConfigured: false,
    githubConfigured: false,
  });

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<{ success: true; data: OAuthStatus }>(
          "/auth/oauth/status",
        );
        setOauthStatus(res.data.data);
      } catch {
        // Keep OAuth disabled when status check fails.
      }
    })();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch {
      setError("Invalid credentials");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md rounded-xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold text-slate-900">Login</h1>
        <p className="mt-1 text-sm text-slate-600">
          AI Job Application Copilot
        </p>
        <div className="mt-4 grid gap-2">
          {oauthStatus.googleConfigured ? (
            <a
              className="block w-full rounded border border-slate-300 bg-white px-4 py-2 text-center text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50"
              href={`${API_BASE_URL}/auth/oauth/google`}
            >
              Continue with Google
            </a>
          ) : null}
          {oauthStatus.githubConfigured ? (
            <a
              className="block w-full rounded border border-slate-300 bg-white px-4 py-2 text-center text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50"
              href={`${API_BASE_URL}/auth/oauth/github`}
            >
              Continue with GitHub
            </a>
          ) : null}
        </div>
        {!oauthStatus.googleConfigured && !oauthStatus.githubConfigured ? (
          <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Social login is not configured yet. Use email/password for now.
          </p>
        ) : null}
        <p className="mt-3 text-center text-xs text-slate-500">
          or sign in with email
        </p>
        <form className="mt-4 space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-700">Email</span>
            <input
              className="w-full rounded border border-slate-300 px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-700">Password</span>
            <input
              className="w-full rounded border border-slate-300 px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            className="w-full rounded bg-brand-600 px-4 py-2 font-medium text-white disabled:opacity-60"
            disabled={submitting}
            type="submit"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-sm text-slate-600">
          No account?{" "}
          <Link className="text-brand-600 underline" to="/register">
            Register
          </Link>
        </p>
      </div>
    </main>
  );
}
