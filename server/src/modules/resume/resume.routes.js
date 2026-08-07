import { Router } from "express";
import { resumeUpsertSchema } from "../../shared/index.js";
import { prisma } from "../../db/prisma.js";
import { requireAuth, validateBody } from "../../middleware/index.js";
import { sendSuccess } from "../../utils/http.js";
import { sanitizeText } from "../../utils/sanitize.js";

const router = Router();
router.use(requireAuth);

// GET /resume — returns the user's saved resume or null if none exists.
router.get("/", async (req, res) => {
  const resume = await prisma.resume.findUnique({
    where: { userId: req.user.sub },
  });
  return sendSuccess(res, resume);
});

// PUT /resume — upsert: creates or updates the user's resume.
router.put("/", validateBody(resumeUpsertSchema), async (req, res) => {
  const data = {
    content: sanitizeText(req.body.content),
    ...(req.body.title ? { title: sanitizeText(req.body.title) } : {}),
  };

  const resume = await prisma.resume.upsert({
    where: { userId: req.user.sub },
    create: { userId: req.user.sub, ...data },
    update: data,
  });

  return sendSuccess(res, resume);
});

// DELETE /resume — removes the saved resume.
router.delete("/", async (req, res) => {
  await prisma.resume.deleteMany({ where: { userId: req.user.sub } });
  return sendSuccess(res, { deleted: true });
});

export const resumeRouter = router;
