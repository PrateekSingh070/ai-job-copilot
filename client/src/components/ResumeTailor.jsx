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
import { SparklesIcon } from "../ui/icons";

// Single AI feature: paste a resume + job description, get rewritten bullets,
// a match score and a short explanation from POST /ai/resume-tailor.
export function ResumeTailor() {
  const [targetRole, setTargetRole] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [jobDescription, setJobDescription] = useState("");

  const tailor = useMutation({
    mutationFn: async () =>
      (
        await api.post("/ai/resume-tailor", {
          targetRole,
          resumeText,
          jobDescription,
          tone: "impactful",
        })
      ).data.data.output,
  });

  const result = tailor.data;

  return (
    <section className="mt-4 grid gap-4 sm:mt-6 lg:grid-cols-2">
      {/* Input side */}
      <form
        className={panelClass}
        onSubmit={(e) => {
          e.preventDefault();
          tailor.mutate();
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <SparklesIcon className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Resume Tailor</h3>
        </div>
        <label className="block">
          <span className={labelClass}>Target role</span>
          <input
            data-testid="tailor-role"
            className={inputClass}
            value={targetRole}
            onChange={(e) => setTargetRole(e.target.value)}
            placeholder="Full Stack Engineer"
            required
          />
        </label>
        <label className="mt-3 block">
          <span className={labelClass}>Your resume text</span>
          <textarea
            data-testid="tailor-resume"
            className={`${inputClass} h-40`}
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            placeholder="Paste your resume (at least 50 characters)"
            required
          />
        </label>
        <label className="mt-3 block">
          <span className={labelClass}>Job description</span>
          <textarea
            data-testid="tailor-jd"
            className={`${inputClass} h-40`}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="Paste the job description (at least 50 characters)"
            required
          />
        </label>
        <button
          data-testid="tailor-submit"
          className={`${buttonPrimaryClass} mt-4 w-full`}
          type="submit"
          disabled={tailor.isPending}
        >
          {tailor.isPending ? "Tailoring…" : "Tailor my resume"}
        </button>
        {tailor.isError ? (
          <p className="mt-3 rounded-lg border border-rose-500/35 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {extractApiErrorMessage(
              tailor.error,
              "Could not tailor the resume. Please try again.",
            )}
          </p>
        ) : null}
      </form>

      {/* Output side */}
      <div className={panelClass} data-testid="tailor-output">
        {!result ? (
          <p className="text-sm text-zinc-500">
            Results appear here: rewritten bullets, a match score and why it
            scored that way.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-100">
                Tailored bullets
              </h3>
              <span className="rounded-full bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-200 ring-1 ring-cyan-400/25">
                Match {result.matchScore}%
              </span>
            </div>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-zinc-200">
              {result.rewrittenBullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            {result.extractedKeywords?.length ? (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {result.extractedKeywords.map((keyword) => (
                  <span
                    key={keyword}
                    className="rounded-lg border border-zinc-700/70 bg-zinc-950/50 px-2 py-1 text-[11px] text-zinc-300"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            ) : null}
            <p className="mt-4 text-xs leading-relaxed text-zinc-400">
              {result.explanation}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
