import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { extractApiErrorMessage } from "../lib/dashboardHelpers.js";
import {
  buttonPrimaryClass,
  inputClass,
  labelClass,
  panelClass,
} from "../ui/theme.js";
import { AcademicCapIcon } from "../ui/icons";

// Ranks what the resume is missing vs. a JD. resumeText is optional — when
// omitted the server pulls from the saved profile.
export function SkillGap() {
  const [jobDescription, setJobDescription] = useState("");
  const [targetRole, setTargetRole] = useState("");

  const analyze = useMutation({
    mutationFn: async () =>
      (
        await api.post("/ai/skill-gap", {
          jobDescription,
          targetRole: targetRole || undefined,
        })
      ).data.data.output,
  });

  const result = analyze.data;

  return (
    <section className="mt-4 grid gap-4 sm:mt-6 lg:grid-cols-2">
      {/* Input side */}
      <form
        className={panelClass}
        onSubmit={(e) => {
          e.preventDefault();
          analyze.mutate();
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <AcademicCapIcon className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Skill Gap</h3>
        </div>
        <label className="block">
          <span className={labelClass}>Target role (optional)</span>
          <input
            data-testid="gap-role"
            className={inputClass}
            value={targetRole}
            onChange={(e) => setTargetRole(e.target.value)}
            placeholder="Backend Engineer"
          />
        </label>
        <label className="mt-3 block">
          <span className={labelClass}>Job description</span>
          <textarea
            data-testid="gap-jd"
            className={`${inputClass} h-48`}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="Paste the job description (at least 50 characters)"
            required
          />
        </label>
        <button
          data-testid="gap-submit"
          className={`${buttonPrimaryClass} mt-4 w-full`}
          type="submit"
          disabled={analyze.isPending}
        >
          {analyze.isPending ? "Analyzing…" : "Analyze gaps"}
        </button>
        {analyze.isError ? (
          <p className="mt-3 rounded-lg border border-rose-500/35 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {extractApiErrorMessage(
              analyze.error,
              "Could not analyze gaps. Please try again.",
            )}
          </p>
        ) : null}
      </form>

      {/* Output side */}
      <div className={panelClass} data-testid="gap-output">
        {!result ? (
          <p className="text-sm text-zinc-500">
            The gap analysis appears here. Uses your saved resume automatically.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-100">
                Overall readiness
              </h3>
              <span className="text-sm font-bold text-cyan-300">
                {result.overallReadiness}%
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-teal-500 transition-all"
                style={{ width: `${result.overallReadiness}%` }}
              />
            </div>

            {result.presentSkills?.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Present
                </h4>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.presentSkills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-lg border border-emerald-700/70 bg-emerald-950/50 px-2 py-1 text-[11px] text-emerald-300"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {result.missingSkills?.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Missing
                </h4>
                <div className="mt-2 space-y-2">
                  {result.missingSkills.map((item) => (
                    <div
                      key={item.skill}
                      className={`rounded-lg border px-3 py-2 ${
                        item.importance === "critical"
                          ? "border-rose-700/70 bg-rose-950/40"
                          : "border-amber-700/70 bg-amber-950/40"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-semibold ${
                            item.importance === "critical"
                              ? "text-rose-300"
                              : "text-amber-300"
                          }`}
                        >
                          {item.skill}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            item.importance === "critical"
                              ? "bg-rose-900/60 text-rose-200"
                              : "bg-amber-900/60 text-amber-200"
                          }`}
                        >
                          {item.importance}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                        {item.whyItMatters}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                        → {item.howToClose}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
