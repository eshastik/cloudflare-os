// Личная палитра меняет только акцентные токены. Светлая и тёмная основы остаются в styles.css.
// Оттенки общие с панелью Mnemos и проверяются по числовому контрасту.

import { ACCENT_PALETTE, accentCSSVariables, isAccentChoice, isAccentHex, type AccentChoice } from '@gadgets/workshop-shared/accent-theme'
export { ACCENT_PALETTE, type AccentChoice } from '@gadgets/workshop-shared/accent-theme'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedThemeMode = 'light' | 'dark'

const THEME_MODE_STORAGE_KEY = 'gadgets:theme-mode'

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function getSystemThemeMode(): ResolvedThemeMode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function readThemeMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_MODE_STORAGE_KEY)
    return isThemeMode(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function writeThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode)
  } catch {
    // Ignore storage failures; the selected mode still applies for this session.
  }
}

export function resolveThemeMode(mode: ThemeMode): ResolvedThemeMode {
  return mode === 'system' ? getSystemThemeMode() : mode
}

export function applyThemeMode(mode: ThemeMode): ResolvedThemeMode {
  const resolved = resolveThemeMode(mode)
  const root = document.documentElement

  root.setAttribute('data-mode', resolved)
  root.style.colorScheme = resolved

  return resolved
}

export function applyStoredThemeMode(): ResolvedThemeMode {
  return applyThemeMode(readThemeMode())
}

const ALL_VARS = Object.keys(accentCSSVariables('#000000'))

// Apply the accent color to the document root. Pass "" / invalid to clear back to the base theme.
export function applyAccentColor(color: string | null | undefined): void {
  const root = document.documentElement
  if (!color || !isAccentHex(color)) {
    for (const v of ALL_VARS) root.style.removeProperty(v)
    return
  }
  for (const [v, value] of Object.entries(accentCSSVariables(color))) {
    root.style.setProperty(v, value)
  }
}

// The base/default accent, shown in the admin picker when no custom color is set.
export const DEFAULT_ACCENT_COLOR = '#21664f'

const ACCENT_STORAGE_KEY = 'mnemos:accent-choice'
/** Выбор действует в этом браузере. При первом посещении используется оформление организации. */
export function readAccentChoice(): AccentChoice | null {
  try { const value=window.localStorage.getItem(ACCENT_STORAGE_KEY);return isAccentChoice(value)?value:null; } catch { return null; }
}
/** Ошибка хранилища не мешает применить оформление в текущей вкладке. */
export function writeAccentChoice(choice: AccentChoice): boolean {
  if(!isAccentChoice(choice)) return false;
  try {window.localStorage.setItem(ACCENT_STORAGE_KEY,choice);return true;}catch{return false;}
}
/** Личный выбор имеет приоритет над общим оформлением организации. */
export function resolveAccentColor(choice: AccentChoice | null, deploymentColor?: string | null): string {
  return ACCENT_PALETTE.find(option=>option.id===choice)?.color ?? (isAccentHex(deploymentColor)?deploymentColor:DEFAULT_ACCENT_COLOR);
}
