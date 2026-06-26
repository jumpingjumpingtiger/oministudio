import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { prisma } from "@/lib/db";
import { resolveAssetUris } from "@/lib/asset-resolver";
import { dispatchAssets, type DispatchResult } from "@/lib/engine/dispatch";
import {
  deletePendingAssets,
  listCodeFiles,
  readCodeFile,
  readPendingAssetsPayload,
  upsertUriCsvRow,
  writeCodeFile,
  writeUriCsv,
} from "@/lib/storage";
import { resolveVersionStorageKey } from "@/lib/version-storage";
import { getProgressMessages } from "@/lib/utils/progress-messages";
import type { GeneratedAsset } from "@/lib/types";
import type { GraphRuntime } from "./runtime";
import { defineNode } from "./runtime";
import { buildAssetUrlMap, streamFileToClient, toUriRow } from "./io";
import { encodeAssistantMessageFiles, type ChangeManifest } from "@/lib/change-manifest";

const AssetStateAnnotation = Annotation.Root({
  storageKey: Annotation<string>(),
  versionRecordId: Annotation<string>(),
  versionNumber: Annotation<number>(),
  summary: Annotation<string>(),
  pendingAssets: Annotation<GeneratedAsset[]>(),
  dispatchResults: Annotation<DispatchResult[]>(),
  changeManifest: Annotation<ChangeManifest | null>(),
});

export type AssetState = typeof AssetStateAnnotation.State;

// ── Node: load_pending ───────────────────────────────────────────────────────
const loadPending = defineNode<AssetState>(
  { id: "load_pending", label: "Load pending assets", phase: "assets" },
  async (_state, rt) => {
    const versionId = rt.versionId;
    if (!versionId) throw new Error("versionId required for asset generation");

    const version = await prisma.version.findFirst({
      where: { id: versionId, projectId: rt.projectId },
    });
    if (!version) throw new Error("Version not found");

    const storageKey = await resolveVersionStorageKey(rt.projectId, versionId);
    if (!storageKey) throw new Error("Version storage not found");

    const payload = await readPendingAssetsPayload(rt.projectId, storageKey);
    const pendingAssets = payload.assets;
    if (pendingAssets.length === 0) throw new Error("No pending assets for this version");

    const versionNumber =
      payload.meta?.versionNumber ?? (await prisma.version.count({ where: { projectId: rt.projectId } }));

    const msg = getProgressMessages();
    await rt.emit({
      type: "assets_planned",
      assets: pendingAssets.map((a) => ({
        name: a.name,
        uri: a.uri,
        regenerate: a.regenerate !== false,
        format: a.format,
      })),
    });
    await rt.emit({ type: "status", message: msg.generatingAssets(pendingAssets.length) });

    return {
      storageKey,
      versionRecordId: version.id,
      versionNumber,
      summary: version.summary,
      pendingAssets,
      changeManifest: payload.meta?.changeManifest ?? null,
    };
  }
);

// ── Node: dispatch_assets (reuse or expert image generation) ─────────────────
const dispatch = defineNode<AssetState>(
  { id: "dispatch_assets", label: "Generate / reuse assets", phase: "assets" },
  async (state, rt) => {
    const dispatchResults = await dispatchAssets(
      rt.projectId,
      state.pendingAssets,
      async (assetEvent) => {
        if (assetEvent.type === "generating") {
          await rt.emit({
            type: "asset_generating",
            name: assetEvent.name,
            uri: assetEvent.uri,
            index: assetEvent.index,
            total: assetEvent.total,
          });
        } else if (assetEvent.type === "generated") {
          void upsertUriCsvRow(rt.projectId, state.storageKey, toUriRow(assetEvent.result));
          await rt.emit({
            type: "asset_generated",
            name: assetEvent.name,
            uri: assetEvent.uri,
            assetId: assetEvent.assetId,
            url: assetEvent.url,
          });
        } else if (assetEvent.type === "reused") {
          void upsertUriCsvRow(rt.projectId, state.storageKey, toUriRow(assetEvent.result));
          await rt.emit({
            type: "asset_reused",
            name: assetEvent.name,
            uri: assetEvent.uri,
            assetId: assetEvent.assetId,
            url: assetEvent.url,
          });
        } else if (assetEvent.type === "failed") {
          await rt.emit({
            type: "asset_failed",
            name: assetEvent.name,
            uri: assetEvent.uri,
            error: assetEvent.error,
          });
        }
      }
    );

    return { dispatchResults };
  }
);

// ── Node: resolve_assets (rewrite asset:// → real URLs, persist uri.csv) ──────
const resolveAssets = defineNode<AssetState>(
  { id: "resolve_assets", label: "Resolve asset URLs in code", phase: "assets" },
  async (state, rt) => {
    const msg = getProgressMessages();
    const assetUrlMap = buildAssetUrlMap(state.dispatchResults);

    await rt.emit({ type: "status", message: msg.resolving });

    const filePaths = await listCodeFiles(rt.projectId, state.storageKey);
    for (const filePath of filePaths) {
      const content = await readCodeFile(rt.projectId, state.storageKey, filePath);
      if (content === null) continue;
      const resolvedContent = resolveAssetUris(content, assetUrlMap);
      if (resolvedContent === content) continue;

      await streamFileToClient(rt.emit, filePath, resolvedContent, {
        previousContent: content,
        changeType: "modified",
      });
      await writeCodeFile(rt.projectId, state.storageKey, filePath, resolvedContent);
    }

    const uriRows = state.dispatchResults.map(toUriRow);
    await writeUriCsv(rt.projectId, state.storageKey, uriRows);
    await deletePendingAssets(rt.projectId, state.storageKey);

    return {};
  }
);

// ── Node: finalize ───────────────────────────────────────────────────────────
const finalize = defineNode<AssetState>(
  { id: "finalize", label: "Finalize version", phase: "assets" },
  async (state, rt) => {
    const summaryWithVersion = `${state.summary}\n\n— Version v${state.versionNumber}`;
    const filesPayload =
      state.changeManifest != null
        ? encodeAssistantMessageFiles(state.changeManifest)
        : "[]";

    await prisma.chatMessage.create({
      data: {
        projectId: rt.projectId,
        versionId: state.versionRecordId,
        role: "assistant",
        content: summaryWithVersion,
        files: filesPayload,
      },
    });
    if (state.changeManifest) {
      await rt.emit({ type: "change_manifest", manifest: state.changeManifest });
    }
    await rt.emit({
      type: "complete",
      versionId: state.versionRecordId,
      summary: state.summary,
      versionNumber: state.versionNumber,
    });
    return {};
  }
);

const assetsGraph = new StateGraph(AssetStateAnnotation)
  .addNode("load_pending", loadPending)
  .addNode("dispatch_assets", dispatch)
  .addNode("resolve_assets", resolveAssets)
  .addNode("finalize", finalize)
  .addEdge(START, "load_pending")
  .addEdge("load_pending", "dispatch_assets")
  .addEdge("dispatch_assets", "resolve_assets")
  .addEdge("resolve_assets", "finalize")
  .addEdge("finalize", END)
  .compile();

export interface AssetGraphResult {
  versionId: string;
  versionNumber: number;
  summary: string;
  assetCount: number;
}

/** Run the asset-generation graph for an already-created code version. */
export async function runAssetsGraph(runtime: GraphRuntime): Promise<AssetGraphResult> {
  const final = (await assetsGraph.invoke(
    {},
    { configurable: { runtime }, recursionLimit: 50 }
  )) as AssetState;

  return {
    versionId: final.versionRecordId,
    versionNumber: final.versionNumber,
    summary: final.summary,
    assetCount: final.pendingAssets?.length ?? 0,
  };
}
