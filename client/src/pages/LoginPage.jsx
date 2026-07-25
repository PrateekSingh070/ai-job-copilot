import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import {
  authErrorClass,
  authLinkClass,
  authNoticeClass,
  buttonPrimaryClass,
  inputClass,
  labelClass,
} from "../ui/theme";
import { OAuthButtons } from "../ui/OAuthButtons";
import { useOAuthStatus } from "../lib/useOAuthStatus";
import {
  BriefcaseIcon,
  SparklesIcon,
  ChartBarIcon,
  CheckCircleIcon,
  BuildingOfficeIcon,
  DocumentTextIcon,
} from "../ui/icons";

const features = [
  {
    icon: BriefcaseIcon,
    title: "Kanban pipeline",
    desc: "Drag applications across Applied â†’ Interview â†’ Offer",
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
  const oauthStatus = useOAuthStatus();

  async function onSubmit(e) {
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
      {/* â”€â”€ Left panel (desktop only) â”€â”€ */}
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

        {/* Top â€” logo */}
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

        {/* Middle â€” features */}
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

        {/* Bottom â€” social proof */}
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

      {/* â”€â”€ Right panel â€” form â”€â”€ */}
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
          <OAuthButtons oauthStatus={oauthStatus} />

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
                placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
              />
            </label>
            {error && <p className={authErrorClass}>{error}</p>}
            <button
              className={`${buttonPrimaryClass} w-full`}
              disabled={submitting}
              type="submit"
            >
              {submitting ? "Signing inâ€¦" : "Sign in"}
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
