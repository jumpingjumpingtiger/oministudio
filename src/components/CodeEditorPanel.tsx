"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  X,
} from "lucide-react";
import clsx from "clsx";
import type { editor } from "monaco-editor";
import type { FileChangeType, GenerationLiveState } from "@/lib/generation-progress";
import { getFileChangeType } from "@/lib/generation-live";
import {
  EDITOR_THEMES,
  getStoredEditorTheme,
  storeEditorTheme,
  type EditorThemeId,
} from "@/lib/editor-themes";
import { buildFileTree, type FileTreeNode } from "@/lib/types";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type FileStatus = "pending" | "writing" | "done" | "idle";
type MonacoModule = typeof import("monaco-editor");

interface CodeEditorPanelProps {
  projectId: string;
  refreshKey: number;
  versionId?: string | null;
  isGenerating?: boolean;
  generationLive?: GenerationLiveState;
  onRefresh: () => void;
  /** When false the panel stays mounted but hidden (preserves editor state). */
  panelVisible?: boolean;
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

function collectExpandDirs(filePaths: string[]): Set<string> {
  const dirs = new Set<string>();
  for (const filePath of filePaths) {
    const parts = filePath.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  return dirs;
}

function addUniqueTab(tabs: string[], path: string): string[] {
  return tabs.includes(path) ? tabs : [...tabs, path];
}

function collectPathAndParents(filePath: string): string[] {
  const paths = [filePath];
  const parts = filePath.split("/");
  for (let i = 1; i < parts.length; i++) {
    paths.push(parts.slice(0, i).join("/"));
  }
  return paths;
}

function FileTreeItem({
  node,
  selectedPath,
  onSelect,
  live,
  isGenerating,
  expandedDirs,
  newTreePaths,
  depth = 0,
}: {
  node: FileTreeNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  live?: GenerationLiveState;
  isGenerating?: boolean;
  expandedDirs: Set<string>;
  newTreePaths: Set<string>;
  depth?: number;
}) {
  const shouldExpand = expandedDirs.has(node.path);
  const [expanded, setExpanded] = useState(shouldExpand || depth === 0);

  useEffect(() => {
    if (shouldExpand) setExpanded(true);
  }, [shouldExpand]);

  const isSelected = selectedPath === node.path;

  const isNewInTree = newTreePaths.has(node.path);

  if (node.type === "directory") {
    return (
      <div className={clsx(isNewInTree && "tree-item-enter")}>
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
              expandedDirs={expandedDirs}
              newTreePaths={newTreePaths}
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
        changeType === "modified" && !isSelected && "text-amber-700",
        isNewInTree && "tree-item-enter bg-[var(--accent)]/5"
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

function modelUri(projectId: string, versionKey: string, filePath: string): string {
  return `inmemory://${projectId}/${versionKey}/${filePath}`;
}

function safeSetModel(
  editor: editor.IStandaloneCodeEditor,
  model: editor.ITextModel | null
): boolean {
  try {
    editor.setModel(model);
    return true;
  } catch {
    return false;
  }
}

export function CodeEditorPanel({
  projectId,
  refreshKey,
  versionId: versionIdProp,
  isGenerating,
  generationLive,
  onRefresh,
  panelVisible = true,
}: CodeEditorPanelProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [savedContents, setSavedContents] = useState<Record<string, string>>({});
  const [editorContents, setEditorContents] = useState<Record<string, string>>({});
  const [versionId, setVersionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);
  const [editorTheme, setEditorTheme] = useState<EditorThemeId>("light");
  const [newTreePaths, setNewTreePaths] = useState<Set<string>>(new Set());

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<MonacoModule | null>(null);
  const handleSaveRef = useRef<() => Promise<void>>(async () => {});
  const lastSyncedLiveRef = useRef<string>("");
  const wasGeneratingRef = useRef(false);
  const pendingLiveSyncRef = useRef<{ path: string; content: string } | null>(null);
  const liveSyncRafRef = useRef<number | null>(null);
  const editorEpochRef = useRef(0);
  const editorReadyRef = useRef(false);

  const effectiveVersionId = versionIdProp ?? versionId;
  const versionKey = effectiveVersionId ?? "draft";

  const fetchFiles = useCallback(async () => {
    const query = versionIdProp ? `?versionId=${versionIdProp}` : "";
    const res = await fetch(`/api/projects/${projectId}/code${query}`);
    const data = await res.json();
    const fetched: string[] = data.files || [];
    setFiles(fetched);
    setVersionId(data.versionId);
  }, [projectId, versionIdProp]);

  const syncModelContent = useCallback(
    (path: string, content: string, appendOnly = false) => {
      const monaco = monacoRef.current;
      const editor = editorRef.current;
      if (!monaco || !editor || !editorReadyRef.current) return;

      const uri = monaco.Uri.parse(modelUri(projectId, versionKey, path));
      let model = monaco.editor.getModel(uri);
      if (!model) {
        model = monaco.editor.createModel(content, getLanguageForPath(path), uri);
        if (editor.getModel()?.uri.toString() === uri.toString()) {
          safeSetModel(editor, model);
        }
        return;
      }

      if (editor.getModel()?.uri.toString() !== uri.toString()) return;

      const current = model.getValue();
      if (content === current) return;

      if (appendOnly && content.startsWith(current)) {
        const delta = content.slice(current.length);
        if (!delta) return;
        const endLine = model.getLineCount();
        const endColumn = model.getLineMaxColumn(endLine);
        model.applyEdits([
          {
            range: new monaco.Range(endLine, endColumn, endLine, endColumn),
            text: delta,
          },
        ]);
        editor.revealLine(model.getLineCount());
      } else {
        model.setValue(content);
        editor.revealLine(model.getLineCount());
      }
    },
    [projectId, versionKey]
  );

  const fetchFileContent = useCallback(
    async (path: string) => {
      const epoch = editorEpochRef.current;
      const versionQuery = versionIdProp ? `&versionId=${versionIdProp}` : "";
      const res = await fetch(
        `/api/projects/${projectId}/code?path=${encodeURIComponent(path)}${versionQuery}`
      );
      if (epoch !== editorEpochRef.current) return;
      if (res.ok) {
        const data = await res.json();
        if (epoch !== editorEpochRef.current) return;
        setSavedContents((prev) => ({ ...prev, [path]: data.content }));
        setEditorContents((prev) => ({ ...prev, [path]: data.content }));
        syncModelContent(path, data.content);
      }
    },
    [projectId, versionIdProp, syncModelContent]
  );

  const attachModelForPath = useCallback(
    (path: string) => {
      const monaco = monacoRef.current;
      const editor = editorRef.current;
      if (!monaco || !editor || !editorReadyRef.current) return;

      const uri = monaco.Uri.parse(modelUri(projectId, versionKey, path));
      let model = monaco.editor.getModel(uri);
      const initial = isGenerating
        ? (generationLive?.fileContents[path] ?? "")
        : (editorContents[path] ?? savedContents[path] ?? "");

      if (!model) {
        model = monaco.editor.createModel(initial, getLanguageForPath(path), uri);
      } else if (isGenerating) {
        const live = generationLive?.fileContents[path];
        if (live !== undefined && model.getValue() !== live) {
          model.setValue(live);
          lastSyncedLiveRef.current = live;
        }
      } else if (model.getValue() !== initial) {
        model.setValue(initial);
      }

      if (!safeSetModel(editor, model)) return;
      lastSyncedLiveRef.current = isGenerating ? initial : "";
    },
    [
      projectId,
      versionKey,
      isGenerating,
      generationLive?.fileContents,
      editorContents,
      savedContents,
    ]
  );

  const handleSave = useCallback(async () => {
    if (!activeFilePath || isGenerating) return;
    const content = editorContents[activeFilePath] ?? "";
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/code`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: activeFilePath,
          content,
          versionId: effectiveVersionId,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSavedContents((prev) => ({ ...prev, [activeFilePath]: content }));
      onRefresh();
    } finally {
      setSaving(false);
    }
  }, [activeFilePath, isGenerating, projectId, editorContents, effectiveVersionId, onRefresh]);

  handleSaveRef.current = handleSave;

  const handleEditorMount = useCallback(
    (editorInstance: editor.IStandaloneCodeEditor, monaco: MonacoModule) => {
      editorRef.current = editorInstance;
      monacoRef.current = monaco;
      editorReadyRef.current = true;
      editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void handleSaveRef.current();
      });
      if (activeFilePath) {
        attachModelForPath(activeFilePath);
      }
    },
    [activeFilePath, attachModelForPath]
  );

  const handleEditorWillMount = useCallback(() => {
    editorReadyRef.current = false;
    editorRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      editorReadyRef.current = false;
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    setEditorTheme(getStoredEditorTheme());
  }, []);

  useEffect(() => {
    if (!panelVisible || !editorReadyRef.current) return;
    const editor = editorRef.current;
    if (!editor) return;
    const frame = requestAnimationFrame(() => {
      editor.layout();
      if (activeFilePath) {
        attachModelForPath(activeFilePath);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [panelVisible, activeFilePath, attachModelForPath]);

  useEffect(() => {
    if (isGenerating) return;
    fetchFiles();
  }, [fetchFiles, refreshKey, isGenerating, versionIdProp]);

  const displayFiles = useMemo(() => {
    if (!isGenerating || !generationLive) return files;
    return [...new Set([...generationLive.visibleFiles, ...generationLive.completedFiles])].sort();
  }, [files, isGenerating, generationLive]);

  const prevTreePathsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isGenerating || !generationLive) {
      prevTreePathsRef.current = new Set();
      setNewTreePaths(new Set());
      return;
    }

    const currentPaths = new Set<string>();
    for (const filePath of [
      ...generationLive.visibleFiles,
      ...generationLive.completedFiles,
    ]) {
      for (const segment of collectPathAndParents(filePath)) {
        currentPaths.add(segment);
      }
    }

    const added = [...currentPaths].filter((p) => !prevTreePathsRef.current.has(p));
    prevTreePathsRef.current = currentPaths;

    if (added.length === 0) return;

    setNewTreePaths(new Set(added));
    const timer = window.setTimeout(() => setNewTreePaths(new Set()), 500);
    return () => window.clearTimeout(timer);
  }, [isGenerating, generationLive?.visibleFiles, generationLive?.completedFiles, generationLive]);

  const expandedDirs = useMemo(
    () => collectExpandDirs(displayFiles),
    [displayFiles]
  );

  // Attach Monaco model when active tab changes (defer until editor instance is mounted)
  useEffect(() => {
    if (!activeFilePath) return;
    const frame = requestAnimationFrame(() => {
      attachModelForPath(activeFilePath);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeFilePath, attachModelForPath]);

  // Load file content from server when idle
  useEffect(() => {
    if (!activeFilePath || isGenerating) return;
    void fetchFileContent(activeFilePath);
  }, [
    activeFilePath,
    fetchFileContent,
    refreshKey,
    isGenerating,
    versionIdProp,
  ]);

  // Stream live content into Monaco TextModel (typing effect, rAF batched)
  useEffect(() => {
    if (!isGenerating || !activeFilePath || !generationLive) return;

    const liveContent = generationLive.fileContents[activeFilePath];
    if (liveContent === undefined) return;
    if (lastSyncedLiveRef.current === liveContent) return;

    pendingLiveSyncRef.current = { path: activeFilePath, content: liveContent };

    if (liveSyncRafRef.current !== null) return;

    liveSyncRafRef.current = requestAnimationFrame(() => {
      liveSyncRafRef.current = null;
      const pending = pendingLiveSyncRef.current;
      if (!pending) return;

      const appendOnly = pending.content.startsWith(lastSyncedLiveRef.current);
      syncModelContent(pending.path, pending.content, appendOnly);
      lastSyncedLiveRef.current = pending.content;
      setEditorContents((prev) => ({ ...prev, [pending.path]: pending.content }));
    });

    return () => {
      if (liveSyncRafRef.current !== null) {
        cancelAnimationFrame(liveSyncRafRef.current);
        liveSyncRafRef.current = null;
      }
    };
  }, [isGenerating, activeFilePath, generationLive?.fileContents, syncModelContent]);

  // Reload from server when generation finishes
  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating && activeFilePath) {
      lastSyncedLiveRef.current = "";
      void fetchFileContent(activeFilePath);
    }
    wasGeneratingRef.current = !!isGenerating;
  }, [isGenerating, activeFilePath, fetchFileContent]);

  const handleSelectFile = (path: string) => {
    setOpenTabs((prev) => addUniqueTab(prev, path));
    setActiveFilePath(path);
  };

  const handleCloseTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenTabs((prev) => {
      const next = prev.filter((p) => p !== path);
      if (activeFilePath === path) {
        setActiveFilePath(next[next.length - 1] ?? null);
      }
      return next;
    });
  };

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
    handleSelectFile(newFileName.trim());
  };

  const handleDeleteFile = async () => {
    if (!activeFilePath || !confirm(`Delete file "${activeFilePath}"?`)) return;
    await fetch(
      `/api/projects/${projectId}/code?path=${encodeURIComponent(activeFilePath)}&versionId=${effectiveVersionId}`,
      { method: "DELETE" }
    );
    setOpenTabs((prev) => prev.filter((p) => p !== activeFilePath));
    setActiveFilePath(null);
    setEditorContents((prev) => {
      const next = { ...prev };
      delete next[activeFilePath];
      return next;
    });
    await fetchFiles();
    onRefresh();
  };

  const tree = buildFileTree(displayFiles);
  const activeContent = activeFilePath ? (editorContents[activeFilePath] ?? "") : "";
  const activeSaved = activeFilePath ? (savedContents[activeFilePath] ?? "") : "";
  const isDirty = !isGenerating && activeFilePath !== null && activeContent !== activeSaved;
  const activeStatus = activeFilePath
    ? getFileStatus(activeFilePath, generationLive, isGenerating)
    : "idle";
  const language = getLanguageForPath(activeFilePath);
  const activeChangeType: FileChangeType | null = activeFilePath
    ? getFileChangeType(activeFilePath, generationLive)
    : null;

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
              selectedPath={activeFilePath}
              onSelect={handleSelectFile}
              live={generationLive}
              isGenerating={isGenerating}
              expandedDirs={expandedDirs}
              newTreePaths={newTreePaths}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {openTabs.length > 0 && (
          <div className="flex items-center gap-0.5 px-1 py-1 border-b border-[var(--panel-border)] overflow-x-auto shrink-0">
            {openTabs.map((path) => {
              const tabStatus = getFileStatus(path, generationLive, isGenerating);
              const isActive = activeFilePath === path;
              return (
                <button
                  key={path}
                  onClick={() => setActiveFilePath(path)}
                  className={clsx(
                    "flex items-center gap-1 px-2 py-1 text-[11px] rounded-t font-mono shrink-0 max-w-[180px]",
                    isActive
                      ? "bg-[var(--panel-bg)] text-[var(--accent)] border border-b-0 border-[var(--panel-border)]"
                      : "text-[var(--muted)] hover-item"
                  )}
                >
                  {tabStatus === "writing" && (
                    <Loader2 size={10} className="animate-spin text-[var(--accent)] shrink-0" />
                  )}
                  <span className="truncate">{path.split("/").pop()}</span>
                  {!isGenerating && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => handleCloseTab(path, e)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCloseTab(path, e as unknown as React.MouseEvent);
                      }}
                      className="p-0.5 rounded hover:bg-black/5"
                    >
                      <X size={10} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {activeFilePath && (
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--panel-border)]">
            <span className="text-xs font-mono truncate flex items-center gap-2">
              {activeStatus === "writing" && (
                <Loader2 size={12} className="animate-spin text-[var(--accent)] shrink-0" />
              )}
              {activeFilePath}
              {isGenerating && activeChangeType === "new" && (
                <span className="text-[10px] text-green-700 font-sans">New</span>
              )}
              {isGenerating && activeChangeType === "modified" && (
                <span className="text-[10px] text-amber-700 font-sans">Modified</span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <select
                value={editorTheme}
                onChange={(e) => {
                  const next = e.target.value as EditorThemeId;
                  setEditorTheme(next);
                  storeEditorTheme(next);
                }}
                className="text-[11px] px-2 py-0.5 rounded input-field max-w-[140px]"
                title="Editor theme"
              >
                {EDITOR_THEMES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              {isDirty && (
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
        )}

        <div className="flex-1 relative min-h-0">
          {!activeFilePath && !isGenerating && (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-[var(--muted)] text-sm bg-[var(--panel-bg)]/80 pointer-events-none">
              Select a file to edit
            </div>
          )}
          {isGenerating && !activeFilePath && (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-[var(--muted)] text-sm bg-[var(--panel-bg)]/80 pointer-events-none">
              Files are being generated...
            </div>
          )}
          <MonacoEditor
            height="100%"
            language={language}
            theme={editorTheme}
            defaultValue=""
            beforeMount={handleEditorWillMount}
            onMount={handleEditorMount}
            onChange={(value) => {
              if (isGenerating || !activeFilePath) return;
              setEditorContents((prev) => ({
                ...prev,
                [activeFilePath]: value || "",
              }));
            }}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              scrollBeyondLastLine: false,
              wordWrap: "on",
              tabSize: 2,
              readOnly: isGenerating || !activeFilePath,
              automaticLayout: true,
            }}
          />
        </div>
      </div>
    </div>
  );
}
