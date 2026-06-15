import { existsSync, mkdirSync } from "fs";
import path from "path";

export function getDatabaseUrl(): string {
  const dbDir = path.join(process.cwd(), ".data", "prisma");
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
  const dbFile = path.join(dbDir, "dev.db");
  return `file:${dbFile}`;
}

export function ensureDatabaseDir(): void {
  getDatabaseUrl();
}
