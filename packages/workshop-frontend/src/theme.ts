// Личная палитра меняет только акцентные токены. Светлая и тёмная основы остаются в styles.css.
// Оттенки общие с панелью Mnemos и проверяются по числовому контрасту.

import { ACCENT_PALETTE, accentCSSVariables, isAccentChoice, isAccentHex, isThemeModeChoice, type AccentChoice, type AppearancePreference, type ThemeModeChoice } from '@gadgets/workshop-shared/accent-theme'
export { ACCENT_PALETTE, type AccentChoice } from '@gadgets/workshop-shared/accent-theme'

export type ThemeMode = ThemeModeChoice
export type ResolvedThemeMode = 'light' | 'dark'

export function getSystemThemeMode(): ResolvedThemeMode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function readThemeMode(): ThemeMode {
  return readCachedAppearance().appearance.themeMode ?? 'system'
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

/** Личный выбор имеет приоритет над общим оформлением организации. */
export function resolveAccentColor(choice: AccentChoice | null, deploymentColor?: string | null): string {
  return ACCENT_PALETTE.find(option=>option.id===choice)?.color ?? (isAccentHex(deploymentColor)?deploymentColor:DEFAULT_ACCENT_COLOR);
}

export const EMPTY_APPEARANCE: AppearancePreference = { accent: null, themeMode: null }

// Настройка хранится в аккаунте; здесь только кэш, чтобы при загрузке не мигало.
// Кэш помечен владельцем: чужой кэш не применяется после входа другого человека.
export const APPEARANCE_CACHE_KEY = 'mnemos:appearance'
// Ключи версии, где выбор жил только в браузере. Читаются один раз, чтобы перенести выбор в аккаунт.
export const LEGACY_ACCENT_KEY = 'mnemos:accent-choice'
export const LEGACY_THEME_MODE_KEY = 'gadgets:theme-mode'

export interface CachedAppearance {
  /** Чей это кэш; null — выбор из прежней версии, владелец неизвестен. */
  user: string | null
  appearance: AppearancePreference
}

function storageGet(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

/** Кэш текущего браузера. Без кэша — выбор прежней версии, если он есть. */
export function readCachedAppearance(): CachedAppearance {
  const raw = storageGet(APPEARANCE_CACHE_KEY)
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      const user = parsed && typeof parsed === 'object' ? (parsed as { user?: unknown }).user : undefined
      if (typeof user === 'string' || user === null) {
        const { accent, themeMode } = parsed as Record<string, unknown>
        return {
          user,
          appearance: { accent: isAccentChoice(accent) ? accent : null, themeMode: isThemeModeChoice(themeMode) ? themeMode : null },
        }
      }
    } catch { /* испорченный кэш равен пустому */ }
  }
  const accent = storageGet(LEGACY_ACCENT_KEY), themeMode = storageGet(LEGACY_THEME_MODE_KEY)
  return { user: null, appearance: { accent: isAccentChoice(accent) ? accent : null, themeMode: isThemeModeChoice(themeMode) ? themeMode : null } }
}

/** user=null — выбор сделан до сверки с аккаунтом; при сверке он переносится в пустой аккаунт.
 * Ошибка хранилища не мешает применить оформление в текущей вкладке. */
export function writeCachedAppearance(user: string | null, appearance: AppearancePreference): void {
  try {
    window.localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify({ user, accent: appearance.accent, themeMode: appearance.themeMode }))
    window.localStorage.removeItem(LEGACY_ACCENT_KEY)
    window.localStorage.removeItem(LEGACY_THEME_MODE_KEY)
  } catch { /* см. выше */ }
}

/** При выходе: следующий человек в этом браузере не должен увидеть чужое оформление. */
export function clearCachedAppearance(): void {
  for (const key of [APPEARANCE_CACHE_KEY, LEGACY_ACCENT_KEY, LEGACY_THEME_MODE_KEY]) {
    try { window.localStorage.removeItem(key) } catch { /* нечего чистить */ }
  }
}
