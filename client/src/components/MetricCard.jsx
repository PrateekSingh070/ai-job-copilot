import { sectionHeaderClass } from "../ui/theme.js";

// Small stat card used in the "Pipeline snapshot" grid.
export function MetricCard({ label, value, icon: Icon, accent = "cyan" }) {
  const accentMap = {
    cyan: "text-cyan-400 bg-cyan-400/10",
    violet: "text-violet-400 bg-violet-400/10",
    emerald: "text-emerald-400 bg-emerald-400/10",
    sky: "text-sky-400 bg-sky-400/10",
  };
  const accentClass = accentMap[accent] ?? accentMap.cyan;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-3 shadow-lift backdrop-blur-sm transition hover:border-zinc-700/80 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <p className={sectionHeaderClass}>{label}</p>
        {Icon && (
          <div
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${accentClass}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
      <p className="mt-2 text-xl font-bold tabular-nums tracking-tight text-white sm:text-2xl">
        {value}
      </p>
    </div>
  );
}
