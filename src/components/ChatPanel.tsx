"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Paperclip, Send } from "lucide-react";
import type { GenerationLiveState, GenerationProgressEvent } from "@/lib/generation-progress";
import { getProgressMessages } from "@/lib/utils/progress-messages";

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
  onSend: (prompt: string, files: File[]) => void;
  isFirstVisit?: boolean;
}

const MIN_INPUT_HEIGHT = 40;
const MAX_INPUT_HEIGHT = 160;

function ProgressLine({ event }: { event: GenerationProgressEvent }) {
  switch (event.type) {
    case "status":
      return <p className="text-xs text-[var(--muted)]">{event.message}</p>;
    case "thinking":
      return <p className="text-xs text-[var(--accent)]">{event.message}</p>;
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
    default:
      return null;
  }
}

function GenerationLiveSummary({ live }: { live: GenerationLiveState }) {
  const hasFiles = live.plannedFiles.length > 0;
  const hasAssets = live.plannedAssets.length > 0;
  if (!hasFiles && !hasAssets) return null;

  return (
    <div className="mb-2 space-y-2 text-xs border-b border-black/10 pb-2">
      {hasFiles && (
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
      {hasAssets && (
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
  onSend,
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
  }, [messages, isGenerating, generationProgress, generationLive, pendingUserMessage]);

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
      return JSON.parse(filesJson) as { name: string; type: string; size: number }[];
    } catch {
      return [];
    }
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
          const files = parseFiles(msg.files);
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
                  {files.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {files.map((f, i) => (
                        <span
                          key={i}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-black/10"
                        >
                          {f.name}
                        </span>
                      ))}
                    </div>
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
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {generationProgress.map((event, i) => (
                  <ProgressLine key={i} event={event} />
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
