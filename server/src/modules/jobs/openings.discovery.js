import { extractTopKeywords } from "./job-intelligence.js";

const INTERNSHIP_RE = /\b(intern|internship|trainee|apprentice)\b/i;

function stripHtml(input) {
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function withTimeoutMs(timeoutMs) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => globalThis.clearTimeout(timeout),
  };
}

async function safeFetchJson(url) {
  const timeout = withTimeoutMs(8000);
  const response = await fetch(url, {
    signal: timeout.signal,
    headers: { "User-Agent": "ai-job-copilot-discovery/1.0" },
  }).finally(timeout.clear);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function buildSearchText(item) {
  return `${item.title} ${item.company} ${item.location ?? ""} ${item.snippet}`.toLowerCase();
}

function scoreOpening(item, profile) {
  const haystack = buildSearchText(item);
  const matchedKeywords = profile.keywords
    .filter((keyword) => haystack.includes(keyword))
    .slice(0, 8);
  const roleSignalHits = profile.roleHints.filter((hint) =>
    haystack.includes(hint),
  ).length;
  const internshipBoost = item.isInternship ? 8 : 0;
  const remoteBoost = item.isRemote ? 5 : 0;
  const base =
    matchedKeywords.length * 10 +
    roleSignalHits * 8 +
    internshipBoost +
    remoteBoost;
  return {
    matchScore: Math.max(1, Math.min(100, base + 20)),
    matchedKeywords,
  };
}

async function fetchRemotiveOpenings() {
  const payload = await safeFetchJson("https://remotive.com/api/remote-jobs");
  const jobs =
    payload && typeof payload === "object" && "jobs" in payload
      ? payload.jobs
      : [];
  if (!Array.isArray(jobs)) return [];
  return jobs
    .map((job) => {
      const title = asString(job.title);
      const company = asString(job.company_name);
      const location = asString(job.candidate_required_location) || "Remote";
      const snippet = stripHtml(asString(job.description)).slice(0, 260);
      const url = asString(job.url);
      const publishedAt = asString(job.publication_date) || null;
      if (!title || !company || !url) return null;
      const isInternship = INTERNSHIP_RE.test(`${title} ${snippet}`);
      return {
        title,
        company,
        location,
        isRemote: true,
        isInternship,
        url,
        source: "remotive",
        publishedAt,
        snippet,
      };
    })
    .filter((item) => item !== null);
}

async function fetchArbeitnowOpenings() {
  const payload = await safeFetchJson(
    "https://www.arbeitnow.com/api/job-board-api",
  );
  const rows =
    payload && typeof payload === "object" && "data" in payload
      ? payload.data
      : [];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((job) => {
      const title = asString(job.title);
      const company = asString(job.company_name);
      const location = asString(job.location);
      const snippet = stripHtml(asString(job.description)).slice(0, 260);
      const url = asString(job.url);
      const remoteFlag = Boolean(job.remote);
      const publishedAt = asString(job.created_at) || null;
      if (!title || !company || !url) return null;
      const isInternship = INTERNSHIP_RE.test(`${title} ${snippet}`);
      return {
        title,
        company,
        location: location || (remoteFlag ? "Remote" : null),
        isRemote: remoteFlag,
        isInternship,
        url,
        source: "arbeitnow",
        publishedAt,
        snippet,
      };
    })
    .filter((item) => item !== null);
}

function dedupeOpenings(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = `${item.title.toLowerCase()}::${item.company.toLowerCase()}::${item.url.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

export function buildProfileSignals(profileText, roleHints) {
  const keywords = extractTopKeywords(profileText, 40).filter(
    (token) => token.length >= 3,
  );
  const normalizedRoleHints = roleHints
    .map((role) => role.toLowerCase().trim())
    .filter((role) => role.length >= 3)
    .slice(0, 10);
  return { keywords, roleHints: normalizedRoleHints };
}

export async function discoverOpenings(profile, filters) {
  const warnings = [];
  const [remotive, arbeitnow] = await Promise.allSettled([
    fetchRemotiveOpenings(),
    fetchArbeitnowOpenings(),
  ]);
  const rows = [];

  if (remotive.status === "fulfilled") rows.push(...remotive.value);
  else warnings.push("Could not refresh from Remotive right now.");

  if (arbeitnow.status === "fulfilled") rows.push(...arbeitnow.value);
  else warnings.push("Could not refresh from Arbeitnow right now.");

  const deduped = dedupeOpenings(rows);
  const filtered = deduped.filter((item) => {
    if (filters.internshipsOnly && !item.isInternship) return false;
    if (filters.remoteOnly && !item.isRemote) return false;
    return true;
  });

  const ranked = filtered
    .map((item) => {
      const score = scoreOpening(item, profile);
      return { ...item, ...score };
    })
    .sort(
      (a, b) =>
        b.matchScore - a.matchScore ||
        (a.isInternship === b.isInternship ? 0 : a.isInternship ? -1 : 1),
    )
    .slice(0, filters.limit);

  return {
    generatedAt: new Date().toISOString(),
    profileKeywords: profile.keywords.slice(0, 20),
    openings: ranked,
    warnings,
  };
}
