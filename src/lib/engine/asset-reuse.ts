import type { GeneratedAsset } from "@/lib/types";
import type { UriCsvRow } from "@/lib/storage";
import { parseImageAssetFormat } from "@/lib/asset-format";

export function normalizeAssetRegenerateFlags(
  assets: GeneratedAsset[],
  existingUriRows: UriCsvRow[]
): GeneratedAsset[] {
  const existingByUri = new Map(existingUriRows.map((r) => [r.uri, r]));

  return assets.map((asset) => {
    const existing = existingByUri.get(asset.uri);
    const format = asset.format || (existing?.format ? parseImageAssetFormat(existing.format) : undefined);
    const next = format ? { ...asset, format } : asset;

    if (asset.regenerate === false || asset.regenerate === true) {
      return next;
    }
    if (existing && existing.prompt.trim() === asset.prompt.trim() && existing.assetId) {
      return { ...next, regenerate: false };
    }
    return { ...next, regenerate: true };
  });
}

export function formatExistingAssetsContext(rows: UriCsvRow[]): string {
  if (!rows.length) return "";
  const lines = rows.map(
    (r) =>
      `- ${r.uri} (name: ${r.name}, format: ${r.format || "png"}, prompt: ${r.prompt.slice(0, 120)}${r.prompt.length > 120 ? "..." : ""})`
  );
  return `\n\nExisting assets from the previous version (reuse when prompt is unchanged):\n${lines.join("\n")}`;
}
