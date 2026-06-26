import type { BrainChatMessage, BrainContextBudget } from "@/lib/engine/brain-context";
import type { ContextIntent } from "@/lib/engine/brain-context-retrieval";

/** Switch to tiered strategy when message count exceeds this. */
export const LONG_CHAT_THRESHOLD = 8;

/** Recent messages kept verbatim (≈3 turns). */
export const RECENT_CHAT_MESSAGE_COUNT = 6;

/** Extra older messages retrieved by relevance to current prompt. */
export const RELEVANCE_CHAT_PICK_COUNT = 6;

export interface PreparedChatContext {
  olderSummary: string | null;
  messages: BrainChatMessage[];
  stats: {
    totalMessages: number;
    summarizedCount: number;
    recentCount: number;
    relevanceCount: number;
  };
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1)
  );
}

function scoreChatMessage(
  msg: BrainChatMessage,
  promptTokens: Set<string>,
  index: number,
  total: number
): number {
  let score = 0;
  score += ((index + 1) / total) * 10;
  if (index >= total - 2) score += 8;

  for (const t of promptTokens) {
    if (tokenize(msg.content).has(t)) score += 3;
  }
  return score;
}

function rankChatForSelection(
  history: BrainChatMessage[],
  currentPrompt: string
): { msg: BrainChatMessage; index: number; score: number }[] {
  // Lexical-overlap + recency ranking (no BM25 RAG subsystem).
  const promptTokens = tokenize(currentPrompt);
  return history
    .map((msg, index) => ({
      msg,
      index,
      score: scoreChatMessage(msg, promptTokens, index, history.length),
    }))
    .sort((a, b) => b.score - a.score);
}

function excludeCurrentPromptDuplicate(
  messages: BrainChatMessage[],
  currentPrompt: string
): BrainChatMessage[] {
  if (!messages.length) return messages;
  const last = messages[messages.length - 1];
  if (last.role === "user" && last.content.trim() === currentPrompt.trim()) {
    return messages.slice(0, -1);
  }
  return messages;
}

function firstLine(text: string, max = 160): string {
  const line = text.trim().split(/\n+/)[0] || "";
  return truncate(line, max);
}

/**
 * Compress older turns into a compact timeline (Cursor-style history pruning).
 * Each turn = one user message + optional following assistant reply.
 */
export function buildOlderChatSummary(
  messages: BrainChatMessage[],
  maxChars: number
): string {
  if (!messages.length) return "";

  const bullets: string[] = [];
  let turn = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "user") continue;

    turn += 1;
    const assistant = messages[i + 1]?.role === "assistant" ? messages[i + 1] : null;
    const versionTag =
      assistant?.versionNumber != null ? `v${assistant.versionNumber}` : `#${turn}`;

    const userPart = truncate(msg.content, 100);
    const assistantPart = assistant
      ? truncate(firstLine(assistant.content, 120), 120)
      : "(pending)";

    bullets.push(`- [${versionTag}] User: ${userPart} → ${assistantPart}`);
    if (assistant) i += 1;
  }

  if (!bullets.length) return "";

  let summary = bullets.join("\n");
  if (summary.length > maxChars) {
    const kept = bullets.slice(-Math.floor(bullets.length * 0.6));
    const dropped = bullets.length - kept.length;
    summary = `(Earlier ${dropped} turns omitted)\n${kept.join("\n")}`;
    if (summary.length > maxChars) {
      summary = truncate(summary, maxChars);
    }
  }

  return summary;
}

function recentMessageCountForIntent(intent: ContextIntent): number {
  switch (intent) {
    case "bugfix":
      return 8;
    case "rewrite":
      return 6;
    case "asset_edit":
      return 4;
    default:
      return RECENT_CHAT_MESSAGE_COUNT;
  }
}

function relevancePickCountForIntent(intent: ContextIntent): number {
  switch (intent) {
    case "bugfix":
      return 4;
    case "iteration":
      return 3;
    default:
      return 2;
  }
}

/**
 * Tiered chat context for long conversations (50–100+ turns):
 * 1. Recent window — full verbatim messages
 * 2. Relevance picks — older messages matching current prompt
 * 3. Compressed summary — timeline of everything else
 */
export function prepareChatHistoryForContext(
  messages: BrainChatMessage[],
  currentPrompt: string,
  intent: ContextIntent,
  budget: BrainContextBudget
): PreparedChatContext {
  const history = excludeCurrentPromptDuplicate(messages, currentPrompt);
  const totalMessages = history.length;

  if (!totalMessages || intent === "greenfield") {
    return {
      olderSummary: null,
      messages: [],
      stats: { totalMessages: 0, summarizedCount: 0, recentCount: 0, relevanceCount: 0 },
    };
  }

  const recentCount = Math.min(
    recentMessageCountForIntent(intent),
    budget.maxChatMessages,
    totalMessages
  );
  const relevanceCap = relevancePickCountForIntent(intent);

  if (totalMessages <= LONG_CHAT_THRESHOLD) {
    const recentStart = Math.max(0, totalMessages - recentCount);
    const recent = history.slice(recentStart);
    const older = history.slice(0, recentStart);

    const rankedOlder = rankChatForSelection(older, currentPrompt);
    const relevanceCap = Math.min(relevancePickCountForIntent(intent), 2);

    const relevanceSelected = new Map<number, BrainChatMessage>();
    for (const { msg, index } of rankedOlder) {
      if (relevanceSelected.size >= relevanceCap) break;
      if (msg.role === "user" || msg.versionNumber != null) {
        relevanceSelected.set(index, msg);
      }
    }

    const summarizedMessages = older.filter((_, i) => !relevanceSelected.has(i));
    const maxSummaryChars = budget.maxSummaryChars ?? 2_000;
    const olderSummary =
      summarizedMessages.length > 0
        ? buildOlderChatSummary(summarizedMessages, maxSummaryChars)
        : null;

    const merged = new Map<number, BrainChatMessage>();
    for (const [index, msg] of relevanceSelected) merged.set(index, msg);
    for (let i = recentStart; i < totalMessages; i++) merged.set(i, history[i]);

    const chronological = [...merged.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, msg]) => msg);

    return {
      olderSummary,
      messages: chronological,
      stats: {
        totalMessages,
        summarizedCount: summarizedMessages.length,
        recentCount: recent.length,
        relevanceCount: relevanceSelected.size,
      },
    };
  }

  const recentStart = totalMessages - recentCount;
  const recent = history.slice(recentStart);
  const older = history.slice(0, recentStart);

  const rankedOlder = rankChatForSelection(older, currentPrompt);

  const recentIndices = new Set(
    Array.from({ length: recentCount }, (_, i) => recentStart + i)
  );

  const relevanceSelected = new Map<number, BrainChatMessage>();
  for (const { msg, index } of rankedOlder) {
    if (relevanceSelected.size >= relevanceCap) break;
    if (recentIndices.has(index)) continue;
    if (msg.role === "user" || msg.versionNumber != null) {
      relevanceSelected.set(index, msg);
    }
  }

  const summarizedIndices = new Set<number>();
  for (let i = 0; i < older.length; i++) {
    if (!relevanceSelected.has(i)) summarizedIndices.add(i);
  }

  const summarizedMessages = older.filter((_, i) => summarizedIndices.has(i));
  const maxSummaryChars = budget.maxSummaryChars ?? 4_000;
  const olderSummary = buildOlderChatSummary(summarizedMessages, maxSummaryChars);

  const merged = new Map<number, BrainChatMessage>();
  for (const [index, msg] of relevanceSelected) {
    merged.set(index, msg);
  }
  for (let i = recentStart; i < totalMessages; i++) {
    merged.set(i, history[i]);
  }

  const chronological = [...merged.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, msg]) => msg);

  return {
    olderSummary: olderSummary || null,
    messages: chronological,
    stats: {
      totalMessages,
      summarizedCount: summarizedMessages.length,
      recentCount: recent.length,
      relevanceCount: relevanceSelected.size,
    },
  };
}

export function formatPreparedChatSection(
  prepared: PreparedChatContext,
  budget: BrainContextBudget
): string {
  if (!prepared.messages.length && !prepared.olderSummary) return "";

  const parts: string[] = ["## Conversation history"];

  if (prepared.stats.summarizedCount > 0) {
    parts.push(
      `(${prepared.stats.totalMessages} messages total; ${prepared.stats.summarizedCount} older messages compressed, ${prepared.stats.recentCount} recent verbatim, ${prepared.stats.relevanceCount} relevance picks.)`
    );
    parts.push("\n### Earlier conversation (summarized)");
    parts.push(prepared.olderSummary || "");
  }

  if (prepared.messages.length) {
    parts.push("\n### Recent & relevant messages");
    const lines = prepared.messages.map((msg) => {
      const label =
        msg.role === "user"
          ? "User"
          : msg.versionNumber != null
            ? `Assistant (v${msg.versionNumber})`
            : "Assistant";
      const max =
        msg.role === "user"
          ? budget.maxUserMessageChars
          : budget.maxAssistantMessageChars;
      return `[${label}]: ${truncate(msg.content, max)}`;
    });
    parts.push(lines.join("\n\n"));
  }

  let section = parts.join("\n");
  const maxChatChars = budget.maxChatHistoryChars ?? 14_000;
  if (section.length > maxChatChars) {
    section = truncate(section, maxChatChars);
  }
  return section;
}
