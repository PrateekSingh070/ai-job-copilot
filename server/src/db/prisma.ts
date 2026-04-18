import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.js";

declare global {
  var prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

let productionClient: PrismaClient | undefined;

function getPrismaSingleton(): PrismaClient {
  if (process.env.NODE_ENV !== "production") {
    if (!global.prisma) {
      global.prisma = createPrismaClient();
    }
    return global.prisma;
  }
  if (!productionClient) {
    productionClient = createPrismaClient();
  }
  return productionClient;
}

/** Lazy singleton so cold paths like `/health` avoid constructing the DB client. */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const client = getPrismaSingleton();
    return Reflect.get(client, prop, client);
  },
}) as PrismaClient;
