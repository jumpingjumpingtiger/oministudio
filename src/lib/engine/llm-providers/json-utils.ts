import { jsonrepair } from "jsonrepair";
import type { BrainLlmResult, GeneratedAsset, GeneratedFile } from "@/lib/types";
import { parseImageAssetFormat } from "@/lib/asset-format";

export function extractJsonFromText(text: string): string {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

export function parseJsonRobust<T>(text: string): T {
  const extracted = extractJsonFromText(text);

  try {
    return JSON.parse(extracted) as T;
  } catch {
    try {
      return JSON.parse(jsonrepair(extracted)) as T;
    } catch (repairError) {
      const message =
        repairError instanceof Error ? repairError.message : "JSON repair failed";
      throw new Error(`Failed to parse LLM JSON response: ${message}`);
    }
  }
}

interface RawBrainFile {
  path: string;
  content?: string;
  content_base64?: string;
}

interface RawBrainAsset {
  order?: number;
  name: string;
  type?: string;
  uri?: string;
  prompt?: string;
  width?: number;
  height?: number;
  regenerate?: boolean;
  format?: string;
}

interface RawBrainResult {
  summary?: string;
  files?: RawBrainFile[];
  assets?: RawBrainAsset[];
}

function isValidCodeContent(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  if (replacementCount > 0) return false;
  const controlCount = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
  return controlCount < Math.max(5, text.length * 0.05);
}

function isLikelyBase64(value: string): boolean {
  const cleaned = value.replace(/\s/g, "");
  if (cleaned.length < 16) return false;
  if (
    cleaned.includes("<!DOCTYPE") ||
    cleaned.includes("<html") ||
    cleaned.includes("function ") ||
    cleaned.includes("export ")
  ) {
    return false;
  }
  return /^[A-Za-z0-9+/=_-]+$/.test(cleaned);
}

function decodeBase64Utf8(value: string): string {
  const cleaned = value.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = cleaned + "=".repeat((4 - (cleaned.length % 4)) % 4);

  if (!/^[A-Za-z0-9+/=]+$/.test(padded)) {
    throw new Error("Invalid base64 characters");
  }

  return Buffer.from(padded, "base64").toString("utf-8");
}

function decodeFileContent(file: RawBrainFile): string {
  const candidates: string[] = [];

  if (file.content !== undefined && file.content.length > 0) {
    candidates.push(file.content);
  }

  if (file.content_base64) {
    if (isLikelyBase64(file.content_base64)) {
      try {
        candidates.push(decodeBase64Utf8(file.content_base64));
      } catch {
        // ignore invalid base64
      }
    } else {
      candidates.push(file.content_base64);
    }
  }

  for (const candidate of candidates) {
    if (isValidCodeContent(candidate)) {
      return candidate;
    }
  }

  if (candidates.length > 0) {
    return candidates[0];
  }

  throw new Error(`File "${file.path}" is missing content`);
}

export function parseBrainResult(content: string): BrainLlmResult {
  const parsed = parseJsonRobust<RawBrainResult>(content);

  if (!parsed.files || !Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error("Invalid Brain LLM response: missing files array");
  }

  const files: GeneratedFile[] = parsed.files.map((file) => {
    if (!file.path) {
      throw new Error("Invalid Brain LLM response: file missing path");
    }
    return {
      path: file.path,
      content: decodeFileContent(file),
    };
  });

  const assets: GeneratedAsset[] = (parsed.assets || []).map((asset, index) => ({
    order: asset.order ?? index,
    name: asset.name,
    type: (asset.type || "img") as GeneratedAsset["type"],
    uri: asset.uri || `asset://${asset.type || "img"}/${asset.name}`,
    prompt: asset.prompt || "",
    width: asset.width,
    height: asset.height,
    regenerate: asset.regenerate,
    format: parseImageAssetFormat(asset.format),
  }));

  return {
    summary: parsed.summary || "Game updated",
    files,
    assets,
  };
}
