"use client";

import clsx from "clsx";
import { Code, Eye, Image } from "lucide-react";
import type { GenerationLiveState } from "@/lib/generation-progress";
import type { RightPanelTab } from "@/lib/types";
import { parseWorkspaceKey } from "@/lib/workspace-key";
import { GamePreview } from "@/components/GamePreview";
import { CodeEditorPanel } from "@/components/CodeEditorPanel";
import { AssetManager } from "@/components/AssetManager";

interface RightPanelProps {
  projectId: string | null;
  activeVersionId: string | null;
  visitedWorkspaceKeys: string[];
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  refreshKey: number;
  isGenerating?: boolean;
  generatingVersionId?: string | null;
  generationPhase?: "code" | "assets" | null;
  generationLive?: GenerationLiveState;
  onRefresh: () => void;
}

const TABS: { id: RightPanelTab; label: string; icon: typeof Eye }[] = [
  { id: "preview", label: "Preview", icon: Eye },
  { id: "code", label: "Code Editor", icon: Code },
  { id: "assets", label: "Assets", icon: Image },
];

function panelVisibility(active: boolean): string {
  return clsx(
    "absolute inset-0 flex flex-col min-h-0",
    !active && "invisible pointer-events-none"
  );
}

export function RightPanel({
  projectId,
  activeVersionId,
  visitedWorkspaceKeys,
  activeTab,
  onTabChange,
  refreshKey,
  isGenerating,
  generatingVersionId,
  generationPhase,
  generationLive,
  onRefresh,
}: RightPanelProps) {
  const projectWorkspaces = projectId
    ? visitedWorkspaceKeys.filter((key) => parseWorkspaceKey(key).projectId === projectId)
    : [];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--panel-border)] bg-[var(--panel-bg)]">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                activeTab === tab.id
                  ? "tab-active"
                  : "text-[var(--muted)] hover:text-[var(--foreground)] hover-item"
              )}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-hidden relative min-h-0">
        {!projectId || !activeVersionId ? (
          <div className="h-full flex items-center justify-center text-[var(--muted)] text-sm">
            Describe your game idea in the chat below to get started
          </div>
        ) : projectWorkspaces.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[var(--muted)] text-sm">
            Select a version to inspect preview, code, and assets
          </div>
        ) : (
          projectWorkspaces.map((key) => {
            const { projectId: wsProjectId, versionId: wsVersionId } = parseWorkspaceKey(key);
            const isActiveWorkspace =
              projectId === wsProjectId && activeVersionId === wsVersionId;
            const isLiveGenerationTarget =
              !!isGenerating && generatingVersionId === wsVersionId;

            return (
              <div
                key={key}
                className={clsx(
                  "absolute inset-0 flex flex-col min-h-0",
                  !isActiveWorkspace && "invisible pointer-events-none"
                )}
                aria-hidden={!isActiveWorkspace}
              >
                <div className="flex-1 relative min-h-0">
                  <div className={panelVisibility(activeTab === "preview")}>
                    <GamePreview
                      projectId={wsProjectId}
                      refreshKey={refreshKey}
                      versionId={wsVersionId}
                      isGenerating={isLiveGenerationTarget}
                      generationPhase={isLiveGenerationTarget ? generationPhase : null}
                    />
                  </div>
                  <div className={panelVisibility(activeTab === "code")}>
                    <CodeEditorPanel
                      projectId={wsProjectId}
                      refreshKey={refreshKey}
                      versionId={wsVersionId}
                      isGenerating={isLiveGenerationTarget}
                      generationLive={isLiveGenerationTarget ? generationLive : undefined}
                      onRefresh={onRefresh}
                      panelVisible={isActiveWorkspace && activeTab === "code"}
                    />
                  </div>
                  <div className={panelVisibility(activeTab === "assets")}>
                    <AssetManager
                      projectId={wsProjectId}
                      refreshKey={refreshKey}
                      versionId={wsVersionId}
                      isGenerating={isLiveGenerationTarget}
                      generationPhase={isLiveGenerationTarget ? generationPhase : null}
                      generationLive={isLiveGenerationTarget ? generationLive : undefined}
                      onRefresh={onRefresh}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
