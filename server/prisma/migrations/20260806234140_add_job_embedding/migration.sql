-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "JobEmbedding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobEmbedding_jobId_key" ON "JobEmbedding"("jobId");

-- CreateIndex
CREATE INDEX "JobEmbedding_userId_idx" ON "JobEmbedding"("userId");

-- AddForeignKey
ALTER TABLE "JobEmbedding" ADD CONSTRAINT "JobEmbedding_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Approximate-nearest-neighbour index for cosine distance (`<=>`).
-- Prisma cannot express ivfflat, so it is appended by hand.
-- Note: ivfflat only accelerates queries once the table has data — an empty or
-- tiny table falls back to an exact scan, which is correct, just not indexed.
CREATE INDEX IF NOT EXISTS "JobEmbedding_embedding_idx"
  ON "JobEmbedding" USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);
