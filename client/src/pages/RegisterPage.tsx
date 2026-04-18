import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { API_BASE_URL } from "../lib/config";
import { api } from "../lib/api";
import {
  authBackdropClass,
  authCardClass,
  authErrorClass,
  authLinkClass,
  authNoticeClass,
  authPageClass,
  buttonPrimaryClass,
  inputClass,
  labelClass,
  oauthLinkClass,
} from "../ui/theme";

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
    <main className={authPageClass}>
      <div className={authBackdropClass} aria-hidden />
      <div className={authCardClass}>
        <header className="mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-400/90">
            Job Copilot
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-50">
            Create account
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Start tracking roles and generating tailored materials in minutes.
          </p>
        </header>

        <div className="grid gap-2">
          {oauthStatus.googleConfigured ? (
            <a
              className={oauthLinkClass}
              href={`${API_BASE_URL}/auth/oauth/google`}
            >
              Continue with Google
            </a>
          ) : null}
          {oauthStatus.githubConfigured ? (
            <a
              className={oauthLinkClass}
              href={`${API_BASE_URL}/auth/oauth/github`}
            >
              Continue with GitHub
            </a>
          ) : null}
        </div>
        {!oauthStatus.googleConfigured && !oauthStatus.githubConfigured ? (
          <p className={authNoticeClass}>
            Social signup is not configured yet. Use email and password for now.
          </p>
        ) : null}

        <p className="mt-4 text-center text-xs text-zinc-500">
          or register with email
        </p>

        <form className="mt-5 space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className={labelClass}>Name</span>
            <input
              data-testid="register-name"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
            />
          </label>
          <label className="block">
            <span className={labelClass}>Email</span>
            <input
              data-testid="register-email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              autoComplete="email"
            />
          </label>
          <label className="block">
            <span className={labelClass}>Password</span>
            <input
              data-testid="register-password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              autoComplete="new-password"
            />
          </label>
          {error ? <p className={authErrorClass}>{error}</p> : null}
          <button
            data-testid="register-submit"
            className={`${buttonPrimaryClass} w-full`}
            disabled={submitting}
            type="submit"
          >
            {submitting ? "Creating…" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500">
          Already have an account?{" "}
          <Link className={authLinkClass} to="/login">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
