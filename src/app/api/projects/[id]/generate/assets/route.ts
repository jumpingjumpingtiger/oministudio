import { NextRequest } from "next/server";
import { generateAssetsPhase } from "@/lib/engine/pipeline";
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
    const { versionId } = body;

    if (!versionId || typeof versionId !== "string") {
      return new Response(JSON.stringify({ error: "versionId is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    return createSseStream(async (send) => {
      await generateAssetsPhase({
        projectId,
        versionId,
        onProgress: send,
      });
    });
  } catch (error) {
    console.error("Generate assets error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Asset generation failed" },
      { status: 500 }
    );
  }
}
