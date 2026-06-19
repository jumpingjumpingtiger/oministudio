import { NextRequest, NextResponse } from "next/server";
import { runBrainLlm } from "@/lib/engine/brain-llm";
import { generateImageBufferWithMeta } from "@/lib/engine/llm-providers/image-provider";
import {
  getBrainApiKeyEnvVar,
  getImageApiKeyEnvVar,
  getLlmConfig,
  isBrainLlmConfigured,
  isImageLlmConfigured,
} from "@/lib/engine/llm-config";
import {
  inspectImageBuffer,
  normalizePngBuffer,
  pngMetaFromResult,
} from "@/lib/engine/png-normalize";

export async function GET() {
  const config = getLlmConfig();
  return NextResponse.json({
    brain: {
      provider: config.brain.provider,
      model: config.brain.model,
      configured: isBrainLlmConfigured(),
      apiKeyEnv: getBrainApiKeyEnvVar(),
    },
    image: {
      provider: config.image.provider,
      model: config.image.model,
      configured: isImageLlmConfigured(),
      apiKeyEnv: getImageApiKeyEnvVar(),
    },
    png: {
      converter: "@imgly/background-removal-node",
      available: true,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const type = formData.get("type") as string | null;
      if (type !== "png") {
        return NextResponse.json({ error: "type must be 'png' for file upload" }, { status: 400 });
      }

      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "file is required" }, { status: 400 });
      }

      const raw = Buffer.from(await file.arrayBuffer());
      const before = await inspectImageBuffer(raw, { claimsPng: true });
      const result = await normalizePngBuffer(raw, { claimsPng: true });

      return NextResponse.json({
        success: true,
        mode: "png-convert",
        result: {
          fileName: file.name,
          sizeBefore: raw.length,
          sizeAfter: result.buffer.length,
          preview: `data:image/png;base64,${result.buffer.toString("base64")}`,
          png: pngMetaFromResult(result),
          skipped: !result.normalized && before.isValidPng && !before.isFakePng,
        },
      });
    }

    const body = await request.json();
    const { type, prompt } = body as { type: "brain" | "image" | "png"; prompt: string };

    if (type === "brain") {
      if (!prompt || typeof prompt !== "string") {
        return NextResponse.json({ error: "prompt is required" }, { status: 400 });
      }

      if (!isBrainLlmConfigured()) {
        return NextResponse.json({
          success: true,
          mode: "mock",
          result: await runBrainLlm(prompt),
        });
      }

      const result = await runBrainLlm(prompt);
      return NextResponse.json({ success: true, mode: "live", result });
    }

    if (type === "image") {
      if (!prompt || typeof prompt !== "string") {
        return NextResponse.json({ error: "prompt is required" }, { status: 400 });
      }

      if (!isImageLlmConfigured()) {
        return NextResponse.json({
          success: false,
          error: "Image LLM is not configured. Set the image API key in .env (see IMAGE_*_API_KEY vars)",
        });
      }

      const generated = await generateImageBufferWithMeta(prompt);
      return NextResponse.json({
        success: true,
        mode: "live",
        result: {
          rawSize: generated.rawSize,
          size: generated.buffer.length,
          preview: `data:image/png;base64,${generated.buffer.toString("base64")}`,
          png: pngMetaFromResult(generated),
        },
      });
    }

    return NextResponse.json({ error: "type must be 'brain', 'image', or 'png'" }, { status: 400 });
  } catch (error) {
    console.error("LLM debug error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Debug request failed",
      },
      { status: 500 }
    );
  }
}
