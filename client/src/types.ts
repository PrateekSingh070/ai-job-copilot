export type JobStatus = "APPLIED" | "INTERVIEW" | "OFFER" | "REJECTED";

export type User = {
  id: string;
  name: string;
  email: string;
};

export type JobApplication = {
  id: string;
  company: string;
  role: string;
  status: JobStatus;
  location?: string | null;
  jobUrl?: string | null;
  jobDescription?: string | null;
  source?: string | null;
  salaryRange?: string | null;
  notes?: string | null;
  starred: boolean;
  followUpAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompanyInsight = {
  id: string;
  companyName: string;
  industry: string;
  companySize: string;
  fundingStage: string;
  techStack: string[];
  recentNews: string[];
  commonInterviewQuestions: string[];
  lastRefreshedAt: string;
};

export type DiscoveredOpening = {
  title: string;
  company: string;
  location?: string | null;
  isRemote: boolean;
  isInternship: boolean;
  url: string;
  source: string;
  publishedAt?: string | null;
  snippet: string;
  matchScore: number;
  matchedKeywords: string[];
};

export type DiscoverOpeningsResponse = {
  generatedAt: string;
  profileKeywords: string[];
  openings: DiscoveredOpening[];
  warnings: string[];
};

export type ApiSuccess<T> = {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
};
