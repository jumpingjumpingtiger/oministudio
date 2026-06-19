import { NextRequest, NextResponse } from "next/server";
import { isLocalDataProxyEnabled, readDataFile } from "@/lib/data-proxy";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  if (!isLocalDataProxyEnabled()) {
    return NextResponse.json(
      { error: "Local data proxy is disabled in production. Use OSS URLs." },
      { status: 404 }
    );
  }

  const { path: segments } = await params;

  try {
    const file = await readDataFile(segments);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        "Content-Type": file.mimeType,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Data proxy error:", error);
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 });
  }
}
