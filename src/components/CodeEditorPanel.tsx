"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  ChevronDown,
  ChevronRight,
  File,
  FilePlus,
  Folder,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import clsx from "clsx";
import type { FileChangeType, GenerationLiveState } from "@/lib/generation-progress";
import { getFileChangeType } from "@/lib/generation-live";
import { buildFileTree, type FileTreeNode } from "@/lib/types";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });
const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  { ssr: false }
);

type FileStatus = "pending" | "writing" | "done" | "idle";

interface CodeEditorPanelProps {
  projectId: string;
  refreshKey: number;
  versionId?: string | null;
  isGenerating?: boolean;
  generationLive?: GenerationLiveState;
  onRefresh: () => void;
}

function getFileStatus(
  path: string,
  live?: GenerationLiveState,
  isGenerating?: boolean
): FileStatus {
  if (!isGenerating || !live) return "idle";
  if (live.writingFilePath === path) return "writing";
  if (live.completedFiles.includes(path)) return "done";
  if (live.visibleFiles.includes(path)) return "pending";
  return "idle";
}

function FileTreeItem({
  node,
  selectedPath,
  onSelect,
  live,
  isGenerating,
  depth = 0,
}: {
  node: FileTreeNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  live?: GenerationLiveState;
  isGenerating?: boolean;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedPath === node.path;

  if (node.type === "directory") {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 w-full px-2 py-1 text-xs hover-item rounded"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Folder size={12} className="text-[var(--accent)]" />
          <span>{node.name}</span>
        </button>
        {expanded &&
          node.children?.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              live={live}
              isGenerating={isGenerating}
              depth={depth + 1}
            />
          ))}
      </div>
    );
  }

  const status = getFileStatus(node.path, live, isGenerating);
  const changeType = getFileChangeType(node.path, live);

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={clsx(
        "flex items-center gap-1 w-full px-2 py-1 text-xs rounded",
        isSelected ? "bg-[var(--accent)]/10 text-[var(--accent)]" : "hover-item",
        changeType === "new" && !isSelected && "text-green-700",
        changeType === "modified" && !isSelected && "text-amber-700"
      )}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
    >
      {status === "writing" ? (
        <Loader2 size={12} className="animate-spin text-[var(--accent)] shrink-0" />
      ) : status === "pending" ? (
        <Loader2 size={12} className="animate-spin text-[var(--muted)] shrink-0 opacity-50" />
      ) : (
        <File
          size={12}
          className={clsx(
            status === "done" && changeType === "new" && "text-green-600",
            status === "done" && changeType === "modified" && "text-amber-600",
            status === "done" && changeType === "unchanged" && "text-[var(--muted)]"
          )}
        />
      )}
      <span className="truncate flex-1 text-left">{node.name}</span>
      {isGenerating && changeType === "new" && (
        <span className="text-[9px] px-1 rounded bg-green-500/15 text-green-700 shrink-0">N</span>
      )}
      {isGenerating && changeType === "modified" && (
        <span className="text-[9px] px-1 rounded bg-amber-500/15 text-amber-700 shrink-0">M</span>
      )}
    </button>
  );
}

function getLanguageForPath(path: string | null): string {
  if (!path) return "javascript";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".json")) return "json";
  return "javascript";
}

export function CodeEditorPanel({
  projectId,
  refreshKey,
  versionId: versionIdProp,
  isGenerating,
  generationLive,
  onRefresh,
}: CodeEditorPanelProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [versionId, setVersionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);
  const handleSaveRef = useRef<() => Promise<void>>(async () => {});

  const effectiveVersionId = versionIdProp ?? versionId;

  const fetchFiles = useCallback(async () => {
    const query = versionIdProp ? `?versionId=${versionIdProp}` : "";
    const res = await fetch(`/api/projects/${projectId}/code${query}`);
    const data = await res.json();
    const fetched: string[] = data.files || [];
    setFiles(fetched);
    setVersionId(data.versionId);
  }, [projectId, versionIdProp]);

  const fetchFileContent = useCallback(
    async (path: string) => {
      const versionQuery = versionIdProp ? `&versionId=${versionIdProp}` : "";
      const res = await fetch(
        `/api/projects/${projectId}/code?path=${encodeURIComponent(path)}${versionQuery}`
      );
      if (res.ok) {
        const data = await res.json();
        setContent(data.content);
        setOriginalContent(data.content);
      }
    },
    [projectId, versionIdProp]
  );

  const handleSave = useCallback(async () => {
    if (!selectedPath || isGenerating) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/code`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: selectedPath,
          content,
          versionId: effectiveVersionId,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setOriginalContent(content);
    } finally {
      setSaving(false);
    }
  }, [selectedPath, isGenerating, projectId, content, effectiveVersionId]);

  handleSaveRef.current = handleSave;

  const handleEditorMount = useCallback(
    (editor: { addCommand: (keybinding: number, handler: () => void) => void }, monaco: {
      KeyMod: { CtrlCmd: number };
      KeyCode: { KeyS: number };
    }) => {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void handleSaveRef.current();
      });
    },
    []
  );

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles, refreshKey]);

  useEffect(() => {
    if (!isGenerating || !generationLive) return;

    const displayPaths = [
      ...new Set([
        ...generationLive.visibleFiles,
        ...generationLive.completedFiles,
        ...files,
      ]),
    ].sort();

    if (displayPaths.length === 0) return;

    const latest =
      generationLive.lastFileWritten ||
      generationLive.writingFilePath ||
      displayPaths[displayPaths.length - 1];

    setSelectedPath((prev) => {
      if (generationLive.lastFileWritten) return generationLive.lastFileWritten;
      if (prev && displayPaths.includes(prev)) return prev;
      return latest;
    });
  }, [isGenerating, generationLive, files]);

  useEffect(() => {
    if (!selectedPath) return;

    const liveContent = generationLive?.fileContents[selectedPath];
    if (isGenerating && liveContent !== undefined) {
      setContent(liveContent);
      setOriginalContent(generationLive?.filePreviousContents[selectedPath] ?? "");
      return;
    }

    if (isGenerating) return;
    fetchFileContent(selectedPath);
  }, [
    selectedPath,
    fetchFileContent,
    refreshKey,
    isGenerating,
    generationLive?.fileContents,
    generationLive?.filePreviousContents,
    generationLive?.lastFileWritten,
  ]);

  const handleCreateFile = async () => {
    if (!newFileName.trim()) return;
    await fetch(`/api/projects/${projectId}/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: newFileName.trim(),
        content: "",
        versionId: effectiveVersionId,
      }),
    });
    setNewFileName("");
    setShowNewFile(false);
    await fetchFiles();
    setSelectedPath(newFileName.trim());
  };

  const handleDeleteFile = async () => {
    if (!selectedPath || !confirm(`Delete file "${selectedPath}"?`)) return;
    await fetch(
      `/api/projects/${projectId}/code?path=${encodeURIComponent(selectedPath)}&versionId=${effectiveVersionId}`,
      { method: "DELETE" }
    );
    setSelectedPath(null);
    setContent("");
    await fetchFiles();
    onRefresh();
  };

  const displayFiles =
    isGenerating && generationLive
      ? [
          ...new Set([
            ...files,
            ...generationLive.visibleFiles,
            ...generationLive.completedFiles,
          ]),
        ].sort()
      : files;

  const tree = buildFileTree(displayFiles);
  const isDirty = content !== originalContent;
  const selectedStatus = selectedPath
    ? getFileStatus(selectedPath, generationLive, isGenerating)
    : "idle";
  const language = getLanguageForPath(selectedPath);
  const selectedChangeType: FileChangeType | null = selectedPath
    ? getFileChangeType(selectedPath, generationLive)
    : null;
  const showDiff =
    isGenerating &&
    selectedPath &&
    selectedStatus === "done" &&
    generationLive?.fileContents[selectedPath] !== undefined &&
    (selectedChangeType === "new" || selectedChangeType === "modified");
  const diffOriginal =
    selectedPath && generationLive
      ? (generationLive.filePreviousContents[selectedPath] ?? "")
      : "";
  const diffModified =
    selectedPath && generationLive
      ? (generationLive.fileContents[selectedPath] ?? content)
      : content;

  return (
    <div className="h-full flex">
      <div className="w-52 shrink-0 border-r border-[var(--panel-border)] flex flex-col">
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--panel-border)]">
          <span className="text-xs text-[var(--muted)] flex items-center gap-1">
            Files ({displayFiles.length})
            {isGenerating && <Loader2 size={10} className="animate-spin text-[var(--accent)]" />}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setShowNewFile(!showNewFile)}
              className="btn-ghost p-1"
              title="New file"
              disabled={isGenerating}
            >
              <FilePlus size={12} />
            </button>
            <button onClick={fetchFiles} className="btn-ghost p-1" title="Refresh">
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {showNewFile && (
          <div className="p-2 border-b border-[var(--panel-border)]">
            <input
              type="text"
              placeholder="path/to/file.js"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              className="w-full px-2 py-1 text-xs rounded input-field"
              onKeyDown={(e) => e.key === "Enter" && handleCreateFile()}
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-1">
          {tree.length === 0 && (
            <p className="text-xs text-[var(--muted)] px-3 py-4 text-center">
              {isGenerating ? "Waiting for files..." : "No code files yet"}
            </p>
          )}
          {tree.map((node) => (
            <FileTreeItem
              key={node.path}
              node={node}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
              live={generationLive}
              isGenerating={isGenerating}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {selectedPath ? (
          <>
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--panel-border)]">
              <span className="text-xs font-mono truncate flex items-center gap-2">
                {selectedStatus === "writing" && (
                  <Loader2 size={12} className="animate-spin text-[var(--accent)] shrink-0" />
                )}
                {selectedPath}
                {showDiff && (
                  <span className="text-[10px] text-[var(--muted)] font-sans">
                    {selectedChangeType === "new" ? "New file" : "Diff view"}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1">
                {isDirty && !isGenerating && (
                  <span className="text-[10px] text-[var(--muted)] mr-2">Unsaved</span>
                )}
                {saving && (
                  <span className="text-[10px] text-[var(--accent)] mr-2">Saving...</span>
                )}
                <button
                  onClick={() => void handleSave()}
                  disabled={!isDirty || saving || isGenerating}
                  className="btn-ghost flex items-center gap-1 text-xs"
                >
                  <Save size={12} />
                  Save
                </button>
                <button
                  onClick={handleDeleteFile}
                  disabled={isGenerating}
                  className="btn-ghost flex items-center gap-1 text-xs text-[var(--danger)]"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            <div className="flex-1 relative min-h-0">
              {selectedStatus === "pending" && isGenerating && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--panel-bg)]/60">
                  <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
                </div>
              )}
              {selectedStatus === "writing" && isGenerating && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[var(--panel-bg)]/60 gap-2">
                  <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
                  <span className="text-xs text-[var(--muted)]">Writing file...</span>
                </div>
              )}
              {showDiff ? (
                <DiffEditor
                  height="100%"
                  language={language}
                  original={diffOriginal}
                  modified={diffModified}
                  theme="light"
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                  }}
                />
              ) : (
                <MonacoEditor
                  height="100%"
                  language={language}
                  theme="light"
                  value={content}
                  onChange={(value) => setContent(value || "")}
                  onMount={handleEditorMount}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    tabSize: 2,
                    readOnly: isGenerating,
                  }}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--muted)] text-sm">
            {isGenerating ? "Files are being generated..." : "Select a file to edit"}
          </div>
        )}
      </div>
    </div>
  );
}
