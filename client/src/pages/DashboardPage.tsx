import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../providers/AuthProvider";
import type {
  ApiSuccess,
  CompanyInsight,
  DiscoverOpeningsResponse,
  DiscoveredOpening,
  JobApplication,
  JobStatus,
} from "../types";

const statuses: JobStatus[] = ["APPLIED", "INTERVIEW", "OFFER", "REJECTED"];
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-200";
const buttonPrimaryClass =
  "rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60";
const buttonSecondaryClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

const statusTone: Record<JobStatus, string> = {
  APPLIED: "bg-sky-100 text-sky-700",
  INTERVIEW: "bg-violet-100 text-violet-700",
  OFFER: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-rose-100 text-rose-700",
};

function extractApiErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object") return fallback;
  const maybeResponse = (
    error as { response?: { data?: { error?: { message?: string } } } }
  ).response;
  const message = maybeResponse?.data?.error?.message;
  return typeof message === "string" && message.trim().length > 0
    ? message
    : fallback;
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function suggestedActionForStatus(status: JobStatus): string {
  if (status === "APPLIED") return "Schedule follow-up";
  if (status === "INTERVIEW") return "Draft thank-you email";
  if (status === "OFFER") return "Export decision packet";
  return "Review and close notes";
}

const RESUME_SKILL_DICTIONARY = [
  "React",
  "TypeScript",
  "JavaScript",
  "Node.js",
  "Express",
  "Next.js",
  "Tailwind",
  "HTML",
  "CSS",
  "Python",
  "Java",
  "Go",
  "PostgreSQL",
  "MongoDB",
  "Docker",
  "Kubernetes",
  "AWS",
  "GCP",
  "Azure",
  "Git",
  "Redux",
  "GraphQL",
  "REST APIs",
  "Jest",
  "Playwright",
];

function dedupeList(items: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function titleCaseWords(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function inferNameFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^/.]+$/, "");
  const cleaned = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? titleCaseWords(cleaned) : "Candidate Name";
}

function resumeJsonToPlainText(input: Record<string, unknown>): string {
  const chunks: string[] = [];
  const summary = typeof input.summary === "string" ? input.summary : "";
  if (summary) chunks.push(summary);
  if (Array.isArray(input.skills)) {
    const skills = input.skills.filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
    if (skills.length) chunks.push(`Skills: ${skills.join(", ")}`);
  }
  if (Array.isArray(input.experience)) {
    for (const item of input.experience) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const company = typeof row.company === "string" ? row.company : "Company";
      const role = typeof row.role === "string" ? row.role : "Role";
      chunks.push(`${role} at ${company}`);
      if (Array.isArray(row.points)) {
        const points = row.points.filter(
          (point): point is string => typeof point === "string",
        );
        chunks.push(...points.slice(0, 4));
      }
    }
  }
  return chunks.join("\n").trim();
}

function sanitizeHtmlForDownload(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll("script,iframe,object,embed")
    .forEach((node) => node.remove());
  doc
    .querySelectorAll("meta[http-equiv],link[rel='import']")
    .forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on")) node.removeAttribute(attribute.name);
      if (
        (name === "href" || name === "src") &&
        value.startsWith("javascript:")
      ) {
        node.removeAttribute(attribute.name);
      }
    });
  });
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

function buildStructuredResumeFromText(input: {
  resumeText: string;
  targetRole: string;
  uploadedResumeName: string;
}): Record<string, unknown> {
  const source = input.resumeText.trim();
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const compact = source.replace(/\s+/g, " ").trim();
  const firstLine = lines[0] ?? "";
  const hasLikelyName = /^[A-Za-z][A-Za-z\s.'-]{2,50}$/.test(firstLine);
  const name = hasLikelyName
    ? firstLine
    : inferNameFromFileName(input.uploadedResumeName);
  const headlineLine =
    lines.find((line) =>
      /\b(engineer|developer|designer|manager|analyst|intern|specialist|architect)\b/i.test(
        line,
      ),
    ) ||
    input.targetRole.trim() ||
    "Professional";
  const emailMatch =
    compact.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  const phoneMatch =
    compact
      .match(/(?:\+?\d[\d\s\-()]{8,}\d)/)?.[0]
      ?.replace(/\s+/g, " ")
      .trim() ?? "";
  const linkedinMatch =
    compact.match(/https?:\/\/(?:www\.)?linkedin\.com\/\S+/i)?.[0] ?? "";
  const githubMatch =
    compact.match(/https?:\/\/(?:www\.)?github\.com\/\S+/i)?.[0] ?? "";
  const skills = dedupeList(
    RESUME_SKILL_DICTIONARY.filter((skill) =>
      compact.toLowerCase().includes(skill.toLowerCase()),
    ),
  ).slice(0, 16);
  const sentencePoints = compact
    .split(/[.!?]\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 20)
    .slice(0, 4);

  const summary = compact.slice(0, 320);
  const experiencePoints = sentencePoints.length
    ? sentencePoints.map((line) => (line.endsWith(".") ? line : `${line}.`))
    : ["Add 2-4 measurable bullets from your uploaded resume."];

  return {
    name,
    headline: headlineLine,
    contact: {
      email: emailMatch || undefined,
      phone: phoneMatch || undefined,
      linkedin: linkedinMatch || undefined,
      github: githubMatch || undefined,
    },
    summary:
      summary.length > 0
        ? summary
        : "Professional profile extracted from uploaded resume. Update this summary before submitting applications.",
    skills: skills.length
      ? skills
      : ["Add top technical and domain skills from your resume"],
    experience: [
      {
        company: "Unknown Company",
        role: input.targetRole.trim() || "Professional Experience",
        duration: "Add duration",
        points: experiencePoints,
      },
    ],
    projects: [
      {
        name: "Add Project Name",
        points: [
          "Add project impact bullet",
          "Add tech stack and measurable outcome",
        ],
      },
    ],
    education: [
      {
        degree: "Add degree",
        school: "Add institution",
        year: "Add graduation year",
      },
    ],
  };
}

type Generation = {
  id: string;
  type: "RESUME_TAILOR" | "COVER_LETTER" | "INTERVIEW_PREP";
  outputJson: unknown;
  createdAt: string;
  version: number;
};

type ProviderStatus = {
  provider: "mock" | "openai" | "anthropic";
  configured: boolean;
  status: "connected" | "key_missing" | "mock_mode";
  message: string;
};

type ActivityItem = {
  kind: "job" | "ai";
  id: string;
  at: string;
  title: string;
  subtitle: string;
};

type ReminderItem = {
  jobId: string;
  type: string;
  dueAt: string;
  message: string;
  nextAction?: string;
  reason?: string;
};

type AuditItem = {
  id: string;
  at: string;
  eventType: string;
  message: string;
  source: "timeline" | "ai";
  job?: { id: string; company: string; role: string } | null;
};

type FitScoreResult = {
  score: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  suggestedBulletImprovements: string[];
  skillGapDetection: string[];
  explanation: string;
  confidence?: "low" | "medium" | "high";
};

type ResumeTailorResult = {
  rewrittenBullets: string[];
  extractedKeywords: string[];
  matchScore: number;
  explanation: string;
};

type ImportPreview = {
  url: string;
  company: string;
  role: string;
  location?: string | null;
  jobDescription: string;
  confidence: number;
  signals: string[];
  duplicate?: {
    id: string;
    company: string;
    role: string;
    location?: string | null;
  } | null;
};

type JobGroup = {
  key: string;
  company: string;
  role: string;
  location?: string | null;
  weekStart: string;
  count: number;
  jobIds: string[];
  statuses: string[];
};

type AtsCheckResult = {
  score: number;
  issues: Array<{ severity: "high" | "medium" | "low"; message: string }>;
  suggestions: string[];
  checks?: {
    keywordDensity?: Array<{ keyword: string; count: number }>;
  };
};

type FollowUpTemplate = {
  subject: string;
  body: string;
};

type MockInterviewStartResult = {
  sessionId: string;
  createdAt: string;
  targetRole: string;
  questions: string[];
};

type MockInterviewAnswerResult = {
  questionIndex: number;
  answer: string;
  score: number;
  feedback: string;
  nextQuestionIndex: number | null;
};

type MockInterviewSummary = {
  sessionId: string;
  targetRole: string;
  overallScore: number;
  answeredQuestions: number;
  totalQuestions: number;
  improvements: string[];
  answers: Array<{
    questionIndex: number;
    answer: string;
    score: number;
    feedback: string;
  }>;
};

type StructuredResumeTailorOutput = {
  summary: string;
  skills: string[];
  experience: Array<{
    company: string;
    role: string;
    updated_points: string[];
  }>;
  projects: Array<{ name: string; updated_points: string[] }>;
  keyword_match: {
    added_keywords: string[];
    missing_keywords: string[];
  };
};

type ResumeHtmlOutput = {
  html: string;
};

type ExportNotice = {
  type: "success" | "error";
  message: string;
};

export function DashboardPage() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<JobStatus | "">("");
  const [starredFilter, setStarredFilter] = useState<"" | "true" | "false">("");
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<"jobs" | "ai">("jobs");
  const [newJob, setNewJob] = useState({
    company: "",
    role: "",
    status: "APPLIED" as JobStatus,
    jobUrl: "",
  });
  const [importUrl, setImportUrl] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null,
  );
  const [importDraft, setImportDraft] = useState({
    company: "",
    role: "",
    location: "",
    jobDescription: "",
  });
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [selectedInsightJobId, setSelectedInsightJobId] = useState<string>("");
  const [selectedCompanyInsight, setSelectedCompanyInsight] =
    useState<CompanyInsight | null>(null);
  const [followUpTemplate, setFollowUpTemplate] =
    useState<FollowUpTemplate | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [presentationMode, setPresentationMode] = useState(true);
  const [showSecondaryPanels, setShowSecondaryPanels] = useState(false);
  const [internshipsOnly, setInternshipsOnly] = useState(false);
  const [remoteOnly, setRemoteOnly] = useState(false);

  const jobsQuery = useQuery({
    queryKey: ["jobs", companyFilter, statusFilter, starredFilter, page],
    queryFn: async () => {
      const res = await api.get<ApiSuccess<JobApplication[]>>("/jobs", {
        params: {
          company: companyFilter || undefined,
          status: statusFilter || undefined,
          starred: starredFilter || undefined,
          page,
        },
      });
      return res.data;
    },
  });

  const activityQuery = useQuery({
    queryKey: ["activity-recent"],
    queryFn: async () =>
      (
        await api.get<ApiSuccess<{ items: ActivityItem[] }>>(
          "/jobs/activity/recent",
        )
      ).data.data,
    enabled: activeTab === "jobs",
  });

  const metricsQuery = useQuery({
    queryKey: ["metrics"],
    queryFn: async () => (await api.get("/jobs/metrics/summary")).data.data,
  });

  const remindersQuery = useQuery({
    queryKey: ["job-reminders"],
    queryFn: async () =>
      (await api.get<ApiSuccess<ReminderItem[]>>("/jobs/reminders")).data.data,
    enabled: activeTab === "jobs",
  });

  const groupsQuery = useQuery({
    queryKey: ["job-groups"],
    queryFn: async () =>
      (await api.get<ApiSuccess<JobGroup[]>>("/jobs/groups")).data.data,
    enabled: activeTab === "jobs",
  });

  const auditQuery = useQuery({
    queryKey: ["job-audit"],
    queryFn: async () =>
      (await api.get<ApiSuccess<AuditItem[]>>("/jobs/timeline/audit")).data
        .data,
    enabled: activeTab === "jobs",
  });

  const openingsQuery = useQuery({
    queryKey: ["discover-openings", internshipsOnly, remoteOnly],
    queryFn: async () =>
      (
        await api.get<ApiSuccess<DiscoverOpeningsResponse>>(
          "/jobs/discover/openings",
          {
            params: {
              limit: 18,
              internshipsOnly: internshipsOnly ? "true" : undefined,
              remoteOnly: remoteOnly ? "true" : undefined,
            },
          },
        )
      ).data.data,
    enabled: activeTab === "jobs",
    staleTime: 1000 * 60 * 5,
  });

  const createJob = useMutation({
    mutationFn: async () => {
      const payload = {
        company: newJob.company,
        role: newJob.role,
        status: newJob.status,
        ...(newJob.jobUrl.trim() ? { jobUrl: newJob.jobUrl.trim() } : {}),
      };
      return api.post<ApiSuccess<JobApplication>>("/jobs", payload);
    },
    onSuccess: (res) => {
      setNewJob({ company: "", role: "", status: "APPLIED", jobUrl: "" });
      const warning = res.data.meta?.duplicateMessage;
      setDuplicateWarning(typeof warning === "string" ? warning : null);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["metrics"] });
      qc.invalidateQueries({ queryKey: ["activity-recent"] });
      qc.invalidateQueries({ queryKey: ["job-reminders"] });
      qc.invalidateQueries({ queryKey: ["job-audit"] });
      qc.invalidateQueries({ queryKey: ["job-groups"] });
    },
  });

  const saveDiscoveredOpening = useMutation({
    mutationFn: async (opening: DiscoveredOpening) =>
      api.post<ApiSuccess<JobApplication>>("/jobs", {
        company: opening.company,
        role: opening.title,
        status: "APPLIED",
        jobUrl: opening.url,
        location: opening.location ?? undefined,
        source: `internet-${opening.source}`,
        jobDescription: opening.snippet,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["metrics"] });
      qc.invalidateQueries({ queryKey: ["activity-recent"] });
      qc.invalidateQueries({ queryKey: ["job-reminders"] });
      qc.invalidateQueries({ queryKey: ["job-audit"] });
      qc.invalidateQueries({ queryKey: ["job-groups"] });
    },
  });

  const importPreviewMutation = useMutation({
    mutationFn: async () => {
      const url = importUrl.trim();
      return (
        await api.post<ApiSuccess<ImportPreview>>("/jobs/import-url/preview", {
          url,
        })
      ).data.data;
    },
    onSuccess: (preview) => {
      setImportPreview(preview);
      setImportDraft({
        company: preview.company,
        role: preview.role,
        location: preview.location ?? "",
        jobDescription: preview.jobDescription,
      });
    },
  });

  const importUrlMutation = useMutation({
    mutationFn: async () => {
      const url = importUrl.trim();
      return api.post<ApiSuccess<JobApplication>>("/jobs/import-url", {
        url,
        overrides: {
          company: importDraft.company,
          role: importDraft.role,
          location: importDraft.location || null,
          jobDescription: importDraft.jobDescription,
        },
      });
    },
    onSuccess: (res) => {
      setImportUrl("");
      setImportPreview(null);
      setImportDraft({
        company: "",
        role: "",
        location: "",
        jobDescription: "",
      });
      const warning = res.data.meta?.duplicateMessage;
      setDuplicateWarning(typeof warning === "string" ? warning : null);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["metrics"] });
      qc.invalidateQueries({ queryKey: ["activity-recent"] });
      qc.invalidateQueries({ queryKey: ["job-reminders"] });
      qc.invalidateQueries({ queryKey: ["job-audit"] });
      qc.invalidateQueries({ queryKey: ["job-groups"] });
      qc.invalidateQueries({ queryKey: ["job-groups"] });
    },
  });

  const companyInsightMutation = useMutation({
    mutationFn: async (jobId: string) =>
      (
        await api.post<ApiSuccess<CompanyInsight>>(
          `/jobs/${jobId}/company-research`,
        )
      ).data.data,
    onSuccess: (data) => setSelectedCompanyInsight(data),
  });

  const patchJob = useMutation({
    mutationFn: async (payload: {
      id: string;
      status?: JobStatus;
      starred?: boolean;
      followUpAt?: string | null;
    }) => {
      const { id, ...body } = payload;
      return api.patch(`/jobs/${id}`, body);
    },
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: ["jobs"] });
      const previous = qc.getQueriesData({ queryKey: ["jobs"] });
      qc.setQueriesData({ queryKey: ["jobs"] }, (old) => {
        if (!old || typeof old !== "object" || !("data" in old)) return old;
        const body = old as ApiSuccess<JobApplication[]>;
        if (!Array.isArray(body.data)) return old;
        const next = body.data.map((job) =>
          job.id === payload.id
            ? {
                ...job,
                ...(payload.status !== undefined
                  ? { status: payload.status }
                  : {}),
                ...(payload.starred !== undefined
                  ? { starred: payload.starred }
                  : {}),
                ...(payload.followUpAt !== undefined
                  ? { followUpAt: payload.followUpAt }
                  : {}),
                updatedAt: new Date().toISOString(),
              }
            : job,
        );
        return { ...body, data: next };
      });
      return { previous };
    },
    onError: (_err, _payload, context) => {
      context?.previous?.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["metrics"] });
      qc.invalidateQueries({ queryKey: ["activity-recent"] });
      qc.invalidateQueries({ queryKey: ["job-reminders"] });
      qc.invalidateQueries({ queryKey: ["job-audit"] });
      qc.invalidateQueries({ queryKey: ["job-groups"] });
    },
  });

  const deleteJob = useMutation({
    mutationFn: async (id: string) => api.delete(`/jobs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["metrics"] });
      qc.invalidateQueries({ queryKey: ["activity-recent"] });
      qc.invalidateQueries({ queryKey: ["job-reminders"] });
      qc.invalidateQueries({ queryKey: ["job-audit"] });
    },
  });

  const scheduleFiveDayFollowUp = useMutation({
    mutationFn: async (jobId: string) =>
      api.post(`/jobs/${jobId}/follow-up-5-days`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job-reminders"] });
      qc.invalidateQueries({ queryKey: ["job-audit"] });
      qc.invalidateQueries({ queryKey: ["job-groups"] });
    },
  });

  const followUpTemplateMutation = useMutation({
    mutationFn: async (jobId: string) =>
      (
        await api.get<ApiSuccess<FollowUpTemplate>>(
          `/jobs/${jobId}/follow-up-template`,
        )
      ).data.data,
    onSuccess: (template) => setFollowUpTemplate(template),
  });

  async function exportJobsCsv() {
    const res = await api.get("/jobs/export/csv", {
      responseType: "blob",
      params: {
        company: companyFilter || undefined,
        status: statusFilter || undefined,
        starred: starredFilter || undefined,
      },
    });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-applications-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportApplicationPacket(jobId: string, company: string) {
    const res = await api.post(
      `/exports/application-packet/${jobId}`,
      {},
      { responseType: "blob" },
    );
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `application-packet-${company.toLowerCase().replace(/\s+/g, "-")}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function addSampleData() {
    const samples = [
      {
        company: "Nimbus Labs",
        role: "Frontend Engineer",
        status: "APPLIED" as JobStatus,
        location: "Remote",
      },
      {
        company: "Nimbus Labs",
        role: "Frontend Engineer",
        status: "INTERVIEW" as JobStatus,
        location: "Remote",
      },
      {
        company: "Arbor AI",
        role: "Product Engineer",
        status: "APPLIED" as JobStatus,
        location: "Berlin",
      },
    ];
    await Promise.all(samples.map((item) => api.post("/jobs", item)));
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["metrics"] });
    qc.invalidateQueries({ queryKey: ["job-groups"] });
  }

  const jobs = jobsQuery.data?.data;
  const reminders = Array.isArray(remindersQuery.data)
    ? remindersQuery.data
    : [];
  const auditItems = Array.isArray(auditQuery.data) ? auditQuery.data : [];
  const groupedJobs = Array.isArray(groupsQuery.data) ? groupsQuery.data : [];
  const discoveredOpenings = openingsQuery.data?.openings ?? [];
  const canGoNext = (jobs?.length ?? 0) >= 10;
  const jobsByStatus = useMemo(
    () =>
      statuses.reduce<Record<JobStatus, JobApplication[]>>(
        (acc, status) => {
          acc[status] = (jobs ?? []).filter((job) => job.status === status);
          return acc;
        },
        {} as Record<JobStatus, JobApplication[]>,
      ),
    [jobs],
  );

  function moveJob(jobId: string, targetStatus: JobStatus) {
    const current = (jobs ?? []).find((job) => job.id === jobId);
    if (!current || current.status === targetStatus) return;
    patchJob.mutate({ id: jobId, status: targetStatus });
  }

  useEffect(() => {
    const dismissed = localStorage.getItem("copilot_onboarding_dismissed");
    setOnboardingDismissed(dismissed === "true");
  }, []);

  useEffect(() => {
    setPage(1);
  }, [companyFilter, statusFilter, starredFilter]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 via-slate-50 to-white">
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-4">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">
              AI Job Application Copilot
            </h1>
            <p className="mt-0.5 text-xs text-slate-600 sm:text-sm">
              Welcome, {user?.name} - track your pipeline and generate better
              applications faster.
            </p>
          </div>
          <button
            data-testid="logout-button"
            className={`${buttonSecondaryClass} shrink-0 self-start sm:self-auto`}
            onClick={() => logout()}
          >
            Logout
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
        <div className="mb-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Pipeline Snapshot
          </h2>
          <p className="text-xs text-slate-500">
            Key conversion and resume-performance signals at a glance.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            label="Total Applications"
            value={metricsQuery.data?.totalApplications ?? 0}
          />
          <MetricCard
            label="Interview Rate"
            value={`${metricsQuery.data?.interviewRate ?? 0}%`}
          />
          <MetricCard
            label="Offer Rate"
            value={`${metricsQuery.data?.offerRate ?? 0}%`}
          />
          <MetricCard
            label="App -> Interview"
            value={`${metricsQuery.data?.conversion?.applicationToInterviewRate ?? 0}%`}
          />
          <MetricCard
            label="Interview -> Offer"
            value={`${metricsQuery.data?.conversion?.interviewToOfferRate ?? 0}%`}
          />
          <MetricCard
            label="Top Resume Match"
            value={
              metricsQuery.data?.resumeVersionPerformance?.[0]?.matchScore !==
              undefined
                ? `${metricsQuery.data.resumeVersionPerformance[0].matchScore}%`
                : "N/A"
            }
          />
        </div>

        <div className="mt-4 inline-flex w-full rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:mt-6 sm:w-auto">
          <button
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition sm:flex-none sm:px-4 ${
              activeTab === "jobs"
                ? "bg-brand-600 text-white shadow-sm"
                : "text-slate-700 hover:bg-slate-100"
            }`}
            onClick={() => setActiveTab("jobs")}
          >
            Job Tracker
          </button>
          <button
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition sm:flex-none sm:px-4 ${
              activeTab === "ai"
                ? "bg-brand-600 text-white shadow-sm"
                : "text-slate-700 hover:bg-slate-100"
            }`}
            onClick={() => setActiveTab("ai")}
          >
            AI Workspace
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={
              presentationMode ? buttonPrimaryClass : buttonSecondaryClass
            }
            onClick={() => {
              setPresentationMode((prev) => !prev);
              setShowSecondaryPanels(false);
            }}
          >
            {presentationMode
              ? "Presentation mode: ON"
              : "Presentation mode: OFF"}
          </button>
          {presentationMode ? (
            <button
              type="button"
              className={buttonSecondaryClass}
              onClick={() => setShowSecondaryPanels((prev) => !prev)}
            >
              {showSecondaryPanels
                ? "Hide secondary panels"
                : "Show secondary panels"}
            </button>
          ) : null}
        </div>

        {!onboardingDismissed ? (
          <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900 sm:mt-6">
            <p className="font-semibold">Guided demo (under 60 seconds)</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-brand-300 bg-white/60 px-2 py-1">
                1. Import a role
              </span>
              <span className="rounded-full border border-brand-300 bg-white/60 px-2 py-1">
                2. Run AI fit + draft
              </span>
              <span className="rounded-full border border-brand-300 bg-white/60 px-2 py-1">
                3. Export packet
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className={buttonPrimaryClass}
                type="button"
                onClick={() => void addSampleData()}
              >
                Load sample data
              </button>
              <button
                className={buttonSecondaryClass}
                type="button"
                onClick={() => setActiveTab("jobs")}
              >
                Start guided flow
              </button>
              <button
                className={buttonSecondaryClass}
                type="button"
                onClick={() => {
                  localStorage.setItem("copilot_onboarding_dismissed", "true");
                  setOnboardingDismissed(true);
                }}
              >
                Dismiss guide
              </button>
            </div>
          </div>
        ) : null}

        {activeTab === "jobs" ? (
          <section className="mt-4 space-y-4 sm:mt-6 sm:space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                Capture Applications
              </h3>
              <p className="text-xs text-slate-500">
                Add manually or parse a job URL, then confirm import quality.
              </p>
            </div>
            <form
              className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:gap-3 sm:p-4 md:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                createJob.mutate();
              }}
            >
              <input
                data-testid="add-job-company"
                placeholder="Company"
                className={inputClass}
                value={newJob.company}
                onChange={(e) =>
                  setNewJob((p) => ({ ...p, company: e.target.value }))
                }
                required
              />
              <input
                data-testid="add-job-role"
                placeholder="Role"
                className={inputClass}
                value={newJob.role}
                onChange={(e) =>
                  setNewJob((p) => ({ ...p, role: e.target.value }))
                }
                required
              />
              <select
                className={inputClass}
                value={newJob.status}
                onChange={(e) =>
                  setNewJob((p) => ({
                    ...p,
                    status: e.target.value as JobStatus,
                  }))
                }
              >
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <input
                placeholder="Job URL (optional)"
                className={inputClass}
                value={newJob.jobUrl}
                onChange={(e) =>
                  setNewJob((p) => ({ ...p, jobUrl: e.target.value }))
                }
              />
              <button
                data-testid="add-job-submit"
                className={buttonPrimaryClass}
                type="submit"
                disabled={createJob.isPending}
              >
                {createJob.isPending ? "Adding..." : "Add Job"}
              </button>
              <p className="text-xs text-slate-500 md:col-span-4">
                Tip: Add each application as soon as you apply so your funnel
                metrics stay accurate.
              </p>
              {createJob.isError ? (
                <p className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-700 md:col-span-4">
                  {extractApiErrorMessage(
                    createJob.error,
                    "Could not add job. Please try again.",
                  )}
                </p>
              ) : null}
              {duplicateWarning ? (
                <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700 md:col-span-4">
                  Duplicate warning: {duplicateWarning}
                </p>
              ) : null}
            </form>

            <form
              className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:gap-3 sm:p-4 md:grid-cols-[1fr_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                importPreviewMutation.mutate();
              }}
            >
              <input
                placeholder="Import job post by URL (LinkedIn, Indeed, company careers page)"
                className={inputClass}
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                required
              />
              <button
                type="submit"
                className={buttonPrimaryClass}
                disabled={importPreviewMutation.isPending}
              >
                {importPreviewMutation.isPending ? "Parsing..." : "Parse URL"}
              </button>
            </form>
            {importPreviewMutation.isError ? (
              <p className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {extractApiErrorMessage(
                  importPreviewMutation.error,
                  "Could not parse this URL.",
                )}
              </p>
            ) : null}

            {importPreview ? (
              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-800">
                    Import review
                  </p>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    Confidence {Math.round(importPreview.confidence * 100)}%
                  </span>
                  <span className="text-xs text-slate-500">
                    Signals: {importPreview.signals.join(", ") || "n/a"}
                  </span>
                </div>
                {importPreview.duplicate ? (
                  <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                    Similar job found: {importPreview.duplicate.company} -{" "}
                    {importPreview.duplicate.role}
                  </p>
                ) : null}
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <input
                    className={inputClass}
                    value={importDraft.company}
                    onChange={(e) =>
                      setImportDraft((prev) => ({
                        ...prev,
                        company: e.target.value,
                      }))
                    }
                    placeholder="Company"
                  />
                  <input
                    className={inputClass}
                    value={importDraft.role}
                    onChange={(e) =>
                      setImportDraft((prev) => ({
                        ...prev,
                        role: e.target.value,
                      }))
                    }
                    placeholder="Role"
                  />
                  <input
                    className={inputClass}
                    value={importDraft.location}
                    onChange={(e) =>
                      setImportDraft((prev) => ({
                        ...prev,
                        location: e.target.value,
                      }))
                    }
                    placeholder="Location"
                  />
                  <button
                    type="button"
                    className={buttonPrimaryClass}
                    onClick={() => importUrlMutation.mutate()}
                    disabled={importUrlMutation.isPending}
                  >
                    {importUrlMutation.isPending
                      ? "Saving..."
                      : "Save imported job"}
                  </button>
                </div>
                <textarea
                  className={`${inputClass} mt-2 h-24`}
                  value={importDraft.jobDescription}
                  onChange={(e) =>
                    setImportDraft((prev) => ({
                      ...prev,
                      jobDescription: e.target.value,
                    }))
                  }
                  placeholder="Job description"
                />
                {importUrlMutation.isError ? (
                  <p className="mt-2 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-700">
                    {extractApiErrorMessage(
                      importUrlMutation.error,
                      "Could not save imported job.",
                    )}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">
                    Internet jobs + internships for your profile
                  </h3>
                  <p className="text-xs text-slate-500">
                    Ranked using your resume and job history, refreshed from
                    public openings across the internet.
                  </p>
                </div>
                <button
                  type="button"
                  className={buttonSecondaryClass}
                  onClick={() => openingsQuery.refetch()}
                  disabled={openingsQuery.isFetching}
                >
                  {openingsQuery.isFetching
                    ? "Refreshing..."
                    : "Refresh openings"}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-slate-600">
                  <input
                    type="checkbox"
                    checked={internshipsOnly}
                    onChange={(e) => setInternshipsOnly(e.target.checked)}
                  />
                  Internships only
                </label>
                <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-slate-600">
                  <input
                    type="checkbox"
                    checked={remoteOnly}
                    onChange={(e) => setRemoteOnly(e.target.checked)}
                  />
                  Remote only
                </label>
                {openingsQuery.data?.profileKeywords?.length ? (
                  <span className="text-slate-500">
                    Profile signals:{" "}
                    {openingsQuery.data.profileKeywords.slice(0, 6).join(", ")}
                  </span>
                ) : null}
              </div>
              {openingsQuery.isLoading ? (
                <p className="mt-2 text-sm text-slate-500">
                  Loading internet openings...
                </p>
              ) : null}
              {openingsQuery.isError ? (
                <p className="mt-2 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-700">
                  Could not load openings right now. Please retry.
                </p>
              ) : null}
              {(openingsQuery.data?.warnings ?? []).map((warning) => (
                <p
                  key={warning}
                  className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700"
                >
                  {warning}
                </p>
              ))}
              {!openingsQuery.isLoading &&
              !openingsQuery.isError &&
              discoveredOpenings.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">
                  No openings matched current filters yet.
                </p>
              ) : null}
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {discoveredOpenings.slice(0, 10).map((opening) => (
                  <article
                    key={`${opening.source}-${opening.url}`}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                        Match {opening.matchScore}%
                      </span>
                      {opening.isInternship ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          Internship
                        </span>
                      ) : null}
                      {opening.isRemote ? (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                          Remote
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-800">
                      {opening.title}
                    </p>
                    <p className="text-xs text-slate-600">
                      {opening.company} · {opening.location || "Location TBD"} ·{" "}
                      {opening.source}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {opening.snippet}
                    </p>
                    {opening.matchedKeywords.length ? (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Matched:{" "}
                        {opening.matchedKeywords.slice(0, 5).join(", ")}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-1">
                      <a
                        href={opening.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                      >
                        Open listing
                      </a>
                      <button
                        type="button"
                        className="rounded bg-brand-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-brand-700"
                        onClick={() => saveDiscoveredOpening.mutate(opening)}
                        disabled={saveDiscoveredOpening.isPending}
                      >
                        {saveDiscoveredOpening.isPending
                          ? "Saving..."
                          : "Save to tracker"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="sticky top-0 z-20 -mx-3 border-b border-slate-200/90 bg-slate-50/95 px-3 py-2 shadow-sm backdrop-blur-sm sm:static sm:mx-0 sm:rounded-xl sm:border sm:bg-white sm:p-3 sm:shadow-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Filter + Export
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  placeholder="Search applications"
                  className={`${inputClass} min-w-0 flex-1 sm:w-64 sm:flex-none`}
                  value={companyFilter}
                  onChange={(e) => setCompanyFilter(e.target.value)}
                />
                <select
                  className={`${inputClass} sm:w-44`}
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as JobStatus | "")
                  }
                >
                  <option value="">All statuses</option>
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <select
                  className={`${inputClass} sm:w-40`}
                  value={starredFilter}
                  onChange={(e) =>
                    setStarredFilter(e.target.value as "" | "true" | "false")
                  }
                >
                  <option value="">All jobs</option>
                  <option value="true">Starred</option>
                  <option value="false">Not starred</option>
                </select>
                <button
                  type="button"
                  className={buttonSecondaryClass}
                  onClick={() => void exportJobsCsv()}
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  className={buttonSecondaryClass}
                  onClick={() => {
                    setCompanyFilter("");
                    setStatusFilter("");
                    setStarredFilter("");
                    setPage(1);
                  }}
                >
                  Clear filters
                </button>
                <span className="w-full text-xs font-medium text-slate-500 sm:ml-auto sm:w-auto">
                  Showing {(jobs ?? []).length} jobs on this page
                </span>
              </div>
            </div>

            {!presentationMode || showSecondaryPanels ? (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-left md:hidden"
                    onClick={() => setActivityOpen((o) => !o)}
                    aria-expanded={activityOpen}
                  >
                    <span className="font-semibold text-slate-800">
                      Recent activity
                    </span>
                    <span className="text-slate-500" aria-hidden>
                      {activityOpen ? "▲" : "▼"}
                    </span>
                  </button>
                  <h3 className="hidden font-semibold text-slate-800 md:block">
                    Recent activity
                  </h3>
                  <div
                    className={`mt-2 ${activityOpen || activityQuery.isLoading ? "block" : "hidden md:block"}`}
                  >
                    {activityQuery.isLoading ? (
                      <p className="text-sm text-slate-500">Loading…</p>
                    ) : (
                      <ul className="space-y-2 text-sm">
                        {(activityQuery.data?.items ?? []).length === 0 ? (
                          <li className="text-slate-500">No activity yet.</li>
                        ) : (
                          activityQuery.data?.items.map((item) => (
                            <li
                              key={`${item.kind}-${item.id}`}
                              className="flex flex-col rounded-lg border border-slate-200 bg-slate-50 p-2"
                            >
                              <span className="font-medium text-slate-800">
                                {item.title}
                              </span>
                              <span className="text-xs text-slate-500">
                                {item.subtitle}
                              </span>
                              <span className="text-xs text-slate-400">
                                {new Date(item.at).toLocaleString()}
                              </span>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                    <h3 className="font-semibold text-slate-800">
                      Application reminders
                    </h3>
                    <ul className="mt-2 space-y-2 text-sm">
                      {reminders.length === 0 ? (
                        <li className="text-slate-500">
                          No reminders right now. Your pipeline is up to date.
                        </li>
                      ) : (
                        reminders.map((item) => (
                          <li
                            key={`${item.jobId}-${item.type}`}
                            className="rounded border border-slate-200 bg-slate-50 p-2"
                          >
                            <p className="font-medium text-slate-700">
                              {item.message}
                            </p>
                            {item.nextAction ? (
                              <p className="mt-1 text-xs font-semibold text-brand-700">
                                Next action: {item.nextAction}
                              </p>
                            ) : null}
                            {item.reason ? (
                              <p className="text-xs text-slate-500">
                                {item.reason}
                              </p>
                            ) : null}
                            <p className="text-xs text-slate-500">
                              {new Date(item.dueAt).toLocaleString()}
                            </p>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                    <h3 className="font-semibold text-slate-800">
                      Status timeline
                    </h3>
                    <ul className="mt-2 space-y-2 text-sm">
                      {auditItems.length === 0 ? (
                        <li className="text-slate-500">
                          No timeline activity yet.
                        </li>
                      ) : (
                        auditItems.slice(0, 8).map((item) => (
                          <li
                            key={`${item.source}-${item.id}`}
                            className="rounded border border-slate-200 bg-slate-50 p-2"
                          >
                            <p className="font-medium text-slate-700">
                              {item.message}
                            </p>
                            <p className="text-xs text-slate-500">
                              {new Date(item.at).toLocaleString()}
                            </p>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                  <h3 className="font-semibold text-slate-800">
                    Similar-role grouping
                  </h3>
                  <ul className="mt-2 space-y-2 text-sm">
                    {groupedJobs.length === 0 ? (
                      <li className="text-slate-500">
                        No grouped applications yet. Similar company-role
                        entries will appear here.
                      </li>
                    ) : (
                      groupedJobs.slice(0, 8).map((group) => (
                        <li
                          key={group.key}
                          className="rounded border border-slate-200 bg-slate-50 p-2"
                        >
                          <p className="font-medium text-slate-700">
                            {group.company} - {group.role}
                          </p>
                          <p className="text-xs text-slate-500">
                            {group.location || "Remote"} | Week of{" "}
                            {group.weekStart} | {group.count} records
                          </p>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                <p className="text-sm text-slate-600">
                  Secondary insights are hidden for presentation mode. Use{" "}
                  <span className="font-semibold">Show secondary panels</span>{" "}
                  to reveal reminders, timeline, activity, and grouping
                  insights.
                </p>
              </div>
            )}

            {jobsQuery.isLoading ? (
              <p className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
                Loading jobs...
              </p>
            ) : null}
            {jobsQuery.isError ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                Could not load jobs. Refresh or check your session.
              </p>
            ) : null}
            {!jobsQuery.isLoading &&
            !jobsQuery.isError &&
            (jobs?.length ?? 0) === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
                <p>
                  No applications yet. Add your first job or load sample data to
                  explore the workflow.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    className={buttonPrimaryClass}
                    type="button"
                    onClick={() => void addSampleData()}
                  >
                    Try sample mode
                  </button>
                  <button
                    className={buttonSecondaryClass}
                    type="button"
                    onClick={() => {
                      setCompanyFilter("");
                      setStatusFilter("");
                      setStarredFilter("");
                    }}
                  >
                    Start clean
                  </button>
                </div>
              </div>
            ) : null}

            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                Kanban Pipeline
              </h3>
              <p className="text-xs text-slate-500">
                Drag cards across stages as your applications progress.
              </p>
            </div>
            <div className="grid gap-2 sm:gap-3 md:grid-cols-2 xl:grid-cols-4">
              {statuses.map((status) => (
                <div
                  key={status}
                  data-testid={`column-${status}`}
                  className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm sm:p-3"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (draggedId) moveJob(draggedId, status);
                  }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-semibold text-slate-800">{status}</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {jobsByStatus[status]?.length ?? 0}
                    </span>
                  </div>
                  <div
                    className={`mb-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone[status]}`}
                  >
                    {status === "APPLIED"
                      ? "Initial stage"
                      : status === "INTERVIEW"
                        ? "In progress"
                        : status === "OFFER"
                          ? "Strong outcome"
                          : "Closed"}
                  </div>
                  <div className="space-y-2">
                    {jobsByStatus[status]?.map((job) => (
                      <article
                        key={job.id}
                        data-testid="job-card"
                        data-job-id={job.id}
                        draggable
                        onDragStart={() => setDraggedId(job.id)}
                        className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 shadow-sm transition hover:border-brand-300 hover:shadow"
                      >
                        <div className="flex items-start justify-between gap-1">
                          <h4 className="font-medium">{job.company}</h4>
                          <button
                            type="button"
                            className="shrink-0 text-lg leading-none text-amber-500 hover:text-amber-600"
                            aria-label={
                              job.starred ? "Remove star" : "Star job"
                            }
                            onClick={() =>
                              patchJob.mutate({
                                id: job.id,
                                starred: !job.starred,
                              })
                            }
                          >
                            {job.starred ? "★" : "☆"}
                          </button>
                        </div>
                        <p className="text-sm font-medium text-slate-600">
                          {job.role}
                        </p>
                        <button
                          type="button"
                          className="mt-1 text-xs font-medium text-brand-700 hover:text-brand-800"
                          onClick={() => {
                            setSelectedInsightJobId(job.id);
                            companyInsightMutation.mutate(job.id);
                          }}
                        >
                          Company research
                        </button>
                        <p className="mt-1 text-xs text-slate-500">
                          Updated {new Date(job.updatedAt).toLocaleDateString()}
                        </p>
                        <label className="mt-2 block text-xs text-slate-500">
                          Follow-up
                          <input
                            type="datetime-local"
                            className="mt-0.5 w-full rounded border px-2 py-1 text-xs text-slate-800"
                            defaultValue={toDatetimeLocalValue(job.followUpAt)}
                            key={job.id + (job.followUpAt ?? "")}
                            onBlur={(e) => {
                              const v = e.target.value;
                              const prev = toDatetimeLocalValue(job.followUpAt);
                              if (v === prev) return;
                              patchJob.mutate({
                                id: job.id,
                                followUpAt: v
                                  ? new Date(v).toISOString()
                                  : null,
                              });
                            }}
                          />
                        </label>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <button
                            type="button"
                            className="rounded bg-brand-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-brand-700"
                            onClick={() => {
                              if (job.status === "APPLIED") {
                                scheduleFiveDayFollowUp.mutate(job.id);
                                return;
                              }
                              if (job.status === "INTERVIEW") {
                                followUpTemplateMutation.mutate(job.id);
                                return;
                              }
                              if (job.status === "OFFER") {
                                void exportApplicationPacket(
                                  job.id,
                                  job.company,
                                );
                                return;
                              }
                              setSelectedInsightJobId(job.id);
                              companyInsightMutation.mutate(job.id);
                            }}
                          >
                            Suggested: {suggestedActionForStatus(job.status)}
                          </button>
                          <button
                            type="button"
                            className="rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                            onClick={() =>
                              scheduleFiveDayFollowUp.mutate(job.id)
                            }
                          >
                            Schedule follow-up (5d)
                          </button>
                          <button
                            type="button"
                            className="rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                            onClick={() =>
                              followUpTemplateMutation.mutate(job.id)
                            }
                          >
                            Draft follow-up email
                          </button>
                          <button
                            type="button"
                            className="rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                            onClick={() =>
                              void exportApplicationPacket(job.id, job.company)
                            }
                          >
                            Export packet
                          </button>
                        </div>
                        <button
                          className="mt-2 text-xs font-medium text-red-600 transition hover:text-red-700"
                          onClick={() => deleteJob.mutate(job.id)}
                        >
                          Delete
                        </button>
                      </article>
                    ))}
                    {jobsByStatus[status]?.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500">
                        No applications in this stage yet.
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            {selectedCompanyInsight ? (
              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                <h3 className="font-semibold text-slate-900">
                  Company panel{" "}
                  {selectedInsightJobId
                    ? `for job ${selectedInsightJobId.slice(0, 8)}...`
                    : ""}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {selectedCompanyInsight.companyName} ·{" "}
                  {selectedCompanyInsight.industry} ·{" "}
                  {selectedCompanyInsight.companySize} employees ·{" "}
                  {selectedCompanyInsight.fundingStage}
                </p>
                <p className="mt-2 text-xs font-medium text-slate-500">
                  Likely tech stack
                </p>
                <p className="text-sm text-slate-700">
                  {selectedCompanyInsight.techStack.join(", ") || "N/A"}
                </p>
                <p className="mt-2 text-xs font-medium text-slate-500">
                  Recent signals
                </p>
                <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
                  {selectedCompanyInsight.recentNews.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs font-medium text-slate-500">
                  Common interview questions
                </p>
                <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
                  {(selectedCompanyInsight.commonInterviewQuestions ?? []).map(
                    (item) => (
                      <li key={item}>{item}</li>
                    ),
                  )}
                </ul>
              </div>
            ) : null}

            {followUpTemplate ? (
              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                <h3 className="font-semibold text-slate-900">
                  Follow-up email template
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  {followUpTemplate.subject}
                </p>
                <textarea
                  className={`${inputClass} mt-2 h-40`}
                  value={followUpTemplate.body}
                  onChange={(e) =>
                    setFollowUpTemplate((prev) =>
                      prev ? { ...prev, body: e.target.value } : prev,
                    )
                  }
                />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <button
                className={buttonSecondaryClass}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Prev
              </button>
              <span className="text-sm font-medium text-slate-600">
                Page {page}
              </span>
              <button
                className={buttonSecondaryClass}
                onClick={() => setPage((p) => p + 1)}
                disabled={!canGoNext}
              >
                Next
              </button>
            </div>
          </section>
        ) : (
          <AiWorkspace />
        )}
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold leading-tight text-slate-900 sm:text-2xl">
        {value}
      </p>
    </div>
  );
}

function AiWorkspace() {
  const qc = useQueryClient();
  const [resumeText, setResumeText] = useState("");
  const [uploadedResumeName, setUploadedResumeName] = useState("");
  const [resumeUploadError, setResumeUploadError] = useState<string | null>(
    null,
  );
  const [resumeStructuredMessage, setResumeStructuredMessage] = useState<
    string | null
  >(null);
  const latestUploadTokenRef = useRef(0);
  const exportNoticeTimeoutRef = useRef<ReturnType<
    typeof globalThis.setTimeout
  > | null>(null);
  const [exportNotice, setExportNotice] = useState<ExportNotice | null>(null);
  const [jobDescription, setJobDescription] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [interviewPrep, setInterviewPrep] = useState("");
  const [fitResult, setFitResult] = useState<FitScoreResult | null>(null);
  const [atsResult, setAtsResult] = useState<AtsCheckResult | null>(null);
  const [mockSessionId, setMockSessionId] = useState<string | null>(null);
  const [mockQuestions, setMockQuestions] = useState<string[]>([]);
  const [mockQuestionIndex, setMockQuestionIndex] = useState(0);
  const [mockAnswer, setMockAnswer] = useState("");
  const [mockFeedback, setMockFeedback] =
    useState<MockInterviewAnswerResult | null>(null);
  const [mockSummary, setMockSummary] = useState<MockInterviewSummary | null>(
    null,
  );
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);
  const [compareLeftId, setCompareLeftId] = useState("");
  const [compareRightId, setCompareRightId] = useState("");
  const [autoTailorResults, setAutoTailorResults] = useState<
    Array<{ opening: DiscoveredOpening; output: ResumeTailorResult }>
  >([]);
  const [autoTailorMessage, setAutoTailorMessage] = useState<string | null>(
    null,
  );
  const [structuredResumeJson, setStructuredResumeJson] = useState("{}");
  const [structuredJobDescription, setStructuredJobDescription] = useState("");
  const [structuredTailorResult, setStructuredTailorResult] =
    useState<StructuredResumeTailorOutput | null>(null);
  const [resumeHtmlOutput, setResumeHtmlOutput] = useState("");

  useEffect(() => {
    const onRateLimited = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
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
    queryFn: async () =>
      (await api.get<ApiSuccess<Generation[]>>("/ai/history")).data.data,
  });
  const providerStatusQuery = useQuery({
    queryKey: ["ai-provider-status"],
    queryFn: async () =>
      (await api.get<ApiSuccess<ProviderStatus>>("/ai/provider-status")).data
        .data,
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
      setResumeText((output.rewrittenBullets as string[]).join("\n"));
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
      setCoverLetter(output.content as string);
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
        await api.get<ApiSuccess<DiscoverOpeningsResponse>>(
          "/jobs/discover/openings",
          {
            params: { limit: 3 },
          },
        )
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
            tone: "impactful" as const,
          };
          const output = (
            await api.post<ApiSuccess<{ output: ResumeTailorResult }>>(
              "/ai/resume-tailor",
              payload,
            )
          ).data.data.output;
          return { opening, output };
        }),
      );
      return settled
        .filter(
          (
            result,
          ): result is PromiseFulfilledResult<{
            opening: DiscoveredOpening;
            output: ResumeTailorResult;
          }> => result.status === "fulfilled",
        )
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
      setCoverLetter(output.content as string);
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
        await api.post<ApiSuccess<StructuredResumeTailorOutput>>(
          "/ai/resume-tailor-structured",
          {
            resumeJson: parseStructuredResumeInput(),
            jobDescription: structuredJobDescription,
          },
        )
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
        await api.post<ApiSuccess<ResumeHtmlOutput>>("/ai/resume-html", {
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
        await api.post<ApiSuccess<FitScoreResult>>("/jobs/fit-score", {
          resumeText,
          jobDescription,
        })
      ).data.data,
    onSuccess: (output) => setFitResult(output),
  });

  const atsCheckMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post<ApiSuccess<AtsCheckResult>>("/jobs/ats-check", {
          resumeText,
          jobDescription,
        })
      ).data.data,
    onSuccess: (output) => setAtsResult(output),
  });

  const mockInterviewStartMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post<ApiSuccess<MockInterviewStartResult>>(
          "/ai/mock-interview/start",
          {
            jobDescription,
            candidateBackground: resumeText,
            targetRole: targetRole || undefined,
          },
        )
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
        await api.post<ApiSuccess<MockInterviewAnswerResult>>(
          `/ai/mock-interview/${mockSessionId}/answer`,
          {
            questionIndex: mockQuestionIndex,
            answer: mockAnswer,
          },
        )
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
      return (
        await api.get<ApiSuccess<MockInterviewSummary>>(
          `/ai/mock-interview/${mockSessionId}/summary`,
        )
      ).data.data;
    },
    onSuccess: (output) => setMockSummary(output),
  });

  const exportPdf = useMutation({
    mutationFn: async (payload: { title: string; content: string }) => {
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

  function showExportNotice(type: ExportNotice["type"], message: string) {
    setExportNotice({ type, message });
    if (exportNoticeTimeoutRef.current) {
      globalThis.clearTimeout(exportNoticeTimeoutRef.current);
    }
    exportNoticeTimeoutRef.current = globalThis.setTimeout(() => {
      setExportNotice(null);
      exportNoticeTimeoutRef.current = null;
    }, 3200);
  }

  async function trackExportTimeline(
    eventType: string,
    message: string,
    payload?: Record<string, unknown>,
  ) {
    try {
      await api.post("/exports/events", { eventType, message, payload });
    } catch {
      // Non-blocking telemetry; ignore logging failures.
    }
  }
  const htmlToPdfMutation = useMutation({
    mutationFn: async (html: string) => {
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
  const stringifyOutput = (value: unknown) =>
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const parseStructuredResumeInput = () => {
    const parsed = JSON.parse(structuredResumeJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Structured resume must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  };
  const MAX_RESUME_UPLOAD_BYTES = 8 * 1024 * 1024;
  const MAX_RESUME_PDF_PAGES = 20;
  const extractPdfText = async (file: File): Promise<string> => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
      import.meta.url,
    ).toString();
    (
      pdfjs as { GlobalWorkerOptions: { workerSrc: string } }
    ).GlobalWorkerOptions.workerSrc = workerSrc;
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await (
      pdfjs as unknown as {
        getDocument: (input: { data: Uint8Array }) => {
          promise: Promise<{
            numPages: number;
            getPage: (n: number) => Promise<{
              getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
            }>;
          }>;
        };
      }
    ).getDocument({ data }).promise;
    if (doc.numPages > MAX_RESUME_PDF_PAGES) {
      throw new Error(
        `PDF has ${doc.numPages} pages. Please upload a resume with up to ${MAX_RESUME_PDF_PAGES} pages.`,
      );
    }
    const pages: string[] = [];
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
  const parseResumeFileText = async (file: File): Promise<string> => {
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
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:space-y-3 sm:p-4">
        <div>
          <h3 className="font-semibold text-slate-900">
            Resume Tailor + Cover Letter + Interview Prep
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Use the same context once, then generate assets for each stage of
            your application.
          </p>
        </div>
        {providerStatusQuery.data ? (
          <div
            className={`rounded border px-3 py-2 text-sm ${
              providerStatusQuery.data.status === "connected"
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-amber-300 bg-amber-50 text-amber-700"
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
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          AI outputs are suggestions, not facts. Verify company details,
          requirements, and claims before sending.
        </div>
        {rateLimitMessage ? (
          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {rateLimitMessage}
          </div>
        ) : null}
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
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
                        ? (parsed as Record<string, unknown>)
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
            <p className="mt-1 text-[11px] text-slate-500">
              Loaded: {uploadedResumeName}
            </p>
          ) : null}
          {resumeUploadError ? (
            <p className="mt-1 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
              {resumeUploadError}
            </p>
          ) : null}
          {resumeStructuredMessage ? (
            <p className="mt-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">
              {resumeStructuredMessage}
            </p>
          ) : null}
          {autoTailorForJobsMutation.isError ? (
            <p className="mt-1 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
              {extractApiErrorMessage(
                autoTailorForJobsMutation.error,
                "Auto tailoring failed. Make sure your session is active and AI provider is configured.",
              )}
            </p>
          ) : null}
          {autoTailorMessage ? (
            <p className="mt-1 rounded border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] text-sky-700">
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
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm">
            <p className="font-semibold text-sky-800">
              Fit score: {fitResult.score}/100
            </p>
            <p className="text-xs text-sky-700">
              Confidence: {fitResult.confidence ?? "medium"} (keyword overlap
              heuristic)
            </p>
            <p className="mt-1 text-sky-700">{fitResult.explanation}</p>
            <p className="mt-2 text-xs font-semibold text-sky-700">
              Matched keywords
            </p>
            <p className="text-xs text-sky-700">
              {fitResult.matchedKeywords.join(", ") || "None"}
            </p>
            <p className="mt-2 text-xs font-semibold text-sky-700">
              Missing keywords
            </p>
            <p className="text-xs text-sky-700">
              {fitResult.missingKeywords.join(", ") || "None"}
            </p>
            <p className="mt-2 text-xs font-semibold text-sky-700">
              Skills gap detection
            </p>
            <p className="text-xs text-sky-700">
              {fitResult.skillGapDetection.join(", ") || "None"}
            </p>
            <p className="mt-2 text-xs font-semibold text-sky-700">
              Suggested bullet improvements
            </p>
            <ul className="mt-1 list-disc pl-4 text-xs text-sky-700">
              {fitResult.suggestedBulletImprovements.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {atsResult ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="font-semibold text-amber-800">
              ATS score: {atsResult.score}/100
            </p>
            <ul className="mt-1 list-disc pl-4 text-amber-700">
              {atsResult.issues.map((issue) => (
                <li key={issue.message}>
                  [{issue.severity}] {issue.message}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs font-semibold text-amber-800">
              Suggestions
            </p>
            <ul className="mt-1 list-disc pl-4 text-xs text-amber-700">
              {atsResult.suggestions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {atsResult.checks?.keywordDensity?.length ? (
              <>
                <p className="mt-2 text-xs font-semibold text-amber-800">
                  Keyword density
                </p>
                <p className="text-xs text-amber-700">
                  {atsResult.checks.keywordDensity
                    .map((item) => `${item.keyword}: ${item.count}`)
                    .join(" | ")}
                </p>
              </>
            ) : null}
          </div>
        ) : null}
        {mockSessionId ? (
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm">
            <p className="font-semibold text-violet-800">Mock interview mode</p>
            <p className="mt-1 text-violet-700">
              Question {Math.min(mockQuestionIndex + 1, mockQuestions.length)}{" "}
              of {mockQuestions.length}
            </p>
            <p className="mt-1 text-violet-700">
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
              <p className="mt-2 text-xs text-violet-700">
                Latest score: {mockFeedback.score}/100 - {mockFeedback.feedback}
              </p>
            ) : null}
            {mockSummary ? (
              <div className="mt-2 rounded border border-violet-200 bg-white p-2 text-xs text-violet-700">
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
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <p className="font-semibold text-emerald-800">
              Tailored resume variants for matched jobs
            </p>
            <ul className="mt-2 space-y-2">
              {autoTailorResults.map((item) => (
                <li
                  key={item.opening.url}
                  className="rounded border border-emerald-200 bg-white p-2"
                >
                  <p className="font-medium text-emerald-900">
                    {item.opening.title} - {item.opening.company}
                  </p>
                  <p className="text-xs text-emerald-700">
                    Match {item.opening.matchScore}% ·{" "}
                    {item.opening.location || "Remote"}
                  </p>
                  <p className="mt-1 text-xs text-emerald-700">
                    {item.output.explanation}
                  </p>
                  <ul className="mt-1 list-disc pl-4 text-xs text-emerald-800">
                    {item.output.rewrittenBullets.slice(0, 4).map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                  <div className="mt-2 flex gap-2">
                    <button
                      className="rounded border border-emerald-300 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
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
                      className="rounded border border-emerald-300 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
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
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h4 className="font-semibold text-slate-800">
            ATS structured resume optimizer
          </h4>
          <p className="mt-1 text-xs text-slate-500">
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
            <p className="mt-2 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-700">
              {extractApiErrorMessage(
                structuredTailorMutation.error,
                "Could not optimize structured resume JSON. Check JSON validity and retry.",
              )}
            </p>
          ) : null}
          {resumeHtmlMutation.isError ? (
            <p className="mt-2 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-700">
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
                <p className="mt-2 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-700">
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
                      ? "border border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border border-rose-300 bg-rose-50 text-rose-700"
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

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <h3 className="font-semibold text-slate-900">Generation History</h3>
        {historyQuery.isLoading ? (
          <p className="mt-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
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
          <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2">
            <p className="text-xs text-slate-600">
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
            <li className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">
              No saved generations yet. Run any AI action to build your history.
            </li>
          ) : null}
          {historyQuery.data?.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm"
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
              <p className="text-xs text-slate-500">
                {new Date(item.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
