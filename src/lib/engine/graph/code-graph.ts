import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { prisma } from "@/lib/db";
import { mergeBrainAssetsWithExisting } from "@/lib/engine/asset-reuse";
import { mergeBrainFilesWithExisting } from "@/lib/engine/file-merge";
import {
  computeAssetChanges,
  computeFileChanges,
  type ChangeManifest,
} from "@/lib/change-manifest";
import {
  prepareBrainPrompt,
  callBrainFromPrompt,
  healBrainCode,
  type PreparedBrainPrompt,
} from "@/lib/engine/brain-llm";
import { enhanceUserPrompt, buildEnhanceChatTurns, resolveEnhanceMode, type EnhancePromptMode } from "@/lib/engine/prompt-enhancer";
import { createBrainStreamFileExtractor } from "@/lib/brain-stream-files";
import { isBrainLlmConfigured } from "@/lib/engine/llm-config";
import {
  validateGameCode,
  formatIssuesForHeal,
  summarizeIssues,
  type ValidationIssue,
} from "@/lib/engine/code-validation";
import type { BrainGenerationContext } from "@/lib/engine/brain-context";
import {
  initProjectStorage,
  listCodeFiles,
  readCodeFile,
  readPendingAssetsPayload,
  readUriCsv,
  writeCodeFile,
  writePendingAssets,
  copyCodeVersion,
  type UriCsvRow,
} from "@/lib/storage";
import {
  formatVersionStorageKey,
  resolveVersionStorageKey,
} from "@/lib/version-storage";
import { getProgressMessages } from "@/lib/utils/progress-messages";
import type { FileChangeType } from "@/lib/generation-progress";
import type { GeneratedAsset, GeneratedFile, BrainLlmResult } from "@/lib/types";
import type { GraphRuntime } from "./runtime";
import { defineNode } from "./runtime";

type BrainResult = BrainLlmResult & {
  meta: { inputTokens: number; outputTokens: number };
};

const CodeStateAnnotation = Annotation.Root({
  brainContext: Annotation<BrainGenerationContext | null>(),
  existingUriRows: Annotation<UriCsvRow[]>(),
  activeStorageKey: Annotation<string | null>(),
  hasActiveVersion: Annotation<boolean>(),
  previousPaths: Annotation<string[]>(),

  enhancedPrompt: Annotation<string>(),
  ragQueryPrompt: Annotation<string>(),

  enhanceMode: Annotation<EnhancePromptMode>(),
  enhanceChatTurns: Annotation<number>(),

  prepared: Annotation<PreparedBrainPrompt | null>(),

  brainResult: Annotation<BrainResult | null>(),
  files: Annotation<GeneratedFile[]>(),
  assets: Annotation<GeneratedAsset[]>(),
  summary: Annotation<string>(),

  issues: Annotation<ValidationIssue[]>(),
  errorCount: Annotation<number>(),

  mergedAssets: Annotation<GeneratedAsset[]>(),

  changeManifest: Annotation<ChangeManifest | null>(),

  versionId: Annotation<string>(),
  versionNumber: Annotation<number>(),
});

export type CodeState = typeof CodeStateAnnotation.State;

// ── Node: load_context ──────────────────────────────────────────────────────
const loadContext = defineNode<CodeState>(
  { id: "load_context", label: "Load project context", phase: "code" },
  async (_state, rt) => {
    const msg = getProgressMessages();
    const project = await prisma.project.findUnique({
      where: { id: rt.projectId },
      include: { versions: { where: { isActive: true }, take: 1 } },
    });
    if (!project) throw new Error("Project not found");

    await initProjectStorage(rt.projectId);

    const activeVersion = project.versions[0];
    let existingFiles: GeneratedFile[] | undefined;
    let existingUriRows: UriCsvRow[] = [];
    let activeStorageKey: string | null = null;

    if (activeVersion) {
      activeStorageKey = await resolveVersionStorageKey(rt.projectId, activeVersion.id);
      if (activeStorageKey) {
        existingUriRows = await readUriCsv(rt.projectId, activeStorageKey);
        if (existingUriRows.length === 0) {
          const pending = await readPendingAssetsPayload(rt.projectId, activeStorageKey);
          existingUriRows = pending.assets.map((asset, index) => ({
            order: asset.order ?? index,
            name: asset.name,
            type: asset.type,
            uri: asset.uri,
            url: "",
            assetId: "",
            prompt: asset.prompt,
            regenerate: asset.regenerate,
            format: asset.format || "png",
          }));
        }
        const filePaths = await listCodeFiles(rt.projectId, activeStorageKey);
        existingFiles = [];
        for (const filePath of filePaths) {
          const content = await readCodeFile(rt.projectId, activeStorageKey, filePath);
          if (content !== null) existingFiles.push({ path: filePath, content });
        }
      }
    }

    const brainContext: BrainGenerationContext = {
      project: { name: project.name, description: project.description },
      activeVersion: activeVersion
        ? {
            versionNumber: activeVersion.versionNumber,
            summary: activeVersion.summary,
            prompt: activeVersion.prompt,
          }
        : undefined,
      existingFiles,
      existingAssets: existingUriRows,
      projectId: rt.projectId,
      activeVersionId: activeVersion?.id,
    };

    await rt.emit({ type: "status", message: msg.analyzing });
    await rt.emit({ type: "thinking", message: msg.thinking });

    const previousPaths = activeStorageKey
      ? await listCodeFiles(rt.projectId, activeStorageKey)
      : [];

    return {
      brainContext,
      existingUriRows,
      activeStorageKey,
      hasActiveVersion: !!activeVersion,
      previousPaths,
    };
  }
);

// ── Node: enhance_prompt (pre-RAG normalization) ───────────────────────────
const enhancePrompt = defineNode<CodeState>(
  { id: "enhance_prompt", label: "Enhance user prompt", phase: "code" },
  async (state, rt) => {
    await rt.emit({ type: "prompt_enhance_start" });

    const filePaths =
      state.brainContext?.existingFiles?.map((f) => f.path) ?? state.previousPaths;

    const chatRows = await prisma.chatMessage.findMany({
      where: { projectId: rt.projectId },
      orderBy: { createdAt: "asc" },
      include: { version: { select: { versionNumber: true } } },
    });
    const recentChat = buildEnhanceChatTurns(chatRows, rt.prompt);

    const mode = resolveEnhanceMode({
      hasActiveVersion: state.hasActiveVersion,
      filePaths,
      assetCount: state.existingUriRows.length,
    });

    const enhanced = await enhanceUserPrompt({
      rawPrompt: rt.prompt,
      mode,
      projectName: state.brainContext?.project?.name,
      filePaths,
      assets: state.existingUriRows,
      recentChat,
      signal: rt.signal,
      onThinkingChunk: async (chunk) => {
        await rt.emit({ type: "llm_thinking_chunk", phase: "enhance", chunk });
      },
    });

    await rt.emit({
      type: "prompt_enhanced",
      original: rt.prompt,
      enhanced: enhanced.displayPrompt,
    });

    return {
      enhancedPrompt: enhanced.displayPrompt,
      ragQueryPrompt: enhanced.ragPrompt,
      enhanceMode: mode,
      enhanceChatTurns: recentChat.length,
    };
  }
);

// ── Node: retrieve_context (RAG) ─────────────────────────────────────────────
const retrieveContext = defineNode<CodeState>(
  { id: "retrieve_context", label: "RAG retrieval (UPG + AST)", phase: "code" },
  async (state, rt) => {
    const queryPrompt = state.ragQueryPrompt || state.enhancedPrompt || rt.prompt;
    const prepared = await prepareBrainPrompt(queryPrompt, state.brainContext ?? {});
    await rt.emit({ type: "brain_context_start", inputTokens: prepared.inputTokens });
    await rt.emit({
      type: "brain_context_line",
      line: `[Prompt enhance] mode=${state.enhanceMode ?? "iteration"}, chat=${state.enhanceChatTurns ?? 0} turn(s) with change records`,
    });
    await rt.emit({
      type: "brain_context_line",
      line: `[Prompt] raw: ${rt.prompt.trim().slice(0, 120)}${rt.prompt.trim().length > 120 ? "…" : ""}`,
    });
    if (state.enhancedPrompt && state.enhancedPrompt.trim() !== rt.prompt.trim()) {
      await rt.emit({
        type: "brain_context_line",
        line: `[Prompt] enhanced → ${state.enhancedPrompt.trim().slice(0, 160)}${state.enhancedPrompt.trim().length > 160 ? "…" : ""}`,
      });
    }
    for (const line of prepared.built.contextPreview.contextLines) {
      await rt.emit({ type: "brain_context_line", line });
    }
    return { prepared };
  }
);

// ── Node: brain_generate ─────────────────────────────────────────────────────
const brainGenerate = defineNode<CodeState>(
  { id: "brain_generate", label: "Brain LLM generation", phase: "code" },
  async (state, rt) => {
    const queryPrompt = state.ragQueryPrompt || state.enhancedPrompt || rt.prompt;
    await rt.emit({ type: "brain_calling" });
    const streamFiles = createBrainStreamFileExtractor();
    const previousPathSet = new Set(state.previousPaths);
    const brainResult = await callBrainFromPrompt({
      userPrompt: queryPrompt,
      context: state.brainContext ?? {},
      prepared: state.prepared!,
      hooks: {
        signal: rt.signal,
        onThinkingChunk: async (chunk) => {
          await rt.emit({ type: "llm_thinking_chunk", phase: "brain", chunk });
        },
        onCodeOutputStart: async () => {
          await rt.emit({ type: "llm_code_output_start" });
        },
        onStreamReset: async () => {
          streamFiles.reset();
        },
        onCodeChunk: async (chunk) => {
          for (const update of streamFiles.push(chunk)) {
            const changeType = previousPathSet.has(update.path) ? "modified" : "new";
            if (update.isNew) {
              await rt.emit({ type: "file_planned", path: update.path, changeType });
              await rt.emit({ type: "file_writing", path: update.path });
            }
            await rt.emit({
              type: "file_content_progress",
              path: update.path,
              content: update.content,
            });
          }
        },
      },
    });

    const existingFiles = state.brainContext?.existingFiles ?? [];
    const mergedFiles = mergeBrainFilesWithExisting(brainResult.files, existingFiles);

    await rt.emit({
      type: "brain_token_usage",
      inputTokens: brainResult.meta.inputTokens,
      outputTokens: brainResult.meta.outputTokens,
    });
    return {
      brainResult,
      files: mergedFiles,
      assets: brainResult.assets,
      summary: brainResult.summary,
    };
  }
);

// ── Node: validate (static analysis) ─────────────────────────────────────────
const validate = defineNode<CodeState>(
  { id: "validate", label: "Static validation", phase: "code" },
  async (state, rt) => {
    const issues = validateGameCode(state.files, state.assets);
    const errorCount = issues.filter((i) => i.severity === "error").length;
    if (issues.length) {
      await rt.emit({ type: "status", message: `Static check: ${summarizeIssues(issues)}` });
    }
    return { issues, errorCount };
  }
);

// ── Node: self_heal (compiler-feedback corrective pass) ──────────────────────
const selfHeal = defineNode<CodeState>(
  { id: "self_heal", label: "Self-heal from static feedback", phase: "code" },
  async (state, rt) => {
    await rt.emit({ type: "status", message: "Self-healing code from static-analysis feedback…" });
    const healed = await healBrainCode({
      prompt: state.enhancedPrompt || rt.prompt,
      files: state.files,
      assets: state.assets,
      issues: formatIssuesForHeal(state.issues),
    });
    if (healed?.files?.length) {
      const healedErrors = validateGameCode(healed.files, healed.assets).filter(
        (i) => i.severity === "error"
      ).length;
      if (healedErrors < state.errorCount) {
        await rt.emit({
          type: "status",
          message: `Self-heal applied (${state.errorCount} → ${healedErrors} error(s)).`,
        });
        return {
          files: healed.files,
          assets: healed.assets.length ? healed.assets : state.assets,
        };
      }
    }
    return {};
  }
);

// ── Node: reconcile_assets ───────────────────────────────────────────────────
const reconcileAssets = defineNode<CodeState>(
  { id: "reconcile_assets", label: "Reconcile asset manifest", phase: "code" },
  async (state, rt) => {
    const mergedAssets = mergeBrainAssetsWithExisting(
      state.assets,
      state.existingUriRows,
      state.files
    );

    const previousContents = new Map<string, string>();
    if (state.activeStorageKey) {
      for (const filePath of state.previousPaths) {
        const content = await readCodeFile(rt.projectId, state.activeStorageKey, filePath);
        if (content !== null) previousContents.set(filePath, content);
      }
    }

    const fileChanges = computeFileChanges(state.files, state.previousPaths, (path) =>
      previousContents.get(path)
    );
    const assetChanges = computeAssetChanges(mergedAssets, state.existingUriRows);
    const changeManifest: ChangeManifest = { files: fileChanges, assets: assetChanges };

    const plannedAssets = mergedAssets.map((a) => ({
      name: a.name,
      uri: a.uri,
      regenerate: a.regenerate !== false,
      format: a.format,
    }));

    await rt.emit({ type: "change_manifest", manifest: changeManifest });
    await rt.emit({
      type: "brain_decision",
      summary: state.summary,
      files: state.files.map((f) => f.path),
      assets: plannedAssets,
    });
    await rt.emit({
      type: "files_planned",
      files: state.files.map((f) => f.path),
      assetCount: mergedAssets.length,
    });
    await rt.emit({ type: "assets_planned", assets: plannedAssets });

    const previousPathSet = new Set(state.previousPaths);
    for (const file of state.files) {
      let changeType: FileChangeType = "new";
      if (previousPathSet.has(file.path) && state.activeStorageKey) {
        const previousContent = await readCodeFile(
          rt.projectId,
          state.activeStorageKey,
          file.path
        );
        changeType = previousContent === file.content ? "unchanged" : "modified";
      }
      await rt.emit({ type: "file_planned", path: file.path, changeType });
    }

    return { mergedAssets, changeManifest };
  }
);

// ── Node: persist_version ────────────────────────────────────────────────────
const persistVersion = defineNode<CodeState>(
  { id: "persist_version", label: "Persist version & write files", phase: "code" },
  async (state, rt) => {
    const msg = getProgressMessages();

    await prisma.version.updateMany({
      where: { projectId: rt.projectId },
      data: { isActive: false },
    });

    const versionCount = await prisma.version.count({ where: { projectId: rt.projectId } });
    const versionNumber = versionCount + 1;
    const storageKey = formatVersionStorageKey(versionNumber);

    const version = await prisma.version.create({
      data: {
        projectId: rt.projectId,
        prompt: rt.prompt,
        summary: state.summary,
        isActive: true,
        versionNumber,
        storageKey,
      },
    });

    await rt.emit({ type: "version_created", versionId: version.id, versionNumber });

    if (state.hasActiveVersion && state.activeStorageKey) {
      await copyCodeVersion(rt.projectId, state.activeStorageKey, storageKey);
    }

    await rt.emit({ type: "status", message: msg.writing });

    const previousPathSet = new Set(state.previousPaths);
    for (const file of state.files) {
      const previousContent = state.hasActiveVersion
        ? await readCodeFile(rt.projectId, storageKey, file.path)
        : null;
      const isNew = !previousPathSet.has(file.path);
      const isModified = !isNew && previousContent !== null && previousContent !== file.content;
      const changeType: FileChangeType = isNew ? "new" : isModified ? "modified" : "unchanged";

      await rt.emit({ type: "file_planned", path: file.path, changeType });
      await rt.emit({ type: "file_writing", path: file.path });
      await rt.emit({
        type: "file_written",
        path: file.path,
        content: file.content,
        previousContent: previousContent ?? undefined,
        changeType,
      });
      await writeCodeFile(rt.projectId, storageKey, file.path, file.content);
    }

    await writePendingAssets(rt.projectId, storageKey, state.mergedAssets, {
      versionNumber,
      changeManifest: state.changeManifest ?? undefined,
    });

    await rt.emit({
      type: "code_complete",
      versionId: version.id,
      versionNumber,
      assetCount: state.mergedAssets.length,
      summary: state.summary,
    });

    return { versionId: version.id, versionNumber };
  }
);

function routeAfterValidate(state: CodeState): "self_heal" | "reconcile_assets" {
  return state.errorCount > 0 && isBrainLlmConfigured() ? "self_heal" : "reconcile_assets";
}

const codeGraph = new StateGraph(CodeStateAnnotation)
  .addNode("load_context", loadContext)
  .addNode("enhance_prompt", enhancePrompt)
  .addNode("retrieve_context", retrieveContext)
  .addNode("brain_generate", brainGenerate)
  .addNode("validate", validate)
  .addNode("self_heal", selfHeal)
  .addNode("reconcile_assets", reconcileAssets)
  .addNode("persist_version", persistVersion)
  .addEdge(START, "load_context")
  .addEdge("load_context", "enhance_prompt")
  .addEdge("enhance_prompt", "retrieve_context")
  .addEdge("retrieve_context", "brain_generate")
  .addEdge("brain_generate", "validate")
  .addConditionalEdges("validate", routeAfterValidate, {
    self_heal: "self_heal",
    reconcile_assets: "reconcile_assets",
  })
  .addEdge("self_heal", "reconcile_assets")
  .addEdge("reconcile_assets", "persist_version")
  .addEdge("persist_version", END)
  .compile();

export interface CodeGraphResult {
  versionId: string;
  versionNumber: number;
  summary: string;
  assetCount: number;
}

/** Run the code-generation graph end-to-end for one prompt. */
export async function runCodeGraph(runtime: GraphRuntime): Promise<CodeGraphResult> {
  const final = (await codeGraph.invoke(
    {},
    { configurable: { runtime }, recursionLimit: 50 }
  )) as CodeState;

  return {
    versionId: final.versionId,
    versionNumber: final.versionNumber,
    summary: final.summary,
    assetCount: final.mergedAssets?.length ?? 0,
  };
}
