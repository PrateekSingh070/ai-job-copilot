import { useState } from "react";
import {
  kanbanColumnAccent,
  kanbanColumnDot,
  statusTone,
} from "../ui/theme.js";
import { CalendarIcon, TrashIcon } from "../ui/icons";
import {
  avatarToneByStatus,
  statusLabels,
  statuses,
} from "../lib/dashboardHelpers.js";

// Four status columns with HTML5 drag-and-drop. Dropping a card on a column
// calls onMove(jobId, status), which the dashboard turns into PATCH /jobs/:id.
export function KanbanBoard({ jobs, onMove, onDelete }) {
  const [draggedId, setDraggedId] = useState(null);

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {statuses.map((status) => {
        const columnJobs = jobs.filter((job) => job.status === status);
        return (
          <div
            key={status}
            data-testid={`column-${status}`}
            className={`flex flex-col rounded-2xl border bg-zinc-900/50 p-3 shadow-sm ${kanbanColumnAccent[status]}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (draggedId) onMove(draggedId, status);
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${kanbanColumnDot[status]}`}
                />

                <h3 className="text-sm font-semibold text-zinc-100">
                  {statusLabels[status]}
                </h3>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusTone[status]}`}
              >
                {columnJobs.length}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {columnJobs.map((job) => (
                <article
                  key={job.id}
                  data-testid="job-card"
                  data-job-id={job.id}
                  draggable
                  onDragStart={() => setDraggedId(job.id)}
                  className="cursor-grab rounded-xl border border-zinc-800/70 bg-zinc-950/50 p-3 shadow-sm transition hover:border-zinc-700/70 hover:bg-zinc-900/70 active:cursor-grabbing"
                >
                  <div className="flex items-start gap-2.5">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${avatarToneByStatus[status]}`}
                    >
                      {job.company.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-sm font-semibold leading-tight text-zinc-100">
                        {job.company}
                      </h4>
                      <p className="mt-0.5 truncate text-xs leading-tight text-zinc-400">
                        {job.role}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center gap-1 text-[11px] text-zinc-500">
                    <CalendarIcon className="h-3 w-3" />
                    {new Date(job.updatedAt).toLocaleDateString()}
                    <button
                      type="button"
                      aria-label={`Delete ${job.company}`}
                      className="ml-auto flex items-center gap-1 font-medium text-zinc-600 transition hover:text-rose-400"
                      onClick={() => onDelete(job.id)}
                    >
                      <TrashIcon className="h-3 w-3" />
                      Remove
                    </button>
                  </div>
                </article>
              ))}
              {columnJobs.length === 0 && (
                <div className="rounded-xl border border-dashed border-zinc-800/60 p-4 text-center">
                  <p className="text-xs text-zinc-600">Drop a card here</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
