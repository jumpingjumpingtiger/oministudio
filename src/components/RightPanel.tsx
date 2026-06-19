"use client";

import clsx from "clsx";
import { Code, Eye, Image } from "lucide-react";
import type { GenerationLiveState } from "@/lib/generation-progress";
import type { RightPanelTab } from "@/lib/types";
import { GamePreview } from "@/components/GamePreview";
import { CodeEditorPanel } from "@/components/CodeEditorPanel";
import { AssetManager } from "@/components/AssetManager";

interface RightPanelProps {
  projectId: string | null;
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  refreshKey: number;
  versionId?: string | null;
  isGenerating?: boolean;
  generationPhase?: "code" | "assets" | null;
  generationLive?: GenerationLiveState;
  onRefresh: () => void;
}

const TABS: { id: RightPanelTab; label: string; icon: typeof Eye }[] = [
  { id: "preview", label: "Preview", icon: Eye },
  { id: "code", label: "Code Editor", icon: Code },
  { id: "assets", label: "Assets", icon: Image },
];

export function RightPanel({
  projectId,
  activeTab,
  onTabChange,
  refreshKey,
  versionId,
  isGenerating,
  generationPhase,
  generationLive,
  onRefresh,
}: RightPanelProps) {
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

      <div className="flex-1 overflow-hidden">
        {!projectId ? (
          <div className="h-full flex items-center justify-center text-[var(--muted)] text-sm">
            Describe your game idea in the chat below to get started
          </div>
        ) : (
          <>
            {activeTab === "preview" && (
              <GamePreview
                projectId={projectId}
                refreshKey={refreshKey}
                versionId={versionId}
                isGenerating={isGenerating}
                generationPhase={generationPhase}
              />
            )}
            {activeTab === "code" && (
              <CodeEditorPanel
                key={`code-${projectId}-${versionId ?? "draft"}`}
                projectId={projectId}
                refreshKey={refreshKey}
                versionId={versionId}
                isGenerating={isGenerating}
                generationLive={generationLive}
                onRefresh={onRefresh}
              />
            )}
            {activeTab === "assets" && (
              <AssetManager
                projectId={projectId}
                refreshKey={refreshKey}
                versionId={versionId}
                isGenerating={isGenerating}
                generationPhase={generationPhase}
                generationLive={generationLive}
                onRefresh={onRefresh}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
