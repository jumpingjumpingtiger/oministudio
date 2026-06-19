export const EDITOR_THEME_STORAGE_KEY = "oministudio-editor-theme";

export const EDITOR_THEMES = [
  { id: "light", label: "Light" },
  { id: "vs-dark", label: "Dark" },
  { id: "hc-black", label: "High Contrast Dark" },
  { id: "hc-light", label: "High Contrast Light" },
] as const;

export type EditorThemeId = (typeof EDITOR_THEMES)[number]["id"];

const VALID_THEME_IDS = new Set<string>(EDITOR_THEMES.map((t) => t.id));

export function getStoredEditorTheme(): EditorThemeId {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem(EDITOR_THEME_STORAGE_KEY);
  if (stored && VALID_THEME_IDS.has(stored)) {
    return stored as EditorThemeId;
  }
  return "light";
}

export function storeEditorTheme(theme: EditorThemeId): void {
  localStorage.setItem(EDITOR_THEME_STORAGE_KEY, theme);
}
