import { deflateSync } from "zlib";
import { prisma } from "@/lib/db";
import { isImageLlmConfigured } from "@/lib/engine/llm-config";
import { generateImageBuffer } from "@/lib/engine/llm-providers/image-provider";
import { writeAssetFile, type AssetType } from "@/lib/storage";
import type { GeneratedAsset } from "@/lib/types";

export interface DispatchResult {
  order: number;
  assetName: string;
  assetId: string;
  uri: string;
  type: string;
  url: string;
  prompt: string;
  regenerate: boolean;
  reused: boolean;
  success: boolean;
  error?: string;
}

async function findExistingAsset(projectId: string, uri: string) {
  return prisma.asset.findFirst({
    where: { projectId, uri },
    orderBy: { createdAt: "desc" },
  });
}

async function reuseExistingAsset(
  projectId: string,
  asset: GeneratedAsset
): Promise<DispatchResult | null> {
  const uri = asset.uri || `asset://${asset.type}/${asset.name}`;
  const existing = await findExistingAsset(projectId, uri);

  if (!existing?.url || !existing.filePath) {
    return null;
  }

  return {
    order: asset.order,
    assetName: asset.name,
    assetId: existing.id,
    uri,
    type: asset.type,
    url: existing.url,
    prompt: asset.prompt,
    regenerate: false,
    reused: true,
    success: true,
  };
}

async function generateImageAsset(
  projectId: string,
  asset: GeneratedAsset
): Promise<DispatchResult> {
  const uri = asset.uri || `asset://${asset.type}/${asset.name}`;

  const record = await prisma.asset.create({
    data: {
      projectId,
      name: asset.name,
      type: asset.type,
      uri,
      prompt: asset.prompt,
    },
  });

  let buffer: Buffer;
  let success = true;
  let error: string | undefined;

  if (!isImageLlmConfigured()) {
    buffer = createPlaceholderPng(asset.name);
  } else {
    try {
      buffer = await generateImageBuffer(asset.prompt);
    } catch (err) {
      buffer = createPlaceholderPng(asset.name);
      success = false;
      error = err instanceof Error ? err.message : "Image generation failed";
    }
  }

  const { url, filePath } = await writeAssetFile(
    projectId,
    asset.type as AssetType,
    record.id,
    buffer
  );

  await prisma.asset.update({
    where: { id: record.id },
    data: { url, filePath },
  });

  return {
    order: asset.order,
    assetName: asset.name,
    assetId: record.id,
    uri,
    type: asset.type,
    url,
    prompt: asset.prompt,
    regenerate: true,
    reused: false,
    success,
    error,
  };
}

export async function dispatchAssets(
  projectId: string,
  assets: GeneratedAsset[],
  onProgress?: (event:
    | { type: "generating"; name: string; uri: string; index: number; total: number }
    | { type: "generated"; name: string; uri: string; assetId: string; url: string; result: DispatchResult }
    | { type: "reused"; name: string; uri: string; assetId: string; url: string; result: DispatchResult }
    | { type: "failed"; name: string; uri: string; error: string }
  ) => void | Promise<void>
): Promise<DispatchResult[]> {
  const imageAssets = assets.filter((a) => a.type === "img");
  const results: DispatchResult[] = [];

  for (let i = 0; i < imageAssets.length; i++) {
    const asset = imageAssets[i];
    const uri = asset.uri || `asset://${asset.type}/${asset.name}`;
    const shouldRegenerate = asset.regenerate !== false;

    if (!shouldRegenerate) {
      const reused = await reuseExistingAsset(projectId, asset);
      if (reused) {
        results.push(reused);
        await onProgress?.({
          type: "reused",
          name: asset.name,
          uri,
          assetId: reused.assetId,
          url: reused.url,
          result: reused,
        });
        continue;
      }
    }

    await onProgress?.({
      type: "generating",
      name: asset.name,
      uri,
      index: i + 1,
      total: imageAssets.length,
    });

    const result = await generateImageAsset(projectId, asset);
    results.push(result);

    if (result.success) {
      await onProgress?.({
        type: "generated",
        name: asset.name,
        uri,
        assetId: result.assetId,
        url: result.url,
        result,
      });
    } else {
      await onProgress?.({
        type: "failed",
        name: asset.name,
        uri,
        error: result.error || "Unknown error",
      });
    }
  }

  return results;
}

function createPlaceholderPng(name: string): Buffer {
  const width = 128;
  const height = 128;
  const hash = simpleHash(name);
  const r = hash & 0xff;
  const g = (hash >> 8) & 0xff;
  const b = (hash >> 16) & 0xff;
  return createMinimalPng(width, height, r, g, b);
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function createMinimalPng(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number
): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawData = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    rawData[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3;
      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
    }
  }

  const compressed = deflateSync(rawData);
  const chunks = [
    createChunk("IHDR", ihdr),
    createChunk("IDAT", compressed),
    createChunk("IEND", Buffer.alloc(0)),
  ];
  return Buffer.concat([signature, ...chunks]);
}

function createChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
