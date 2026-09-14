import { accentCSSVariables, isAccentHex, ACCENT_PALETTE } from "@gadgets/workshop-shared/accent-theme";
export type ResolvedThemeMode = "light" | "dark";

let current: ResolvedThemeMode = "light";
const listeners = new Set<(mode: ResolvedThemeMode) => void>();

export function getThemeMode(): ResolvedThemeMode {
  return current;
}

/** Ставит data-mode на html: от него зависят токены Kumo из styles.css. Хост присылает строку, поэтому всё, что не "dark", — светлая тема. */
export function applyThemeMode(mode: string): void {
  const resolved: ResolvedThemeMode = mode === "dark" ? "dark" : "light";
  const root = document.documentElement;
  root.setAttribute("data-mode", resolved);
  root.style.colorScheme = resolved;
  if (resolved === current) return;
  current = resolved;
  for (const listener of listeners) listener(resolved);
}

export function subscribeThemeMode(listener: (mode: ResolvedThemeMode) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Хост передаёт только цвет оформления; это не меняет права и состояние документов. */
export function applyAccentColor(color:string):void {
  const safe=isAccentHex(color)?color:ACCENT_PALETTE[0].color;
  for(const [name,value] of Object.entries(accentCSSVariables(safe))) document.documentElement.style.setProperty(name,value);
}
