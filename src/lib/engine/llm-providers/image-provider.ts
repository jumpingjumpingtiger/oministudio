import OpenAI from "openai";
import {
  getImageDoubaoBaseUrl,
  getLlmConfig,
  requireImageApiKey,
} from "@/lib/engine/llm-config";
import type { ImageAssetFormat } from "@/lib/asset-format";
import { parseImageAssetFormat } from "@/lib/asset-format";
import { processGeneratedImage } from "@/lib/engine/image-post-process";
import type { PngNormalizeResult } from "@/lib/engine/png-normalize";
import { normalizePngBuffer } from "@/lib/engine/png-normalize";

export interface GeneratedImageResult extends PngNormalizeResult {
  rawSize: number;
  format: ImageAssetFormat;
}

async function fetchRawImageBuffer(prompt: string): Promise<Buffer> {
  const { image } = getLlmConfig();

  switch (image.provider) {
    case "openai":
      return generateOpenAiImage(prompt, image.model);
    case "google":
      return generateGoogleImage(prompt, image.model);
    case "doubao":
      return generateDoubaoImage(prompt, image.model);
    default:
      throw new Error(`Unsupported image LLM provider: ${image.provider}`);
  }
}

/** Generate image via Image LLM; PNG outputs are normalized, JPEG/JPG are encoded as JPEG. */
export async function generateImageBuffer(
  prompt: string,
  format: ImageAssetFormat | string = "png"
): Promise<Buffer> {
  const result = await generateImageBufferWithMeta(prompt, format);
  return result.buffer;
}

export async function generateImageBufferWithMeta(
  prompt: string,
  format: ImageAssetFormat | string = "png"
): Promise<GeneratedImageResult> {
  const targetFormat = parseImageAssetFormat(format);
  const raw = await fetchRawImageBuffer(prompt);

  if (targetFormat === "png") {
    const normalized = await normalizePngBuffer(raw, { claimsPng: true });
    return { ...normalized, rawSize: raw.length, format: targetFormat };
  }

  const buffer = await processGeneratedImage(raw, targetFormat);
  return {
    buffer,
    before: { isValidPng: false, detectedFormat: targetFormat, isFakePng: false },
    after: { isValidPng: false, detectedFormat: targetFormat, isFakePng: false },
    normalized: true,
    rawSize: raw.length,
    format: targetFormat,
  };
}

async function generateOpenAiImage(
  prompt: string,
  model: string
): Promise<Buffer> {
  const apiKey = requireImageApiKey("openai");
  const client = new OpenAI({ apiKey });
  const response = await client.images.generate({
    model,
    prompt,
    n: 1,
    size: "1024x1024",
    response_format: "b64_json",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI image LLM returned no image data");
  return Buffer.from(b64, "base64");
}

async function generateGoogleImage(
  prompt: string,
  model: string
): Promise<Buffer> {
  const apiKey = requireImageApiKey("google");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1 },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google image API error: ${errorText}`);
  }

  const data = (await response.json()) as {
    predictions?: { bytesBase64Encoded?: string }[];
  };

  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error("Google image LLM returned no image data");
  return Buffer.from(b64, "base64");
}

async function generateDoubaoImage(
  prompt: string,
  model: string
): Promise<Buffer> {
  const apiKey = requireImageApiKey("doubao");

  const size = process.env.DOUBAO_IMAGE_SIZE || "2048x2048";

  const response = await fetch(`${getImageDoubaoBaseUrl()}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      size,
      n: 1,
      response_format: "b64_json",
      watermark: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Doubao image API error: ${errorText}`);
  }

  const data = (await response.json()) as {
    data?: { b64_json?: string }[];
  };

  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("Doubao image LLM returned no image data");
  return Buffer.from(b64, "base64");
}
