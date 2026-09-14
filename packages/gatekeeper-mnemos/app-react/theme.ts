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
