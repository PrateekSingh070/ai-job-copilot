import { Router } from "express";
import { isIP } from "node:net";
import dns from "node:dns/promises";
import {
  atsCheckSchema,
  jobCreateSchema,
  jobDiscoveryQuerySchema,
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

function firstString(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

// Load a job by id, making sure it exists and belongs to the caller.
// Throws 400 for a malformed id and 404 when the job is missing or owned by
// someone else — the same 404 in both cases so we don't leak which jobs exist.
async function loadOwnedJob(userId, rawId) {
  const jobId = firstString(rawId);
  if (!jobId) {
    throw new ApiError(400, "INVALID_JOB_ID", "Invalid job id");
  }
  const job = await prisma.jobApplication.findUnique({ where: { id: jobId } });
  if (!job || job.userId !== userId) {
    throw new ApiError(404, "JOB_NOT_FOUND", "Job application not found");
  }
  return job;
}

function buildJobWhere(userId, filters) {
  return {
    userId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.company
      ? { company: { contains: filters.company, mode: "insensitive" } }
      : {}),
    ...(filters.starred === "true"
      ? { starred: true }
      : filters.starred === "false"
        ? { starred: false }
        : {}),
    ...(filters.startDate || filters.endDate
      ? {
          createdAt: {
            ...(filters.startDate ? { gte: filters.startDate } : {}),
            ...(filters.endDate ? { lte: endOfDay(filters.endDate) } : {}),
          },
        }
      : {}),
  };
}

function csvEscape(value) {
  const neutralized = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(neutralized))
    return `"${neutralized.replace(/"/g, '""')}"`;
  return neutralized;
}

function normalizeRole(role) {
  return role.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeLocation(location) {
  return (location ?? "remote").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function weekBucket(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function buildJobGroupKey(input) {
  return `${normalizeCompany(input.company)}::${normalizeRole(input.role)}::${normalizeLocation(
    input.location,
  )}::${weekBucket(input.createdAt)}`;
}

async function findDuplicateJob(input) {
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

async function logTimelineEvent(input) {
  await prisma.jobTimelineEvent.create({
    data: {
      userId: input.userId,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      eventType: input.eventType,
      message: sanitizeText(input.message),
      payloadJson: input.payload ?? {},
    },
  });
}

function isPrivateHost(hostname) {
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

function assertSafeImportUrl(url) {
  let parsed;
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

async function assertResolvedHostIsPublic(hostname) {
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

async function fetchHtmlWithGuard(url) {
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
    const filters = res.locals.validatedQuery;
    const where = buildJobWhere(req.user.sub, filters);
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
  const userId = req.user.sub;
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

  const items = [
    ...jobRows.map((j) => ({
      kind: "job",
      id: j.id,
      at: j.updatedAt.toISOString(),
      title: `${j.company} — ${j.role}`,
      subtitle: `Status → ${j.status}`,
    })),
    ...genRows.map((g) => ({
      kind: "ai",
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
    const filters = res.locals.validatedQuery;
    const userId = req.user.sub;
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
      limit: filters.limit,
      internshipsOnly: filters.internshipsOnly === "true",
      remoteOnly: filters.remoteOnly === "true",
    });

    return sendSuccess(res, discovery);
  },
);

router.post(
  "/import-url",
  validateBody(jobImportUrlSchema),
  async (req, res) => {
    const { url, overrides } = req.body;
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
      userId: req.user.sub,
      company: draft.company,
      role: draft.role,
      jobUrl: url,
      location: draft.location,
    });
    const created = await prisma.jobApplication.create({
      data: {
        userId: req.user.sub,
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
      userId: req.user.sub,
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
    const { url } = req.body;
    const html = await fetchHtmlWithGuard(url);
    const extracted = extractJobFromHtml(html, url);
    const duplicate = await findDuplicateJob({
      userId: req.user.sub,
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
  const body = req.body;
  return sendSuccess(
    res,
    computeFitScore(body.resumeText, body.jobDescription),
  );
});

router.post("/ats-check", validateBody(atsCheckSchema), async (req, res) => {
  const body = req.body;
  return sendSuccess(res, runAtsChecks(body.resumeText, body.jobDescription));
});

router.get("/reminders", async (req, res) => {
  const jobs = await prisma.jobApplication.findMany({
    where: { userId: req.user.sub },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return sendSuccess(res, computeApplicationReminders(jobs));
});

router.get("/groups", async (req, res) => {
  const jobs = await prisma.jobApplication.findMany({
    where: { userId: req.user.sub },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const groups = new Map();
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
  const job = await loadOwnedJob(req.user.sub, req.params.id);
  const followUpAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const updated = await prisma.jobApplication.update({
    where: { id: job.id },
    data: { followUpAt },
  });
  await logTimelineEvent({
    userId: req.user.sub,
    jobId: job.id,
    eventType: "REMINDER",
    message: "Follow-up reminder scheduled for 5 days.",
    payload: { followUpAt: followUpAt.toISOString() },
  });
  return sendSuccess(res, updated);
});

router.get("/:id/follow-up-template", async (req, res) => {
  const job = await loadOwnedJob(req.user.sub, req.params.id);
  const template = `Subject: Follow-up on ${job.role} application\n\nHi ${job.company} team,\n\nI wanted to follow up on my application for the ${job.role} role. I am very interested in the opportunity and would love to share any additional information that could be helpful.\n\nThank you for your time and consideration.\n\nBest,\n[Your Name]`;
  await logTimelineEvent({
    userId: req.user.sub,
    jobId: job.id,
    eventType: "EMAIL",
    message: "Follow-up email template generated.",
  });
  return sendSuccess(res, {
    subject: `Follow-up on ${job.role} application`,
    body: template,
  });
});

router.get("/", validateQuery(jobQuerySchema), async (req, res) => {
  const filters = res.locals.validatedQuery;
  const { page, pageSize } = filters;
  const where = buildJobWhere(req.user.sub, filters);

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
  const body = req.body;
  const duplicate = await findDuplicateJob({
    userId: req.user.sub,
    company: body.company,
    role: body.role,
    jobUrl: body.jobUrl,
    location: body.location,
  });
  const created = await prisma.jobApplication.create({
    data: {
      userId: req.user.sub,
      company: sanitizeText(body.company),
      role: sanitizeText(body.role),
      status: body.status,
      starred: body.starred ?? false,
      ...(body.jobUrl !== undefined
        ? { jobUrl: sanitizeText(body.jobUrl) }
        : {}),
      ...(body.jobDescription !== undefined
        ? {
            jobDescription: body.jobDescription
              ? sanitizeText(body.jobDescription)
              : null,
          }
        : {}),
      ...(body.source !== undefined
        ? { source: sanitizeText(body.source) }
        : {}),
      ...(body.location !== undefined
        ? { location: body.location ? sanitizeText(body.location) : null }
        : {}),
      ...(body.salaryRange !== undefined
        ? {
            salaryRange: body.salaryRange
              ? sanitizeText(body.salaryRange)
              : null,
          }
        : {}),
      ...(body.notes !== undefined
        ? { notes: body.notes ? sanitizeText(body.notes) : null }
        : {}),
      ...(body.followUpAt !== undefined
        ? { followUpAt: body.followUpAt }
        : {}),
    },
  });
  await logTimelineEvent({
    userId: req.user.sub,
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
  const existing = await loadOwnedJob(req.user.sub, req.params.id);

  const body = req.body;
  // Record timeline entries for the changes worth auditing (status + notes),
  // but write them after the update succeeds.
  const timelineEvents = [];
  if (body.status && body.status !== existing.status) {
    timelineEvents.push(
      logTimelineEvent({
        userId: req.user.sub,
        jobId: existing.id,
        eventType: "STATUS_CHANGE",
        message: `Status changed from ${existing.status} to ${body.status}.`,
      }),
    );
  }
  if (
    body.notes !== undefined &&
    (body.notes ?? "") !== (existing.notes ?? "")
  ) {
    timelineEvents.push(
      logTimelineEvent({
        userId: req.user.sub,
        jobId: existing.id,
        eventType: "NOTE",
        message: "Application note updated.",
      }),
    );
  }
  const updated = await prisma.jobApplication.update({
    where: { id: existing.id },
    data: {
      ...(body.company !== undefined
        ? { company: sanitizeText(body.company) }
        : {}),
      ...(body.role !== undefined ? { role: sanitizeText(body.role) } : {}),
      ...(body.jobUrl !== undefined
        ? { jobUrl: body.jobUrl ? sanitizeText(body.jobUrl) : null }
        : {}),
      ...(body.jobDescription !== undefined
        ? {
            jobDescription: body.jobDescription
              ? sanitizeText(body.jobDescription)
              : null,
          }
        : {}),
      ...(body.source !== undefined
        ? { source: body.source ? sanitizeText(body.source) : null }
        : {}),
      ...(body.location !== undefined
        ? { location: body.location ? sanitizeText(body.location) : null }
        : {}),
      ...(body.salaryRange !== undefined
        ? {
            salaryRange: body.salaryRange
              ? sanitizeText(body.salaryRange)
              : null,
          }
        : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.notes !== undefined
        ? { notes: body.notes ? sanitizeText(body.notes) : null }
        : {}),
      ...(body.starred !== undefined ? { starred: body.starred } : {}),
      ...(body.followUpAt !== undefined
        ? { followUpAt: body.followUpAt }
        : {}),
    },
  });
  await Promise.all(timelineEvents);
  return sendSuccess(res, updated);
});

router.delete("/:id", async (req, res) => {
  const existing = await loadOwnedJob(req.user.sub, req.params.id);
  await logTimelineEvent({
    userId: req.user.sub,
    jobId: existing.id,
    eventType: "DELETED",
    message: `Application deleted: ${existing.company} - ${existing.role}.`,
  });
  await prisma.jobApplication.delete({ where: { id: existing.id } });
  return sendSuccess(res, { deleted: true });
});

router.get("/timeline/audit", async (req, res) => {
  const userId = req.user.sub;
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
  const job = await loadOwnedJob(req.user.sub, req.params.id);
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
        userId: req.user.sub,
        normalizedCompany: research.normalizedCompany,
      },
    },
    create: {
      userId: req.user.sub,
      companyName: research.companyName,
      normalizedCompany: research.normalizedCompany,
      industry: research.industry,
      companySize: research.companySize,
      fundingStage: research.fundingStage,
      techStack: research.techStack,
      recentNews: research.recentNews,
      commonInterviewQuestions: research.commonInterviewQuestions,
    },
    update: {
      companyName: research.companyName,
      industry: research.industry,
      companySize: research.companySize,
      fundingStage: research.fundingStage,
      techStack: research.techStack,
      recentNews: research.recentNews,
      commonInterviewQuestions: research.commonInterviewQuestions,
      lastRefreshedAt: new Date(),
    },
  });
  return sendSuccess(res, upserted);
});

router.get("/:id/timeline", async (req, res) => {
  const job = await loadOwnedJob(req.user.sub, req.params.id);
  const events = await prisma.jobTimelineEvent.findMany({
    where: { userId: req.user.sub, jobId: job.id },
    orderBy: { createdAt: "desc" },
    take: 80,
  });
  return sendSuccess(res, events);
});

router.post(
  "/:id/timeline",
  validateBody(timelineEventCreateSchema),
  async (req, res) => {
    const job = await loadOwnedJob(req.user.sub, req.params.id);
    const body = req.body;
    const event = await prisma.jobTimelineEvent.create({
      data: {
        userId: req.user.sub,
        jobId: job.id,
        eventType: body.eventType,
        message: sanitizeText(body.message),
        payloadJson: body.payload ?? {},
      },
    });
    return sendSuccess(res, event, 201);
  },
);

router.get("/metrics/summary", async (req, res) => {
  const [total, grouped, jobs, resumeGenerations] = await Promise.all([
    prisma.jobApplication.count({ where: { userId: req.user.sub } }),
    prisma.jobApplication.groupBy({
      by: ["status"],
      where: { userId: req.user.sub },
      _count: { _all: true },
    }),
    prisma.jobApplication.findMany({
      where: { userId: req.user.sub },
      orderBy: { createdAt: "asc" },
      take: 500,
      select: { id: true, status: true, createdAt: true, updatedAt: true },
    }),
    prisma.aiGeneration.findMany({
      where: { userId: req.user.sub, type: "RESUME_TAILOR" },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, version: true, outputJson: true, createdAt: true },
    }),
  ]);

  const countByStatus = grouped.reduce((acc, row) => {
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
          ? generation.outputJson
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
