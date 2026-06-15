import { NextRequest, NextResponse } from "next/server";
import { runBrainLlm } from "@/lib/engine/brain-llm";
import { generateImageBuffer } from "@/lib/engine/llm-providers/image-provider";
import { getLlmConfig, isBrainLlmConfigured, isImageLlmConfigured } from "@/lib/engine/llm-config";

export async function GET() {
  const config = getLlmConfig();
  return NextResponse.json({
    brain: {
      provider: config.brain.provider,
      model: config.brain.model,
      configured: isBrainLlmConfigured(),
    },
    image: {
      provider: config.image.provider,
      model: config.image.model,
      configured: isImageLlmConfigured(),
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, prompt } = body as { type: "brain" | "image"; prompt: string };

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    if (type === "brain") {
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
      if (!isImageLlmConfigured()) {
        return NextResponse.json({
          success: false,
          error: "Image LLM is not configured. Set API keys in .env",
        });
      }

      const buffer = await generateImageBuffer(prompt);
      return NextResponse.json({
        success: true,
        mode: "live",
        result: {
          size: buffer.length,
          preview: `data:image/png;base64,${buffer.toString("base64")}`,
        },
      });
    }

    return NextResponse.json({ error: "type must be 'brain' or 'image'" }, { status: 400 });
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
