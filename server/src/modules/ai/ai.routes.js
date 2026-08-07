import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  aiChatSchema,
  aiCoverLetterSchema,
  aiImportJobSchema,
  aiResumeTailorSchema,
  aiSkillGapSchema,
} from "../../shared/index.js";
import { requireAuth, validateBody } from "../../middleware/index.js";
import { sendError, sendSuccess } from "../../utils/http.js";
import {
  extractJobFromPage,
  generateChatAnswer,
  generateCoverLetter,
  generateResumeTailor,
  generateSkillGap,
} from "./ai.service.js";
import { resolveResumeText } from "./resumeContext.js";
import { reindexUserJobs, searchSimilarJobs } from "./ragIndex.js";
import { fetchJobPage } from "../scraper/urlFetcher.js";
import { parseJobPage } from "../scraper/htmlToText.js";
import { env } from "../../config/env.js";

const router = Router();

router.use(requireAuth);

// AI calls cost money and time, so they get a tighter per-IP limit than the
// rest of the API.
router.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: env.AI_RATE_LIMIT_PER_MINUTE,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) =>
      sendError(
        res,
        429,
        "AI_RATE_LIMITED",
        "AI request limit reached. Please wait before trying again.",
        { limitPerMinute: env.AI_RATE_LIMIT_PER_MINUTE, path: req.path },
      ),
  }),
);

// POST /ai/resume-tailor — rewrite resume bullets for a specific job.
router.post(
  "/resume-tailor",
  validateBody(aiResumeTailorSchema),
  async (req, res) => {
    const result = await generateResumeTailor(req.body);
    return sendSuccess(
      res,
      { output: result.output, model: result.model },
      201,
    );
  },
);

// POST /ai/cover-letter — write a cover letter from resume + JD.
router.post(
  "/cover-letter",
  validateBody(aiCoverLetterSchema),
  async (req, res) => {
    const resumeText = await resolveResumeText(
      req.user.sub,
      req.body.resumeText,
    );
    const result = await generateCoverLetter({ ...req.body, resumeText });
    return sendSuccess(
      res,
      { output: result.output, model: result.model },
      201,
    );
  },
);

// POST /ai/skill-gap — rank what the resume is missing against a job description.
router.post("/skill-gap", validateBody(aiSkillGapSchema), async (req, res) => {
  const resumeText = await resolveResumeText(req.user.sub, req.body.resumeText);
  const result = await generateSkillGap({ ...req.body, resumeText });
  return sendSuccess(res, { output: result.output, model: result.model }, 201);
});

// Import does an outbound network fetch *on top of* an LLM call, so it gets a
// tighter budget than the rest of the AI routes. It's also the endpoint an
// attacker would use to probe our network, and a low ceiling limits how much
// they can learn per window.
const importLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 4,
  standardHeaders: true,
  legacyHeaders: false,
  // Disabled in tests so suites stay independent, matching
  // `authCredentialsLimiter` in middleware/index.js. A 4/min ceiling would
  // otherwise make test order significant.
  skip: () => env.NODE_ENV === "test",
  handler: (req, res) =>
    sendError(
      res,
      429,
      "AI_RATE_LIMITED",
      "Import limit reached. Please wait before trying again.",
      { limitPerMinute: 4, path: req.path },
    ),
});

/**
 * POST /ai/import-job — read a posting from a URL (or pasted text) and return
 * structured fields.
 *
 * Deliberately does **not** create the job. The user reviews and edits the
 * extraction in the form before saving, which keeps a wrong guess from silently
 * becoming a row and keeps this endpoint read-only from the database's view.
 */
router.post(
  "/import-job",
  importLimiter,
  validateBody(aiImportJobSchema),
  async (req, res) => {
    const page = req.body.url
      ? await fetchJobPage(req.body.url).then(({ html, finalUrl }) => ({
          ...parseJobPage(html),
          sourceUrl: finalUrl,
        }))
      : { title: "", heading: "", text: req.body.rawText, sourceUrl: undefined };

    const result = await extractJobFromPage(page);

    return sendSuccess(
      res,
      {
        output: {
          ...result.output,
          // Echo the URL back so the client can prefill jobUrl without having
          // to remember what it submitted.
          ...(page.sourceUrl ? { jobUrl: page.sourceUrl } : {}),
        },
        model: result.model,
      },
      201,
    );
  },
);

/**
 * POST /ai/chat — answer a question about the caller's own applications.
 *
 * Retrieval is scoped to `req.user.sub` inside `searchSimilarJobs`; the client
 * never supplies a user id, so there is no way to ask about someone else's
 * pipeline.
 */
router.post("/chat", validateBody(aiChatSchema), async (req, res) => {
  const retrieved = await searchSimilarJobs(req.user.sub, req.body.message);
  const result = await generateChatAnswer({
    message: req.body.message,
    history: req.body.history,
    retrieved,
  });

  return sendSuccess(
    res,
    {
      output: result.output,
      model: result.model,
      // Surfacing the retrieval count separately makes an empty pipeline
      // distinguishable from a model that simply had nothing to say.
      retrievedCount: retrieved.length,
    },
    201,
  );
});

/**
 * POST /ai/reindex — rebuild embeddings for the caller's jobs.
 *
 * Needed for rows created before this feature existed (including seeded demo
 * data) and as a manual repair when an embedding write failed silently during
 * a job save.
 */
router.post("/reindex", async (req, res) => {
  const summary = await reindexUserJobs(req.user.sub);
  return sendSuccess(res, summary);
});

export const aiRouter = router;
