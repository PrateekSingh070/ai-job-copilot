import { z } from "zod";
import { ApiError } from "../../utils/http.js";
import { env } from "../../config/env.js";
import { sanitizeForAiPrompt } from "../../utils/sanitize.js";
import {
  extractFirstJsonObject,
  parseKeywords,
  scoreMatch,
} from "./aiTextUtils.js";

// Shape we require back from the model. Anything else is rejected, so callers
// always get the same output whether it came from a provider or the mock.
const resumeTailorOutputSchema = z.object({
  rewrittenBullets: z.array(z.string().min(8)).min(3).max(8),
  extractedKeywords: z.array(z.string().min(2)).min(5).max(20),
  matchScore: z.number().int().min(0).max(100),
  explanation: z.string().min(15),
});

function clampText(input) {
  return sanitizeForAiPrompt(input, env.AI_MAX_INPUT_CHARS);
}

// Providers return JSON as text, sometimes wrapped in prose or a code fence,
// so pull out the first JSON object and validate it against the schema.
function parseProviderJson(text, outputSchema) {
  return outputSchema.parse(JSON.parse(extractFirstJsonObject(text)));
}

async function callOpenAiJson(params) {
  if (!env.OPENAI_API_KEY) {
    throw new ApiError(400, "OPENAI_KEY_MISSING", "OPENAI_API_KEY is required");
  }

  const model = env.OPENAI_MODEL ?? "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: params.maxTokens,
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new ApiError(
      502,
      "OPENAI_API_ERROR",
      "OpenAI request failed",
      await response.text(),
    );
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  return {
    output: parseProviderJson(text, params.outputSchema),
    model,
  };
}

async function callAnthropicJson(params) {
  if (!env.ANTHROPIC_API_KEY) {
    throw new ApiError(
      400,
      "ANTHROPIC_KEY_MISSING",
      "ANTHROPIC_API_KEY is required",
    );
  }

  const model = env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: params.maxTokens,
      system: params.systemPrompt,
      messages: [{ role: "user", content: params.userPrompt }],
    }),
  });

  if (!response.ok) {
    throw new ApiError(
      502,
      "ANTHROPIC_API_ERROR",
      "Anthropic request failed",
      await response.text(),
    );
  }

  const data = await response.json();
  // Anthropic returns an array of content blocks; keep only the text blocks.
  const text =
    data.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n") ?? "";
  return {
    output: parseProviderJson(text, params.outputSchema),
    model,
  };
}

/** Picks the provider from AI_PROVIDER. `mock` never reaches this function. */
async function callProviderJson(params) {
  if (env.AI_PROVIDER === "openai") return callOpenAiJson(params);
  return callAnthropicJson(params);
}

// Deterministic offline version of the feature: pull keywords out of the job
// description, score the resume against them, and reuse existing bullets.
// This keeps the demo (and the tests) working with no API key.
function mockResumeTailor(input) {
  const keywords = parseKeywords(input.jobDescription);
  const { score, explanation } = scoreMatch(input.resumeText, keywords);
  const baseBullets = input.resumeText
    .split("\n")
    .filter((line) => line.trim().startsWith("-"))
    .slice(0, 6);
  const rewrittenBullets =
    baseBullets.length > 0
      ? baseBullets.map(
          (bullet) =>
            `${bullet.replace(/^-+\s*/, "")} (tailored for ${input.targetRole})`,
        )
      : [
          `Built features aligned with ${input.targetRole} requirements and improved user workflows.`,
          "Collaborated across teams to ship reliable product improvements quickly.",
          "Wrote maintainable code with tests and clear API contracts.",
        ];
  return {
    rewrittenBullets,
    extractedKeywords: keywords,
    matchScore: score,
    explanation,
  };
}

export async function generateResumeTailor(input) {
  // Free text goes into a prompt, so strip HTML/control chars and cap length.
  const safeInput = {
    resumeText: clampText(input.resumeText),
    jobDescription: clampText(input.jobDescription),
    targetRole: sanitizeForAiPrompt(input.targetRole, 200),
  };

  if (env.AI_PROVIDER === "mock") {
    return { output: mockResumeTailor(safeInput), model: "mock" };
  }

  const systemPrompt =
    "You are an expert resume strategist for early-career software candidates. " +
    "Return ONLY valid JSON with no markdown, no extra keys, and no prose before/after JSON.";
  const userPrompt = `
Task: Tailor this resume to the target role and job description.

Target role: ${safeInput.targetRole}
Tone: ${input.tone}

Resume text:
${safeInput.resumeText}

Job description:
${safeInput.jobDescription}

Output JSON shape:
{
  "rewrittenBullets": ["4 to 8 sharp impact-oriented bullets"],
  "extractedKeywords": ["5 to 20 role-relevant ATS keywords"],
  "matchScore": 0-100 integer,
  "explanation": "2-3 sentence rationale for score and biggest improvements"
}
`.trim();

  return callProviderJson({
    systemPrompt,
    userPrompt,
    outputSchema: resumeTailorOutputSchema,
    maxTokens: env.AI_MAX_OUTPUT_TOKENS_RESUME,
  });
}
