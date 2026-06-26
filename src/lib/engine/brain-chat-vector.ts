import type { BrainChatMessage } from "@/lib/engine/brain-context";
import { getVectorStore } from "@/lib/vector";
import { embedText, embedTexts, hashContent } from "@/lib/engine/embedding";

function messageKey(msg: BrainChatMessage): string {
  return msg.id || `h:${hashContent(`${msg.role}:${msg.content}`)}`;
}

/**
 * Persistent semantic recall over long chat histories.
 * Embeds candidate older messages once (cached in the chat namespace), then ANN-queries
 * by the current prompt. Returns the most relevant older messages, or [] when the vector
 * store / embeddings are unavailable (caller keeps its lexical recall).
 */
export async function recallChatByVector(params: {
  candidates: BrainChatMessage[];
  prompt: string;
  namespace: string | null;
  topK: number;
}): Promise<BrainChatMessage[]> {
  const { candidates, prompt, namespace, topK } = params;
  if (!namespace || !candidates.length || topK <= 0) return [];

  const store = await getVectorStore();
  if (!store) return [];

  try {
    const keyToMsg = new Map<string, BrainChatMessage>();
    const keys: string[] = [];
    const texts: string[] = [];
    for (const msg of candidates) {
      const key = messageKey(msg);
      if (keyToMsg.has(key)) continue;
      keyToMsg.set(key, msg);
      keys.push(key);
      texts.push(msg.content);
    }

    const existing = await store.existingKeys(namespace, keys);
    const missing = keys
      .map((k, i) => ({ key: k, i }))
      .filter((x) => !existing.has(x.key));
    if (missing.length) {
      const vecs = await embedTexts(missing.map((x) => texts[x.i]));
      if (!vecs) return [];
      await store.upsert(
        namespace,
        missing.map((x, j) => ({ key: x.key, embedding: vecs[j] }))
      );
    }

    const qvec = await embedText(prompt);
    if (!qvec) return [];

    const matches = await store.query(namespace, qvec, topK);
    const out: BrainChatMessage[] = [];
    for (const m of matches) {
      const msg = keyToMsg.get(m.key);
      if (msg) out.push(msg);
    }
    return out;
  } catch (error) {
    console.warn("[chat-rag] vector recall failed:", error);
    return [];
  }
}
