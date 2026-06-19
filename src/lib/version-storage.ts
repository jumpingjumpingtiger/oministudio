import { prisma } from "@/lib/db";

/** Filesystem folder name for a version, e.g. v1, v2 */
export function formatVersionStorageKey(versionNumber: number): string {
  return `v${versionNumber}`;
}

export async function resolveVersionStorageKey(
  projectId: string,
  versionId: string
): Promise<string | null> {
  const version = await prisma.version.findFirst({
    where: { id: versionId, projectId },
    select: { id: true, versionNumber: true, storageKey: true },
  });

  if (!version) return null;

  if (version.storageKey) return version.storageKey;
  if (version.versionNumber != null) {
    return formatVersionStorageKey(version.versionNumber);
  }

  // Legacy versions created before v1/v2 folders
  return version.id;
}

export async function resolveActiveVersionStorageKey(
  projectId: string
): Promise<{ versionId: string; storageKey: string } | null> {
  const version = await prisma.version.findFirst({
    where: { projectId, isActive: true },
    select: { id: true, versionNumber: true, storageKey: true },
  });

  if (!version) return null;

  const storageKey =
    version.storageKey ||
    (version.versionNumber != null
      ? formatVersionStorageKey(version.versionNumber)
      : version.id);

  return { versionId: version.id, storageKey };
}

export async function resolveVersionStorageKeyParam(
  projectId: string,
  versionIdParam: string | null | undefined
): Promise<{ versionId: string; storageKey: string } | null> {
  if (versionIdParam) {
    const storageKey = await resolveVersionStorageKey(projectId, versionIdParam);
    if (!storageKey) return null;
    return { versionId: versionIdParam, storageKey };
  }
  return resolveActiveVersionStorageKey(projectId);
}
