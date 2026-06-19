"use client";

import { useEffect, useRef, useState } from "react";
import { Bug, Download, GripVertical, Loader2, X } from "lucide-react";
import clsx from "clsx";
import { useDragPosition } from "@/hooks/useDragPosition";

type DebugTab = "brain" | "image" | "png";

interface LlmConfig {
  brain: { provider: string; model: string; configured: boolean; apiKeyEnv: string };
  image: { provider: string; model: string; configured: boolean; apiKeyEnv: string };
  png: { converter: string; available: boolean };
}

interface PngConvertResult {
  preview: string;
  fileName: string;
  png: {
    isValidPngBefore: boolean;
    isValidPngAfter: boolean;
    isFakePngBefore?: boolean;
    isFakePngAfter?: boolean;
    isRealPng: boolean;
    normalized: boolean;
    detectedFormatBefore: string | null;
    detectedFormatAfter: string | null;
  };
}

export function ModelDebugPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DebugTab>("brain");
  const [prompt, setPrompt] = useState("");
  const [pngFile, setPngFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<LlmConfig | null>(null);
  const [output, setOutput] = useState<string>("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [pngResult, setPngResult] = useState<PngConvertResult | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const drag = useDragPosition({ defaultTop: 64, defaultRight: 16 });

  useEffect(() => {
    return () => {
      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    };
  }, [uploadPreview]);

  useEffect(() => {
    if (open && !config) {
      fetch("/api/debug/llm")
        .then((r) => r.json())
        .then(setConfig)
        .catch(() => {});
    }
  }, [open, config]);

  const handlePngFileChange = (file: File | null) => {
    setPngFile(file);
    setPngResult(null);
    setOutput("");
    setImagePreview(null);
    if (uploadPreview) {
      URL.revokeObjectURL(uploadPreview);
    }
    setUploadPreview(file ? URL.createObjectURL(file) : null);
  };

  const downloadConvertedPng = () => {
    if (!pngResult?.preview) return;
    const link = document.createElement("a");
    link.href = pngResult.preview;
    const baseName = pngResult.fileName.replace(/\.png$/i, "") || "image";
    link.download = `${baseName}-real.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleRun = async () => {
    if (tab === "png" ? !pngFile : !prompt.trim()) return;
    setLoading(true);
    setOutput("");
    setImagePreview(null);
    if (tab === "png") setPngResult(null);

    try {
      let res: Response;

      if (tab === "png") {
        const formData = new FormData();
        formData.append("type", "png");
        formData.append("file", pngFile!);
        res = await fetch("/api/debug/llm", {
          method: "POST",
          body: formData,
        });
      } else {
        res = await fetch("/api/debug/llm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: tab, prompt: prompt.trim() }),
        });
      }

      const data = await res.json();

      if (!res.ok || !data.success) {
        setOutput(JSON.stringify(data, null, 2));
        return;
      }

      if (tab === "png" && data.result?.preview) {
        const result: PngConvertResult = {
          preview: data.result.preview,
          fileName: data.result.fileName ?? pngFile?.name ?? "image.png",
          png: data.result.png,
        };
        setPngResult(result);
        setImagePreview(result.preview);
        setOutput(JSON.stringify({ ...data, result: { ...data.result, preview: "[base64 image omitted]" } }, null, 2));
      } else if (tab === "image" && data.result?.preview) {
        setOutput(
          JSON.stringify(
            { ...data, result: { ...data.result, preview: "[base64 image omitted]" } },
            null,
            2
          )
        );
        setImagePreview(data.result.preview);
      } else {
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

  const tabLabel = (t: DebugTab) => {
    if (t === "png") return "PNG LLM";
    return `${t} LLM`;
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

            <div className="flex gap-1 px-4 pt-3 flex-wrap">
              {(["brain", "image", "png"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setTab(t);
                    setOutput("");
                    setImagePreview(null);
                    setPngResult(null);
                  }}
                  className={clsx(
                    "px-3 py-1.5 rounded-md text-xs font-medium capitalize",
                    tab === t ? "tab-active" : "text-[var(--muted)] hover-item"
                  )}
                >
                  {tabLabel(t)}
                </button>
              ))}
            </div>

            {config && (
              <div className="px-4 pt-2 text-[10px] text-[var(--muted)]">
                {tab === "brain" &&
                  `${config.brain.provider} / ${config.brain.model} · ${config.brain.apiKeyEnv} ${config.brain.configured ? "✓" : "(mock mode)"}`}
                {tab === "image" &&
                  `${config.image.provider} / ${config.image.model} · ${config.image.apiKeyEnv} ${config.image.configured ? "✓" : "(not configured)"}`}
                {tab === "png" &&
                  `${config.png.converter} · upload PNG, convert, and download a valid PNG`}
              </div>
            )}

            <div className="p-4 space-y-3 flex-1 overflow-y-auto">
              {tab === "png" ? (
                <div className="space-y-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,.png"
                    className="hidden"
                    onChange={(e) => handlePngFileChange(e.target.files?.[0] ?? null)}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-ghost text-xs px-3 py-2 w-full text-left border border-dashed border-[var(--panel-border)] rounded-lg"
                  >
                    {pngFile ? pngFile.name : "Upload a PNG file…"}
                  </button>

                  {uploadPreview && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-[var(--muted)]">Original upload</p>
                      <div className="border border-[var(--panel-border)] rounded-lg p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={uploadPreview}
                          alt="Uploaded PNG"
                          className="max-h-36 mx-auto rounded"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
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
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleRun}
                  disabled={loading || (tab === "png" ? !pngFile : !prompt.trim())}
                  className="btn-primary flex items-center gap-2 text-xs"
                >
                  {loading && <Loader2 size={12} className="animate-spin" />}
                  {tab === "png" ? "Convert to real PNG" : "Run Test"}
                </button>

                {tab === "png" && pngResult && (
                  <button
                    onClick={downloadConvertedPng}
                    className="btn-ghost flex items-center gap-2 text-xs border border-[var(--panel-border)]"
                  >
                    <Download size={12} />
                    Download PNG
                  </button>
                )}
              </div>

              {tab === "png" && pngResult && (
                <div className="text-[10px] text-[var(--muted)] space-y-0.5">
                  <p>
                    Before: {pngResult.png.detectedFormatBefore ?? "unknown"}
                    {pngResult.png.isFakePngBefore
                      ? " (fake PNG)"
                      : pngResult.png.isValidPngBefore
                        ? " (valid PNG)"
                        : " (invalid PNG)"}
                  </p>
                  <p>
                    After: {pngResult.png.detectedFormatAfter ?? "unknown"}
                    {pngResult.png.isRealPng ? " (real PNG ✓)" : " (still invalid)"}
                  </p>
                </div>
              )}

              {imagePreview && tab === "png" && pngResult && (
                <div className="space-y-1">
                  <p className="text-[10px] text-[var(--muted)]">Converted PNG</p>
                  <div className="border border-[var(--panel-border)] rounded-lg p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imagePreview} alt="Converted PNG" className="max-h-48 mx-auto rounded" />
                  </div>
                </div>
              )}

              {imagePreview && tab === "image" && (
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
