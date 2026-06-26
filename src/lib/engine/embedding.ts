import crypto from "crypto";
import OpenAI from "openai";

export type EmbeddingProvider = "openai" | "local";

const OPENAI_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const OPENAI_DEFAULT_DIM = 1536;
const LOCAL_DEFAULT_DIM = 384;
const MAX_BATCH = 256;
const MAX_INPUT_CHARS = 8_000;

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const v of values) {
    if (v?.trim()) return v.trim();
  }
  return undefined;
}

export function getEmbeddingApiKey(): string | undefined {
  return firstNonEmpty(
    process.env.EMBEDDING_OPENAI_API_KEY,
    process.env.BRAIN_OPENAI_API_KEY,
    process.env.OPENAI_API_KEY
  );
}

/**
 * Embedding provider. Explicit via EMBEDDING_PROVIDER=local|openai.
 * Defaults to "openai" (so local models are strictly opt-in and never
 * silently download). Local needs no API key.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  const explicit = (process.env.EMBEDDING_PROVIDER || "").toLowerCase();
  if (explicit === "local") return "local";
  return "openai";
}

/** Whether dense retrieval is available (else callers fall back to TF-IDF). */
export function isEmbeddingConfigured(): boolean {
  if (process.env.EMBEDDING_ENABLED === "false") return false;
  if (getEmbeddingProvider() === "local") return true;
  return !!getEmbeddingApiKey();
}

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: getEmbeddingApiKey(),
      baseURL: process.env.EMBEDDING_OPENAI_BASE_URL || undefined,
    });
  }
  return client;
}

/** L2-normalize so L2 distance ordering matches cosine ordering across backends. */
export function l2normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

export function hashContent(content: string): string {
  return crypto.createHash("sha1").update(content).digest("hex");
}

let cachedDim: number | null = null;

/**
 * Embedding dimension for the active provider/model. The vector store table is
 * created with this size, so it must be stable for a given deployment.
 */
export async function resolveEmbeddingDim(): Promise<number> {
  if (cachedDim) return cachedDim;
  if (process.env.EMBEDDING_DIM) {
    cachedDim = Number(process.env.EMBEDDING_DIM);
    return cachedDim;
  }
  if (getEmbeddingProvider() === "local") {
    // Use the known default dimension instead of loading the model here.
    // Loading onnxruntime eagerly (e.g. during vector-store init) adds native
    // churn; the model still loads lazily on first real embedding call.
    // The default multilingual MiniLM is 384-d — override EMBEDDING_DIM for others.
    cachedDim = LOCAL_DEFAULT_DIM;
    return cachedDim;
  }
  cachedDim = OPENAI_DEFAULT_DIM;
  return cachedDim;
}

async function embedOpenAI(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const res = await getClient().embeddings.create({
      model: OPENAI_MODEL,
      input: batch,
    });
    for (const item of res.data) out.push(item.embedding as number[]);
  }
  return out;
}

/**
 * Embed a batch of texts (normalized). Returns null when not configured or on
 * failure, so callers can fall back to TF-IDF retrieval.
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!isEmbeddingConfigured() || !texts.length) return null;
  try {
    const inputs = texts.map((t) => t.slice(0, MAX_INPUT_CHARS) || " ");
    const raw =
      getEmbeddingProvider() === "local"
        ? await (await import("./local-embedding")).embedTextsLocal(inputs)
        : await embedOpenAI(inputs);
    return raw.map(l2normalize);
  } catch (error) {
    console.warn("Embedding request failed, falling back to lexical retrieval:", error);
    return null;
  }
}

export async function embedText(text: string): Promise<number[] | null> {
  const out = await embedTexts([text]);
  return out ? out[0] : null;
}
