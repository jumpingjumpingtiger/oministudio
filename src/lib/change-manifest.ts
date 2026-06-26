import type { GeneratedAsset, GeneratedFile } from "@/lib/types";
import type { UriCsvRow } from "@/lib/storage";

export interface FileChangeManifest {
  added: string[];
  modified: string[];
  deleted: string[];
  unchanged: string[];
}

export interface AssetChangeEntry {
  name: string;
  uri: string;
  regenerate?: boolean;
}

export interface AssetChangeManifest {
  added: AssetChangeEntry[];
  modified: AssetChangeEntry[];
  deleted: AssetChangeEntry[];
  reused: AssetChangeEntry[];
}

export interface ChangeManifest {
  files: FileChangeManifest;
  assets: AssetChangeManifest;
}

export const EMPTY_CHANGE_MANIFEST: ChangeManifest = {
  files: { added: [], modified: [], deleted: [], unchanged: [] },
  assets: { added: [], modified: [], deleted: [], reused: [] },
};

export function computeFileChanges(
  files: GeneratedFile[],
  previousPaths: string[],
  getPreviousContent: (path: string) => string | null | undefined
): FileChangeManifest {
  const currentPaths = new Set(files.map((f) => f.path));
  const previousSet = new Set(previousPaths);
  const result: FileChangeManifest = {
    added: [],
    modified: [],
    deleted: [],
    unchanged: [],
  };

  for (const path of previousPaths) {
    if (!currentPaths.has(path)) {
      result.deleted.push(path);
    }
  }

  for (const file of files) {
    if (!previousSet.has(file.path)) {
      result.added.push(file.path);
      continue;
    }
    const previous = getPreviousContent(file.path);
    if (previous === null || previous === undefined) {
      result.added.push(file.path);
    } else if (previous !== file.content) {
      result.modified.push(file.path);
    } else {
      result.unchanged.push(file.path);
    }
  }

  for (const key of Object.keys(result) as (keyof FileChangeManifest)[]) {
    result[key].sort((a, b) => a.localeCompare(b));
  }

  return result;
}

export function computeAssetChanges(
  mergedAssets: GeneratedAsset[],
  existingUriRows: UriCsvRow[]
): AssetChangeManifest {
  const existingByUri = new Map(existingUriRows.map((r) => [r.uri, r]));
  const mergedByUri = new Map(
    mergedAssets.map((a) => [a.uri || `asset://${a.type}/${a.name}`, a])
  );

  const result: AssetChangeManifest = {
    added: [],
    modified: [],
    deleted: [],
    reused: [],
  };

  for (const asset of mergedAssets) {
    const uri = asset.uri || `asset://${asset.type}/${asset.name}`;
    const entry: AssetChangeEntry = {
      name: asset.name,
      uri,
      regenerate: asset.regenerate !== false,
    };
    const existing = existingByUri.get(uri);
    if (!existing) {
      result.added.push(entry);
    } else if (asset.regenerate === false) {
      result.reused.push(entry);
    } else {
      result.modified.push(entry);
    }
  }

  for (const row of existingUriRows) {
    if (!mergedByUri.has(row.uri)) {
      result.deleted.push({ name: row.name, uri: row.uri });
    }
  }

  const sortByName = (a: AssetChangeEntry, b: AssetChangeEntry) =>
    a.name.localeCompare(b.name);
  result.added.sort(sortByName);
  result.modified.sort(sortByName);
  result.deleted.sort(sortByName);
  result.reused.sort(sortByName);

  return result;
}

export function mergeChangeManifests(
  base: ChangeManifest,
  patch: Partial<ChangeManifest>
): ChangeManifest {
  return {
    files: patch.files ?? base.files,
    assets: patch.assets ?? base.assets,
  };
}

export function formatChangeManifestForEnhancer(manifest: ChangeManifest): string {
  const lines: string[] = [];

  if (manifest.files.added.length) {
    lines.push(`  files added: ${manifest.files.added.join(", ")}`);
  }
  if (manifest.files.modified.length) {
    lines.push(`  files modified: ${manifest.files.modified.join(", ")}`);
  }
  if (manifest.files.deleted.length) {
    lines.push(`  files deleted: ${manifest.files.deleted.join(", ")}`);
  }
  if (manifest.assets.added.length) {
    lines.push(`  assets added: ${manifest.assets.added.map((a) => a.name).join(", ")}`);
  }
  if (manifest.assets.modified.length) {
    lines.push(`  assets modified: ${manifest.assets.modified.map((a) => a.name).join(", ")}`);
  }
  if (manifest.assets.deleted.length) {
    lines.push(`  assets deleted: ${manifest.assets.deleted.map((a) => a.name).join(", ")}`);
  }
  if (manifest.assets.reused.length) {
    lines.push(`  assets reused: ${manifest.assets.reused.map((a) => a.name).join(", ")}`);
  }

  return lines.length ? lines.join("\n") : "  (no recorded file/asset delta)";
}

export function formatChangeManifestText(manifest: ChangeManifest): string {
  const lines: string[] = [];

  const fileParts = [
    manifest.files.added.length ? `${manifest.files.added.length} added` : "",
    manifest.files.modified.length ? `${manifest.files.modified.length} modified` : "",
    manifest.files.deleted.length ? `${manifest.files.deleted.length} deleted` : "",
  ].filter(Boolean);

  if (fileParts.length) {
    lines.push(`Files: ${fileParts.join(", ")}`);
  }

  const assetParts = [
    manifest.assets.added.length ? `${manifest.assets.added.length} added` : "",
    manifest.assets.modified.length ? `${manifest.assets.modified.length} modified` : "",
    manifest.assets.deleted.length ? `${manifest.assets.deleted.length} deleted` : "",
    manifest.assets.reused.length ? `${manifest.assets.reused.length} reused` : "",
  ].filter(Boolean);

  if (assetParts.length) {
    lines.push(`Assets: ${assetParts.join(", ")}`);
  }

  return lines.join("\n");
}

export interface AssistantMessageFilesPayload {
  changeManifest?: ChangeManifest;
}

export function parseAssistantMessageFiles(filesJson: string): AssistantMessageFilesPayload {
  try {
    const parsed = JSON.parse(filesJson);
    if (parsed && typeof parsed === "object" && parsed.changeManifest) {
      return parsed as AssistantMessageFilesPayload;
    }
  } catch {
    // not structured assistant payload
  }
  return {};
}

export function encodeAssistantMessageFiles(manifest: ChangeManifest): string {
  return JSON.stringify({ changeManifest: manifest });
}
