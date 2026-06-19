export type FileChangeType = "new" | "modified" | "unchanged";

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
      assets: { name: string; uri: string; regenerate: boolean }[];
    }
  | { type: "asset_generating"; name: string; uri: string; index: number; total: number }
  | { type: "asset_generated"; name: string; uri: string; assetId: string; url: string }
  | { type: "asset_reused"; name: string; uri: string; assetId: string; url: string }
  | { type: "asset_failed"; name: string; uri: string; error: string }
  | { type: "complete"; versionId: string; summary: string; versionNumber: number }
  | { type: "error"; message: string };

export interface GenerationLiveState {
  plannedFiles: string[];
  visibleFiles: string[];
  fileChangeTypes: Record<string, FileChangeType>;
  fileContents: Record<string, string>;
  filePreviousContents: Record<string, string>;
  completedFiles: string[];
  writingFilePath: string | null;
  plannedAssets: { name: string; uri: string; regenerate: boolean }[];
  generatingAssetUri: string | null;
  completedAssetUris: string[];
  lastFileWritten: string | null;
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
  ) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = async (event: GenerationProgressEvent) => {
        controller.enqueue(encoder.encode(formatSseEvent(event)));
        await new Promise<void>((resolve) => setImmediate(resolve));
      };

      try {
        await handler(send);
      } catch (error) {
        await send({
          type: "error",
          message: error instanceof Error ? error.message : "Generation failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, { headers: SSE_HEADERS });
}
