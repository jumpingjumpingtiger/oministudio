/**
 * Process-wide single-flight lock for ALL native onnxruntime work.
 *
 * Two libraries in this app run ONNX models through onnxruntime-node:
 *   - @huggingface/transformers (local embeddings)
 *   - @imgly/background-removal-node (PNG background removal)
 *
 * onnxruntime-node dispatches inference to the libuv threadpool. Overlapping
 * native runs — even across different libraries/sessions — can corrupt the
 * shared native allocator and crash the process with
 * "malloc: pointer being freed was not allocated".
 *
 * Routing every ONNX inference through this queue guarantees they never run
 * concurrently. ONNX work is not the throughput bottleneck (the LLM is), so the
 * serialization cost is negligible.
 */
let chain: Promise<unknown> = Promise.resolve();

export function runExclusiveOnnx<T>(task: () => Promise<T>): Promise<T> {
  const result = chain.then(task, task);
  // Keep the chain alive without leaking the previous result or its rejection.
  chain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
