import type { GeneratedFile } from "@/lib/types";

/**
 * Merge Brain LLM partial file output with the active version's full tree.
 * Brain returns only changed/new files on iteration; untouched paths are carried forward.
 */
export function mergeBrainFilesWithExisting(
  brainFiles: GeneratedFile[],
  existingFiles: GeneratedFile[]
): GeneratedFile[] {
  if (!existingFiles.length) return brainFiles;
  if (!brainFiles.length) return existingFiles;

  const byPath = new Map(existingFiles.map((f) => [f.path, f]));
  for (const file of brainFiles) {
    byPath.set(file.path, file);
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}
