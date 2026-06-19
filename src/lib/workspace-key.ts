import type { RightPanelTab } from "@/lib/types";

const SEP = "\u0001";

export function workspaceKey(projectId: string, versionId: string): string {
  return `${projectId}${SEP}${versionId}`;
}

export function parseWorkspaceKey(key: string): { projectId: string; versionId: string } {
  const idx = key.indexOf(SEP);
  if (idx === -1) {
    return { projectId: key, versionId: "" };
  }
  return {
    projectId: key.slice(0, idx),
    versionId: key.slice(idx + SEP.length),
  };
}

export function defaultWorkspaceTab(): RightPanelTab {
  return "preview";
}
