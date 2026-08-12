import { Router } from "express";
import { masterResumeSchema } from "../../shared/index.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { sendSuccess } from "../../utils/response.js";
import { replaceMasterResumeEmbeddings } from "./rag.service.js";

const router = Router();
router.use(requireAuth);

router.post("/master", validateBody(masterResumeSchema), async (req, res) => {
  const result = await replaceMasterResumeEmbeddings({
    userId: req.user!.sub,
    title: req.body.title,
    content: req.body.content,
  });
  return sendSuccess(res, result, 201);
});

export const resumesRouter = router;
