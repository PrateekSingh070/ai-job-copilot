// In-memory stand-in for the Prisma client. Tests swap it in with vi.mock so
// the whole API can be exercised over HTTP without a database.

function jobMatches(job, where) {
  if (job.userId !== where.userId) return false;
  if (where.status && job.status !== where.status) return false;
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
};

let seq = 0;
const nextId = () => `id_${++seq}`;

export function resetState() {
  state.users = [];
  state.refreshTokens = [];
  state.jobs = [];
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
    findMany: async ({ where, orderBy, skip = 0, take }) => {
      let rows = state.jobs.filter((job) => jobMatches(job, where));
      if (orderBy?.updatedAt === "desc") {
        rows = [...rows].sort(
          (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
        );
      }
      return take !== undefined
        ? rows.slice(skip, skip + take)
        : rows.slice(skip);
    },
    count: async ({ where }) =>
      state.jobs.filter((job) => jobMatches(job, where)).length,
    create: async ({ data }) => {
      const now = new Date();
      const created = { ...data, id: nextId(), createdAt: now, updatedAt: now };
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
  },
};
