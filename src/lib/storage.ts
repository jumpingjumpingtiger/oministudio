import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { buildAssetDataUrl } from "@/lib/data-proxy";
import type { GeneratedAsset } from "@/lib/types";

const DATA_ROOT = path.join(process.cwd(), ".data");

export type AssetType = "img" | "text" | "audio" | "video";

export function getCodeDir(projectId: string, versionId: string): string {
  return path.join(DATA_ROOT, "project", "code", projectId, versionId);
}

export function getAssetsDir(projectId: string): string {
  return path.join(DATA_ROOT, "project", "assets", projectId);
}

export function getAssetTypeDir(projectId: string, type: AssetType): string {
  return path.join(getAssetsDir(projectId), type);
}

export function getVersionAssetsDir(projectId: string, versionId: string): string {
  return path.join(getAssetsDir(projectId), versionId);
}

export function getUriCsvPath(projectId: string, versionId: string): string {
  return path.join(getVersionAssetsDir(projectId, versionId), "uri.csv");
}

export function getPendingAssetsPath(projectId: string, versionId: string): string {
  return path.join(getVersionAssetsDir(projectId, versionId), "pending-assets.json");
}

export function buildAssetUrl(
  projectId: string,
  type: AssetType,
  assetId: string,
  ext = "png"
): string {
  return buildAssetDataUrl(projectId, type, assetId, ext);
}

export async function ensureDir(dirPath: string): Promise<void> {
  if (!existsSync(dirPath)) {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

export async function writeCodeFile(
  projectId: string,
  versionId: string,
  filePath: string,
  content: string
): Promise<void> {
  const baseDir = getCodeDir(projectId, versionId);
  const fullPath = path.join(baseDir, filePath);
  await ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, content, "utf-8");
}

export async function readCodeFile(
  projectId: string,
  versionId: string,
  filePath: string
): Promise<string | null> {
  const fullPath = path.join(getCodeDir(projectId, versionId), filePath);
  if (!existsSync(fullPath)) return null;
  return fs.readFile(fullPath, "utf-8");
}

export async function deleteCodeFile(
  projectId: string,
  versionId: string,
  filePath: string
): Promise<void> {
  const fullPath = path.join(getCodeDir(projectId, versionId), filePath);
  if (existsSync(fullPath)) {
    await fs.unlink(fullPath);
  }
}

export async function listCodeFiles(
  projectId: string,
  versionId: string,
  subDir = ""
): Promise<string[]> {
  const dir = path.join(getCodeDir(projectId, versionId), subDir);
  if (!existsSync(dir)) return [];

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = subDir ? `${subDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listCodeFiles(projectId, versionId, relativePath)));
    } else {
      files.push(relativePath);
    }
  }

  return files.sort();
}

export async function writeAssetFile(
  projectId: string,
  type: AssetType,
  assetId: string,
  buffer: Buffer,
  ext = "png"
): Promise<{ url: string; filePath: string }> {
  const dir = getAssetTypeDir(projectId, type);
  await ensureDir(dir);
  const filename = `${assetId}.${ext}`;
  const fullPath = path.join(dir, filename);
  await fs.writeFile(fullPath, buffer);
  const filePath = `${type}/${filename}`;
  const url = buildAssetUrl(projectId, type, assetId, ext);
  return { url, filePath };
}

export async function readAssetFile(
  projectId: string,
  type: AssetType,
  assetId: string,
  ext = "png"
): Promise<Buffer | null> {
  const dir = getAssetTypeDir(projectId, type);
  const primary = path.join(dir, `${assetId}.${ext}`);
  if (existsSync(primary)) return fs.readFile(primary);

  for (const fallback of ["png", "jpeg", "jpg"]) {
    if (fallback === ext) continue;
    const candidate = path.join(dir, `${assetId}.${fallback}`);
    if (existsSync(candidate)) return fs.readFile(candidate);
  }
  return null;
}

export interface UriCsvRow {
  order: number;
  name: string;
  type: string;
  uri: string;
  url: string;
  assetId: string;
  prompt: string;
  regenerate?: boolean;
  format?: string;
}

export async function writeUriCsv(
  projectId: string,
  versionId: string,
  rows: UriCsvRow[]
): Promise<void> {
  const dir = getVersionAssetsDir(projectId, versionId);
  await ensureDir(dir);
  const header = "order,name,type,uri,url,assetId,prompt,regenerate,format";
  const lines = rows.map((row) => {
    const encodedPrompt = Buffer.from(row.prompt).toString("base64");
    const regenerate = row.regenerate === false ? "false" : "true";
    const format = row.format || "png";
    return `${row.order},${escapeCsv(row.name)},${row.type},${escapeCsv(row.uri)},${escapeCsv(row.url)},${escapeCsv(row.assetId)},${encodedPrompt},${regenerate},${format}`;
  });
  await fs.writeFile(getUriCsvPath(projectId, versionId), [header, ...lines].join("\n"), "utf-8");
}

export async function readUriCsv(
  projectId: string,
  versionId: string
): Promise<UriCsvRow[]> {
  const csvPath = getUriCsvPath(projectId, versionId);
  if (!existsSync(csvPath)) return [];
  const content = await fs.readFile(csvPath, "utf-8");
  const lines = content.trim().split("\n");
  if (lines.length <= 1) return [];

  const header = lines[0];
  const hasAssetId = header.includes("assetId");
  const hasRegenerate = header.includes("regenerate");
  const hasFormat = header.includes("format");

  return lines.slice(1).map((line) => {
    const parts = parseCsvLine(line);
    const promptIdx = hasAssetId ? 6 : 5;
    const regenerateIdx = hasRegenerate ? (hasAssetId ? 7 : 6) : -1;
    const formatIdx = hasFormat
      ? regenerateIdx >= 0
        ? regenerateIdx + 1
        : promptIdx + 1
      : -1;
    return {
      order: parseInt(parts[0] || "0", 10),
      name: parts[1] || "",
      type: parts[2] || "img",
      uri: parts[3] || "",
      url: parts[4] || "",
      assetId: hasAssetId ? (parts[5] || "") : "",
      prompt: Buffer.from(parts[promptIdx] || "", "base64").toString("utf-8"),
      regenerate:
        regenerateIdx >= 0 ? parts[regenerateIdx] !== "false" : undefined,
      format: formatIdx >= 0 ? parts[formatIdx] || "png" : "png",
    };
  });
}

export async function copyUriCsv(
  projectId: string,
  fromVersionId: string,
  toVersionId: string
): Promise<void> {
  const rows = await readUriCsv(projectId, fromVersionId);
  if (rows.length > 0) {
    await writeUriCsv(projectId, toVersionId, rows);
  }
}

export async function upsertUriCsvRow(
  projectId: string,
  versionId: string,
  row: UriCsvRow
): Promise<void> {
  const rows = await readUriCsv(projectId, versionId);
  const index = rows.findIndex((r) => r.uri === row.uri || r.name === row.name);
  if (index >= 0) {
    rows[index] = row;
  } else {
    rows.push(row);
  }
  rows.sort((a, b) => a.order - b.order);
  await writeUriCsv(projectId, versionId, rows);
}

export async function replaceUriCsvAsset(
  projectId: string,
  versionId: string,
  uri: string,
  newRow: UriCsvRow
): Promise<void> {
  const rows = await readUriCsv(projectId, versionId);
  const index = rows.findIndex((r) => r.uri === uri);
  if (index >= 0) {
    rows[index] = { ...newRow, order: rows[index].order };
  } else {
    rows.push(newRow);
  }
  await writeUriCsv(projectId, versionId, rows);
}

export async function writePendingAssets(
  projectId: string,
  versionId: string,
  assets: GeneratedAsset[],
  meta?: { versionNumber: number }
): Promise<void> {
  const dir = getVersionAssetsDir(projectId, versionId);
  await ensureDir(dir);
  await fs.writeFile(
    getPendingAssetsPath(projectId, versionId),
    JSON.stringify({ assets, meta }, null, 2),
    "utf-8"
  );
}

export async function readPendingAssets(
  projectId: string,
  versionId: string
): Promise<GeneratedAsset[]> {
  const payload = await readPendingAssetsPayload(projectId, versionId);
  return payload.assets;
}

export async function readPendingAssetsPayload(
  projectId: string,
  versionId: string
): Promise<{
  assets: GeneratedAsset[];
  meta?: { versionNumber: number };
}> {
  const filePath = getPendingAssetsPath(projectId, versionId);
  if (!existsSync(filePath)) return { assets: [] };
  const content = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(content);
  if (Array.isArray(parsed)) {
    return { assets: parsed as GeneratedAsset[] };
  }
  return {
    assets: (parsed.assets || []) as GeneratedAsset[],
    meta: parsed.meta,
  };
}

export async function deletePendingAssets(
  projectId: string,
  versionId: string
): Promise<void> {
  const filePath = getPendingAssetsPath(projectId, versionId);
  if (existsSync(filePath)) {
    await fs.unlink(filePath);
  }
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export async function copyCodeVersion(
  projectId: string,
  fromVersionId: string,
  toVersionId: string
): Promise<void> {
  const files = await listCodeFiles(projectId, fromVersionId);
  for (const file of files) {
    const content = await readCodeFile(projectId, fromVersionId, file);
    if (content !== null) {
      await writeCodeFile(projectId, toVersionId, file, content);
    }
  }
}

export async function initProjectStorage(projectId: string): Promise<void> {
  await ensureDir(getAssetsDir(projectId));
  for (const type of ["img", "text", "audio"] as AssetType[]) {
    await ensureDir(getAssetTypeDir(projectId, type));
  }
}

// Legacy helpers kept for backward compatibility
export async function readImageAsset(
  projectId: string,
  filename: string
): Promise<Buffer | null> {
  const fullPath = path.join(getAssetTypeDir(projectId, "img"), path.basename(filename));
  if (!existsSync(fullPath)) return null;
  return fs.readFile(fullPath);
}

export async function listImageAssets(projectId: string): Promise<string[]> {
  const dir = getAssetTypeDir(projectId, "img");
  if (!existsSync(dir)) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name).sort();
}
