import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildAssetMap, resolveAssetUris, buildAssetResolverScript, injectAssetResolver } from "@/lib/asset-resolver";
import { getCodeBaseHref, injectBaseTag, injectPreviewStyles, isLocalDataProxyEnabled } from "@/lib/data-proxy";
import { readCodeFile, readUriCsv } from "@/lib/storage";
import { normalizeLegacyAssetUrl } from "@/lib/utils/asset-url";
import { resolveVersionStorageKey } from "@/lib/version-storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const { searchParams } = new URL(request.url);
  const versionIdParam = searchParams.get("versionId");

  if (!isLocalDataProxyEnabled()) {
    return NextResponse.json(
      { error: "Game play route requires local data proxy (development mode)" },
      { status: 404 }
    );
  }

  const version = versionIdParam
    ? await prisma.version.findFirst({ where: { id: versionIdParam, projectId } })
    : await prisma.version.findFirst({ where: { projectId, isActive: true } });

  if (!version) {
    return NextResponse.json({ error: "No version available" }, { status: 404 });
  }

  const storageKey = await resolveVersionStorageKey(projectId, version.id);
  if (!storageKey) {
    return NextResponse.json({ error: "Version storage not found" }, { status: 404 });
  }

  const html = await readCodeFile(projectId, storageKey, "index.html");
  if (!html) {
    return NextResponse.json({ error: "index.html not found" }, { status: 404 });
  }

  const uriCsv = await readUriCsv(projectId, storageKey);
  const assetUrlMap = buildAssetMap(uriCsv);
  for (const key of Object.keys(assetUrlMap)) {
    assetUrlMap[key] = normalizeLegacyAssetUrl(assetUrlMap[key], projectId);
  }

  let processedHtml = resolveAssetUris(html, assetUrlMap);
  processedHtml = injectAssetResolver(processedHtml, buildAssetResolverScript(assetUrlMap));
  processedHtml = injectBaseTag(processedHtml, getCodeBaseHref(projectId, storageKey));
  processedHtml = injectPreviewStyles(processedHtml);

  return new NextResponse(processedHtml, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
