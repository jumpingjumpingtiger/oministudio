"use client";

import { ChevronLeft, Clock, GitBranch, Trash2 } from "lucide-react";
import clsx from "clsx";

interface Version {
  id: string;
  prompt: string;
  summary: string;
  isActive: boolean;
  createdAt: string;
  versionNumber?: number | null;
  storageKey?: string;
}

interface VersionPanelProps {
  versions: Version[];
  onSwitch: (versionId: string) => void;
  onDelete: (versionId: string) => void;
  onHide: () => void;
  className?: string;
}

export function VersionPanel({
  versions,
  onSwitch,
  onDelete,
  onHide,
  className,
}: VersionPanelProps) {
  return (
    <div className={clsx("flex flex-col", className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--panel-border)]">
        <div className="flex items-center gap-2 text-sm font-medium">
          <GitBranch size={14} className="text-[var(--accent)]" />
          Versions
        </div>
        <button onClick={onHide} className="btn-ghost p-1" title="Hide panel">
          <ChevronLeft size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {versions.length === 0 && (
          <p className="text-xs text-[var(--muted)] px-2 py-4 text-center">
            No versions yet. Send a prompt to create your first game.
          </p>
        )}
        {versions.map((version) => {
          const label =
            version.versionNumber != null
              ? `v${version.versionNumber}`
              : version.storageKey || version.id.slice(0, 8);
          return (
          <div
            key={version.id}
            className={clsx(
              "w-full text-left p-2 rounded-md text-xs transition-colors group relative",
              version.isActive
                ? "bg-[var(--accent)]/20 border border-[var(--accent)]/40"
                : "hover-item border border-transparent"
            )}
          >
            <button
              type="button"
              onClick={() => onSwitch(version.id)}
              className="w-full text-left"
            >
            <div className="flex items-center gap-1.5 mb-1 pr-6">
              <span className="font-medium">{label}</span>
              {version.isActive && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)] text-white">
                  Active
                </span>
              )}
            </div>
            <p className="text-[var(--muted)] truncate">{version.prompt}</p>
            <div className="flex items-center gap-1 mt-1 text-[10px] text-[var(--muted)]">
              <Clock size={10} />
              {new Date(version.createdAt).toLocaleString()}
            </div>
            </button>
            {versions.length > 1 && (
              <button
                type="button"
                title="Delete version"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(version.id);
                }}
                className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--danger)]/10 text-[var(--muted)] hover:text-[var(--danger)]"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}
