import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  aiCoverLetterSchema,
  aiInterviewPrepSchema,
  aiResumeHtmlSchema,
  aiResumeTailorSchema,
  aiStructuredResumeTailorSchema,
  mockInterviewAnswerSchema,
  mockInterviewStartSchema,
} from "../../shared/index.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { sendSuccess } from "../../utils/response.js";
import {
  generateCoverLetter,
  generateCoverLetterWithRag,
  generateInterviewPrep,
  generateResumeHtml,
  generateResumeTailor,
  generateStructuredResumeTailor,
  getMockInterviewSummary,
  getAiProviderStatus,
  saveGeneration,
  startMockInterviewSession,
  submitMockInterviewAnswer,
} from "./ai.service.js";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { sendError } from "../../utils/response.js";

const router = Router();

router.use(requireAuth);
router.get("/provider-status", (_req, res) => {
  return sendSuccess(res, getAiProviderStatus());
});

router.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: env.AI_RATE_LIMIT_PER_MINUTE,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      const retryAfter = res.getHeader("Retry-After");
      return sendError(
        res,
        429,
        "AI_RATE_LIMITED",
        "AI request limit reached. Please wait before trying again.",
        {
          limitPerMinute: env.AI_RATE_LIMIT_PER_MINUTE,
          retryAfterSeconds:
            typeof retryAfter === "string" ? Number(retryAfter) : undefined,
          path: req.path,
        },
      );
    },
  }),
);

router.post(
  "/resume-tailor",
  validateBody(aiResumeTailorSchema),
  async (req, res) => {
    const result = await generateResumeTailor(req.body);
    const saved = await saveGeneration({
      userId: req.user!.sub,
      type: "RESUME_TAILOR",
      payloadIn: req.body,
      payloadOut: result.output,
      model: result.model,
      tokenUsage: result.tokenUsage,
      costUsd: result.costUsd,
    });
    return sendSuccess(
      res,
      { output: result.output, generationId: saved.id },
      201,
    );
  },
);

router.post(
  "/resume-tailor-structured",
  validateBody(aiStructuredResumeTailorSchema),
  async (req, res) => {
    const result = await generateStructuredResumeTailor(req.body);
    const saved = await saveGeneration({
      userId: req.user!.sub,
      type: "RESUME_TAILOR",
      payloadIn: req.body,
      payloadOut: result.output,
      model: result.model,
      tokenUsage: result.tokenUsage,
      costUsd: result.costUsd,
    });
    return sendSuccess(
      res,
      { output: result.output, generationId: saved.id },
      201,
    );
  },
);

router.post(
  "/resume-html",
  validateBody(aiResumeHtmlSchema),
  async (req, res) => {
    const result = await generateResumeHtml(req.body);
    const saved = await saveGeneration({
      userId: req.user!.sub,
      type: "RESUME_TAILOR",
      payloadIn: req.body,
      payloadOut: result.output,
      model: result.model,
      tokenUsage: result.tokenUsage,
      costUsd: result.costUsd,
    });
    return sendSuccess(
      res,
      { output: result.output, generationId: saved.id },
      201,
    );
  },
);

router.post(
  "/cover-letter",
  validateBody(aiCoverLetterSchema),
  async (req, res) => {
    const result = await generateCoverLetter(req.body);
    const saved = await saveGeneration({
      userId: req.user!.sub,
      type: "COVER_LETTER",
      payloadIn: req.body,
      payloadOut: result.output,
      model: result.model,
      tokenUsage: result.tokenUsage,
      costUsd: result.costUsd,
    });
    return sendSuccess(
      res,
      { output: result.output, generationId: saved.id },
      201,
    );
  },
);

router.post(
  "/cover-letter-rag",
  validateBody(aiCoverLetterSchema),
  async (req, res) => {
    const result = await generateCoverLetterWithRag({
      ...req.body,
      userId: req.user!.sub,
    });
    const saved = await saveGeneration({
      userId: req.user!.sub,
      type: "COVER_LETTER",
      payloadIn: { ...req.body, rag: true },
      payloadOut: result.output,
      model: result.model,
      tokenUsage: result.tokenUsage,
      costUsd: result.costUsd,
    });
    return sendSuccess(
      res,
      { output: result.output, generationId: saved.id },
      201,
    );
  },
);

router.post(
  "/interview-prep",
  validateBody(aiInterviewPrepSchema),
  async (req, res) => {
    const result = await generateInterviewPrep(req.body);
    const saved = await saveGeneration({
      userId: req.user!.sub,
      type: "INTERVIEW_PREP",
      payloadIn: req.body,
      payloadOut: result.output,
      model: result.model,
      tokenUsage: result.tokenUsage,
      costUsd: result.costUsd,
    });
    return sendSuccess(
      res,
      { output: result.output, generationId: saved.id },
      201,
    );
  },
);

router.post(
  "/mock-interview/start",
  validateBody(mockInterviewStartSchema),
  async (req, res) => {
    const session = startMockInterviewSession({
      userId: req.user!.sub,
      ...req.body,
    });
    await saveGeneration({
      userId: req.user!.sub,
      type: "INTERVIEW_PREP",
      payloadIn: req.body,
      payloadOut: { sessionId: session.id, questions: session.questions },
      model: "mock-interview-engine",
    });
    return sendSuccess(
      res,
      {
        sessionId: session.id,
        createdAt: session.createdAt,
        targetRole: session.targetRole,
        questions: session.questions,
      },
      201,
    );
  },
);

router.post(
  "/mock-interview/:sessionId/answer",
  validateBody(mockInterviewAnswerSchema),
  async (req, res) => {
    const result = submitMockInterviewAnswer({
      userId: req.user!.sub,
      sessionId: req.params.sessionId,
      ...req.body,
    });
    return sendSuccess(res, result, 201);
  },
);

router.get("/mock-interview/:sessionId/summary", async (req, res) => {
  const summary = getMockInterviewSummary({
    userId: req.user!.sub,
    sessionId: req.params.sessionId,
  });
  return sendSuccess(res, summary);
});

router.get("/history", async (req, res) => {
  const items = await prisma.aiGeneration.findMany({
    where: { userId: req.user!.sub },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return sendSuccess(res, items);
});

router.post("/history/:id/restore", async (req, res) => {
  const current = await prisma.aiGeneration.findUnique({
    where: { id: req.params.id },
  });
  if (!current || current.userId !== req.user!.sub) {
    return res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Generation not found" },
    });
  }
  const restored = await saveGeneration({
    userId: req.user!.sub,
    type: current.type,
    payloadIn: current.inputJson,
    payloadOut: current.outputJson,
    model: current.model,
    tokenUsage: current.tokenUsage ?? undefined,
    costUsd: current.costUsd ? Number(current.costUsd) : undefined,
  });
  return sendSuccess(res, restored, 201);
});

export const aiRouter = router;
