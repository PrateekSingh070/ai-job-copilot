function jobMatches(job, where) {
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
  users: [],
  refreshTokens: [],
  jobs: [],
  generations: [],
  timelineEvents: [],
  companyInsights: [],
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
    findUnique: async ({ where: { email, id } }) =>
      state.users.find((u) => (email ? u.email === email : u.id === id)) ??
      null,
    create: async ({ data }) => {
      const user = { ...data, id: nextId(), createdAt: new Date() };
      state.users.push(user);
      return user;
    },
    upsert: async ({ where, create }) => {
      const existing = state.users.find((u) => u.email === where.email);
      if (existing) return existing;
      const user = { ...create, id: nextId(), createdAt: new Date() };
      state.users.push(user);
      return user;
    },
  },
  refreshToken: {
    create: async ({ data }) => {
      const record = {
        ...data,
        id: nextId(),
        revoked: false,
        replacedBy: null,
      };
      state.refreshTokens.push(record);
      return record;
    },
    findUnique: async ({ where: { tokenHash } }) =>
      state.refreshTokens.find((t) => t.tokenHash === tokenHash) ?? null,
    update: async ({ where: { id }, data }) => {
      const token = state.refreshTokens.find((t) => t.id === id);
      Object.assign(token, data);
      return token;
    },
    updateMany: async ({ where: { tokenHash }, data }) => {
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
    findMany: async (args) => {
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
          const out = {};
          for (const key of Object.keys(select)) {
            if (select[key]) {
              out[key] = row[key];
            }
          }
          return out;
        });
      }
      return sliced;
    },
    count: async ({ where }) =>
      state.jobs.filter((job) => jobMatches(job, where)).length,
    create: async ({ data }) => {
      const now = new Date();
      const created = {
        ...data,
        starred: data.starred ?? false,
        id: nextId(),
        createdAt: now,
        updatedAt: now,
      };
      state.jobs.push(created);
      return created;
    },
    findUnique: async ({ where: { id } }) =>
      state.jobs.find((j) => j.id === id) ?? null,
    update: async ({ where: { id }, data }) => {
      const existing = state.jobs.find((j) => j.id === id);
      Object.assign(existing, data, { updatedAt: new Date() });
      return existing;
    },
    delete: async ({ where: { id } }) => {
      state.jobs = state.jobs.filter((job) => job.id !== id);
      return { id };
    },
    groupBy: async ({ where: { userId } }) => {
      const grouped = new Map();
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
    createMany: async ({ data }) => {
      state.jobs.push(...data);
      return { count: data.length };
    },
  },
  aiGeneration: {
    findFirst: async ({ where: { userId, type } }) => {
      const entries = state.generations
        .filter((g) => g.userId === userId && g.type === type)
        .sort((a, b) => b.version - a.version);
      return entries[0] ? { version: entries[0].version } : null;
    },
    create: async ({ data }) => {
      const now = new Date();
      const entry = { ...data, id: nextId(), createdAt: now, updatedAt: now };
      state.generations.push(entry);
      return entry;
    },
    findMany: async (args) => {
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
          const out = {};
          for (const key of Object.keys(select)) {
            if (select[key]) {
              out[key] = row[key];
            }
          }
          return out;
        });
      }
      return sliced;
    },
    findUnique: async ({ where: { id } }) =>
      state.generations.find((g) => g.id === id) ?? null,
  },
  jobTimelineEvent: {
    create: async ({ data }) => {
      const event = {
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
    findMany: async (args) => {
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
    upsert: async ({ where, create, update }) => {
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
      const record = {
        id: nextId(),
        userId: create.userId,
        companyName: create.companyName,
        normalizedCompany: create.normalizedCompany,
        industry: create.industry,
        companySize: create.companySize,
        fundingStage: create.fundingStage,
        techStack: create.techStack,
        recentNews: create.recentNews,
        commonInterviewQuestions: Array.isArray(create.commonInterviewQuestions)
          ? create.commonInterviewQuestions
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
