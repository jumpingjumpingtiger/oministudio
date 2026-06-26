export interface VectorUpsert {
  key: string;
  embedding: number[];
}

export interface VectorMatch {
  key: string;
  /** Higher is more similar (derived from distance). */
  score: number;
}

/**
 * Minimal vector store contract, backed by native ANN
 * (pgvector in production, sqlite-vec locally). Namespaces isolate
 * code-chunk vectors (per project+version) from chat vectors (per project).
 */
export interface VectorStore {
  readonly backend: "pgvector" | "sqlite-vec";
  available(): boolean;
  init(): Promise<void>;
  existingKeys(ns: string, keys: string[]): Promise<Set<string>>;
  upsert(ns: string, items: VectorUpsert[]): Promise<void>;
  query(ns: string, embedding: number[], topK: number): Promise<VectorMatch[]>;
  deleteNamespace(ns: string): Promise<void>;
}
