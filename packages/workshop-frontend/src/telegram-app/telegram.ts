// Часть Telegram.WebApp, которой пользуется Mini App, и перенос темы Telegram на страницу.
import { accentShades } from '@gadgets/workshop-shared/accent-theme'

type TelegramButton = {
  setText(text: string): void
  show(): void
  hide(): void
  enable(): void
  disable(): void
  showProgress?(leaveActive?: boolean): void
  hideProgress?(): void
  setParams?(params: { color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }): void
  onClick(callback: () => void): void
  offClick(callback: () => void): void
}

export type TelegramThemeParams = Partial<Record<'bg_color' | 'text_color' | 'hint_color' | 'link_color' | 'button_color' | 'button_text_color' | 'secondary_bg_color' | 'section_separator_color' | 'header_bg_color' | 'bottom_bar_bg_color', string>>

export type TelegramWebApp = {
  initData: string
  colorScheme?: 'light' | 'dark'
  themeParams?: TelegramThemeParams
  ready(): void
  expand?(): void
  close(): void
  openLink?(url: string): void
  MainButton?: TelegramButton
  BackButton?: { show(): void; hide(): void; onClick(callback: () => void): void; offClick(callback: () => void): void }
  onEvent?(event: 'themeChanged', callback: () => void): void
  offEvent?(event: 'themeChanged', callback: () => void): void
  enableClosingConfirmation?(): void
  disableClosingConfirmation?(): void
  disableVerticalSwipes?(): void
  setHeaderColor?(color: string): void
  setBackgroundColor?(color: string): void
  setBottomBarColor?(color: string): void
}

const HEX = /^#[0-9a-f]{6}$/i
const VARS: [keyof TelegramThemeParams, string][] = [
  ['bg_color', '--base'], ['text_color', '--text'], ['hint_color', '--subtle'],
  ['secondary_bg_color', '--tint'], ['section_separator_color', '--line'],
]

/** Цвета Telegram (светлая или тёмная тема человека) и его акцент — на корень страницы. В цвета
 *  идут только HEX: значение из themeParams не может подставить в страницу произвольный CSS. */
export function applyTelegramTheme(webApp: TelegramWebApp | null, accent: string | null, root: HTMLElement = document.documentElement): void {
  const scheme = webApp?.colorScheme === 'dark' ? 'dark' : webApp?.colorScheme === 'light' ? 'light' : null
  if (scheme) root.dataset.theme = scheme
  const params = webApp?.themeParams ?? {}
  for (const [key, name] of VARS) {
    const value = params[key]
    if (value && HEX.test(value)) root.style.setProperty(name, value); else root.style.removeProperty(name)
  }
  if (accent && HEX.test(accent)) {
    const shades = accentShades(accent)
    root.style.setProperty('--brand', shades.brand)
    root.style.setProperty('--brand-hover', shades.hover)
    root.style.setProperty('--brand-text', scheme === 'dark' ? shades.darkText : shades.lightText)
    root.style.setProperty('--ring', scheme === 'dark' ? shades.darkText : shades.brand)
  }
  const base = params.bg_color && HEX.test(params.bg_color) ? params.bg_color : null
  if (base) { try { webApp?.setHeaderColor?.(base); webApp?.setBackgroundColor?.(base); webApp?.setBottomBarColor?.(base) } catch { /* старый клиент */ } }
}
