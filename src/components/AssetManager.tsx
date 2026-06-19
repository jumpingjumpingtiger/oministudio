"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ImagePlus,
  Loader2,
  RefreshCw,
  Replace,
  Save,
  Trash2,
} from "lucide-react";
import clsx from "clsx";
import type { GenerationLiveState } from "@/lib/generation-progress";
import { getAssetPublicPath, normalizeLegacyAssetUrl, toAbsoluteUrl } from "@/lib/utils/asset-url";

interface VersionAsset {
  id: string;
  name: string;
  type: string;
  uri: string;
  url: string;
  prompt: string;
  order: number;
  regenerate?: boolean;
}

type AssetStatus = "pending" | "generating" | "done" | "reused";

interface AssetManagerProps {
  projectId: string;
  refreshKey: number;
  versionId?: string | null;
  isGenerating?: boolean;
  generationPhase?: "code" | "assets" | null;
  generationLive?: GenerationLiveState;
  onRefresh: () => void;
}

function getAssetStatus(
  uri: string,
  live?: GenerationLiveState,
  isGenerating?: boolean
): AssetStatus {
  if (!isGenerating || !live) return "done";
  if (live.generatingAssetUri === uri) return "generating";
  if (live.completedAssetUris.includes(uri)) {
    const planned = live.plannedAssets.find((a) => a.uri === uri);
    return planned && !planned.regenerate ? "reused" : "done";
  }
  if (live.plannedAssets.some((a) => a.uri === uri)) return "pending";
  return "done";
}

function groupByType(assets: VersionAsset[]): Record<string, VersionAsset[]> {
  const groups: Record<string, VersionAsset[]> = {};
  for (const asset of assets) {
    const type = asset.type || "img";
    if (!groups[type]) groups[type] = [];
    groups[type].push(asset);
  }
  for (const type of Object.keys(groups)) {
    groups[type].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }
  return groups;
}

export function AssetManager({
  projectId,
  refreshKey,
  versionId,
  isGenerating,
  generationPhase,
  generationLive,
  onRefresh,
}: AssetManagerProps) {
  const [assets, setAssets] = useState<VersionAsset[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [selectedUri, setSelectedUri] = useState<string | null>(null);
  const selectedUriInitialized = useRef(false);
  const [loading, setLoading] = useState(false);
  const [expandedTypes, setExpandedTypes] = useState<Record<string, boolean>>({ img: true });
  const [editPrompt, setEditPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const query = versionId ? `?versionId=${versionId}` : "";
      const res = await fetch(`/api/projects/${projectId}/assets${query}`);
      const data = await res.json();
      const list: VersionAsset[] = data.assets || [];
      setAssets(list);
      setCurrentVersionId(data.versionId ?? null);
      if (list.length > 0 && !selectedUriInitialized.current) {
        setSelectedUri(list[0].uri);
        selectedUriInitialized.current = true;
      }
    } finally {
      setLoading(false);
    }
  }, [projectId, versionId]);

  useEffect(() => {
    selectedUriInitialized.current = false;
    setSelectedUri(null);
  }, [versionId, projectId]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets, refreshKey]);

  const liveAssets: VersionAsset[] =
    isGenerating && generationLive?.plannedAssets.length
      ? generationLive.plannedAssets.map((a, i) => {
          const existing = assets.find((x) => x.uri === a.uri);
          return (
            existing ?? {
              id: "",
              name: a.name,
              type: "img",
              uri: a.uri,
              url: "",
              prompt: "",
              order: i,
              regenerate: a.regenerate,
            }
          );
        })
      : assets;

  const displayAssets = liveAssets.length ? liveAssets : assets;
  const selected = displayAssets.find((a) => a.uri === selectedUri) ?? null;

  useEffect(() => {
    if (selected) setEditPrompt(selected.prompt);
  }, [selected]);

  useEffect(() => {
    if (isGenerating && generationLive?.generatingAssetUri) {
      setSelectedUri(generationLive.generatingAssetUri);
    }
  }, [isGenerating, generationLive?.generatingAssetUri]);

  const grouped = groupByType(displayAssets);

  const getImageSrc = (asset: VersionAsset) => {
    if (!asset.id) return "";
    const assetPath = normalizeLegacyAssetUrl(
      asset.url?.startsWith("/api/") ? asset.url : getAssetPublicPath(projectId, asset),
      projectId
    );
    const bust = encodeURIComponent(asset.id);
    return `${toAbsoluteUrl(assetPath)}${assetPath.includes("?") ? "&" : "?"}v=${bust}`;
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const name = file.name.replace(/\.[^.]+$/, "");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("name", name);
    if (currentVersionId) formData.append("versionId", currentVersionId);

    await fetch(`/api/projects/${projectId}/assets`, {
      method: "POST",
      body: formData,
    });

    await fetchAssets();
    onRefresh();
    e.target.value = "";
  };

  const handleReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selected) return;

    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("uri", selected.uri);
      if (currentVersionId) formData.append("versionId", currentVersionId);

      await fetch(`/api/projects/${projectId}/assets`, {
        method: "PATCH",
        body: formData,
      });

      await fetchAssets();
      onRefresh();
    } finally {
      setSaving(false);
      e.target.value = "";
    }
  };

  const handleRegenerate = async () => {
    if (!selected || !editPrompt.trim()) return;

    setSaving(true);
    try {
      await fetch(`/api/projects/${projectId}/assets`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uri: selected.uri,
          prompt: editPrompt.trim(),
          versionId: currentVersionId,
        }),
      });

      await fetchAssets();
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected || !confirm(`Remove "${selected.name}" from this version?`)) return;

    const params = new URLSearchParams({ uri: selected.uri });
    if (currentVersionId) params.set("versionId", currentVersionId);

    await fetch(`/api/projects/${projectId}/assets?${params}`, { method: "DELETE" });
    setSelectedUri(null);
    await fetchAssets();
    onRefresh();
  };

  const showGenerating = isGenerating && generationPhase === "assets";

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--panel-border)]">
        <span className="text-xs text-[var(--muted)]">
          Version Assets ({displayAssets.length})
          {showGenerating && (
            <span className="ml-2 text-[var(--accent)] inline-flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" />
              Live
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <label className="btn-ghost flex items-center gap-1 text-xs cursor-pointer">
            <ImagePlus size={12} />
            Upload
            <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
          </label>
          <button
            onClick={fetchAssets}
            disabled={loading}
            className="btn-ghost flex items-center gap-1 text-xs"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="w-44 shrink-0 border-r border-[var(--panel-border)] overflow-y-auto py-1">
          {displayAssets.length === 0 && (
            <p className="text-xs text-[var(--muted)] px-3 py-4">
              {showGenerating ? "Waiting for assets..." : "No assets in this version yet."}
            </p>
          )}
          {Object.entries(grouped).map(([type, items]) => (
            <div key={type}>
              <button
                onClick={() =>
                  setExpandedTypes((prev) => ({ ...prev, [type]: !prev[type] }))
                }
                className="flex items-center gap-1 w-full px-2 py-1 text-xs hover-item"
              >
                {expandedTypes[type] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span className="font-medium uppercase">{type}</span>
                <span className="text-[var(--muted)]">({items.length})</span>
              </button>
              {expandedTypes[type] &&
                items.map((asset) => {
                  const status = getAssetStatus(asset.uri, generationLive, showGenerating);
                  return (
                    <button
                      key={asset.uri}
                      onClick={() => setSelectedUri(asset.uri)}
                      title={`${asset.uri}\n${asset.url || "pending"}`}
                      className={clsx(
                        "flex items-center gap-1 w-full px-2 py-1 text-xs truncate rounded mx-1",
                        selectedUri === asset.uri
                          ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                          : "hover-item"
                      )}
                      style={{ maxWidth: "calc(100% - 8px)" }}
                    >
                      {status === "generating" ? (
                        <Loader2 size={10} className="animate-spin shrink-0 text-[var(--accent)]" />
                      ) : status === "pending" ? (
                        <Loader2 size={10} className="animate-spin shrink-0 text-[var(--muted)] opacity-50" />
                      ) : status === "reused" ? (
                        <CheckCircle2 size={10} className="shrink-0 text-blue-500" />
                      ) : status === "done" ? (
                        <CheckCircle2 size={10} className="shrink-0 text-green-500" />
                      ) : null}
                      <span className="truncate">{asset.name}</span>
                    </button>
                  );
                })}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {!selected ? (
            <p className="text-sm text-[var(--muted)] text-center py-8">
              Select an asset from the tree to view details.
            </p>
          ) : (
            <div className="max-w-lg mx-auto space-y-3">
              <div className="aspect-square max-w-xs mx-auto bg-[var(--input-bg)] rounded-lg overflow-hidden relative">
                {getAssetStatus(selected.uri, generationLive, showGenerating) === "generating" ||
                (getAssetStatus(selected.uri, generationLive, showGenerating) === "pending" &&
                  showGenerating) ? (
                  <div className="w-full h-full flex flex-col items-center justify-center text-[var(--muted)] gap-2">
                    <Loader2 size={28} className="animate-spin text-[var(--accent)]" />
                    <span className="text-xs">Generating...</span>
                  </div>
                ) : selected.id ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={getImageSrc(selected)}
                    alt={selected.name}
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[var(--muted)] text-xs">
                    No preview
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-medium">{selected.name}</h3>
                <div className="mt-2 space-y-1 text-[10px] font-mono bg-[var(--input-bg)] rounded p-2 break-all">
                  <p>
                    <span className="text-[var(--muted)]">URI: </span>
                    {selected.uri}
                  </p>
                  {selected.url && (
                    <p>
                      <span className="text-[var(--muted)]">URL: </span>
                      {normalizeLegacyAssetUrl(selected.url, projectId)}
                    </p>
                  )}
                  {selected.regenerate === false && (
                    <p className="text-blue-600">Reused from asset pool</p>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs text-[var(--muted)]">Generation prompt</label>
                <textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  rows={3}
                  disabled={showGenerating}
                  className="w-full mt-1 px-2 py-1.5 text-xs rounded input-field resize-none disabled:opacity-50"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleRegenerate}
                  disabled={saving || !editPrompt.trim() || showGenerating}
                  className="btn-primary flex items-center gap-1 text-xs px-3 py-1.5"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Regenerate
                </button>
                <label className="btn-ghost flex items-center gap-1 text-xs px-3 py-1.5 cursor-pointer">
                  <Replace size={12} />
                  Replace file
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleReplaceFile}
                    className="hidden"
                    disabled={showGenerating}
                  />
                </label>
                <button
                  onClick={handleDelete}
                  disabled={showGenerating}
                  className="btn-ghost flex items-center gap-1 text-xs px-3 py-1.5 text-[var(--danger)]"
                >
                  <Trash2 size={12} />
                  Remove
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
