import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";

const DATA_ROOT = path.join(process.cwd(), ".data");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

export function isLocalDataProxyEnabled(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  return process.env.ENABLE_LOCAL_DATA_PROXY === "true";
}

export function buildDataUrl(relativePath: string): string {
  const normalized = relativePath.replace(/^\/+/, "");
  return `/api/data/${normalized}`;
}

export function buildCodeDataUrl(
  projectId: string,
  versionId: string,
  filePath: string
): string {
  return buildDataUrl(`project/code/${projectId}/${versionId}/${filePath}`);
}

export function buildAssetDataUrl(
  projectId: string,
  type: string,
  assetId: string,
  ext = "png"
): string {
  return buildDataUrl(`project/assets/${projectId}/${type}/${assetId}.${ext}`);
}

export function getCodeBaseHref(projectId: string, versionId: string): string {
  return buildDataUrl(`project/code/${projectId}/${versionId}/`);
}

function resolveSafePath(segments: string[]): string | null {
  const joined = path.join(DATA_ROOT, ...segments);
  const resolved = path.resolve(joined);
  const root = path.resolve(DATA_ROOT);

  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return null;
  }
  return resolved;
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

async function findAssetFile(
  absolutePath: string,
  segments: string[]
): Promise<string | null> {
  if (existsSync(absolutePath)) return absolutePath;

  const last = segments[segments.length - 1];
  if (!last || last.includes(".")) return null;

  const dir = path.dirname(absolutePath);
  for (const ext of [".png", ".jpg", ".jpeg", ".webp", ".gif"]) {
    const candidate = path.join(dir, `${last}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export interface DataFileResult {
  buffer: Buffer;
  mimeType: string;
  filePath: string;
}

export async function readDataFile(segments: string[]): Promise<DataFileResult | null> {
  if (!segments.length) return null;

  let absolutePath = resolveSafePath(segments);
  if (!absolutePath) return null;

  if (!existsSync(absolutePath)) {
    const isAssetPath = segments[0] === "project" && segments[1] === "assets";
    if (isAssetPath) {
      absolutePath = await findAssetFile(absolutePath, segments);
      if (!absolutePath) return null;
    } else {
      return null;
    }
  }

  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) return null;

  const buffer = await fs.readFile(absolutePath);
  return {
    buffer,
    mimeType: getMimeType(absolutePath),
    filePath: absolutePath,
  };
}

export function injectBaseTag(html: string, baseHref: string): string {
  const baseTag = `<base href="${baseHref}">`;
  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>\n  ${baseTag}`);
  }
  if (html.includes("<head ")) {
    return html.replace(/<head[^>]*>/, (match) => `${match}\n  ${baseTag}`);
  }
  return `${baseTag}\n${html}`;
}

/** Center Phaser canvas inside preview iframe and avoid black letterbox bars */
export function injectPreviewStyles(html: string): string {
  const style = `<style>
html, body {
  margin: 0; padding: 0; width: 100%; height: 100%;
  overflow: hidden; background: #eef1f5;
  display: flex; align-items: center; justify-content: center;
}
canvas { display: block; margin: 0 auto; }
</style>`;
  if (html.includes("</head>")) {
    return html.replace("</head>", `${style}\n</head>`);
  }
  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>${style}`);
  }
  return `${style}\n${html}`;
}
