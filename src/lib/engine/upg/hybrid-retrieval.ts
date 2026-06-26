import type { SlcChunk } from "./types";
import { tokenizeCode } from "./ast-parser";
import { getVectorStore } from "@/lib/vector";
import { embedText, embedTexts, hashContent } from "@/lib/engine/embedding";

const BM25_K1 = 1.4;
const BM25_B = 0.75;
const RRF_K = 60;

interface Corpus {
  chunks: SlcChunk[];
  docFreq: Map<string, number>;
  avgLen: number;
  idf: Map<string, number>;
}

function buildCorpus(chunks: SlcChunk[]): Corpus {
  const docFreq = new Map<string, number>();
  let totalLen = 0;
  for (const c of chunks) {
    totalLen += c.tokens.length;
    for (const t of new Set(c.tokens)) {
      docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    }
  }
  const N = chunks.length || 1;
  const idf = new Map<string, number>();
  for (const [term, df] of docFreq) {
    idf.set(term, Math.log(1 + (N - df + 0.5) / (df + 0.5)));
  }
  return { chunks, docFreq, avgLen: totalLen / N, idf };
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

function bm25Score(query: string[], chunk: SlcChunk, corpus: Corpus): number {
  const tf = termFreq(chunk.tokens);
  const len = chunk.tokens.length || 1;
  let score = 0;
  for (const term of query) {
    const f = tf.get(term);
    if (!f) continue;
    const idf = corpus.idf.get(term) ?? 0;
    const denom = f + BM25_K1 * (1 - BM25_B + (BM25_B * len) / corpus.avgLen);
    score += idf * ((f * (BM25_K1 + 1)) / denom);
  }
  return score;
}

/** Embedding-free dense stand-in: TF-IDF vector cosine similarity. */
function cosineScore(query: string[], chunk: SlcChunk, corpus: Corpus): number {
  const qtf = termFreq(query);
  const dtf = termFreq(chunk.tokens);
  let dot = 0;
  let qNorm = 0;
  let dNorm = 0;
  for (const [term, f] of qtf) {
    const w = f * (corpus.idf.get(term) ?? 0);
    qNorm += w * w;
    const df = dtf.get(term);
    if (df) dot += w * (df * (corpus.idf.get(term) ?? 0));
  }
  for (const [term, f] of dtf) {
    const w = f * (corpus.idf.get(term) ?? 0);
    dNorm += w * w;
  }
  if (qNorm === 0 || dNorm === 0) return 0;
  return dot / (Math.sqrt(qNorm) * Math.sqrt(dNorm));
}

function rankList(
  scores: { id: string; score: number }[]
): Map<string, number> {
  const ranks = new Map<string, number>();
  scores
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .forEach((s, i) => ranks.set(s.id, i + 1));
  return ranks;
}

export interface SeedAnchor {
  chunkId: string;
  score: number;
  bm25: number;
  cosine: number;
}

/**
 * Phase 1 — hybrid coarse retrieval.
 * Dense (TF-IDF cosine) + lexical (BM25), fused by Reciprocal Rank Fusion (RRF).
 */
export function hybridRetrieve(
  prompt: string,
  chunks: SlcChunk[],
  topK: number
): SeedAnchor[] {
  if (!chunks.length) return [];
  const corpus = buildCorpus(chunks);
  const query = tokenizeCode(prompt);
  if (!query.length) return [];

  const bm25: { id: string; score: number }[] = [];
  const cosine: { id: string; score: number }[] = [];
  const bm25Map = new Map<string, number>();
  const cosMap = new Map<string, number>();

  for (const c of chunks) {
    const b = bm25Score(query, c, corpus);
    const cs = cosineScore(query, c, corpus);
    bm25.push({ id: c.id, score: b });
    cosine.push({ id: c.id, score: cs });
    bm25Map.set(c.id, b);
    cosMap.set(c.id, cs);
  }

  const bm25Ranks = rankList(bm25);
  const cosRanks = rankList(cosine);

  const fused = new Map<string, number>();
  for (const id of new Set([...bm25Ranks.keys(), ...cosRanks.keys()])) {
    const rb = bm25Ranks.get(id);
    const rc = cosRanks.get(id);
    let f = 0;
    if (rb) f += 1 / (RRF_K + rb);
    if (rc) f += 1 / (RRF_K + rc);
    fused.set(id, f);
  }

  return [...fused.entries()]
    .map(([chunkId, score]) => ({
      chunkId,
      score,
      bm25: bm25Map.get(chunkId) ?? 0,
      cosine: cosMap.get(chunkId) ?? 0,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Text embedded per chunk — entity/scene/lifecycle context improves recall. */
function chunkEmbedText(chunk: SlcChunk): string {
  const scope = [chunk.sceneName, chunk.lifecycle, chunk.entityId, ...chunk.assetKeys]
    .filter(Boolean)
    .join(" ");
  return `${scope}\n${chunk.code}`;
}

/**
 * Hybrid retrieval with real embeddings (dense ANN via vector store) + BM25, RRF-fused.
 * Falls back to {@link hybridRetrieve} (TF-IDF cosine + BM25) when no vector store /
 * embedding provider is configured, or on any failure.
 */
export async function hybridRetrieveWithVectors(
  prompt: string,
  chunks: SlcChunk[],
  topK: number,
  namespace: string | null
): Promise<{ anchors: SeedAnchor[]; mode: "dense" | "lexical" }> {
  if (!chunks.length || !namespace) {
    return { anchors: hybridRetrieve(prompt, chunks, topK), mode: "lexical" };
  }

  const store = await getVectorStore();
  if (!store) {
    return { anchors: hybridRetrieve(prompt, chunks, topK), mode: "lexical" };
  }

  try {
    const texts = chunks.map(chunkEmbedText);
    const keys = texts.map(hashContent);
    const keyToChunk = new Map<string, SlcChunk>();
    keys.forEach((k, i) => keyToChunk.set(k, chunks[i]));

    // Embed + persist only chunks not already cached in this namespace.
    const existing = await store.existingKeys(namespace, keys);
    const missing = keys
      .map((k, i) => ({ key: k, i }))
      .filter((x) => !existing.has(x.key));
    if (missing.length) {
      const vecs = await embedTexts(missing.map((x) => texts[x.i]));
      if (!vecs) return { anchors: hybridRetrieve(prompt, chunks, topK), mode: "lexical" };
      await store.upsert(
        namespace,
        missing.map((x, j) => ({ key: x.key, embedding: vecs[j] }))
      );
    }

    const qvec = await embedText(prompt);
    if (!qvec) return { anchors: hybridRetrieve(prompt, chunks, topK), mode: "lexical" };

    const denseMatches = await store.query(namespace, qvec, Math.max(topK * 2, topK + 6));
    const denseRanks = new Map<string, number>();
    const denseScore = new Map<string, number>();
    let rank = 0;
    for (const m of denseMatches) {
      const chunk = keyToChunk.get(m.key);
      if (!chunk) continue;
      rank += 1;
      denseRanks.set(chunk.id, rank);
      denseScore.set(chunk.id, m.score);
    }

    // Lexical leg (BM25) computed in-memory.
    const corpus = buildCorpus(chunks);
    const query = tokenizeCode(prompt);
    const bm25Scored: { id: string; score: number }[] = [];
    const bm25Map = new Map<string, number>();
    for (const c of chunks) {
      const b = bm25Score(query, c, corpus);
      bm25Scored.push({ id: c.id, score: b });
      bm25Map.set(c.id, b);
    }
    const bm25Ranks = rankList(bm25Scored);

    const fused = new Map<string, number>();
    for (const id of new Set([...denseRanks.keys(), ...bm25Ranks.keys()])) {
      const rd = denseRanks.get(id);
      const rb = bm25Ranks.get(id);
      let f = 0;
      if (rd) f += 1 / (RRF_K + rd);
      if (rb) f += 1 / (RRF_K + rb);
      fused.set(id, f);
    }

    const anchors = [...fused.entries()]
      .map(([chunkId, score]) => ({
        chunkId,
        score,
        bm25: bm25Map.get(chunkId) ?? 0,
        cosine: denseScore.get(chunkId) ?? 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // If dense produced nothing useful, fall back so we never return empty seeds.
    if (!anchors.length) {
      return { anchors: hybridRetrieve(prompt, chunks, topK), mode: "lexical" };
    }
    return { anchors, mode: "dense" };
  } catch (error) {
    console.warn("[upg] dense retrieval failed, using lexical fallback:", error);
    return { anchors: hybridRetrieve(prompt, chunks, topK), mode: "lexical" };
  }
}
