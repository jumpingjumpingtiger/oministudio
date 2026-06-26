export type FileChangeType = "new" | "modified" | "unchanged";

import type { ChangeManifest } from "@/lib/change-manifest";

export type GenerationProgressEvent =
  | { type: "status"; message: string }
  | { type: "thinking"; message: string }
  | { type: "version_created"; versionId: string; versionNumber: number }
  | { type: "files_planned"; files: string[]; assetCount: number }
  | { type: "file_planned"; path: string; changeType: FileChangeType }
  | { type: "file_writing"; path: string }
  | { type: "file_content_progress"; path: string; content: string }
  | {
      type: "file_written";
      path: string;
      content: string;
      previousContent?: string;
      changeType: FileChangeType;
    }
  | { type: "code_complete"; versionId: string; versionNumber: number; assetCount: number; summary: string }
  | {
      type: "assets_planned";
      assets: { name: string; uri: string; regenerate: boolean; format?: string }[];
    }
  | { type: "asset_generating"; name: string; uri: string; index: number; total: number }
  | { type: "asset_generated"; name: string; uri: string; assetId: string; url: string }
  | { type: "asset_reused"; name: string; uri: string; assetId: string; url: string }
  | { type: "asset_failed"; name: string; uri: string; error: string }
  | { type: "complete"; versionId: string; summary: string; versionNumber: number }
  | { type: "error"; message: string }
  | { type: "cancelled"; message?: string }
  | { type: "brain_context_start"; inputTokens: number }
  | { type: "brain_context_line"; line: string }
  | { type: "brain_calling" }
  | { type: "prompt_enhance_start" }
  | { type: "prompt_enhanced"; original: string; enhanced: string }
  | { type: "llm_thinking_chunk"; phase: "enhance" | "brain"; chunk: string }
  | { type: "llm_code_output_start" }
  | {
      type: "change_manifest";
      manifest: ChangeManifest;
    }
  | { type: "brain_stream_chunk"; chunk: string }
  | {
      type: "brain_decision";
      summary: string;
      files: string[];
      assets: { name: string; uri: string; regenerate: boolean; format?: string }[];
    }
  | { type: "brain_token_usage"; inputTokens: number; outputTokens: number }
  | {
      type: "node_started";
      node: string;
      label: string;
      phase: "code" | "assets";
      detail?: string;
    }
  | {
      type: "node_completed";
      node: string;
      label: string;
      phase: "code" | "assets";
      detail?: string;
    };

export interface GenerationNodeStep {
  node: string;
  label: string;
  phase: "code" | "assets";
  status: "running" | "done";
}

export interface GenerationLiveState {
  plannedFiles: string[];
  visibleFiles: string[];
  fileChangeTypes: Record<string, FileChangeType>;
  fileContents: Record<string, string>;
  filePreviousContents: Record<string, string>;
  completedFiles: string[];
  writingFilePath: string | null;
  plannedAssets: { name: string; uri: string; regenerate: boolean; format?: string }[];
  generatingAssetUri: string | null;
  completedAssetUris: string[];
  lastFileWritten: string | null;
  /** LangGraph node pipeline progress. */
  nodeSteps: GenerationNodeStep[];
  /** File/asset delta summary for the current generation run. */
  changeManifest: ChangeManifest | null;
}

export type ProgressCallback = (event: GenerationProgressEvent) => void | Promise<void>;

export function formatSseEvent(event: GenerationProgressEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export function createSseStream(
  handler: (
    send: (event: GenerationProgressEvent) => void | Promise<void>
  ) => Promise<void>,
  options?: { signal?: AbortSignal }
): Response {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = async (event: GenerationProgressEvent) => {
        controller.enqueue(encoder.encode(formatSseEvent(event)));
        await new Promise<void>((resolve) => setImmediate(resolve));
      };

      const onAbort = () => {
        void send({ type: "cancelled", message: "Generation cancelled" }).finally(() => {
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      };

      if (options?.signal) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        await handler(send);
      } catch (error) {
        if (options?.signal?.aborted) {
          await send({ type: "cancelled", message: "Generation cancelled" });
        } else {
          await send({
            type: "error",
            message: error instanceof Error ? error.message : "Generation failed",
          });
        }
      } finally {
        options?.signal?.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(readable, { headers: SSE_HEADERS });
}
