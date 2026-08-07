import crypto from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { generateEmbedding } from "./embeddings.service.js";

// Storage and retrieval for the RAG chat. Kept separate from ai.service.js
// because this is the only module that touches raw SQL — Prisma cannot bind
// `Unsupported("vector(1536)")` through the normal client, so both the write
// and the search have to drop down to `$executeRaw` / `$queryRaw`.

/**
 * Flatten a job row into the text that gets embedded.
 *
 * Field labels are included ("Company: Acme") rather than bare values because
 * the query side is natural language — "which roles are remote" retrieves far
 * better against "Location: Remote" than against a bare "Remote".
 */
export function buildJobDocument(job) {
  return [
    `Company: ${job.company}`,
    `Role: ${job.role}`,
    job.location ? `Location: ${job.location}` : null,
    job.salaryRange ? `Salary: ${job.salaryRange}` : null,
    `Status: ${job.status}`,
    job.jobDescription ? `Description: ${job.jobDescription}` : null,
    job.notes ? `Notes: ${job.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function hashDocument(document) {
  return crypto.createHash("sha256").update(document).digest("hex");
}

/** pgvector's text input format: `[0.1,0.2,...]`. */
function toVectorLiteral(embedding) {
  return `[${embedding.join(",")}]`;
}

/**
 * Embed one job and upsert its row.
 *
 * Skips the embedding call when the document text is unchanged — dragging a
 * card between Kanban columns rewrites `status`, and re-embedding on every
 * status change would triple the API bill for no retrieval benefit.
 */
export async function indexJob(job) {
  const content = buildJobDocument(job);
  const contentHash = hashDocument(content);

  const existing = await prisma.jobEmbedding.findUnique({
    where: { jobId: job.id },
    select: { contentHash: true },
  });
  if (existing?.contentHash === contentHash) {
    return { indexed: false, reason: "unchanged" };
  }

  const embedding = await generateEmbedding(content);
  const literal = toVectorLiteral(embedding);

  // ON CONFLICT rather than a Prisma upsert: the vector column can only be
  // written through raw SQL with an explicit ::vector cast.
  await prisma.$executeRaw`
    INSERT INTO "JobEmbedding" ("id", "userId", "jobId", "content", "contentHash", "embedding", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${job.userId}, ${job.id}, ${content}, ${contentHash}, ${literal}::vector, NOW())
    ON CONFLICT ("jobId") DO UPDATE SET
      "content"     = EXCLUDED."content",
      "contentHash" = EXCLUDED."contentHash",
      "embedding"   = EXCLUDED."embedding",
      "updatedAt"   = NOW()
  `;

  return { indexed: true };
}

/**
 * Index a job without letting a failure break the caller.
 *
 * Job writes call this. An embedding provider being down, rate-limited or slow
 * must never turn "save my application" into an error — the row is the user's
 * data, the embedding is a derived convenience that `POST /ai/reindex` can
 * always rebuild.
 */
export function indexJobSafely(job) {
  return indexJob(job).catch((error) => {
    console.error(`[rag] failed to index job ${job.id}:`, error.message);
    return { indexed: false, reason: "error" };
  });
}

/**
 * Cosine-nearest job documents for one user.
 *
 * `userId` in the WHERE clause is the entire tenant boundary here. Every other
 * read in the app goes through `buildJobWhere`, which injects it automatically;
 * raw SQL bypasses that, so this predicate is load-bearing and must never be
 * made conditional on caller input.
 */
export async function searchSimilarJobs(userId, queryText, limit = env.RAG_TOP_K) {
  const embedding = await generateEmbedding(queryText);
  const literal = toVectorLiteral(embedding);

  return prisma.$queryRaw`
    SELECT "jobId", "content", 1 - ("embedding" <=> ${literal}::vector) AS score
    FROM "JobEmbedding"
    WHERE "userId" = ${userId} AND "embedding" IS NOT NULL
    ORDER BY "embedding" <=> ${literal}::vector
    LIMIT ${limit}
  `;
}

/**
 * Backfill every job that has no embedding or a stale one. Needed for rows that
 * predate this feature, including the seeded demo data.
 */
export async function reindexUserJobs(userId) {
  const jobs = await prisma.jobApplication.findMany({ where: { userId } });

  let indexed = 0;
  let skipped = 0;
  for (const job of jobs) {
    // Sequential on purpose: a burst of parallel embedding calls is the fastest
    // way to hit a provider rate limit, and a backfill is not latency-critical.
    const result = await indexJobSafely(job);
    if (result.indexed) indexed += 1;
    else skipped += 1;
  }

  return { total: jobs.length, indexed, skipped };
}
