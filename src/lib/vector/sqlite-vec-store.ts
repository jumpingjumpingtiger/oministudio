import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type { VectorMatch, VectorStore, VectorUpsert } from "./types";

type Stmt = Database.Statement;

function toBuffer(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

/** Distance (L2 over unit vectors, range [0,2]) → similarity score in (0,1]. */
function distanceToScore(distance: number): number {
  return 1 / (1 + distance);
}

/**
 * Local vector store backed by sqlite-vec (vec0 virtual table).
 * Uses a companion table to map string keys → integer rowids.
 */
export class SqliteVecStore implements VectorStore {
  readonly backend = "sqlite-vec" as const;
  private db: Database.Database | null = null;
  private ready = false;
  private dead = false;
  private readonly dim: number;
  private readonly dbPath: string;

  private stmtExisting?: Stmt;
  private stmtInsertKey?: Stmt;
  private stmtInsertVec?: Stmt;
  private stmtQuery?: Stmt;

  constructor(dbPath: string, dim: number) {
    this.dbPath = dbPath;
    this.dim = dim;
  }

  available(): boolean {
    return this.ready && !this.dead;
  }

  async init(): Promise<void> {
    if (this.ready || this.dead) return;
    try {
      mkdirSync(path.dirname(this.dbPath), { recursive: true });
      const db = new Database(this.dbPath);
      db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 5000");
      sqliteVec.load(db);

      db.exec(`
        CREATE TABLE IF NOT EXISTS vec_keys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ns  TEXT NOT NULL,
          key TEXT NOT NULL,
          UNIQUE(ns, key)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(
          ns TEXT partition key,
          embedding float[${this.dim}],
          +ref TEXT
        );
      `);

      this.stmtExisting = db.prepare(
        "SELECT key FROM vec_keys WHERE ns = ? AND key = ?"
      );
      this.stmtInsertKey = db.prepare(
        "INSERT OR IGNORE INTO vec_keys (ns, key) VALUES (?, ?)"
      );
      this.stmtInsertVec = db.prepare(
        "INSERT INTO vec_items (rowid, ns, embedding, ref) VALUES (?, ?, ?, ?)"
      );
      this.stmtQuery = db.prepare(
        "SELECT ref, distance FROM vec_items WHERE embedding MATCH ? AND ns = ? ORDER BY distance LIMIT ?"
      );

      this.db = db;
      this.ready = true;
    } catch (error) {
      this.dead = true;
      console.warn("[vector] sqlite-vec init failed; vector retrieval disabled:", error);
    }
  }

  async existingKeys(ns: string, keys: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    if (!this.available() || !keys.length) return out;
    for (const key of keys) {
      const row = this.stmtExisting!.get(ns, key) as { key: string } | undefined;
      if (row) out.add(row.key);
    }
    return out;
  }

  async upsert(ns: string, items: VectorUpsert[]): Promise<void> {
    if (!this.available() || !items.length) return;
    const db = this.db!;
    const tx = db.transaction((batch: VectorUpsert[]) => {
      for (const item of batch) {
        const info = this.stmtInsertKey!.run(ns, item.key);
        if (info.changes > 0) {
          this.stmtInsertVec!.run(
            BigInt(info.lastInsertRowid as number),
            ns,
            toBuffer(item.embedding),
            item.key
          );
        }
      }
    });
    try {
      tx(items);
    } catch (error) {
      console.warn("[vector] sqlite-vec upsert failed:", error);
    }
  }

  async query(ns: string, embedding: number[], topK: number): Promise<VectorMatch[]> {
    if (!this.available()) return [];
    try {
      const rows = this.stmtQuery!.all(toBuffer(embedding), ns, topK) as {
        ref: string;
        distance: number;
      }[];
      return rows.map((r) => ({ key: r.ref, score: distanceToScore(r.distance) }));
    } catch (error) {
      console.warn("[vector] sqlite-vec query failed:", error);
      return [];
    }
  }

  async deleteNamespace(ns: string): Promise<void> {
    if (!this.available()) return;
    try {
      this.db!.prepare("DELETE FROM vec_items WHERE ns = ?").run(ns);
      this.db!.prepare("DELETE FROM vec_keys WHERE ns = ?").run(ns);
    } catch (error) {
      console.warn("[vector] sqlite-vec delete failed:", error);
    }
  }
}
