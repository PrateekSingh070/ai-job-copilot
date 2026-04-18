import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { API_BASE_URL } from "../lib/config";
import { api } from "../lib/api";

type OAuthStatus = {
  googleConfigured: boolean;
  githubConfigured: boolean;
};

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      await register(name, email, password);
      navigate("/dashboard");
    } catch {
      setError("Unable to register");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md rounded-xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold text-slate-900">Create account</h1>
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
            Social signup is not configured yet. Use email/password for now.
          </p>
        ) : null}
        <p className="mt-3 text-center text-xs text-slate-500">
          or register with email
        </p>
        <form className="mt-4 space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-700">Name</span>
            <input
              data-testid="register-name"
              className="w-full rounded border border-slate-300 px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-700">Email</span>
            <input
              data-testid="register-email"
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
              data-testid="register-password"
              className="w-full rounded border border-slate-300 px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            data-testid="register-submit"
            className="w-full rounded bg-brand-600 px-4 py-2 font-medium text-white disabled:opacity-60"
            disabled={submitting}
            type="submit"
          >
            {submitting ? "Creating..." : "Create account"}
          </button>
        </form>
        <p className="mt-4 text-sm text-slate-600">
          Already have an account?{" "}
          <Link className="text-brand-600 underline" to="/login">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
