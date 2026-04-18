-- AlterTable
ALTER TABLE "JobApplication" ADD COLUMN "starred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "followUpAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "JobApplication_userId_starred_idx" ON "JobApplication"("userId", "starred");

-- CreateIndex
CREATE INDEX "JobApplication_followUpAt_idx" ON "JobApplication"("followUpAt");
