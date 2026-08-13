import {
  buttonSecondaryClass,
  inputClass,
  panelClass,
} from "../ui/theme.js";
import { statusLabels, statuses } from "../lib/dashboardHelpers.js";

/** Company search + status filter row, extracted from DashboardPage. */
export function JobFilters({
  company,
  status,
  onCompanyChange,
  onStatusChange,
  onClear,
  shownCount,
  totalCount,
}) {
  return (
    <div className={`${panelClass} flex flex-wrap items-center gap-2`}>
      <label className="min-w-0 flex-1 sm:w-64 sm:flex-none">
        <span className="sr-only">Filter by company</span>
        <input
          data-testid="filter-company"
          placeholder="Search company"
          className={inputClass}
          value={company}
          onChange={(e) => onCompanyChange(e.target.value)}
        />
      </label>

      <label className="sm:w-44">
        <span className="sr-only">Filter by status</span>
        <select
          data-testid="filter-status"
          className={inputClass}
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {statusLabels[s]}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className={buttonSecondaryClass} onClick={onClear}>
        Clear filters
      </button>
      <span className="w-full text-xs font-medium text-zinc-500 sm:ml-auto sm:w-auto">
        {shownCount} of {totalCount} jobs
      </span>
    </div>
  );
}
