import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../providers/AuthProvider";
import {
  actionChipClass,
  actionChipPrimaryClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  kanbanColumnAccent,
  kanbanColumnDot,
  sectionHeaderClass,
  statusTone,
} from "../ui/theme.js";
import {
  BriefcaseIcon,
  CalendarIcon,
  ChartBarIcon,
  EnvelopeIcon,
  ArrowDownTrayIcon,
  SparklesIcon,
  StarIcon,
  TrashIcon,
  BuildingOfficeIcon,
} from "../ui/icons";
import {
  avatarToneByStatus,
  extractApiErrorMessage,
  statuses,
  statusLabels,
  suggestedActionForStatus,
  toDatetimeLocalValue,
} from "../lib/dashboardHelpers.js";
import { MetricCard } from "../components/MetricCard.jsx";
import { AiWorkspace } from "./AiWorkspace.jsx";
export function DashboardPage() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const [draggedId, setDraggedId] = useState(null);
  const [companyFilter, setCompanyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [starredFilter, setStarredFilter] = useState("");
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState("jobs");
  const [newJob, setNewJob] = useState({
    company: "",
    role: "",
    status: "APPLIED",
    jobUrl: "",
  });
  const [importUrl, setImportUrl] = useState("");
  const [importPreview, setImportPreview] = useState(null);
  const [importDraft, setImportDraft] = useState({
    company: "",
    role: "",
    location: "",
    jobDescription: "",
  });
  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [selectedInsightJobId, setSelectedInsightJobId] = useState("");
  const [selectedCompanyInsight, setSelectedCompanyInsight] = useState(null);
  const [followUpTemplate, setFollowUpTemplate] = useState(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [presentationMode, setPresentationMode] = useState(true);
  const [showSecondaryPanels, setShowSecondaryPanels] = useState(false);
  const [internshipsOnly, setInternshipsOnly] = useState(false);
  const [remoteOnly, setRemoteOnly] = useState(false);

  const jobsQuery = useQuery({
    queryKey: ["jobs", companyFilter, statusFilter, starredFilter, page],
    queryFn: async () => {
      const res = await api.get("/jobs", {
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
    queryFn: async () => (await api.get("/jobs/activity/recent")).data.data,
    enabled: activeTab === "jobs",
  });

  const metricsQuery = useQuery({
    queryKey: ["metrics"],
    queryFn: async () => (await api.get("/jobs/metrics/summary")).data.data,
  });

  const remindersQuery = useQuery({
    queryKey: ["job-reminders"],
    queryFn: async () => (await api.get("/jobs/reminders")).data.data,
    enabled: activeTab === "jobs",
  });

  const groupsQuery = useQuery({
    queryKey: ["job-groups"],
    queryFn: async () => (await api.get("/jobs/groups")).data.data,
    enabled: activeTab === "jobs",
  });

  const auditQuery = useQuery({
    queryKey: ["job-audit"],
    queryFn: async () => (await api.get("/jobs/timeline/audit")).data.data,
    enabled: activeTab === "jobs",
  });

  const openingsQuery = useQuery({
    queryKey: ["discover-openings", internshipsOnly, remoteOnly],
    queryFn: async () =>
      (
        await api.get("/jobs/discover/openings", {
          params: {
            limit: 18,
            internshipsOnly: internshipsOnly ? "true" : undefined,
            remoteOnly: remoteOnly ? "true" : undefined,
          },
        })
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
      return api.post("/jobs", payload);
    },
    onSuccess: (res) => {
      setNewJob({ company: "", role: "", status: "APPLIED", jobUrl: "" });
      const warning = res.data.meta?.duplicateMessage;
      setDuplicateWarning(typeof warning === "string" ? warning : null);
      // A new job affects every derived view, so refresh them all together.
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["metrics"] });
      qc.invalidateQueries({ queryKey: ["activity-recent"] });
      qc.invalidateQueries({ queryKey: ["job-reminders"] });
      qc.invalidateQueries({ queryKey: ["job-audit"] });
      qc.invalidateQueries({ queryKey: ["job-groups"] });
    },
  });

  const saveDiscoveredOpening = useMutation({
    mutationFn: async (opening) =>
      api.post("/jobs", {
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
        await api.post("/jobs/import-url/preview", {
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
      return api.post("/jobs/import-url", {
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
    },
  });

  const companyInsightMutation = useMutation({
    mutationFn: async (jobId) =>
      (await api.post(`/jobs/${jobId}/company-research`)).data.data,
    onSuccess: (data) => setSelectedCompanyInsight(data),
  });

  const patchJob = useMutation({
    mutationFn: async (payload) => {
      const { id, ...body } = payload;
      return api.patch(`/jobs/${id}`, body);
    },
    // Optimistic update: patch the cached job list right away so the card
    // moves/stars instantly, keeping a snapshot to roll back to on error.
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: ["jobs"] });
      const previous = qc.getQueriesData({ queryKey: ["jobs"] });
      qc.setQueriesData({ queryKey: ["jobs"] }, (old) => {
        if (!old || typeof old !== "object" || !("data" in old)) return old;
        const body = old;
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
    mutationFn: async (id) => api.delete(`/jobs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["metrics"] });
      qc.invalidateQueries({ queryKey: ["activity-recent"] });
      qc.invalidateQueries({ queryKey: ["job-reminders"] });
      qc.invalidateQueries({ queryKey: ["job-audit"] });
    },
  });

  const scheduleFiveDayFollowUp = useMutation({
    mutationFn: async (jobId) => api.post(`/jobs/${jobId}/follow-up-5-days`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job-reminders"] });
      qc.invalidateQueries({ queryKey: ["job-audit"] });
      qc.invalidateQueries({ queryKey: ["job-groups"] });
    },
  });

  const followUpTemplateMutation = useMutation({
    mutationFn: async (jobId) =>
      (await api.get(`/jobs/${jobId}/follow-up-template`)).data.data,
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

  async function exportApplicationPacket(jobId, company) {
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
        status: "APPLIED",
        location: "Remote",
      },
      {
        company: "Nimbus Labs",
        role: "Frontend Engineer",
        status: "INTERVIEW",
        location: "Remote",
      },
      {
        company: "Arbor AI",
        role: "Product Engineer",
        status: "APPLIED",
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
      statuses.reduce((acc, status) => {
        acc[status] = (jobs ?? []).filter((job) => job.status === status);
        return acc;
      }, {}),
    [jobs],
  );

  function moveJob(jobId, targetStatus) {
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
    <main className="relative min-h-screen bg-zinc-950 text-zinc-100">
      <div
        className="pointer-events-none fixed inset-0 -z-10 opacity-90"
        aria-hidden
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_100%_70%_at_50%_-20%,rgba(34,211,238,0.09),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_100%_0%,rgba(45,212,191,0.06),transparent_50%)]" />
      </div>
      <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          {/* Brand */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-teal-500 shadow shadow-cyan-950/40">
              <BriefcaseIcon className="h-4 w-4 text-zinc-950" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-tight text-white leading-none">
                Job Copilot
              </p>
              <p className="mt-0.5 truncate text-xs text-zinc-500 hidden sm:block">
                Hi, {user?.name} Â· Pipeline + AI workspace
              </p>
            </div>
          </div>
          {/* Right actions */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              data-testid="logout-button"
              className={buttonSecondaryClass}
              onClick={() => logout()}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
        <div className="mb-3 flex items-center gap-2">
          <ChartBarIcon className="h-4 w-4 text-zinc-500" />
          <h2 className={sectionHeaderClass}>Pipeline snapshot</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            label="Total Applications"
            value={metricsQuery.data?.totalApplications ?? 0}
            icon={BriefcaseIcon}
            accent="sky"
          />

          <MetricCard
            label="Interview Rate"
            value={`${metricsQuery.data?.interviewRate ?? 0}%`}
            icon={ChartBarIcon}
            accent="violet"
          />

          <MetricCard
            label="Offer Rate"
            value={`${metricsQuery.data?.offerRate ?? 0}%`}
            icon={SparklesIcon}
            accent="emerald"
          />

          <MetricCard
            label="App â†’ Interview"
            value={`${metricsQuery.data?.conversion?.applicationToInterviewRate ?? 0}%`}
            icon={ChartBarIcon}
            accent="cyan"
          />

          <MetricCard
            label="Interview â†’ Offer"
            value={`${metricsQuery.data?.conversion?.interviewToOfferRate ?? 0}%`}
            icon={ChartBarIcon}
            accent="amber"
          />

          <MetricCard
            label="Top Resume Match"
            value={
              metricsQuery.data?.resumeVersionPerformance?.[0]?.matchScore !==
              undefined
                ? `${metricsQuery.data.resumeVersionPerformance[0].matchScore}%`
                : "N/A"
            }
            icon={SparklesIcon}
            accent="cyan"
          />
        </div>

        <div className="mt-5 inline-flex w-full rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-1 shadow-lift sm:mt-6 sm:w-auto">
          <button
            className={`flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition sm:flex-none sm:px-6 ${
              activeTab === "jobs"
                ? "bg-gradient-to-r from-cyan-500 to-teal-500 text-zinc-950 shadow-md shadow-cyan-950/40"
                : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200"
            }`}
            onClick={() => setActiveTab("jobs")}
          >
            <BriefcaseIcon className="h-4 w-4" />
            Tracker
          </button>
          <button
            className={`flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition sm:flex-none sm:px-6 ${
              activeTab === "ai"
                ? "bg-gradient-to-r from-cyan-500 to-teal-500 text-zinc-950 shadow-md shadow-cyan-950/40"
                : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200"
            }`}
            onClick={() => setActiveTab("ai")}
          >
            <SparklesIcon className="h-4 w-4" />
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
          <div className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-sm text-zinc-200 sm:mt-6">
            <p className="font-semibold text-white">Quick start</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-400">
              <span className="rounded-full border border-zinc-700/80 bg-zinc-900/60 px-2.5 py-1">
                1 Â· Import role
              </span>
              <span className="rounded-full border border-zinc-700/80 bg-zinc-900/60 px-2.5 py-1">
                2 Â· AI fit + draft
              </span>
              <span className="rounded-full border border-zinc-700/80 bg-zinc-900/60 px-2.5 py-1">
                3 Â· Export
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
            <div className="flex items-center gap-2">
              <BriefcaseIcon className="h-4 w-4 text-zinc-500" />
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">
                  Capture Applications
                </h3>
                <p className="text-xs text-zinc-500">
                  Add manually or parse a job URL, then confirm import quality.
                </p>
              </div>
            </div>
            <form
              className="grid gap-2 rounded-2xl border border-zinc-800/80 bg-zinc-900/50 p-3 shadow-sm sm:gap-3 sm:p-4 md:grid-cols-4"
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
                    status: e.target.value,
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
              <p className="text-xs text-zinc-500 md:col-span-4">
                Tip: Add each application as soon as you apply so your funnel
                metrics stay accurate.
              </p>
              {createJob.isError ? (
                <p className="rounded border border-rose-500/35 bg-rose-950/40 px-2 py-1 text-xs text-rose-200 md:col-span-4">
                  {extractApiErrorMessage(
                    createJob.error,
                    "Could not add job. Please try again.",
                  )}
                </p>
              ) : null}
              {duplicateWarning ? (
                <p className="rounded border border-amber-500/35 bg-amber-950/35 px-2 py-1 text-xs text-amber-200 md:col-span-4">
                  Duplicate warning: {duplicateWarning}
                </p>
              ) : null}
            </form>

            <form
              className="grid gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 shadow-sm sm:gap-3 sm:p-4 md:grid-cols-[1fr_auto]"
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
              <p className="rounded border border-rose-500/35 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                {extractApiErrorMessage(
                  importPreviewMutation.error,
                  "Could not parse this URL.",
                )}
              </p>
            ) : null}

            {importPreview ? (
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 shadow-sm sm:p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-zinc-100">
                    Import review
                  </p>
                  <span className="rounded-full bg-zinc-800/70 px-2 py-0.5 text-xs text-zinc-400">
                    Confidence {Math.round(importPreview.confidence * 100)}%
                  </span>
                  <span className="text-xs text-zinc-500">
                    Signals: {importPreview.signals.join(", ") || "n/a"}
                  </span>
                </div>
                {importPreview.duplicate ? (
                  <p className="mt-2 rounded border border-amber-500/35 bg-amber-950/35 px-2 py-1 text-xs text-amber-200">
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
                  <p className="mt-2 rounded border border-rose-500/35 bg-rose-950/40 px-2 py-1 text-xs text-rose-200">
                    {extractApiErrorMessage(
                      importUrlMutation.error,
                      "Could not save imported job.",
                    )}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 shadow-sm sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100">
                    Internet jobs + internships for your profile
                  </h3>
                  <p className="text-xs text-zinc-500">
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
                <label className="inline-flex items-center gap-1 rounded-full border border-zinc-800/80 px-2 py-1 text-zinc-400">
                  <input
                    type="checkbox"
                    checked={internshipsOnly}
                    onChange={(e) => setInternshipsOnly(e.target.checked)}
                  />
                  Internships only
                </label>
                <label className="inline-flex items-center gap-1 rounded-full border border-zinc-800/80 px-2 py-1 text-zinc-400">
                  <input
                    type="checkbox"
                    checked={remoteOnly}
                    onChange={(e) => setRemoteOnly(e.target.checked)}
                  />
                  Remote only
                </label>
                {openingsQuery.data?.profileKeywords?.length ? (
                  <span className="text-zinc-500">
                    Profile signals:{" "}
                    {openingsQuery.data.profileKeywords.slice(0, 6).join(", ")}
                  </span>
                ) : null}
              </div>
              {openingsQuery.isLoading ? (
                <p className="mt-2 text-sm text-zinc-500">
                  Loading internet openings...
                </p>
              ) : null}
              {openingsQuery.isError ? (
                <p className="mt-2 rounded border border-rose-500/35 bg-rose-950/40 px-2 py-1 text-xs text-rose-200">
                  Could not load openings right now. Please retry.
                </p>
              ) : null}
              {(openingsQuery.data?.warnings ?? []).map((warning) => (
                <p
                  key={warning}
                  className="mt-2 rounded border border-amber-500/35 bg-amber-950/35 px-2 py-1 text-xs text-amber-200"
                >
                  {warning}
                </p>
              ))}
              {!openingsQuery.isLoading &&
              !openingsQuery.isError &&
              discoveredOpenings.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500">
                  No openings matched current filters yet.
                </p>
              ) : null}
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {discoveredOpenings.slice(0, 10).map((opening) => (
                  <article
                    key={`${opening.source}-${opening.url}`}
                    className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                        Match {opening.matchScore}%
                      </span>
                      {opening.isInternship ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">
                          Internship
                        </span>
                      ) : null}
                      {opening.isRemote ? (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-200">
                          Remote
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-zinc-100">
                      {opening.title}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {opening.company} Â· {opening.location || "Location TBD"} Â·{" "}
                      {opening.source}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {opening.snippet}
                    </p>
                    {opening.matchedKeywords.length ? (
                      <p className="mt-1 text-[11px] text-zinc-500">
                        Matched:{" "}
                        {opening.matchedKeywords.slice(0, 5).join(", ")}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-1">
                      <a
                        href={opening.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border border-zinc-700/70 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800"
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

            <div className="sticky top-0 z-20 -mx-3 border-b border-zinc-800/90 bg-zinc-950/90 px-3 py-2 shadow-sm backdrop-blur-sm sm:static sm:mx-0 sm:rounded-xl sm:border sm:border-zinc-800/80 sm:bg-zinc-900/60 sm:p-3 sm:shadow-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
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
                  onChange={(e) => setStatusFilter(e.target.value)}
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
                  onChange={(e) => setStarredFilter(e.target.value)}
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
                <span className="w-full text-xs font-medium text-zinc-500 sm:ml-auto sm:w-auto">
                  Showing {(jobs ?? []).length} jobs on this page
                </span>
              </div>
            </div>

            {!presentationMode || showSecondaryPanels ? (
              <>
                <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 shadow-sm sm:p-4">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-left md:hidden"
                    onClick={() => setActivityOpen((o) => !o)}
                    aria-expanded={activityOpen}
                  >
                    <span className="font-semibold text-zinc-100">
                      Recent activity
                    </span>
                    <span className="text-zinc-500" aria-hidden>
                      {activityOpen ? "â–²" : "â–¼"}
                    </span>
                  </button>
                  <h3 className="hidden font-semibold text-zinc-100 md:block">
                    Recent activity
                  </h3>
                  <div
                    className={`mt-2 ${activityOpen || activityQuery.isLoading ? "block" : "hidden md:block"}`}
                  >
                    {activityQuery.isLoading ? (
                      <p className="text-sm text-zinc-500">Loadingâ€¦</p>
                    ) : (
                      <ul className="space-y-2 text-sm">
                        {(activityQuery.data?.items ?? []).length === 0 ? (
                          <li className="text-zinc-500">No activity yet.</li>
                        ) : (
                          activityQuery.data?.items.map((item) => (
                            <li
                              key={`${item.kind}-${item.id}`}
                              className="flex flex-col rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2"
                            >
                              <span className="font-medium text-zinc-100">
                                {item.title}
                              </span>
                              <span className="text-xs text-zinc-500">
                                {item.subtitle}
                              </span>
                              <span className="text-xs text-zinc-500">
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
                  <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 shadow-sm sm:p-4">
                    <h3 className="font-semibold text-zinc-100">
                      Application reminders
                    </h3>
                    <ul className="mt-2 space-y-2 text-sm">
                      {reminders.length === 0 ? (
                        <li className="text-zinc-500">
                          No reminders right now. Your pipeline is up to date.
                        </li>
                      ) : (
                        reminders.map((item) => (
                          <li
                            key={`${item.jobId}-${item.type}`}
                            className="rounded border border-zinc-800/80 bg-zinc-900/40 p-2"
                          >
                            <p className="font-medium text-zinc-300">
                              {item.message}
                            </p>
                            {item.nextAction ? (
                              <p className="mt-1 text-xs font-semibold text-brand-700">
                                Next action: {item.nextAction}
                              </p>
                            ) : null}
                            {item.reason ? (
                              <p className="text-xs text-zinc-500">
                                {item.reason}
                              </p>
                            ) : null}
                            <p className="text-xs text-zinc-500">
                              {new Date(item.dueAt).toLocaleString()}
                            </p>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 shadow-sm sm:p-4">
                    <h3 className="font-semibold text-zinc-100">
                      Status timeline
                    </h3>
                    <ul className="mt-2 space-y-2 text-sm">
                      {auditItems.length === 0 ? (
                        <li className="text-zinc-500">
                          No timeline activity yet.
                        </li>
                      ) : (
                        auditItems.slice(0, 8).map((item) => (
                          <li
                            key={`${item.source}-${item.id}`}
                            className="rounded border border-zinc-800/80 bg-zinc-900/40 p-2"
                          >
                            <p className="font-medium text-zinc-300">
                              {item.message}
                            </p>
                            <p className="text-xs text-zinc-500">
                              {new Date(item.at).toLocaleString()}
                            </p>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 shadow-sm sm:p-4">
                  <h3 className="font-semibold text-zinc-100">
                    Similar-role grouping
                  </h3>
                  <ul className="mt-2 space-y-2 text-sm">
                    {groupedJobs.length === 0 ? (
                      <li className="text-zinc-500">
                        No grouped applications yet. Similar company-role
                        entries will appear here.
                      </li>
                    ) : (
                      groupedJobs.slice(0, 8).map((group) => (
                        <li
                          key={group.key}
                          className="rounded border border-zinc-800/80 bg-zinc-900/40 p-2"
                        >
                          <p className="font-medium text-zinc-300">
                            {group.company} - {group.role}
                          </p>
                          <p className="text-xs text-zinc-500">
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
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 shadow-sm sm:p-4">
                <p className="text-sm text-zinc-400">
                  Secondary insights are hidden for presentation mode. Use{" "}
                  <span className="font-semibold">Show secondary panels</span>{" "}
                  to reveal reminders, timeline, activity, and grouping
                  insights.
                </p>
              </div>
            )}

            {jobsQuery.isLoading ? (
              <p className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-3 text-sm text-zinc-400">
                Loading jobs...
              </p>
            ) : null}
            {jobsQuery.isError ? (
              <p className="rounded-lg border border-rose-500/30 bg-rose-950/40 p-3 text-sm text-rose-200">
                Could not load jobs. Refresh or check your session.
              </p>
            ) : null}
            {!jobsQuery.isLoading &&
            !jobsQuery.isError &&
            (jobs?.length ?? 0) === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-700/70 bg-zinc-900/35 p-4 text-sm text-zinc-400">
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

            <div className="flex items-center gap-2">
              <ArrowDownTrayIcon className="h-4 w-4 text-zinc-500" />
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">
                  Kanban Pipeline
                </h3>
                <p className="text-xs text-zinc-500">
                  Drag cards across stages as your applications progress.
                </p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {statuses.map((status) => (
                <div
                  key={status}
                  data-testid={`column-${status}`}
                  className={`flex flex-col rounded-2xl border bg-zinc-900/50 p-3 shadow-sm ${kanbanColumnAccent[status] ?? "border-zinc-800/80"}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (draggedId) moveJob(draggedId, status);
                  }}
                >
                  {/* Column header */}
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${kanbanColumnDot[status] ?? "bg-zinc-500"}`}
                      />

                      <h3 className="text-sm font-semibold text-zinc-100">
                        {statusLabels[status]}
                      </h3>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusTone[status]}`}
                    >
                      {jobsByStatus[status]?.length ?? 0}
                    </span>
                  </div>

                  {/* Job cards */}
                  <div className="flex flex-col gap-2">
                    {jobsByStatus[status]?.map((job) => {
                      const initials = job.company.slice(0, 2).toUpperCase();
                      return (
                        <article
                          key={job.id}
                          data-testid="job-card"
                          data-job-id={job.id}
                          draggable
                          onDragStart={() => setDraggedId(job.id)}
                          className="group rounded-xl border border-zinc-800/70 bg-zinc-950/50 p-3 shadow-sm transition-all hover:border-zinc-700/70 hover:bg-zinc-900/70 hover:shadow-md cursor-grab active:cursor-grabbing"
                        >
                          {/* Card top: avatar + company + star */}
                          <div className="flex items-start gap-2.5">
                            <div
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${avatarToneByStatus[status] ?? "bg-zinc-800 text-zinc-400"}`}
                            >
                              {initials}
                            </div>
                            <div className="min-w-0 flex-1">
                              <h4 className="truncate text-sm font-semibold text-zinc-100 leading-tight">
                                {job.company}
                              </h4>
                              <p className="truncate text-xs text-zinc-400 leading-tight mt-0.5">
                                {job.role}
                              </p>
                            </div>
                            <button
                              type="button"
                              aria-label={
                                job.starred ? "Remove star" : "Star job"
                              }
                              onClick={() =>
                                patchJob.mutate({
                                  id: job.id,
                                  starred: !job.starred,
                                })
                              }
                              className="shrink-0 rounded p-0.5 text-zinc-600 transition hover:text-amber-400"
                            >
                              <StarIcon
                                className="h-4 w-4"
                                filled={job.starred}
                              />
                            </button>
                          </div>

                          {/* Meta row */}
                          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                            {job.location && (
                              <span className="flex items-center gap-0.5">
                                <span>ðŸ“</span>
                                {job.location}
                              </span>
                            )}
                            <span className="ml-auto flex items-center gap-1">
                              <CalendarIcon className="h-3 w-3" />
                              {new Date(job.updatedAt).toLocaleDateString()}
                            </span>
                          </div>

                          {/* Follow-up datetime */}
                          <label className="mt-2 block">
                            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-600">
                              Follow-up
                            </span>
                            <input
                              type="datetime-local"
                              className="mt-0.5 w-full rounded-lg border border-zinc-800/70 bg-zinc-950/60 px-2 py-1 text-[11px] text-zinc-300 outline-none focus:border-cyan-400/40 focus:ring-1 focus:ring-cyan-400/10"
                              defaultValue={toDatetimeLocalValue(
                                job.followUpAt,
                              )}
                              key={job.id + (job.followUpAt ?? "")}
                              onBlur={(e) => {
                                const v = e.target.value;
                                const prev = toDatetimeLocalValue(
                                  job.followUpAt,
                                );
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

                          {/* Actions */}
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              className={actionChipPrimaryClass}
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
                              <SparklesIcon className="h-3 w-3" />
                              {suggestedActionForStatus(job.status)}
                            </button>
                            <button
                              type="button"
                              className={actionChipClass}
                              onClick={() => {
                                setSelectedInsightJobId(job.id);
                                companyInsightMutation.mutate(job.id);
                              }}
                            >
                              <BuildingOfficeIcon className="h-3 w-3" />
                              Research
                            </button>
                            <button
                              type="button"
                              className={actionChipClass}
                              onClick={() =>
                                followUpTemplateMutation.mutate(job.id)
                              }
                            >
                              <EnvelopeIcon className="h-3 w-3" />
                              Email draft
                            </button>
                            <button
                              type="button"
                              className={actionChipClass}
                              onClick={() =>
                                void exportApplicationPacket(
                                  job.id,
                                  job.company,
                                )
                              }
                            >
                              <ArrowDownTrayIcon className="h-3 w-3" />
                              Export
                            </button>
                          </div>

                          {/* Delete */}
                          <button
                            type="button"
                            className="mt-2 flex items-center gap-1 text-[11px] font-medium text-zinc-600 transition hover:text-rose-400"
                            onClick={() => deleteJob.mutate(job.id)}
                          >
                            <TrashIcon className="h-3 w-3" />
                            Remove
                          </button>
                        </article>
                      );
                    })}
                    {jobsByStatus[status]?.length === 0 && (
                      <div className="rounded-xl border border-dashed border-zinc-800/60 p-4 text-center">
                        <p className="text-xs text-zinc-600">
                          Drop a card here or add a new application above
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {selectedCompanyInsight ? (
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 shadow-sm sm:p-4">
                <h3 className="font-semibold text-white">
                  Company panel{" "}
                  {selectedInsightJobId
                    ? `for job ${selectedInsightJobId.slice(0, 8)}...`
                    : ""}
                </h3>
                <p className="mt-1 text-sm text-zinc-400">
                  {selectedCompanyInsight.companyName} Â·{" "}
                  {selectedCompanyInsight.industry} Â·{" "}
                  {selectedCompanyInsight.companySize} employees Â·{" "}
                  {selectedCompanyInsight.fundingStage}
                </p>
                <p className="mt-2 text-xs font-medium text-zinc-500">
                  Likely tech stack
                </p>
                <p className="text-sm text-zinc-300">
                  {selectedCompanyInsight.techStack.join(", ") || "N/A"}
                </p>
                <p className="mt-2 text-xs font-medium text-zinc-500">
                  Recent signals
                </p>
                <ul className="mt-1 list-disc pl-5 text-sm text-zinc-300">
                  {selectedCompanyInsight.recentNews.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs font-medium text-zinc-500">
                  Common interview questions
                </p>
                <ul className="mt-1 list-disc pl-5 text-sm text-zinc-300">
                  {(selectedCompanyInsight.commonInterviewQuestions ?? []).map(
                    (item) => (
                      <li key={item}>{item}</li>
                    ),
                  )}
                </ul>
              </div>
            ) : null}

            {followUpTemplate ? (
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 shadow-sm sm:p-4">
                <h3 className="font-semibold text-white">
                  Follow-up email template
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
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
              <span className="text-sm font-medium text-zinc-400">
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
