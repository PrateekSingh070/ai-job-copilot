// Minimal shared TypeScript type definitions (reference only; not compiled or bundled).
export type JobStatus = "APPLIED" | "INTERVIEW" | "OFFER" | "REJECTED";
export interface JobSummary { id: string; company: string; status: JobStatus; }
export const isJobStatus = (value: string): value is JobStatus =>
  ["APPLIED", "INTERVIEW", "OFFER", "REJECTED"].includes(value);
