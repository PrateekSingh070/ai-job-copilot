// Pure, framework-free helpers used by the dashboard.
// Keeping this logic out of the components lets the UI files stay focused on
// rendering. Nothing here touches React state, so each function can be read
// and reasoned about on its own.

const statuses = ["APPLIED", "INTERVIEW", "OFFER", "REJECTED"];

function extractApiErrorMessage(error, fallback) {
  if (!error || typeof error !== "object") return fallback;
  const maybeResponse = error.response;
  const message = maybeResponse?.data?.error?.message;
  return typeof message === "string" && message.trim().length > 0
    ? message
    : fallback;
}

function toDatetimeLocalValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function suggestedActionForStatus(status) {
  if (status === "APPLIED") return "Schedule follow-up";
  if (status === "INTERVIEW") return "Draft thank-you email";
  if (status === "OFFER") return "Export decision packet";
  return "Review and close notes";
}

const RESUME_SKILL_DICTIONARY = [
  "React",
  "TypeScript",
  "JavaScript",
  "Node.js",
  "Express",
  "Next.js",
  "Tailwind",
  "HTML",
  "CSS",
  "Python",
  "Java",
  "Go",
  "PostgreSQL",
  "MongoDB",
  "Docker",
  "Kubernetes",
  "AWS",
  "GCP",
  "Azure",
  "Git",
  "Redux",
  "GraphQL",
  "REST APIs",
  "Jest",
  "Playwright",
];

function dedupeList(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function titleCaseWords(input) {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function inferNameFromFileName(fileName) {
  const base = fileName.replace(/\.[^/.]+$/, "");
  const cleaned = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? titleCaseWords(cleaned) : "Candidate Name";
}

function resumeJsonToPlainText(input) {
  const chunks = [];
  const summary = typeof input.summary === "string" ? input.summary : "";
  if (summary) chunks.push(summary);
  if (Array.isArray(input.skills)) {
    const skills = input.skills.filter(
      (item) => typeof item === "string" && item.trim().length > 0,
    );
    if (skills.length) chunks.push(`Skills: ${skills.join(", ")}`);
  }
  if (Array.isArray(input.experience)) {
    for (const item of input.experience) {
      if (!item || typeof item !== "object") continue;
      const row = item;
      const company = typeof row.company === "string" ? row.company : "Company";
      const role = typeof row.role === "string" ? row.role : "Role";
      chunks.push(`${role} at ${company}`);
      if (Array.isArray(row.points)) {
        const points = row.points.filter((point) => typeof point === "string");
        chunks.push(...points.slice(0, 4));
      }
    }
  }
  return chunks.join("\n").trim();
}

function sanitizeHtmlForDownload(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll("script,iframe,object,embed")
    .forEach((node) => node.remove());
  doc
    .querySelectorAll("meta[http-equiv],link[rel='import']")
    .forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on")) node.removeAttribute(attribute.name);
      if (
        (name === "href" || name === "src") &&
        value.startsWith("javascript:")
      ) {
        node.removeAttribute(attribute.name);
      }
    });
  });
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

function buildStructuredResumeFromText(input) {
  const source = input.resumeText.trim();
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const compact = source.replace(/\s+/g, " ").trim();
  const firstLine = lines[0] ?? "";
  const hasLikelyName = /^[A-Za-z][A-Za-z\s.'-]{2,50}$/.test(firstLine);
  const name = hasLikelyName
    ? firstLine
    : inferNameFromFileName(input.uploadedResumeName);
  const headlineLine =
    lines.find((line) =>
      /\b(engineer|developer|designer|manager|analyst|intern|specialist|architect)\b/i.test(
        line,
      ),
    ) ||
    input.targetRole.trim() ||
    "Professional";
  const emailMatch =
    compact.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  const phoneMatch =
    compact
      .match(/(?:\+?\d[\d\s\-()]{8,}\d)/)?.[0]
      ?.replace(/\s+/g, " ")
      .trim() ?? "";
  const linkedinMatch =
    compact.match(/https?:\/\/(?:www\.)?linkedin\.com\/\S+/i)?.[0] ?? "";
  const githubMatch =
    compact.match(/https?:\/\/(?:www\.)?github\.com\/\S+/i)?.[0] ?? "";
  const skills = dedupeList(
    RESUME_SKILL_DICTIONARY.filter((skill) =>
      compact.toLowerCase().includes(skill.toLowerCase()),
    ),
  ).slice(0, 16);
  const sentencePoints = compact
    .split(/[.!?]\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 20)
    .slice(0, 4);

  const summary = compact.slice(0, 320);
  const experiencePoints = sentencePoints.length
    ? sentencePoints.map((line) => (line.endsWith(".") ? line : `${line}.`))
    : ["Add 2-4 measurable bullets from your uploaded resume."];

  return {
    name,
    headline: headlineLine,
    contact: {
      email: emailMatch || undefined,
      phone: phoneMatch || undefined,
      linkedin: linkedinMatch || undefined,
      github: githubMatch || undefined,
    },
    summary:
      summary.length > 0
        ? summary
        : "Professional profile extracted from uploaded resume. Update this summary before submitting applications.",
    skills: skills.length
      ? skills
      : ["Add top technical and domain skills from your resume"],
    experience: [
      {
        company: "Unknown Company",
        role: input.targetRole.trim() || "Professional Experience",
        duration: "Add duration",
        points: experiencePoints,
      },
    ],
    projects: [
      {
        name: "Add Project Name",
        points: [
          "Add project impact bullet",
          "Add tech stack and measurable outcome",
        ],
      },
    ],
    education: [
      {
        degree: "Add degree",
        school: "Add institution",
        year: "Add graduation year",
      },
    ],
  };
}

// Human-readable label shown on each Kanban column header.
export const statusLabels = {
  APPLIED: "Applied",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  REJECTED: "Rejected",
};

// Avatar background/text color for a job card, keyed by pipeline status.
export const avatarToneByStatus = {
  APPLIED: "bg-sky-400/15 text-sky-300",
  INTERVIEW: "bg-violet-400/15 text-violet-300",
  OFFER: "bg-emerald-400/15 text-emerald-300",
  REJECTED: "bg-rose-400/15 text-rose-300",
};

export {
  statuses,
  extractApiErrorMessage,
  toDatetimeLocalValue,
  suggestedActionForStatus,
  resumeJsonToPlainText,
  sanitizeHtmlForDownload,
  buildStructuredResumeFromText,
};
