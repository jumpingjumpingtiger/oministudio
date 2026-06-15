export function buildAssetPublicPath(
  projectId: string,
  type: string,
  assetId: string
): string {
  return `/api/data/project/assets/${projectId}/${type}/${assetId}.png`;
}

export function getAssetPublicPath(
  projectId: string,
  asset: { id: string; type?: string; url?: string }
): string {
  if (asset.url?.startsWith("/api/")) {
    return asset.url;
  }
  if (asset.id) {
    return buildAssetPublicPath(projectId, asset.type || "img", asset.id);
  }
  return asset.url || "";
}

export function toAbsoluteUrl(path: string, origin?: string): string {
  if (!path) return path;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = origin || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function normalizeLegacyAssetUrl(url: string, projectId: string): string {
  const legacyMatch = url.match(/^\/api\/assets\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (legacyMatch) {
    const [, pid, type, assetId] = legacyMatch;
    if (pid === projectId) {
      return buildAssetPublicPath(projectId, type, assetId);
    }
  }
  return url;
}
