import { z } from "zod";

// Request/response shapes for every endpoint the API exposes.
// Routes parse request bodies and query strings through these schemas, so
// handlers can trust their input.

export const jobStatusSchema = z.enum([
  "APPLIED",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
]);

export const successResponseSchema = (dataSchema) =>
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
  location: z.string().max(120).optional(),
  salaryRange: z.string().max(80).optional(),
  status: jobStatusSchema.default("APPLIED"),
  notes: z.string().max(3000).optional(),
});

export const jobPatchSchema = jobCreateSchema.partial();

export const jobQuerySchema = z.object({
  status: jobStatusSchema.optional(),
  company: z.string().max(120).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const aiResumeTailorSchema = z.object({
  resumeText: z.string().min(50).max(20000),
  jobDescription: z.string().min(50).max(20000),
  targetRole: z.string().min(2).max(120),
  tone: z.enum(["concise", "confident", "impactful"]).default("impactful"),
});

export const resumeUpsertSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  content: z.string().min(50).max(20000),
});

export const aiCoverLetterSchema = z.object({
  jobDescription: z.string().min(50).max(20000),
  company: z.string().min(1).max(120),
  role: z.string().min(1).max(120),
  resumeText: z.string().min(50).max(20000).optional(),
  tone: z
    .enum(["professional", "enthusiastic", "concise"])
    .default("professional"),
  hiringManager: z.string().max(120).optional(),
});

export const aiSkillGapSchema = z.object({
  jobDescription: z.string().min(50).max(20000),
  resumeText: z.string().min(50).max(20000).optional(),
  targetRole: z.string().min(2).max(120).optional(),
});

// Chat is stateless: the client owns the transcript and replays it. Capping
// history bounds prompt size — without it a long conversation grows the token
// bill on every turn.
export const aiChatSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .max(10)
    .default([]),
});

// Import accepts a URL to fetch *or* pasted text, never both. Sites that block
// bots (LinkedIn, Indeed) are the common case for the paste path, so it isn't a
// fallback so much as an equal partner.
export const aiImportJobSchema = z
  .object({
    url: z.url().max(2000).optional(),
    rawText: z.string().min(50).max(20000).optional(),
  })
  .refine((value) => Boolean(value.url) !== Boolean(value.rawText), {
    message: "Provide exactly one of url or rawText",
  });
