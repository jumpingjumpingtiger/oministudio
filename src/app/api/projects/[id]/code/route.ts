import { NextRequest, NextResponse } from "next/server";
import {
  deleteCodeFile,
  listCodeFiles,
  readCodeFile,
  writeCodeFile,
} from "@/lib/storage";
import { resolveVersionStorageKeyParam } from "@/lib/version-storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const versionIdParam = searchParams.get("versionId");
  const filePath = searchParams.get("path");

  const resolved = await resolveVersionStorageKeyParam(id, versionIdParam);
  if (!resolved) {
    return NextResponse.json({ files: [], versionId: null });
  }

  const { versionId, storageKey } = resolved;

  if (filePath) {
    const content = await readCodeFile(id, storageKey, filePath);
    if (content === null) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    return NextResponse.json(
      { path: filePath, content, versionId },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const files = await listCodeFiles(id, storageKey);
  return NextResponse.json(
    { files, versionId },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { path: filePath, content, versionId: versionIdBody } = body;

  if (!filePath || content === undefined) {
    return NextResponse.json({ error: "path and content are required" }, { status: 400 });
  }

  const resolved = await resolveVersionStorageKeyParam(id, versionIdBody ?? null);
  if (!resolved) {
    return NextResponse.json({ error: "No active version" }, { status: 400 });
  }

  await writeCodeFile(id, resolved.storageKey, filePath, content);
  return NextResponse.json({ success: true });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { path: filePath, content, versionId: versionIdBody } = body;

  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const resolved = await resolveVersionStorageKeyParam(id, versionIdBody ?? null);
  if (!resolved) {
    return NextResponse.json({ error: "No active version" }, { status: 400 });
  }

  const existing = await readCodeFile(id, resolved.storageKey, filePath);
  if (existing !== null) {
    return NextResponse.json({ error: "File already exists" }, { status: 409 });
  }

  await writeCodeFile(id, resolved.storageKey, filePath, content || "");
  return NextResponse.json({ success: true }, { status: 201 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get("path");
  const versionIdParam = searchParams.get("versionId");

  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const resolved = await resolveVersionStorageKeyParam(id, versionIdParam);
  if (!resolved) {
    return NextResponse.json({ error: "No active version" }, { status: 400 });
  }

  await deleteCodeFile(id, resolved.storageKey, filePath);
  return NextResponse.json({ success: true });
}
