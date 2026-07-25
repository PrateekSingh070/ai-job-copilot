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
