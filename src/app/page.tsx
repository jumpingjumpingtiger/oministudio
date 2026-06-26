"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { VersionPanel } from "@/components/VersionPanel";
import { ProjectPanel } from "@/components/ProjectPanel";
import { RightPanel } from "@/components/RightPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { ModelDebugPanel } from "@/components/ModelDebugPanel";
import { ResizeHandle } from "@/components/ResizeHandle";
import type { GenerationLiveState, GenerationProgressEvent } from "@/lib/generation-progress";
import { applyProgressToLiveState, EMPTY_LIVE_STATE } from "@/lib/generation-live";
import {
  applyBrainProgressEvent,
  EMPTY_BRAIN_SESSION,
  type BrainSessionDisplay,
} from "@/lib/brain-session-display";
import type { RightPanelTab } from "@/lib/types";
import { condensePromptToProjectName } from "@/lib/utils/project-name";
import {
  defaultWorkspaceTab,
  workspaceKey,
} from "@/lib/workspace-key";

interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  _count?: { versions: number; assets: number };
}

interface Version {
  id: string;
  prompt: string;
  summary: string;
  isActive: boolean;
  createdAt: string;
  versionNumber?: number | null;
  storageKey?: string;
}

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  files: string;
  createdAt: string;
  version?: { id: string; summary: string } | null;
}

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 420;
const SIDEBAR_DEFAULT = 224;

const CHAT_MIN = 140;
const CHAT_MAX = 600;
const CHAT_DEFAULT = 256;

async function consumeSseStream(
  response: Response,
  onEvent: (event: GenerationProgressEvent) => void,
  signal?: AbortSignal
) {
  if (!response.body) throw new Error("No response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        throw new DOMException("Generation cancelled", "AbortError");
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";

      for (const chunk of chunks) {
        if (!chunk.startsWith("data: ")) continue;
        try {
          onEvent(JSON.parse(chunk.slice(6)) as GenerationProgressEvent);
        } catch {
          // skip malformed events
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

interface RetryState {
  prompt: string;
  projectId: string;
  phase: "code" | "assets";
  codeVersionId?: string;
  filesMeta: { name: string; type: string; size: number }[];
}

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeTab, setActiveTab] = useState<RightPanelTab>("preview");
  const [workspaceTabs, setWorkspaceTabs] = useState<Record<string, RightPanelTab>>({});
  const [visitedWorkspaceKeys, setVisitedWorkspaceKeys] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [versionPanelVisible, setVersionPanelVisible] = useState(true);
  const [projectPanelVisible, setProjectPanelVisible] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [chatHeight, setChatHeight] = useState(CHAT_DEFAULT);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgressEvent[]>([]);
  const [generatingVersionId, setGeneratingVersionId] = useState<string | null>(null);
  const [generationLive, setGenerationLive] = useState<GenerationLiveState>(EMPTY_LIVE_STATE);
  const [brainSession, setBrainSession] = useState<BrainSessionDisplay | null>(null);
  const [liveRefreshKey, setLiveRefreshKey] = useState(0);
  const [pendingUserMessage, setPendingUserMessage] = useState<ChatMessage | null>(null);
  const [generationPhase, setGenerationPhase] = useState<"code" | "assets" | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [retryState, setRetryState] = useState<RetryState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth((w) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w + delta)));
  }, []);

  const handleChatResize = useCallback((delta: number) => {
    setChatHeight((h) => Math.min(CHAT_MAX, Math.max(CHAT_MIN, h - delta)));
  }, []);

  const fetchProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    const data = await res.json();
    setProjects(data);
    setProjectsLoaded(true);
    if (data.length > 0 && !selectedProjectId) {
      setSelectedProjectId(data[0].id);
    }
  }, [selectedProjectId]);

  const fetchVersions = useCallback(async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}/versions`);
    const data = await res.json();
    setVersions(data);
  }, []);

  const fetchMessages = useCallback(async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}/messages`);
    const data = await res.json();
    setMessages(data);
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (selectedProjectId) {
      fetchVersions(selectedProjectId);
      fetchMessages(selectedProjectId);
    } else {
      setVersions([]);
      setMessages([]);
    }
  }, [selectedProjectId, fetchVersions, fetchMessages, refreshKey]);

  const handleCreateProject = async (name: string, description: string) => {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    const project = await res.json();
    setProjects((prev) => [project, ...prev]);
    setSelectedProjectId(project.id);
    return project.id as string;
  };

  const handleRenameProject = async (projectId: string, name: string) => {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const updated = await res.json();
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, name: updated.name } : p))
    );
  };

  const handleDeleteProject = async (projectId: string) => {
    await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
    const remaining = projects.filter((p) => p.id !== projectId);
    setProjects(remaining);
    setSelectedProjectId(remaining[0]?.id ?? null);
  };

  const handleSwitchVersion = async (versionId: string) => {
    if (!selectedProjectId) return;
    setVersions((prev) =>
      prev.map((v) => ({ ...v, isActive: v.id === versionId }))
    );
    await fetch(`/api/projects/${selectedProjectId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "switch", versionId }),
    });
    setRefreshKey((k) => k + 1);
  };

  const handleDeleteVersion = async (versionId: string) => {
    if (!selectedProjectId) return;
    const version = versions.find((v) => v.id === versionId);
    const label =
      version?.versionNumber != null ? `v${version.versionNumber}` : versionId.slice(0, 8);
    if (!confirm(`Delete version ${label}? Code and assets for this version will be removed.`)) {
      return;
    }

    const res = await fetch(
      `/api/projects/${selectedProjectId}/versions?versionId=${versionId}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to delete version");
      return;
    }

    await fetchVersions(selectedProjectId);
    await fetchMessages(selectedProjectId);
    setRefreshKey((k) => k + 1);
  };

  const handleProgressEvent = useCallback((event: GenerationProgressEvent) => {
    const isBrainSessionEvent =
      event.type === "brain_context_start" ||
      event.type === "brain_context_line" ||
      event.type === "brain_calling" ||
      event.type === "brain_stream_chunk" ||
      event.type === "brain_token_usage" ||
      event.type === "prompt_enhance_start" ||
      event.type === "prompt_enhanced" ||
      event.type === "llm_thinking_chunk" ||
      event.type === "llm_code_output_start";

    if (isBrainSessionEvent) {
      const applyBrain = () =>
        setBrainSession((prev) =>
          applyBrainProgressEvent(prev ?? EMPTY_BRAIN_SESSION, event)
        );

      if (
        event.type === "brain_stream_chunk" ||
        event.type === "llm_thinking_chunk" ||
        event.type === "llm_code_output_start"
      ) {
        flushSync(applyBrain);
      } else {
        applyBrain();
      }

      if (event.type === "prompt_enhance_start" || event.type === "prompt_enhanced") {
        flushSync(() => {
          setGenerationProgress((prev) => [...prev, event]);
        });
      }
      return;
    }

    const applyLiveUpdate = (liveEvent: GenerationProgressEvent) => {
      setGenerationLive((prev) => applyProgressToLiveState(prev, liveEvent));
    };

    if (
      event.type === "file_content_progress" ||
      event.type === "node_started" ||
      event.type === "node_completed" ||
      event.type === "change_manifest"
    ) {
      if (event.type === "file_content_progress") {
        flushSync(() => applyLiveUpdate(event));
      } else {
        applyLiveUpdate(event);
      }
      return;
    }

    flushSync(() => {
      setGenerationProgress((prev) => [...prev, event]);
      applyLiveUpdate(event);
    });

    if (event.type === "version_created") {
      setGeneratingVersionId(event.versionId);
      setRefreshKey((k) => k + 1);
    } else if (
      event.type === "file_written" ||
      event.type === "code_complete" ||
      event.type === "asset_generated" ||
      event.type === "asset_reused" ||
      event.type === "complete"
    ) {
      setLiveRefreshKey((k) => k + 1);
    }
  }, []);

  const runGeneration = useCallback(
    async (params: {
      prompt: string;
      projectId: string;
      filesMeta: { name: string; type: string; size: number }[];
      startPhase?: "code" | "assets";
      codeVersionId?: string;
    }) => {
      const { prompt, projectId, filesMeta, startPhase = "code", codeVersionId } = params;
      const controller = new AbortController();
      abortRef.current = controller;

      setIsGenerating(true);
      setGenerationError(null);
      setRetryState(null);
      setGenerationPhase(startPhase);
      setGenerationProgress([]);
      setGenerationLive(EMPTY_LIVE_STATE);
      setBrainSession(null);
      if (startPhase === "code") {
        setGeneratingVersionId(null);
        setPendingUserMessage({
          id: `pending-${Date.now()}`,
          role: "user",
          content: prompt.trim(),
          files: JSON.stringify(filesMeta),
          createdAt: new Date().toISOString(),
        });
      }

      let resolvedCodeVersionId = codeVersionId ?? null;

      try {
        if (startPhase === "code") {
          const codeRes = await fetch(`/api/projects/${projectId}/generate/code`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, files: filesMeta }),
            signal: controller.signal,
          });

          if (!codeRes.ok) {
            throw new Error("Code generation request failed");
          }

          await consumeSseStream(
            codeRes,
            (event) => {
              handleProgressEvent(event);
              if (event.type === "code_complete") {
                resolvedCodeVersionId = event.versionId;
              }
              if (event.type === "error") {
                throw new Error(event.message);
              }
            },
            controller.signal
          );

          if (!resolvedCodeVersionId) {
            throw new Error("Code generation did not return a version");
          }
        }

        setGenerationPhase("assets");
        setLiveRefreshKey((k) => k + 1);

        const assetsRes = await fetch(`/api/projects/${projectId}/generate/assets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionId: resolvedCodeVersionId }),
          signal: controller.signal,
        });

        if (!assetsRes.ok) {
          throw new Error("Asset generation request failed");
        }

        await consumeSseStream(
          assetsRes,
          (event) => {
            handleProgressEvent(event);
            if (event.type === "error") {
              throw new Error(event.message);
            }
          },
          controller.signal
        );

        setRefreshKey((k) => k + 1);
        await fetchProjects();
        await fetchVersions(projectId);
        await fetchMessages(projectId);
        setPendingUserMessage(null);
      } catch (error) {
        const cancelled =
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError");

        if (cancelled) {
          setGenerationError("Generation cancelled.");
        } else {
          const message =
            error instanceof Error ? error.message : "Generation failed";
          setGenerationError(message);
          setRetryState({
            prompt,
            projectId,
            phase: resolvedCodeVersionId ? "assets" : "code",
            codeVersionId: resolvedCodeVersionId ?? undefined,
            filesMeta,
          });
        }
      } finally {
        abortRef.current = null;
        setIsGenerating(false);
        setGenerationPhase(null);
        setGeneratingVersionId(null);
        setGenerationProgress([]);
        setGenerationLive(EMPTY_LIVE_STATE);
        setBrainSession(null);
      }
    },
    [handleProgressEvent, fetchProjects, fetchVersions, fetchMessages]
  );

  const handleSendPrompt = async (prompt: string, files: File[]) => {
    if (!prompt.trim()) return;

    const fileMeta = files.map((f) => ({
      name: f.name,
      type: f.type,
      size: f.size,
    }));

    let projectId = selectedProjectId;
    if (!projectId) {
      const name = condensePromptToProjectName(prompt);
      projectId = await handleCreateProject(name, "");
    }

    await runGeneration({ prompt: prompt.trim(), projectId, filesMeta: fileMeta });
  };

  const handleCancelGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleRetryGeneration = useCallback(() => {
    if (!retryState) return;
    void runGeneration({
      prompt: retryState.prompt,
      projectId: retryState.projectId,
      filesMeta: retryState.filesMeta,
      startPhase: retryState.phase,
      codeVersionId: retryState.codeVersionId,
    });
  }, [retryState, runGeneration]);

  const effectiveRefreshKey = refreshKey + liveRefreshKey;
  const activeVersionId = versions.find((v) => v.isActive)?.id ?? null;

  const registerWorkspace = useCallback((projectId: string, versionId: string) => {
    const key = workspaceKey(projectId, versionId);
    setVisitedWorkspaceKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setWorkspaceTabs((prev) =>
      prev[key] ? prev : { ...prev, [key]: defaultWorkspaceTab() }
    );
  }, []);

  useEffect(() => {
    if (selectedProjectId && activeVersionId) {
      registerWorkspace(selectedProjectId, activeVersionId);
    }
  }, [selectedProjectId, activeVersionId, registerWorkspace]);

  useEffect(() => {
    if (selectedProjectId && generatingVersionId) {
      registerWorkspace(selectedProjectId, generatingVersionId);
    }
  }, [selectedProjectId, generatingVersionId, registerWorkspace]);

  const currentWorkspaceKey =
    selectedProjectId && activeVersionId
      ? workspaceKey(selectedProjectId, activeVersionId)
      : null;

  const resolvedActiveTab = currentWorkspaceKey
    ? (workspaceTabs[currentWorkspaceKey] ?? defaultWorkspaceTab())
    : activeTab;

  const handleTabChange = useCallback(
    (tab: RightPanelTab) => {
      setActiveTab(tab);
      if (currentWorkspaceKey) {
        setWorkspaceTabs((prev) => ({ ...prev, [currentWorkspaceKey]: tab }));
      }
    },
    [currentWorkspaceKey]
  );

  const triggerRefresh = () => setRefreshKey((k) => k + 1);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="h-12 flex items-center px-4 border-b border-[var(--panel-border)] bg-[var(--panel-bg)] shrink-0">
        <h1 className="text-lg font-bold tracking-tight">
          <span className="text-[var(--accent)]">Omini</span>Studio
        </h1>
        <span className="ml-3 text-xs text-[var(--muted)]">
          Multi-modal AI Game Development Platform
        </span>
      </header>

      <div className="flex-1 flex overflow-hidden min-h-0">
        <aside
          className="flex flex-col shrink-0 border-r border-[var(--panel-border)] bg-[var(--panel-bg)]"
          style={{ width: sidebarWidth }}
        >
          {versionPanelVisible && (
            <VersionPanel
              versions={versions}
              onSwitch={handleSwitchVersion}
              onDelete={handleDeleteVersion}
              onHide={() => setVersionPanelVisible(false)}
              className="flex-1 min-h-0"
            />
          )}
          {!versionPanelVisible && (
            <button
              onClick={() => setVersionPanelVisible(true)}
              className="btn-ghost text-xs m-2"
            >
              Show Versions
            </button>
          )}

          <div className="border-t border-[var(--panel-border)]" />

          {projectPanelVisible && (
            <ProjectPanel
              projects={projects}
              selectedId={selectedProjectId}
              onSelect={setSelectedProjectId}
              onCreate={handleCreateProject}
              onRename={handleRenameProject}
              onDelete={handleDeleteProject}
              onHide={() => setProjectPanelVisible(false)}
              className="h-48 shrink-0"
            />
          )}
          {!projectPanelVisible && (
            <button
              onClick={() => setProjectPanelVisible(true)}
              className="btn-ghost text-xs m-2"
            >
              Show Projects
            </button>
          )}
        </aside>

        <ResizeHandle direction="horizontal" onResize={handleSidebarResize} />

        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex-1 min-h-0 overflow-hidden">
            <RightPanel
              projectId={selectedProjectId}
              activeVersionId={activeVersionId}
              visitedWorkspaceKeys={visitedWorkspaceKeys}
              activeTab={resolvedActiveTab}
              onTabChange={handleTabChange}
              refreshKey={effectiveRefreshKey}
              isGenerating={isGenerating}
              generatingVersionId={generatingVersionId}
              generationPhase={generationPhase}
              generationLive={generationLive}
              onRefresh={triggerRefresh}
            />
          </div>

          <ResizeHandle direction="vertical" onResize={handleChatResize} />

          <div
            className="shrink-0 border-t border-[var(--panel-border)]"
            style={{ height: chatHeight }}
          >
            <ChatPanel
              messages={messages}
              pendingUserMessage={pendingUserMessage}
              versions={versions}
              projectName={selectedProject?.name ?? "OminiStudio"}
              isGenerating={isGenerating}
              generationProgress={generationProgress}
              generationLive={generationLive}
              brainSession={brainSession}
              onSend={handleSendPrompt}
              onCancel={handleCancelGeneration}
              onRetry={handleRetryGeneration}
              generationError={generationError}
              isFirstVisit={projectsLoaded && projects.length === 0 && !selectedProjectId}
            />
          </div>
        </main>
      </div>

      <ModelDebugPanel />
    </div>
  );
}
