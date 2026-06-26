import type { GeneratedFile } from "@/lib/types";
import type { PhaserGraph, SlcChunk, UpgEdge, UpgNode } from "./types";
import { isJsFile, parseJsFile } from "./ast-parser";
import { analyzeFile, resetChunkSeq, type FileAnalysis } from "./slc-chunker";

function sceneTag(scene: string | null): string {
  return scene || "-";
}

function ensureNode(
  nodes: Map<string, UpgNode>,
  node: Omit<UpgNode, "chunkIds"> & { chunkId?: string }
): UpgNode {
  const existing = nodes.get(node.id);
  if (existing) {
    if (node.chunkId && !existing.chunkIds.includes(node.chunkId)) {
      existing.chunkIds.push(node.chunkId);
    }
    return existing;
  }
  const created: UpgNode = {
    id: node.id,
    domain: node.domain,
    label: node.label,
    filePath: node.filePath,
    sceneName: node.sceneName,
    key: node.key,
    chunkIds: node.chunkId ? [node.chunkId] : [],
    flags: [],
  };
  nodes.set(created.id, created);
  return created;
}

/**
 * Build the Unified Phaser Graph from the active version's code files.
 * Deterministic static analysis — no LLM involvement.
 */
export function buildPhaserGraph(files: GeneratedFile[]): PhaserGraph {
  resetChunkSeq();

  const nodes = new Map<string, UpgNode>();
  const edges: UpgEdge[] = [];
  const chunks = new Map<string, SlcChunk>();
  const parseErrors: PhaserGraph["parseErrors"] = [];
  const graphConfig: PhaserGraph["config"] = { sceneList: [] };

  const analyses: FileAnalysis[] = [];

  for (const file of files) {
    if (!isJsFile(file.path)) continue;
    const parsed = parseJsFile(file.path, file.content);
    if (parsed.error) {
      parseErrors.push({ filePath: file.path, message: parsed.error });
      continue;
    }
    const analysis = analyzeFile(parsed);
    analyses.push(analysis);
    for (const c of analysis.chunks) chunks.set(c.id, c);
    if (analysis.config) {
      Object.assign(graphConfig, analysis.config);
      if (analysis.config.sceneList.length) {
        graphConfig.sceneList = analysis.config.sceneList;
      }
    }
  }

  // --- Nodes ---
  const resourceByKey = new Map<string, UpgNode>(); // `${scene}:${key}` and `*:${key}`
  for (const chunk of chunks.values()) {
    const scene = sceneTag(chunk.sceneName);
    switch (chunk.kind) {
      case "config":
        ensureNode(nodes, {
          id: "config:global",
          domain: "config",
          label: "Game config",
          filePath: chunk.filePath,
          sceneName: null,
          chunkId: chunk.id,
        });
        break;
      case "resource_load": {
        const key = chunk.assetKeys[0] || `res_${chunk.id}`;
        const node = ensureNode(nodes, {
          id: `resource:${scene}:${key}`,
          domain: "resource",
          label: `load ${key}`,
          filePath: chunk.filePath,
          sceneName: chunk.sceneName,
          key,
          chunkId: chunk.id,
        });
        resourceByKey.set(`${scene}:${key}`, node);
        resourceByKey.set(`*:${key}`, node);
        break;
      }
      case "entity_init":
        ensureNode(nodes, {
          id: `world:${scene}:${chunk.entityId}`,
          domain: "world",
          label: `entity ${chunk.entityId}`,
          filePath: chunk.filePath,
          sceneName: chunk.sceneName,
          key: chunk.entityId || undefined,
          chunkId: chunk.id,
        });
        break;
      case "control_branch":
        ensureNode(nodes, {
          id: `control:${scene}:update:${chunk.entityId || "misc"}`,
          domain: "control",
          label: `update ${chunk.entityId || "loop"}`,
          filePath: chunk.filePath,
          sceneName: chunk.sceneName,
          key: chunk.entityId || undefined,
          chunkId: chunk.id,
        });
        break;
      case "event_register":
        ensureNode(nodes, {
          id: `control:${scene}:events`,
          domain: "control",
          label: "event registrations",
          filePath: chunk.filePath,
          sceneName: chunk.sceneName,
          chunkId: chunk.id,
        });
        break;
      case "cleanup":
        ensureNode(nodes, {
          id: `control:${scene}:cleanup`,
          domain: "control",
          label: "cleanup / shutdown",
          filePath: chunk.filePath,
          sceneName: chunk.sceneName,
          chunkId: chunk.id,
        });
        break;
      default:
        ensureNode(nodes, {
          id: `misc:${scene}:${chunk.filePath}`,
          domain: "control",
          label: `misc (${chunk.lifecycle})`,
          filePath: chunk.filePath,
          sceneName: chunk.sceneName,
          chunkId: chunk.id,
        });
    }
  }

  const addEdge = (from: string, to: string, type: UpgEdge["type"]) => {
    if (!nodes.has(from) || !nodes.has(to)) return;
    if (from === to) return;
    if (edges.some((e) => e.from === from && e.to === to && e.type === type)) return;
    edges.push({ from, to, type });
  };

  // --- Edges ---
  for (const node of nodes.values()) {
    if (node.domain !== "world") continue;
    const scene = sceneTag(node.sceneName);
    const entity = node.key;

    // Asset binding: world -> resource (via asset keys in the entity's chunks).
    for (const chunkId of node.chunkIds) {
      const chunk = chunks.get(chunkId);
      if (!chunk) continue;
      for (const key of chunk.assetKeys) {
        const res =
          resourceByKey.get(`${scene}:${key}`) || resourceByKey.get(`*:${key}`);
        if (res) addEdge(node.id, res.id, "asset_binding");
      }
    }

    if (!entity) continue;

    // Temporal control + dependency def: world <-> update control of same entity.
    const updateId = `control:${scene}:update:${entity}`;
    if (nodes.has(updateId)) {
      addEdge(node.id, updateId, "temporal_control");
      addEdge(updateId, node.id, "dependency_def");
    }

    // World entity referenced inside event registrations.
    const eventsId = `control:${scene}:events`;
    const eventsNode = nodes.get(eventsId);
    if (eventsNode) {
      const referenced = eventsNode.chunkIds.some((cid) => {
        const c = chunks.get(cid);
        return c?.tokens.includes(entity.toLowerCase());
      });
      if (referenced) {
        addEdge(node.id, eventsId, "temporal_control");
        addEdge(eventsId, node.id, "dependency_def");
      }
    }
  }

  // Cleanup flow: events <-> cleanup per scene; flag leak when registration has no cleanup.
  const scenes = new Set<string>();
  for (const node of nodes.values()) scenes.add(sceneTag(node.sceneName));
  for (const scene of scenes) {
    const eventsId = `control:${scene}:events`;
    const cleanupId = `control:${scene}:cleanup`;
    const hasEvents = nodes.has(eventsId);
    const hasCleanup = nodes.has(cleanupId);
    if (hasEvents && hasCleanup) {
      addEdge(eventsId, cleanupId, "cleanup_flow");
      addEdge(cleanupId, eventsId, "cleanup_flow");
    } else if (hasEvents && !hasCleanup) {
      const ev = nodes.get(eventsId);
      ev?.flags?.push("potential_memory_leak: no shutdown cleanup found");
    }
  }

  return { nodes, edges, chunks, parseErrors, config: graphConfig };
}

/** Neighbors of a node along a specific edge direction/type. */
export function outNeighbors(
  graph: PhaserGraph,
  nodeId: string,
  types: UpgEdge["type"][]
): string[] {
  return graph.edges
    .filter((e) => e.from === nodeId && types.includes(e.type))
    .map((e) => e.to);
}

export function inNeighbors(
  graph: PhaserGraph,
  nodeId: string,
  types: UpgEdge["type"][]
): string[] {
  return graph.edges
    .filter((e) => e.to === nodeId && types.includes(e.type))
    .map((e) => e.from);
}

/** Find which UPG node owns a chunk. */
export function nodeForChunk(graph: PhaserGraph, chunkId: string): UpgNode | null {
  for (const node of graph.nodes.values()) {
    if (node.chunkIds.includes(chunkId)) return node;
  }
  return null;
}
