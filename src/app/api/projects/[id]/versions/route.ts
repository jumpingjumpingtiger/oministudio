import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteVersion, switchVersion } from "@/lib/engine/pipeline";

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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const versionId = searchParams.get("versionId");

  if (!versionId) {
    return NextResponse.json({ error: "versionId is required" }, { status: 400 });
  }

  const count = await prisma.version.count({ where: { projectId: id } });
  if (count <= 1) {
    return NextResponse.json(
      { error: "Cannot delete the only version of a project" },
      { status: 400 }
    );
  }

  try {
    await deleteVersion(id, versionId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      { status: 404 }
    );
  }
}
