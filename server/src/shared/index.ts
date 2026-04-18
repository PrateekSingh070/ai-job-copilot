import { z } from "zod";

export const jobStatusSchema = z.enum([
  "APPLIED",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
]);

export const successResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
    meta: z.record(z.string(), z.unknown()).optional(),
  });

export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type JobStatus = z.infer<typeof jobStatusSchema>;

export const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.email(),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
});

export const jobCreateSchema = z.object({
  company: z.string().min(1).max(120),
  role: z.string().min(1).max(120),
  jobUrl: z.url().optional(),
  jobDescription: z.string().max(10000).optional(),
  source: z.string().max(40).optional(),
  location: z.string().max(120).optional(),
  salaryRange: z.string().max(80).optional(),
  status: jobStatusSchema.default("APPLIED"),
  notes: z.string().max(3000).optional(),
  starred: z.boolean().optional(),
  followUpAt: z.coerce.date().optional().nullable(),
});

export const jobPatchSchema = jobCreateSchema.partial();

export const jobQuerySchema = z.object({
  status: jobStatusSchema.optional(),
  company: z.string().max(120).optional(),
  starred: z.enum(["true", "false"]).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

/** Same filters as list, without pagination — used for CSV export. */
export const jobExportQuerySchema = jobQuerySchema.omit({
  page: true,
  pageSize: true,
});

export const jobDiscoveryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  internshipsOnly: z.enum(["true", "false"]).optional(),
  remoteOnly: z.enum(["true", "false"]).optional(),
});

export const jobImportUrlSchema = z.object({
  url: z.url(),
  overrides: z
    .object({
      company: z.string().min(1).max(120).optional(),
      role: z.string().min(1).max(120).optional(),
      location: z.string().max(120).optional().nullable(),
      jobDescription: z.string().max(10000).optional(),
    })
    .optional(),
});

export const jobFitScoreSchema = z.object({
  resumeText: z.string().min(50).max(50000),
  jobDescription: z.string().min(50).max(20000),
});

export const atsCheckSchema = z.object({
  resumeText: z.string().min(50).max(50000),
  jobDescription: z.string().min(50).max(20000).optional(),
});

export const timelineEventCreateSchema = z.object({
  eventType: z.enum(["NOTE", "EMAIL", "AI_GENERATION"]),
  message: z.string().min(2).max(2000),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const aiResumeTailorSchema = z.object({
  resumeText: z.string().min(50).max(20000),
  jobDescription: z.string().min(50).max(20000),
  targetRole: z.string().min(2).max(120),
  tone: z.enum(["concise", "confident", "impactful"]).default("impactful"),
});

export const aiCoverLetterSchema = z.object({
  profileContext: z.string().min(30).max(20000),
  jobDescription: z.string().min(50).max(20000),
  tone: z.enum(["professional", "warm", "assertive"]).default("professional"),
  length: z.enum(["short", "medium", "long"]).default("medium"),
});

export const aiInterviewPrepSchema = z.object({
  jobDescription: z.string().min(50).max(20000),
  candidateBackground: z.string().min(30).max(20000),
});

export const aiStructuredResumeTailorSchema = z.object({
  resumeJson: z.record(z.string(), z.unknown()),
  jobDescription: z.string().min(50).max(20000),
});

export const aiResumeHtmlSchema = z.object({
  resumeJson: z.record(z.string(), z.unknown()),
});

export const mockInterviewStartSchema = z.object({
  jobDescription: z.string().min(50).max(20000),
  candidateBackground: z.string().min(30).max(20000),
  targetRole: z.string().min(2).max(120).optional(),
});

export const mockInterviewAnswerSchema = z.object({
  questionIndex: z.number().int().min(0),
  answer: z.string().min(5).max(4000),
});

export const masterResumeSchema = z.object({
  title: z.string().min(1).max(120),
  content: z.string().min(50).max(50000),
});
