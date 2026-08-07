import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { extractApiErrorMessage } from "../lib/dashboardHelpers.js";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  labelClass,
  panelClass,
} from "../ui/theme.js";
import { SparklesIcon } from "../ui/icons";

// Paste a job URL (or the posting text) and get the fields filled in. The
// extraction is handed to the parent rather than saved directly — the user
// reviews it in the normal add-job form first, so a bad guess never silently
// becomes a row.
export function JobImport({ onExtracted }) {
  const [mode, setMode] = useState("url");
  const [url, setUrl] = useState("");
  const [rawText, setRawText] = useState("");

  const importJob = useMutation({
    mutationFn: async () =>
      (
        await api.post(
          "/ai/import-job",
          mode === "url" ? { url } : { rawText },
        )
      ).data.data.output,
    onSuccess: (output) => {
      onExtracted(output);
      setUrl("");
      setRawText("");
    },
  });

  return (
    <form
      className={panelClass}
      onSubmit={(e) => {
        e.preventDefault();
        importJob.mutate();
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <SparklesIcon className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-zinc-100">Import a posting</h3>
      </div>

      <div className="mb-3 flex gap-2">
        <button
          type="button"
          data-testid="import-mode-url"
          className={mode === "url" ? buttonPrimaryClass : buttonSecondaryClass}
          onClick={() => setMode("url")}
        >
          From URL
        </button>
        <button
          type="button"
          data-testid="import-mode-text"
          className={mode === "text" ? buttonPrimaryClass : buttonSecondaryClass}
          onClick={() => setMode("text")}
        >
          Paste text
        </button>
      </div>

      {mode === "url" ? (
        <label className="block">
          <span className={labelClass}>Job posting URL</span>
          <input
            data-testid="import-url"
            className={inputClass}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://company.com/careers/engineer"
            required
          />
          <span className="mt-1 block text-xs text-zinc-500">
            Some sites (LinkedIn, Indeed) block automated fetches — use “Paste
            text” for those.
          </span>
        </label>
      ) : (
        <label className="block">
          <span className={labelClass}>Job posting text</span>
          <textarea
            data-testid="import-text"
            className={`${inputClass} h-32`}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste the full job posting (at least 50 characters)"
            required
          />
        </label>
      )}

      <button
        data-testid="import-submit"
        className={`${buttonPrimaryClass} mt-3 w-full`}
        type="submit"
        disabled={importJob.isPending}
      >
        {importJob.isPending ? "Reading posting…" : "Extract details"}
      </button>

      {importJob.isError ? (
        <p className="mt-3 rounded-lg border border-rose-500/35 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
          {extractApiErrorMessage(
            importJob.error,
            "Could not import that posting. Try pasting the text instead.",
          )}
        </p>
      ) : null}

      {importJob.isSuccess ? (
        <p className="mt-3 rounded-lg border border-emerald-500/35 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
          Details extracted ({importJob.data.confidence}% confidence). Review
          them below before saving.
        </p>
      ) : null}
    </form>
  );
}
