/**
 * Unified Phaser Graph (UPG) + AST RAG type definitions.
 * Deterministic static analysis over the game AST.
 */

/** Loose AST node shape (acorn does not ship ESTree types). */
export interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

/** Four-domain abstraction of UPG nodes. */
export type UpgNodeDomain = "config" | "resource" | "world" | "control";

/** Phaser lifecycle phase a chunk/node belongs to. */
export type LifecyclePhase =
  | "config"
  | "preload"
  | "create"
  | "update"
  | "shutdown"
  | "method"
  | "module";

/**
 * SLC chunk — an entity-centric semantic slice of code with hard-bound metadata.
 * Source text is extracted by byte offsets (CST-style precise slicing).
 */
export interface SlcChunk {
  id: string;
  filePath: string;
  /** Owning scene class, or module-level. */
  sceneName: string | null;
  lifecycle: LifecyclePhase;
  /** Logical entity this chunk configures/controls (e.g. "player"), if any. */
  entityId: string | null;
  /** Asset keys referenced inside this chunk (e.g. "player", "ground"). */
  assetKeys: string[];
  /** Byte offsets into the original file content. */
  start: number;
  end: number;
  /** 1-based inclusive line range in the file. */
  startLine: number;
  endLine: number;
  /** Extracted source text. */
  code: string;
  /** Coarse kind for diffusion logic. */
  kind:
    | "config"
    | "resource_load"
    | "entity_init"
    | "control_branch"
    | "event_register"
    | "cleanup"
    | "misc";
  /** Tokens for lexical/semantic scoring (lowercased). */
  tokens: string[];
}

export interface UpgNode {
  id: string;
  domain: UpgNodeDomain;
  label: string;
  filePath: string;
  sceneName: string | null;
  /** Chunk ids that materialize this node. */
  chunkIds: string[];
  /** Asset key for resource nodes; entity id for world nodes; etc. */
  key?: string;
  /** Static analysis warnings (e.g. potential memory leak). */
  flags?: string[];
}

export type UpgEdgeType =
  | "asset_binding" // world -> resource
  | "temporal_control" // world -> control
  | "dependency_def" // control -> world
  | "cleanup_flow"; // control <-> control

export interface UpgEdge {
  from: string;
  to: string;
  type: UpgEdgeType;
}

export interface PhaserGraph {
  nodes: Map<string, UpgNode>;
  edges: UpgEdge[];
  chunks: Map<string, SlcChunk>;
  /** Per-file parse errors (syntax). */
  parseErrors: { filePath: string; message: string }[];
  /** Global config facts. */
  config: {
    width?: number;
    height?: number;
    physics?: string;
    gravityY?: number;
    sceneList: string[];
  };
}

export interface RetrievedChunk {
  chunk: SlcChunk;
  score: number;
  /** Why it was retrieved: seed anchor vs diffused dependency. */
  reason: "seed" | "vertical" | "horizontal" | "cleanup" | "config";
}

export interface PhaserRetrievalResult {
  chunks: RetrievedChunk[];
  graph: PhaserGraph;
  /** Files that could not be analyzed (fall back to raw inclusion). */
  unparsedFiles: string[];
  trace: string[];
  /** Phase-1 seed retrieval mode: dense ANN embeddings vs lexical fallback. */
  mode: "dense" | "lexical";
  /** Number of seed anchors returned by phase-1 coarse retrieval. */
  seedCount: number;
}
