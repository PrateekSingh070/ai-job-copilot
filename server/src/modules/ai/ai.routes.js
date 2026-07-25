import { Router } from "express";
import rateLimit from "express-rate-limit";
import { aiResumeTailorSchema } from "../../shared/index.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { sendError, sendSuccess } from "../../utils/response.js";
import { generateResumeTailor } from "./ai.service.js";
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

export const aiRouter = router;
