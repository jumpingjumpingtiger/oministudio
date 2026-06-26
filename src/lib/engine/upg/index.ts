import type { GeneratedFile } from "@/lib/types";
import type { PhaserGraph, PhaserRetrievalResult, RetrievedChunk } from "./types";
import { isJsFile } from "./ast-parser";
import { buildPhaserGraph } from "./upg-graph";
import { hybridRetrieveWithVectors } from "./hybrid-retrieval";
import { diffuseContext } from "./topo-diffusion";

export type { PhaserGraph, PhaserRetrievalResult, RetrievedChunk } from "./types";
export { buildPhaserGraph } from "./upg-graph";

export interface PhaserContextOptions {
  /** Seed anchors retrieved in phase 1. */
  seedTopK?: number;
  /** Max chars of diffused code chunks. */
  maxChars?: number;
  /** Max diffused chunk count. */
  maxChunks?: number;
  /** Vector-store namespace for dense retrieval (null disables dense ANN). */
  namespace?: string | null;
}

const DEFAULTS: Required<Omit<PhaserContextOptions, "namespace">> = {
  seedTopK: 8,
  maxChars: 24_000,
  maxChunks: 28,
};

/**
 * UPG + AST RAG retrieval entry point.
 * Phase 1: hybrid (dense ANN embeddings + BM25, RRF-fused) coarse retrieval → seed anchors.
 *          Falls back to TF-IDF cosine + BM25 when no embedding/vector store is configured.
 * Phase 2: UPG topological self-healing diffusion → precise, high-purity context.
 */
export async function retrievePhaserContext(
  prompt: string,
  files: GeneratedFile[],
  options: PhaserContextOptions = {}
): Promise<PhaserRetrievalResult> {
  const opts = { ...DEFAULTS, ...options };
  const graph = buildPhaserGraph(files);

  const allChunks = [...graph.chunks.values()];
  const { anchors: seeds, mode } = await hybridRetrieveWithVectors(
    prompt,
    allChunks,
    opts.seedTopK,
    options.namespace ?? null
  );

  const { chunks, trace } = diffuseContext(graph, seeds, {
    maxChars: opts.maxChars,
    maxChunks: opts.maxChunks,
  });
  trace.unshift(`[phase1] seed retrieval mode=${mode} (${seeds.length} anchors)`);

  const unparsedFiles = files
    .filter((f) => isJsFile(f.path))
    .filter((f) => graph.parseErrors.some((e) => e.filePath === f.path))
    .map((f) => f.path);

  return { chunks, graph, unparsedFiles, trace, mode, seedCount: seeds.length };
}

/** Human-readable graph summary for the LLM prompt (scene topology + facts). */
export function summarizePhaserGraph(graph: PhaserGraph): string {
  const lines: string[] = [];
  const cfg = graph.config;
  const cfgParts: string[] = [];
  if (cfg.width && cfg.height) cfgParts.push(`canvas ${cfg.width}x${cfg.height}`);
  if (cfg.physics) cfgParts.push(`physics=${cfg.physics}`);
  if (cfg.gravityY != null) cfgParts.push(`gravityY=${cfg.gravityY}`);
  if (cfg.sceneList.length) cfgParts.push(`scenes=[${cfg.sceneList.join(", ")}]`);
  if (cfgParts.length) lines.push(`Config: ${cfgParts.join(", ")}`);

  const scenes = new Map<string, { entities: string[]; resources: string[]; flags: string[] }>();
  for (const node of graph.nodes.values()) {
    const scene = node.sceneName || "(module)";
    const entry =
      scenes.get(scene) || { entities: [], resources: [], flags: [] };
    if (node.domain === "world" && node.key) entry.entities.push(node.key);
    if (node.domain === "resource" && node.key) entry.resources.push(node.key);
    if (node.flags?.length) entry.flags.push(...node.flags);
    scenes.set(scene, entry);
  }

  for (const [scene, e] of scenes) {
    if (!e.entities.length && !e.resources.length && !e.flags.length) continue;
    const parts: string[] = [];
    if (e.entities.length) parts.push(`entities: ${[...new Set(e.entities)].join(", ")}`);
    if (e.resources.length) parts.push(`assets: ${[...new Set(e.resources)].join(", ")}`);
    let line = `Scene ${scene} — ${parts.join("; ")}`;
    if (e.flags.length) line += ` [⚠ ${[...new Set(e.flags)].join("; ")}]`;
    lines.push(line);
  }

  return lines.length ? lines.join("\n") : "(no Phaser graph extracted)";
}

/** Format diffused chunks into an annotated code-context section. */
export function formatRetrievedChunks(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return "";
  return chunks
    .map((rc) => {
      const c = rc.chunk;
      const scope = [
        c.sceneName ? `scene=${c.sceneName}` : null,
        `phase=${c.lifecycle}`,
        c.entityId ? `entity=${c.entityId}` : null,
        `via=${rc.reason}`,
      ]
        .filter(Boolean)
        .join(" ");
      return `// ${c.filePath} :${c.startLine}-${c.endLine} (${scope})\n${c.code}`;
    })
    .join("\n\n");
}
