"use client";

import { useState } from "react";
import { Check, ChevronLeft, FolderOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import clsx from "clsx";

interface Project {
  id: string;
  name: string;
  description: string;
  _count?: { versions: number; assets: number };
}

interface ProjectPanelProps {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string, description: string) => Promise<string>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => void;
  onHide: () => void;
  className?: string;
}

export function ProjectPanel({
  projects,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onHide,
  className,
}: ProjectPanelProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await onCreate(newName.trim(), newDesc.trim());
    setNewName("");
    setNewDesc("");
    setShowCreate(false);
  };

  const startEditing = (project: Project) => {
    setEditingId(project.id);
    setEditName(project.name);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditName("");
  };

  const saveRename = async () => {
    if (!editingId || !editName.trim()) return;
    await onRename(editingId, editName.trim());
    cancelEditing();
  };

  return (
    <div className={clsx("flex flex-col", className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--panel-border)]">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FolderOpen size={14} className="text-[var(--accent)]" />
          Projects
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="btn-ghost p-1"
            title="New project"
          >
            <Plus size={14} />
          </button>
          <button onClick={onHide} className="btn-ghost p-1" title="Hide panel">
            <ChevronLeft size={14} />
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="p-2 border-b border-[var(--panel-border)] space-y-2">
          <input
            type="text"
            placeholder="Project name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-2 py-1.5 text-xs rounded input-field"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            className="w-full px-2 py-1.5 text-xs rounded input-field"
          />
          <button onClick={handleCreate} className="btn-primary w-full text-xs py-1.5">
            Create
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {projects.length === 0 && (
          <p className="text-xs text-[var(--muted)] px-2 py-4 text-center">
            No projects yet. Start chatting to create one.
          </p>
        )}
        {projects.map((project) => (
          <div
            key={project.id}
            className={clsx(
              "group flex items-center rounded-md text-xs transition-colors border",
              selectedId === project.id
                ? "bg-[var(--accent)]/10 border-[var(--accent)]/30"
                : "hover-item border-transparent"
            )}
          >
            {editingId === project.id ? (
              <div className="flex-1 flex items-center gap-1 p-1.5 min-w-0">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 px-2 py-1 text-xs rounded input-field min-w-0"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveRename();
                    if (e.key === "Escape") cancelEditing();
                  }}
                />
                <button onClick={saveRename} className="btn-ghost p-1 text-[var(--success)]">
                  <Check size={12} />
                </button>
                <button onClick={cancelEditing} className="btn-ghost p-1">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => onSelect(project.id)}
                  className="flex-1 text-left p-2 min-w-0"
                >
                  <p className="font-medium truncate">{project.name}</p>
                  <p className="text-[var(--muted)] text-[10px] mt-0.5">
                    {project._count?.versions ?? 0} versions · {project._count?.assets ?? 0} assets
                  </p>
                </button>
                <button
                  onClick={() => startEditing(project)}
                  className="btn-ghost p-1 mr-0.5 opacity-0 group-hover:opacity-100"
                  title="Rename project"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete project "${project.name}"?`)) {
                      onDelete(project.id);
                    }
                  }}
                  className="btn-ghost p-1 mr-1 opacity-0 group-hover:opacity-100 text-[var(--danger)]"
                  title="Delete project"
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
