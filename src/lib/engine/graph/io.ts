import type { GenerationProgressEvent, FileChangeType } from "@/lib/generation-progress";
import type { dispatchAssets } from "@/lib/engine/dispatch";

const STREAM_CHUNK_SIZE = 48;
const STREAM_DELAY_MS = 10;

type Emit = (event: GenerationProgressEvent) => Promise<void> | void;

/** Stream a file to the client in chunks (typing effect) then persist signal. */
export async function streamFileToClient(
  emit: Emit,
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
      await emit({ type: "file_content_progress", path, content: content.slice(0, end) });
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

type DispatchResult = Awaited<ReturnType<typeof dispatchAssets>>[number];

export function buildAssetUrlMap(dispatchResults: DispatchResult[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const result of dispatchResults) {
    map[result.uri] = result.url;
    map[`asset://${result.type}/${result.assetName}`] = result.url;
  }
  return map;
}

export function toUriRow(result: DispatchResult) {
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
