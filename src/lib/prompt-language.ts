export const CHANGE_MANIFEST_LABELS = {
  fileChanges: "File changes",
  assetChanges: "Asset changes",
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  reused: "Reused",
  promptEnhanced: "Prompt enhanced",
  promptUnchanged: " (unchanged)",
} as const;

export function getChangeManifestLabels() {
  return CHANGE_MANIFEST_LABELS;
}

export function getBrainLanguageInstruction(): string {
  return '\n\nIMPORTANT: Write the "summary" field in English. Keep code comments in English.';
}

/** True when the prompt contains significant CJK text (used for English RAG query routing). */
export function isNonEnglishPrompt(text: string): boolean {
  const sample = text.trim().slice(0, 2000);
  if (!sample) return false;
  const cjk =
    (sample.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) ?? []).length;
  const latin = (sample.match(/[a-zA-Z]/g) ?? []).length;
  return cjk >= 4 && cjk >= latin * 0.25;
}
