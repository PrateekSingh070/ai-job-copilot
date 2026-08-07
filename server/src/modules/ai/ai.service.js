import { z } from "zod";
import { ApiError } from "../../utils/http.js";
import { env } from "../../config/env.js";
import { sanitizeForAiPrompt } from "../../utils/sanitize.js";
import {
  extractFirstJsonObject,
  parseKeywords,
  scoreMatch,
} from "./aiTextUtils.js";
import { postJsonWithRetry } from "./aiFetch.js";

// Shape we require back from the model. Anything else is rejected, so callers
// always get the same output whether it came from a provider or the mock.
const resumeTailorOutputSchema = z.object({
  rewrittenBullets: z.array(z.string().min(8)).min(3).max(8),
  extractedKeywords: z.array(z.string().min(2)).min(5).max(20),
  matchScore: z.number().int().min(0).max(100),
  explanation: z.string().min(15),
});

const coverLetterOutputSchema = z.object({
  letterBody: z.array(z.string().min(20)).min(3).max(5),
  subjectLine: z.string().min(10).max(120),
  wordCount: z.number().int().min(50),
  keyPointsUsed: z.array(z.string().min(5)).min(2).max(6),
});

const skillGapOutputSchema = z.object({
  missingSkills: z
    .array(
      z.object({
        skill: z.string().min(2).max(80),
        importance: z.enum(["critical", "nice-to-have"]),
        whyItMatters: z.string().min(10).max(300),
        howToClose: z.string().min(10).max(300),
      }),
    )
    .min(0)
    .max(12),
  presentSkills: z.array(z.string().min(2).max(80)).min(0).max(20),
  overallReadiness: z.number().int().min(0).max(100),
});

const importJobOutputSchema = z.object({
  company: z.string().min(1).max(120),
  role: z.string().min(1).max(120),
  location: z.string().max(120).optional(),
  salaryRange: z.string().max(80).optional(),
  jobDescription: z.string().min(1).max(10000),
  confidence: z.number().int().min(0).max(100),
});

const chatOutputSchema = z.object({
  answer: z.string().min(1).max(4000),
  citedJobIds: z.array(z.string()).max(10).default([]),
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
  const data = await postJsonWithRetry({
    url: "https://api.openai.com/v1/chat/completions",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: {
      model,
      temperature: 0.4,
      max_tokens: params.maxTokens,
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
    },
    errorCode: "OPENAI_API_ERROR",
    label: "OpenAI",
  });

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
  const data = await postJsonWithRetry({
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: {
      model,
      max_tokens: params.maxTokens,
      system: params.systemPrompt,
      messages: [{ role: "user", content: params.userPrompt }],
    },
    errorCode: "ANTHROPIC_API_ERROR",
    label: "Anthropic",
  });

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

// Pull the resume's bullet lines, which read as achievements and make the
// best raw material for a letter's evidence paragraph.
function resumeBullets(resumeText) {
  return resumeText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-+\s*/, ""))
    .filter((line) => line.length > 0);
}

function mockCoverLetter(input) {
  const keywords = parseKeywords(input.jobDescription);
  const bullets = resumeBullets(input.resumeText);
  const greeting = input.hiringManager
    ? `Dear ${input.hiringManager},`
    : "Dear Hiring Team,";

  const evidence =
    bullets.length > 0
      ? `In recent work I ${bullets.slice(0, 2).join(", and I ")}. That experience maps directly onto what this role asks for.`
      : `My background lines up closely with the day-to-day of this role, particularly around ${keywords.slice(0, 3).join(", ")}.`;

  const letterBody = [
    `${greeting} I am writing to apply for the ${input.role} position at ${input.company}. The role stood out to me because it centres on ${keywords.slice(0, 3).join(", ")} — the areas where I have spent most of my time.`,
    evidence,
    `What draws me to ${input.company} specifically is the chance to work on problems at this scale, and to keep growing alongside people who care about the craft. I would welcome the opportunity to talk about where I could contribute first.`,
    `Thank you for your time and consideration. I look forward to hearing from you.`,
  ];

  return {
    letterBody,
    subjectLine: `Application for ${input.role} at ${input.company}`,
    wordCount: letterBody.join(" ").split(/\s+/).length,
    keyPointsUsed: keywords.slice(0, 5),
  };
}

export async function generateCoverLetter(input) {
  const safeInput = {
    resumeText: clampText(input.resumeText),
    jobDescription: clampText(input.jobDescription),
    company: sanitizeForAiPrompt(input.company, 120),
    role: sanitizeForAiPrompt(input.role, 120),
    hiringManager: input.hiringManager
      ? sanitizeForAiPrompt(input.hiringManager, 120)
      : undefined,
  };

  if (env.AI_PROVIDER === "mock") {
    return { output: mockCoverLetter(safeInput), model: "mock" };
  }

  const systemPrompt =
    "You are an expert cover letter writer for software candidates. Write letters that are " +
    "specific and evidence-led, never generic filler. " +
    "Return ONLY valid JSON with no markdown, no extra keys, and no prose before/after JSON.";
  const userPrompt = `
Task: Write a cover letter for this candidate and role.

Company: ${safeInput.company}
Role: ${safeInput.role}
Tone: ${input.tone}
${safeInput.hiringManager ? `Addressed to: ${safeInput.hiringManager}` : "Addressed to: the hiring team (no name known)"}

Candidate resume:
${safeInput.resumeText}

Job description:
${safeInput.jobDescription}

Output JSON shape:
{
  "letterBody": ["3 to 5 paragraphs; open with the greeting, close with a sign-off line"],
  "subjectLine": "email subject line for the application",
  "wordCount": integer total word count of letterBody,
  "keyPointsUsed": ["2 to 6 concrete resume points or keywords you drew on"]
}
`.trim();

  return callProviderJson({
    systemPrompt,
    userPrompt,
    outputSchema: coverLetterOutputSchema,
    maxTokens: env.AI_MAX_OUTPUT_TOKENS_LETTER,
  });
}

function mockSkillGap(input) {
  const keywords = parseKeywords(input.jobDescription);
  const resumeLower = input.resumeText.toLowerCase();

  const present = keywords.filter((kw) => resumeLower.includes(kw));
  const missing = keywords.filter((kw) => !resumeLower.includes(kw));

  const { score } = scoreMatch(input.resumeText, keywords);

  const missingSkills = missing.slice(0, 6).map((skill, i) => ({
    skill,
    importance: i < 2 ? "critical" : "nice-to-have",
    whyItMatters: `The role centers on ${skill}; most work will touch it.`,
    howToClose: `Build one small project demonstrating ${skill} applied to a real problem.`,
  }));

  return {
    missingSkills,
    presentSkills: present,
    overallReadiness: score,
  };
}

export async function generateSkillGap(input) {
  const safeInput = {
    resumeText: clampText(input.resumeText),
    jobDescription: clampText(input.jobDescription),
    targetRole: input.targetRole
      ? sanitizeForAiPrompt(input.targetRole, 120)
      : undefined,
  };

  if (env.AI_PROVIDER === "mock") {
    return { output: mockSkillGap(safeInput), model: "mock" };
  }

  const systemPrompt =
    "You are a career coach helping software candidates identify skill gaps. " +
    "Be specific and actionable. " +
    "Return ONLY valid JSON with no markdown, no extra keys, and no prose before/after JSON.";
  const userPrompt = `
Task: Analyze skill gaps between this candidate's resume and the job description.

${safeInput.targetRole ? `Target role: ${safeInput.targetRole}` : ""}

Candidate resume:
${safeInput.resumeText}

Job description:
${safeInput.jobDescription}

Output JSON shape:
{
  "missingSkills": [
    {
      "skill": "name of the skill",
      "importance": "critical" or "nice-to-have",
      "whyItMatters": "one sentence: why this skill matters for the role",
      "howToClose": "one sentence: specific action to build this skill"
    }
  ],
  "presentSkills": ["skills the candidate already has"],
  "overallReadiness": 0-100 integer score
}
`.trim();

  return callProviderJson({
    systemPrompt,
    userPrompt,
    outputSchema: skillGapOutputSchema,
    maxTokens: env.AI_MAX_OUTPUT_TOKENS_GAP,
  });
}

/**
 * Job page titles are overwhelmingly "Role — Company" or "Company: Role" with
 * one of a handful of separators. Splitting on those gets both fields right on
 * most real postings, which is what makes the offline mock genuinely useful
 * rather than a placeholder.
 */
function splitTitle(title) {
  const separators = [" — ", " – ", " - ", " | ", " @ ", ": ", " at "];
  for (const sep of separators) {
    const idx = title.indexOf(sep);
    if (idx > 0) {
      const left = title.slice(0, idx).trim();
      const right = title.slice(idx + sep.length).trim();
      // "Careers at Acme" / "Jobs | Acme" put the company second; a leading
      // boilerplate word is the tell.
      if (/^(careers?|jobs?|hiring|work)$/i.test(left)) {
        return { role: "", company: right };
      }
      return { role: left, company: right };
    }
  }
  return { role: title.trim(), company: "" };
}

const SALARY_PATTERN =
  /(?:[$£€₹]\s?[\d,]+(?:\.\d+)?\s?(?:k|K|lpa|LPA)?(?:\s?(?:-|–|to)\s?[$£€₹]?\s?[\d,]+(?:\.\d+)?\s?(?:k|K|lpa|LPA)?)?)/;

const LOCATION_PATTERN =
  /\b(remote(?:\s*[-–]\s*\w+)?|hybrid|on[- ]?site|work from home)\b/i;

function mockImportJob(input) {
  const fromTitle = splitTitle(input.title || input.heading || "");

  // The <h1> is usually the role on its own, so prefer it when the title split
  // produced nothing useful.
  const role = fromTitle.role || input.heading || "Unknown role";
  const company =
    fromTitle.company ||
    // Fall back to the registrable part of the hostname: careers.acme.com → acme
    (input.sourceUrl
      ? (new URL(input.sourceUrl).hostname.split(".").at(-2) ?? "")
      : "");

  const salaryMatch = input.text.match(SALARY_PATTERN);
  const locationMatch = input.text.match(LOCATION_PATTERN);

  // Confidence reflects how much we actually recovered — honest about the fact
  // that a heuristic parse of an unknown template is a guess.
  let confidence = 30;
  if (fromTitle.role) confidence += 25;
  if (fromTitle.company) confidence += 25;
  if (locationMatch) confidence += 10;
  if (salaryMatch) confidence += 10;

  return {
    company: company || "Unknown company",
    role,
    ...(locationMatch ? { location: locationMatch[0] } : {}),
    ...(salaryMatch ? { salaryRange: salaryMatch[0].trim() } : {}),
    jobDescription: input.text.slice(0, 10000) || "No description found.",
    confidence: Math.min(confidence, 100),
  };
}

export async function extractJobFromPage(input) {
  const safeInput = {
    title: sanitizeForAiPrompt(input.title ?? "", 200),
    heading: sanitizeForAiPrompt(input.heading ?? "", 200),
    text: clampText(input.text ?? ""),
    sourceUrl: input.sourceUrl,
  };

  if (env.AI_PROVIDER === "mock") {
    return { output: mockImportJob(safeInput), model: "mock" };
  }

  const systemPrompt =
    "You extract structured job posting data from scraped web page text. " +
    "Report only what the text supports — never invent a company name, salary or location. " +
    "Return ONLY valid JSON with no markdown, no extra keys, and no prose before/after JSON.";
  const userPrompt = `
Task: Extract the job posting details from this page.

${safeInput.sourceUrl ? `Source URL: ${safeInput.sourceUrl}` : ""}
Page title: ${safeInput.title}
Main heading: ${safeInput.heading}

Page text:
${safeInput.text}

Output JSON shape:
{
  "company": "hiring company name",
  "role": "job title",
  "location": "location if stated, omit the key otherwise",
  "salaryRange": "salary if stated, omit the key otherwise",
  "jobDescription": "the responsibilities and requirements, cleaned up",
  "confidence": 0-100 integer — how confident you are in company and role
}
`.trim();

  return callProviderJson({
    systemPrompt,
    userPrompt,
    outputSchema: importJobOutputSchema,
    maxTokens: env.AI_MAX_OUTPUT_TOKENS_IMPORT,
  });
}

/**
 * Offline chat: no model, just report what retrieval found.
 *
 * Deliberately extractive rather than fluent — it states the matches and their
 * scores instead of imitating prose. That keeps the mock honest about what it
 * is, and makes it obvious in a demo whether retrieval or generation is at
 * fault when an answer looks wrong.
 */
function mockChat(message, retrieved) {
  if (retrieved.length === 0) {
    return {
      answer:
        "I could not find anything in your tracked applications that matches that. " +
        "If you have just added jobs, run a reindex first.",
      citedJobIds: [],
    };
  }

  const lines = retrieved.map((row) => {
    const company = row.content.match(/^Company: (.*)$/m)?.[1] ?? "Unknown";
    const role = row.content.match(/^Role: (.*)$/m)?.[1] ?? "Unknown role";
    const status = row.content.match(/^Status: (.*)$/m)?.[1] ?? "";
    return `• ${role} at ${company}${status ? ` (${status})` : ""} — relevance ${(
      Number(row.score) * 100
    ).toFixed(0)}%`;
  });

  return {
    answer:
      `Your ${retrieved.length} most relevant application${retrieved.length === 1 ? "" : "s"} for "${message}":\n\n` +
      lines.join("\n"),
    citedJobIds: retrieved.map((row) => row.jobId),
  };
}

export async function generateChatAnswer({ message, history, retrieved }) {
  const safeMessage = sanitizeForAiPrompt(message, 2000);

  if (env.AI_PROVIDER === "mock") {
    return { output: mockChat(safeMessage, retrieved), model: "mock" };
  }

  // Retrieved text is user-controlled — much of it was scraped from a job page
  // by the import feature. It goes through the same prompt sanitizer as every
  // other free-text input rather than being trusted because it came from our
  // own database.
  const context = retrieved
    .map(
      (row, i) =>
        `[${i + 1}] jobId=${row.jobId}\n${sanitizeForAiPrompt(row.content, 1500)}`,
    )
    .join("\n\n---\n\n");

  const transcript = history
    .slice(-10)
    .map((turn) => `${turn.role}: ${sanitizeForAiPrompt(turn.content, 1000)}`)
    .join("\n");

  const systemPrompt =
    "You answer questions about the user's own job applications. " +
    "Use ONLY the numbered context blocks provided — if they do not contain the answer, say so plainly. " +
    "Never invent a company, role or jobId. Cite the jobId of every application you reference. " +
    "Return ONLY valid JSON with no markdown, no extra keys, and no prose before/after JSON.";

  const userPrompt = `
${transcript ? `Conversation so far:\n${transcript}\n` : ""}
Question: ${safeMessage}

Context — the user's tracked applications:
${context || "(no applications matched this question)"}

Output JSON shape:
{
  "answer": "a direct answer grounded in the context above",
  "citedJobIds": ["jobId values from the context you actually used"]
}
`.trim();

  const result = await callProviderJson({
    systemPrompt,
    userPrompt,
    outputSchema: chatOutputSchema,
    maxTokens: env.AI_MAX_OUTPUT_TOKENS_CHAT,
  });

  // Drop any id the model invented. A citation that doesn't correspond to a
  // retrieved row would render as a chip linking to a job that isn't there.
  const retrievedIds = new Set(retrieved.map((row) => row.jobId));
  return {
    ...result,
    output: {
      ...result.output,
      citedJobIds: result.output.citedJobIds.filter((id) =>
        retrievedIds.has(id),
      ),
    },
  };
}
