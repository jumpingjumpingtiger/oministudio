"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Copy, Loader2, Paperclip, RotateCcw, Send, Square, X } from "lucide-react";
import type { GenerationLiveState, GenerationProgressEvent } from "@/lib/generation-progress";
import type { BrainSessionDisplay, EnhancedPromptDisplay } from "@/lib/brain-session-display";
import {
  parseAssistantMessageFiles,
  type ChangeManifest,
} from "@/lib/change-manifest";
import { getProgressMessages } from "@/lib/utils/progress-messages";
import { getChangeManifestLabels } from "@/lib/prompt-language";

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  files: string;
  createdAt: string;
  version?: { id: string; summary: string } | null;
}

interface VersionInfo {
  id: string;
  summary: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  pendingUserMessage?: ChatMessage | null;
  versions: VersionInfo[];
  projectName: string;
  isGenerating: boolean;
  generationProgress: GenerationProgressEvent[];
  generationLive?: GenerationLiveState;
  brainSession?: BrainSessionDisplay | null;
  onSend: (prompt: string, files: File[]) => void;
  onCancel?: () => void;
  onRetry?: () => void;
  generationError?: string | null;
  isFirstVisit?: boolean;
}

const MIN_INPUT_HEIGHT = 40;
const MAX_INPUT_HEIGHT = 160;

function oneLineSummary(text: string, max = 80): string {
  const line = text.trim().replace(/\s+/g, " ");
  if (line.length <= max) return line;
  return `${line.slice(0, max)}…`;
}

function EnhancedPromptPopover({ prompt }: { prompt: EnhancedPromptDisplay }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [anchorPoint, setAnchorPoint] = useState({ x: 0, y: 0 });
  const [layout, setLayout] = useState({ left: 0, top: 0, maxHeight: 320, maxWidth: 448 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const hide = useCallback(() => {
    setOpen(false);
    setDragOffset({ x: 0, y: 0 });
  }, []);

  const showAtPointer = useCallback((clientX: number, clientY: number) => {
    setAnchorPoint({ x: clientX, y: clientY });
    setDragOffset({ x: 0, y: 0 });
    setOpen(true);
  }, []);

  const copyPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt.enhanced);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, [prompt.enhanced]);

  useEffect(() => {
    if (!open) return;

    const margin = 8;
    const popoverWidth = Math.min(448, window.innerWidth - margin * 2);
    const availableAbove = anchorPoint.y - margin;
    const maxHeight = Math.max(120, Math.min(384, availableAbove));

    let left = anchorPoint.x + dragOffset.x;
    const top = anchorPoint.y + dragOffset.y;

    if (left + popoverWidth > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - popoverWidth);
    }
    if (left < margin) left = margin;

    setLayout({ left, top, maxHeight, maxWidth: popoverWidth });
  }, [open, anchorPoint, dragOffset]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => hide();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, hide]);

  const startDrag = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const originX = dragOffset.x;
    const originY = dragOffset.y;
    const startX = event.clientX;
    const startY = event.clientY;

    const onMove = (moveEvent: MouseEvent) => {
      setDragOffset({
        x: originX + (moveEvent.clientX - startX),
        y: originY + (moveEvent.clientY - startY),
      });
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <>
      <button
        type="button"
        className="text-[var(--accent)] underline decoration-dotted cursor-pointer text-left"
        onMouseEnter={(event) => showAtPointer(event.clientX, event.clientY)}
        onClick={(event) => {
          event.preventDefault();
          showAtPointer(event.clientX, event.clientY);
        }}
      >
        {prompt.summary}
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-[200] rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-xl flex flex-col"
            style={{
              left: layout.left,
              top: layout.top,
              width: layout.maxWidth,
              maxHeight: layout.maxHeight,
              transform: "translateY(-100%)",
            }}
            onMouseLeave={hide}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div
              className="flex items-center justify-between gap-2 border-b border-[var(--panel-border)] px-2 py-1.5 shrink-0 cursor-move select-none"
              onMouseDown={startDrag}
            >
              <span className="text-[10px] font-medium text-[var(--muted)]">Enhanced prompt</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void copyPrompt()}
                  className="btn-ghost text-[10px] flex items-center gap-1 px-1.5 py-0.5 cursor-pointer"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <Copy size={10} />
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={hide}
                  className="btn-ghost p-0.5 text-[var(--muted)] hover:text-[var(--foreground)] cursor-pointer"
                  aria-label="Close"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <X size={12} />
                </button>
              </div>
            </div>
            <pre
              tabIndex={0}
              className="p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words overflow-y-auto flex-1 min-h-0 overscroll-contain text-[var(--foreground)] focus:outline-none"
            >
              {prompt.enhanced}
            </pre>
          </div>,
          document.body
        )}
    </>
  );
}

function LlmThinkingPanel({
  text,
  phase,
}: {
  text: string;
  phase: "enhance" | "brain" | null;
}) {
  const scrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [text.length]);

  if (!text) return null;

  const label =
    phase === "enhance" ? "Refining prompt…" : "Brain LLM thinking…";

  return (
    <div className="mb-2 border-b border-black/10 pb-2">
      <p className="text-[10px] font-medium text-[var(--accent)] mb-1 flex items-center gap-1">
        <Loader2 size={10} className="animate-spin shrink-0" />
        {label}
      </p>
      <pre
        ref={scrollRef}
        className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all text-[10px] font-mono text-[var(--muted)]"
      >
        {text}
      </pre>
    </div>
  );
}

function ProgressLine({
  event,
  enhancedPrompt,
}: {
  event: GenerationProgressEvent;
  enhancedPrompt?: EnhancedPromptDisplay | null;
}) {
  const labels = getChangeManifestLabels();

  switch (event.type) {
    case "status":
      return <p className="text-xs text-[var(--muted)]">{event.message}</p>;
    case "thinking":
      return <p className="text-xs text-[var(--accent)]">{event.message}</p>;
    case "brain_calling":
      return (
        <p className="text-xs text-[var(--accent)] flex items-center gap-1">
          <Loader2 size={10} className="animate-spin shrink-0" />
          Brain LLM generating game plan and code…
        </p>
      );
    case "prompt_enhance_start":
      return (
        <p className="text-xs text-[var(--accent)] flex items-center gap-1">
          <Loader2 size={10} className="animate-spin shrink-0" />
          Refining user prompt with project context…
        </p>
      );
    case "prompt_enhanced": {
      const unchanged = event.enhanced.trim() === event.original.trim();
      const prompt: EnhancedPromptDisplay =
        enhancedPrompt ?? {
          original: event.original,
          enhanced: event.enhanced,
          summary: oneLineSummary(event.enhanced || event.original),
        };
      return (
        <p className="text-xs text-[var(--muted)]">
          {labels.promptEnhanced}
          {unchanged ? (
            labels.promptUnchanged
          ) : (
            <>
              {": "}
              <EnhancedPromptPopover prompt={prompt} />
            </>
          )}
        </p>
      );
    }
    case "brain_decision":
      return (
        <p className="text-xs text-[var(--accent)]">
          Plan ready — {event.files.length} file(s), {event.assets.length} asset(s)
        </p>
      );
    case "version_created":
      return (
        <p className="text-xs text-[var(--accent)]">
          Created version v{event.versionNumber}
        </p>
      );
    case "files_planned":
      return (
        <p className="text-xs text-[var(--muted)]">
          Planning {event.files.length} file(s) and {event.assetCount} asset(s)...
        </p>
      );
    case "file_planned":
      return (
        <p className="text-xs text-[var(--muted)] flex items-center gap-1">
          <Loader2 size={10} className="animate-spin shrink-0" />
          Queued: <code className="text-[10px]">{event.path}</code>
          {event.changeType === "new" && (
            <span className="text-green-600">(new)</span>
          )}
          {event.changeType === "modified" && (
            <span className="text-amber-600">(modified)</span>
          )}
        </p>
      );
    case "file_writing":
      return (
        <p className="text-xs text-[var(--accent)] flex items-center gap-1">
          <Loader2 size={10} className="animate-spin shrink-0" />
          <code className="text-[10px]">{event.path}</code>
        </p>
      );
    case "file_written":
      return (
        <p className="text-xs text-[var(--muted)] flex items-center gap-1">
          <CheckCircle2 size={10} className="text-green-500 shrink-0" />
          <code className="text-[10px]">{event.path}</code>
        </p>
      );
    case "code_complete":
      return (
        <p className="text-xs font-medium text-[var(--accent)]">
          {event.summary.slice(0, 80)}
          {event.summary.length > 80 ? "..." : ""}
        </p>
      );
    case "assets_planned":
      return (
        <p className="text-xs text-[var(--muted)]">
          {event.assets.length} asset(s) queued
        </p>
      );
    case "asset_generating":
      return (
        <p className="text-xs text-[var(--muted)] flex items-center gap-1">
          <Loader2 size={10} className="animate-spin shrink-0" />
          Generating asset {event.index}/{event.total}: {event.name}
        </p>
      );
    case "asset_generated":
      return (
        <p className="text-xs text-[var(--muted)] flex items-center gap-1">
          <CheckCircle2 size={10} className="text-green-500 shrink-0" />
          Asset ready: {event.name}
        </p>
      );
    case "asset_reused":
      return (
        <p className="text-xs text-[var(--muted)] flex items-center gap-1">
          <CheckCircle2 size={10} className="text-blue-500 shrink-0" />
          Reused asset: {event.name}
        </p>
      );
    case "asset_failed":
      return (
        <p className="text-xs text-[var(--danger)]">
          Asset failed ({event.name}): {event.error}
        </p>
      );
    case "complete":
      return (
        <p className="text-xs font-medium text-[var(--accent)]">
          Done — Version v{event.versionNumber}
        </p>
      );
    case "error":
      return <p className="text-xs text-[var(--danger)]">{event.message}</p>;
    case "cancelled":
      return <p className="text-xs text-[var(--muted)]">Generation cancelled.</p>;
    default:
      return null;
  }
}

/** Renders one Brain RAG feed line: section headers, recalled-slice rows, and detail lines. */
function BrainContextLine({ line }: { line: string }) {
  if (line.startsWith("[")) {
    const close = line.indexOf("]");
    const tag = close > 0 ? line.slice(1, close) : "";
    const rest = close > 0 ? line.slice(close + 1) : line;
    return (
      <p className="leading-relaxed mt-1 first:mt-0">
        <span className="text-[var(--accent)] font-semibold">{tag}</span>
        <span className="text-[var(--muted)]">{rest}</span>
      </p>
    );
  }
  // Recalled-slice rows and assembled-fragment rows are indented bullets.
  if (line.startsWith("  •") || line.startsWith("  ▸")) {
    return (
      <p className="leading-relaxed pl-3 text-[var(--foreground)]/70 truncate" title={line.trim()}>
        {line.trim()}
      </p>
    );
  }
  return (
    <p className="leading-relaxed pl-3 text-[var(--muted)] truncate" title={line.trim()}>
      {line.trim()}
    </p>
  );
}

function BrainContextFeed({ session }: { session: BrainSessionDisplay }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [session.contextLines.length, session.outputTokens]);

  if (
    session.inputTokens == null &&
    session.outputTokens == null &&
    session.contextLines.length === 0
  ) {
    return null;
  }

  const callingLabel =
    session.status === "streaming"
      ? "Brain LLM streaming…"
      : session.status === "calling"
        ? "Calling Brain LLM…"
        : null;

  return (
    <div className="mb-2 rounded-md border border-[var(--accent)]/20 bg-[var(--accent)]/5 p-2 text-[10px] font-mono">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-1.5 text-[var(--accent)]">
        {session.inputTokens != null && (
          <span>Input ~{session.inputTokens.toLocaleString()} tokens</span>
        )}
        {session.outputTokens != null && (
          <span>Output ~{session.outputTokens.toLocaleString()} tokens</span>
        )}
        {callingLabel && session.outputTokens == null && (
          <span className="flex items-center gap-1">
            <Loader2 size={10} className="animate-spin shrink-0" />
            {callingLabel}
          </span>
        )}
      </div>
      {session.contextLines.length > 0 && (
        <div
          ref={scrollRef}
          className="max-h-56 overflow-y-auto space-y-0.5 text-[var(--muted)]"
        >
          {session.contextLines.map((line, i) => (
            <BrainContextLine key={i} line={line} />
          ))}
        </div>
      )}
    </div>
  );
}

function NodePipeline({ steps }: { steps: GenerationLiveState["nodeSteps"] }) {
  if (!steps.length) return null;
  return (
    <div className="mb-2 border-b border-black/10 pb-2">
      <p className="font-medium text-[var(--muted)] mb-1 text-xs">Graph pipeline</p>
      <ul className="space-y-0.5 text-[10px]">
        {steps.map((step) => (
          <li key={step.node} className="flex items-center gap-1 truncate">
            {step.status === "done" ? (
              <CheckCircle2 size={10} className="text-green-500 shrink-0" />
            ) : (
              <Loader2 size={10} className="animate-spin text-[var(--accent)] shrink-0" />
            )}
            <span className="truncate">{step.label}</span>
            <span className="text-[var(--muted)] opacity-60 shrink-0">({step.phase})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChangeManifestPanel({ manifest }: { manifest: ChangeManifest }) {
  const labels = getChangeManifestLabels();
  const hasFiles =
    manifest.files.added.length +
      manifest.files.modified.length +
      manifest.files.deleted.length >
    0;
  const hasAssets =
    manifest.assets.added.length +
      manifest.assets.modified.length +
      manifest.assets.deleted.length +
      manifest.assets.reused.length >
    0;

  if (!hasFiles && !hasAssets) return null;

  const fileRow = (label: string, paths: string[], className: string) =>
    paths.length > 0 && (
      <div className="mb-1">
        <p className={`text-[10px] font-medium ${className}`}>{label}</p>
        <ul className="font-mono text-[10px] space-y-0.5 pl-1">
          {paths.map((p) => (
            <li key={p} className="truncate" title={p}>
              {p}
            </li>
          ))}
        </ul>
      </div>
    );

  const assetRow = (
    label: string,
    items: { name: string; uri: string }[],
    className: string
  ) =>
    items.length > 0 && (
      <div className="mb-1">
        <p className={`text-[10px] font-medium ${className}`}>{label}</p>
        <ul className="text-[10px] space-y-0.5 pl-1">
          {items.map((a) => (
            <li key={a.uri} className="truncate" title={a.uri}>
              {a.name}
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="mt-2 pt-2 border-t border-black/10 space-y-2 text-xs">
      {hasFiles && (
        <div>
          <p className="font-medium text-[var(--muted)] mb-1">{labels.fileChanges}</p>
          {fileRow(labels.added, manifest.files.added, "text-green-600")}
          {fileRow(labels.modified, manifest.files.modified, "text-amber-600")}
          {fileRow(labels.deleted, manifest.files.deleted, "text-red-600")}
        </div>
      )}
      {hasAssets && (
        <div>
          <p className="font-medium text-[var(--muted)] mb-1">{labels.assetChanges}</p>
          {assetRow(labels.added, manifest.assets.added, "text-green-600")}
          {assetRow(labels.modified, manifest.assets.modified, "text-amber-600")}
          {assetRow(labels.deleted, manifest.assets.deleted, "text-red-600")}
          {assetRow(labels.reused, manifest.assets.reused, "text-blue-600")}
        </div>
      )}
    </div>
  );
}

function GenerationLiveSummary({ live }: { live: GenerationLiveState }) {
  const hasFiles = live.plannedFiles.length > 0;
  const hasAssets = live.plannedAssets.length > 0;
  const hasNodes = live.nodeSteps.length > 0;
  const hasManifest = live.changeManifest != null;
  if (!hasFiles && !hasAssets && !hasNodes && !hasManifest) return null;

  return (
    <div className="mb-2 space-y-2 text-xs border-b border-black/10 pb-2">
      {hasNodes && <NodePipeline steps={live.nodeSteps} />}
      {hasManifest && live.changeManifest && (
        <ChangeManifestPanel manifest={live.changeManifest} />
      )}
      {!hasManifest && hasFiles && (
        <div>
          <p className="font-medium text-[var(--muted)] mb-1">Code files</p>
          <ul className="space-y-0.5 font-mono text-[10px]">
            {live.plannedFiles.map((path) => {
              const isWriting = live.writingFilePath === path;
              const isDone = live.completedFiles.includes(path);
              return (
                <li key={path} className="flex items-center gap-1 truncate">
                  {isWriting ? (
                    <Loader2 size={10} className="animate-spin text-[var(--accent)] shrink-0" />
                  ) : isDone ? (
                    <CheckCircle2 size={10} className="text-green-500 shrink-0" />
                  ) : (
                    <Loader2 size={10} className="animate-spin text-[var(--muted)] opacity-40 shrink-0" />
                  )}
                  <span className="truncate">{path}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {!hasManifest && hasAssets && (
        <div>
          <p className="font-medium text-[var(--muted)] mb-1">Assets</p>
          <ul className="space-y-0.5 text-[10px]">
            {live.plannedAssets.map((asset) => {
              const isGenerating = live.generatingAssetUri === asset.uri;
              const isDone = live.completedAssetUris.includes(asset.uri);
              return (
                <li key={asset.uri} className="flex items-center gap-1 truncate">
                  {isGenerating ? (
                    <Loader2 size={10} className="animate-spin text-[var(--accent)] shrink-0" />
                  ) : isDone ? (
                    <CheckCircle2
                      size={10}
                      className={`shrink-0 ${asset.regenerate ? "text-green-500" : "text-blue-500"}`}
                    />
                  ) : (
                    <Loader2 size={10} className="animate-spin text-[var(--muted)] opacity-40 shrink-0" />
                  )}
                  <span className="truncate">{asset.name}</span>
                  {!asset.regenerate && (
                    <span className="text-[var(--muted)] shrink-0">(reuse)</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function getVersionNumber(versions: VersionInfo[], versionId?: string | null): number | null {
  if (!versionId) return null;
  const idx = versions.findIndex((v) => v.id === versionId);
  return idx >= 0 ? versions.length - idx : null;
}

export function ChatPanel({
  messages,
  pendingUserMessage,
  versions,
  projectName,
  isGenerating,
  generationProgress,
  generationLive,
  brainSession,
  onSend,
  onCancel,
  onRetry,
  generationError,
  isFirstVisit,
}: ChatPanelProps) {
  const progressLabels = getProgressMessages();
  const [input, setInput] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(
      Math.max(textarea.scrollHeight, MIN_INPUT_HEIGHT),
      MAX_INPUT_HEIGHT
    );
    textarea.style.height = `${nextHeight}px`;
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isGenerating, generationProgress, generationLive, pendingUserMessage, brainSession]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  const handleSend = () => {
    if (!input.trim() || isGenerating) return;
    onSend(input.trim(), attachedFiles);
    setInput("");
    setAttachedFiles([]);
    requestAnimationFrame(adjustTextareaHeight);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setAttachedFiles((prev) => [...prev, ...files]);
    e.target.value = "";
  };

  const parseFiles = (filesJson: string) => {
    try {
      const parsed = JSON.parse(filesJson);
      if (Array.isArray(parsed)) {
        return parsed as { name: string; type: string; size: number }[];
      }
    } catch {
      // ignore
    }
    return [];
  };

  return (
    <div className="h-full flex flex-col bg-[var(--panel-bg)]">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 && !isGenerating && !pendingUserMessage && (
          <div className="text-center py-8">
            <p className="text-sm text-[var(--muted)]">
              {isFirstVisit
                ? "Describe the game you want to create to get started..."
                : "Describe the game you want to create..."}
            </p>
            <p className="text-xs text-[var(--muted)] mt-1">
              Example: &quot;Create a space shooter game with asteroids and power-ups&quot;
            </p>
            {isFirstVisit && (
              <p className="text-xs text-[var(--accent)] mt-2">
                A project will be created automatically from your first message
              </p>
            )}
          </div>
        )}

        {messages.map((msg) => {
          const isUser = msg.role === "user";
          const attachmentFiles = parseFiles(msg.files);
          const assistantPayload = !isUser ? parseAssistantMessageFiles(msg.files) : {};
          const versionNum = getVersionNumber(versions, msg.version?.id);

          return (
            <div
              key={msg.id}
              className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}
            >
              {!isUser && (
                <div className="w-7 h-7 rounded-full bg-[var(--accent)] flex items-center justify-center shrink-0 text-[10px] font-bold text-white">
                  {projectName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className={`max-w-[70%] ${isUser ? "order-first" : ""}`}>
                <div
                  className={`px-3 py-2 text-sm ${
                    isUser ? "chat-bubble-user" : "chat-bubble-assistant"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {attachmentFiles.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {attachmentFiles.map((f, i) => (
                        <span
                          key={i}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-black/10"
                        >
                          {f.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {assistantPayload.changeManifest && (
                    <ChangeManifestPanel manifest={assistantPayload.changeManifest} />
                  )}
                  {!isUser && versionNum && (
                    <div className="mt-2 pt-1.5 border-t border-black/10">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] font-medium">
                        Version v{versionNum}
                      </span>
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-[var(--muted)] mt-0.5 px-1">
                  {new Date(msg.createdAt).toLocaleTimeString()}
                </p>
              </div>
            </div>
          );
        })}

        {pendingUserMessage &&
          !messages.some(
            (m) =>
              m.role === "user" &&
              m.content === pendingUserMessage.content &&
              Math.abs(
                new Date(m.createdAt).getTime() -
                  new Date(pendingUserMessage.createdAt).getTime()
              ) < 60000
          ) && (
            <div className="flex gap-2 justify-end">
              <div className="max-w-[70%] order-first">
                <div className="px-3 py-2 text-sm chat-bubble-user">
                  <p className="whitespace-pre-wrap">{pendingUserMessage.content}</p>
                  {parseFiles(pendingUserMessage.files).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {parseFiles(pendingUserMessage.files).map((f, i) => (
                        <span
                          key={i}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-black/10"
                        >
                          {f.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-[var(--muted)] mt-0.5 px-1 text-right">
                  {new Date(pendingUserMessage.createdAt).toLocaleTimeString()}
                </p>
              </div>
            </div>
          )}

        {generationError && !isGenerating && (
          <div className="px-1 mb-2 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-600 flex items-center justify-between gap-2">
            <span>{generationError}</span>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="btn-ghost text-xs flex items-center gap-1 shrink-0"
              >
                <RotateCcw size={12} />
                Retry
              </button>
            )}
          </div>
        )}

        {isGenerating && brainSession && (
          <div className="px-1">
            <BrainContextFeed session={brainSession} />
          </div>
        )}

        {isGenerating && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full bg-[var(--accent)] flex items-center justify-center shrink-0 text-[10px] font-bold text-white">
              {projectName.slice(0, 2).toUpperCase()}
            </div>
            <div className="chat-bubble-assistant px-3 py-2 max-w-[70%]">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 size={14} className="animate-spin text-[var(--accent)]" />
                <span className="text-sm font-medium">{progressLabels.generatingGame}</span>
              </div>
              {generationLive && <GenerationLiveSummary live={generationLive} />}
              {brainSession?.thinkingText && (
                <LlmThinkingPanel
                  text={brainSession.thinkingText}
                  phase={brainSession.thinkingPhase}
                />
              )}
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {generationProgress.map((event, i) => (
                  <ProgressLine
                    key={i}
                    event={event}
                    enhancedPrompt={brainSession?.enhancedPrompt}
                  />
                ))}
                {generationProgress.length === 0 && (
                  <p className="text-xs text-[var(--muted)]">{progressLabels.starting}</p>
                )}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 border-t border-[var(--panel-border)] p-3">
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {attachedFiles.map((f, i) => (
              <span
                key={i}
                className="text-xs px-2 py-0.5 rounded bg-[var(--input-bg)] border border-[var(--panel-border)] flex items-center gap-1"
              >
                {f.name}
                <button
                  onClick={() =>
                    setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))
                  }
                  className="text-[var(--muted)] hover:text-[var(--danger)]"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          {isGenerating && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="btn-ghost p-2 shrink-0 mb-0.5 text-[var(--danger)]"
              title="Stop generation"
            >
              <Square size={16} />
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isGenerating}
            className="btn-ghost p-2 shrink-0 mb-0.5"
            title="Attach file"
          >
            <Paperclip size={16} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Describe your game idea..."
            disabled={isGenerating}
            rows={1}
            className="flex-1 px-3 py-2 text-sm rounded-lg input-field resize-none overflow-y-auto disabled:opacity-50 leading-5"
            style={{ minHeight: MIN_INPUT_HEIGHT, maxHeight: MAX_INPUT_HEIGHT }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isGenerating}
            className="btn-primary p-2 shrink-0 mb-0.5"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
