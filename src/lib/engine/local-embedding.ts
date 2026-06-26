/**
 * Local (no-API) embeddings via Transformers.js — runs an ONNX model in-process.
 * The model is downloaded from Hugging Face on first use and cached on disk; after
 * that it works fully offline. Default is a multilingual MiniLM so Chinese prompts
 * and English code embed into the same space.
 */

import { runExclusiveOnnx } from "@/lib/engine/native-onnx-lock";

export const DEFAULT_LOCAL_EMBEDDING_MODEL =
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

type FeatureExtractor = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean }
) => Promise<{ tolist: () => number[][] }>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

function getModelId(): string {
  return process.env.EMBEDDING_MODEL?.trim() || DEFAULT_LOCAL_EMBEDDING_MODEL;
}

async function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const mod = await import("@huggingface/transformers");
      const { pipeline, env } = mod;
      if (process.env.LOCAL_EMBEDDING_CACHE_DIR) {
        env.cacheDir = process.env.LOCAL_EMBEDDING_CACHE_DIR;
      }
      // Mirror support (e.g. https://hf-mirror.com for restricted networks).
      const endpoint = process.env.HF_ENDPOINT?.trim();
      if (endpoint) {
        (env as unknown as { remoteHost?: string }).remoteHost = endpoint;
      }
      if (process.env.HF_HUB_OFFLINE === "1") {
        env.allowRemoteModels = false;
      }
      const dtype = process.env.LOCAL_EMBEDDING_DTYPE || "q8";
      const extractor = (await pipeline("feature-extraction", getModelId(), {
        dtype,
      } as unknown as Record<string, unknown>)) as unknown as FeatureExtractor;
      return extractor;
    })().catch((error) => {
      extractorPromise = null; // allow retry on next call
      throw error;
    });
  }
  return extractorPromise;
}

/** Embed texts locally. Returns mean-pooled, L2-normalized vectors. */
export async function embedTextsLocal(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor();
  // Serialized with all other native ONNX work (e.g. background removal) to
  // avoid concurrent onnxruntime-node runs corrupting the native heap.
  return runExclusiveOnnx(async () => {
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  });
}

/** Probe the model's embedding dimension (loads the model). */
export async function localEmbeddingDim(): Promise<number> {
  const vecs = await embedTextsLocal([" "]);
  return vecs[0]?.length ?? 384;
}
