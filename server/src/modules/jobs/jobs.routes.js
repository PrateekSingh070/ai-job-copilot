import { Router } from "express";
import {
  jobCreateSchema,
  jobPatchSchema,
  jobQuerySchema,
} from "../../shared/index.js";
import { prisma } from "../../db/prisma.js";
import {
  requireAuth,
  validateBody,
  validateQuery,
} from "../../middleware/index.js";
import { ApiError, sendSuccess } from "../../utils/http.js";
import { sanitizeText } from "../../utils/sanitize.js";
import { indexJobSafely } from "../ai/ragIndex.js";

const router = Router();
// Every job route needs a logged-in user; `req.user.sub` is the owner id.
router.use(requireAuth);

// Load a job by id, making sure it exists and belongs to the caller.
// Missing and not-owned both return 404 so we don't leak which jobs exist.
async function loadOwnedJob(userId, jobId) {
  if (typeof jobId !== "string" || jobId.length === 0) {
    throw new ApiError(400, "INVALID_JOB_ID", "Invalid job id");
  }
  const job = await prisma.jobApplication.findUnique({ where: { id: jobId } });
  if (!job || job.userId !== userId) {
    throw new ApiError(404, "JOB_NOT_FOUND", "Job application not found");
  }
  return job;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

// Translate validated query filters into a Prisma `where` clause.
// userId is always included so a user only ever sees their own rows.
function buildJobWhere(userId, filters) {
  return {
    userId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.company
      ? { company: { contains: filters.company, mode: "insensitive" } }
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

// Only copy fields the client actually sent, and strip HTML from free text.
function buildJobData(body) {
  const data = {};
  if (body.company !== undefined) data.company = sanitizeText(body.company);
  if (body.role !== undefined) data.role = sanitizeText(body.role);
  if (body.status !== undefined) data.status = body.status;
  for (const field of [
    "jobUrl",
    "jobDescription",
    "location",
    "salaryRange",
    "notes",
  ]) {
    if (body[field] !== undefined) {
      data[field] = body[field] ? sanitizeText(body[field]) : null;
    }
  }
  return data;
}

// GET /jobs — filtered, paginated list of the caller's applications.
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

// POST /jobs — create an application owned by the caller.
router.post("/", validateBody(jobCreateSchema), async (req, res) => {
  const created = await prisma.jobApplication.create({
    data: { userId: req.user.sub, ...buildJobData(req.body) },
  });

  // Fire-and-forget: the embedding is derived data, so a provider outage must
  // not turn "save my application" into a failed request. `indexJobSafely`
  // swallows and logs, and `POST /ai/reindex` can always rebuild what's missed.
  void indexJobSafely(created);

  return sendSuccess(res, created, 201);
});

// PATCH /jobs/:id — partial update of an owned application.
router.patch("/:id", validateBody(jobPatchSchema), async (req, res) => {
  const existing = await loadOwnedJob(req.user.sub, req.params.id);
  const updated = await prisma.jobApplication.update({
    where: { id: existing.id },
    data: buildJobData(req.body),
  });

  // Re-index on edit. A status-only change (the Kanban drag) produces the same
  // document hash, so `indexJob` skips the embedding call rather than paying
  // for one on every card move.
  void indexJobSafely(updated);

  return sendSuccess(res, updated);
});

// DELETE /jobs/:id — delete an owned application.
router.delete("/:id", async (req, res) => {
  const existing = await loadOwnedJob(req.user.sub, req.params.id);
  await prisma.jobApplication.delete({ where: { id: existing.id } });
  return sendSuccess(res, { deleted: true });
});

// GET /jobs/metrics/summary — dashboard numbers for the caller.
router.get("/metrics/summary", async (req, res) => {
  const where = { userId: req.user.sub };
  const [total, grouped] = await Promise.all([
    prisma.jobApplication.count({ where }),
    prisma.jobApplication.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
  ]);

  // { APPLIED: 3, INTERVIEW: 1, ... }
  const stageDistribution = grouped.reduce((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});

  const rate = (count) =>
    total > 0 ? Number(((count / total) * 100).toFixed(2)) : 0;

  return sendSuccess(res, {
    totalApplications: total,
    stageDistribution,
    interviewRate: rate(stageDistribution.INTERVIEW ?? 0),
    offerRate: rate(stageDistribution.OFFER ?? 0),
  });
});

export const jobsRouter = router;
