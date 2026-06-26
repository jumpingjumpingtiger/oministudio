import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { runExclusiveOnnx } from "@/lib/engine/native-onnx-lock";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngInspection {
  isValidPng: boolean;
  detectedFormat: string | null;
  /** Expected PNG (.png / image/png) but bytes are not a canonical real PNG. */
  isFakePng: boolean;
}

export interface PngNormalizeResult {
  buffer: Buffer;
  before: PngInspection;
  after: PngInspection;
  normalized: boolean;
}

export interface NormalizePngOptions {
  claimsPng?: boolean;
  force?: boolean;
}

interface PngChunkInfo {
  type: string;
  len: number;
  crcOk: boolean;
}

interface PngStructure {
  ok: boolean;
  chunks: PngChunkInfo[];
  hasIHDR: boolean;
  hasIDAT: boolean;
  hasIEND: boolean;
}

function hasPngSignature(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
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

/** Parse PNG chunk stream and verify CRC + required chunk types. */
export function parsePngStructure(buffer: Buffer): PngStructure {
  const chunks: PngChunkInfo[] = [];
  if (!hasPngSignature(buffer)) {
    return { ok: false, chunks, hasIHDR: false, hasIDAT: false, hasIEND: false };
  }

  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (len > buffer.length - offset - 12) {
      return {
        ok: false,
        chunks,
        hasIHDR: chunks.some((c) => c.type === "IHDR"),
        hasIDAT: chunks.some((c) => c.type === "IDAT"),
        hasIEND: false,
      };
    }

    const data = buffer.subarray(offset + 8, offset + 8 + len);
    const crcRead = buffer.readUInt32BE(offset + 8 + len);
    const crcCalc = crc32(Buffer.concat([Buffer.from(type), data]));
    chunks.push({ type, len, crcOk: crcRead === crcCalc });

    if (type === "IEND") {
      const hasIHDR = chunks.some((c) => c.type === "IHDR");
      const hasIDAT = chunks.some((c) => c.type === "IDAT");
      const ok =
        hasIHDR &&
        hasIDAT &&
        chunks.every((c) => c.crcOk) &&
        chunks[0]?.type === "IHDR";
      return { ok, chunks, hasIHDR, hasIDAT, hasIEND: true };
    }

    offset += 12 + len;
  }

  return {
    ok: false,
    chunks,
    hasIHDR: chunks.some((c) => c.type === "IHDR"),
    hasIDAT: chunks.some((c) => c.type === "IDAT"),
    hasIEND: false,
  };
}

/**
 * Detect container format from magic bytes (never from filename).
 * "png" only when the PNG chunk stream is structurally valid.
 */
export function detectMagicFormat(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "jpeg";
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  if (buffer.toString("ascii", 0, 3) === "GIF") return "gif";

  const structure = parsePngStructure(buffer);
  if (structure.ok) return "png";

  return null;
}

async function sniffSharpFormat(buffer: Buffer): Promise<string | null> {
  try {
    const meta = await sharp(buffer, { failOn: "error" }).metadata();
    return meta.format ?? null;
  } catch {
    return null;
  }
}

/**
 * A "real" PNG is structurally valid AND byte-identical to sharp's canonical PNG encoder output.
 * LLM/Doubao PNGs often pass file(1)/sharp decode but fail this check (e.g. .data/falsetest.png).
 */
export async function isCanonicalRealPng(buffer: Buffer): Promise<boolean> {
  const structure = parsePngStructure(buffer);
  if (!structure.ok) return false;

  try {
    const canonical = await sharp(buffer, { failOn: "error" }).png().toBuffer();
    return (
      canonical.length === buffer.length &&
      canonical.equals(buffer) &&
      parsePngStructure(canonical).ok
    );
  } catch {
    return false;
  }
}

export async function inspectImageBuffer(
  buffer: Buffer,
  options?: { claimsPng?: boolean }
): Promise<PngInspection> {
  if (buffer.length === 0) {
    return {
      isValidPng: false,
      detectedFormat: null,
      isFakePng: !!options?.claimsPng,
    };
  }

  const magicFormat = detectMagicFormat(buffer);
  const sharpFormat = await sniffSharpFormat(buffer);
  const structure = parsePngStructure(buffer);

  if (magicFormat && magicFormat !== "png") {
    return {
      isValidPng: false,
      detectedFormat: magicFormat,
      isFakePng: true,
    };
  }

  const detectedFormat =
    magicFormat ?? (structure.hasIHDR ? "png-like" : null) ?? sharpFormat;

  if (!structure.ok) {
    return {
      isValidPng: false,
      detectedFormat,
      isFakePng: options?.claimsPng ?? magicFormat !== "png",
    };
  }

  if (sharpFormat && sharpFormat !== "png") {
    return {
      isValidPng: false,
      detectedFormat: sharpFormat,
      isFakePng: true,
    };
  }

  const isReal = await isCanonicalRealPng(buffer);
  return {
    isValidPng: isReal,
    detectedFormat: isReal ? "png" : "non-canonical-png",
    isFakePng: !isReal,
  };
}

function mimeFromFormat(format: string | null): string {
  switch (format) {
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "png":
    case "png-like":
    case "non-canonical-png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

async function resolveConversionMime(
  buffer: Buffer,
  before: PngInspection
): Promise<string> {
  const magicFormat = detectMagicFormat(buffer);
  if (magicFormat && magicFormat !== "png") {
    return mimeFromFormat(magicFormat);
  }

  const sharpFormat = await sniffSharpFormat(buffer);
  if (before.isFakePng && sharpFormat && sharpFormat !== "png") {
    return mimeFromFormat(sharpFormat);
  }

  return mimeFromFormat("png");
}

let imglyConfig: {
  publicPath: string;
  model: "small";
  output: { format: "image/png"; quality: number; type: "foreground" };
} | null = null;

function getImglyConfig() {
  if (!imglyConfig) {
    const distDir = path.join(
      process.cwd(),
      "node_modules/@imgly/background-removal-node/dist"
    );
    imglyConfig = {
      publicPath: `${pathToFileURL(distDir).toString()}/`,
      model: "small",
      output: {
        format: "image/png",
        quality: 1,
        type: "foreground",
      },
    };
  }
  return imglyConfig;
}

async function convertWithImgly(buffer: Buffer, mimeType: string): Promise<Buffer> {
  const { removeBackground } = await import("@imgly/background-removal-node");
  const bytes = new Uint8Array(buffer);
  const inputBlob = new Blob([bytes], { type: mimeType });
  // Serialized with all other native ONNX work (e.g. local embeddings) so two
  // onnxruntime-node consumers never run concurrently (avoids native double-free).
  const outputBlob = await runExclusiveOnnx(() =>
    removeBackground(inputBlob, getImglyConfig())
  );
  return Buffer.from(await outputBlob.arrayBuffer());
}

function shouldNormalize(before: PngInspection, options?: NormalizePngOptions): boolean {
  if (options?.force) return true;
  if (before.isValidPng) return false;
  if (before.isFakePng || options?.claimsPng) return true;
  const rasterFormats = new Set([
    "png",
    "png-like",
    "non-canonical-png",
    "jpeg",
    "webp",
    "gif",
    null,
  ]);
  return rasterFormats.has(before.detectedFormat);
}

export async function normalizePngBuffer(
  buffer: Buffer,
  options?: NormalizePngOptions
): Promise<PngNormalizeResult> {
  const before = await inspectImageBuffer(buffer, { claimsPng: options?.claimsPng });

  if (!shouldNormalize(before, options)) {
    return { buffer, before, after: before, normalized: false };
  }

  const mimeType = await resolveConversionMime(buffer, before);
  const converted = await convertWithImgly(buffer, mimeType);
  const after = await inspectImageBuffer(converted, { claimsPng: true });
  return {
    buffer: converted,
    before,
    after,
    normalized: true,
  };
}

export function isPngUpload(fileName: string, mimeType?: string | null): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return true;
  return (mimeType ?? "").toLowerCase() === "image/png";
}

export function pngMetaFromResult(result: PngNormalizeResult) {
  return {
    isValidPngBefore: result.before.isValidPng,
    isValidPngAfter: result.after.isValidPng,
    isFakePngBefore: result.before.isFakePng,
    isFakePngAfter: result.after.isFakePng,
    detectedFormatBefore: result.before.detectedFormat,
    detectedFormatAfter: result.after.detectedFormat,
    normalized: result.normalized,
    isRealPng: result.after.isValidPng,
  };
}
