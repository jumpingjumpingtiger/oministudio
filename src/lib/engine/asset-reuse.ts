import type { GeneratedFile, GeneratedAsset } from "@/lib/types";
import type { UriCsvRow } from "@/lib/storage";
import { parseImageAssetFormat } from "@/lib/asset-format";

const ASSET_URI_PATTERN = /asset:\/\/(img|text|audio|video)\/[a-zA-Z0-9_-]+/g;

function assetUri(asset: Pick<GeneratedAsset, "uri" | "type" | "name">): string {
  return asset.uri || `asset://${asset.type}/${asset.name}`;
}

/** Keep generation prompts for reused assets when Brain omits them in delta output. */
function resolveReusePrompt(
  asset: GeneratedAsset,
  existing: UriCsvRow | undefined
): string {
  const incoming = (asset.prompt || "").trim();
  if (incoming) return asset.prompt;
  if (asset.regenerate === false && existing?.prompt?.trim()) {
    return existing.prompt;
  }
  return asset.prompt || "";
}

export function findReferencedAssetUris(files: GeneratedFile[]): Set<string> {
  const uris = new Set<string>();
  for (const file of files) {
    for (const match of file.content.matchAll(ASSET_URI_PATTERN)) {
      uris.add(match[0]);
    }
  }
  return uris;
}

/** Detect asset URIs in code — asset:// placeholders and baked /api/data URLs from prior versions. */
export function findAssetsReferencedInCode(
  files: GeneratedFile[],
  existingUriRows: UriCsvRow[]
): Set<string> {
  const uris = findReferencedAssetUris(files);
  const combined = files.map((f) => f.content).join("\n");

  for (const row of existingUriRows) {
    if (!row.uri) continue;
    if (combined.includes(row.uri)) {
      uris.add(row.uri);
      continue;
    }
    if (row.url && combined.includes(row.url)) {
      uris.add(row.uri);
      continue;
    }
    if (row.assetId && combined.includes(row.assetId)) {
      uris.add(row.uri);
    }
  }

  return uris;
}

/**
 * Normalize missing regenerate flags only. Brain LLM's explicit true/false is authoritative
 * (Brain decides reuse vs regenerate; platform dispatch follows that flag).
 */
export function normalizeAssetRegenerateFlags(
  assets: GeneratedAsset[],
  existingUriRows: UriCsvRow[]
): GeneratedAsset[] {
  const existingByUri = new Map(existingUriRows.map((r) => [r.uri, r]));

  return assets.map((asset) => {
    const uri = assetUri(asset);
    const existing = existingByUri.get(uri);
    const format =
      asset.format ||
      (existing?.format ? parseImageAssetFormat(existing.format) : undefined);
    const next: GeneratedAsset = {
      ...asset,
      uri,
      ...(format ? { format } : {}),
    };

    if (asset.regenerate === false || asset.regenerate === true) {
      if (asset.regenerate === false) {
        const prompt = resolveReusePrompt(asset, existing);
        return prompt !== asset.prompt ? { ...next, prompt } : next;
      }
      return next;
    }

    if (existing?.assetId && existing.prompt.trim() === (asset.prompt || "").trim()) {
      return { ...next, regenerate: false, prompt: existing.prompt };
    }
    return { ...next, regenerate: true };
  });
}

/**
 * Safety net when Brain omits assets still referenced in code — carry forward from the
 * previous manifest with regenerate:false (implicit reuse). Detects both asset:// URIs
 * and baked /api/data URLs from prior asset resolution passes.
 */
export function mergeBrainAssetsWithExisting(
  brainAssets: GeneratedAsset[],
  existingUriRows: UriCsvRow[],
  codeFiles: GeneratedFile[]
): GeneratedAsset[] {
  const referencedUris = findAssetsReferencedInCode(codeFiles, existingUriRows);
  const existingByUri = new Map(existingUriRows.map((r) => [r.uri, r]));
  const merged = new Map<string, GeneratedAsset>();

  for (const asset of brainAssets) {
    const uri = assetUri(asset);
    const existing = existingByUri.get(uri);
    merged.set(uri, {
      ...asset,
      uri,
      prompt: resolveReusePrompt(asset, existing),
    });
  }

  for (const uri of referencedUris) {
    if (merged.has(uri)) continue;
    const existing = existingByUri.get(uri);
    if (!existing) continue;

    merged.set(uri, {
      order: existing.order,
      name: existing.name,
      type: (existing.type || "img") as GeneratedAsset["type"],
      uri: existing.uri,
      prompt: existing.prompt,
      regenerate: false,
      format: parseImageAssetFormat(existing.format),
    });
  }

  const list = [...merged.values()].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name)
  );

  return normalizeAssetRegenerateFlags(list, existingUriRows);
}

export function formatExistingAssetsContext(rows: UriCsvRow[]): string {
  if (!rows.length) return "";
  const lines = rows.map(
    (r) =>
      `- ${r.uri} (name: ${r.name}, format: ${r.format || "png"}, prompt: ${r.prompt.slice(0, 120)}${r.prompt.length > 120 ? "..." : ""})`
  );
  return `\n\nExisting assets from the previous version (YOU must set regenerate true/false per asset; platform follows your decision):\n${lines.join("\n")}`;
}
