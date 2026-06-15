import { PrismaClient } from "@prisma/client";
import { getDatabaseUrl } from "@/lib/db-path";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  // SQLite paths in .env are relative to prisma/schema.prisma for CLI,
  // but relative to process.cwd() at runtime — use an absolute path instead.
  process.env.DATABASE_URL = getDatabaseUrl();

  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
