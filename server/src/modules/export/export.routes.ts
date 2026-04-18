import { Router } from "express";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../utils/ApiError.js";
import { sanitizeText } from "../../utils/sanitize.js";

const router = Router();
router.use(requireAuth);

function toSafeFileToken(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "company";
}

const exportEventSchema = z.object({
  eventType: z.enum(["EXPORT_RESUME_HTML_DOWNLOAD", "EXPORT_RESUME_HTML_PDF"]),
  message: z.string().min(3).max(500),
  payload: z
    .record(z.string(), z.unknown())
    .optional()
    .refine(
      (value) => !value || Object.keys(value).length <= 20,
      "payload too large",
    ),
});

router.post("/events", validateBody(exportEventSchema), async (req, res) => {
  const { eventType, message, payload } = req.body as z.infer<
    typeof exportEventSchema
  >;
  const safeEventType = sanitizeText(eventType).slice(0, 80);
  const safeMessage = sanitizeText(message).slice(0, 500);
  if (!safeEventType || safeMessage.length < 3) {
    throw new ApiError(
      400,
      "EXPORT_EVENT_INVALID",
      "Invalid export event payload",
    );
  }
  const event = await prisma.jobTimelineEvent.create({
    data: {
      userId: req.user!.sub,
      eventType: safeEventType,
      message: safeMessage,
      payloadJson: (payload ?? {}) as never,
    },
  });
  return res.status(201).json({ success: true, data: event });
});

router.post("/pdf", async (req, res) => {
  const { title, content } = req.body as { title: string; content: string };

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=output.pdf");

  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);
  doc
    .fontSize(18)
    .text(title || "AI Job Application Copilot Export", { underline: true });
  doc.moveDown();
  doc.fontSize(11).text(content || "", { align: "left" });
  doc.end();
});

router.post("/application-packet/:jobId", async (req, res) => {
  const { jobId } = req.params;
  const [job, latestResume, latestCover] = await Promise.all([
    prisma.jobApplication.findUnique({ where: { id: jobId } }),
    prisma.aiGeneration.findFirst({
      where: { userId: req.user!.sub, type: "RESUME_TAILOR" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.aiGeneration.findFirst({
      where: { userId: req.user!.sub, type: "COVER_LETTER" },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  if (!job || job.userId !== req.user!.sub) {
    throw new ApiError(404, "JOB_NOT_FOUND", "Job application not found");
  }

  const resumeContent =
    latestResume?.outputJson && typeof latestResume.outputJson === "object"
      ? JSON.stringify(latestResume.outputJson, null, 2)
      : "No resume version generated yet.";
  const coverContent =
    latestCover?.outputJson && typeof latestCover.outputJson === "object"
      ? JSON.stringify(latestCover.outputJson, null, 2)
      : "No cover letter generated yet.";

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=application-packet-${toSafeFileToken(job.company)}.pdf`,
  );

  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);
  doc.fontSize(18).text("Application Packet", { underline: true });
  doc.moveDown(0.6);
  doc.fontSize(11).text(`Company: ${job.company}`);
  doc.text(`Role: ${job.role}`);
  doc.text(`Status: ${job.status}`);
  doc.text(`Location: ${job.location ?? "N/A"}`);
  doc.text(`Job URL: ${job.jobUrl ?? "N/A"}`);
  doc.text(`Updated: ${job.updatedAt.toISOString()}`);
  doc.moveDown();
  doc.fontSize(13).text("Resume Version", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10).text(resumeContent, { align: "left" });
  doc.moveDown();
  doc.fontSize(13).text("Cover Letter", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10).text(coverContent, { align: "left" });
  doc.moveDown();
  doc.fontSize(13).text("Notes", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10).text(job.notes ?? "No notes added.", { align: "left" });
  doc.end();
});

export const exportRouter = router;
