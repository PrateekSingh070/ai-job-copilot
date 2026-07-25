process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "4001";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5173";
process.env.AI_PROVIDER = "mock";
process.env.OPENAI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";
