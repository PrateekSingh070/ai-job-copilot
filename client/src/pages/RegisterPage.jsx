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
  inputClass,
  labelClass,
} from "../ui/theme";
import { BriefcaseIcon } from "../ui/icons";

// Name + email + password sign up. Registering logs you straight in.
export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
            Create your account
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Track roles and tailor your resume in minutes.
          </p>
        </header>

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
            {submitting ? "Creating account…" : "Create account"}
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
  );
}
