import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { extractApiErrorMessage } from "../lib/dashboardHelpers.js";
import {
  buttonPrimaryClass,
  inputClass,
  labelClass,
  panelClass,
} from "../ui/theme.js";
import { DocumentTextIcon } from "../ui/icons";

// User profile with saved resume. Cover letter, skill gap, and chat all pull
// from this automatically when resumeText is omitted, so you paste once rather
// than three times.
export function ResumeProfile() {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const resumeQuery = useQuery({
    queryKey: ["resume"],
    queryFn: async () => (await api.get("/resume")).data.data,
  });

  const saveResume = useMutation({
    mutationFn: async () => api.put("/resume", { title, content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resume"] });
    },
  });

  const deleteResume = useMutation({
    mutationFn: async () => api.delete("/resume"),
    onSuccess: () => {
      setTitle("");
      setContent("");
      qc.invalidateQueries({ queryKey: ["resume"] });
    },
  });

  // Seed the form from the server exactly once per fetched record. Keying the
  // effect on the row id rather than the query object means a refetch after a
  // save doesn't clobber edits the user has made in the meantime — and it
  // avoids setting state during render, which React 19 rejects.
  const savedId = resumeQuery.data?.id;
  useEffect(() => {
    if (!resumeQuery.data) return;
    setTitle(resumeQuery.data.title ?? "");
    setContent(resumeQuery.data.content ?? "");
  }, [savedId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`${panelClass} mt-4 sm:mt-6`}>
      <div className="mb-3 flex items-center gap-2">
        <DocumentTextIcon className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-zinc-100">Your Resume</h3>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveResume.mutate();
        }}
      >
        <label className="block">
          <span className={labelClass}>Title (optional)</span>
          <input
            data-testid="resume-title"
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="My Software Resume"
          />
        </label>

        <label className="mt-3 block">
          <span className={labelClass}>Resume content</span>
          <textarea
            data-testid="resume-content"
            className={`${inputClass} h-64`}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste your resume here (at least 50 characters)"
            required
          />
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            data-testid="resume-save"
            className={buttonPrimaryClass}
            type="submit"
            disabled={saveResume.isPending}
          >
            {saveResume.isPending ? "Saving…" : "Save resume"}
          </button>

          {resumeQuery.data && (
            <button
              data-testid="resume-delete"
              type="button"
              className="rounded-xl border border-rose-600/70 bg-rose-950/50 px-4 py-2.5 text-sm font-medium text-rose-200 transition hover:border-rose-500 hover:bg-rose-900/60 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => deleteResume.mutate()}
              disabled={deleteResume.isPending}
            >
              {deleteResume.isPending ? "Deleting…" : "Delete"}
            </button>
          )}
        </div>

        {saveResume.isError && (
          <p className="mt-3 rounded-lg border border-rose-500/35 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {extractApiErrorMessage(
              saveResume.error,
              "Could not save the resume. Please try again.",
            )}
          </p>
        )}

        {saveResume.isSuccess && (
          <p className="mt-3 rounded-lg border border-emerald-500/35 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
            Resume saved. AI features will use this automatically.
          </p>
        )}
      </form>
    </div>
  );
}
