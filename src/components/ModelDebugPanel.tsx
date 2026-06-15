"use client";

import { useEffect, useRef, useState } from "react";
import { Bug, GripVertical, Loader2, X } from "lucide-react";
import clsx from "clsx";
import { useDragPosition } from "@/hooks/useDragPosition";

interface LlmConfig {
  brain: { provider: string; model: string; configured: boolean };
  image: { provider: string; model: string; configured: boolean };
}

export function ModelDebugPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"brain" | "image">("brain");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<LlmConfig | null>(null);
  const [output, setOutput] = useState<string>("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const drag = useDragPosition({ defaultTop: 64, defaultRight: 16 });

  useEffect(() => {
    if (open && !config) {
      fetch("/api/debug/llm")
        .then((r) => r.json())
        .then(setConfig)
        .catch(() => {});
    }
  }, [open, config]);

  const handleRun = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setOutput("");

    try {
      const res = await fetch("/api/debug/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: tab, prompt: prompt.trim() }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setOutput(JSON.stringify(data, null, 2));
        return;
      }

      if (tab === "image" && data.result?.preview) {
        setOutput(
          JSON.stringify(
            { ...data, result: { ...data.result, preview: "[base64 image omitted]" } },
            null,
            2
          )
        );
        setImagePreview(data.result.preview);
      } else {
        setImagePreview(null);
        setOutput(JSON.stringify(data, null, 2));
      }
    } catch (err) {
      setOutput(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const handleButtonClick = () => {
    if (drag.wasDragged()) {
      drag.resetMoved();
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <button
        onClick={handleButtonClick}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        style={drag.style}
        className="fixed z-50 flex items-center gap-1.5 px-3 py-2 rounded-full shadow-lg bg-[var(--panel-bg)] border border-[var(--panel-border)] text-xs font-medium hover:bg-[var(--hover-bg)] transition-colors cursor-grab active:cursor-grabbing select-none touch-none"
        title="Drag to move, click to open"
      >
        <GripVertical size={12} className="text-[var(--muted)]" />
        <Bug size={14} className="text-[var(--accent)]" />
        Model Debug
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/30">
          <div className="w-full sm:w-[640px] sm:max-h-[80vh] bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-t-xl sm:rounded-xl shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--panel-border)]">
              <div className="flex items-center gap-2">
                <Bug size={16} className="text-[var(--accent)]" />
                <span className="font-medium text-sm">Model Debug</span>
              </div>
              <button onClick={() => setOpen(false)} className="btn-ghost p-1">
                <X size={16} />
              </button>
            </div>

            <div className="flex gap-1 px-4 pt-3">
              {(["brain", "image"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setTab(t);
                    setOutput("");
                    setImagePreview(null);
                  }}
                  className={clsx(
                    "px-3 py-1.5 rounded-md text-xs font-medium capitalize",
                    tab === t ? "tab-active" : "text-[var(--muted)] hover-item"
                  )}
                >
                  {t} LLM
                </button>
              ))}
            </div>

            {config && (
              <div className="px-4 pt-2 text-[10px] text-[var(--muted)]">
                {tab === "brain"
                  ? `${config.brain.provider} / ${config.brain.model} ${config.brain.configured ? "" : "(mock mode)"}`
                  : `${config.image.provider} / ${config.image.model} ${config.image.configured ? "" : "(not configured)"}`}
              </div>
            )}

            <div className="p-4 space-y-3 flex-1 overflow-y-auto">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  tab === "brain"
                    ? "Enter a game prompt to test brain LLM..."
                    : "Enter an image prompt to test image LLM..."
                }
                rows={3}
                className="w-full px-3 py-2 text-sm rounded-lg input-field resize-none"
              />

              <button
                onClick={handleRun}
                disabled={loading || !prompt.trim()}
                className="btn-primary flex items-center gap-2 text-xs"
              >
                {loading && <Loader2 size={12} className="animate-spin" />}
                Run Test
              </button>

              {imagePreview && (
                <div className="border border-[var(--panel-border)] rounded-lg p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreview} alt="Debug output" className="max-h-48 mx-auto rounded" />
                </div>
              )}

              {output && (
                <pre className="text-[11px] bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap">
                  {output}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
