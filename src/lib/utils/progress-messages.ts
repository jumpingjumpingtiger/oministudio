export const BRAIN_LANGUAGE_INSTRUCTION =
  '\n\nIMPORTANT: Write the "summary" field in English. Keep code comments in English.';

const PROGRESS = {
  analyzing: "Analyzing your prompt...",
  thinking: "Brain LLM is designing game logic and assets...",
  writing: "Writing game code files...",
  generatingAssets: (count: number) => `Generating ${count} image asset(s)...`,
  resolving: "Resolving asset URLs in code...",
  generatingGame: "Generating game...",
  starting: "Starting...",
  createdVersion: (n: number) => `Created version v${n}`,
  planning: (files: number, assets: number) =>
    `Planning ${files} file(s) and ${assets} asset(s)...`,
  wroteFile: (path: string) => `Wrote ${path}`,
  generatingAsset: (index: number, total: number, name: string) =>
    `Generating asset ${index}/${total}: ${name}`,
  assetReady: (name: string) => `Asset ready: ${name}`,
  assetFailed: (name: string, error: string) => `Asset failed (${name}): ${error}`,
  done: (n: number) => `Done — Version v${n}`,
} as const;

export function getProgressMessages() {
  return PROGRESS;
}
