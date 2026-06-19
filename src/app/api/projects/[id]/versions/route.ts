import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { switchVersion } from "@/lib/engine/pipeline";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const versions = await prisma.version.findMany({
    where: { projectId: id },
    orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json(versions);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  if (body.action === "switch" && body.versionId) {
    await switchVersion(id, body.versionId);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
