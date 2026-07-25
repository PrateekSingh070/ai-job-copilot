import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../providers/AuthProvider";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  panelClass,
  sectionHeaderClass,
} from "../ui/theme.js";
import {
  BriefcaseIcon,
  CalendarIcon,
  ChartBarIcon,
  DocumentTextIcon,
  SparklesIcon,
} from "../ui/icons";
import {
  extractApiErrorMessage,
  statusLabels,
  statuses,
} from "../lib/dashboardHelpers.js";
import { MetricCard } from "../components/MetricCard.jsx";
import { KanbanBoard } from "../components/KanbanBoard.jsx";
import { ResumeTailor } from "../components/ResumeTailor.jsx";

const PAGE_SIZE = 20;

export function DashboardPage() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("jobs");
  const [companyFilter, setCompanyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [newJob, setNewJob] = useState({
    company: "",
    role: "",
    status: "APPLIED",
  });

  // GET /jobs — refetches whenever a filter or the page changes.
  const jobsQuery = useQuery({
    queryKey: ["jobs", companyFilter, statusFilter, page],
    queryFn: async () => {
      const res = await api.get("/jobs", {
        params: {
          company: companyFilter || undefined,
          status: statusFilter || undefined,
          page,
          pageSize: PAGE_SIZE,
        },
      });
      return res.data;
    },
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
    mutationFn: async () => api.post("/jobs", newJob),
    onSuccess: () => {
      setNewJob({ company: "", role: "", status: "APPLIED" });
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

        {/* Tracker / Resume Tailor tabs */}
        <div className="mt-5 inline-flex w-full rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-1 shadow-lift sm:w-auto">
          {[
            { id: "jobs", label: "Tracker", icon: BriefcaseIcon },
            { id: "ai", label: "Resume Tailor", icon: DocumentTextIcon },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition sm:flex-none sm:px-6 ${
                activeTab === id
                  ? "bg-gradient-to-r from-cyan-500 to-teal-500 text-zinc-950 shadow-md shadow-cyan-950/40"
                  : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200"
              }`}
              onClick={() => setActiveTab(id)}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {activeTab === "ai" ? (
          <ResumeTailor />
        ) : (
          <section className="mt-4 space-y-4 sm:mt-6">
            {/* Add job — POST /jobs */}
            <form
              className={`${panelClass} grid gap-2 sm:gap-3 md:grid-cols-4`}
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
                  setNewJob((p) => ({ ...p, status: e.target.value }))
                }
              >
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status]}
                  </option>
                ))}
              </select>
              <button
                data-testid="add-job-submit"
                className={buttonPrimaryClass}
                type="submit"
                disabled={createJob.isPending}
              >
                {createJob.isPending ? "Adding…" : "Add Job"}
              </button>
              {createJob.isError ? (
                <p className="rounded-lg border border-rose-500/35 bg-rose-950/40 px-2 py-1 text-xs text-rose-200 md:col-span-4">
                  {extractApiErrorMessage(
                    createJob.error,
                    "Could not add job. Please try again.",
                  )}
                </p>
              ) : null}
            </form>

            {/* Filters — company search + status */}
            <div className={`${panelClass} flex flex-wrap items-center gap-2`}>
              <input
                data-testid="filter-company"
                placeholder="Search company"
                className={`${inputClass} min-w-0 flex-1 sm:w-64 sm:flex-none`}
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
              />

              <select
                data-testid="filter-status"
                className={`${inputClass} sm:w-44`}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All statuses</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={buttonSecondaryClass}
                onClick={() => {
                  setCompanyFilter("");
                  setStatusFilter("");
                }}
              >
                Clear filters
              </button>
              <span className="w-full text-xs font-medium text-zinc-500 sm:ml-auto sm:w-auto">
                {jobs.length} of {total} jobs
              </span>
            </div>

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
