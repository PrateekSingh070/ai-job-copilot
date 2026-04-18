import { Router } from "express";
import { isIP } from "node:net";
import dns from "node:dns/promises";
import {
  atsCheckSchema,
  jobCreateSchema,
  jobExportQuerySchema,
  jobFitScoreSchema,
  jobImportUrlSchema,
  jobPatchSchema,
  jobQuerySchema,
  timelineEventCreateSchema,
} from "../../shared/index.js";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import { sendSuccess } from "../../utils/response.js";
import { ApiError } from "../../utils/ApiError.js";
import { sanitizeText } from "../../utils/sanitize.js";
import { z } from "zod";
import {
  buildCompanyResearch,
  computeApplicationReminders,
  computeFitScore,
  extractJobFromHtml,
  normalizeCompany,
  runAtsChecks,
} from "./job-intelligence.js";
import { buildProfileSignals, discoverOpenings } from "./openings.discovery.js";

const router = Router();
router.use(requireAuth);

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

type JobListQuery = z.infer<typeof jobQuerySchema>;
type JobExportQuery = z.infer<typeof jobExportQuerySchema>;
const jobDiscoveryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  internshipsOnly: z.enum(["true", "false"]).optional(),
  remoteOnly: z.enum(["true", "false"]).optional(),
});
type JobDiscoveryQuery = z.infer<typeof jobDiscoveryQuerySchema>;

function buildJobWhere(userId: string, q: JobListQuery | JobExportQuery) {
  return {
    userId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.company
      ? { company: { contains: q.company, mode: "insensitive" as const } }
      : {}),
    ...(q.starred === "true"
      ? { starred: true }
      : q.starred === "false"
        ? { starred: false }
        : {}),
    ...(q.startDate || q.endDate
      ? {
          createdAt: {
            ...(q.startDate ? { gte: q.startDate } : {}),
            ...(q.endDate ? { lte: endOfDay(q.endDate) } : {}),
          },
        }
      : {}),
  };
}

function csvEscape(value: string): string {
  const neutralized = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(neutralized))
    return `"${neutralized.replace(/"/g, '""')}"`;
  return neutralized;
}

function normalizeRole(role: string): string {
  return role.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeLocation(location?: string | null): string {
  return (location ?? "remote").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function weekBucket(date: Date): string {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function buildJobGroupKey(input: {
  company: string;
  role: string;
  location?: string | null;
  createdAt: Date;
}) {
  return `${normalizeCompany(input.company)}::${normalizeRole(input.role)}::${normalizeLocation(
    input.location,
  )}::${weekBucket(input.createdAt)}`;
}

async function findDuplicateJob(input: {
  userId: string;
  company: string;
  role: string;
  location?: string | null;
  jobUrl?: string | null;
}) {
  const normalized = normalizeCompany(input.company);
  const candidates = await prisma.jobApplication.findMany({
    where: { userId: input.userId },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return (
    candidates.find((row) => {
      const sameCompany = normalizeCompany(row.company) === normalized;
      const sameRole =
        row.role.trim().toLowerCase() === input.role.trim().toLowerCase();
      const sameLocation =
        normalizeLocation(row.location) ===
        normalizeLocation(input.location ?? null);
      const sameUrl = Boolean(
        input.jobUrl && row.jobUrl && row.jobUrl === input.jobUrl,
      );
      return (sameCompany && sameRole && sameLocation) || sameUrl;
    }) ?? null
  );
}

async function logTimelineEvent(input: {
  userId: string;
  jobId?: string;
  eventType: string;
  message: string;
  payload?: Record<string, unknown>;
}) {
  await prisma.jobTimelineEvent.create({
    data: {
      userId: input.userId,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      eventType: input.eventType,
      message: sanitizeText(input.message),
      payloadJson: (input.payload ?? {}) as never,
    },
  });
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (host.startsWith("::ffff:")) {
    const mapped = host.replace("::ffff:", "");
    if (isIP(mapped) === 4) return isPrivateHost(mapped);
  }
  const ipType = isIP(host);
  if (!ipType) return false;
  if (ipType === 4) {
    return (
      host.startsWith("10.") ||
      host.startsWith("127.") ||
      host.startsWith("169.254.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    );
  }
  return (
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80")
  );
}

function assertSafeImportUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApiError(400, "JOB_IMPORT_URL_INVALID", "Invalid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new ApiError(
      400,
      "JOB_IMPORT_URL_INVALID",
      "Only HTTPS URLs are supported for import",
    );
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new ApiError(
      400,
      "JOB_IMPORT_URL_BLOCKED",
      "Private/internal hosts are not allowed",
    );
  }
}

async function assertResolvedHostIsPublic(hostname: string) {
  if (isPrivateHost(hostname)) {
    throw new ApiError(
      400,
      "JOB_IMPORT_URL_BLOCKED",
      "Private/internal hosts are not allowed",
    );
  }
  const records = await dns.lookup(hostname, { all: true }).catch(() => []);
  for (const record of records) {
    if (isPrivateHost(record.address)) {
      throw new ApiError(
        400,
        "JOB_IMPORT_URL_BLOCKED",
        "Resolved host points to private/internal network",
      );
    }
  }
}

async function fetchHtmlWithGuard(url: string): Promise<string> {
  let current = new URL(url);
  for (let hop = 0; hop < 3; hop += 1) {
    assertSafeImportUrl(current.toString());
    await assertResolvedHostIsPublic(current.hostname);

    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 8000);
    const response = await fetch(current.toString(), {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "ai-job-copilot-importer/1.0" },
    }).finally(() => globalThis.clearTimeout(timeout));

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location)
        throw new ApiError(
          400,
          "JOB_IMPORT_FAILED",
          "Redirected without a location header",
        );
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) {
      throw new ApiError(
        400,
        "JOB_IMPORT_FAILED",
        `Could not fetch URL: ${response.status}`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html/i.test(contentType)) {
      throw new ApiError(
        400,
        "JOB_IMPORT_FAILED",
        "URL does not return HTML content",
      );
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > 500_000) {
      throw new ApiError(
        400,
        "JOB_IMPORT_FAILED",
        "HTML payload too large to import safely",
      );
    }
    const html = await response.text();
    if (html.length > 500_000) {
      throw new ApiError(
        400,
        "JOB_IMPORT_FAILED",
        "HTML payload too large to import safely",
      );
    }
    return html;
  }
  throw new ApiError(
    400,
    "JOB_IMPORT_FAILED",
    "Too many redirects while importing job URL",
  );
}

router.get(
  "/export/csv",
  validateQuery(jobExportQuerySchema),
  async (req, res) => {
    const q = res.locals.validatedQuery as JobExportQuery;
    const where = buildJobWhere(req.user!.sub, q);
    const rows = await prisma.jobApplication.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });

    const header = [
      "company",
      "role",
      "status",
      "starred",
      "followUpAt",
      "location",
      "salaryRange",
      "jobUrl",
      "notes",
      "createdAt",
      "updatedAt",
    ];
    const lines = [
      header.join(","),
      ...rows.map((row) =>
        [
          csvEscape(row.company),
          csvEscape(row.role),
          csvEscape(row.status),
          row.starred ? "true" : "false",
          row.followUpAt ? csvEscape(row.followUpAt.toISOString()) : "",
          csvEscape(row.location ?? ""),
          csvEscape(row.salaryRange ?? ""),
          csvEscape(row.jobUrl ?? ""),
          csvEscape(row.notes ?? ""),
          csvEscape(row.createdAt.toISOString()),
          csvEscape(row.updatedAt.toISOString()),
        ].join(","),
      ),
    ];

    const filename = `job-applications-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send("\ufeff" + lines.join("\n"));
  },
);

router.get("/activity/recent", async (req, res) => {
  const userId = req.user!.sub;
  const [jobRows, genRows] = await Promise.all([
    prisma.jobApplication.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: {
        id: true,
        company: true,
        role: true,
        status: true,
        updatedAt: true,
      },
    }),
    prisma.aiGeneration.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, type: true, createdAt: true },
    }),
  ]);

  type ActivityItem =
    | {
        kind: "job";
        id: string;
        at: string;
        title: string;
        subtitle: string;
      }
    | {
        kind: "ai";
        id: string;
        at: string;
        title: string;
        subtitle: string;
      };

  const items: ActivityItem[] = [
    ...jobRows.map((j) => ({
      kind: "job" as const,
      id: j.id,
      at: j.updatedAt.toISOString(),
      title: `${j.company} — ${j.role}`,
      subtitle: `Status → ${j.status}`,
    })),
    ...genRows.map((g) => ({
      kind: "ai" as const,
      id: g.id,
      at: g.createdAt.toISOString(),
      title: `AI: ${g.type.replace(/_/g, " ")}`,
      subtitle: "Generation saved",
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 20);

  return sendSuccess(res, { items });
});

router.get(
  "/discover/openings",
  validateQuery(jobDiscoveryQuerySchema),
  async (req, res) => {
    const q = res.locals.validatedQuery as JobDiscoveryQuery;
    const userId = req.user!.sub;
    const [masterResume, fallbackResume, recentJobs] = await Promise.all([
      prisma.resumeProfile.findFirst({
        where: { userId, isMaster: true },
        orderBy: { updatedAt: "desc" },
        select: { content: true },
      }),
      prisma.resumeProfile.findFirst({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        select: { content: true },
      }),
      prisma.jobApplication.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 25,
        select: {
          role: true,
          notes: true,
          jobDescription: true,
        },
      }),
    ]);

    const profileText = [
      masterResume?.content ?? "",
      fallbackResume?.content ?? "",
      recentJobs.map((item) => item.role).join(" "),
      recentJobs.map((item) => item.notes ?? "").join(" "),
      recentJobs.map((item) => item.jobDescription ?? "").join(" "),
    ]
      .join(" ")
      .slice(0, 20_000);

    const roleHints = recentJobs.map((item) => item.role);
    const profile = buildProfileSignals(profileText, roleHints);
    const discovery = await discoverOpenings(profile, {
      limit: q.limit,
      internshipsOnly: q.internshipsOnly === "true",
      remoteOnly: q.remoteOnly === "true",
    });

    return sendSuccess(res, discovery);
  },
);

router.post(
  "/import-url",
  validateBody(jobImportUrlSchema),
  async (req, res) => {
    const { url, overrides } = req.body as z.infer<typeof jobImportUrlSchema>;
    const html = await fetchHtmlWithGuard(url);
    const extracted = extractJobFromHtml(html, url);
    const draft = {
      company: overrides?.company?.trim() || extracted.company,
      role: overrides?.role?.trim() || extracted.role,
      location:
        overrides?.location === null
          ? null
          : typeof overrides?.location === "string"
            ? overrides.location.trim()
            : extracted.location,
      description: overrides?.jobDescription?.trim() || extracted.description,
    };
    const duplicate = await findDuplicateJob({
      userId: req.user!.sub,
      company: draft.company,
      role: draft.role,
      jobUrl: url,
      location: draft.location,
    });
    const created = await prisma.jobApplication.create({
      data: {
        userId: req.user!.sub,
        company: sanitizeText(draft.company),
        role: sanitizeText(draft.role),
        jobUrl: sanitizeText(url),
        jobDescription: draft.description.slice(0, 10000),
        source: "url-import",
        ...(draft.location ? { location: sanitizeText(draft.location) } : {}),
        status: "APPLIED",
      },
    });
    await logTimelineEvent({
      userId: req.user!.sub,
      jobId: created.id,
      eventType: "CREATED",
      message: "Job captured from URL import.",
      payload: { source: "url-import", importedUrl: url },
    });
    return sendSuccess(res, created, 201, {
      importConfidence: extracted.confidence,
      importSignals: extracted.signals,
      duplicateDetected: Boolean(duplicate),
      ...(duplicate
        ? {
            duplicateJobId: duplicate.id,
            duplicateMessage: `Possible duplicate: ${duplicate.company} - ${duplicate.role}`,
          }
        : {}),
    });
  },
);

router.post(
  "/import-url/preview",
  validateBody(jobImportUrlSchema),
  async (req, res) => {
    const { url } = req.body as z.infer<typeof jobImportUrlSchema>;
    const html = await fetchHtmlWithGuard(url);
    const extracted = extractJobFromHtml(html, url);
    const duplicate = await findDuplicateJob({
      userId: req.user!.sub,
      company: extracted.company,
      role: extracted.role,
      jobUrl: url,
      location: extracted.location,
    });
    return sendSuccess(res, {
      url,
      company: extracted.company,
      role: extracted.role,
      location: extracted.location,
      jobDescription: extracted.description.slice(0, 2000),
      confidence: extracted.confidence,
      signals: extracted.signals,
      duplicate: duplicate
        ? {
            id: duplicate.id,
            company: duplicate.company,
            role: duplicate.role,
            location: duplicate.location,
          }
        : null,
    });
  },
);

router.post("/fit-score", validateBody(jobFitScoreSchema), async (req, res) => {
  const body = req.body as z.infer<typeof jobFitScoreSchema>;
  return sendSuccess(
    res,
    computeFitScore(body.resumeText, body.jobDescription),
  );
});

router.post("/ats-check", validateBody(atsCheckSchema), async (req, res) => {
  const body = req.body as z.infer<typeof atsCheckSchema>;
  return sendSuccess(res, runAtsChecks(body.resumeText, body.jobDescription));
});

router.get("/reminders", async (req, res) => {
  const jobs = await prisma.jobApplication.findMany({
    where: { userId: req.user!.sub },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return sendSuccess(res, computeApplicationReminders(jobs));
});

router.get("/groups", async (req, res) => {
  const jobs = await prisma.jobApplication.findMany({
    where: { userId: req.user!.sub },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const groups = new Map<
    string,
    {
      key: string;
      company: string;
      role: string;
      location: string | null;
      weekStart: string;
      count: number;
      jobIds: string[];
      statuses: string[];
    }
  >();
  for (const job of jobs) {
    const key = buildJobGroupKey({
      company: job.company,
      role: job.role,
      location: job.location,
      createdAt: job.createdAt,
    });
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.jobIds.push(job.id);
      if (!existing.statuses.includes(job.status))
        existing.statuses.push(job.status);
      continue;
    }
    groups.set(key, {
      key,
      company: job.company,
      role: job.role,
      location: job.location,
      weekStart: weekBucket(job.createdAt),
      count: 1,
      jobIds: [job.id],
      statuses: [job.status],
    });
  }
  return sendSuccess(
    res,
    [...groups.values()].sort(
      (a, b) => b.count - a.count || b.weekStart.localeCompare(a.weekStart),
    ),
  );
});

router.post("/:id/follow-up-5-days", async (req, res) => {
  const jobId = firstString(req.params.id);
  if (!jobId) {
    throw new ApiError(400, "INVALID_JOB_ID", "Invalid job id");
  }
  const existing = await prisma.jobApplication.findUnique({
    where: { id: jobId },
  });
  if (!existing || existing.userId !== req.user!.sub) {
    throw new ApiError(404, "JOB_NOT_FOUND", "Job application not found");
  }
  const followUpAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const updated = await prisma.jobApplication.update({
    where: { id: jobId },
    data: { followUpAt },
  });
  await logTimelineEvent({
    userId: req.user!.sub,
    jobId,
    eventType: "REMINDER",
    message: "Follow-up reminder scheduled for 5 days.",
    payload: { followUpAt: followUpAt.toISOString() },
  });
  return sendSuccess(res, updated);
});

router.get("/:id/follow-up-template", async (req, res) => {
  const jobId = firstString(req.params.id);
  if (!jobId) {
    throw new ApiError(400, "INVALID_JOB_ID", "Invalid job id");
  }
  const job = await prisma.jobApplication.findUnique({ where: { id: jobId } });
  if (!job || job.userId !== req.user!.sub) {
    throw new ApiError(404, "JOB_NOT_FOUND", "Job application not found");
  }
  const template = `Subject: Follow-up on ${job.role} application\n\nHi ${job.company} team,\n\nI wanted to follow up on my application for the ${job.role} role. I am very interested in the opportunity and would love to share any additional information that could be helpful.\n\nThank you for your time and consideration.\n\nBest,\n[Your Name]`;
  await logTimelineEvent({
    userId: req.user!.sub,
    jobId,
    eventType: "EMAIL",
    message: "Follow-up email template generated.",
  });
  return sendSuccess(res, {
    subject: `Follow-up on ${job.role} application`,
    body: template,
  });
});

router.get("/", validateQuery(jobQuerySchema), async (req, res) => {
  const q = res.locals.validatedQuery as JobListQuery;
  const { page, pageSize } = q;
  const where = buildJobWhere(req.user!.sub, q);

  const [items, total] = await Promise.all([
    prisma.jobApplication.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.jobApplication.count({ where }),
  ]);

  return sendSuccess(res, items, 200, { page, pageSize, total });
});

router.post("/", validateBody(jobCreateSchema), async (req, res) => {
  const b = req.body as z.infer<typeof jobCreateSchema>;
  const duplicate = await findDuplicateJob({
    userId: req.user!.sub,
    company: b.company,
    role: b.role,
    jobUrl: b.jobUrl,
    location: b.location,
  });
  const created = await prisma.jobApplication.create({
    data: {
      userId: req.user!.sub,
      company: sanitizeText(b.company),
      role: sanitizeText(b.role),
      status: b.status,
      starred: b.starred ?? false,
      ...(b.jobUrl !== undefined ? { jobUrl: sanitizeText(b.jobUrl) } : {}),
      ...(b.jobDescription !== undefined
        ? {
            jobDescription: b.jobDescription
              ? sanitizeText(b.jobDescription)
              : null,
          }
        : {}),
      ...(b.source !== undefined ? { source: sanitizeText(b.source) } : {}),
      ...(b.location !== undefined
        ? { location: b.location ? sanitizeText(b.location) : null }
        : {}),
      ...(b.salaryRange !== undefined
        ? { salaryRange: b.salaryRange ? sanitizeText(b.salaryRange) : null }
        : {}),
      ...(b.notes !== undefined
        ? { notes: b.notes ? sanitizeText(b.notes) : null }
        : {}),
      ...(b.followUpAt !== undefined ? { followUpAt: b.followUpAt } : {}),
    },
  });
  await logTimelineEvent({
    userId: req.user!.sub,
    jobId: created.id,
    eventType: "CREATED",
    message: "Application created.",
  });
  return sendSuccess(res, created, 201, {
    duplicateDetected: Boolean(duplicate),
    groupingKey: buildJobGroupKey({
      company: created.company,
      role: created.role,
      location: created.location,
      createdAt: created.createdAt,
    }),
    ...(duplicate
      ? {
          duplicateJobId: duplicate.id,
          duplicateMessage: `Possible duplicate: ${duplicate.company} - ${duplicate.role}`,
        }
      : {}),
  });
});

router.patch("/:id", validateBody(jobPatchSchema), async (req, res) => {
  const jobId = firstString(req.params.id);
  if (!jobId) {
    throw new ApiError(400, "INVALID_JOB_ID", "Invalid job id");
  }
  const existing = await prisma.jobApplication.findUnique({
    where: { id: jobId },
  });
  if (!existing || existing.userId !== req.user!.sub) {
    throw new ApiError(404, "JOB_NOT_FOUND", "Job application not found");
  }

  const b = req.body as z.infer<typeof jobPatchSchema>;
  const timelineEvents: Array<Promise<unknown>> = [];
  if (b.status && b.status !== existing.status) {
    timelineEvents.push(
      logTimelineEvent({
        userId: req.user!.sub,
        jobId: existing.id,
        eventType: "STATUS_CHANGE",
        message: `Status changed from ${existing.status} to ${b.status}.`,
      }),
    );
  }
  if (b.notes !== undefined && (b.notes ?? "") !== (existing.notes ?? "")) {
    timelineEvents.push(
      logTimelineEvent({
        userId: req.user!.sub,
        jobId: existing.id,
        eventType: "NOTE",
        message: "Application note updated.",
      }),
    );
  }
  const updated = await prisma.jobApplication.update({
    where: { id: jobId },
    data: {
      ...(b.company !== undefined ? { company: sanitizeText(b.company) } : {}),
      ...(b.role !== undefined ? { role: sanitizeText(b.role) } : {}),
      ...(b.jobUrl !== undefined
        ? { jobUrl: b.jobUrl ? sanitizeText(b.jobUrl) : null }
        : {}),
      ...(b.jobDescription !== undefined
        ? {
            jobDescription: b.jobDescription
              ? sanitizeText(b.jobDescription)
              : null,
          }
        : {}),
      ...(b.source !== undefined
        ? { source: b.source ? sanitizeText(b.source) : null }
        : {}),
      ...(b.location !== undefined
        ? { location: b.location ? sanitizeText(b.location) : null }
        : {}),
      ...(b.salaryRange !== undefined
        ? { salaryRange: b.salaryRange ? sanitizeText(b.salaryRange) : null }
        : {}),
      ...(b.status !== undefined ? { status: b.status } : {}),
      ...(b.notes !== undefined
        ? { notes: b.notes ? sanitizeText(b.notes) : null }
        : {}),
      ...(b.starred !== undefined ? { starred: b.starred } : {}),
      ...(b.followUpAt !== undefined ? { followUpAt: b.followUpAt } : {}),
    },
  });
  await Promise.all(timelineEvents);
  return sendSuccess(res, updated);
});

router.delete("/:id", async (req, res) => {
  const jobId = firstString(req.params.id);
  if (!jobId) {
    throw new ApiError(400, "INVALID_JOB_ID", "Invalid job id");
  }
  const existing = await prisma.jobApplication.findUnique({
    where: { id: jobId },
  });
  if (!existing || existing.userId !== req.user!.sub) {
    throw new ApiError(404, "JOB_NOT_FOUND", "Job application not found");
  }
  await logTimelineEvent({
    userId: req.user!.sub,
    jobId,
    eventType: "DELETED",
    message: `Application deleted: ${existing.company} - ${existing.role}.`,
  });
  await prisma.jobApplication.delete({ where: { id: jobId } });
  return sendSuccess(res, { deleted: true });
});

router.get("/timeline/audit", async (req, res) => {
  const userId = req.user!.sub;
  const [events, generations] = await Promise.all([
    prisma.jobTimelineEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 80,
      include: { job: { select: { id: true, company: true, role: true } } },
    }),
    prisma.aiGeneration.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, type: true, createdAt: true },
    }),
  ]);

  const merged = [
    ...events.map((event) => ({
      id: event.id,
      at: event.createdAt.toISOString(),
      eventType: event.eventType,
      message: event.message,
      job: event.job,
      source: "timeline",
    })),
    ...generations.map((generation) => ({
      id: generation.id,
      at: generation.createdAt.toISOString(),
      eventType: "AI_GENERATION",
      message: `AI generation created: ${generation.type}`,
      source: "ai",
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 100);

  return sendSuccess(res, merged);
});

router.post("/:id/company-research", async (req, res) => {
  const jobId = firstString(req.params.id);
  if (!jobId) {
    throw new ApiError(400, "INVALID_JOB_ID", "Invalid job id");
  }
  const job = await prisma.jobApplication.findUnique({ where: { id: jobId } });
  if (!job || job.userId !== req.user!.sub) {
    throw new ApiError(404, "JOB_NOT_FOUND", "Job application not found");
  }
  const contextText = [
    job.jobDescription ?? "",
    job.notes ?? "",
    job.role,
    job.jobUrl ?? "",
  ].join(" ");
  const research = buildCompanyResearch({
    company: job.company,
    role: job.role,
    contextText,
  });

  const upserted = await prisma.companyInsight.upsert({
    where: {
      userId_normalizedCompany: {
        userId: req.user!.sub,
        normalizedCompany: research.normalizedCompany,
      },
    },
    create: {
      userId: req.user!.sub,
      companyName: research.companyName,
      normalizedCompany: research.normalizedCompany,
      industry: research.industry,
      companySize: research.companySize,
      fundingStage: research.fundingStage,
      techStack: research.techStack,
      recentNews: research.recentNews as never,
      commonInterviewQuestions: research.commonInterviewQuestions,
    },
    update: {
      companyName: research.companyName,
      industry: research.industry,
      companySize: research.companySize,
      fundingStage: research.fundingStage,
      techStack: research.techStack,
      recentNews: research.recentNews as never,
      commonInterviewQuestions: research.commonInterviewQuestions,
      lastRefreshedAt: new Date(),
    },
  });
  return sendSuccess(res, upserted);
});

router.get("/:id/timeline", async (req, res) => {
  const jobId = firstString(req.params.id);
  if (!jobId) {
    throw new ApiError(400, "INVALID_JOB_ID", "Invalid job id");
  }
  const job = await prisma.jobApplication.findUnique({ where: { id: jobId } });
  if (!job || job.userId !== req.user!.sub) {
    throw new ApiError(404, "JOB_NOT_FOUND", "Job application not found");
  }
  const events = await prisma.jobTimelineEvent.findMany({
    where: { userId: req.user!.sub, jobId },
    orderBy: { createdAt: "desc" },
    take: 80,
  });
  return sendSuccess(res, events);
});

router.post(
  "/:id/timeline",
  validateBody(timelineEventCreateSchema),
  async (req, res) => {
    const jobId = firstString(req.params.id);
    if (!jobId) {
      throw new ApiError(400, "INVALID_JOB_ID", "Invalid job id");
    }
    const job = await prisma.jobApplication.findUnique({
      where: { id: jobId },
    });
    if (!job || job.userId !== req.user!.sub) {
      throw new ApiError(404, "JOB_NOT_FOUND", "Job application not found");
    }
    const body = req.body as z.infer<typeof timelineEventCreateSchema>;
    const event = await prisma.jobTimelineEvent.create({
      data: {
        userId: req.user!.sub,
        jobId,
        eventType: body.eventType,
        message: sanitizeText(body.message),
        payloadJson: (body.payload ?? {}) as never,
      },
    });
    return sendSuccess(res, event, 201);
  },
);

router.get("/metrics/summary", async (req, res) => {
  const [total, grouped, jobs, resumeGenerations] = await Promise.all([
    prisma.jobApplication.count({ where: { userId: req.user!.sub } }),
    prisma.jobApplication.groupBy({
      by: ["status"],
      where: { userId: req.user!.sub },
      _count: { _all: true },
    }),
    prisma.jobApplication.findMany({
      where: { userId: req.user!.sub },
      orderBy: { createdAt: "asc" },
      take: 500,
      select: { id: true, status: true, createdAt: true, updatedAt: true },
    }),
    prisma.aiGeneration.findMany({
      where: { userId: req.user!.sub, type: "RESUME_TAILOR" },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, version: true, outputJson: true, createdAt: true },
    }),
  ]);

  const countByStatus = grouped.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});
  const interviewRate =
    total > 0 ? ((countByStatus.INTERVIEW ?? 0) / total) * 100 : 0;
  const offerRate = total > 0 ? ((countByStatus.OFFER ?? 0) / total) * 100 : 0;
  const appliedCount = countByStatus.APPLIED ?? 0;
  const interviewCount = countByStatus.INTERVIEW ?? 0;
  const offerCount = countByStatus.OFFER ?? 0;
  const applicationToInterviewRate =
    appliedCount > 0 ? (interviewCount / appliedCount) * 100 : 0;
  const interviewToOfferRate =
    interviewCount > 0 ? (offerCount / interviewCount) * 100 : 0;

  const resumeVersionPerf = resumeGenerations
    .map((generation) => {
      const output =
        generation.outputJson && typeof generation.outputJson === "object"
          ? (generation.outputJson as { matchScore?: number })
          : null;
      return {
        id: generation.id,
        version: generation.version,
        createdAt: generation.createdAt.toISOString(),
        matchScore:
          typeof output?.matchScore === "number" ? output.matchScore : null,
      };
    })
    .filter((row) => row.matchScore !== null)
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));

  return sendSuccess(res, {
    totalApplications: total,
    stageDistribution: countByStatus,
    interviewRate: Number(interviewRate.toFixed(2)),
    offerRate: Number(offerRate.toFixed(2)),
    conversion: {
      applicationToInterviewRate: Number(applicationToInterviewRate.toFixed(2)),
      interviewToOfferRate: Number(interviewToOfferRate.toFixed(2)),
    },
    resumeVersionPerformance: resumeVersionPerf.slice(0, 5),
    averageCycleDays:
      jobs.length === 0
        ? 0
        : Number(
            (
              jobs.reduce(
                (sum, job) =>
                  sum +
                  (job.updatedAt.getTime() - job.createdAt.getTime()) /
                    (1000 * 60 * 60 * 24),
                0,
              ) / jobs.length
            ).toFixed(1),
          ),
  });
});

export const jobsRouter = router;
