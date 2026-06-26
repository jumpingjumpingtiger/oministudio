import type { GeneratedFile } from "@/lib/types";
import type { UriCsvRow } from "@/lib/storage";
import type {
  BrainActiveVersionContext,
  BrainContextBudget,
  BrainGenerationContext,
  BrainProjectContext,
} from "@/lib/engine/brain-context";
import { DEFAULT_BRAIN_CONTEXT_BUDGET } from "@/lib/engine/brain-context";
import type { PreparedChatContext } from "@/lib/engine/brain-chat-history";
import {
  retrievePhaserContext,
  summarizePhaserGraph,
  type PhaserRetrievalResult,
} from "@/lib/engine/upg";
import { codeNamespace } from "@/lib/vector";

export type ContextIntent =
  | "greenfield"
  | "rewrite"
  | "asset_edit"
  | "code_edit"
  | "bugfix"
  | "iteration";

export interface ContextSelectionPlan {
  intent: ContextIntent;
  rationale: string;
  /** Distinct files represented in the assembled context. */
  selectedFileCount: number;
  totalFileCount: number;
  selectedChatCount: number;
  totalChatCount: number;
  chatSummarizedCount: number;
  selectedAssetCount: number;
  totalAssetCount: number;
  assetDetailLevel: "none" | "compact" | "full";
  seedChunkCount: number;
  diffusedChunkCount: number;
}

export interface RetrievedBrainContext {
  project?: BrainProjectContext;
  activeVersion?: BrainActiveVersionContext;
  existingAssets: UriCsvRow[];
  preparedChat: PreparedChatContext;
  allFilePaths: string[];
  plan: ContextSelectionPlan;
  /** UPG + AST RAG result (null for greenfield/rewrite). */
  upg: PhaserRetrievalResult | null;
  /** Human-readable Phaser graph topology summary. */
  graphSummary: string;
  /** Files included verbatim (index.html, unparsed files, or full rewrite set). */
  rawFiles: GeneratedFile[];
}

const REWRITE_PATTERNS =
  /\b(rewrite|rebuild|from scratch|start over|remake|recreate)\b/i;
const ASSET_PATTERNS =
  /\b(asset|sprite|image|background|icon|texture|tile|art|picture|png|jpeg|jpg)\b/i;
const CODE_PATTERNS =
  /\b(code|logic|physics|scene|speed|jump|collision|score|level|button|ui|mechanic|gameplay|phaser|function|class)\b/i;
const BUGFIX_PATTERNS =
  /\b(fix|bug|broken|error|crash|issue|wrong|not working|doesn't work|fail)\b/i;

function pathBasename(path: string): string {
  return path.split("/").pop() || path;
}

export function analyzePromptIntent(
  prompt: string,
  hasExistingProject: boolean
): ContextIntent {
  if (!hasExistingProject) return "greenfield";
  if (REWRITE_PATTERNS.test(prompt)) return "rewrite";
  if (BUGFIX_PATTERNS.test(prompt)) return "bugfix";

  const assetHit = ASSET_PATTERNS.test(prompt);
  const codeHit = CODE_PATTERNS.test(prompt);

  if (assetHit && !codeHit) return "asset_edit";
  if (codeHit && !assetHit) return "code_edit";
  return "iteration";
}

function assetDetailForIntent(intent: ContextIntent): "none" | "compact" | "full" {
  if (intent === "greenfield" || intent === "rewrite") return "none";
  return "compact";
}

/** Iteration intents inject a compact active-version asset inventory (no prompts). */
function selectAssets(
  intent: ContextIntent,
  rows: UriCsvRow[]
): { assets: UriCsvRow[]; detailLevel: "none" | "compact" | "full" } {
  const detailLevel = assetDetailForIntent(intent);
  if (!rows.length || detailLevel === "none") {
    return { assets: [], detailLevel: "none" };
  }
  return {
    assets: [...rows].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    detailLevel: "full",
  };
}

function intentRationale(intent: ContextIntent): string {
  switch (intent) {
    case "greenfield":
      return "New project — no prior code/chat/assets.";
    case "rewrite":
      return "Full rewrite — include all current files verbatim; skip graph retrieval.";
    case "asset_edit":
      return "Asset-focused — UPG retrieval anchors on resource/preload nodes; compact asset inventory injected.";
    case "code_edit":
      return "Code-focused — UPG hybrid retrieval + topological diffusion; compact asset inventory injected.";
    case "bugfix":
      return "Bug fix — UPG retrieval with wider diffusion; compact asset inventory injected.";
    default:
      return "Iteration — UPG hybrid retrieval + topological diffusion; compact asset inventory injected.";
  }
}

function shouldIncludeVersionSummary(intent: ContextIntent): boolean {
  return intent !== "greenfield";
}

function shouldIncludeVersionOriginalPrompt(intent: ContextIntent): boolean {
  return intent === "bugfix" || intent === "rewrite";
}

function seedBudgetForIntent(intent: ContextIntent): { seedTopK: number; maxChunks: number } {
  switch (intent) {
    case "bugfix":
      return { seedTopK: 10, maxChunks: 34 };
    case "asset_edit":
      return { seedTopK: 6, maxChunks: 24 };
    default:
      return { seedTopK: 8, maxChunks: 28 };
  }
}

/**
 * UPG + AST RAG retrieval.
 * Chat history is NOT injected into the Brain LLM prompt (current request only).
 */
export async function retrieveContextByIntent(
  currentPrompt: string,
  context: BrainGenerationContext,
  budget: BrainContextBudget = DEFAULT_BRAIN_CONTEXT_BUDGET
): Promise<RetrievedBrainContext> {
  const allFiles = context.existingFiles || [];
  const allAssets = context.existingAssets || [];
  const hasExisting = allFiles.length > 0 || allAssets.length > 0;

  const intent = analyzePromptIntent(currentPrompt, hasExisting);

  const preparedChat = {
    olderSummary: null,
    messages: [],
    stats: {
      totalMessages: 0,
      summarizedCount: 0,
      recentCount: 0,
      relevanceCount: 0,
    },
  };
  const { assets: selectedAssets, detailLevel } = selectAssets(intent, allAssets);

  let upg: PhaserRetrievalResult | null = null;
  let graphSummary = "";
  const rawFiles: GeneratedFile[] = [];

  const indexHtml = allFiles.find((f) => pathBasename(f.path).toLowerCase() === "index.html");

  if (intent === "greenfield") {
    // no code context
  } else if (intent === "rewrite") {
    rawFiles.push(...allFiles);
  } else {
    const { seedTopK, maxChunks } = seedBudgetForIntent(intent);
    const namespace =
      context.projectId && context.activeVersionId
        ? codeNamespace(context.projectId, context.activeVersionId)
        : null;
    upg = await retrievePhaserContext(currentPrompt, allFiles, {
      seedTopK,
      maxChunks,
      maxChars: Math.min(28_000, budget.maxTotalFileChars),
      namespace,
    });
    graphSummary = summarizePhaserGraph(upg.graph);

    if (indexHtml) rawFiles.push(indexHtml);
    // Include any JS files that failed to parse, verbatim, so we never lose context.
    for (const f of allFiles) {
      if (upg.unparsedFiles.includes(f.path) && !rawFiles.includes(f)) {
        rawFiles.push(f);
      }
    }
  }

  const activeVersion = context.activeVersion
    ? {
        versionNumber: context.activeVersion.versionNumber,
        summary: shouldIncludeVersionSummary(intent) ? context.activeVersion.summary : undefined,
        prompt: shouldIncludeVersionOriginalPrompt(intent)
          ? context.activeVersion.prompt
          : undefined,
      }
    : undefined;

  const filesInContext = new Set<string>(rawFiles.map((f) => f.path));
  for (const rc of upg?.chunks || []) filesInContext.add(rc.chunk.filePath);

  const seedChunkCount = (upg?.chunks || []).filter((c) => c.reason === "seed").length;
  const diffusedChunkCount = (upg?.chunks || []).length - seedChunkCount;

  const plan: ContextSelectionPlan = {
    intent,
    rationale: intentRationale(intent),
    selectedFileCount: filesInContext.size,
    totalFileCount: allFiles.length,
    selectedChatCount: preparedChat.messages.length,
    totalChatCount: preparedChat.stats.totalMessages,
    chatSummarizedCount: preparedChat.stats.summarizedCount,
    selectedAssetCount: selectedAssets.length,
    totalAssetCount: allAssets.length,
    assetDetailLevel: detailLevel,
    seedChunkCount,
    diffusedChunkCount,
  };

  return {
    project: context.project,
    activeVersion,
    existingAssets: selectedAssets,
    preparedChat,
    allFilePaths: allFiles.map((f) => f.path),
    plan,
    upg,
    graphSummary,
    rawFiles,
  };
}

export type { BrainContextBudget };
