"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { PreviewErrorBoundary } from "@/components/PreviewErrorBoundary";

interface GamePreviewProps {
  projectId: string;
  refreshKey: number;
  versionId?: string | null;
  isGenerating?: boolean;
  generationPhase?: "code" | "assets" | null;
}

function GamePreviewInner({
  projectId,
  refreshKey,
  versionId,
  isGenerating,
  generationPhase,
}: GamePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);

  const codeGenerationActive = isGenerating && generationPhase === "code";

  const loadPreview = useCallback(async () => {
    if (codeGenerationActive) return;

    setLoading(true);
    setError(null);

    try {
      const versionQuery = versionId ? `?versionId=${versionId}` : "";
      const checkRes = await fetch(`/api/projects/${projectId}/preview${versionQuery}`, {
        cache: "no-store",
      });
      if (!checkRes.ok) {
        const data = await checkRes.json();
        throw new Error(data.error || "Failed to load preview");
      }

      const data = await checkRes.json();
      if (!data.files?.["index.html"]) {
        if (!isGenerating) {
          setError("No game code available. Send a prompt to generate a game.");
        }
        setLoading(false);
        return;
      }

      const iframe = iframeRef.current;
      if (iframe) {
        const playQuery = new URLSearchParams({ v: String(refreshKey), t: String(Date.now()) });
        if (versionId) playQuery.set("versionId", versionId);
        iframe.src = `/api/projects/${projectId}/play?${playQuery}`;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  }, [projectId, refreshKey, versionId, isGenerating, codeGenerationActive]);

  const scheduleLoadPreview = useCallback(() => {
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => {
      loadTimerRef.current = null;
      void loadPreview();
    }, 350);
  }, [loadPreview]);

  useEffect(() => {
    if (codeGenerationActive) {
      if (iframeRef.current) {
        iframeRef.current.src = "about:blank";
      }
      setLoading(false);
      setError(null);
      return;
    }

    scheduleLoadPreview();

    return () => {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    };
  }, [codeGenerationActive, scheduleLoadPreview, refreshKey, versionId]);

  const content = (
    <>
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--panel-border)] shrink-0">
        <span className="text-xs text-[var(--muted)] flex items-center gap-2">
          Game Preview
          {isGenerating && (
            <span className="text-[var(--accent)] inline-flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" />
              {codeGenerationActive ? "Waiting for code…" : "Live"}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void loadPreview()}
            disabled={loading || codeGenerationActive}
            className="btn-ghost flex items-center gap-1 text-xs"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Refresh
          </button>
          <button
            onClick={() => setMaximized((m) => !m)}
            className="btn-ghost flex items-center gap-1 text-xs"
            title={maximized ? "Exit fullscreen" : "Maximize preview"}
          >
            {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            {maximized ? "Exit" : "Maximize"}
          </button>
        </div>
      </div>

      <div className="flex-1 relative bg-[var(--input-bg)] min-h-0 flex items-center justify-center p-4">
        {codeGenerationActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-[var(--input-bg)] gap-2">
            <Loader2 size={28} className="animate-spin text-[var(--accent)]" />
            <p className="text-sm text-[var(--muted)]">Generating game code…</p>
            <p className="text-xs text-[var(--muted)] max-w-sm text-center">
              Preview loads after code generation completes to avoid broken partial files.
            </p>
          </div>
        )}
        {error && !isGenerating && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-[var(--input-bg)]">
            <p className="text-sm text-[var(--muted)]">{error}</p>
          </div>
        )}
        <iframe
          ref={iframeRef}
          className="w-full max-w-[960px] aspect-[4/3] max-h-full border-0 rounded-lg shadow-md border border-[var(--panel-border)] bg-[#eef1f5]"
          sandbox="allow-scripts allow-same-origin"
          title="Game Preview"
          onLoad={() => setLoading(false)}
        />
      </div>
    </>
  );

  if (maximized) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-[var(--panel-bg)]">
        {content}
      </div>
    );
  }

  return <div className="h-full flex flex-col">{content}</div>;
}

export function GamePreview(props: GamePreviewProps) {
  const [boundaryKey, setBoundaryKey] = useState(0);

  return (
    <PreviewErrorBoundary
      key={boundaryKey}
      onReset={() => {
        setBoundaryKey((k) => k + 1);
      }}
    >
      <GamePreviewInner {...props} />
    </PreviewErrorBoundary>
  );
}
