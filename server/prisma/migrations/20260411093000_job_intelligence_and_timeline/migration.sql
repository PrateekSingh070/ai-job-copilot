-- AlterTable
ALTER TABLE "JobApplication"
ADD COLUMN "jobDescription" TEXT,
ADD COLUMN "source" TEXT;

-- CreateTable
CREATE TABLE "JobTimelineEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "eventType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobTimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyInsight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "normalizedCompany" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "companySize" TEXT NOT NULL,
    "fundingStage" TEXT NOT NULL,
    "techStack" TEXT[],
    "recentNews" JSONB NOT NULL,
    "lastRefreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyInsight_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "JobTimelineEvent_userId_createdAt_idx" ON "JobTimelineEvent"("userId", "createdAt");
CREATE INDEX "JobTimelineEvent_jobId_createdAt_idx" ON "JobTimelineEvent"("jobId", "createdAt");
CREATE INDEX "CompanyInsight_userId_companyName_idx" ON "CompanyInsight"("userId", "companyName");
CREATE UNIQUE INDEX "CompanyInsight_userId_normalizedCompany_key" ON "CompanyInsight"("userId", "normalizedCompany");

-- FKs
ALTER TABLE "JobTimelineEvent"
ADD CONSTRAINT "JobTimelineEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobTimelineEvent"
ADD CONSTRAINT "JobTimelineEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CompanyInsight"
ADD CONSTRAINT "CompanyInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
