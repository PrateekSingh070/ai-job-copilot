import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
} from "../ui/theme.js";
import {
  buildStructuredResumeFromText,
  extractApiErrorMessage,
  resumeJsonToPlainText,
  sanitizeHtmlForDownload,
} from "../lib/dashboardHelpers.js";
export function AiWorkspace() {
  const qc = useQueryClient();
  const [resumeText, setResumeText] = useState("");
  const [uploadedResumeName, setUploadedResumeName] = useState("");
  const [resumeUploadError, setResumeUploadError] = useState(null);
  const [resumeStructuredMessage, setResumeStructuredMessage] = useState(null);
  const latestUploadTokenRef = useRef(0);
  const exportNoticeTimeoutRef = useRef(null);
  const [exportNotice, setExportNotice] = useState(null);
  const [jobDescription, setJobDescription] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [interviewPrep, setInterviewPrep] = useState("");
  const [fitResult, setFitResult] = useState(null);
  const [atsResult, setAtsResult] = useState(null);
  const [mockSessionId, setMockSessionId] = useState(null);
  const [mockQuestions, setMockQuestions] = useState([]);
  const [mockQuestionIndex, setMockQuestionIndex] = useState(0);
  const [mockAnswer, setMockAnswer] = useState("");
  const [mockFeedback, setMockFeedback] = useState(null);
  const [mockSummary, setMockSummary] = useState(null);
  const [rateLimitMessage, setRateLimitMessage] = useState(null);
  const [compareLeftId, setCompareLeftId] = useState("");
  const [compareRightId, setCompareRightId] = useState("");
  const [autoTailorResults, setAutoTailorResults] = useState([]);
  const [autoTailorMessage, setAutoTailorMessage] = useState(null);
  const [structuredResumeJson, setStructuredResumeJson] = useState("{}");
  const [structuredJobDescription, setStructuredJobDescription] = useState("");
  const [structuredTailorResult, setStructuredTailorResult] = useState(null);
  const [resumeHtmlOutput, setResumeHtmlOutput] = useState("");

  useEffect(() => {
    const onRateLimited = (event) => {
      const detail = event.detail;
      setRateLimitMessage(
        detail?.message ?? "AI rate limit reached. Please wait and retry.",
      );
    };
    window.addEventListener("ai:rate-limited", onRateLimited);
    return () => window.removeEventListener("ai:rate-limited", onRateLimited);
  }, []);

  useEffect(() => {
    return () => {
      if (exportNoticeTimeoutRef.current) {
        globalThis.clearTimeout(exportNoticeTimeoutRef.current);
      }
    };
  }, []);

  const historyQuery = useQuery({
    queryKey: ["ai-history"],
    queryFn: async () => (await api.get("/ai/history")).data.data,
  });
  const providerStatusQuery = useQuery({
    queryKey: ["ai-provider-status"],
    queryFn: async () => (await api.get("/ai/provider-status")).data.data,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  const resumeMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post("/ai/resume-tailor", {
          resumeText,
          jobDescription,
          targetRole,
          tone: "impactful",
        })
      ).data.data.output,
    onSuccess: (output) => {
      setResumeText(output.rewrittenBullets.join("\n"));
      qc.invalidateQueries({ queryKey: ["ai-history"] });
    },
  });

  const coverMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post("/ai/cover-letter", {
          profileContext: resumeText,
          jobDescription,
          tone: "professional",
          length: "medium",
        })
      ).data.data.output,
    onSuccess: (output) => {
      setCoverLetter(output.content);
      qc.invalidateQueries({ queryKey: ["ai-history"] });
    },
  });

  const saveMasterMutation = useMutation({
    mutationFn: async () =>
      api.post("/resumes/master", {
        title: targetRole.trim() || "Master resume",
        content: resumeText,
      }),
  });

  const autoTailorForJobsMutation = useMutation({
    mutationFn: async () => {
      const baseResume = resumeText.trim();
      if (baseResume.length < 50)
        throw new Error("Upload or paste a resume first.");

      setAutoTailorMessage(null);
      setAutoTailorResults([]);

      try {
        await api.post("/resumes/master", {
          title: uploadedResumeName || targetRole.trim() || "Uploaded resume",
          content: baseResume,
        });
      } catch {
        setAutoTailorMessage(
          "Resume saved locally for this run; master-profile sync skipped in current setup.",
        );
      }

      const openings = (
        await api.get("/jobs/discover/openings", {
          params: { limit: 3 },
        })
      ).data.data.openings;

      const top = openings.slice(0, 3);
      if (top.length === 0) return [];
      const settled = await Promise.allSettled(
        top.map(async (opening) => {
          const builtDescription = `${opening.title}\n${opening.company}\n${opening.location ?? "Remote"}\n${opening.snippet}`;
          const safeDescription =
            builtDescription.trim().length >= 50
              ? builtDescription
              : `${builtDescription}\nResponsibilities and skills aligned with this role.`;
          const payload = {
            resumeText: baseResume,
            jobDescription: safeDescription,
            targetRole: opening.title,
            tone: "impactful",
          };
          const output = (await api.post("/ai/resume-tailor", payload)).data
            .data.output;
          return { opening, output };
        }),
      );
      return settled
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);
    },
    onSuccess: (results) => {
      setAutoTailorResults(results);
      if (results.length === 0) {
        setAutoTailorMessage(
          "No matched openings found right now. Try again later or broaden your resume keywords.",
        );
      } else {
        setAutoTailorMessage(
          `Generated ${results.length} tailored resume variant(s) for top matched jobs.`,
        );
      }
      qc.invalidateQueries({ queryKey: ["ai-history"] });
    },
    onError: () => {
      setAutoTailorMessage(null);
    },
  });

  const coverRagMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post("/ai/cover-letter-rag", {
          profileContext: resumeText,
          jobDescription,
          tone: "professional",
          length: "medium",
        })
      ).data.data.output,
    onSuccess: (output) => {
      setCoverLetter(output.content);
      qc.invalidateQueries({ queryKey: ["ai-history"] });
    },
  });

  const interviewMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post("/ai/interview-prep", {
          jobDescription,
          candidateBackground: resumeText,
        })
      ).data.data.output,
    onSuccess: (output) => {
      setInterviewPrep(JSON.stringify(output, null, 2));
      qc.invalidateQueries({ queryKey: ["ai-history"] });
    },
  });

  const structuredTailorMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post("/ai/resume-tailor-structured", {
          resumeJson: parseStructuredResumeInput(),
          jobDescription: structuredJobDescription,
        })
      ).data.data,
    onSuccess: (output) => {
      setStructuredTailorResult(output);
      setStructuredResumeJson(JSON.stringify(output, null, 2));
      qc.invalidateQueries({ queryKey: ["ai-history"] });
    },
  });

  const resumeHtmlMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post("/ai/resume-html", {
          resumeJson: parseStructuredResumeInput(),
        })
      ).data.data,
    onSuccess: (output) => {
      setResumeHtmlOutput(output.html);
      qc.invalidateQueries({ queryKey: ["ai-history"] });
    },
  });

  const fitScoreMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post("/jobs/fit-score", {
          resumeText,
          jobDescription,
        })
      ).data.data,
    onSuccess: (output) => setFitResult(output),
  });

  const atsCheckMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post("/jobs/ats-check", {
          resumeText,
          jobDescription,
        })
      ).data.data,
    onSuccess: (output) => setAtsResult(output),
  });

  const mockInterviewStartMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post("/ai/mock-interview/start", {
          jobDescription,
          candidateBackground: resumeText,
          targetRole: targetRole || undefined,
        })
      ).data.data,
    onSuccess: (output) => {
      setMockSessionId(output.sessionId);
      setMockQuestions(output.questions);
      setMockQuestionIndex(0);
      setMockAnswer("");
      setMockFeedback(null);
      setMockSummary(null);
      qc.invalidateQueries({ queryKey: ["ai-history"] });
    },
  });

  const mockInterviewAnswerMutation = useMutation({
    mutationFn: async () => {
      if (!mockSessionId) throw new Error("Start a mock interview first.");
      return (
        await api.post(`/ai/mock-interview/${mockSessionId}/answer`, {
          questionIndex: mockQuestionIndex,
          answer: mockAnswer,
        })
      ).data.data;
    },
    onSuccess: (output) => {
      setMockFeedback(output);
      setMockQuestionIndex(output.nextQuestionIndex ?? mockQuestionIndex);
      setMockAnswer("");
    },
  });

  const mockInterviewSummaryMutation = useMutation({
    mutationFn: async () => {
      if (!mockSessionId) throw new Error("Start a mock interview first.");
      return (await api.get(`/ai/mock-interview/${mockSessionId}/summary`)).data
        .data;
    },
    onSuccess: (output) => setMockSummary(output),
  });

  const exportPdf = useMutation({
    mutationFn: async (payload) => {
      const response = await api.post("/exports/pdf", payload, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "copilot-export.pdf";
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  function showExportNotice(type, message) {
    setExportNotice({ type, message });
    if (exportNoticeTimeoutRef.current) {
      globalThis.clearTimeout(exportNoticeTimeoutRef.current);
    }
    exportNoticeTimeoutRef.current = globalThis.setTimeout(() => {
      setExportNotice(null);
      exportNoticeTimeoutRef.current = null;
    }, 3200);
  }

  async function trackExportTimeline(eventType, message, payload) {
    try {
      await api.post("/exports/events", { eventType, message, payload });
    } catch {
      // Non-blocking telemetry; ignore logging failures.
    }
  }
  const htmlToPdfMutation = useMutation({
    mutationFn: async (html) => {
      const withBreaks = html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n");
      const tmp = document.createElement("div");
      tmp.innerHTML = withBreaks;
      const textContent = (tmp.textContent ?? "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      const response = await api.post(
        "/exports/pdf",
        {
          title: "Resume",
          content: textContent || "No resume HTML content available.",
        },
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(response.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "resume-from-html.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onSuccess: () => {
      showExportNotice("success", "Resume PDF exported from generated HTML.");
      void trackExportTimeline(
        "EXPORT_RESUME_HTML_PDF",
        "Exported generated resume HTML as PDF.",
      );
    },
    onError: () => {
      showExportNotice("error", "Resume PDF export failed. Please retry.");
    },
  });

  function downloadResumeHtml() {
    try {
      const safeHtml = sanitizeHtmlForDownload(resumeHtmlOutput);
      const blob = new Blob([safeHtml], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "resume.html";
      document.body.appendChild(a);
      a.click();
      a.remove();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showExportNotice("success", "Resume HTML downloaded.");
      void trackExportTimeline(
        "EXPORT_RESUME_HTML_DOWNLOAD",
        "Downloaded generated resume HTML.",
      );
    } catch {
      showExportNotice("error", "Could not download resume HTML.");
    }
  }

  const generationById = new Map(
    (historyQuery.data ?? []).map((item) => [item.id, item]),
  );
  const compareLeft = compareLeftId ? generationById.get(compareLeftId) : null;
  const compareRight = compareRightId
    ? generationById.get(compareRightId)
    : null;
  const stringifyOutput = (value) =>
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const parseStructuredResumeInput = () => {
    const parsed = JSON.parse(structuredResumeJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Structured resume must be a JSON object.");
    }
    return parsed;
  };
  const MAX_RESUME_UPLOAD_BYTES = 8 * 1024 * 1024;
  const MAX_RESUME_PDF_PAGES = 20;
  const extractPdfText = async (file) => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
      import.meta.url,
    ).toString();
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    if (doc.numPages > MAX_RESUME_PDF_PAGES) {
      throw new Error(
        `PDF has ${doc.numPages} pages. Please upload a resume with up to ${MAX_RESUME_PDF_PAGES} pages.`,
      );
    }
    const pages = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => (typeof item.str === "string" ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) pages.push(text);
    }
    return pages.join("\n");
  };
  const parseResumeFileText = async (file) => {
    const lower = file.name.toLowerCase();
    if (file.size > MAX_RESUME_UPLOAD_BYTES) {
      throw new Error(
        "Resume file is too large. Maximum supported size is 8MB.",
      );
    }
    const supported = [".txt", ".md", ".json", ".csv", ".pdf"];
    if (!supported.some((ext) => lower.endsWith(ext))) {
      throw new Error(
        "Supported resume upload types: .txt, .md, .json, .csv, .pdf",
      );
    }
    const isPdf = lower.endsWith(".pdf") || file.type === "application/pdf";
    const allowedTextMime =
      file.type === "" ||
      file.type.startsWith("text/") ||
      file.type === "application/json";
    if (!isPdf && !allowedTextMime) {
      throw new Error("Unsupported file type. Upload a text or PDF resume.");
    }
    const text = isPdf ? await extractPdfText(file) : await file.text();
    if (text.trim().length < 50) {
      throw new Error(
        "Resume file appears too short. Please upload a fuller resume.",
      );
    }
    return text;
  };
  const compareDiffCount =
    compareLeft && compareRight
      ? Math.abs(
          stringifyOutput(compareLeft.outputJson).split(/\r?\n/).length -
            stringifyOutput(compareRight.outputJson).split(/\r?\n/).length,
        )
      : 0;

  return (
    <section className="mt-4 grid gap-3 sm:mt-6 sm:gap-4 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 shadow-sm sm:space-y-3 sm:p-4">
        <div>
          <h3 className="font-semibold text-white">
            Resume Tailor + Cover Letter + Interview Prep
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Use the same context once, then generate assets for each stage of
            your application.
          </p>
        </div>
        {providerStatusQuery.data ? (
          <div
            className={`rounded border px-3 py-2 text-sm ${
              providerStatusQuery.data.status === "connected"
                ? "border-emerald-500/35 bg-emerald-950/35 text-emerald-200"
                : "border-amber-500/35 bg-amber-950/35 text-amber-200"
            }`}
          >
            <strong className="mr-1">
              {providerStatusQuery.data.provider === "openai"
                ? "OpenAI"
                : providerStatusQuery.data.provider === "anthropic"
                  ? "Anthropic"
                  : "Mock"}
              :
            </strong>
            {providerStatusQuery.data.message}
          </div>
        ) : null}
        <div className="rounded border border-zinc-800/80 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
          AI outputs are suggestions, not facts. Verify company details,
          requirements, and claims before sending.
        </div>
        {rateLimitMessage ? (
          <div className="rounded border border-amber-500/35 bg-amber-950/35 px-3 py-2 text-xs text-amber-200">
            {rateLimitMessage}
          </div>
        ) : null}
        <div className="rounded border border-zinc-800/80 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-300">
          <p className="font-semibold">
            Upload resume and auto-tailor for available jobs
          </p>
          <p className="mt-1">
            Upload your resume (.txt/.md/.json/.csv/.pdf), then generate
            tailored versions for top matched jobs from internet openings.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="file"
              accept=".txt,.md,.json,.csv,.pdf,application/pdf"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                latestUploadTokenRef.current += 1;
                const uploadToken = latestUploadTokenRef.current;
                try {
                  const text = await parseResumeFileText(file);
                  if (uploadToken !== latestUploadTokenRef.current) return;
                  const maybeJson = (() => {
                    try {
                      const parsed = JSON.parse(text);
                      return parsed &&
                        typeof parsed === "object" &&
                        !Array.isArray(parsed)
                        ? parsed
                        : null;
                    } catch {
                      return null;
                    }
                  })();
                  if (maybeJson) {
                    const plainText = resumeJsonToPlainText(maybeJson);
                    setResumeText(plainText.length >= 50 ? plainText : text);
                    setUploadedResumeName(file.name);
                    setResumeUploadError(null);
                    setStructuredResumeJson(JSON.stringify(maybeJson, null, 2));
                    setResumeStructuredMessage(
                      "Structured JSON was auto-filled directly from uploaded JSON resume.",
                    );
                  } else {
                    const autoJson = buildStructuredResumeFromText({
                      resumeText: text,
                      targetRole,
                      uploadedResumeName: file.name,
                    });
                    setResumeText(text);
                    setUploadedResumeName(file.name);
                    setResumeUploadError(null);
                    setStructuredResumeJson(JSON.stringify(autoJson, null, 2));
                    setResumeStructuredMessage(
                      "Structured JSON was auto-filled from your upload. Review and edit before generating ATS output.",
                    );
                  }
                } catch (error) {
                  if (uploadToken !== latestUploadTokenRef.current) return;
                  setResumeUploadError(
                    error instanceof Error
                      ? error.message
                      : "Could not parse resume file.",
                  );
                  setResumeStructuredMessage(null);
                } finally {
                  e.currentTarget.value = "";
                }
              }}
            />

            <button
              className={`${buttonPrimaryClass} w-full sm:w-auto`}
              type="button"
              onClick={() => autoTailorForJobsMutation.mutate()}
              disabled={
                autoTailorForJobsMutation.isPending ||
                resumeText.trim().length < 50
              }
            >
              {autoTailorForJobsMutation.isPending
                ? "Tailoring..."
                : "Tailor resume for matched jobs"}
            </button>
          </div>
          {uploadedResumeName ? (
            <p className="mt-1 text-[11px] text-zinc-500">
              Loaded: {uploadedResumeName}
            </p>
          ) : null}
          {resumeUploadError ? (
            <p className="mt-1 rounded border border-rose-500/35 bg-rose-950/40 px-2 py-1 text-[11px] text-rose-200">
              {resumeUploadError}
            </p>
          ) : null}
          {resumeStructuredMessage ? (
            <p className="mt-1 rounded border border-emerald-500/35 bg-emerald-950/35 px-2 py-1 text-[11px] text-emerald-200">
              {resumeStructuredMessage}
            </p>
          ) : null}
          {autoTailorForJobsMutation.isError ? (
            <p className="mt-1 rounded border border-rose-500/35 bg-rose-950/40 px-2 py-1 text-[11px] text-rose-200">
              {extractApiErrorMessage(
                autoTailorForJobsMutation.error,
                "Auto tailoring failed. Make sure your session is active and AI provider is configured.",
              )}
            </p>
          ) : null}
          {autoTailorMessage ? (
            <p className="mt-1 rounded border border-sky-500/35 bg-sky-950/35 px-2 py-1 text-[11px] text-sky-200">
              {autoTailorMessage}
            </p>
          ) : null}
        </div>
        <input
          placeholder="Target role"
          className={inputClass}
          value={targetRole}
          onChange={(e) => setTargetRole(e.target.value)}
        />

        <textarea
          className={inputClass + " h-28 sm:h-32"}
          placeholder="Paste resume text..."
          value={resumeText}
          onChange={(e) => setResumeText(e.target.value)}
        />

        <textarea
          className={inputClass + " h-28 sm:h-32"}
          placeholder="Paste job description..."
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            className={`${buttonPrimaryClass} w-full sm:w-auto`}
            onClick={() => resumeMutation.mutate()}
            disabled={resumeMutation.isPending}
          >
            {resumeMutation.isPending
              ? "Generating..."
              : "Generate Resume Bullets"}
          </button>
          <button
            className={`${buttonPrimaryClass} w-full sm:w-auto`}
            onClick={() => coverMutation.mutate()}
            disabled={coverMutation.isPending}
          >
            {coverMutation.isPending
              ? "Generating..."
              : "Generate Cover Letter"}
          </button>
          <button
            className={`${buttonSecondaryClass} w-full sm:w-auto`}
            type="button"
            onClick={() => saveMasterMutation.mutate()}
            disabled={
              saveMasterMutation.isPending || resumeText.trim().length < 50
            }
            title="Requires resume text (50+ chars) for pgvector embeddings"
          >
            {saveMasterMutation.isPending
              ? "Saving..."
              : "Save master resume (RAG)"}
          </button>
          <button
            className={`${buttonPrimaryClass} w-full sm:w-auto`}
            onClick={() => coverRagMutation.mutate()}
            disabled={
              coverRagMutation.isPending || jobDescription.trim().length < 50
            }
            title="Uses saved master chunks + OpenAI embeddings"
          >
            {coverRagMutation.isPending
              ? "Generating..."
              : "Cover letter (RAG)"}
          </button>
          <button
            className={`${buttonPrimaryClass} w-full sm:w-auto`}
            onClick={() => interviewMutation.mutate()}
            disabled={interviewMutation.isPending}
          >
            {interviewMutation.isPending
              ? "Generating..."
              : "Generate Interview Prep"}
          </button>
          <button
            className={`${buttonSecondaryClass} w-full sm:w-auto`}
            onClick={() => fitScoreMutation.mutate()}
            disabled={
              fitScoreMutation.isPending ||
              resumeText.length < 50 ||
              jobDescription.length < 50
            }
          >
            {fitScoreMutation.isPending ? "Scoring..." : "Fit Score"}
          </button>
          <button
            className={`${buttonSecondaryClass} w-full sm:w-auto`}
            onClick={() => atsCheckMutation.mutate()}
            disabled={atsCheckMutation.isPending || resumeText.length < 50}
          >
            {atsCheckMutation.isPending ? "Checking..." : "ATS Checker"}
          </button>
          <button
            className={`${buttonPrimaryClass} w-full sm:w-auto`}
            onClick={() => mockInterviewStartMutation.mutate()}
            disabled={
              mockInterviewStartMutation.isPending ||
              resumeText.length < 50 ||
              jobDescription.length < 50
            }
          >
            {mockInterviewStartMutation.isPending
              ? "Starting..."
              : "Start Mock Interview"}
          </button>
        </div>
        {fitResult ? (
          <div className="rounded-lg border border-sky-500/30 bg-sky-950/35 p-3 text-sm">
            <p className="font-semibold text-sky-100">
              Fit score: {fitResult.score}/100
            </p>
            <p className="text-xs text-sky-200">
              Confidence: {fitResult.confidence ?? "medium"} (keyword overlap
              heuristic)
            </p>
            <p className="mt-1 text-sky-200">{fitResult.explanation}</p>
            <p className="mt-2 text-xs font-semibold text-sky-200">
              Matched keywords
            </p>
            <p className="text-xs text-sky-200">
              {fitResult.matchedKeywords.join(", ") || "None"}
            </p>
            <p className="mt-2 text-xs font-semibold text-sky-200">
              Missing keywords
            </p>
            <p className="text-xs text-sky-200">
              {fitResult.missingKeywords.join(", ") || "None"}
            </p>
            <p className="mt-2 text-xs font-semibold text-sky-200">
              Skills gap detection
            </p>
            <p className="text-xs text-sky-200">
              {fitResult.skillGapDetection.join(", ") || "None"}
            </p>
            <p className="mt-2 text-xs font-semibold text-sky-200">
              Suggested bullet improvements
            </p>
            <ul className="mt-1 list-disc pl-4 text-xs text-sky-200">
              {fitResult.suggestedBulletImprovements.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {atsResult ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-950/35 p-3 text-sm">
            <p className="font-semibold text-amber-100">
              ATS score: {atsResult.score}/100
            </p>
            <ul className="mt-1 list-disc pl-4 text-amber-200">
              {atsResult.issues.map((issue) => (
                <li key={issue.message}>
                  [{issue.severity}] {issue.message}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs font-semibold text-amber-100">
              Suggestions
            </p>
            <ul className="mt-1 list-disc pl-4 text-xs text-amber-200">
              {atsResult.suggestions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {atsResult.checks?.keywordDensity?.length ? (
              <>
                <p className="mt-2 text-xs font-semibold text-amber-100">
                  Keyword density
                </p>
                <p className="text-xs text-amber-200">
                  {atsResult.checks.keywordDensity
                    .map((item) => `${item.keyword}: ${item.count}`)
                    .join(" | ")}
                </p>
              </>
            ) : null}
          </div>
        ) : null}
        {mockSessionId ? (
          <div className="rounded-lg border border-violet-500/30 bg-violet-950/35 p-3 text-sm">
            <p className="font-semibold text-violet-100">Mock interview mode</p>
            <p className="mt-1 text-violet-200">
              Question {Math.min(mockQuestionIndex + 1, mockQuestions.length)}{" "}
              of {mockQuestions.length}
            </p>
            <p className="mt-1 text-violet-200">
              {mockQuestions[mockQuestionIndex] ??
                "All questions answered. Fetch your summary."}
            </p>
            <textarea
              className={`${inputClass} mt-2 h-24`}
              placeholder="Type your interview answer..."
              value={mockAnswer}
              onChange={(e) => setMockAnswer(e.target.value)}
            />

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className={buttonSecondaryClass}
                type="button"
                onClick={() => mockInterviewAnswerMutation.mutate()}
                disabled={
                  mockInterviewAnswerMutation.isPending ||
                  mockAnswer.trim().length < 5
                }
              >
                {mockInterviewAnswerMutation.isPending
                  ? "Scoring..."
                  : "Submit answer"}
              </button>
              <button
                className={buttonSecondaryClass}
                type="button"
                onClick={() => mockInterviewSummaryMutation.mutate()}
                disabled={mockInterviewSummaryMutation.isPending}
              >
                {mockInterviewSummaryMutation.isPending
                  ? "Loading..."
                  : "Get summary"}
              </button>
            </div>
            {mockFeedback ? (
              <p className="mt-2 text-xs text-violet-200">
                Latest score: {mockFeedback.score}/100 - {mockFeedback.feedback}
              </p>
            ) : null}
            {mockSummary ? (
              <div className="mt-2 rounded border border-violet-500/25 bg-violet-950/40 p-2 text-xs text-violet-200">
                <p className="font-semibold">
                  Overall: {mockSummary.overallScore}/100
                </p>
                <p>
                  Answered {mockSummary.answeredQuestions} /{" "}
                  {mockSummary.totalQuestions}
                </p>
                <ul className="mt-1 list-disc pl-4">
                  {mockSummary.improvements.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        {autoTailorResults.length > 0 ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/35 p-3 text-sm">
            <p className="font-semibold text-emerald-100">
              Tailored resume variants for matched jobs
            </p>
            <ul className="mt-2 space-y-2">
              {autoTailorResults.map((item) => (
                <li
                  key={item.opening.url}
                  className="rounded border border-emerald-500/25 bg-emerald-950/35 p-2"
                >
                  <p className="font-medium text-emerald-100">
                    {item.opening.title} - {item.opening.company}
                  </p>
                  <p className="text-xs text-emerald-200">
                    Match {item.opening.matchScore}% Â·{" "}
                    {item.opening.location || "Remote"}
                  </p>
                  <p className="mt-1 text-xs text-emerald-200">
                    {item.output.explanation}
                  </p>
                  <ul className="mt-1 list-disc pl-4 text-xs text-emerald-200">
                    {item.output.rewrittenBullets.slice(0, 4).map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                  <div className="mt-2 flex gap-2">
                    <button
                      className="rounded border border-emerald-500/35 px-2 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-900/50"
                      type="button"
                      onClick={() => {
                        setTargetRole(item.opening.title);
                        setJobDescription(
                          `${item.opening.title}\n${item.opening.company}\n${item.opening.location ?? "Remote"}\n${item.opening.snippet}`,
                        );
                        setResumeText(item.output.rewrittenBullets.join("\n"));
                      }}
                    >
                      Use this version
                    </button>
                    <a
                      href={item.opening.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border border-emerald-500/35 px-2 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-900/50"
                    >
                      Open job
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <textarea
          className={inputClass + " h-36"}
          placeholder="Editable cover letter..."
          value={coverLetter}
          onChange={(e) => setCoverLetter(e.target.value)}
        />

        <textarea
          className={inputClass + " h-36"}
          placeholder="Editable interview prep JSON..."
          value={interviewPrep}
          onChange={(e) => setInterviewPrep(e.target.value)}
        />

        <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
          <h4 className="font-semibold text-zinc-100">
            ATS structured resume optimizer
          </h4>
          <p className="mt-1 text-xs text-zinc-500">
            Paste structured resume JSON + job description to generate an
            ATS-tailored JSON, then convert it to clean HTML.
          </p>
          <textarea
            className={`${inputClass} mt-2 h-36 font-mono text-xs`}
            placeholder='Structured resume JSON, e.g. {"skills":["React"],"experience":[...]}'
            value={structuredResumeJson}
            onChange={(e) => setStructuredResumeJson(e.target.value)}
          />

          <textarea
            className={`${inputClass} mt-2 h-24`}
            placeholder="Target job description text..."
            value={structuredJobDescription}
            onChange={(e) => setStructuredJobDescription(e.target.value)}
          />

          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              className={`${buttonPrimaryClass} w-full sm:w-auto`}
              onClick={() => structuredTailorMutation.mutate()}
              disabled={
                structuredTailorMutation.isPending ||
                structuredJobDescription.trim().length < 50
              }
            >
              {structuredTailorMutation.isPending
                ? "Optimizing..."
                : "Generate ATS JSON"}
            </button>
            <button
              className={`${buttonSecondaryClass} w-full sm:w-auto`}
              onClick={() => resumeHtmlMutation.mutate()}
              disabled={resumeHtmlMutation.isPending}
            >
              {resumeHtmlMutation.isPending
                ? "Formatting..."
                : "Generate Resume HTML"}
            </button>
          </div>
          {structuredTailorMutation.isError ? (
            <p className="mt-2 rounded border border-rose-500/35 bg-rose-950/40 px-2 py-1 text-xs text-rose-200">
              {extractApiErrorMessage(
                structuredTailorMutation.error,
                "Could not optimize structured resume JSON. Check JSON validity and retry.",
              )}
            </p>
          ) : null}
          {resumeHtmlMutation.isError ? (
            <p className="mt-2 rounded border border-rose-500/35 bg-rose-950/40 px-2 py-1 text-xs text-rose-200">
              {extractApiErrorMessage(
                resumeHtmlMutation.error,
                "Could not generate HTML.",
              )}
            </p>
          ) : null}
          {structuredTailorResult ? (
            <textarea
              className={`${inputClass} mt-2 h-36 font-mono text-xs`}
              readOnly
              value={JSON.stringify(structuredTailorResult, null, 2)}
            />
          ) : null}
          {resumeHtmlOutput ? (
            <>
              <textarea
                className={`${inputClass} mt-2 h-36 font-mono text-xs`}
                readOnly
                value={resumeHtmlOutput}
              />

              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <button
                  className={`${buttonSecondaryClass} w-full sm:w-auto`}
                  type="button"
                  onClick={downloadResumeHtml}
                  disabled={!resumeHtmlOutput.trim()}
                >
                  Download HTML
                </button>
                <button
                  className={`${buttonSecondaryClass} w-full sm:w-auto`}
                  type="button"
                  onClick={() => htmlToPdfMutation.mutate(resumeHtmlOutput)}
                  disabled={
                    htmlToPdfMutation.isPending || !resumeHtmlOutput.trim()
                  }
                >
                  {htmlToPdfMutation.isPending
                    ? "Exporting..."
                    : "Export Resume HTML to PDF"}
                </button>
              </div>
              {htmlToPdfMutation.isError ? (
                <p className="mt-2 rounded border border-rose-500/35 bg-rose-950/40 px-2 py-1 text-xs text-rose-200">
                  {extractApiErrorMessage(
                    htmlToPdfMutation.error,
                    "Could not export resume HTML to PDF.",
                  )}
                </p>
              ) : null}
              {exportNotice ? (
                <p
                  className={`mt-2 rounded px-2 py-1 text-xs ${
                    exportNotice.type === "success"
                      ? "border border-emerald-500/35 bg-emerald-950/35 text-emerald-200"
                      : "border border-rose-500/35 bg-rose-950/40 text-rose-200"
                  }`}
                >
                  {exportNotice.message}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            className={`${buttonSecondaryClass} w-full sm:w-auto`}
            onClick={() =>
              exportPdf.mutate({ title: "Cover Letter", content: coverLetter })
            }
            disabled={exportPdf.isPending || !coverLetter.trim()}
          >
            Export Cover Letter PDF
          </button>
          <button
            className={`${buttonSecondaryClass} w-full sm:w-auto`}
            onClick={() =>
              exportPdf.mutate({
                title: "Interview Prep",
                content: interviewPrep,
              })
            }
            disabled={exportPdf.isPending || !interviewPrep.trim()}
          >
            Export Interview Prep PDF
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 shadow-sm sm:p-4">
        <h3 className="font-semibold text-white">Generation History</h3>
        {historyQuery.isLoading ? (
          <p className="mt-2 rounded border border-zinc-800/80 bg-zinc-900/40 px-2 py-1 text-xs text-zinc-400">
            Loading generation history...
          </p>
        ) : null}
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <select
            className={inputClass}
            value={compareLeftId}
            onChange={(e) => setCompareLeftId(e.target.value)}
          >
            <option value="">Compare left version</option>
            {(historyQuery.data ?? []).map((item) => (
              <option key={`left-${item.id}`} value={item.id}>
                {item.type} v{item.version}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            value={compareRightId}
            onChange={(e) => setCompareRightId(e.target.value)}
          >
            <option value="">Compare right version</option>
            {(historyQuery.data ?? []).map((item) => (
              <option key={`right-${item.id}`} value={item.id}>
                {item.type} v{item.version}
              </option>
            ))}
          </select>
        </div>
        {compareLeft && compareRight ? (
          <div className="mt-2 rounded border border-zinc-800/80 bg-zinc-900/40 p-2">
            <p className="text-xs text-zinc-400">
              Approximate line delta: {compareDiffCount}
            </p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <textarea
                className={`${inputClass} h-40 font-mono text-xs`}
                readOnly
                value={stringifyOutput(compareLeft.outputJson)}
              />

              <textarea
                className={`${inputClass} h-40 font-mono text-xs`}
                readOnly
                value={stringifyOutput(compareRight.outputJson)}
              />
            </div>
          </div>
        ) : null}
        <ul className="mt-3 space-y-2">
          {!historyQuery.isLoading && (historyQuery.data ?? []).length === 0 ? (
            <li className="rounded-lg border border-dashed border-zinc-700/70 p-3 text-sm text-zinc-500">
              No saved generations yet. Run any AI action to build your history.
            </li>
          ) : null}
          {historyQuery.data?.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {item.type} v{item.version}
                </span>
                <button
                  className="rounded px-2 py-1 text-brand-700 transition hover:bg-brand-50 hover:text-brand-800"
                  onClick={async () => {
                    await api.post(`/ai/history/${item.id}/restore`);
                    qc.invalidateQueries({ queryKey: ["ai-history"] });
                  }}
                >
                  Restore
                </button>
              </div>
              <p className="text-xs text-zinc-500">
                {new Date(item.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
