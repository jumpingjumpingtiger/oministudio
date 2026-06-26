import { Pool } from "pg";
import type { VectorMatch, VectorStore, VectorUpsert } from "./types";

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

function distanceToScore(distance: number): number {
  return 1 / (1 + distance);
}

/**
 * Production vector store backed by Postgres + pgvector.
 * Single table with a namespace column; HNSW index for ANN.
 */
export class PgVectorStore implements VectorStore {
  readonly backend = "pgvector" as const;
  private pool: Pool | null = null;
  private ready = false;
  private dead = false;
  private readonly dim: number;
  private readonly connectionString: string;

  constructor(connectionString: string, dim: number) {
    this.connectionString = connectionString;
    this.dim = dim;
  }

  available(): boolean {
    return this.ready && !this.dead;
  }

  async init(): Promise<void> {
    if (this.ready || this.dead) return;
    try {
      const pool = new Pool({ connectionString: this.connectionString, max: 4 });
      await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS vec_items (
          ns        TEXT NOT NULL,
          key       TEXT NOT NULL,
          embedding vector(${this.dim}) NOT NULL,
          PRIMARY KEY (ns, key)
        )
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS vec_items_hnsw
           ON vec_items USING hnsw (embedding vector_l2_ops)`
      );
      await pool.query(`CREATE INDEX IF NOT EXISTS vec_items_ns ON vec_items (ns)`);
      this.pool = pool;
      this.ready = true;
    } catch (error) {
      this.dead = true;
      console.warn("[vector] pgvector init failed; vector retrieval disabled:", error);
    }
  }

  async existingKeys(ns: string, keys: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    if (!this.available() || !keys.length) return out;
    try {
      const res = await this.pool!.query<{ key: string }>(
        "SELECT key FROM vec_items WHERE ns = $1 AND key = ANY($2)",
        [ns, keys]
      );
      for (const row of res.rows) out.add(row.key);
    } catch (error) {
      console.warn("[vector] pgvector existingKeys failed:", error);
    }
    return out;
  }

  async upsert(ns: string, items: VectorUpsert[]): Promise<void> {
    if (!this.available() || !items.length) return;
    const client = await this.pool!.connect();
    try {
      await client.query("BEGIN");
      for (const item of items) {
        await client.query(
          `INSERT INTO vec_items (ns, key, embedding)
             VALUES ($1, $2, $3::vector)
           ON CONFLICT (ns, key) DO NOTHING`,
          [ns, item.key, toVectorLiteral(item.embedding)]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.warn("[vector] pgvector upsert failed:", error);
    } finally {
      client.release();
    }
  }

  async query(ns: string, embedding: number[], topK: number): Promise<VectorMatch[]> {
    if (!this.available()) return [];
    try {
      const res = await this.pool!.query<{ key: string; distance: number }>(
        `SELECT key, embedding <-> $1::vector AS distance
           FROM vec_items
          WHERE ns = $2
          ORDER BY distance
          LIMIT $3`,
        [toVectorLiteral(embedding), ns, topK]
      );
      return res.rows.map((r) => ({
        key: r.key,
        score: distanceToScore(Number(r.distance)),
      }));
    } catch (error) {
      console.warn("[vector] pgvector query failed:", error);
      return [];
    }
  }

  async deleteNamespace(ns: string): Promise<void> {
    if (!this.available()) return;
    try {
      await this.pool!.query("DELETE FROM vec_items WHERE ns = $1", [ns]);
    } catch (error) {
      console.warn("[vector] pgvector delete failed:", error);
    }
  }
}
