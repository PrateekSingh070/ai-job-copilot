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
import { DocumentTextIcon } from "../ui/icons";

// Generate a cover letter from resume + job description. resumeText is optional
// in the request: when omitted the server pulls from the saved profile.
export function CoverLetter() {
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [hiringManager, setHiringManager] = useState("");

  const generate = useMutation({
    mutationFn: async () =>
      (
        await api.post("/ai/cover-letter", {
          company,
          role,
          jobDescription,
          tone: "professional",
          hiringManager: hiringManager || undefined,
        })
      ).data.data.output,
  });

  const result = generate.data;

  function copyToClipboard() {
    const text = result.letterBody.join("\n\n");
    navigator.clipboard.writeText(text);
  }

  return (
    <section className="mt-4 grid gap-4 sm:mt-6 lg:grid-cols-2">
      {/* Input side */}
      <form
        className={panelClass}
        onSubmit={(e) => {
          e.preventDefault();
          generate.mutate();
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <DocumentTextIcon className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Cover Letter</h3>
        </div>
        <label className="block">
          <span className={labelClass}>Company</span>
          <input
            data-testid="letter-company"
            className={inputClass}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Acme Labs"
            required
          />
        </label>
        <label className="mt-3 block">
          <span className={labelClass}>Role</span>
          <input
            data-testid="letter-role"
            className={inputClass}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Full Stack Engineer"
            required
          />
        </label>
        <label className="mt-3 block">
          <span className={labelClass}>Hiring manager (optional)</span>
          <input
            data-testid="letter-manager"
            className={inputClass}
            value={hiringManager}
            onChange={(e) => setHiringManager(e.target.value)}
            placeholder="Leave blank if not known"
          />
        </label>
        <label className="mt-3 block">
          <span className={labelClass}>Job description</span>
          <textarea
            data-testid="letter-jd"
            className={`${inputClass} h-40`}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="Paste the job description (at least 50 characters)"
            required
          />
        </label>
        <button
          data-testid="letter-submit"
          className={`${buttonPrimaryClass} mt-4 w-full`}
          type="submit"
          disabled={generate.isPending}
        >
          {generate.isPending ? "Generating…" : "Generate letter"}
        </button>
        {generate.isError ? (
          <p className="mt-3 rounded-lg border border-rose-500/35 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {extractApiErrorMessage(
              generate.error,
              "Could not generate the letter. Please try again.",
            )}
          </p>
        ) : null}
      </form>

      {/* Output side */}
      <div className={panelClass} data-testid="letter-output">
        {!result ? (
          <p className="text-sm text-zinc-500">
            The cover letter appears here. Uses your saved resume automatically.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-100">
                {result.subjectLine}
              </h3>
              <button
                type="button"
                onClick={copyToClipboard}
                className="rounded-lg border border-zinc-700/70 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800/80"
              >
                Copy
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-zinc-200">
              {result.letterBody.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
            {result.keyPointsUsed?.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {result.keyPointsUsed.map((point) => (
                  <span
                    key={point}
                    className="rounded-lg border border-zinc-700/70 bg-zinc-950/50 px-2 py-1 text-[11px] text-zinc-300"
                  >
                    {point}
                  </span>
                ))}
              </div>
            )}
            <p className="mt-4 text-xs text-zinc-500">
              {result.wordCount} words
            </p>
          </>
        )}
      </div>
    </section>
  );
}
