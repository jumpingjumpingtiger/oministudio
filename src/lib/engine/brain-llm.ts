import { isBrainLlmConfigured } from "@/lib/engine/llm-config";
import { callBrainLlm } from "@/lib/engine/llm-providers/brain-provider";
import { parseBrainResult } from "@/lib/engine/llm-providers/json-utils";
import type { BrainLlmResult, GeneratedAsset, GeneratedFile } from "@/lib/types";
import type { UriCsvRow } from "@/lib/storage";
import {
  formatExistingAssetsContext,
  normalizeAssetRegenerateFlags,
} from "@/lib/engine/asset-reuse";
import { BRAIN_LANGUAGE_INSTRUCTION } from "@/lib/utils/progress-messages";

const BRAIN_SYSTEM_PROMPT = `You are the master brain LLM for OminiStudio, a multi-modal game development platform.
Your job is to generate Phaser 3 H5 game code based on user prompts.

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

Asset sizing (CRITICAL for visual quality):
13. Every asset MUST include "width" and "height" in pixels matching its in-game display size.
14. Image generation prompts MUST specify exact pixel dimensions, e.g. "64x64 pixels", "800x600 pixels".
15. Match asset sizes to Phaser game config (typically 800x600 canvas). Backgrounds should match canvas size.
16. Sprites: 32-128px. Tiles/platforms: match collision size. UI elements: appropriate readable size.
17. In Phaser code, after loading each image use setDisplaySize(width, height) or setScale() so sprites fit the game layout.
18. Use consistent art style across all asset prompts (e.g. all pixel art OR all cartoon — never mix styles).
19. Player sprites should be sized relative to platforms and world — typically player height ≈ 1.5-2x tile height.

Asset reuse (IMPORTANT when modifying an existing game):
20. Each asset MUST include "regenerate": true or false.
21. Set "regenerate": false when the asset URI already exists and the image prompt is unchanged — the platform will reuse the existing image.
22. Set "regenerate": true when the asset is new OR the prompt changed and a new image is needed.
23. Keep the same URI for unchanged assets so code references stay stable.

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
      "regenerate": true,
      "prompt": "A cute pixel art game character, side view, 64x64 pixels, transparent background..."
    }
  ]
}`;

const RETRY_SYSTEM_PROMPT = `${BRAIN_SYSTEM_PROMPT}

IMPORTANT: Keep the game minimal — only index.html, main.js, and one short scene file (under 80 lines).
Use the "content" field with properly escaped JSON strings. Ensure the JSON is complete and valid.`;

export async function runBrainLlm(
  userPrompt: string,
  existingFiles?: GeneratedFile[],
  existingAssets?: UriCsvRow[]
): Promise<BrainLlmResult> {
  if (!isBrainLlmConfigured()) {
    return generateMockResult(userPrompt);
  }

  const contextMessage = existingFiles?.length
    ? `\n\nExisting game files for reference:\n${existingFiles.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n")}`
    : "";

  const assetsContext = formatExistingAssetsContext(existingAssets || []);

  const fullPrompt =
    userPrompt + BRAIN_LANGUAGE_INSTRUCTION + contextMessage + assetsContext;

  try {
    const content = await callBrainLlm(BRAIN_SYSTEM_PROMPT, fullPrompt);
    const result = parseBrainResult(content);
    return {
      ...result,
      assets: normalizeAssetRegenerateFlags(result.assets, existingAssets || []),
    };
  } catch (firstError) {
    console.warn("Brain LLM first attempt failed, retrying with compact prompt:", firstError);

    const retryContent = await callBrainLlm(
      RETRY_SYSTEM_PROMPT,
      `${userPrompt}${BRAIN_LANGUAGE_INSTRUCTION}${assetsContext}\n\nGenerate a minimal version of this game.`
    );
    const result = parseBrainResult(retryContent);
    return {
      ...result,
      assets: normalizeAssetRegenerateFlags(result.assets, existingAssets || []),
    };
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
      regenerate: true,
    },
    {
      order: 1,
      name: "background",
      type: "img",
      uri: "asset://img/background",
      prompt: "A beautiful 2D game background scenery, parallax style, sky with clouds, exactly 800x600 pixels",
      width: 800,
      height: 600,
      regenerate: true,
    },
    {
      order: 2,
      name: "platform",
      type: "img",
      uri: "asset://img/platform",
      prompt: "A 2D game platform tile, grass top with dirt bottom, pixel art style, exactly 200x32 pixels",
      width: 200,
      height: 32,
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
