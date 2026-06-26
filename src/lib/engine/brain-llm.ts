import { isBrainLlmConfigured } from "@/lib/engine/llm-config";
import { callBrainLlm, callBrainLlmStream } from "@/lib/engine/llm-providers/brain-provider";
import { parseBrainResult } from "@/lib/engine/llm-providers/json-utils";
import type { BrainLlmResult, GeneratedAsset, GeneratedFile } from "@/lib/types";
import {
  buildBrainUserPrompt,
  DEFAULT_BRAIN_CONTEXT_BUDGET,
  type BrainContextPreview,
  type BrainGenerationContext,
  type BuiltBrainPrompt,
} from "@/lib/engine/brain-context";
import { normalizeAssetRegenerateFlags } from "@/lib/engine/asset-reuse";
import { BRAIN_LANGUAGE_INSTRUCTION } from "@/lib/utils/progress-messages";
import { getBrainLanguageInstruction } from "@/lib/prompt-language";
import { estimateTokenCount } from "@/lib/token-estimate";
import { loadPhaserGameSkill } from "@/lib/engine/phaser-game-skill";
import { createBrainStreamSplitter } from "@/lib/brain-stream-phase";

const PHASER_SKILL = loadPhaserGameSkill();

const BRAIN_SYSTEM_PROMPT = `You are the master brain LLM for OminiStudio, a multi-modal game development platform.
Your job is to generate Phaser 3 H5 game code based on user prompts.
${PHASER_SKILL}

Rules:
1. Generate complete, runnable Phaser 3 game code as separate files.
2. Always include at minimum: index.html, main.js, and one scene file.
3. Use ES modules and Phaser 3 CDN in index.html.
4. For image assets, define placeholders using asset URIs: asset://img/{asset_name}
5. Reference image assets in code using placeholder URIs only. Do NOT use external URLs for game assets.
6. Generate an asset list with detailed prompts for image generation.
7. Only support "img" asset type in this version.
8. Respond ONLY with valid JSON. No markdown fences, no extra text.
9. Use the "content" field for file contents. Escape special characters properly (\\n for newlines, \\" for quotes).
10. In game code, reference image assets ONLY with asset://img/{asset_name} placeholders. They will be replaced with real URLs automatically after generation.
11. Keep code concise to fit within output limits. Avoid overly long files.
12. All code comments must be in English.

Partial output on iteration (when project context + retrieved code slices are provided):
13. Return ONLY files you changed or created — omit untouched files entirely.
14. Apply minimal, focused edits; preserve unrelated code in files you do touch.
15. Do NOT rewrite the entire project when a small change suffices.

Asset sizing (CRITICAL for visual quality):
16. Every asset MUST include "width" and "height" in pixels matching its in-game display size.
17. Image generation prompts MUST specify exact pixel dimensions, e.g. "64x64 pixels", "800x600 pixels".
18. Match asset sizes to Phaser game config (typically 800x600 canvas). Backgrounds should match canvas size.
19. Sprites: 32-128px. Tiles/platforms: match collision size. UI elements: appropriate readable size.
20. In Phaser code, after loading each image use setDisplaySize(width, height) or setScale() so sprites fit the game layout.
21. Use consistent art style across all asset prompts (e.g. all pixel art OR all cartoon — never mix styles).
22. Player sprites should be sized relative to platforms and world — typically player height ≈ 1.5-2x tile height.

Asset delta (Brain LLM decides — platform merges with compact inventory to build uri.csv):
23. When iterating, output ONLY assets you add or modify. Omit unchanged assets — the platform reuses them automatically.
24. Each listed asset MUST include "regenerate": true (add or modify). Include a full generation "prompt" for every listed asset.
25. To remove an asset, delete its asset:// reference from code; do not list it in assets.
26. Keep stable URIs in code for the same logical asset; change URI only when adding a genuinely new asset slot.

Asset format (CRITICAL — choose per asset, do NOT default everything to png):
27. Each asset MUST include "format": "png", "jpeg", or "jpg".
28. Use "png" for sprites, characters, icons, tiles, UI elements that need transparency.
29. Use "jpeg" or "jpg" for full-screen backgrounds, skyboxes, photos, gradients, and any opaque scenery — JPEG avoids broken transparency on large backgrounds.
30. The generation prompt MUST explicitly state the output format, e.g. "PNG with transparent background" or "JPEG photo, no transparency, 800x600 pixels".

Greenfield / full rewrite:
31. List EVERY asset referenced in code in the assets array with regenerate true and full prompts.
32. On full rewrite, include ALL files in the files array.

Iterative development (when compact asset inventory is provided):
33. This is an iteration on an existing game — NOT a greenfield rewrite unless the user explicitly asks.
34. Preserve working game mechanics, file structure, and asset URIs unless the request requires changes.
35. Apply minimal, focused edits aligned with the latest user request and conversation summary.

Required JSON format:
{
  "summary": "Brief description of changes made",
  "files": [
    { "path": "index.html", "content": "..." },
    { "path": "main.js", "content": "..." }
  ],
  "assets": [
    {
      "order": 0,
      "name": "player_sprite",
      "type": "img",
      "uri": "asset://img/player_sprite",
      "width": 64,
      "height": 64,
      "format": "png",
      "regenerate": true,
      "prompt": "PNG sprite with transparent background: a cute pixel art game character, side view, 64x64 pixels..."
    }
  ]
}`;

const RETRY_SYSTEM_PROMPT = `${BRAIN_SYSTEM_PROMPT}

IMPORTANT: Keep the game minimal — only index.html, main.js, and one short scene file (under 80 lines).
Use the "content" field with properly escaped JSON strings. Ensure the JSON is complete and valid.`;

export interface BrainLlmRunMeta {
  inputTokens: number;
  outputTokens: number;
  contextPreview: BrainContextPreview;
}

export interface BrainLlmHooks {
  onPrepared?: (meta: {
    inputTokens: number;
    contextPreview: BrainContextPreview;
  }) => void | Promise<void>;
  onThinkingChunk?: (chunk: string) => void | Promise<void>;
  onCodeChunk?: (chunk: string) => void | Promise<void>;
  onCodeOutputStart?: () => void | Promise<void>;
  onStreamReset?: () => void | Promise<void>;
  /** @deprecated Prefer onThinkingChunk/onCodeChunk */
  onStreamChunk?: (chunk: string) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface PreparedBrainPrompt {
  built: BuiltBrainPrompt;
  inputTokens: number;
  configured: boolean;
  languageInstruction: string;
}

/**
 * RAG retrieval + prompt assembly step (graph node `retrieve_context`).
 * Runs UPG + AST RAG, chat recall, and uri.csv injection via buildBrainUserPrompt,
 * but does NOT call the LLM — so retrieval is an isolated, observable node.
 */
export async function prepareBrainPrompt(
  userPrompt: string,
  context: BrainGenerationContext = {},
  budget = DEFAULT_BRAIN_CONTEXT_BUDGET
): Promise<PreparedBrainPrompt> {
  const built = await buildBrainUserPrompt(userPrompt, context, budget);
  const languageInstruction = getBrainLanguageInstruction();
  const fullPrompt = built.userPrompt + languageInstruction;
  const inputTokens = estimateTokenCount(BRAIN_SYSTEM_PROMPT + fullPrompt);
  return { built, inputTokens, configured: isBrainLlmConfigured(), languageInstruction };
}

/**
 * Brain LLM generation step (graph node `brain_generate`).
 * Consumes an already-prepared prompt, calls the model (with one compact retry),
 * parses JSON, and normalizes asset regenerate flags.
 */
export async function callBrainFromPrompt(params: {
  userPrompt: string;
  context: BrainGenerationContext;
  prepared: PreparedBrainPrompt;
  hooks?: Pick<
    BrainLlmHooks,
    "onThinkingChunk" | "onCodeChunk" | "onCodeOutputStart" | "onStreamReset" | "onStreamChunk" | "signal"
  >;
}): Promise<BrainLlmResult & { meta: BrainLlmRunMeta }> {
  const { userPrompt, context, prepared, hooks } = params;
  const existingAssets = context.existingAssets || [];
  const { built, inputTokens, languageInstruction } = prepared;

  if (!prepared.configured) {
    const mock = generateMockResult(userPrompt);
    const outputTokens = estimateTokenCount(JSON.stringify(mock));
    return {
      ...mock,
      meta: { inputTokens, outputTokens, contextPreview: built.contextPreview },
    };
  }

  const { selectionPlan, contextPreview } = built;
  if (selectionPlan) {
    console.info(
      `[brain-context] intent=${selectionPlan.intent} files=${selectionPlan.selectedFileCount}/${selectionPlan.totalFileCount} chat=${selectionPlan.selectedChatCount}/${selectionPlan.totalChatCount} summarized=${selectionPlan.chatSummarizedCount} assets=${selectionPlan.selectedAssetCount}/${selectionPlan.totalAssetCount} (${selectionPlan.assetDetailLevel})`
    );
  }

  const fullPrompt = built.userPrompt + languageInstruction;
  const streamSplitter = createBrainStreamSplitter();
  let codeOutputStarted = false;

  const streamOpts = {
    onChunk: async (chunk: string) => {
      if (hooks?.onStreamChunk && !hooks.onThinkingChunk && !hooks.onCodeChunk) {
        await hooks.onStreamChunk(chunk);
        return;
      }

      const { thinkingChunks, codeChunks, codeStarted } = streamSplitter.push(chunk);
      for (const thinkingChunk of thinkingChunks) {
        await hooks?.onThinkingChunk?.(thinkingChunk);
      }
      if (codeStarted && !codeOutputStarted) {
        codeOutputStarted = true;
        await hooks?.onCodeOutputStart?.();
      }
      for (const codeChunk of codeChunks) {
        await hooks?.onCodeChunk?.(codeChunk);
      }
    },
    signal: hooks?.signal,
  };

  try {
    const content = await callBrainLlmStream(
      BRAIN_SYSTEM_PROMPT,
      fullPrompt,
      streamOpts
    );
    const outputTokens = estimateTokenCount(content);
    const result = parseBrainResult(content);
    return {
      ...result,
      assets: normalizeAssetRegenerateFlags(result.assets, existingAssets),
      meta: { inputTokens, outputTokens, contextPreview },
    };
  } catch (firstError) {
    if (hooks?.signal?.aborted) throw firstError;
    console.warn("Brain LLM first attempt failed, retrying with compact prompt:", firstError);

    streamSplitter.reset();
    codeOutputStarted = false;
    await hooks?.onStreamReset?.();

    const compactBudget = {
      ...DEFAULT_BRAIN_CONTEXT_BUDGET,
      maxTotalChars: 48_000,
      maxTotalFileChars: 24_000,
      maxChatMessages: 4,
      maxChatHistoryChars: 4_000,
      maxSummaryChars: 1_500,
    };
    const compact = await buildBrainUserPrompt(userPrompt, context, compactBudget);
    const compactFull = `${compact.userPrompt}${languageInstruction}\n\nGenerate a minimal update for this request.`;
    const retryInputTokens = estimateTokenCount(RETRY_SYSTEM_PROMPT + compactFull);

    const retryContent = await callBrainLlmStream(
      RETRY_SYSTEM_PROMPT,
      compactFull,
      streamOpts
    );
    const outputTokens = estimateTokenCount(retryContent);
    const result = parseBrainResult(retryContent);
    return {
      ...result,
      assets: normalizeAssetRegenerateFlags(result.assets, existingAssets),
      meta: {
        inputTokens: retryInputTokens,
        outputTokens,
        contextPreview: compact.contextPreview,
      },
    };
  }
}

export async function runBrainLlm(
  userPrompt: string,
  context: BrainGenerationContext = {},
  hooks?: BrainLlmHooks
): Promise<BrainLlmResult & { meta: BrainLlmRunMeta }> {
  const prepared = await prepareBrainPrompt(userPrompt, context);
  await hooks?.onPrepared?.({
    inputTokens: prepared.inputTokens,
    contextPreview: prepared.built.contextPreview,
  });
  return callBrainFromPrompt({
    userPrompt,
    context,
    prepared,
    hooks: {
      onThinkingChunk: hooks?.onThinkingChunk,
      onCodeChunk: hooks?.onCodeChunk,
      onCodeOutputStart: hooks?.onCodeOutputStart,
      onStreamReset: hooks?.onStreamReset,
      onStreamChunk: hooks?.onStreamChunk,
      signal: hooks?.signal,
    },
  });
}

const HEAL_SYSTEM_PROMPT = `${BRAIN_SYSTEM_PROMPT}

SELF-HEAL MODE: The previous output failed static analysis / compiler checks.
Fix ONLY the reported issues. Return the COMPLETE corrected file set in the same JSON format.
Preserve all working code, file structure, and asset URIs. Do NOT add new features or rename assets.`;

/**
 * One corrective pass driven by static-analysis/compiler feedback (LSP-style closed loop).
 * Returns null when Brain LLM is not configured or the pass fails.
 */
export async function healBrainCode(params: {
  prompt: string;
  files: GeneratedFile[];
  assets: GeneratedAsset[];
  issues: string;
}): Promise<BrainLlmResult | null> {
  if (!isBrainLlmConfigured()) return null;

  const filesBlock = params.files
    .map((f) => `--- ${f.path} ---\n${f.content}`)
    .join("\n\n");
  const assetsBlock = params.assets
    .map((a) => `- ${a.uri} (name=${a.name}, format=${a.format || "png"})`)
    .join("\n");

  const userPrompt =
    `Original request:\n${params.prompt}\n\n` +
    `## Static-analysis issues to fix\n${params.issues}\n\n` +
    `## Current files\n${filesBlock}\n\n` +
    `## Asset manifest (keep URIs stable)\n${assetsBlock || "(none)"}\n\n` +
    `Return the corrected JSON (summary, files, assets).${BRAIN_LANGUAGE_INSTRUCTION}`;

  try {
    const content = await callBrainLlm(HEAL_SYSTEM_PROMPT, userPrompt);
    return parseBrainResult(content);
  } catch (error) {
    console.warn("Self-heal pass failed:", error);
    return null;
  }
}

function generateMockResult(userPrompt: string): BrainLlmResult {
  const gameName = userPrompt.slice(0, 30).replace(/[^a-zA-Z0-9 ]/g, "") || "Demo Game";

  const files: GeneratedFile[] = [
    {
      path: "index.html",
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${gameName}</title>
  <style>
    body { margin: 0; padding: 0; background: #1a1a2e; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    canvas { border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>
</head>
<body>
  <script type="module" src="main.js"></script>
</body>
</html>`,
    },
    {
      path: "main.js",
      content: `import { GameScene } from './scenes/GameScene.js';

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: document.body,
  backgroundColor: '#2d2d44',
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 300 }, debug: false }
  },
  scene: [GameScene]
};

new Phaser.Game(config);`,
    },
    {
      path: "scenes/GameScene.js",
      content: `export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  preload() {
    this.load.image('player', 'asset://img/player_sprite');
    this.load.image('background', 'asset://img/background');
    this.load.image('platform', 'asset://img/platform');
  }

  create() {
    this.add.image(400, 300, 'background').setDisplaySize(800, 600);

    this.platforms = this.physics.add.staticGroup();
    this.platforms.create(400, 568, 'platform').setDisplaySize(200, 32).refreshBody();
    this.platforms.create(600, 400, 'platform').setDisplaySize(200, 32);
    this.platforms.create(50, 250, 'platform').setDisplaySize(200, 32);

    this.player = this.physics.add.sprite(100, 450, 'player');
    this.player.setDisplaySize(64, 64);
    this.player.setBounce(0.2);
    this.player.setCollideWorldBounds(true);

    this.physics.add.collider(this.player, this.platforms);

    this.cursors = this.input.keyboard.createCursorKeys();

    this.add.text(16, 16, '${gameName}', {
      fontSize: '24px',
      fill: '#ffffff',
      fontFamily: 'Arial'
    });
  }

  update() {
    if (this.cursors.left.isDown) {
      this.player.setVelocityX(-160);
    } else if (this.cursors.right.isDown) {
      this.player.setVelocityX(160);
    } else {
      this.player.setVelocityX(0);
    }

    if (this.cursors.up.isDown && this.player.body.touching.down) {
      this.player.setVelocityY(-330);
    }
  }
}`,
    },
  ];

  const assets: GeneratedAsset[] = [
    {
      order: 0,
      name: "player_sprite",
      type: "img",
      uri: "asset://img/player_sprite",
      prompt: "A cute 2D pixel art game character sprite, side view, colorful, transparent background, exactly 64x64 pixels",
      width: 64,
      height: 64,
      format: "png",
      regenerate: true,
    },
    {
      order: 1,
      name: "background",
      type: "img",
      uri: "asset://img/background",
      prompt: "JPEG game background scenery, opaque, parallax style, sky with clouds, exactly 800x600 pixels, no transparency",
      width: 800,
      height: 600,
      format: "jpeg",
      regenerate: true,
    },
    {
      order: 2,
      name: "platform",
      type: "img",
      uri: "asset://img/platform",
      prompt: "PNG platform tile with transparent background, grass top with dirt bottom, pixel art, 200x32 pixels",
      width: 200,
      height: 32,
      format: "png",
      regenerate: true,
    },
  ];

  const summary = `Created "${gameName}" - a platformer game with player movement and jumping mechanics. Generated ${files.length} code files and ${assets.length} image assets.`;

  return {
    summary,
    files,
    assets,
  };
}
