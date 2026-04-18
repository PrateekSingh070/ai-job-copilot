-- AlterTable
ALTER TABLE "CompanyInsight"
ADD COLUMN "commonInterviewQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "CompanyInsight"
SET "commonInterviewQuestions" = ARRAY[]::TEXT[]
WHERE "commonInterviewQuestions" IS NULL;

ALTER TABLE "CompanyInsight"
ALTER COLUMN "commonInterviewQuestions" SET NOT NULL;
