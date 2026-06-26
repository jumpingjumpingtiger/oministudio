import path from "node:path";
import { resolveEmbeddingDim, isEmbeddingConfigured } from "@/lib/engine/embedding";
import type { VectorStore } from "./types";

export type { VectorStore, VectorMatch, VectorUpsert } from "./types";

type Backend = "pg" | "sqlite" | "off";

/**
 * Dedicated absolute path for the local vector DB. Kept separate from Prisma's
 * dev.db so two native SQLite drivers don't share one file, and absolute so it
 * never depends on cwd (Prisma resolves `file:../.data/...` relative to the
 * prisma/ dir; better-sqlite3 would resolve it relative to cwd — wrong dir).
 */
function defaultSqliteVectorUrl(): string {
  return `file:${path.join(process.cwd(), ".data", "vector", "index.db")}`;
}

function resolveBackend(): { backend: Backend; url: string } {
  const override = (process.env.VECTOR_DB || "").toLowerCase();
  if (override === "off") return { backend: "off", url: "" };

  const explicit = process.env.VECTOR_DATABASE_URL?.trim();
  if (explicit) {
    if (override === "pg" || /^postgres(ql)?:\/\//i.test(explicit)) {
      return { backend: "pg", url: explicit };
    }
    return { backend: "sqlite", url: explicit };
  }

  const dbUrl = process.env.DATABASE_URL?.trim() || "";
  if (override === "pg" || /^postgres(ql)?:\/\//i.test(dbUrl)) {
    return { backend: "pg", url: dbUrl };
  }
  // Local sqlite: always use the dedicated absolute vector file.
  return { backend: "sqlite", url: defaultSqliteVectorUrl() };
}

function sqliteFilePath(url: string): string {
  // Accept "file:/abs/path", "file:./rel", "file:../rel", or a bare path.
  const stripped = url.replace(/^file:/, "") || defaultSqliteVectorUrl().replace(/^file:/, "");
  return path.isAbsolute(stripped) ? stripped : path.resolve(process.cwd(), stripped);
}

let storePromise: Promise<VectorStore | null> | null = null;

async function createStore(): Promise<VectorStore | null> {
  // Vectors require embeddings; without them we fall back to TF-IDF retrieval.
  if (!isEmbeddingConfigured()) return null;

  const { backend, url } = resolveBackend();
  if (backend === "off") return null;

  try {
    const dim = await resolveEmbeddingDim();
    if (backend === "pg") {
      const { PgVectorStore } = await import("./pgvector-store");
      const store = new PgVectorStore(url, dim);
      await store.init();
      return store.available() ? store : null;
    }
    const { SqliteVecStore } = await import("./sqlite-vec-store");
    const store = new SqliteVecStore(sqliteFilePath(url), dim);
    await store.init();
    return store.available() ? store : null;
  } catch (error) {
    console.warn("[vector] store unavailable; using lexical fallback:", error);
    return null;
  }
}

/** Lazily-initialized singleton vector store, or null when unavailable. */
export function getVectorStore(): Promise<VectorStore | null> {
  if (!storePromise) storePromise = createStore();
  return storePromise;
}

/** Namespace helpers keep code-chunk and chat vectors isolated. */
export function codeNamespace(projectId: string, versionId: string): string {
  return `code:${projectId}:${versionId}`;
}

export function chatNamespace(projectId: string): string {
  return `chat:${projectId}`;
}
