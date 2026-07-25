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
import { BriefcaseIcon, RocketLaunchIcon } from "../ui/icons";

const steps = [
  { num: "1", label: "Create account" },
  { num: "2", label: "Add your first job" },
  { num: "3", label: "Let AI tailor your resume" },
];

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const oauthStatus = useOAuthStatus();

  async function onSubmit(e) {
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
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      {/* â”€â”€ Left panel (desktop only) â”€â”€ */}
      <div className="relative hidden overflow-hidden md:flex md:w-[48%] lg:w-[52%] xl:w-[55%] flex-col justify-between p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_110%_80%_at_10%_20%,rgba(20,184,166,0.14),transparent_55%),radial-gradient(ellipse_80%_60%_at_90%_-10%,rgba(34,211,238,0.10),transparent_50%)]"
        />

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

        {/* Middle â€” onboarding steps */}
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-6">
            <RocketLaunchIcon className="h-5 w-5 text-teal-400" />
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-400/90">
              Get started in 3 steps
            </p>
          </div>
          <div className="relative space-y-6">
            {/* Connector line */}
            <div className="absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px bg-gradient-to-b from-cyan-400/30 via-teal-400/20 to-transparent" />
            {steps.map(({ num, label }, i) => (
              <div key={num} className="flex items-start gap-4">
                <div
                  className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                    i === 0
                      ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-300"
                      : "border-zinc-700/60 bg-zinc-900/60 text-zinc-500"
                  }`}
                >
                  {num}
                </div>
                <div className="pt-1">
                  <p
                    className={`text-sm font-semibold ${i === 0 ? "text-zinc-100" : "text-zinc-400"}`}
                  >
                    {label}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 rounded-2xl border border-zinc-800/80 bg-zinc-900/50 p-5 backdrop-blur-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              What you get
            </p>
            <ul className="mt-3 space-y-2 text-sm text-zinc-300">
              {[
                "Kanban tracker for all your applications",
                "AI resume tailoring + cover letters",
                "Interview prep & mock sessions",
                "Company intel & fit scoring",
                "CSV export & PDF packets",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400/70" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="relative z-10">
          <p className="text-xs text-zinc-600">
            No credit card required. Free to start.
          </p>
        </div>
      </div>

      {/* â”€â”€ Right panel â€” form â”€â”€ */}
      <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-12 sm:px-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(20,184,166,0.07),transparent_60%)] lg:hidden"
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
              Create your account
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Start tracking roles and generating tailored materials in minutes.
            </p>
          </header>

          {/* OAuth */}
          <OAuthButtons oauthStatus={oauthStatus} />

          {!oauthStatus.googleConfigured && !oauthStatus.githubConfigured && (
            <p className={authNoticeClass}>
              Social signup is not configured. Use email and password below.
            </p>
          )}

          <form className="space-y-4" onSubmit={onSubmit}>
            <label className="block">
              <span className={labelClass}>Full name</span>
              <input
                data-testid="register-name"
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
                placeholder="Alex Johnson"
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
                placeholder="you@example.com"
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
                placeholder="Min. 8 characters"
              />
            </label>
            {error && <p className={authErrorClass}>{error}</p>}
            <button
              data-testid="register-submit"
              className={`${buttonPrimaryClass} w-full`}
              disabled={submitting}
              type="submit"
            >
              {submitting ? "Creating accountâ€¦" : "Create account"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-zinc-500">
            Already have an account?{" "}
            <Link className={authLinkClass} to="/login">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
