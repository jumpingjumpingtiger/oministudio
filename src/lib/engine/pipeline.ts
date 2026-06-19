import { prisma } from "@/lib/db";
import { resolveAssetUris } from "@/lib/asset-resolver";
import { runBrainLlm } from "@/lib/engine/brain-llm";
import { dispatchAssets } from "@/lib/engine/dispatch";
import type { ProgressCallback } from "@/lib/generation-progress";
import {
  copyCodeVersion,
  deletePendingAssets,
  initProjectStorage,
  listCodeFiles,
  readCodeFile,
  readPendingAssetsPayload,
  readUriCsv,
  upsertUriCsvRow,
  writeCodeFile,
  writePendingAssets,
  writeUriCsv,
} from "@/lib/storage";
import { getProgressMessages } from "@/lib/utils/progress-messages";
import {
  formatVersionStorageKey,
  resolveVersionStorageKey,
} from "@/lib/version-storage";
import type { GeneratedFile } from "@/lib/types";
import type { FileChangeType } from "@/lib/generation-progress";

const STREAM_CHUNK_SIZE = 48;
const STREAM_DELAY_MS = 10;

async function streamFileToClient(
  emit: (event: Parameters<ProgressCallback>[0]) => Promise<void>,
  path: string,
  content: string,
  meta: { previousContent?: string; changeType: FileChangeType }
): Promise<void> {
  await emit({ type: "file_planned", path, changeType: meta.changeType });
  await emit({ type: "file_writing", path });

  if (content.length === 0) {
    await emit({ type: "file_content_progress", path, content: "" });
  } else {
    for (let end = STREAM_CHUNK_SIZE; end < content.length; end += STREAM_CHUNK_SIZE) {
      await emit({
        type: "file_content_progress",
        path,
        content: content.slice(0, end),
      });
      await new Promise((resolve) => setTimeout(resolve, STREAM_DELAY_MS));
    }
    await emit({ type: "file_content_progress", path, content });
  }

  await emit({
    type: "file_written",
    path,
    content,
    previousContent: meta.previousContent,
    changeType: meta.changeType,
  });
}

export interface GenerateCodeOptions {
  projectId: string;
  prompt: string;
  onProgress?: ProgressCallback;
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
}

export interface GenerateAssetsResult {
  versionId: string;
  summary: string;
  assetCount: number;
  versionNumber: number;
}

function buildAssetUrlMap(
  dispatchResults: Awaited<ReturnType<typeof dispatchAssets>>
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const result of dispatchResults) {
    map[result.uri] = result.url;
    map[`asset://${result.type}/${result.assetName}`] = result.url;
  }
  return map;
}

function toUriRow(result: Awaited<ReturnType<typeof dispatchAssets>>[number]) {
  return {
    order: result.order,
    name: result.assetName,
    type: result.type,
    uri: result.uri,
    url: result.url,
    assetId: result.assetId,
    prompt: result.prompt,
    regenerate: result.regenerate,
    format: result.format,
  };
}

export async function generateCodePhase(
  options: GenerateCodeOptions
): Promise<GenerateCodeResult> {
  const { projectId, prompt, onProgress } = options;
  const msg = getProgressMessages();
  const emit = async (event: Parameters<ProgressCallback>[0]) => {
    await onProgress?.(event);
  };

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { versions: { where: { isActive: true }, take: 1 } },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  await initProjectStorage(projectId);

  let existingFiles: GeneratedFile[] | undefined;
  const activeVersion = project.versions[0];
  const existingUriRows = activeVersion
    ? await readUriCsv(projectId, activeVersion.id)
    : [];

  if (activeVersion) {
    const filePaths = await listCodeFiles(projectId, activeVersion.id);
    existingFiles = [];
    for (const filePath of filePaths) {
      const content = await readCodeFile(projectId, activeVersion.id, filePath);
      if (content !== null) {
        existingFiles.push({ path: filePath, content });
      }
    }
  }

  await emit({ type: "status", message: msg.analyzing });
  await emit({ type: "thinking", message: msg.thinking });

  const brainResult = await runBrainLlm(
    prompt,
    existingFiles,
    existingUriRows
  );

  await prisma.version.updateMany({
    where: { projectId },
    data: { isActive: false },
  });

  const versionCount = await prisma.version.count({ where: { projectId } });
  const versionNumber = versionCount + 1;
  const storageKey = formatVersionStorageKey(versionNumber);

  const version = await prisma.version.create({
    data: {
      projectId,
      prompt,
      summary: brainResult.summary,
      isActive: true,
      versionNumber,
      storageKey,
    },
  });

  await emit({
    type: "version_created",
    versionId: version.id,
    versionNumber,
  });

  if (activeVersion) {
    const fromStorageKey = await resolveVersionStorageKey(projectId, activeVersion.id);
    if (fromStorageKey) {
      await copyCodeVersion(projectId, fromStorageKey, storageKey);
    }
  }

  await emit({
    type: "files_planned",
    files: brainResult.files.map((f) => f.path),
    assetCount: brainResult.assets.length,
  });

  await emit({
    type: "assets_planned",
    assets: brainResult.assets.map((a) => ({
      name: a.name,
      uri: a.uri,
      regenerate: a.regenerate !== false,
      format: a.format,
    })),
  });

  await emit({ type: "status", message: msg.writing });

  const activeStorageKey = activeVersion
    ? await resolveVersionStorageKey(projectId, activeVersion.id)
    : null;
  const previousPaths = activeStorageKey
    ? await listCodeFiles(projectId, activeStorageKey)
    : [];
  const previousPathSet = new Set(previousPaths);

  for (const file of brainResult.files) {
    const previousContent = activeVersion
      ? await readCodeFile(projectId, storageKey, file.path)
      : null;
    const isNew = !previousPathSet.has(file.path);
    const isModified =
      !isNew && previousContent !== null && previousContent !== file.content;
    const changeType = isNew ? "new" : isModified ? "modified" : "unchanged";

    await streamFileToClient(emit, file.path, file.content, {
      previousContent: previousContent ?? undefined,
      changeType,
    });
    await writeCodeFile(projectId, storageKey, file.path, file.content);
  }

  await writePendingAssets(projectId, storageKey, brainResult.assets, {
    versionNumber,
  });

  await emit({
    type: "code_complete",
    versionId: version.id,
    versionNumber,
    assetCount: brainResult.assets.length,
    summary: brainResult.summary,
  });

  return {
    versionId: version.id,
    summary: brainResult.summary,
    assetCount: brainResult.assets.length,
    versionNumber,
  };
}

export async function generateAssetsPhase(
  options: GenerateAssetsOptions
): Promise<GenerateAssetsResult> {
  const { projectId, versionId, onProgress } = options;
  const emit = async (event: Parameters<ProgressCallback>[0]) => {
    await onProgress?.(event);
  };

  const version = await prisma.version.findFirst({
    where: { id: versionId, projectId },
  });

  if (!version) {
    throw new Error("Version not found");
  }

  const storageKey = await resolveVersionStorageKey(projectId, versionId);
  if (!storageKey) {
    throw new Error("Version storage not found");
  }

  const payload = await readPendingAssetsPayload(projectId, storageKey);
  const msg = getProgressMessages();

  const pendingAssets = payload.assets;
  if (pendingAssets.length === 0) {
    throw new Error("No pending assets for this version");
  }

  const versionNumber =
    payload.meta?.versionNumber ?? (await prisma.version.count({ where: { projectId } }));

  await emit({
    type: "assets_planned",
    assets: pendingAssets.map((a) => ({
      name: a.name,
      uri: a.uri,
      regenerate: a.regenerate !== false,
      format: a.format,
    })),
  });

  await emit({
    type: "status",
    message: msg.generatingAssets(pendingAssets.length),
  });

  const dispatchResults = await dispatchAssets(projectId, pendingAssets, async (assetEvent) => {
    if (assetEvent.type === "generating") {
      await emit({
        type: "asset_generating",
        name: assetEvent.name,
        uri: assetEvent.uri,
        index: assetEvent.index,
        total: assetEvent.total,
      });
    } else if (assetEvent.type === "generated") {
      void upsertUriCsvRow(projectId, storageKey, toUriRow(assetEvent.result));
      await emit({
        type: "asset_generated",
        name: assetEvent.name,
        uri: assetEvent.uri,
        assetId: assetEvent.assetId,
        url: assetEvent.url,
      });
    } else if (assetEvent.type === "reused") {
      void upsertUriCsvRow(projectId, storageKey, toUriRow(assetEvent.result));
      await emit({
        type: "asset_reused",
        name: assetEvent.name,
        uri: assetEvent.uri,
        assetId: assetEvent.assetId,
        url: assetEvent.url,
      });
    } else if (assetEvent.type === "failed") {
      await emit({
        type: "asset_failed",
        name: assetEvent.name,
        uri: assetEvent.uri,
        error: assetEvent.error,
      });
    }
  });

  const assetUrlMap = buildAssetUrlMap(dispatchResults);

  await emit({ type: "status", message: msg.resolving });

  const filePaths = await listCodeFiles(projectId, storageKey);
  for (const filePath of filePaths) {
    const content = await readCodeFile(projectId, storageKey, filePath);
    if (content === null) continue;
    const resolvedContent = resolveAssetUris(content, assetUrlMap);
    if (resolvedContent === content) continue;

    await streamFileToClient(emit, filePath, resolvedContent, {
      previousContent: content,
      changeType: "modified",
    });
    await writeCodeFile(projectId, storageKey, filePath, resolvedContent);
  }

  const uriRows = dispatchResults.map(toUriRow);
  await writeUriCsv(projectId, storageKey, uriRows);
  await deletePendingAssets(projectId, storageKey);

  const summaryWithVersion = `${version.summary}\n\n— Version v${versionNumber}`;

  await prisma.chatMessage.create({
    data: {
      projectId,
      versionId: version.id,
      role: "assistant",
      content: summaryWithVersion,
      files: "[]",
    },
  });

  await emit({
    type: "complete",
    versionId: version.id,
    summary: version.summary,
    versionNumber,
  });

  return {
    versionId: version.id,
    summary: version.summary,
    assetCount: pendingAssets.length,
    versionNumber,
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
