import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateImageBuffer } from "@/lib/engine/llm-providers/image-provider";
import { isImageLlmConfigured } from "@/lib/engine/llm-config";
import {
  readPendingAssetsPayload,
  readUriCsv,
  replaceUriCsvAsset,
  writeAssetFile,
  type UriCsvRow,
} from "@/lib/storage";

async function getActiveVersionId(projectId: string, versionId?: string | null) {
  if (versionId) {
    const version = await prisma.version.findFirst({
      where: { id: versionId, projectId },
    });
    return version?.id ?? null;
  }
  const active = await prisma.version.findFirst({
    where: { projectId, isActive: true },
  });
  return active?.id ?? null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const versionIdParam = searchParams.get("versionId");
  const activeVersionId = await getActiveVersionId(id, versionIdParam);

  let uriCsv: UriCsvRow[] = [];
  let pendingAssets: {
    name: string;
    uri: string;
    type: string;
    prompt: string;
    order: number;
    regenerate?: boolean;
  }[] = [];

  if (activeVersionId) {
    uriCsv = await readUriCsv(id, activeVersionId);
    if (uriCsv.length === 0) {
      const payload = await readPendingAssetsPayload(id, activeVersionId);
      pendingAssets = payload.assets.map((a) => ({
        name: a.name,
        uri: a.uri,
        type: a.type,
        prompt: a.prompt,
        order: a.order,
        regenerate: a.regenerate,
      }));
    }
  }

  const versionAssets = uriCsv.length
    ? uriCsv.map((row) => ({
        id: row.assetId,
        name: row.name,
        type: row.type,
        uri: row.uri,
        url: row.url,
        prompt: row.prompt,
        order: row.order,
        regenerate: row.regenerate,
      }))
    : pendingAssets.map((a) => ({
        id: "",
        name: a.name,
        type: a.type,
        uri: a.uri,
        url: "",
        prompt: a.prompt,
        order: a.order,
        regenerate: a.regenerate,
      }));

  return NextResponse.json({
    versionId: activeVersionId,
    assets: versionAssets,
    uriCsv,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const name = formData.get("name") as string | null;
  const versionId = formData.get("versionId") as string | null;

  if (!file || !name) {
    return NextResponse.json({ error: "File and name are required" }, { status: 400 });
  }

  const activeVersionId = await getActiveVersionId(id, versionId);
  const uri = `asset://img/${name.trim()}`;

  const record = await prisma.asset.create({
    data: {
      projectId: id,
      name: name.trim(),
      type: "img",
      uri,
      prompt: "",
    },
  });

  const buffer = Buffer.from(await file.arrayBuffer());
  const { url, filePath } = await writeAssetFile(id, "img", record.id, buffer);

  const asset = await prisma.asset.update({
    where: { id: record.id },
    data: { url, filePath },
  });

  if (activeVersionId) {
    const rows = await readUriCsv(id, activeVersionId);
    await replaceUriCsvAsset(id, activeVersionId, uri, {
      order: rows.length,
      name: name.trim(),
      type: "img",
      uri,
      url,
      assetId: record.id,
      prompt: "",
    });
  }

  return NextResponse.json(asset, { status: 201 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const contentType = request.headers.get("content-type") || "";
  let versionId: string | null = null;
  let uri: string | null = null;
  let prompt: string | null = null;
  let file: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    versionId = formData.get("versionId") as string | null;
    uri = formData.get("uri") as string | null;
    prompt = formData.get("prompt") as string | null;
    file = formData.get("file") as File | null;
  } else {
    const body = await request.json();
    versionId = body.versionId ?? null;
    uri = body.uri ?? null;
    prompt = body.prompt ?? null;
  }

  if (!uri) {
    return NextResponse.json({ error: "uri is required" }, { status: 400 });
  }

  const activeVersionId = await getActiveVersionId(id, versionId);
  if (!activeVersionId) {
    return NextResponse.json({ error: "No active version" }, { status: 404 });
  }

  const rows = await readUriCsv(id, activeVersionId);
  const existing = rows.find((r) => r.uri === uri);
  if (!existing) {
    return NextResponse.json({ error: "Asset not found in version" }, { status: 404 });
  }

  const record = await prisma.asset.create({
    data: {
      projectId: id,
      name: existing.name,
      type: existing.type,
      uri: existing.uri,
      prompt: prompt ?? existing.prompt,
    },
  });

  let buffer: Buffer;
  if (file) {
    buffer = Buffer.from(await file.arrayBuffer());
  } else if (prompt && isImageLlmConfigured()) {
    try {
      buffer = await generateImageBuffer(prompt);
    } catch {
      const oldBuffer = await import("@/lib/storage").then((m) =>
        m.readAssetFile(id, "img", existing.assetId)
      );
      buffer = oldBuffer ?? Buffer.alloc(0);
    }
  } else {
    const { readAssetFile } = await import("@/lib/storage");
    const oldBuffer = await readAssetFile(id, "img", existing.assetId);
    if (!oldBuffer) {
      return NextResponse.json({ error: "Original asset file not found" }, { status: 404 });
    }
    buffer = oldBuffer;
  }

  const { url, filePath } = await writeAssetFile(id, "img", record.id, buffer);
  const asset = await prisma.asset.update({
    where: { id: record.id },
    data: { url, filePath },
  });

  await replaceUriCsvAsset(id, activeVersionId, uri, {
    order: existing.order,
    name: existing.name,
    type: existing.type,
    uri: existing.uri,
    url,
    assetId: record.id,
    prompt: prompt ?? existing.prompt,
  });

  return NextResponse.json(asset);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const uri = searchParams.get("uri");
  const versionId = searchParams.get("versionId");

  if (!uri) {
    return NextResponse.json({ error: "uri is required" }, { status: 400 });
  }

  const activeVersionId = await getActiveVersionId(id, versionId);
  if (!activeVersionId) {
    return NextResponse.json({ error: "No active version" }, { status: 404 });
  }

  const rows = await readUriCsv(id, activeVersionId);
  const filtered = rows.filter((r) => r.uri !== uri);
  const { writeUriCsv } = await import("@/lib/storage");
  await writeUriCsv(id, activeVersionId, filtered);
  return NextResponse.json({ success: true });
}
