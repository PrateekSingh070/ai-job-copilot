import {
  buttonPrimaryClass,
  inputClass,
  labelClass,
  panelClass,
} from "../ui/theme.js";
import {
  extractApiErrorMessage,
  statusLabels,
  statuses,
} from "../lib/dashboardHelpers.js";

/**
 * The "add job" form, extracted from DashboardPage. State stays with the
 * parent because the URL-import feature also writes into the same draft job.
 */
export function AddJobForm({
  value,
  onChange,
  showDetails,
  onToggleDetails,
  onSubmit,
  isPending,
  error,
}) {
  const set = (field) => (e) =>
    onChange((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <form
      className={panelClass}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid gap-2 sm:gap-3 md:grid-cols-4">
        <label className="block">
          <span className={labelClass}>Company</span>
          <input
            data-testid="add-job-company"
            placeholder="Acme Labs"
            className={inputClass}
            value={value.company}
            onChange={set("company")}
            required
          />
        </label>

        <label className="block">
          <span className={labelClass}>Role</span>
          <input
            data-testid="add-job-role"
            placeholder="Full Stack Engineer"
            className={inputClass}
            value={value.role}
            onChange={set("role")}
            required
          />
        </label>

        <label className="block">
          <span className={labelClass}>Status</span>
          <select
            className={inputClass}
            value={value.status}
            onChange={set("status")}
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end">
          <button
            data-testid="add-job-submit"
            className={`${buttonPrimaryClass} w-full`}
            type="submit"
            disabled={isPending}
          >
            {isPending ? "Adding…" : "Add Job"}
          </button>
        </div>
      </div>

      {/* The remaining columns have always existed on JobApplication but had
          no UI. Collapsed by default so the common path stays a four-field
          form. */}
      <button
        type="button"
        data-testid="add-job-toggle-details"
        className="mt-3 text-xs font-medium text-cyan-400 transition hover:text-cyan-300"
        onClick={onToggleDetails}
      >
        {showDetails ? "− Hide details" : "+ Add details"}
      </button>

      {showDetails ? (
        <div className="mt-3 grid gap-2 sm:gap-3 md:grid-cols-3">
          <label className="block">
            <span className={labelClass}>Location</span>
            <input
              data-testid="add-job-location"
              placeholder="Remote"
              className={inputClass}
              value={value.location}
              onChange={set("location")}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Salary range</span>
            <input
              data-testid="add-job-salary"
              placeholder="$120k – $150k"
              className={inputClass}
              value={value.salaryRange}
              onChange={set("salaryRange")}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Job URL</span>
            <input
              data-testid="add-job-url"
              type="url"
              placeholder="https://…"
              className={inputClass}
              value={value.jobUrl}
              onChange={set("jobUrl")}
            />
          </label>

          <label className="block md:col-span-3">
            <span className={labelClass}>Job description</span>
            <textarea
              data-testid="add-job-description"
              className={`${inputClass} h-28`}
              value={value.jobDescription}
              onChange={set("jobDescription")}
            />
          </label>

          <label className="block md:col-span-3">
            <span className={labelClass}>Notes</span>
            <textarea
              data-testid="add-job-notes"
              className={`${inputClass} h-20`}
              value={value.notes}
              onChange={set("notes")}
            />
          </label>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-rose-500/35 bg-rose-950/40 px-2 py-1 text-xs text-rose-200">
          {extractApiErrorMessage(error, "Could not add job. Please try again.")}
        </p>
      ) : null}
    </form>
  );
}
