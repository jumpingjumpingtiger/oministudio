import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildAssetMap, resolveAssetUris } from "@/lib/asset-resolver";
import { listCodeFiles, readCodeFile, readUriCsv } from "@/lib/storage";
import { normalizeLegacyAssetUrl } from "@/lib/utils/asset-url";
import { resolveVersionStorageKey } from "@/lib/version-storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const versionIdParam = searchParams.get("versionId");

  const version = versionIdParam
    ? await prisma.version.findFirst({ where: { id: versionIdParam, projectId: id } })
    : await prisma.version.findFirst({ where: { projectId: id, isActive: true } });

  if (!version) {
    return NextResponse.json({ error: "No version available" }, { status: 404 });
  }

  const storageKey = await resolveVersionStorageKey(id, version.id);
  if (!storageKey) {
    return NextResponse.json({ error: "Version storage not found" }, { status: 404 });
  }

  const files = await listCodeFiles(id, storageKey);
  const fileContents: Record<string, string> = {};

  for (const filePath of files) {
    const content = await readCodeFile(id, storageKey, filePath);
    if (content !== null) {
      fileContents[filePath] = content;
    }
  }

  const uriCsv = await readUriCsv(id, storageKey);
  const assetUrlMap = buildAssetMap(uriCsv);
  for (const key of Object.keys(assetUrlMap)) {
    assetUrlMap[key] = normalizeLegacyAssetUrl(assetUrlMap[key], id);
  }

  for (const filePath of Object.keys(fileContents)) {
    fileContents[filePath] = resolveAssetUris(fileContents[filePath], assetUrlMap);
  }

  const assets = uriCsv.length
    ? uriCsv.map((row) => ({
        id: row.assetId,
        name: row.name,
        type: row.type,
        uri: row.uri,
        url: row.url,
        order: row.order,
      }))
    : await prisma.asset.findMany({
        where: { projectId: id },
        orderBy: { createdAt: "desc" },
      });

  return NextResponse.json(
    {
      versionId: version.id,
      files: fileContents,
      assets,
      uriCsv,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
