import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { GenerationProgressEvent } from "@/lib/generation-progress";

/**
 * Per-invocation runtime shared by every graph node. Passed through
 * `config.configurable.runtime` so node state stays serializable and the SSE
 * `emit` callback never lands in a graph channel.
 */
export interface GraphRuntime {
  projectId: string;
  prompt: string;
  versionId?: string;
  signal?: AbortSignal;
  emit: (event: GenerationProgressEvent) => Promise<void>;
}

export interface NodeMeta {
  id: string;
  label: string;
  phase: "code" | "assets";
}

export function getRuntime(config: LangGraphRunnableConfig): GraphRuntime {
  const rt = config.configurable?.runtime as GraphRuntime | undefined;
  if (!rt) {
    throw new Error("Graph runtime missing (config.configurable.runtime)");
  }
  return rt;
}

/**
 * Wrap a node body so it automatically emits `node_started`/`node_completed`
 * to the chat feed. The body still emits its own fine-grained progress events.
 */
export function defineNode<S extends object>(
  meta: NodeMeta,
  fn: (state: S, rt: GraphRuntime) => Promise<Partial<S>>
): (state: S, config: LangGraphRunnableConfig) => Promise<Partial<S>> {
  return async (state, config) => {
    const rt = getRuntime(config);
    await rt.emit({ type: "node_started", node: meta.id, label: meta.label, phase: meta.phase });
    const update = await fn(state, rt);
    await rt.emit({ type: "node_completed", node: meta.id, label: meta.label, phase: meta.phase });
    return update ?? ({} as Partial<S>);
  };
}
