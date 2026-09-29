// Тема, акцент и базовые токены Mnemos для фрейма гаджета (ADR 0028, этап 6).
// Протокол описан в docs/gadget-apps.md, раздел «Тема и токены во фрейме гаджета».
import { useEffect, useState } from 'react'
import { accentShades, isAccentHex } from '@gadgets/workshop-shared/accent-theme'

export type HostThemeMode = 'light' | 'dark'

/** Что оболочка передаёт фрейму: режим темы и цвет акцента человека (HEX или null — зелёный Mnemos). */
export type HostTheme = { mode: HostThemeMode; accent: string | null }

/** Зелёный Mnemos: действует, когда оболочка не знает цвета человека. */
const DEFAULT_ACCENT = '#21664f'

/** Разрешённые переменные и вид значения. Фрейм применяет только их и только после проверки:
 *  сообщение не может подставить в страницу гаджета произвольный CSS. */
export const HOST_THEME_VARIABLES = {
  '--host-accent': 'hex',
  '--host-accent-hover': 'hex',
  '--host-accent-text': 'hex',
  '--host-accent-tint': 'hex',
  '--host-accent-text-dark': 'hex',
  '--host-accent-tint-dark': 'hex',
  '--host-accent-hue': 'hue',
  '--host-neutral-tint': 'tint',
} as const

type HostVariable = keyof typeof HOST_THEME_VARIABLES

/** Образцы значений. Без обратной косой черты: те же строки вставляются в код фрейма как есть. */
export const HOST_VALUE_PATTERNS = {
  hex: '^#[0-9a-fA-F]{6}$',
  hue: '^[0-9]{1,3}([.][0-9]{1,2})?$',
  tint: '^(0([.][0-9]{1,2})?|1)$',
} as const

export function isHostThemeMode(value: unknown): value is HostThemeMode {
  return value === 'light' || value === 'dark'
}

function validValue(name: HostVariable, value: unknown): value is string {
  const kind = HOST_THEME_VARIABLES[name]
  if (typeof value !== 'string' || !new RegExp(HOST_VALUE_PATTERNS[kind]).test(value)) return false
  return kind !== 'hue' || Number(value) <= 360
}

/** Оставляет только разрешённые имена с проверенными значениями. */
export function filterHostVariables(vars: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of Object.keys(HOST_THEME_VARIABLES) as HostVariable[]) {
    const value = vars[name]
    if (validValue(name, value)) out[name] = value
  }
  return out
}

/** Переменные акцента для фрейма. Светлые оттенки идут под прежними именами: встроенные редакторы
 *  документа, таблицы и презентации светлые и читают только их. Для тёмной темы — имена с -dark. */
export function hostThemeVariables(accent: string | null): Record<string, string> {
  const c = accentShades(accent && isAccentHex(accent) ? accent : DEFAULT_ACCENT)
  return filterHostVariables({
    '--host-accent': c.brand,
    '--host-accent-hover': c.hover,
    '--host-accent-text': c.lightText,
    '--host-accent-tint': c.lightTint,
    '--host-accent-text-dark': c.darkText,
    '--host-accent-tint-dark': c.darkTint,
    '--host-accent-hue': String(c.hue),
    '--host-neutral-tint': String(c.neutralTint),
  })
}

/** Сообщение фрейму о теме. Один вид сообщения и для первой отправки, и для смены. */
export function hostThemeMessage(theme: HostTheme): { type: 'host-theme'; mode: HostThemeMode; vars: Record<string, string> } {
  return { type: 'host-theme', mode: isHostThemeMode(theme.mode) ? theme.mode : 'light', vars: hostThemeVariables(theme.accent) }
}

/** Атрибуты корня фрейма: первый кадр уже в теме и цвете человека. Значения проверены выше,
 *  кавычек и точек с запятой в них быть не может. */
export function hostRootAttributes(theme: HostTheme): string {
  const mode = isHostThemeMode(theme.mode) ? theme.mode : 'light'
  const style = Object.entries(hostThemeVariables(theme.accent)).map(([name, value]) => `${name}:${value}`).join(';')
  return ` data-mode="${mode}" style="${style}"`
}

// Нейтральный цвет в оттенке акцента, как в оболочке (styles.css): светлота, хрома, прозрачность.
const n = (l: number, c: number, alpha?: number) =>
  `oklch(${l} calc(${c} * var(--host-neutral-tint, 1)) var(--host-accent-hue, 167.3)${alpha === undefined ? '' : ` / ${alpha}`})`
const ld = (light: string, dark: string) => `light-dark(${light}, ${dark})`
// Запасные значения — оттенки зелёного Mnemos: на случай, если переменных на корне нет.
const DEFAULTS = hostThemeVariables(null)
const v = (name: string) => `var(${name}, ${DEFAULTS[name]})`

const COLOR_TOKENS: Record<string, string> = {
  // Поверхности.
  '--color-kumo-base': ld(n(0.9708, 0.0045), n(0.115, 0.012)),
  '--color-kumo-canvas': ld(n(0.9708, 0.0045), n(0.115, 0.012)),
  '--color-kumo-elevated': ld(n(0.9708, 0.0045), n(0.155, 0.011)),
  '--color-kumo-tint': ld(n(0.9567, 0.0079), n(0.225, 0.025)),
  '--color-kumo-overlay': ld('#ffffff', n(0.155, 0.011)),
  '--color-kumo-recessed': ld(n(0.9477, 0.0079), n(0.1, 0.012)),
  '--color-kumo-control': ld('#ffffff', n(0.155, 0.011)),
  '--color-kumo-contrast': ld(n(0.2341, 0.0139), v('--host-accent')),
  '--color-kumo-fill': ld(n(0.9235, 0.0079), n(0.225, 0.025)),
  '--color-kumo-fill-hover': ld(n(0.9062, 0.0114), n(0.295, 0.045)),
  '--color-kumo-interact': ld(n(0.8499, 0.0133), n(0.34, 0.022)),
  '--color-kumo-bubble-user': ld('#ffffff', n(0.225, 0.025)),
  // Линии.
  '--color-kumo-line': ld(n(0.2341, 0.0139, 0.09), n(0.34, 0.022)),
  '--color-kumo-hairline': ld(n(0.2341, 0.0139, 0.09), n(0.34, 0.022)),
  '--color-kumo-tip-shadow': ld(n(0.2341, 0.0139, 0.078), '#00000066'),
  '--color-kumo-tip-stroke': ld('transparent', n(0.34, 0.022)),
  // Акцент человека: только намерение (основное действие, ссылка, активный пункт, фокус).
  '--color-kumo-brand': v('--host-accent'),
  '--color-kumo-brand-hover': v('--host-accent-hover'),
  '--color-kumo-ring': ld(v('--host-accent'), v('--host-accent-text-dark')),
  '--color-kumo-focus': ld(v('--host-accent'), v('--host-accent-text-dark')),
  '--color-selection-bg': ld(v('--host-accent-tint'), v('--host-accent-tint-dark')),
  '--color-selection-text': ld(v('--host-accent-text'), '#f7f7f8'),
  // Статусы от акцента не зависят.
  '--color-kumo-info': 'oklch(0.623 0.214 259.815)',
  '--color-kumo-info-tint': ld('oklch(0.9 0.06 250)', 'oklch(0.25 0.065 259.815)'),
  '--color-kumo-warning': ld('#b86e0e', 'oklch(0.555 0.163 48.998)'),
  '--color-kumo-warning-tint': ld('#fbefdd', 'oklch(0.27 0.06 84.429)'),
  '--color-kumo-danger': ld('oklch(0.637 0.237 25.331)', 'oklch(0.505 0.213 27.518)'),
  '--color-kumo-danger-tint': ld('oklch(0.92 0.06 25)', 'oklch(0.25 0.065 25.331)'),
  '--color-kumo-success': ld('oklch(0.723 0.219 149.579)', 'oklch(0.527 0.154 150.069)'),
  '--color-kumo-success-tint': ld('oklch(0.92 0.08 150)', 'oklch(0.25 0.06 150.069)'),
  // Текст.
  '--text-color-kumo-default': ld(n(0.2341, 0.0139), n(0.92, 0.01)),
  '--text-color-kumo-default-hover': ld(n(0.1882, 0.011), n(0.97, 0.006)),
  '--text-color-kumo-strong': ld(n(0.1882, 0.011), n(0.92, 0.01)),
  '--text-color-kumo-subtle': ld(n(0.5348, 0.0152), n(0.66, 0.02)),
  '--text-color-kumo-inactive': ld(n(0.7067, 0.0125), n(0.58, 0.025)),
  '--text-color-kumo-placeholder': ld(n(0.7067, 0.0125), n(0.58, 0.025)),
  '--text-color-kumo-inverse': '#ffffff',
  '--text-color-kumo-brand': ld(v('--host-accent-text'), v('--host-accent-text-dark')),
  '--text-color-kumo-link': ld(v('--host-accent-text'), v('--host-accent-text-dark')),
  '--text-color-kumo-success': ld('oklch(0.527 0.154 150.069)', 'oklch(0.792 0.209 151.711)'),
  '--text-color-kumo-danger': ld('oklch(0.505 0.213 27.518)', 'oklch(0.704 0.191 22.216)'),
  '--text-color-kumo-warning': ld('#6e4308', 'oklch(0.828 0.189 84.429)'),
  '--text-color-kumo-info': ld('oklch(0.488 0.217 264.376)', 'oklch(0.74 0.16 250)'),
}

// Шрифт, шкала текста и скругления DESIGN.md. Шрифтовых файлов нет: фрейм их не загрузит (CSP).
const SCALE_TOKENS: Record<string, string> = {
  '--font-sans': `"FT Kunst Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`,
  '--font-mono': `"Apercu Mono Pro", "SF Mono", Menlo, Monaco, Consolas, monospace`,
  '--text-page-title': '24px', '--text-page-title--line-height': '1.33', '--text-page-title--letter-spacing': '-0.6px', '--text-page-title--font-weight': '600',
  '--text-section-title': '18px', '--text-section-title--line-height': '1.56', '--text-section-title--font-weight': '600',
  '--text-card-title': '16px', '--text-card-title--line-height': '1.5', '--text-card-title--font-weight': '600',
  '--text-block-title': '15px', '--text-block-title--line-height': '1.33', '--text-block-title--font-weight': '600',
  '--text-body': '14px', '--text-body--line-height': '1.43', '--text-body--font-weight': '400',
  '--text-row-title': '13px', '--text-row-title--line-height': '1.38', '--text-row-title--letter-spacing': '-0.25px', '--text-row-title--font-weight': '500',
  '--text-notice': '13px', '--text-notice--line-height': '1.38', '--text-notice--letter-spacing': '-0.25px', '--text-notice--font-weight': '400',
  '--text-note': '12px', '--text-note--line-height': '1.33', '--text-note--font-weight': '400',
  '--text-badge': '12px', '--text-badge--line-height': '1.33', '--text-badge--font-weight': '500',
  '--text-eyebrow': '11px', '--text-eyebrow--line-height': '1.45', '--text-eyebrow--letter-spacing': '0.9px', '--text-eyebrow--font-weight': '600',
  '--text-counter': '11px', '--text-counter--line-height': '1.45', '--text-counter--font-weight': '500',
  '--radius-sm': '4px', '--radius-md': '6px', '--radius-lg': '8px', '--radius-xl': '12px', '--radius-2xl': '16px',
  '--container-page': '1120px',
}

/** Базовый CSS токенов во фрейме гаджета. Стоит в <head> до кода гаджета.
 *  - Селектор :root:root:root сильнее правил темы Kumo (`:root,:host`, `:root[data-mode=dark]`), которые
 *    сборка гаджета выводит вне слоёв: иначе поверх токенов Mnemos встали бы цвета Cloudflare или
 *    литералы шаблона. Гаджет, которому действительно нужен свой токен, задаёт его более сильным
 *    правилом; навык mnemos-gadget это запрещает.
 *  - color-scheme оболочка не ставит: тёмные значения light-dark() включает сам гаджет правилом
 *    `[data-mode="dark"] { color-scheme: dark }` (Kumo делает это сам). Светлые встроенные
 *    редакторы поэтому не темнеют в тёмной теме оболочки. */
export const HOST_BASE_CSS = `:root:root:root{${[...Object.entries(COLOR_TOKENS), ...Object.entries(SCALE_TOKENS)].map(([name, value]) => `${name}:${value}`).join(';')}}`

/** Режим темы оболочки: атрибут data-mode корня страницы (его ставит ThemeProvider, учитывая
 *  «как в системе»). Следит за сменой, контекст темы не нужен. */
export function useHostThemeMode(): HostThemeMode {
  const read = (): HostThemeMode => document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'light'
  const [mode, setMode] = useState<HostThemeMode>(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setMode(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] })
    setMode(read())
    return () => observer.disconnect()
  }, [])
  return mode
}

/** Код фрейма: принимает сообщение host-theme только от родителя, применяет режим и проверенные
 *  переменные к корню. Вставляется в начало модуля фрейма, до кода гаджета: слушатель гаджета
 *  получает то же сообщение уже после применения. */
export const FRAME_THEME_SCRIPT = `
{
  const kinds = ${JSON.stringify(HOST_THEME_VARIABLES)};
  const patterns = ${JSON.stringify(HOST_VALUE_PATTERNS)};
  const valid = (kind, value) => typeof value === 'string' && new RegExp(patterns[kind]).test(value) && (kind !== 'hue' || Number(value) <= 360);
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || !event.data || event.data.type !== 'host-theme') return;
    const root = document.documentElement;
    if (event.data.mode === 'light' || event.data.mode === 'dark') root.setAttribute('data-mode', event.data.mode);
    const vars = event.data.vars && typeof event.data.vars === 'object' ? event.data.vars : {};
    for (const name of Object.keys(kinds)) {
      if (valid(kinds[name], vars[name])) root.style.setProperty(name, vars[name]);
    }
  });
}
`
