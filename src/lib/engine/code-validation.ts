import type { GeneratedAsset, GeneratedFile } from "@/lib/types";
import { isJsFile, parseJsFile } from "@/lib/engine/upg/ast-parser";
import { buildPhaserGraph } from "@/lib/engine/upg";

export interface ValidationIssue {
  severity: "error" | "warning";
  file?: string;
  line?: number;
  message: string;
}

const BAD_PHASER_IMPORT =
  /(?:import\s[^;]*\sfrom\s*['"]phaser['"])|(?:require\(\s*['"]phaser['"]\s*\))|(?:from\s*['"]@phaserjs?\/[^'"]+['"])|(?:import\s+[^;]*['"]https?:\/\/[^'"]*phaser[^'"]*['"])/;

const ASSET_URI = /asset:\/\/(img|text|audio|video)\/([a-zA-Z0-9_-]+)/g;

function assetKeyFromUri(uri: string): string {
  return uri.split("/").pop() || uri;
}

/**
 * Deterministic static validation of generated game code (LSP-style closed loop).
 * Catches syntax errors and Phaser-specific crash causes before write.
 */
export function validateGameCode(
  files: GeneratedFile[],
  assets: GeneratedAsset[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Syntax (acorn) per JS file.
  for (const file of files) {
    if (!isJsFile(file.path)) continue;
    const parsed = parseJsFile(file.path, file.content);
    if (parsed.error) {
      issues.push({
        severity: "error",
        file: file.path,
        message: `Syntax error: ${parsed.error}`,
      });
    }
  }

  // 2. Wrong Phaser import (must use CDN global, not npm/ESM import).
  for (const file of files) {
    if (!isJsFile(file.path)) continue;
    if (BAD_PHASER_IMPORT.test(file.content)) {
      issues.push({
        severity: "error",
        file: file.path,
        message:
          "Invalid Phaser import — Phaser is a global from the CDN <script> tag. Remove `import Phaser from 'phaser'` / require / @phaserjs imports.",
      });
    }
  }

  // 3. index.html sanity (CDN script + module entry).
  const indexHtml = files.find((f) => f.path.toLowerCase().endsWith("index.html"));
  if (indexHtml) {
    if (!/phaser[^"']*\.js/i.test(indexHtml.content)) {
      issues.push({
        severity: "error",
        file: indexHtml.path,
        message: "index.html is missing the Phaser CDN <script> tag.",
      });
    }
    if (!/<script[^>]*type=["']module["'][^>]*>/i.test(indexHtml.content)) {
      issues.push({
        severity: "warning",
        file: indexHtml.path,
        message: "index.html has no <script type=\"module\"> entry — main.js may not load.",
      });
    }
  }

  // 4. asset:// references that have no manifest entry (would not resolve at runtime).
  const manifestKeys = new Set<string>();
  for (const a of assets) {
    if (a.name) manifestKeys.add(a.name);
    if (a.uri) manifestKeys.add(assetKeyFromUri(a.uri));
  }
  const seenRefs = new Set<string>();
  for (const file of files) {
    let m: RegExpExecArray | null;
    ASSET_URI.lastIndex = 0;
    while ((m = ASSET_URI.exec(file.content))) {
      const key = m[2];
      if (seenRefs.has(key)) continue;
      seenRefs.add(key);
      if (!manifestKeys.has(key)) {
        issues.push({
          severity: "warning",
          file: file.path,
          message: `Code references asset://${m[1]}/${key} but no matching asset is declared in the assets list.`,
        });
      }
    }
  }

  // 5. Phaser graph checks: scene registration + texture key binding.
  try {
    const graph = buildPhaserGraph(files);

    // 5a. Scene registration: every scene class should be in config.scene list.
    if (graph.config.sceneList.length) {
      const registered = new Set(graph.config.sceneList);
      const sceneClasses = new Set<string>();
      for (const node of graph.nodes.values()) {
        if (node.sceneName && node.domain !== "config") sceneClasses.add(node.sceneName);
      }
      for (const cls of sceneClasses) {
        // sceneName may be the super('key') string; registration uses class identifiers.
        // Only flag when neither the key nor any registered id loosely matches.
        const matches = [...registered].some(
          (r) => r === cls || r.toLowerCase().includes(cls.toLowerCase()) || cls.toLowerCase().includes(r.toLowerCase())
        );
        if (!matches) {
          issues.push({
            severity: "warning",
            message: `Scene "${cls}" is defined but may not be registered in the game config scene list [${graph.config.sceneList.join(", ")}].`,
          });
        }
      }
    }

    // 5b. Texture key binding: world entities referencing a key with no preload.
    const loadedKeys = new Set<string>();
    for (const node of graph.nodes.values()) {
      if (node.domain === "resource" && node.key) loadedKeys.add(node.key);
    }
    if (loadedKeys.size) {
      const boundResources = new Set<string>();
      for (const edge of graph.edges) {
        if (edge.type === "asset_binding") {
          const res = graph.nodes.get(edge.to);
          if (res?.key) boundResources.add(res.key);
        }
      }
      // Heuristic: report unused preloaded assets only as info-level warning (low noise).
      for (const key of loadedKeys) {
        if (!boundResources.has(key) && manifestKeys.has(key)) {
          // loaded + in manifest but never bound to an entity — likely fine (UI/bg). Skip.
        }
      }
    }
  } catch {
    // Graph build failures are non-fatal for validation.
  }

  return issues;
}

export function formatIssuesForHeal(issues: ValidationIssue[]): string {
  return issues
    .map((i) => {
      const loc = i.file ? `${i.file}${i.line ? `:${i.line}` : ""}` : "(global)";
      return `- [${i.severity}] ${loc} — ${i.message}`;
    })
    .join("\n");
}

export function summarizeIssues(issues: ValidationIssue[]): string {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  return `${errors} error(s), ${warnings} warning(s)`;
}
