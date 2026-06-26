---
name: phaser-h5-game
description: >-
  Guide Brain LLM to generate high-quality Phaser 3 H5 games with story planning,
  multi-scene architecture, win/lose conditions, and correct CDN imports.
  Use when generating or iterating OminiStudio game code.
---

# Phaser 3 H5 Game Developer Guide (OminiStudio)

Apply this skill **before writing JSON output**. Plan the game design first, then emit code.

## 1. Pre-code design checklist (mandatory)

In your `summary`, briefly state:

1. **Premise** — One-sentence story / player goal (not "a platformer" alone).
2. **Core loop** — What the player repeats (move → challenge → reward → progress).
3. **Scenes** — List scenes and transitions (see §2).
4. **Win / lose** — Exact end conditions and what happens next (restart, next level, game over scene).
5. **Progression** — Score, lives, levels, timer, or unlocks (at least one).

Do not ship a single empty room with one sprite. Include **at least one meaningful objective** and **feedback** (UI text, score, dialog).

## 2. Scene architecture (CDN + ES modules)

OminiStudio games use **Phaser 3 from CDN** and **native ES modules** (no npm, no TypeScript, no bundler).

### Required file layout

```
index.html          # Phaser CDN script + <script type="module" src="main.js">
main.js             # Game config, scene list, new Phaser.Game(config)
scenes/BootScene.js
scenes/PreloadScene.js   # load all asset://img/* here; progress bar
scenes/MenuScene.js      # title + start instruction
scenes/GameScene.js      # core gameplay
scenes/GameOverScene.js  # win/lose + restart
```

Use **multiple scene files** for any game beyond a 30-line demo. Split when you add menus, HUD, or endings.

### Scene lifecycle

`init(data)` → `preload()` → `create()` → `update(time, delta)` → `shutdown()`

- **BootScene** — minimal; `this.scene.start('PreloadScene')`.
- **PreloadScene** — `this.load.image(key, 'asset://img/name')` for every asset; show load progress; then `this.scene.start('MenuScene')`.
- **GameScene** — gameplay only; pass `{ outcome, score }` to GameOver via `this.scene.start('GameOverScene', { won, score })`.
- **shutdown()** — remove custom listeners / timers if you attach any.

### Parallel HUD (optional)

For score/lives overlay: `this.scene.launch('HudScene')` from GameScene; stop it in GameOver.

## 3. Correct Phaser CDN import (critical)

In `index.html` use **only**:

```html
<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>
```

In `main.js` / scenes — **do NOT** use:

- `import Phaser from 'phaser'`
- `require('phaser')`
- `@phaserjs/...` packages
- `import` from skypack/unpkg for Phaser

Phaser is a **global** after the script tag. Scene files export classes:

```javascript
export class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }
  create() { /* ... */ }
}
```

`main.js` imports scenes:

```javascript
import { BootScene } from './scenes/BootScene.js';
const config = { type: Phaser.AUTO, width: 800, height: 600, parent: document.body, scene: [BootScene, PreloadScene, MenuScene, GameScene, GameOverScene] };
new Phaser.Game(config);
```

## 4. Gameplay quality bar

| Area | Minimum |
|------|---------|
| Story | Clear goal in MenuScene UI text |
| Challenge | Obstacle, enemy, timer, or resource pressure |
| Feedback | Score or lives + on-screen labels |
| End state | GameOverScene distinguishes win vs lose |
| Restart | Key or button returns to Menu or restarts Game |
| Assets | Every `this.load.image` key matches `asset://img/{name}` in code |

Use **Arcade physics** for platformers (`physics: { default: 'arcade', arcade: { gravity: { y: 300 } } }`).

Use `setDisplaySize(w, h)` after loading sprites so layout matches asset dimensions from the manifest.

## 5. Story templates (pick one and elaborate)

- **Rescue** — Reach the goal while avoiding hazards; win on overlap goal, lose on hazard or timer.
- **Survival** — Survive N seconds or waves; escalating spawn rate.
- **Collection** — Gather N items; lose on enemy touch; win when quota met.
- **Puzzle-lite** — Switches/keys gating exit; short dialog in scene text.

Adapt the template to the user's prompt; do not ignore prompt themes.

## 6. Constants and maintainability

Create `config/GameConfig.js` or constants at top of GameScene:

```javascript
export const GAME = { width: 800, height: 600, playerSpeed: 160, jumpVelocity: -330, maxLives: 3 };
```

## 7. Common preview failures — avoid

1. Wrong Phaser import (npm-style) — see §3.
2. Missing scene in `config.scene` array — scene never starts.
3. Asset key mismatch — preload key must equal sprite key.
4. Forgetting `asset://img/...` — never use external image URLs.
5. Empty `update()` with no game logic.
6. `index.html` missing `<script type="module" src="main.js">`.
7. Scene imports missing `.js` extension.

## 8. JSON output reminder

Output OminiStudio JSON: `summary`, `files[]`, `assets[]`. Each scene = separate file under `scenes/`. Assets need width/height, format, regenerate, story-aligned prompts.
