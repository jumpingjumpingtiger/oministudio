import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { generateCodePhase } from "@/lib/engine/pipeline";
import { createSseStream } from "@/lib/generation-progress";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  try {
    const body = await request.json();
    const { prompt, files } = body;

    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await prisma.chatMessage.create({
      data: {
        projectId,
        role: "user",
        content: prompt.trim(),
        files: JSON.stringify(files || []),
      },
    });

    return createSseStream(async (send) => {
      await generateCodePhase({ projectId, prompt: prompt.trim(), onProgress: send });
    });
  } catch (error) {
    console.error("Generate code error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Code generation failed" },
      { status: 500 }
    );
  }
}
