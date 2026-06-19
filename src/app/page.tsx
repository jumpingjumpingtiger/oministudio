"use client";

import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { VersionPanel } from "@/components/VersionPanel";
import { ProjectPanel } from "@/components/ProjectPanel";
import { RightPanel } from "@/components/RightPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { ModelDebugPanel } from "@/components/ModelDebugPanel";
import { ResizeHandle } from "@/components/ResizeHandle";
import type { GenerationLiveState, GenerationProgressEvent } from "@/lib/generation-progress";
import { applyProgressToLiveState, EMPTY_LIVE_STATE } from "@/lib/generation-live";
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
  onEvent: (event: GenerationProgressEvent) => void
) {
  if (!response.body) throw new Error("No response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
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
  const [liveRefreshKey, setLiveRefreshKey] = useState(0);
  const [pendingUserMessage, setPendingUserMessage] = useState<ChatMessage | null>(null);
  const [generationPhase, setGenerationPhase] = useState<"code" | "assets" | null>(null);

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

  const handleProgressEvent = useCallback((event: GenerationProgressEvent) => {
    const applyLiveUpdate = (liveEvent: GenerationProgressEvent) => {
      setGenerationLive((prev) => applyProgressToLiveState(prev, liveEvent));
    };

    if (event.type === "file_content_progress") {
      applyLiveUpdate(event);
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

  const handleSendPrompt = async (prompt: string, files: File[]) => {
    if (!prompt.trim()) return;

    const fileMeta = files.map((f) => ({
      name: f.name,
      type: f.type,
      size: f.size,
    }));

    setIsGenerating(true);
    setGenerationPhase("code");
    setGenerationProgress([]);
    setGenerationLive(EMPTY_LIVE_STATE);
    setGeneratingVersionId(null);
    setPendingUserMessage({
      id: `pending-${Date.now()}`,
      role: "user",
      content: prompt.trim(),
      files: JSON.stringify(fileMeta),
      createdAt: new Date().toISOString(),
    });

    try {
      let projectId = selectedProjectId;

      if (!projectId) {
        const name = condensePromptToProjectName(prompt);
        projectId = await handleCreateProject(name, "");
      }

      const codeRes = await fetch(`/api/projects/${projectId}/generate/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, files: fileMeta }),
      });

      if (!codeRes.ok) {
        throw new Error("Code generation request failed");
      }

      let codeVersionId: string | null = null;

      await consumeSseStream(codeRes, (event) => {
        handleProgressEvent(event);
        if (event.type === "code_complete") {
          codeVersionId = event.versionId;
        }
      });

      if (!codeVersionId) {
        throw new Error("Code generation did not return a version");
      }

      setGenerationPhase("assets");
      setLiveRefreshKey((k) => k + 1);

      const assetsRes = await fetch(`/api/projects/${projectId}/generate/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionId: codeVersionId,
        }),
      });

      if (!assetsRes.ok) {
        throw new Error("Asset generation request failed");
      }

      await consumeSseStream(assetsRes, handleProgressEvent);

      setRefreshKey((k) => k + 1);
      await fetchProjects();
      await fetchVersions(projectId);
      await fetchMessages(projectId);
    } finally {
      setIsGenerating(false);
      setGenerationPhase(null);
      setGeneratingVersionId(null);
      setGenerationProgress([]);
      setGenerationLive(EMPTY_LIVE_STATE);
      setPendingUserMessage(null);
    }
  };

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
              onSend={handleSendPrompt}
              isFirstVisit={projectsLoaded && projects.length === 0 && !selectedProjectId}
            />
          </div>
        </main>
      </div>

      <ModelDebugPanel />
    </div>
  );
}
