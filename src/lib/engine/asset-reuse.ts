import type { GeneratedAsset } from "@/lib/types";
import type { UriCsvRow } from "@/lib/storage";

export function normalizeAssetRegenerateFlags(
  assets: GeneratedAsset[],
  existingUriRows: UriCsvRow[]
): GeneratedAsset[] {
  const existingByUri = new Map(existingUriRows.map((r) => [r.uri, r]));

  return assets.map((asset) => {
    const existing = existingByUri.get(asset.uri);
    if (asset.regenerate === false || asset.regenerate === true) {
      return asset;
    }
    if (existing && existing.prompt.trim() === asset.prompt.trim() && existing.assetId) {
      return { ...asset, regenerate: false };
    }
    return { ...asset, regenerate: true };
  });
}

export function formatExistingAssetsContext(rows: UriCsvRow[]): string {
  if (!rows.length) return "";
  const lines = rows.map(
    (r) =>
      `- ${r.uri} (name: ${r.name}, prompt: ${r.prompt.slice(0, 120)}${r.prompt.length > 120 ? "..." : ""})`
  );
  return `\n\nExisting assets from the previous version (reuse when prompt is unchanged):\n${lines.join("\n")}`;
}
