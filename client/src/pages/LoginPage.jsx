import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import {
  authBackdropClass,
  authCardClass,
  authErrorClass,
  authLinkClass,
  authPageClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  labelClass,
} from "../ui/theme";
import { BriefcaseIcon } from "../ui/icons";

// Email + password sign in. On success AuthProvider stores the access token
// in memory and we hand over to the dashboard.

// Seed data for the public demo account. Kept as a constant that the user has
// to opt into rather than as the form's initial state: prefilling real
// credentials makes every reviewer wonder whether they're a leaked secret, and
// it means the login form can never be tested empty.
const DEMO_CREDENTIALS = {
  email: "demo@copilot.local",
  password: "DemoPass123!",
};

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
    <div className={authPageClass}>
      <div aria-hidden className={authBackdropClass} />

      <div className={authCardClass}>
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-teal-500">
            <BriefcaseIcon className="h-4 w-4 text-zinc-950" />
          </div>
          <span className="text-sm font-bold tracking-tight text-white">
            Job Copilot
          </span>
        </div>

        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Sign in to your application pipeline.
          </p>
        </header>

        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className={labelClass}>Email</span>
            <input
              data-testid="login-email"
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
              data-testid="login-password"
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
            data-testid="login-submit"
            className={`${buttonPrimaryClass} w-full`}
            disabled={submitting}
            type="submit"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
          <button
            data-testid="login-demo"
            className={`${buttonSecondaryClass} w-full`}
            disabled={submitting}
            type="button"
            onClick={() => {
              setEmail(DEMO_CREDENTIALS.email);
              setPassword(DEMO_CREDENTIALS.password);
              setError("");
            }}
          >
            Use demo account
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
  );
}
