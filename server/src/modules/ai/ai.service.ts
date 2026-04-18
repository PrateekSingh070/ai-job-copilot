import type { AiGenerationType } from "@prisma/client";
import { z } from "zod";
import { nanoid } from "nanoid";
import sanitizeHtml from "sanitize-html";
import { ApiError } from "../../utils/ApiError.js";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { sanitizeForAiPrompt } from "../../utils/aiPromptSanitize.js";
import {
  extractFirstJsonObject,
  parseKeywords,
  scoreMatch,
} from "../../utils/aiTextUtils.js";
import { retrieveRelevantResumeContext } from "../resumes/rag.service.js";

type ResumeTailorOutput = {
  rewrittenBullets: string[];
  extractedKeywords: string[];
  matchScore: number;
  explanation: string;
};

type StructuredResumeTailorOutput = {
  summary: string;
  skills: string[];
  experience: Array<{
    company: string;
    role: string;
    updated_points: string[];
  }>;
  projects: Array<{
    name: string;
    updated_points: string[];
  }>;
  keyword_match: {
    added_keywords: string[];
    missing_keywords: string[];
  };
};

type ResumeHtmlOutput = {
  html: string;
};

type CoverLetterOutput = {
  content: string;
};

type InterviewPrepOutput = {
  questions: Array<{
    question: string;
    modelAnswer: string;
    followUpTip: string;
  }>;
};

type AiGenerateResult<T> = {
  output: T;
  model: string;
  tokenUsage?: number;
  costUsd?: number;
};

type MockInterviewSession = {
  id: string;
  userId: string;
  createdAt: string;
  targetRole: string;
  questions: string[];
  answers: Array<{
    questionIndex: number;
    answer: string;
    score: number;
    feedback: string;
  }>;
};

const mockInterviewSessions = new Map<string, MockInterviewSession>();
const MOCK_INTERVIEW_MAX_SESSIONS = 500;
const MOCK_INTERVIEW_TTL_MS = 1000 * 60 * 60 * 12;

function cleanupMockInterviewSessions() {
  const now = Date.now();
  for (const [id, session] of mockInterviewSessions.entries()) {
    const createdAt = new Date(session.createdAt).getTime();
    if (Number.isNaN(createdAt) || now - createdAt > MOCK_INTERVIEW_TTL_MS) {
      mockInterviewSessions.delete(id);
    }
  }
  if (mockInterviewSessions.size <= MOCK_INTERVIEW_MAX_SESSIONS) return;
  const byOldest = [...mockInterviewSessions.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  for (const session of byOldest.slice(
    0,
    mockInterviewSessions.size - MOCK_INTERVIEW_MAX_SESSIONS,
  )) {
    mockInterviewSessions.delete(session.id);
  }
}

export type AiProviderStatus = {
  provider: "mock" | "openai" | "anthropic";
  configured: boolean;
  status: "connected" | "key_missing" | "mock_mode";
  message: string;
};

const resumeTailorOutputSchema = z.object({
  rewrittenBullets: z.array(z.string().min(8)).min(3).max(8),
  extractedKeywords: z.array(z.string().min(2)).min(5).max(20),
  matchScore: z.number().int().min(0).max(100),
  explanation: z.string().min(15),
});

const structuredResumeTailorOutputSchema = z.object({
  summary: z.string().min(30).max(1200),
  skills: z.array(z.string().min(1)).min(3).max(60),
  experience: z
    .array(
      z.object({
        company: z.string().min(1),
        role: z.string().min(1),
        updated_points: z.array(z.string().min(8)).min(1).max(8),
      }),
    )
    .max(20),
  projects: z
    .array(
      z.object({
        name: z.string().min(1),
        updated_points: z.array(z.string().min(8)).min(1).max(8),
      }),
    )
    .max(20),
  keyword_match: z.object({
    added_keywords: z.array(z.string().min(1)).max(40),
    missing_keywords: z.array(z.string().min(1)).max(40),
  }),
});

const resumeHtmlOutputSchema = z.object({
  html: z.string().min(40).max(120000),
});

const coverLetterOutputSchema = z.object({
  content: z.string().min(120),
});

const interviewPrepOutputSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(8),
        modelAnswer: z.string().min(20),
        followUpTip: z.string().min(10),
      }),
    )
    .min(4)
    .max(10),
});

function clampText(input: string): string {
  return sanitizeForAiPrompt(input, env.AI_MAX_INPUT_CHARS);
}

export function getAiProviderStatus(): AiProviderStatus {
  if (env.AI_PROVIDER === "mock") {
    return {
      provider: "mock",
      configured: true,
      status: "mock_mode",
      message:
        "Mock mode active. Set AI_PROVIDER to openai or anthropic for real generation.",
    };
  }

  if (env.AI_PROVIDER === "openai") {
    const configured = Boolean(env.OPENAI_API_KEY);
    return {
      provider: "openai",
      configured,
      status: configured ? "connected" : "key_missing",
      message: configured
        ? "OpenAI connected"
        : "OpenAI key missing. Set OPENAI_API_KEY in .env and restart server.",
    };
  }

  const configured = Boolean(env.ANTHROPIC_API_KEY);
  return {
    provider: "anthropic",
    configured,
    status: configured ? "connected" : "key_missing",
    message: configured
      ? "Anthropic connected"
      : "Anthropic key missing. Set ANTHROPIC_API_KEY in .env and restart server.",
  };
}

async function callProviderJson<T>(params: {
  systemPrompt: string;
  userPrompt: string;
  outputSchema: z.ZodType<T>;
  maxTokens?: number;
}): Promise<AiGenerateResult<T>> {
  if (env.AI_PROVIDER === "mock") {
    throw new ApiError(
      400,
      "MOCK_PROVIDER_SELECTED",
      "AI_PROVIDER is set to mock",
    );
  }

  if (env.AI_PROVIDER === "openai") {
    if (!env.OPENAI_API_KEY) {
      throw new ApiError(
        400,
        "OPENAI_KEY_MISSING",
        "OPENAI_API_KEY is required",
      );
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
        max_tokens: params.maxTokens ?? 1000,
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

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    const parsed = params.outputSchema.parse(
      JSON.parse(extractFirstJsonObject(text)),
    );
    return {
      output: parsed,
      model,
      tokenUsage: data.usage?.total_tokens,
    };
  }

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
      max_tokens: params.maxTokens ?? 1200,
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

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const text =
    data.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n") ?? "";
  const parsed = params.outputSchema.parse(
    JSON.parse(extractFirstJsonObject(text)),
  );
  return {
    output: parsed,
    model,
    tokenUsage:
      (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
  };
}

function mockResumeTailor(input: {
  resumeText: string;
  jobDescription: string;
  targetRole: string;
}): ResumeTailorOutput {
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

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

function pickKeywords(jobDescription: string): string[] {
  return parseKeywords(jobDescription).slice(0, 15);
}

function mockStructuredResumeTailor(input: {
  resumeJson: Record<string, unknown>;
  jobDescription: string;
}): StructuredResumeTailorOutput {
  const profile = toObject(input.resumeJson);
  const skills = asStringArray(profile.skills);
  const keywordCandidates = pickKeywords(input.jobDescription);
  const addedKeywords = keywordCandidates.filter((kw) =>
    skills.some((skill) => skill.toLowerCase().includes(kw.toLowerCase())),
  );
  const missingKeywords = keywordCandidates
    .filter((kw) => !addedKeywords.includes(kw))
    .slice(0, 8);

  const experience = Array.isArray(profile.experience)
    ? profile.experience
    : [];
  const updatedExperience = experience
    .map((entry) => {
      const row = toObject(entry);
      const points = asStringArray(row.updated_points ?? row.points).slice(
        0,
        5,
      );
      return {
        company: typeof row.company === "string" ? row.company : "Company",
        role: typeof row.role === "string" ? row.role : "Role",
        updated_points:
          points.length > 0
            ? points
            : [
                "Built and optimized production features aligned with team goals and measurable outcomes.",
              ],
      };
    })
    .slice(0, 10);

  const projects = Array.isArray(profile.projects) ? profile.projects : [];
  const updatedProjects = projects
    .map((entry) => {
      const row = toObject(entry);
      const points = asStringArray(row.updated_points ?? row.points).slice(
        0,
        4,
      );
      return {
        name: typeof row.name === "string" ? row.name : "Project",
        updated_points:
          points.length > 0
            ? points
            : [
                "Designed and delivered project scope with clear ownership, quality checks, and outcomes.",
              ],
      };
    })
    .slice(0, 8);

  const summary =
    "Results-driven candidate with hands-on experience delivering production-ready features and improving system quality. " +
    "Demonstrates strong ownership, collaboration, and practical execution aligned with role requirements.";

  return {
    summary,
    skills: [...new Set([...skills, ...addedKeywords])].slice(0, 30),
    experience: updatedExperience,
    projects: updatedProjects,
    keyword_match: {
      added_keywords: addedKeywords,
      missing_keywords: missingKeywords,
    },
  };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeResumeHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: [
      "html",
      "head",
      "body",
      "meta",
      "title",
      "style",
      "h1",
      "h2",
      "h3",
      "section",
      "article",
      "p",
      "ul",
      "li",
      "strong",
      "em",
      "br",
    ],
    allowedAttributes: {
      meta: ["charset", "name", "content"],
    },
    allowVulnerableTags: false,
  });
}

function renderList(items: string[]): string {
  if (items.length === 0) return "";
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function mockResumeHtml(input: {
  resumeJson: Record<string, unknown>;
}): ResumeHtmlOutput {
  const data = mockStructuredResumeTailor({
    resumeJson: input.resumeJson,
    jobDescription: "",
  });
  const sections = [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    "<title>Resume</title>",
    "<style>body{font-family:Arial,sans-serif;line-height:1.4;margin:24px;color:#111}h1,h2{margin:0 0 8px}section{margin:16px 0}ul{margin:6px 0 0 20px;padding:0}li{margin:4px 0}</style>",
    "</head>",
    "<body>",
    "<h1>Professional Resume</h1>",
    "<section>",
    "<h2>Summary</h2>",
    `<p>${escapeHtml(data.summary)}</p>`,
    "</section>",
    "<section>",
    "<h2>Skills</h2>",
    renderList(data.skills),
    "</section>",
    "<section>",
    "<h2>Experience</h2>",
    data.experience
      .map(
        (item) =>
          `<article><h3>${escapeHtml(item.role)} - ${escapeHtml(item.company)}</h3>${renderList(item.updated_points)}</article>`,
      )
      .join(""),
    "</section>",
    "<section>",
    "<h2>Projects</h2>",
    data.projects
      .map(
        (item) =>
          `<article><h3>${escapeHtml(item.name)}</h3>${renderList(item.updated_points)}</article>`,
      )
      .join(""),
    "</section>",
    "</body>",
    "</html>",
  ];
  return { html: sections.join("") };
}

export async function generateResumeTailor(input: {
  resumeText: string;
  jobDescription: string;
  targetRole: string;
  tone: string;
}): Promise<AiGenerateResult<ResumeTailorOutput>> {
  const safeInput = {
    ...input,
    resumeText: clampText(input.resumeText),
    jobDescription: clampText(input.jobDescription),
  };

  if (env.AI_PROVIDER === "mock") {
    return { output: mockResumeTailor(safeInput), model: "mock" };
  }

  const systemPrompt =
    "You are an expert resume strategist for early-career software candidates. " +
    "Return ONLY valid JSON with no markdown, no extra keys, and no prose before/after JSON.";
  const safeRole = sanitizeForAiPrompt(input.targetRole, 200);
  const userPrompt = `
Task: Tailor this resume to the target role and job description.

Target role: ${safeRole}
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

  const result = await callProviderJson({
    systemPrompt,
    userPrompt,
    outputSchema: resumeTailorOutputSchema,
    maxTokens: env.AI_MAX_OUTPUT_TOKENS_RESUME,
  });
  return result;
}

export async function generateStructuredResumeTailor(input: {
  resumeJson: Record<string, unknown>;
  jobDescription: string;
}): Promise<AiGenerateResult<StructuredResumeTailorOutput>> {
  const safeResumeJson = sanitizeForAiPrompt(
    JSON.stringify(input.resumeJson),
    Math.max(1000, env.AI_MAX_INPUT_CHARS * 2),
  );
  const safeJobDescription = clampText(input.jobDescription);

  if (env.AI_PROVIDER === "mock") {
    return {
      output: mockStructuredResumeTailor({
        resumeJson: input.resumeJson,
        jobDescription: safeJobDescription,
      }),
      model: "mock",
    };
  }

  const systemPrompt = [
    "You are an expert resume optimization engine and ATS specialist.",
    "Transform the candidate resume into a tailored resume for the target role.",
    "Never hallucinate companies, roles, projects, metrics, or achievements.",
    "Only add keywords that are reasonably implied by the original experience.",
    "Use concise, achievement-focused 1-2 line bullets with strong action verbs.",
    "Return ONLY valid JSON with the exact schema requested.",
  ].join(" ");

  const userPrompt = `
Candidate Resume (structured JSON):
${safeResumeJson}

Job Description (raw text):
${safeJobDescription}

Return ONLY valid JSON in this exact structure:
{
  "summary": "2-3 line professional summary tailored to the job",
  "skills": ["updated", "skill", "list"],
  "experience": [
    {
      "company": "string",
      "role": "string",
      "updated_points": ["bullet 1", "bullet 2"]
    }
  ],
  "projects": [
    {
      "name": "string",
      "updated_points": ["bullet 1", "bullet 2"]
    }
  ],
  "keyword_match": {
    "added_keywords": ["list of important keywords added"],
    "missing_keywords": ["important keywords still missing"]
  }
}
`.trim();

  return callProviderJson({
    systemPrompt,
    userPrompt,
    outputSchema: structuredResumeTailorOutputSchema,
    maxTokens: env.AI_MAX_OUTPUT_TOKENS_RESUME * 2,
  });
}

export async function generateResumeHtml(input: {
  resumeJson: Record<string, unknown>;
}): Promise<AiGenerateResult<ResumeHtmlOutput>> {
  const safeResumeJson = sanitizeForAiPrompt(
    JSON.stringify(input.resumeJson),
    Math.max(1000, env.AI_MAX_INPUT_CHARS * 2),
  );

  if (env.AI_PROVIDER === "mock") {
    return {
      output: mockResumeHtml({ resumeJson: input.resumeJson }),
      model: "mock",
    };
  }

  const systemPrompt = [
    "You are a professional resume formatter.",
    "Convert structured resume JSON into clean ATS-friendly single-column semantic HTML.",
    "Use semantic tags like h1, h2, ul, li, article, section.",
    "Use minimal inline CSS only.",
    "Return ONLY valid JSON with key html and value as HTML string.",
  ].join(" ");

  const userPrompt = `
Structured resume JSON:
${safeResumeJson}

Return ONLY valid JSON in this exact shape:
{
  "html": "<!doctype html>..."
}
`.trim();

  const result = await callProviderJson({
    systemPrompt,
    userPrompt,
    outputSchema: resumeHtmlOutputSchema,
    maxTokens: env.AI_MAX_OUTPUT_TOKENS_COVER * 2,
  });
  const safeHtml = sanitizeResumeHtml(result.output.html);
  if (safeHtml.trim().length < 40) {
    throw new ApiError(
      502,
      "AI_HTML_INVALID",
      "Generated resume HTML was invalid after sanitization.",
    );
  }
  return {
    ...result,
    output: {
      html: safeHtml,
    },
  };
}

function mockCoverLetter(input: {
  profileContext: string;
  jobDescription: string;
}): CoverLetterOutput {
  const content = `Dear Hiring Manager,

I am excited to apply for this role. ${input.profileContext.slice(
    0,
    280,
  )} I am especially motivated by your requirements: ${input.jobDescription.slice(
    0,
    280,
  )}. I bring strong ownership, rapid learning, and product-focused execution.

Sincerely,
[Your Name]`;
  return {
    content,
  };
}

export async function generateCoverLetterWithRag(input: {
  userId: string;
  profileContext: string;
  jobDescription: string;
  tone: string;
  length: string;
}): Promise<AiGenerateResult<CoverLetterOutput>> {
  const rag = await retrieveRelevantResumeContext({
    userId: input.userId,
    query: input.jobDescription,
    topK: 6,
  });
  const merged =
    rag.trim().length > 0
      ? `Relevant experience (retrieved):\n${rag}\n\nAdditional candidate context:\n${input.profileContext}`
      : input.profileContext;
  return generateCoverLetter({
    profileContext: merged,
    jobDescription: input.jobDescription,
    tone: input.tone,
    length: input.length,
  });
}

export async function generateCoverLetter(input: {
  profileContext: string;
  jobDescription: string;
  tone: string;
  length: string;
}): Promise<AiGenerateResult<CoverLetterOutput>> {
  const safeInput = {
    ...input,
    profileContext: clampText(input.profileContext),
    jobDescription: clampText(input.jobDescription),
  };

  if (env.AI_PROVIDER === "mock") {
    return { output: mockCoverLetter(safeInput), model: "mock" };
  }

  const systemPrompt =
    "You are a senior hiring coach. Write tailored, authentic cover letters for software roles. " +
    "Return ONLY valid JSON with key: content.";
  const userPrompt = `
Write a ${input.length} ${input.tone} cover letter for this candidate.
Use specific details from candidate profile and job description.
Avoid generic filler, avoid fake claims, and maintain clear structure.

Candidate context:
${safeInput.profileContext}

Job description:
${safeInput.jobDescription}

Output JSON shape:
{
  "content": "full cover letter body in plain text"
}
`.trim();

  return callProviderJson({
    systemPrompt,
    userPrompt,
    outputSchema: coverLetterOutputSchema,
    maxTokens: env.AI_MAX_OUTPUT_TOKENS_COVER,
  });
}

export async function generateInterviewPrep(input: {
  jobDescription: string;
  candidateBackground: string;
}): Promise<AiGenerateResult<InterviewPrepOutput>> {
  const safeInput = {
    ...input,
    candidateBackground: clampText(input.candidateBackground),
    jobDescription: clampText(input.jobDescription),
  };

  if (env.AI_PROVIDER === "mock") {
    return {
      model: "mock",
      output: {
        questions: [
          {
            question: "Tell me about yourself and why this role fits now.",
            modelAnswer: `I am an early-career engineer with project experience in ${safeInput.candidateBackground.slice(
              0,
              120,
            )}. This role aligns with my strengths in full-stack delivery and continuous learning.`,
            followUpTip:
              "Use one quantified project outcome to increase credibility.",
          },
          {
            question: "How would you approach your first 30 days?",
            modelAnswer:
              "I would learn the codebase and product context, deliver one scoped feature with tests, and actively incorporate feedback from the team.",
            followUpTip: "Frame your plan by week 1, weeks 2-3, and week 4.",
          },
          {
            question: "How do you ensure API reliability?",
            modelAnswer:
              "I use validation, consistent error handling, test critical paths, and monitor failures through logs and metrics.",
            followUpTip:
              "Mention one concrete API bug you prevented with tests.",
          },
          {
            question: "Describe a challenge you solved in a project.",
            modelAnswer:
              "I resolved integration issues by isolating root causes, improving data contracts, and validating behavior with integration tests.",
            followUpTip: "Use STAR format and keep focus on your contribution.",
          },
        ],
      },
    };
  }

  const systemPrompt =
    "You are a technical interview coach for software engineering roles. " +
    "Return ONLY valid JSON with realistic interview prep for this exact role.";
  const userPrompt = `
Create interview prep from this job description and candidate background.
Include behavioral + technical + practical collaboration questions.
Answers should be strong but believable for an entry-level candidate.

Job description:
${safeInput.jobDescription}

Candidate background:
${safeInput.candidateBackground}

Output JSON shape:
{
  "questions": [
    {
      "question": "...",
      "modelAnswer": "...",
      "followUpTip": "..."
    }
  ]
}
`.trim();

  return callProviderJson({
    systemPrompt,
    userPrompt,
    outputSchema: interviewPrepOutputSchema,
    maxTokens: env.AI_MAX_OUTPUT_TOKENS_INTERVIEW,
  });
}

export async function saveGeneration(input: {
  userId: string;
  type: AiGenerationType;
  payloadIn: unknown;
  payloadOut: unknown;
  model: string;
  tokenUsage?: number;
  costUsd?: number;
}) {
  const latest = await prisma.aiGeneration.findFirst({
    where: { userId: input.userId, type: input.type },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const saved = await prisma.aiGeneration.create({
    data: {
      userId: input.userId,
      type: input.type,
      inputJson: input.payloadIn as never,
      outputJson: input.payloadOut as never,
      model: input.model,
      tokenUsage: input.tokenUsage,
      costUsd: input.costUsd,
      version: (latest?.version ?? 0) + 1,
    },
  });
  await prisma.jobTimelineEvent.create({
    data: {
      userId: input.userId,
      eventType: "AI_GENERATION",
      message: `AI generation saved (${input.type}).`,
      payloadJson: {
        generationId: saved.id,
        generationType: input.type,
      } as never,
    },
  });
  return saved;
}

export function startMockInterviewSession(input: {
  userId: string;
  jobDescription: string;
  candidateBackground: string;
  targetRole?: string;
}) {
  cleanupMockInterviewSessions();
  const keywords = parseKeywords(input.jobDescription).slice(0, 5);
  const session: MockInterviewSession = {
    id: nanoid(10),
    userId: input.userId,
    createdAt: new Date().toISOString(),
    targetRole: input.targetRole ?? "Software Engineer",
    questions: [
      `Walk me through your background and why you're a fit for this ${input.targetRole ?? "role"}.`,
      `Tell me about a project where you used ${keywords[0] ?? "core engineering skills"} to deliver impact.`,
      `How would you handle a production issue affecting users?`,
      `Describe how you collaborate with product and design during delivery.`,
      `What do you still need to improve for this role, and how are you addressing it?`,
    ],
    answers: [],
  };
  mockInterviewSessions.set(session.id, session);
  return session;
}

export function submitMockInterviewAnswer(input: {
  userId: string;
  sessionId: string;
  questionIndex: number;
  answer: string;
}) {
  cleanupMockInterviewSessions();
  const session = mockInterviewSessions.get(input.sessionId);
  if (!session || session.userId !== input.userId) {
    throw new ApiError(
      404,
      "MOCK_INTERVIEW_NOT_FOUND",
      "Mock interview session not found",
    );
  }
  if (
    input.questionIndex < 0 ||
    input.questionIndex >= session.questions.length
  ) {
    throw new ApiError(
      400,
      "MOCK_INTERVIEW_QUESTION_INVALID",
      "Invalid question index",
    );
  }
  const wordCount = input.answer.trim().split(/\s+/).filter(Boolean).length;
  const hasMetric = /\b\d+%|\b\d+\b/.test(input.answer);
  const hasStructure = /(^|\s)(first|second|finally|because|result)/i.test(
    input.answer,
  );
  const score = Math.max(
    40,
    Math.min(
      100,
      40 +
        Math.min(wordCount, 120) / 2 +
        (hasMetric ? 15 : 0) +
        (hasStructure ? 10 : 0),
    ),
  );
  const feedback =
    score >= 80
      ? "Strong answer. Keep this structure and tighten to 60-90 seconds."
      : hasMetric
        ? "Good foundation. Add clearer structure (context -> action -> result)."
        : "Add measurable outcomes and a clearer STAR structure to strengthen your answer.";

  const existingIndex = session.answers.findIndex(
    (entry) => entry.questionIndex === input.questionIndex,
  );
  const answerRecord = {
    questionIndex: input.questionIndex,
    answer: input.answer,
    score: Math.round(score),
    feedback,
  };
  if (existingIndex >= 0) {
    session.answers[existingIndex] = answerRecord;
  } else {
    session.answers.push(answerRecord);
  }
  mockInterviewSessions.set(session.id, session);
  return {
    ...answerRecord,
    nextQuestionIndex:
      input.questionIndex + 1 < session.questions.length
        ? input.questionIndex + 1
        : null,
  };
}

export function getMockInterviewSummary(input: {
  userId: string;
  sessionId: string;
}) {
  cleanupMockInterviewSessions();
  const session = mockInterviewSessions.get(input.sessionId);
  if (!session || session.userId !== input.userId) {
    throw new ApiError(
      404,
      "MOCK_INTERVIEW_NOT_FOUND",
      "Mock interview session not found",
    );
  }
  const avgScore =
    session.answers.length > 0
      ? Math.round(
          session.answers.reduce((sum, item) => sum + item.score, 0) /
            session.answers.length,
        )
      : 0;
  const improvements = [
    "Use STAR structure in every behavioral answer.",
    "Quantify impact with metrics (speed, reliability, revenue, adoption).",
    "Keep answers concise and role-specific.",
  ];
  return {
    sessionId: session.id,
    targetRole: session.targetRole,
    overallScore: avgScore,
    answeredQuestions: session.answers.length,
    totalQuestions: session.questions.length,
    improvements,
    answers: session.answers.sort((a, b) => a.questionIndex - b.questionIndex),
  };
}
