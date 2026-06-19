/** Supported image asset formats from Brain LLM / uri.csv */
export type ImageAssetFormat = "png" | "jpeg" | "jpg";

export function parseImageAssetFormat(value?: string | null): ImageAssetFormat {
  const normalized = (value ?? "png").trim().toLowerCase();
  if (normalized === "jpg") return "jpg";
  if (normalized === "jpeg") return "jpeg";
  return "png";
}

export function imageFormatToExtension(format: ImageAssetFormat): string {
  return format;
}

export function formatNeedsPngNormalize(format: ImageAssetFormat): boolean {
  return format === "png";
}

export function formatMimeType(format: ImageAssetFormat): string {
  if (format === "jpg" || format === "jpeg") return "image/jpeg";
  return "image/png";
}

export function extensionFromUrl(url: string): string | null {
  const match = url.match(/\.([a-z0-9]+)(?:\?|$)/i);
  return match ? match[1].toLowerCase() : null;
}
