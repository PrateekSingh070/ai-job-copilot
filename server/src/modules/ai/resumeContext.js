import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../utils/http.js";

/**
 * Every AI feature takes an optional `resumeText`. When the client omits it,
 * fall back to the resume saved on the user's profile — that's the whole point
 * of storing one, so you don't paste the same text into three different tabs.
 *
 * Explicit text always wins: a user tweaking a resume for one specific
 * application shouldn't have to overwrite their saved copy to try it.
 */
export async function resolveResumeText(userId, providedText) {
  if (typeof providedText === "string" && providedText.trim().length > 0) {
    return providedText;
  }

  const saved = await prisma.resume.findUnique({ where: { userId } });
  if (!saved?.content) {
    throw new ApiError(
      400,
      "RESUME_REQUIRED",
      "Save a resume on your profile or include resumeText in the request.",
    );
  }

  return saved.content;
}
