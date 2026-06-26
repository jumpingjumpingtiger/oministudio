import { prisma } from "@/lib/db";
import type { ProgressCallback } from "@/lib/generation-progress";
import { resolveVersionStorageKey } from "@/lib/version-storage";
import { runCodeGraph } from "@/lib/engine/graph/code-graph";
import { runAssetsGraph } from "@/lib/engine/graph/assets-graph";

export interface GenerateCodeOptions {
  projectId: string;
  prompt: string;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

export interface GenerateCodeResult {
  versionId: string;
  summary: string;
  assetCount: number;
  versionNumber: number;
}

export interface GenerateAssetsOptions {
  projectId: string;
  versionId: string;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

export interface GenerateAssetsResult {
  versionId: string;
  summary: string;
  assetCount: number;
  versionNumber: number;
}

/**
 * Code-generation phase, orchestrated as a LangGraph StateGraph
 * (load_context → retrieve_context → brain_generate → validate → [self_heal] →
 * reconcile_assets → persist_version). See feature/fearture2026-06-26.md.
 */
export async function generateCodePhase(
  options: GenerateCodeOptions
): Promise<GenerateCodeResult> {
  const { projectId, prompt, onProgress, signal } = options;
  const emit = async (event: Parameters<ProgressCallback>[0]) => {
    if (signal?.aborted) {
      throw new DOMException("Generation cancelled", "AbortError");
    }
    await onProgress?.(event);
  };

  const result = await runCodeGraph({ projectId, prompt, emit, signal });
  return {
    versionId: result.versionId,
    summary: result.summary,
    assetCount: result.assetCount,
    versionNumber: result.versionNumber,
  };
}

/**
 * Asset-generation phase, orchestrated as a LangGraph StateGraph
 * (load_pending → dispatch_assets → resolve_assets → finalize). See feature/fearture2026-06-26.md.
 */
export async function generateAssetsPhase(
  options: GenerateAssetsOptions
): Promise<GenerateAssetsResult> {
  const { projectId, versionId, onProgress, signal } = options;
  const emit = async (event: Parameters<ProgressCallback>[0]) => {
    if (signal?.aborted) {
      throw new DOMException("Generation cancelled", "AbortError");
    }
    await onProgress?.(event);
  };

  const result = await runAssetsGraph({ projectId, prompt: "", versionId, emit, signal });
  return {
    versionId: result.versionId,
    summary: result.summary,
    assetCount: result.assetCount,
    versionNumber: result.versionNumber,
  };
}

export async function switchVersion(
  projectId: string,
  versionId: string
): Promise<void> {
  const version = await prisma.version.findFirst({
    where: { id: versionId, projectId },
  });

  if (!version) {
    throw new Error("Version not found");
  }

  await prisma.version.updateMany({
    where: { projectId },
    data: { isActive: false },
  });

  await prisma.version.update({
    where: { id: versionId },
    data: { isActive: true },
  });
}

export async function deleteVersion(
  projectId: string,
  versionId: string
): Promise<void> {
  const version = await prisma.version.findFirst({
    where: { id: versionId, projectId },
  });

  if (!version) {
    throw new Error("Version not found");
  }

  const storageKey = await resolveVersionStorageKey(projectId, versionId);
  const wasActive = version.isActive;

  await prisma.version.delete({ where: { id: versionId } });

  if (storageKey) {
    const { deleteVersionStorage } = await import("@/lib/storage");
    await deleteVersionStorage(projectId, storageKey);
  }

  if (wasActive) {
    const next = await prisma.version.findFirst({
      where: { projectId },
      orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }],
    });
    if (next) {
      await switchVersion(projectId, next.id);
    }
  }
}
