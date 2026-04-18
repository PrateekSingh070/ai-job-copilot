type User = {
  id: string;
  name: string;
  email: string;
  passwordHash: string | null;
  createdAt: Date;
};

type RefreshToken = {
  id: string;
  userId: string;
  tokenHash: string;
  revoked: boolean;
  expiresAt: Date;
  replacedBy?: string | null;
};

type Job = {
  id: string;
  userId: string;
  company: string;
  role: string;
  jobUrl?: string | null;
  jobDescription?: string | null;
  source?: string | null;
  location?: string | null;
  salaryRange?: string | null;
  notes?: string | null;
  status: "APPLIED" | "INTERVIEW" | "OFFER" | "REJECTED";
  starred: boolean;
  followUpAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type JobTimelineEvent = {
  id: string;
  userId: string;
  jobId?: string | null;
  eventType: string;
  message: string;
  payloadJson?: unknown;
  createdAt: Date;
};

type CompanyInsight = {
  id: string;
  userId: string;
  companyName: string;
  normalizedCompany: string;
  industry: string;
  companySize: string;
  fundingStage: string;
  techStack: string[];
  recentNews: unknown;
  commonInterviewQuestions: string[];
  lastRefreshedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type Generation = {
  id: string;
  userId: string;
  type: "RESUME_TAILOR" | "COVER_LETTER" | "INTERVIEW_PREP";
  inputJson: unknown;
  outputJson: unknown;
  model: string;
  tokenUsage?: number | null;
  costUsd?: number | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type JobWhere = {
  userId: string;
  status?: string;
  company?: { contains: string; mode?: string };
  starred?: boolean;
  createdAt?: { gte?: Date; lte?: Date };
};

function jobMatches(job: Job, where: JobWhere): boolean {
  if (job.userId !== where.userId) return false;
  if (where.status && job.status !== where.status) return false;
  if (where.starred !== undefined && job.starred !== where.starred)
    return false;
  if (where.company?.contains) {
    const q = where.company.contains.toLowerCase();
    if (!job.company.toLowerCase().includes(q)) return false;
  }
  if (where.createdAt?.gte && job.createdAt < where.createdAt.gte) return false;
  if (where.createdAt?.lte && job.createdAt > where.createdAt.lte) return false;
  return true;
}

export const state = {
  users: [] as User[],
  refreshTokens: [] as RefreshToken[],
  jobs: [] as Job[],
  generations: [] as Generation[],
  timelineEvents: [] as JobTimelineEvent[],
  companyInsights: [] as CompanyInsight[],
};

let seq = 0;
const nextId = () => `id_${++seq}`;

export function resetState() {
  state.users = [];
  state.refreshTokens = [];
  state.jobs = [];
  state.generations = [];
  state.timelineEvents = [];
  state.companyInsights = [];
  seq = 0;
}

export const prismaMock = {
  user: {
    findUnique: async ({
      where: { email, id },
    }: {
      where: { email?: string; id?: string };
    }) =>
      state.users.find((u) => (email ? u.email === email : u.id === id)) ??
      null,
    create: async ({
      data,
    }: {
      data: { name: string; email: string; passwordHash: string | null };
    }) => {
      const user = { ...data, id: nextId(), createdAt: new Date() };
      state.users.push(user);
      return user;
    },
    upsert: async ({
      where,
      create,
    }: {
      where: { email: string };
      update: Record<string, unknown>;
      create: { name: string; email: string; passwordHash: string | null };
    }) => {
      const existing = state.users.find((u) => u.email === where.email);
      if (existing) return existing;
      const user = { ...create, id: nextId(), createdAt: new Date() };
      state.users.push(user);
      return user;
    },
  },
  refreshToken: {
    create: async ({
      data,
    }: {
      data: { userId: string; tokenHash: string; expiresAt: Date };
    }) => {
      const record = {
        ...data,
        id: nextId(),
        revoked: false,
        replacedBy: null as string | null,
      };
      state.refreshTokens.push(record);
      return record;
    },
    findUnique: async ({
      where: { tokenHash },
    }: {
      where: { tokenHash: string };
    }) => state.refreshTokens.find((t) => t.tokenHash === tokenHash) ?? null,
    update: async ({
      where: { id },
      data,
    }: {
      where: { id: string };
      data: Partial<RefreshToken>;
    }) => {
      const token = state.refreshTokens.find((t) => t.id === id)!;
      Object.assign(token, data);
      return token;
    },
    updateMany: async ({
      where: { tokenHash },
      data,
    }: {
      where: { tokenHash: string };
      data: Partial<RefreshToken>;
    }) => {
      let count = 0;
      state.refreshTokens.forEach((token) => {
        if (token.tokenHash === tokenHash) {
          Object.assign(token, data);
          count += 1;
        }
      });
      return { count };
    },
  },
  jobApplication: {
    findMany: async (args: {
      where: JobWhere;
      orderBy?: { updatedAt?: "desc"; createdAt?: "desc" };
      skip?: number;
      take?: number;
      select?: Record<string, boolean>;
    }) => {
      const { where, orderBy, skip = 0, take, select } = args;
      let rows = state.jobs.filter((job) => jobMatches(job, where));
      if (orderBy?.updatedAt === "desc") {
        rows = [...rows].sort(
          (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
        );
      } else if (orderBy?.createdAt === "desc") {
        rows = [...rows].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
      }
      const sliced =
        take !== undefined ? rows.slice(skip, skip + take) : rows.slice(skip);
      if (select) {
        return sliced.map((row) => {
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(select)) {
            if (select[key]) {
              out[key] = (row as unknown as Record<string, unknown>)[key];
            }
          }
          return out;
        });
      }
      return sliced;
    },
    count: async ({ where }: { where: JobWhere }) =>
      state.jobs.filter((job) => jobMatches(job, where)).length,
    create: async ({
      data,
    }: {
      data: {
        userId: string;
        company: string;
        role: string;
        status: "APPLIED" | "INTERVIEW" | "OFFER" | "REJECTED";
        starred?: boolean;
        jobUrl?: string | null;
        jobDescription?: string | null;
        source?: string | null;
        location?: string | null;
        salaryRange?: string | null;
        notes?: string | null;
        followUpAt?: Date | null;
      };
    }) => {
      const now = new Date();
      const created: Job = {
        ...data,
        starred: data.starred ?? false,
        id: nextId(),
        createdAt: now,
        updatedAt: now,
      };
      state.jobs.push(created);
      return created;
    },
    findUnique: async ({ where: { id } }: { where: { id: string } }) =>
      state.jobs.find((j) => j.id === id) ?? null,
    update: async ({
      where: { id },
      data,
    }: {
      where: { id: string };
      data: Partial<Job>;
    }) => {
      const existing = state.jobs.find((j) => j.id === id)!;
      Object.assign(existing, data, { updatedAt: new Date() });
      return existing;
    },
    delete: async ({ where: { id } }: { where: { id: string } }) => {
      state.jobs = state.jobs.filter((job) => job.id !== id);
      return { id };
    },
    groupBy: async ({
      where: { userId },
    }: {
      by: ["status"];
      where: { userId: string };
      _count: { _all: true };
    }) => {
      const grouped = new Map<string, number>();
      state.jobs
        .filter((job) => job.userId === userId)
        .forEach((job) =>
          grouped.set(job.status, (grouped.get(job.status) ?? 0) + 1),
        );
      return [...grouped.entries()].map(([status, count]) => ({
        status,
        _count: { _all: count },
      }));
    },
    createMany: async ({ data }: { data: Job[]; skipDuplicates: boolean }) => {
      state.jobs.push(...data);
      return { count: data.length };
    },
  },
  aiGeneration: {
    findFirst: async ({
      where: { userId, type },
    }: {
      where: { userId: string; type: Generation["type"] };
      orderBy: { version: "desc" };
      select: { version: true };
    }) => {
      const entries = state.generations
        .filter((g) => g.userId === userId && g.type === type)
        .sort((a, b) => b.version - a.version);
      return entries[0] ? { version: entries[0].version } : null;
    },
    create: async ({
      data,
    }: {
      data: Omit<Generation, "id" | "createdAt" | "updatedAt">;
    }) => {
      const now = new Date();
      const entry = { ...data, id: nextId(), createdAt: now, updatedAt: now };
      state.generations.push(entry);
      return entry;
    },
    findMany: async (args: {
      where: { userId: string };
      orderBy?: { createdAt?: "desc" };
      take?: number;
      select?: Record<string, boolean>;
    }) => {
      const { where, orderBy, take, select } = args;
      let rows = state.generations.filter((g) => g.userId === where.userId);
      if (orderBy?.createdAt === "desc") {
        rows = [...rows].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
      }
      const sliced = take !== undefined ? rows.slice(0, take) : rows;
      if (select) {
        return sliced.map((row) => {
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(select)) {
            if (select[key]) {
              out[key] = (row as unknown as Record<string, unknown>)[key];
            }
          }
          return out;
        });
      }
      return sliced;
    },
    findUnique: async ({ where: { id } }: { where: { id: string } }) =>
      state.generations.find((g) => g.id === id) ?? null,
  },
  jobTimelineEvent: {
    create: async ({
      data,
    }: {
      data: {
        userId: string;
        jobId?: string;
        eventType: string;
        message: string;
        payloadJson?: unknown;
      };
    }) => {
      const event: JobTimelineEvent = {
        id: nextId(),
        userId: data.userId,
        jobId: data.jobId ?? null,
        eventType: data.eventType,
        message: data.message,
        payloadJson: data.payloadJson,
        createdAt: new Date(),
      };
      state.timelineEvents.push(event);
      return event;
    },
    findMany: async (args: {
      where: { userId: string; jobId?: string };
      orderBy?: { createdAt?: "desc" };
      take?: number;
      include?: {
        job?: { select: { id: boolean; company: boolean; role: boolean } };
      };
    }) => {
      const { where, orderBy, take, include } = args;
      let rows = state.timelineEvents.filter(
        (event) =>
          event.userId === where.userId &&
          (!where.jobId || event.jobId === where.jobId),
      );
      if (orderBy?.createdAt === "desc") {
        rows = [...rows].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
      }
      const sliced = take !== undefined ? rows.slice(0, take) : rows;
      if (!include?.job) return sliced;
      return sliced.map((event) => ({
        ...event,
        job: event.jobId
          ? (() => {
              const job = state.jobs.find((row) => row.id === event.jobId);
              return job
                ? { id: job.id, company: job.company, role: job.role }
                : null;
            })()
          : null,
      }));
    },
  },
  companyInsight: {
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: {
        userId_normalizedCompany: { userId: string; normalizedCompany: string };
      };
      create: Omit<
        CompanyInsight,
        "id" | "createdAt" | "updatedAt" | "lastRefreshedAt"
      >;
      update: Partial<CompanyInsight>;
    }) => {
      const existing = state.companyInsights.find(
        (row) =>
          row.userId === where.userId_normalizedCompany.userId &&
          row.normalizedCompany ===
            where.userId_normalizedCompany.normalizedCompany,
      );
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        return existing;
      }
      const now = new Date();
      const record: CompanyInsight = {
        id: nextId(),
        userId: create.userId,
        companyName: create.companyName,
        normalizedCompany: create.normalizedCompany,
        industry: create.industry,
        companySize: create.companySize,
        fundingStage: create.fundingStage,
        techStack: create.techStack,
        recentNews: create.recentNews,
        commonInterviewQuestions: Array.isArray(
          (create as { commonInterviewQuestions?: unknown })
            .commonInterviewQuestions,
        )
          ? (create as { commonInterviewQuestions: string[] })
              .commonInterviewQuestions
          : [],
        lastRefreshedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      state.companyInsights.push(record);
      return record;
    },
  },
};
