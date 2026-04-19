import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { API_BASE_URL } from "../lib/config";
import { api } from "../lib/api";
import {
  authErrorClass,
  authLinkClass,
  authNoticeClass,
  buttonPrimaryClass,
  inputClass,
  labelClass,
  oauthLinkClass,
} from "../ui/theme";
import {
  BriefcaseIcon,
  SparklesIcon,
  ChartBarIcon,
  CheckCircleIcon,
  BuildingOfficeIcon,
  DocumentTextIcon,
} from "../ui/icons";

type OAuthStatus = {
  googleConfigured: boolean;
  githubConfigured: boolean;
};

const features = [
  {
    icon: BriefcaseIcon,
    title: "Kanban pipeline",
    desc: "Drag applications across Applied → Interview → Offer",
  },
  {
    icon: SparklesIcon,
    title: "AI-tailored resumes",
    desc: "Rewrite bullet points to match any job description",
  },
  {
    icon: DocumentTextIcon,
    title: "Cover letter generator",
    desc: "One-click professional cover letters in your voice",
  },
  {
    icon: ChartBarIcon,
    title: "Conversion analytics",
    desc: "Track interview & offer rates across your funnel",
  },
  {
    icon: BuildingOfficeIcon,
    title: "Company intelligence",
    desc: "Tech stack, funding stage & interview Q&A per company",
  },
  {
    icon: CheckCircleIcon,
    title: "Interview prep",
    desc: "AI-generated questions + mock interview scoring",
  },
];

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
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      {/* ── Left panel (desktop only) ── */}
      <div className="relative hidden overflow-hidden md:flex md:w-[48%] lg:w-[52%] xl:w-[55%] flex-col justify-between p-12">
        {/* Ambient gradients */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_110%_80%_at_20%_-10%,rgba(34,211,238,0.14),transparent_55%),radial-gradient(ellipse_80%_60%_at_80%_110%,rgba(20,184,166,0.10),transparent_50%)]"
        />
        {/* Subtle grid overlay */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.5) 1px,transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* Top — logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-teal-500 shadow-lg shadow-cyan-950/40">
              <BriefcaseIcon className="h-5 w-5 text-zinc-950" />
            </div>
            <span className="text-[15px] font-bold tracking-tight text-white">
              Job Copilot
            </span>
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            Your AI-powered job application workspace
          </p>
        </div>

        {/* Middle — features */}
        <div className="relative z-10 space-y-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400/80">
            Everything in one place
          </p>
          <div className="grid gap-4">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-700/60 bg-zinc-900/60">
                  <Icon className="h-4 w-4 text-cyan-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{title}</p>
                  <p className="text-xs text-zinc-500">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom — social proof */}
        <div className="relative z-10">
          <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Resume tailor + cover letter + interview prep
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              AI-powered fit scoring
            </span>
          </div>
        </div>
      </div>

      {/* ── Right panel — form ── */}
      <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-12 sm:px-10">
        {/* Background glow for mobile */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(34,211,238,0.08),transparent_60%)] lg:hidden"
        />

        <div className="relative w-full max-w-[400px]">
          {/* Mobile logo */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-teal-500 shadow-lg shadow-cyan-950/40">
              <BriefcaseIcon className="h-4 w-4 text-zinc-950" />
            </div>
            <span className="text-sm font-bold tracking-tight text-white">
              Job Copilot
            </span>
          </div>

          <header className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
              Welcome back
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Sign in to your pipeline and AI workspace.
            </p>
          </header>

          {/* OAuth */}
          {(oauthStatus.googleConfigured || oauthStatus.githubConfigured) && (
            <div className="mb-4 grid gap-2">
              {oauthStatus.googleConfigured && (
                <a
                  className={oauthLinkClass}
                  href={`${API_BASE_URL}/auth/oauth/google`}
                >
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    Continue with Google
                  </span>
                </a>
              )}
              {oauthStatus.githubConfigured && (
                <a
                  className={oauthLinkClass}
                  href={`${API_BASE_URL}/auth/oauth/github`}
                >
                  <span className="flex items-center justify-center gap-2">
                    <svg
                      className="h-4 w-4 fill-current"
                      viewBox="0 0 24 24"
                      aria-hidden
                    >
                      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
                    </svg>
                    Continue with GitHub
                  </span>
                </a>
              )}
              <div className="flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-zinc-800" />
                <span className="text-xs text-zinc-600">or</span>
                <div className="h-px flex-1 bg-zinc-800" />
              </div>
            </div>
          )}

          {!oauthStatus.googleConfigured && !oauthStatus.githubConfigured && (
            <p className={authNoticeClass}>
              Social login is not configured. Use email and password below.
            </p>
          )}

          <form className="space-y-4" onSubmit={onSubmit}>
            <label className="block">
              <span className={labelClass}>Email</span>
              <input
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </label>
            <label className="block">
              <span className={labelClass}>Password</span>
              <input
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </label>
            {error && <p className={authErrorClass}>{error}</p>}
            <button
              className={`${buttonPrimaryClass} w-full`}
              disabled={submitting}
              type="submit"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-zinc-500">
            No account?{" "}
            <Link className={authLinkClass} to="/register">
              Create one free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
