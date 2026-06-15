import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  deleteCodeFile,
  listCodeFiles,
  readCodeFile,
  writeCodeFile,
} from "@/lib/storage";

async function getActiveVersionId(projectId: string): Promise<string | null> {
  const version = await prisma.version.findFirst({
    where: { projectId, isActive: true },
  });
  return version?.id ?? null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const versionId = searchParams.get("versionId");
  const filePath = searchParams.get("path");

  const activeVersionId = versionId || (await getActiveVersionId(id));
  if (!activeVersionId) {
    return NextResponse.json({ files: [], versionId: null });
  }

  if (filePath) {
    const content = await readCodeFile(id, activeVersionId, filePath);
    if (content === null) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    return NextResponse.json({ path: filePath, content, versionId: activeVersionId });
  }

  const files = await listCodeFiles(id, activeVersionId);
  return NextResponse.json({ files, versionId: activeVersionId });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { path: filePath, content, versionId } = body;

  if (!filePath || content === undefined) {
    return NextResponse.json({ error: "path and content are required" }, { status: 400 });
  }

  const activeVersionId = versionId || (await getActiveVersionId(id));
  if (!activeVersionId) {
    return NextResponse.json({ error: "No active version" }, { status: 400 });
  }

  await writeCodeFile(id, activeVersionId, filePath, content);
  return NextResponse.json({ success: true });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { path: filePath, content, versionId } = body;

  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const activeVersionId = versionId || (await getActiveVersionId(id));
  if (!activeVersionId) {
    return NextResponse.json({ error: "No active version" }, { status: 400 });
  }

  const existing = await readCodeFile(id, activeVersionId, filePath);
  if (existing !== null) {
    return NextResponse.json({ error: "File already exists" }, { status: 409 });
  }

  await writeCodeFile(id, activeVersionId, filePath, content || "");
  return NextResponse.json({ success: true }, { status: 201 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get("path");
  const versionId = searchParams.get("versionId");

  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const activeVersionId = versionId || (await getActiveVersionId(id));
  if (!activeVersionId) {
    return NextResponse.json({ error: "No active version" }, { status: 400 });
  }

  await deleteCodeFile(id, activeVersionId, filePath);
  return NextResponse.json({ success: true });
}
