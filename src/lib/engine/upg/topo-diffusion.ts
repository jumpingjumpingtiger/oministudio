import type { PhaserGraph, RetrievedChunk, UpgNode } from "./types";
import type { SeedAnchor } from "./hybrid-retrieval";
import { nodeForChunk, outNeighbors } from "./upg-graph";

export interface DiffusionOptions {
  /** Max total characters of code chunks to include. */
  maxChars: number;
  /** Hard cap on chunk count. */
  maxChunks: number;
}

/**
 * Phase 2 — UPG topological self-healing diffusion.
 * Expand seed anchors along dependency edges to capture safe dependencies,
 * prune everything unrelated.
 */
export function diffuseContext(
  graph: PhaserGraph,
  seeds: SeedAnchor[],
  options: DiffusionOptions
): { chunks: RetrievedChunk[]; trace: string[] } {
  const trace: string[] = [];
  const included = new Map<string, RetrievedChunk>();
  const seedScore = new Map<string, number>(seeds.map((s) => [s.chunkId, s.score]));

  const addChunk = (chunkId: string, reason: RetrievedChunk["reason"], score: number) => {
    if (included.has(chunkId)) return;
    const chunk = graph.chunks.get(chunkId);
    if (!chunk) return;
    included.set(chunkId, { chunk, score, reason });
  };

  const addNodeChunks = (node: UpgNode, reason: RetrievedChunk["reason"]) => {
    for (const cid of node.chunkIds) {
      addChunk(cid, reason, seedScore.get(cid) ?? 0.001);
    }
  };

  // Seed nodes + worklist.
  const visited = new Set<string>();
  const worklist: { nodeId: string; reason: RetrievedChunk["reason"] }[] = [];

  for (const seed of seeds) {
    addChunk(seed.chunkId, "seed", seed.score);
    const node = nodeForChunk(graph, seed.chunkId);
    if (node) worklist.push({ nodeId: node.id, reason: "seed" });
  }

  // Always include global config (physics/canvas/scene rules).
  for (const node of graph.nodes.values()) {
    if (node.domain === "config") {
      addNodeChunks(node, "config");
      trace.push(`[config] included global game config`);
    }
  }

  while (worklist.length) {
    const { nodeId, reason } = worklist.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = graph.nodes.get(nodeId);
    if (!node) continue;

    if (reason !== "seed") addNodeChunks(node, reason);

    if (node.domain === "control") {
      // Vertical: control -> world (where is the entity defined?)
      for (const worldId of outNeighbors(graph, nodeId, ["dependency_def"])) {
        if (!visited.has(worldId)) {
          worklist.push({ nodeId: worldId, reason: "vertical" });
          trace.push(`[vertical] ${node.label} → ${graph.nodes.get(worldId)?.label}`);
        }
      }
      // Cleanup binding: events <-> cleanup
      for (const cleanupId of outNeighbors(graph, nodeId, ["cleanup_flow"])) {
        if (!visited.has(cleanupId)) {
          worklist.push({ nodeId: cleanupId, reason: "cleanup" });
          trace.push(`[cleanup] ${node.label} ↔ ${graph.nodes.get(cleanupId)?.label}`);
        }
      }
      if (node.flags?.length) {
        trace.push(`[warn] ${node.label}: ${node.flags.join("; ")}`);
      }
    }

    if (node.domain === "world") {
      // Horizontal: world -> resource (preload binding)
      for (const resId of outNeighbors(graph, nodeId, ["asset_binding"])) {
        if (!visited.has(resId)) {
          worklist.push({ nodeId: resId, reason: "horizontal" });
          trace.push(`[horizontal] ${node.label} → ${graph.nodes.get(resId)?.label}`);
        }
      }
      // World entity may also be driven by an update control node (pull it in).
      for (const ctrlId of outNeighbors(graph, nodeId, ["temporal_control"])) {
        if (!visited.has(ctrlId)) {
          worklist.push({ nodeId: ctrlId, reason: "vertical" });
        }
      }
    }
  }

  // Order: seeds first (by score), then by file + line for readability.
  const ordered = [...included.values()].sort((a, b) => {
    if (a.reason === "seed" && b.reason !== "seed") return -1;
    if (b.reason === "seed" && a.reason !== "seed") return 1;
    if (a.chunk.filePath !== b.chunk.filePath) {
      return a.chunk.filePath.localeCompare(b.chunk.filePath);
    }
    return a.chunk.startLine - b.chunk.startLine;
  });

  // Prune by budget (always keep seeds).
  const result: RetrievedChunk[] = [];
  let chars = 0;
  for (const rc of ordered) {
    if (result.length >= options.maxChunks && rc.reason !== "seed") continue;
    if (chars + rc.chunk.code.length > options.maxChars && rc.reason !== "seed") continue;
    result.push(rc);
    chars += rc.chunk.code.length;
  }

  trace.push(
    `[prune] kept ${result.length}/${graph.chunks.size} chunks (${chars} chars)`
  );
  return { chunks: result, trace };
}
