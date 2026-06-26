import type { UriCsvRow } from "@/lib/storage";
import { callBrainLlmStream } from "@/lib/engine/llm-providers/brain-provider";
import { isBrainLlmConfigured } from "@/lib/engine/llm-config";
import {
  formatChangeManifestForEnhancer,
  parseAssistantMessageFiles,
} from "@/lib/change-manifest";
import { isNonEnglishPrompt } from "@/lib/prompt-language";
import { extractJsonFromText } from "@/lib/engine/llm-providers/json-utils";

export type EnhancePromptMode = "greenfield" | "iteration";

export interface EnhancePromptResult {
  /** Enhanced prompt shown in the UI. */
  displayPrompt: string;
  /** English query for RAG / Brain LLM retrieval. */
  ragPrompt: string;
}

const ENHANCE_JSON_INSTRUCTION = `
Output ONLY valid JSON (no markdown fences, no extra text):
{"displayPrompt":"...","ragPrompt":"..."}

- displayPrompt: enhanced prompt in English for UI display
- ragPrompt: English version optimized for code retrieval and generation (same as displayPrompt when the user already wrote in English)`;

const GREENFIELD_ENHANCE_SYSTEM = `You are a prompt refinement assistant for OminiStudio, a Phaser 3 H5 game development IDE.

This is a GREENFIELD request — the user is creating a new game (no existing code yet, or starting fresh).

Given the project context, recent chat (if any), file tree, compact asset inventory, and the user's raw request, produce ONE comprehensive enhanced prompt for the downstream code-generation model.

Requirements:
- Expand the user's idea into a complete, buildable Phaser 3 H5 game specification
- Cover: core gameplay loop, player controls, win/lose or progression, scenes to create (e.g. Preload, Menu, Game), required asset slots (sprites, backgrounds, UI) referencing asset:// URIs where helpful
- Specify canvas size (default 800x600 unless user implies otherwise), physics needs (arcade/gravity), and consistent art style (e.g. pixel art vs cartoon)
- Preserve the user's intent; do not invent unrelated genres or features they did not ask for
- Write both displayPrompt and ragPrompt in English
- Structured and actionable — enough detail for index.html + main.js + scene files + asset list in one generation pass
${ENHANCE_JSON_INSTRUCTION}`;

const ITERATION_ENHANCE_SYSTEM = `You are a prompt refinement assistant for OminiStudio, a Phaser 3 H5 game development IDE.

This is an ITERATION request — the user is modifying an existing Phaser game project.

Given the project file tree, compact asset inventory, recent chat history with prior change records, and the user's raw request, produce ONE precise enhanced prompt for the downstream code-generation model.

Requirements:
- Preserve the user's intent; do not rewrite unrelated systems
- Use chat history and change records to understand what was built before and what this turn should change
- Name affected scenes, files, mechanics, or asset URIs from the inventory when relevant
- Focus on the minimal precise delta — what exactly should change vs stay the same
- Write both displayPrompt and ragPrompt in English
- Actionable for incremental Phaser edits
${ENHANCE_JSON_INSTRUCTION}`;

export interface EnhanceChatTurn {
  role: "user" | "assistant";
  content: string;
  versionNumber?: number | null;
  /** Parsed from assistant message files JSON — file/asset deltas from that turn. */
  changeManifestText?: string;
  createdAt?: Date;
}

export interface EnhancePromptInput {
  rawPrompt: string;
  mode: EnhancePromptMode;
  projectName?: string;
  filePaths: string[];
  assets: UriCsvRow[];
  recentChat?: EnhanceChatTurn[];
  signal?: AbortSignal;
  onThinkingChunk?: (chunk: string) => void | Promise<void>;
}

const MAX_RECENT_CHAT_TURNS = 8;
const MAX_USER_CHARS = 400;
const MAX_ASSISTANT_CHARS = 600;

function stripWrapping(text: string): string {
  return text
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^```[\w]*\n?|\n?```$/g, "")
    .trim();
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function parseEnhanceResponse(text: string, fallback: string): EnhancePromptResult {
  const stripped = stripWrapping(text);
  if (!stripped) {
    return { displayPrompt: fallback, ragPrompt: fallback };
  }

  try {
    const parsed = JSON.parse(extractJsonFromText(stripped)) as {
      displayPrompt?: string;
      ragPrompt?: string;
    };
    const display = parsed.displayPrompt?.trim() || "";
    const rag = parsed.ragPrompt?.trim() || "";
    return {
      displayPrompt: display.length >= 8 ? display : fallback,
      ragPrompt: rag.length >= 8 ? rag : display.length >= 8 ? display : fallback,
    };
  } catch {
    const value = stripped.length >= 8 ? stripped : fallback;
    return { displayPrompt: value, ragPrompt: value };
  }
}

/** Format recent project chat + per-turn change records for the enhancer LLM. */
export function formatRecentChatForEnhancer(turns: EnhanceChatTurn[]): string {
  if (!turns.length) return "(no prior chat)";

  const lines: string[] = [];
  for (const turn of turns) {
    if (turn.role === "user") {
      lines.push(`[User]: ${truncate(turn.content, MAX_USER_CHARS)}`);
      continue;
    }

    const vTag = turn.versionNumber != null ? `v${turn.versionNumber}` : "assistant";
    lines.push(`[Assistant ${vTag}]: ${truncate(turn.content, MAX_ASSISTANT_CHARS)}`);
    if (turn.changeManifestText) {
      lines.push(`  Change record:\n${turn.changeManifestText}`);
    }
  }

  return lines.join("\n");
}

/** Load recent chat turns from DB rows (used by code-graph enhance_prompt node). */
export function buildEnhanceChatTurns(
  rows: {
    role: string;
    content: string;
    files: string;
    createdAt: Date;
    version?: { versionNumber: number | null } | null;
  }[],
  currentRawPrompt: string
): EnhanceChatTurn[] {
  const promptTrim = currentRawPrompt.trim();
  const filtered = rows.filter(
    (row) => !(row.role === "user" && row.content.trim() === promptTrim)
  );

  const recent = filtered.slice(-MAX_RECENT_CHAT_TURNS);

  return recent.map((row) => {
    const turn: EnhanceChatTurn = {
      role: row.role as "user" | "assistant",
      content: row.content,
      versionNumber: row.version?.versionNumber ?? null,
      createdAt: row.createdAt,
    };

    if (row.role === "assistant") {
      const payload = parseAssistantMessageFiles(row.files);
      if (payload.changeManifest) {
        turn.changeManifestText = formatChangeManifestForEnhancer(payload.changeManifest);
      }
    }

    return turn;
  });
}

function systemPromptForMode(mode: EnhancePromptMode): string {
  return mode === "greenfield" ? GREENFIELD_ENHANCE_SYSTEM : ITERATION_ENHANCE_SYSTEM;
}

/**
 * Pre-RAG prompt normalization: project tree + compact uri.csv + recent chat + raw user text → enhanced query.
 * Returns an English display prompt and an English RAG query.
 */
export async function enhanceUserPrompt(input: EnhancePromptInput): Promise<EnhancePromptResult> {
  const raw = input.rawPrompt.trim();
  const needsEnglishRag = isNonEnglishPrompt(raw);
  if (!raw) return { displayPrompt: raw, ragPrompt: raw };
  if (!isBrainLlmConfigured()) return { displayPrompt: raw, ragPrompt: raw };

  const fileTree = input.filePaths.length
    ? input.filePaths.map((p) => `- ${p}`).join("\n")
    : "(new project — no files yet)";

  const assetLines = input.assets.length
    ? [...input.assets]
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
        .map((r) => `- ${r.uri} | name=${r.name} | format=${r.format || "png"}`)
        .join("\n")
    : "(none)";

  const chatSection = formatRecentChatForEnhancer(input.recentChat ?? []);

  const modeLabel =
    input.mode === "greenfield"
      ? "greenfield (new game — produce comprehensive spec)"
      : "iteration (existing project — produce precise delta)";

  const userPrompt = [
    input.projectName ? `Project: ${input.projectName}` : null,
    `Mode: ${modeLabel}`,
    needsEnglishRag
      ? "Note: user request may be non-English — translate intent into English for both JSON fields."
      : null,
    "## Recent chat & change history",
    chatSection,
    "## File tree",
    fileTree,
    "## Asset inventory (compact — no generation prompts)",
    assetLines,
    "## User request (raw)",
    raw,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const response = await callBrainLlmStream(systemPromptForMode(input.mode), userPrompt, {
      signal: input.signal,
      onChunk: input.onThinkingChunk,
    });
    return parseEnhanceResponse(response, raw);
  } catch (error) {
    if (input.signal?.aborted) throw error;
    console.warn("[prompt-enhancer] failed, using raw prompt:", error);
    return { displayPrompt: raw, ragPrompt: raw };
  }
}

export function resolveEnhanceMode(params: {
  hasActiveVersion: boolean;
  filePaths: string[];
  assetCount: number;
}): EnhancePromptMode {
  if (!params.hasActiveVersion) return "greenfield";
  if (params.filePaths.length === 0 && params.assetCount === 0) return "greenfield";
  return "iteration";
}
