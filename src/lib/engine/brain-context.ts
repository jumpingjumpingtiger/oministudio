import type { GeneratedFile } from "@/lib/types";
import type { UriCsvRow } from "@/lib/storage";
import {
  retrieveContextByIntent,
  type ContextSelectionPlan,
  type RetrievedBrainContext,
} from "@/lib/engine/brain-context-retrieval";
import {
  formatPreparedChatSection,
  type PreparedChatContext,
} from "@/lib/engine/brain-chat-history";
import { formatRetrievedChunks } from "@/lib/engine/upg";

/** Cursor-inspired context budget defaults (~24k tokens at 4 chars/token). */
export interface BrainContextBudget {
  maxTotalChars: number;
  maxChatMessages: number;
  maxUserMessageChars: number;
  maxAssistantMessageChars: number;
  maxFileChars: number;
  maxTotalFileChars: number;
  maxAssetPromptChars: number;
  /** Total chars for the entire chat history section (summary + messages). */
  maxChatHistoryChars: number;
  /** Max chars for compressed older-conversation summary. */
  maxSummaryChars: number;
}

export const DEFAULT_BRAIN_CONTEXT_BUDGET: BrainContextBudget = {
  maxTotalChars: 96_000,
  maxChatMessages: 10,
  maxUserMessageChars: 800,
  maxAssistantMessageChars: 400,
  maxFileChars: 12_000,
  maxTotalFileChars: 72_000,
  maxAssetPromptChars: 200,
  maxChatHistoryChars: 5_000,
  maxSummaryChars: 2_000,
};

export interface BrainChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: Date;
  versionNumber?: number | null;
}

export interface BrainProjectContext {
  name: string;
  description?: string;
}

export interface BrainActiveVersionContext {
  versionNumber?: number | null;
  summary?: string;
  prompt?: string;
}

export interface BrainGenerationContext {
  project?: BrainProjectContext;
  activeVersion?: BrainActiveVersionContext;
  /** Code files from the active version only (base for this edit). */
  existingFiles?: GeneratedFile[];
  /** Complete uri.csv from the active version only — not other versions' manifests. */
  existingAssets?: UriCsvRow[];
  chatHistory?: BrainChatMessage[];
  /** Stable IDs used to namespace vector embeddings (dense retrieval). */
  projectId?: string;
  activeVersionId?: string;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]`;
}

function formatFileTree(paths: string[]): string {
  if (!paths.length) return "(no files yet)";
  return paths.map((p) => `- ${p}`).join("\n");
}

/** Entry files first when trimming total code size. */
const FILE_PRIORITY = ["index.html", "main.js", "game.js", "app.js"];

function filePriority(path: string): number {
  const base = path.split("/").pop() || path;
  const idx = FILE_PRIORITY.indexOf(base);
  if (idx >= 0) return idx;
  if (path.includes("scenes/") || path.includes("Scene")) return FILE_PRIORITY.length;
  return FILE_PRIORITY.length + 1;
}

export function selectFilesForContext(
  files: GeneratedFile[],
  budget: BrainContextBudget
): GeneratedFile[] {
  if (!files.length) return [];

  const sorted = [...files].sort(
    (a, b) => filePriority(a.path) - filePriority(b.path) || a.path.localeCompare(b.path)
  );

  let remaining = budget.maxTotalFileChars;
  const selected: GeneratedFile[] = [];

  for (const file of sorted) {
    if (remaining <= 0) break;
    const cap = Math.min(budget.maxFileChars, remaining);
    const content = truncate(file.content, cap);
    remaining -= content.length;
    selected.push({ path: file.path, content });
  }

  if (selected.length < sorted.length) {
    const omitted = sorted.length - selected.length;
    selected.push({
      path: "_context_note.txt",
      content: `[${omitted} additional file(s) omitted from context due to size limits. Preserve their behavior unless the user asks to change them.]`,
    });
  }

  return selected;
}

export function formatChatHistorySection(
  prepared: PreparedChatContext,
  budget: BrainContextBudget
): string {
  return formatPreparedChatSection(prepared, budget);
}

export function formatAssetManifestSection(
  rows: UriCsvRow[],
  budget: BrainContextBudget,
  detailLevel: "none" | "compact" | "full" = "full",
  options?: { maxPromptChars?: number; activeVersionNumber?: number | null }
): string {
  if (!rows.length || detailLevel === "none") return "";

  const promptCap = options?.maxPromptChars ?? budget.maxAssetPromptChars;
  const versionLabel =
    options?.activeVersionNumber != null
      ? `v${options.activeVersionNumber} (active — base for this edit)`
      : "active version (base for this edit)";

  const lines = rows
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((row) => {
      if (detailLevel === "compact") {
        return `- ${row.uri} | name=${row.name} | format=${row.format || "png"}`;
      }
      const promptExcerpt = truncate(row.prompt, promptCap);
      const regen = row.regenerate === false ? "reuse" : "regenerate";
      const assetId = row.assetId ? ` | assetId=${row.assetId}` : "";
      return `- ${row.uri} | name=${row.name} | format=${row.format || "png"} | ${regen}${assetId} | prompt: ${promptExcerpt}`;
    });

  const header =
    detailLevel === "compact"
      ? `## Asset inventory (compact — uri.csv ${versionLabel})\nExisting assets without generation prompts. Output ONLY add/modify/delete changes in your JSON assets array; the platform merges with this inventory to build uri.csv. Unchanged assets referenced in code are reused automatically.`
      : `## Asset URI manifest — uri.csv ${versionLabel}\nThis is the ONLY manifest for the version you are iterating on. List EVERY asset below in your JSON output with regenerate true/false. false = reuse library file; true = expert generates new file (old file kept for other versions).`;

  return `${header}\n\n${lines.join("\n")}`;
}

export function formatProjectSection(
  project: BrainProjectContext | undefined,
  activeVersion: BrainActiveVersionContext | undefined,
  filePaths: string[],
  options?: { includeFileTree?: boolean }
): string {
  const parts: string[] = ["## Project context"];

  if (project?.name) {
    parts.push(`Project: ${project.name}`);
  }
  if (project?.description?.trim()) {
    parts.push(`Description: ${project.description.trim()}`);
  }
  if (activeVersion?.versionNumber != null) {
    parts.push(`Active version: v${activeVersion.versionNumber}`);
  }
  if (activeVersion?.summary?.trim()) {
    parts.push(`Version summary: ${truncate(activeVersion.summary.trim(), 800)}`);
  }
  if (activeVersion?.prompt?.trim()) {
    parts.push(`Version original prompt: ${truncate(activeVersion.prompt.trim(), 500)}`);
  }

  if (options?.includeFileTree !== false && filePaths.length) {
    parts.push("\n### File tree (full project)");
    parts.push(formatFileTree(filePaths));
  }

  return parts.join("\n");
}

export function formatCodeFilesSection(files: GeneratedFile[]): string {
  if (!files.length) return "";

  const body = files
    .filter((f) => f.path !== "_context_note.txt" || files.length === 1)
    .map((f) => `--- ${f.path} ---\n${f.content}`)
    .join("\n\n");

  const note = files.find((f) => f.path === "_context_note.txt");
  const noteLine = note ? `\n\n${note.content}` : "";

  return `## Full source files\nThese files are included verbatim (entry HTML, files that could not be statically analyzed, or a full rewrite set).\n\n${body}${noteLine}`;
}

/**
 * Build the code-context section from UPG + AST RAG retrieval:
 * graph topology summary + high-purity retrieved slices + verbatim raw files.
 */
export function formatUpgCodeSection(
  retrieved: RetrievedBrainContext,
  rawFiles: GeneratedFile[]
): string {
  const parts: string[] = [];

  // Graph topology is shown in the chat RAG feed only — not duplicated in the LLM prompt
  // (retrieved slices already carry entity/preload/cleanup context from diffusion).

  if (retrieved.upg && retrieved.upg.chunks.length) {
    parts.push(
      "## Retrieved code slices (UPG + AST RAG)\n" +
        "High-purity slices relevant to this request, expanded along dependency edges " +
        "(entity definitions, preload/asset bindings, cleanup). Slices may be non-contiguous. " +
        "Modify these incrementally and preserve unrelated code. Each header shows file:lineRange and scope.\n\n" +
        formatRetrievedChunks(retrieved.upg.chunks)
    );
  }

  if (rawFiles.length) {
    parts.push(formatCodeFilesSection(rawFiles));
  }

  return parts.filter(Boolean).join("\n\n");
}

export interface BuiltBrainPrompt {
  userPrompt: string;
  sections: string[];
  estimatedChars: number;
  selectionPlan?: ContextSelectionPlan;
  contextPreview: BrainContextPreview;
}

export interface BrainContextPreview {
  intent: string;
  rationale: string;
  includedFiles: string[];
  includedAssets: string[];
  chatSummary: string;
  contextLines: string[];
}

/** First meaningful code line of a slice, trimmed for the chat feed. */
function firstCodeLine(code: string, max = 72): string {
  const line = code
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return "(empty)";
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/** First non-empty line of an assembled section (its heading). */
function sectionTitle(section: string, max = 64): string {
  const line = section
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return "(section)";
  const clean = line.replace(/^#+\s*/, "");
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function buildContextPreview(
  retrieved: RetrievedBrainContext,
  rawFiles: GeneratedFile[]
): BrainContextPreview {
  const plan = retrieved.plan;

  const chunkFiles = new Set<string>();
  for (const rc of retrieved.upg?.chunks || []) chunkFiles.add(rc.chunk.filePath);
  for (const f of rawFiles) {
    if (f.path !== "_context_note.txt") chunkFiles.add(f.path);
  }
  const files = [...chunkFiles];
  const assets = retrieved.existingAssets.map((a) => a.name);

  const chatSummary = "current request only (history omitted)";

  const contextLines = [`[Intent] ${plan.intent} — ${plan.rationale}`];

  if (retrieved.upg) {
    const upg = retrieved.upg;
    const totalSlices = upg.graph.chunks.size;
    const dense = upg.mode === "dense";

    // Step 1 — how the user query was turned into a search signal.
    contextLines.push(
      dense
        ? `[Query] embedded into a dense vector → ANN search (vector store)`
        : `[Query] tokenized → BM25 + TF-IDF lexical search (vector store unavailable)`
    );

    // Step 2 — full graph build (how many slices were extracted in total).
    contextLines.push(
      `[Graph] built ${totalSlices} code slice(s) across ${plan.totalFileCount} file(s) via AST/SLC`
    );
    for (const line of retrieved.graphSummary.split("\n").slice(0, 4)) {
      if (line.trim()) contextLines.push(`  ${line.trim()}`);
    }

    // Step 3 — slices recalled by phase-1 retrieval (seeds), with first line of each.
    const seeds = upg.chunks.filter((c) => c.reason === "seed");
    contextLines.push(
      `[Recall] ${seeds.length} slice(s) recalled by ${dense ? "vector ANN" : "lexical"} ranking:`
    );
    for (const rc of seeds.slice(0, 10)) {
      const c = rc.chunk;
      contextLines.push(`  • ${c.filePath}:${c.startLine} · ${firstCodeLine(c.code)}`);
    }

    // Step 4 — UPG self-healing topological diffusion details.
    contextLines.push(
      `[Diffusion] expanded +${plan.diffusedChunkCount} dependency slice(s) along UPG edges:`
    );
    for (const t of upg.trace) {
      if (t.startsWith("[phase1]")) continue;
      contextLines.push(`  ${t}`);
    }
  } else {
    contextLines.push(
      `[Context files] ${files.length ? files.join(", ") : "(none)"}`
    );
  }

  contextLines.push(`[Chat history] ${chatSummary}`);

  if (plan.totalAssetCount > 0 && plan.assetDetailLevel === "compact") {
    const vTag =
      retrieved.activeVersion?.versionNumber != null
        ? `v${retrieved.activeVersion.versionNumber} active`
        : "active version";
    contextLines.push(
      `[uri.csv] compact inventory from ${vTag} (${plan.totalAssetCount} assets, no prompts)`
    );
  } else if (plan.totalAssetCount > 0 && plan.assetDetailLevel === "full") {
    const vTag =
      retrieved.activeVersion?.versionNumber != null
        ? `v${retrieved.activeVersion.versionNumber} active`
        : "active version";
    contextLines.push(
      `[uri.csv] complete manifest from ${vTag} (${plan.totalAssetCount} assets)`
    );
  } else if (plan.totalAssetCount > 0) {
    contextLines.push(
      `[uri.csv] ${plan.selectedAssetCount}/${plan.totalAssetCount} assets (${plan.assetDetailLevel})`
    );
  }

  if (retrieved.upg?.unparsedFiles.length) {
    contextLines.push(
      `[fallback] ${retrieved.upg.unparsedFiles.length} unparsable file(s) included verbatim`
    );
  }

  return {
    intent: plan.intent,
    rationale: plan.rationale,
    includedFiles: files,
    includedAssets: assets,
    chatSummary,
    contextLines,
  };
}

/**
 * Append the final list of context fragments assembled into the Brain LLM prompt,
 * so the chat feed shows exactly what was sent to the model.
 */
function appendAssembledFragments(
  preview: BrainContextPreview,
  sections: string[],
  totalChars: number
): void {
  preview.contextLines.push(
    `[LLM input] ${sections.length} fragment(s) assembled, ~${totalChars.toLocaleString()} chars:`
  );
  for (const section of sections) {
    preview.contextLines.push(
      `  ▸ ${sectionTitle(section)} (~${section.length.toLocaleString()} chars)`
    );
  }
}

function contextRetrievalSummary(plan: ContextSelectionPlan): string {
  const assetLabel =
    plan.assetDetailLevel === "compact"
      ? "compact inventory (no prompts)"
      : plan.assetDetailLevel === "full" &&
          plan.selectedAssetCount === plan.totalAssetCount
        ? "full uri.csv"
        : plan.assetDetailLevel;
  return (
    `## Context retrieval (UPG + AST RAG)\n` +
    `Intent: ${plan.intent}\n${plan.rationale}\n` +
    `Code: ${plan.seedChunkCount} seed + ${plan.diffusedChunkCount} diffused slices over ${plan.selectedFileCount}/${plan.totalFileCount} files (graph topology in feed only, not duplicated in prompt). ` +
    `Chat: current request only (history omitted). ` +
    `Assets: ${plan.selectedAssetCount}/${plan.totalAssetCount} (${assetLabel}).`
  );
}

/**
 * Assemble Brain LLM user message.
 * Code context: UPG + AST RAG (hybrid retrieval + topological diffusion).
 * uri.csv: compact inventory on iteration. Chat: omitted (current request only).
 */
export async function buildBrainUserPrompt(
  currentPrompt: string,
  context: BrainGenerationContext,
  budget: BrainContextBudget = DEFAULT_BRAIN_CONTEXT_BUDGET
): Promise<BuiltBrainPrompt> {
  const retrieved = await retrieveContextByIntent(currentPrompt, context, budget);

  let assetPromptCap = budget.maxAssetPromptChars;
  let rawSlice = selectFilesForContext(retrieved.rawFiles, budget);

  const buildSections = (rawFiles: GeneratedFile[], promptCap: number) =>
    [
      "## Current request",
      currentPrompt.trim(),
      contextRetrievalSummary(retrieved.plan),
      formatProjectSection(
        retrieved.project,
        retrieved.activeVersion,
        retrieved.allFilePaths,
        { includeFileTree: retrieved.plan.intent !== "greenfield" }
      ),
      formatAssetManifestSection(
        retrieved.existingAssets,
        budget,
        retrieved.plan.assetDetailLevel,
        {
          maxPromptChars: promptCap,
          activeVersionNumber: retrieved.activeVersion?.versionNumber,
        }
      ),
      formatUpgCodeSection(retrieved, rawFiles),
    ].filter(Boolean);

  let sections = buildSections(rawSlice, assetPromptCap);
  let combined = sections.join("\n\n");

  // Shrink verbatim raw files first (e.g. rewrite set).
  if (combined.length > budget.maxTotalChars && retrieved.rawFiles.length > 0) {
    const shrinkBudget = {
      ...budget,
      maxTotalFileChars: Math.max(
        6_000,
        budget.maxTotalFileChars - (combined.length - budget.maxTotalChars)
      ),
    };
    rawSlice = selectFilesForContext(retrieved.rawFiles, shrinkBudget);
    sections = buildSections(rawSlice, assetPromptCap);
    combined = sections.join("\n\n");
  }

  // Then shrink asset prompt excerpts (keep uri.csv rows complete).
  if (
    combined.length > budget.maxTotalChars &&
    retrieved.plan.assetDetailLevel === "full" &&
    retrieved.existingAssets.length > 0
  ) {
    while (combined.length > budget.maxTotalChars && assetPromptCap > 60) {
      assetPromptCap = Math.floor(assetPromptCap * 0.75);
      sections = buildSections(rawSlice, assetPromptCap);
      combined = sections.join("\n\n");
    }
  }

  if (combined.length > budget.maxTotalChars) {
    combined = truncate(combined, budget.maxTotalChars);
  }

  const contextPreview = buildContextPreview(retrieved, rawSlice);
  appendAssembledFragments(contextPreview, sections, combined.length);

  return {
    userPrompt: combined,
    sections,
    estimatedChars: combined.length,
    selectionPlan: retrieved.plan,
    contextPreview,
  };
}
