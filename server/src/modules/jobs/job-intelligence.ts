const STOP_WORDS = new Set([
  "with",
  "from",
  "that",
  "this",
  "have",
  "your",
  "will",
  "using",
  "build",
  "role",
  "team",
  "work",
  "about",
  "their",
  "they",
  "years",
  "year",
  "experience",
  "required",
  "preferred",
  "ability",
  "strong",
  "skills",
  "knowledge",
  "plus",
  "into",
  "across",
  "while",
  "through",
]);

export type JobRecordForIntelligence = {
  id: string;
  company: string;
  role: string;
  status: string;
  followUpAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  notes?: string | null;
  jobUrl?: string | null;
};

export type ParsedJobImport = {
  role: string;
  company: string;
  location: string | null;
  description: string;
  confidence: number;
  signals: string[];
};

function normalizeWord(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9+#.-]/g, "");
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) => normalizeWord(word))
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

export function normalizeCompany(company: string): string {
  return company
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function extractTopKeywords(text: string, take = 20): string[] {
  const counts = new Map<string, number>();
  tokenize(text).forEach((token) =>
    counts.set(token, (counts.get(token) ?? 0) + 1),
  );
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, take)
    .map(([word]) => word);
}

export function computeFitScore(resumeText: string, jobDescription: string) {
  const jdKeywords = extractTopKeywords(jobDescription, 30);
  const resumeTokens = new Set(tokenize(resumeText));
  const matched = jdKeywords.filter((kw) => resumeTokens.has(kw));
  const missing = jdKeywords.filter((kw) => !resumeTokens.has(kw));
  const ratio = jdKeywords.length > 0 ? matched.length / jdKeywords.length : 0;
  const score = Math.round(35 + ratio * 65);
  const suggestedBulletImprovements = missing
    .slice(0, 5)
    .map(
      (keyword) =>
        `Add a bullet using "${keyword}" with a measurable outcome (for example, "Improved ${keyword} workflow by 20%").`,
    );
  const skillGapDetection = missing.slice(0, 8);

  return {
    score: Math.max(0, Math.min(100, score)),
    matchedKeywords: matched.slice(0, 15),
    missingKeywords: missing.slice(0, 15),
    suggestedBulletImprovements,
    skillGapDetection,
    explanation:
      missing.length === 0
        ? "Great overlap with the job keywords. Focus on quantifying impact in each bullet."
        : `Your resume matches ${matched.length} of ${jdKeywords.length} key terms. Add ${missing
            .slice(0, 4)
            .join(", ")} in relevant achievement bullets to improve ATS fit.`,
    confidence:
      jdKeywords.length < 10 ? "low" : matched.length >= 8 ? "high" : "medium",
  };
}

export function runAtsChecks(resumeText: string, jobDescription?: string) {
  const lines = resumeText.split(/\r?\n/).map((line) => line.trim());
  const longLines = lines.filter((line) => line.length > 180).length;
  const sectionHeaders = [
    "experience",
    "skills",
    "education",
    "projects",
  ].filter((header) => resumeText.toLowerCase().includes(header));
  const hasTables = /[\u2500-\u257F]|│|┌|┐|└|┘/.test(resumeText);
  const hasImagesOrIcons = /[😀-🙏🚀⭐•►■●]/u.test(resumeText);
  const hasBullets = lines.some((line) => /^[-*]\s+/.test(line));
  const keywordCheck = jobDescription
    ? computeFitScore(resumeText, jobDescription)
    : null;
  const keywordCounts = new Map<string, number>();
  tokenize(resumeText).forEach((token) =>
    keywordCounts.set(token, (keywordCounts.get(token) ?? 0) + 1),
  );
  const keywordDensity = keywordCheck
    ? keywordCheck.matchedKeywords.slice(0, 10).map((keyword) => ({
        keyword,
        count: keywordCounts.get(keyword) ?? 0,
      }))
    : [];

  const issues: Array<{
    severity: "high" | "medium" | "low";
    message: string;
  }> = [];

  if (sectionHeaders.length < 3) {
    issues.push({
      severity: "high",
      message:
        "Missing core sections (Experience, Skills, Education, Projects).",
    });
  }
  if (!hasBullets) {
    issues.push({
      severity: "medium",
      message: "Use bullet points for better ATS parsing.",
    });
  }
  if (longLines > 8) {
    issues.push({
      severity: "medium",
      message:
        "Many lines are too dense. Split into shorter achievement bullets.",
    });
  }
  if (hasTables || hasImagesOrIcons) {
    issues.push({
      severity: "high",
      message:
        "Detected symbols/table-like formatting that ATS parsers may ignore.",
    });
  }
  if (keywordCheck && keywordCheck.missingKeywords.length > 8) {
    issues.push({
      severity: "medium",
      message: `Missing many role keywords: ${keywordCheck.missingKeywords.slice(0, 6).join(", ")}.`,
    });
  }
  const suggestions = [
    ...(hasBullets
      ? []
      : [
          "Rewrite experience into short impact bullets (Action + Tech + Metric).",
        ]),
    ...(sectionHeaders.includes("skills")
      ? []
      : ["Add a dedicated Skills section near the top."]),
    ...(hasTables || hasImagesOrIcons
      ? [
          "Use a simple single-column layout. Avoid icons, tables, and graphics.",
        ]
      : []),
    ...(keywordCheck?.missingKeywords
      .slice(0, 3)
      .map((kw) => `Add keyword "${kw}" in relevant bullets.`) ?? []),
  ];

  return {
    score: Math.max(0, 100 - issues.length * 12 - longLines),
    issues,
    suggestions,
    checks: {
      hasBullets,
      sectionHeaders,
      longLineCount: longLines,
      keywordDensity,
      keywordCoverage: keywordCheck
        ? {
            matched: keywordCheck.matchedKeywords.length,
            missing: keywordCheck.missingKeywords.length,
          }
        : null,
    },
  };
}

function inferIndustry(input: string): string {
  const text = input.toLowerCase();
  if (/fintech|bank|payments|trading/.test(text)) return "Fintech";
  if (/health|medical|biotech|pharma/.test(text)) return "Healthcare";
  if (/developer|software|cloud|data|platform|ai|machine learning/.test(text))
    return "Software";
  if (/retail|commerce|marketplace|e-?commerce/.test(text)) return "E-commerce";
  return "Technology";
}

function inferTechStack(input: string): string[] {
  const dictionary = [
    "react",
    "typescript",
    "javascript",
    "node",
    "python",
    "java",
    "go",
    "aws",
    "gcp",
    "azure",
    "postgresql",
    "mongodb",
    "docker",
    "kubernetes",
  ];
  const text = input.toLowerCase();
  return dictionary.filter((item) => text.includes(item)).slice(0, 7);
}

function inferCompanySize(input: string): string {
  const text = input.toLowerCase();
  if (/startup|early stage|seed/.test(text)) return "1-50";
  if (/series a|series b/.test(text)) return "51-250";
  if (/enterprise|fortune|global/.test(text)) return "5000+";
  return "200-1000";
}

function inferFundingStage(input: string): string {
  const text = input.toLowerCase();
  if (/seed/.test(text)) return "Seed";
  if (/series a/.test(text)) return "Series A";
  if (/series b/.test(text)) return "Series B";
  if (/public|nasdaq|nyse/.test(text)) return "Public";
  return "Unknown";
}

export function buildCompanyResearch(input: {
  company: string;
  role: string;
  contextText: string;
}) {
  const summaryText = `${input.company} ${input.role} ${input.contextText}`;
  const slug = input.company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  return {
    companyName: input.company,
    normalizedCompany: normalizeCompany(input.company),
    industry: inferIndustry(summaryText),
    companySize: inferCompanySize(summaryText),
    fundingStage: inferFundingStage(summaryText),
    techStack: inferTechStack(summaryText),
    recentNews: [
      `${input.company} appears to be hiring for ${input.role}, suggesting active team growth.`,
      `${input.company} likely emphasizes ${inferIndustry(summaryText)} execution based on the role description.`,
      `Investigate fresh leadership/product announcements for ${slug} before interviews.`,
    ],
    commonInterviewQuestions: [
      `Why do you want to join ${input.company} as a ${input.role}?`,
      `Tell us about a project where your technical choices impacted business outcomes.`,
      "Describe a time you handled ambiguity and aligned with cross-functional stakeholders.",
    ],
  };
}

export function computeApplicationReminders(jobs: JobRecordForIntelligence[]) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  type Reminder = {
    jobId: string;
    type: string;
    dueAt: string;
    message: string;
    nextAction?: string;
    reason?: string;
  };

  return jobs
    .flatMap((job) => {
      const reminders: Reminder[] = [];
      const ageDays = Math.floor((now - job.updatedAt.getTime()) / day);

      if (job.followUpAt && job.followUpAt.getTime() <= now + day) {
        reminders.push({
          jobId: job.id,
          type: "FOLLOW_UP",
          dueAt: job.followUpAt.toISOString(),
          message: `Follow up with ${job.company} for ${job.role}.`,
          nextAction: "Send follow-up email",
          reason: "A follow-up time is already scheduled.",
        });
      }

      if (job.status === "APPLIED" && ageDays >= 5) {
        reminders.push({
          jobId: job.id,
          type: "STALE_APPLICATION",
          dueAt: new Date(now).toISOString(),
          message: `${job.company} application has been quiet for ${ageDays} days.`,
          nextAction: "Send polite follow-up",
          reason: "Applied jobs older than 5 days should be nudged.",
        });
      }

      if (job.status === "INTERVIEW") {
        reminders.push({
          jobId: job.id,
          type: "THANK_YOU_EMAIL",
          dueAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
          message: `Send thank-you email for ${job.company} interview.`,
          nextAction: "Send thank-you email",
          reason:
            "Interview stage requires same-day gratitude and reinforcement.",
        });
        reminders.push({
          jobId: job.id,
          type: "INTERVIEW_PREP",
          dueAt: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
          message: `Prep deeply for ${job.company} interview loop.`,
          nextAction: "Review prep plan and company notes",
          reason:
            "Interview stage benefits from targeted prep before next round.",
        });
      }

      if (job.status === "OFFER") {
        reminders.push({
          jobId: job.id,
          type: "NEGOTIATION",
          dueAt: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
          message: `Review and respond to ${job.company} offer.`,
          nextAction: "Prepare negotiation checklist",
          reason: "Offers are time-sensitive and should be reviewed quickly.",
        });
      }

      return reminders;
    })
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
    .slice(0, 20);
}

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function pickMeta(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const match = html.match(re);
  return match?.[1] ? decodeHtml(match[1]).trim() : null;
}

function extractJsonLdField(html: string, field: string): string | null {
  const re = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`, "i");
  const match = html.match(re);
  return match?.[1] ? decodeHtml(match[1]).trim() : null;
}

function extractLocation(html: string): string | null {
  const metaLocation =
    pickMeta(html, "job:location") ??
    pickMeta(html, "og:locality") ??
    pickMeta(html, "twitter:data1");
  if (metaLocation) return metaLocation;
  const jsonLdLocation =
    extractJsonLdField(html, "addressLocality") ??
    extractJsonLdField(html, "jobLocation");
  if (jsonLdLocation) return jsonLdLocation;
  const plainTextMatch = html.match(
    /(?:Location|Job Location|Workplace)\s*[:|-]\s*([^<\n\r]+)/i,
  )?.[1];
  return plainTextMatch
    ? decodeHtml(plainTextMatch).trim().slice(0, 120)
    : null;
}

export function extractJobFromHtml(html: string, url: string): ParsedJobImport {
  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  const ogTitle = pickMeta(html, "og:title");
  const ogDescription = pickMeta(html, "og:description");
  const twitterTitle = pickMeta(html, "twitter:title");
  const jsonLdTitle = extractJsonLdField(html, "title");
  const schemaName = extractJsonLdField(html, "name");
  const sourceTitle =
    ogTitle ?? twitterTitle ?? jsonLdTitle ?? schemaName ?? titleTag ?? "";
  const description =
    ogDescription ??
    html.replace(/<script[\s\S]*?<\/script>/gi, "").slice(0, 4000);
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "unknown";
    }
  })();

  const title = (sourceTitle || "Unknown role")
    .replace(/\s*[-|]\s*.*/, "")
    .trim();
  const companyFromTitle = sourceTitle.split(/[-|@]/).slice(1)[0]?.trim();
  const metaSiteName = pickMeta(html, "og:site_name");
  const jsonLdOrg = extractJsonLdField(html, "hiringOrganization");
  const company =
    companyFromTitle ||
    jsonLdOrg ||
    metaSiteName ||
    host.split(".")[0] ||
    "Unknown company";
  const location = extractLocation(html);
  const signals: string[] = [];
  if (ogTitle || twitterTitle || jsonLdTitle) signals.push("title metadata");
  if (ogDescription) signals.push("og description");
  if (location) signals.push("location detected");
  if (companyFromTitle || jsonLdOrg || metaSiteName)
    signals.push("company signal");
  const hasUnknowns =
    Number(title.toLowerCase().includes("unknown")) +
    Number(company.toLowerCase().includes("unknown"));
  const confidence = Math.max(
    0.2,
    Math.min(
      0.98,
      signals.length * 0.2 +
        (description.length > 400 ? 0.15 : 0.05) -
        hasUnknowns * 0.2,
    ),
  );

  return {
    role: title || "Unknown role",
    company: company || "Unknown company",
    location,
    description: decodeHtml(
      description
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    ),
    confidence: Number(confidence.toFixed(2)),
    signals,
  };
}
