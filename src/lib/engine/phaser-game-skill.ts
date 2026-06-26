import { existsSync, readFileSync } from "fs";
import path from "path";

const SKILL_RELATIVE = "skills/phaser-h5-game/SKILL.md";

/** Load Phaser game dev skill body (strip YAML frontmatter) for Brain LLM system prompt. */
export function loadPhaserGameSkill(): string {
  const skillPath = path.join(process.cwd(), SKILL_RELATIVE);
  if (!existsSync(skillPath)) return "";

  const raw = readFileSync(skillPath, "utf-8");
  const stripped = raw.replace(/^---[\s\S]*?---\s*/, "").trim();
  return stripped
    ? `\n\n---\nPhaser game developer skill (follow for every generation):\n\n${stripped}`
    : "";
}
