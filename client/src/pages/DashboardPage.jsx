import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../providers/AuthProvider";
import { useDebouncedValue } from "../lib/useDebouncedValue.js";
import { buttonSecondaryClass, sectionHeaderClass } from "../ui/theme.js";
import {
  BriefcaseIcon,
  CalendarIcon,
  ChartBarIcon,
  ChatBubbleIcon,
  DocumentTextIcon,
  SparklesIcon,
  UserIcon,
  EnvelopeIcon,
  AcademicCapIcon,
} from "../ui/icons";
import { MetricCard } from "../components/MetricCard.jsx";
import { KanbanBoard } from "../components/KanbanBoard.jsx";
import { AddJobForm } from "../components/AddJobForm.jsx";
import { JobFilters } from "../components/JobFilters.jsx";
import { JobImport } from "../components/JobImport.jsx";
import { TabBar } from "../components/TabBar.jsx";

// The AI panels are code-split: none of them are needed to render the default
// Tracker tab, so they load on first visit to their tab instead of inflating
// the initial bundle.
const lazyPanel = (loader, name) =>
  lazy(() => loader().then((mod) => ({ default: mod[name] })));
const PipelineChat = lazyPanel(
  () => import("../components/PipelineChat.jsx"),
  "PipelineChat",
);
const ResumeProfile = lazyPanel(
  () => import("../components/ResumeProfile.jsx"),
  "ResumeProfile",
);
const CoverLetter = lazyPanel(
  () => import("../components/CoverLetter.jsx"),
  "CoverLetter",
);
const SkillGap = lazyPanel(
  () => import("../components/SkillGap.jsx"),
  "SkillGap",
);
const ResumeTailor = lazyPanel(
  () => import("../components/ResumeTailor.jsx"),
  "ResumeTailor",
);

const PAGE_SIZE = 20;

// Every column the API accepts, so a reset clears imported values too.
const EMPTY_JOB = {
  company: "",
  role: "",
  status: "APPLIED",
  location: "",
  salaryRange: "",
  jobUrl: "",
  jobDescription: "",
  notes: "",
};

// Tab definitions live outside the component so the array identity is stable.
const TABS = [
  { id: "jobs", label: "Tracker", icon: BriefcaseIcon },
  { id: "chat", label: "Ask", icon: ChatBubbleIcon },
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "letter", label: "Cover Letter", icon: EnvelopeIcon },
  { id: "gap", label: "Skill Gap", icon: AcademicCapIcon },
  { id: "tailor", label: "Resume Tailor", icon: DocumentTextIcon },
];

const AI_TAB_PANELS = {
  chat: PipelineChat,
  profile: ResumeProfile,
  letter: CoverLetter,
  gap: SkillGap,
  tailor: ResumeTailor,
};

function PanelFallback() {
  return (
    <p className="mt-6 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 text-sm text-zinc-400">
      Loading…
    </p>
  );
}

export function DashboardPage() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("jobs");
  const [companyFilter, setCompanyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showJobDetails, setShowJobDetails] = useState(false);
  const [newJob, setNewJob] = useState(EMPTY_JOB);

  /**
   * Copy an extraction into the add-job form. Only non-empty fields overwrite,
   * so a partial extraction can't wipe something the user already typed, and
   * the details pane opens so the imported description is visible rather than
   * silently staged behind a collapsed toggle.
   */
  function applyImportedJob(extracted) {
    setNewJob((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(EMPTY_JOB)) {
        if (key === "status") continue;
        if (extracted[key]) next[key] = extracted[key];
      }
      return next;
    });
    setShowJobDetails(true);
  }

  // The raw input drives the textbox; the debounced value drives the query key,
  // so typing a company name is one request instead of one per keystroke.
  const debouncedCompany = useDebouncedValue(companyFilter, 300);

  // GET /jobs — refetches whenever a filter or the page changes.
  const jobsQuery = useQuery({
    queryKey: ["jobs", debouncedCompany, statusFilter, page],
    queryFn: async () => {
      const res = await api.get("/jobs", {
        params: {
          company: debouncedCompany || undefined,
          status: statusFilter || undefined,
          page,
          pageSize: PAGE_SIZE,
        },
      });
      return res.data;
    },
    // Keep the previous page on screen while the next one loads, instead of
    // flashing the loading state on every pagination click.
    placeholderData: keepPreviousData,
  });

  // GET /jobs/metrics/summary — the four numbers above the board.
  const metricsQuery = useQuery({
    queryKey: ["metrics"],
    queryFn: async () => (await api.get("/jobs/metrics/summary")).data.data,
  });

  // Any write invalidates both the list and the metrics.
  const refreshJobs = () => {
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["metrics"] });
  };

  const createJob = useMutation({
    mutationFn: async () => {
      // Strip empty strings so optional fields arrive as undefined rather than
      // "", which would fail the server's z.url() check on jobUrl.
      const payload = {};
      for (const [k, v] of Object.entries(newJob)) {
        if (v !== "") payload[k] = v;
      }
      return api.post("/jobs", payload);
    },
    onSuccess: () => {
      setNewJob(EMPTY_JOB);
      setShowJobDetails(false);
      refreshJobs();
    },
  });

  const patchJob = useMutation({
    mutationFn: async ({ id, ...body }) => api.patch(`/jobs/${id}`, body),
    // Optimistic update: move the card right away, roll back if the API fails.
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: ["jobs"] });
      const previous = qc.getQueriesData({ queryKey: ["jobs"] });
      qc.setQueriesData({ queryKey: ["jobs"] }, (old) => {
        if (!old || !Array.isArray(old.data)) return old;
        return {
          ...old,
          data: old.data.map((job) =>
            job.id === payload.id ? { ...job, status: payload.status } : job,
          ),
        };
      });
      return { previous };
    },
    onError: (_err, _payload, context) => {
      context?.previous?.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSuccess: refreshJobs,
  });

  const deleteJob = useMutation({
    mutationFn: async (id) => api.delete(`/jobs/${id}`),
    onSuccess: refreshJobs,
  });

  const jobs = jobsQuery.data?.data ?? [];
  const total = jobsQuery.data?.meta?.total ?? jobs.length;
  const canGoNext = page * PAGE_SIZE < total;

  // Ignore drops onto the column a card already sits in.
  function moveJob(jobId, targetStatus) {
    const current = jobs.find((job) => job.id === jobId);
    if (!current || current.status === targetStatus) return;
    patchJob.mutate({ id: jobId, status: targetStatus });
  }

  // Filtering resets pagination so you never land on an empty page.
  useEffect(() => {
    setPage(1);
  }, [companyFilter, statusFilter]);

  const ActivePanel = AI_TAB_PANELS[activeTab];

  return (
    <main className="relative min-h-screen bg-zinc-950 text-zinc-100">
      <div
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_100%_70%_at_50%_-20%,rgba(34,211,238,0.09),transparent_55%)]"
        aria-hidden
      />

      <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-teal-500">
              <BriefcaseIcon className="h-4 w-4 text-zinc-950" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold leading-none tracking-tight text-white">
                Job Copilot
              </p>
              <p className="mt-0.5 hidden truncate text-xs text-zinc-500 sm:block">
                Hi, {user?.name}
              </p>
            </div>
          </div>
          <button
            data-testid="logout-button"
            className={buttonSecondaryClass}
            onClick={() => logout()}
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
        <h1 className="text-lg font-bold tracking-tight text-white">
          Application dashboard
        </h1>

        {/* Metrics from GET /jobs/metrics/summary */}
        <div className="mb-3 mt-5 flex items-center gap-2">
          <ChartBarIcon className="h-4 w-4 text-zinc-500" />
          <h2 className={sectionHeaderClass}>Pipeline snapshot</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <MetricCard
            label="Total Applications"
            value={metricsQuery.data?.totalApplications ?? 0}
            icon={BriefcaseIcon}
            accent="sky"
          />

          <MetricCard
            label="In Interview"
            value={metricsQuery.data?.stageDistribution?.INTERVIEW ?? 0}
            icon={CalendarIcon}
            accent="violet"
          />

          <MetricCard
            label="Interview Rate"
            value={`${metricsQuery.data?.interviewRate ?? 0}%`}
            icon={ChartBarIcon}
            accent="cyan"
          />

          <MetricCard
            label="Offer Rate"
            value={`${metricsQuery.data?.offerRate ?? 0}%`}
            icon={SparklesIcon}
            accent="emerald"
          />
        </div>

        {/* Tracker / Profile / Cover Letter / Skill Gap / Resume Tailor tabs */}
        <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

        {ActivePanel ? (
          <Suspense fallback={<PanelFallback />}>
            <ActivePanel />
          </Suspense>
        ) : (
          <section className="mt-4 space-y-4 sm:mt-6">
            {/* Import from a URL or pasted text — prefills the form below */}
            <JobImport onExtracted={applyImportedJob} />

            {/* Add job — POST /jobs */}
            <AddJobForm
              value={newJob}
              onChange={setNewJob}
              showDetails={showJobDetails}
              onToggleDetails={() => setShowJobDetails((v) => !v)}
              onSubmit={() => createJob.mutate()}
              isPending={createJob.isPending}
              error={createJob.isError ? createJob.error : null}
            />

            {/* Filters — company search + status */}
            <JobFilters
              company={companyFilter}
              status={statusFilter}
              onCompanyChange={setCompanyFilter}
              onStatusChange={setStatusFilter}
              onClear={() => {
                setCompanyFilter("");
                setStatusFilter("");
              }}
              shownCount={jobs.length}
              totalCount={total}
            />

            {jobsQuery.isLoading ? (
              <p className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 text-sm text-zinc-400">
                Loading jobs…
              </p>
            ) : null}
            {jobsQuery.isError ? (
              <p className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-3 text-sm text-rose-200">
                Could not load jobs. Refresh or check your session.
              </p>
            ) : null}

            <KanbanBoard
              jobs={jobs}
              onMove={moveJob}
              onDelete={(id) => deleteJob.mutate(id)}
            />

            {/* Pagination */}
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
        )}
      </section>
    </main>
  );
}
