import { buildAssetMap, resolveAssetUris } from "@/lib/asset-resolver";
import { normalizeLegacyAssetUrl } from "@/lib/utils/asset-url";
import {
  listCodeFiles,
  readCodeFile,
  readUriCsv,
  writeCodeFile,
} from "@/lib/storage";

export async function buildVersionAssetUrlMap(
  projectId: string,
  storageKey: string
): Promise<Record<string, string>> {
  const uriCsv = await readUriCsv(projectId, storageKey);
  const map = buildAssetMap(uriCsv);
  for (const key of Object.keys(map)) {
    map[key] = normalizeLegacyAssetUrl(map[key], projectId);
  }
  return map;
}

export interface ResyncVersionCodeOptions {
  /** Replace a stale baked-in asset URL after swap/regenerate */
  replaceUrl?: { from: string; to: string };
}

/**
 * Rewrites version code files so asset:// placeholders and baked /api/data/ URLs
 * match the current uri.csv manifest (e.g. after replace/regenerate in Assets panel).
 */
export async function resyncVersionCodeAssets(
  projectId: string,
  storageKey: string,
  options?: ResyncVersionCodeOptions
): Promise<number> {
  const assetUrlMap = await buildVersionAssetUrlMap(projectId, storageKey);
  const filePaths = await listCodeFiles(projectId, storageKey);
  let changedCount = 0;

  for (const filePath of filePaths) {
    const content = await readCodeFile(projectId, storageKey, filePath);
    if (content === null) continue;

    let updated = content;

    if (options?.replaceUrl) {
      const { from, to } = options.replaceUrl;
      if (from && to && from !== to) {
        updated = replaceBakedAssetUrl(updated, from, to, projectId);
      }
    }

    updated = resolveAssetUris(updated, assetUrlMap);

    if (updated !== content) {
      await writeCodeFile(projectId, storageKey, filePath, updated);
      changedCount++;
    }
  }

  return changedCount;
}

function replaceBakedAssetUrl(
  content: string,
  from: string,
  to: string,
  projectId: string
): string {
  const variants = new Set<string>([
    from,
    normalizeLegacyAssetUrl(from, projectId),
  ]);

  let result = content;
  for (const oldUrl of variants) {
    if (!oldUrl) continue;
    result = result.replaceAll(oldUrl, to);
  }
  return result;
}
