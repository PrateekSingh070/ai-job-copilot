import type { JobStatus } from "../types";

/** Shared form controls — dark zinc shell + cyan accent. */
export const inputClass =
  "w-full rounded-xl border border-zinc-700/70 bg-zinc-950/60 px-3 py-2.5 text-sm text-zinc-100 shadow-inner outline-none transition placeholder:text-zinc-500 focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/15";

export const buttonPrimaryClass =
  "rounded-xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-teal-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 shadow-lg shadow-cyan-950/30 transition hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45";

export const buttonSecondaryClass =
  "rounded-xl border border-zinc-600/70 bg-zinc-900/50 px-4 py-2.5 text-sm font-medium text-zinc-200 shadow-sm transition hover:border-zinc-500 hover:bg-zinc-800/80 disabled:cursor-not-allowed disabled:opacity-45";

export const statusTone: Record<JobStatus, string> = {
  APPLIED: "bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/25",
  INTERVIEW: "bg-violet-500/15 text-violet-200 ring-1 ring-violet-400/25",
  OFFER: "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/25",
  REJECTED: "bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/25",
};

export const authPageClass =
  "relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-zinc-950 px-4 py-12 text-zinc-100";

export const authBackdropClass =
  "pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(34,211,238,0.12),transparent_50%),radial-gradient(ellipse_90%_60%_at_100%_0%,rgba(20,184,166,0.08),transparent_45%),radial-gradient(ellipse_70%_50%_at_0%_100%,rgba(59,130,246,0.06),transparent_40%)]";

export const authCardClass =
  "relative w-full max-w-[400px] rounded-2xl border border-zinc-800/80 bg-zinc-900/70 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl";

/** OAuth provider buttons — ghost cards on dark. */
export const oauthLinkClass =
  "block w-full rounded-xl border border-zinc-600/70 bg-zinc-900/50 px-4 py-2.5 text-center text-sm font-medium text-zinc-100 shadow-sm transition hover:border-zinc-500 hover:bg-zinc-800/80";

export const authLinkClass =
  "font-medium text-cyan-400 underline underline-offset-2 transition hover:text-cyan-300";

export const labelClass = "mb-1 block text-sm font-medium text-zinc-400";

export const authNoticeClass =
  "mt-3 rounded-xl border border-amber-500/35 bg-amber-950/35 px-3 py-2 text-xs text-amber-200";

export const authErrorClass = "text-sm text-rose-300";
