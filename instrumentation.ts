/**
 * Next.js server startup hook. Warms the local embedding model into memory so the
 * first generation request doesn't pay the load cost. Loads from the on-disk cache
 * only — no network/proxy at runtime (set HF_HUB_OFFLINE=1 to enforce).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.EMBEDDING_WARMUP === "false") return;
  if ((process.env.EMBEDDING_PROVIDER || "").toLowerCase() !== "local") return;

  // Fire-and-forget: never block server boot on model loading.
  void (async () => {
    try {
      const { embedText } = await import("@/lib/engine/embedding");
      const t0 = Date.now();
      const vec = await embedText("warmup");
      if (vec) {
        console.info(
          `[embedding] local model warmed in ${((Date.now() - t0) / 1000).toFixed(1)}s (dim=${vec.length})`
        );
      } else {
        console.warn(
          "[embedding] warmup produced no vector — dense retrieval will fall back to lexical"
        );
      }
    } catch (error) {
      console.warn("[embedding] warmup failed (will lazy-load on first use):", error);
    }
  })();
}
