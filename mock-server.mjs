/**
 * Lightweight mock API server — no DB or Redis needed.
 * Run: node mock-server.mjs
 * Listens on http://localhost:4000
 */
import http from "node:http";

const PORT = 4000;

// ── In-memory store ──────────────────────────────────────────────
let jobs = [
  { id: "j1", company: "Anthropic", role: "Frontend Engineer", status: "INTERVIEW", location: "San Francisco, CA", jobUrl: "https://anthropic.com/careers", starred: true, notes: "", salaryRange: "$160k–$200k", followUpAt: null, createdAt: new Date(Date.now() - 86400000 * 3).toISOString(), updatedAt: new Date(Date.now() - 86400000 * 1).toISOString() },
  { id: "j2", company: "OpenAI", role: "Product Engineer", status: "APPLIED", location: "Remote", jobUrl: "https://openai.com/careers", starred: false, notes: "", salaryRange: "$150k–$190k", followUpAt: null, createdAt: new Date(Date.now() - 86400000 * 5).toISOString(), updatedAt: new Date(Date.now() - 86400000 * 2).toISOString() },
  { id: "j3", company: "Vercel", role: "Full-Stack Developer", status: "APPLIED", location: "Remote", jobUrl: "https://vercel.com/careers", starred: true, notes: "", salaryRange: "$130k–$170k", followUpAt: new Date(Date.now() + 86400000 * 2).toISOString(), createdAt: new Date(Date.now() - 86400000 * 7).toISOString(), updatedAt: new Date(Date.now() - 86400000 * 3).toISOString() },
  { id: "j4", company: "Stripe", role: "Software Engineer", status: "OFFER", location: "New York, NY", jobUrl: "https://stripe.com/jobs", starred: true, notes: "Great team!", salaryRange: "$170k–$210k", followUpAt: null, createdAt: new Date(Date.now() - 86400000 * 14).toISOString(), updatedAt: new Date().toISOString() },
  { id: "j5", company: "Linear", role: "React Developer", status: "REJECTED", location: "Remote", jobUrl: "https://linear.app/careers", starred: false, notes: "", salaryRange: "$120k–$150k", followUpAt: null, createdAt: new Date(Date.now() - 86400000 * 10).toISOString(), updatedAt: new Date(Date.now() - 86400000 * 4).toISOString() },
  { id: "j6", company: "Figma", role: "Senior Frontend Engineer", status: "INTERVIEW", location: "San Francisco, CA", jobUrl: "https://figma.com/careers", starred: false, notes: "", salaryRange: "$155k–$195k", followUpAt: new Date(Date.now() + 86400000 * 1).toISOString(), createdAt: new Date(Date.now() - 86400000 * 2).toISOString(), updatedAt: new Date().toISOString() },
];

let idCounter = 100;
const user = { id: "u1", name: "Prateek Singh", email: "demo@copilot.local" };
const token = "mock-access-token-xyz";

// ── Helpers ──────────────────────────────────────────────────────
function ok(data, meta = {}) {
  return JSON.stringify({ success: true, data, meta });
}
function err(code, message, status = 400) {
  return { status, body: JSON.stringify({ success: false, error: { code, message } }) };
}
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}
function json(res, data, status = 200) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(typeof data === "string" ? data : JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { resolve({}); }
    });
  });
}

// ── Router ───────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  // Preflight
  if (method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

  const path = url.split("?")[0];
  const query = Object.fromEntries(new URL(url, "http://localhost").searchParams);

  // ── AUTH ────────────────────────────────────────────────────────
  if (path === "/auth/login" && method === "POST") {
    const body = await readBody(req);
    if (body.email === "demo@copilot.local" && body.password === "DemoPass123!") {
      res.setHeader("Set-Cookie", `refreshToken=mock-refresh; HttpOnly; Path=/; Max-Age=604800`);
      return json(res, ok({ user, accessToken: token }));
    }
    return json(res, err("INVALID_CREDENTIALS", "Invalid email or password"), 401);
  }
  if (path === "/auth/register" && method === "POST") {
    const body = await readBody(req);
    res.setHeader("Set-Cookie", `refreshToken=mock-refresh; HttpOnly; Path=/; Max-Age=604800`);
    return json(res, ok({ user: { ...user, name: body.name || "User", email: body.email }, accessToken: token }));
  }
  if (path === "/auth/refresh" && method === "POST") {
    return json(res, ok({ accessToken: token }));
  }
  if (path === "/auth/logout" && method === "POST") {
    return json(res, ok({}));
  }
  if (path === "/auth/me" && method === "GET") {
    return json(res, ok(user));
  }
  if (path === "/auth/oauth/status" && method === "GET") {
    return json(res, ok({ googleConfigured: false, githubConfigured: false }));
  }

  // ── JOBS ────────────────────────────────────────────────────────
  if (path === "/jobs" && method === "GET") {
    let list = [...jobs];
    if (query.company) list = list.filter(j => j.company.toLowerCase().includes(query.company.toLowerCase()));
    if (query.status) list = list.filter(j => j.status === query.status);
    if (query.starred === "true") list = list.filter(j => j.starred);
    const page = parseInt(query.page || "1");
    const pageSize = 10;
    const paged = list.slice((page - 1) * pageSize, page * pageSize);
    return json(res, ok(paged, { total: list.length, page, pageSize }));
  }
  if (path === "/jobs" && method === "POST") {
    const body = await readBody(req);
    const job = { id: `j${++idCounter}`, starred: false, notes: "", followUpAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...body };
    jobs.unshift(job);
    return json(res, ok(job), 201);
  }

  // PATCH /jobs/:id
  const jobPatchMatch = path.match(/^\/jobs\/([^/]+)$/) && method === "PATCH";
  if (jobPatchMatch) {
    const id = path.split("/")[2];
    const body = await readBody(req);
    const idx = jobs.findIndex(j => j.id === id);
    if (idx === -1) return json(res, err("NOT_FOUND", "Job not found"), 404);
    jobs[idx] = { ...jobs[idx], ...body, updatedAt: new Date().toISOString() };
    return json(res, ok(jobs[idx]));
  }

  // DELETE /jobs/:id
  const jobDeleteMatch = path.match(/^\/jobs\/([^/]+)$/) && method === "DELETE";
  if (jobDeleteMatch) {
    const id = path.split("/")[2];
    jobs = jobs.filter(j => j.id !== id);
    return json(res, ok({}));
  }

  if (path === "/jobs/metrics/summary" && method === "GET") {
    const total = jobs.length;
    const interviewed = jobs.filter(j => j.status === "INTERVIEW" || j.status === "OFFER").length;
    const offered = jobs.filter(j => j.status === "OFFER").length;
    return json(res, ok({
      totalApplications: total,
      interviewRate: total ? Math.round((interviewed / total) * 100) : 0,
      offerRate: total ? Math.round((offered / total) * 100) : 0,
      conversion: {
        applicationToInterviewRate: total ? Math.round((interviewed / total) * 100) : 0,
        interviewToOfferRate: interviewed ? Math.round((offered / interviewed) * 100) : 0,
      },
      resumeVersionPerformance: [{ matchScore: 84 }],
      byStatus: {
        APPLIED: jobs.filter(j => j.status === "APPLIED").length,
        INTERVIEW: jobs.filter(j => j.status === "INTERVIEW").length,
        OFFER: jobs.filter(j => j.status === "OFFER").length,
        REJECTED: jobs.filter(j => j.status === "REJECTED").length,
      },
    }));
  }

  if (path === "/jobs/activity/recent" && method === "GET") {
    return json(res, ok({ items: jobs.slice(0, 5).map(j => ({ kind: "job", id: j.id, at: j.updatedAt, title: `${j.company} — ${j.role}`, subtitle: j.status })) }));
  }
  if (path === "/jobs/reminders" && method === "GET") {
    const upcoming = jobs.filter(j => j.followUpAt).map(j => ({ jobId: j.id, type: "FOLLOW_UP", dueAt: j.followUpAt, message: `Follow up with ${j.company}`, nextAction: "Send a thank-you email", reason: "No response in 5 days" }));
    return json(res, ok(upcoming));
  }
  if (path === "/jobs/groups" && method === "GET") {
    return json(res, ok([]));
  }
  if (path === "/jobs/timeline/audit" && method === "GET") {
    return json(res, ok(jobs.slice(0, 5).map(j => ({ id: j.id, at: j.updatedAt, eventType: "STATUS_CHANGE", message: `${j.company} moved to ${j.status}`, source: "timeline", job: { id: j.id, company: j.company, role: j.role } }))));
  }
  if (path === "/jobs/discover/openings" && method === "GET") {
    return json(res, ok({ generatedAt: new Date().toISOString(), profileKeywords: ["React", "TypeScript", "Node.js"], warnings: [], openings: [
      { title: "Frontend Engineer", company: "Loom", location: "Remote", isRemote: true, isInternship: false, url: "https://loom.com/careers", source: "linkedin", publishedAt: new Date().toISOString(), snippet: "Build beautiful video tools with React and TypeScript.", matchScore: 92, matchedKeywords: ["React", "TypeScript"] },
      { title: "Software Engineer, UI", company: "Notion", location: "San Francisco", isRemote: false, isInternship: false, url: "https://notion.so/careers", source: "greenhouse", publishedAt: new Date().toISOString(), snippet: "Work on the editor, collaboration, and design systems.", matchScore: 87, matchedKeywords: ["React", "TypeScript", "Node.js"] },
      { title: "React Developer Intern", company: "Replit", location: "Remote", isRemote: true, isInternship: true, url: "https://replit.com/careers", source: "lever", publishedAt: new Date().toISOString(), snippet: "Help build the browser-based IDE experience.", matchScore: 78, matchedKeywords: ["React"] },
    ] }));
  }

  if (path.match(/^\/jobs\/[^/]+\/fit-score$/) && method === "POST") {
    return json(res, ok({ output: { score: 82, matchedKeywords: ["React", "TypeScript", "Node.js"], missingKeywords: ["GraphQL"], suggestedBulletImprovements: ["Add quantified impact metrics"], skillGapDetection: ["GraphQL experience would strengthen your application"], explanation: "Strong match on core frontend skills.", confidence: "high" } }));
  }
  if (path.match(/^\/jobs\/[^/]+\/ats-check$/) && method === "POST") {
    return json(res, ok({ output: { score: 75, issues: [{ severity: "medium", message: "Use standard section headers" }], suggestions: ["Add more measurable achievements"] } }));
  }
  if (path.match(/^\/jobs\/[^/]+\/company-insight$/) && method === "POST") {
    const id = path.split("/")[2];
    const job = jobs.find(j => j.id === id);
    return json(res, ok({ id: "ci1", companyName: job?.company || "Company", industry: "Technology", companySize: "500–1000", fundingStage: "Series C", techStack: ["React", "TypeScript", "Go", "PostgreSQL", "Kubernetes"], recentNews: ["Raised $100M Series C", "Launched new AI product line", "Expanded to EU markets"], commonInterviewQuestions: ["Tell me about a hard technical problem you solved", "How do you approach design reviews?", "Describe your experience with large-scale systems"], lastRefreshedAt: new Date().toISOString() }));
  }
  if (path.match(/^\/jobs\/[^/]+\/follow-up-template$/) && method === "POST") {
    const id = path.split("/")[2];
    const job = jobs.find(j => j.id === id);
    return json(res, ok({ subject: `Following up — ${job?.role} at ${job?.company}`, body: `Hi [Hiring Manager],\n\nI wanted to follow up on my application for the ${job?.role} position at ${job?.company}. I'm very excited about this opportunity and would love to discuss how my experience aligns with your team's goals.\n\nPlease let me know if there's anything else you need from my side.\n\nBest regards,\nPrateek` }));
  }
  if (path.match(/^\/jobs\/[^/]+\/schedule-follow-up$/) && method === "POST") {
    const id = path.split("/")[2];
    const idx = jobs.findIndex(j => j.id === id);
    if (idx !== -1) { jobs[idx].followUpAt = new Date(Date.now() + 86400000 * 5).toISOString(); jobs[idx].updatedAt = new Date().toISOString(); }
    return json(res, ok(jobs[idx] || {}));
  }
  if (path === "/jobs/import-url/preview" && method === "POST") {
    return json(res, ok({ url: "https://example.com/job", company: "Acme Corp", role: "Frontend Developer", location: "Remote", jobDescription: "We are looking for a skilled Frontend Developer to join our team...", confidence: 0.91, signals: ["job-title", "company-name", "location"], duplicate: null }));
  }
  if (path === "/jobs/import-url" && method === "POST") {
    const body = await readBody(req);
    const job = { id: `j${++idCounter}`, status: "APPLIED", starred: false, notes: "", followUpAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...body.overrides };
    jobs.unshift(job);
    return json(res, ok(job), 201);
  }
  if (path === "/jobs/export/csv" && method === "GET") {
    cors(res);
    res.writeHead(200, { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="jobs.csv"' });
    const header = "company,role,status,location,starred,createdAt\n";
    const rows = jobs.map(j => `"${j.company}","${j.role}","${j.status}","${j.location || ""}","${j.starred}","${j.createdAt}"`).join("\n");
    res.end(header + rows);
    return;
  }

  // ── AI ──────────────────────────────────────────────────────────
  if (path === "/ai/provider-status" && method === "GET") {
    return json(res, ok({ provider: "mock", configured: true, status: "mock_mode", message: "Running in mock mode — no API key needed." }));
  }
  if (path === "/ai/resume-tailor" && method === "POST") {
    return json(res, ok({ output: { rewrittenBullets: ["Engineered responsive React components that reduced load time by 40%", "Architected a TypeScript monorepo used by 12 teams across the org", "Shipped 3 major product features in Q1, driving 22% user retention lift"], extractedKeywords: ["React", "TypeScript", "performance"], matchScore: 88, explanation: "Resume closely matches the job description with strong keyword alignment." }, tokenUsage: { input: 280, output: 95 }, costUsd: 0 }));
  }
  if (path === "/ai/cover-letter" && method === "POST") {
    return json(res, ok({ output: { content: "Dear Hiring Team,\n\nI am excited to apply for this role. With my background in React, TypeScript, and full-stack development, I believe I can make an immediate impact on your team.\n\nIn my previous work, I led the redesign of a critical dashboard that improved user engagement by 35%. I thrive in collaborative, fast-moving environments and care deeply about code quality and user experience.\n\nI would love the opportunity to discuss how my skills align with your needs.\n\nSincerely,\nPrateek Singh" }, tokenUsage: { input: 310, output: 140 }, costUsd: 0 }));
  }
  if (path === "/ai/interview-prep" && method === "POST") {
    return json(res, ok({ output: { questions: [{ question: "Tell me about a complex frontend architecture decision you made.", answer: "I designed a micro-frontend system using Module Federation..." }, { question: "How do you handle performance bottlenecks in React?", answer: "I profile with DevTools, then apply memoization, lazy loading, and virtualization..." }, { question: "Describe a time you disagreed with a product decision.", answer: "I pushed back on an over-engineered feature by presenting user data..." }] }, tokenUsage: { input: 200, output: 180 }, costUsd: 0 }));
  }
  if (path === "/ai/history" && method === "GET") {
    return json(res, ok([]));
  }
  if (path === "/ai/structured-resume-tailor" && method === "POST") {
    return json(res, ok({ output: { summary: "Results-driven frontend engineer with 4+ years building React/TypeScript products.", skills: ["React", "TypeScript", "Node.js", "PostgreSQL", "Docker"], experience: [{ company: "Acme Corp", role: "Frontend Engineer", updated_points: ["Reduced bundle size by 42% via code splitting", "Led migration to TypeScript across 3 services"] }], projects: [{ name: "AI Dashboard", updated_points: ["Built with React + Vite + TanStack Query", "Achieved 98 Lighthouse score"] }], keyword_match: { added_keywords: ["GraphQL", "performance"], missing_keywords: ["Rust"] } } }));
  }
  if (path === "/ai/resume-html" && method === "POST") {
    return json(res, ok({ output: { html: "<html><body><h1>Prateek Singh</h1><p>Frontend Engineer</p></body></html>" } }));
  }
  if (path === "/ai/mock-interview/start" && method === "POST") {
    return json(res, ok({ sessionId: "sess1", createdAt: new Date().toISOString(), targetRole: "Frontend Engineer", questions: ["Walk me through your React experience.", "How do you optimize a slow page?", "Describe a challenging project."] }));
  }
  if (path.match(/^\/ai\/mock-interview\/[^/]+\/answer$/) && method === "POST") {
    return json(res, ok({ questionIndex: 0, answer: "...", score: 82, feedback: "Good answer! Consider adding quantified metrics.", nextQuestionIndex: 1 }));
  }
  if (path.match(/^\/ai\/mock-interview\/[^/]+\/summary$/) && method === "GET") {
    return json(res, ok({ sessionId: "sess1", targetRole: "Frontend Engineer", overallScore: 79, answeredQuestions: 3, totalQuestions: 3, improvements: ["Add more specific examples", "Quantify your impact"], answers: [] }));
  }
  if (path.match(/^\/ai\/history\/[^/]+\/restore$/) && method === "POST") {
    return json(res, ok({}));
  }
  if (path.match(/^\/ai\/compare$/) && method === "POST") {
    return json(res, ok({ differences: ["Version 2 has stronger action verbs", "Version 1 is more concise"] }));
  }

  // ── EXPORTS ─────────────────────────────────────────────────────
  if (path.match(/^\/exports\/application-packet\/[^/]+$/) && method === "POST") {
    cors(res);
    res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="packet.pdf"' });
    res.end("%PDF-1.4 mock pdf content");
    return;
  }

  // ── HEALTH ──────────────────────────────────────────────────────
  if (path === "/health") {
    return json(res, { status: "ok", mode: "mock" });
  }

  // 404
  cors(res);
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: `${method} ${path} not found` } }));
});

server.listen(PORT, () => {
  console.log(`\n✅ Mock API server running at http://localhost:${PORT}`);
  console.log(`   Demo login: demo@copilot.local / DemoPass123!\n`);
});
