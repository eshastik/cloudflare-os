// @vitest-environment jsdom
// Протокол темы фрейма гаджета: что уходит из оболочки и что фрейм соглашается применить.
import { describe, expect, it } from 'vitest'
import { FRAME_THEME_SCRIPT, HOST_BASE_CSS, filterHostVariables, hostThemeMessage, hostThemeVariables } from './gadgetHostTheme'
import { createSandboxedHtml } from './gadgetSandbox'

/** Исполняет код фрейма на поддельных окне и корне; возвращает, что он поставил на корень. */
function runFrameScript() {
  const parent = {}
  let listener: ((event: { source: unknown; data: unknown }) => void) | null = null
  const attrs: Record<string, string> = {}
  const style: Record<string, string> = {}
  const root = { setAttribute: (n: string, v: string) => { attrs[n] = v }, style: { setProperty: (n: string, v: string) => { style[n] = v } } }
  const window = { parent, addEventListener: (type: string, fn: typeof listener) => { if (type === 'message') listener = fn } }
  new Function('window', 'document', FRAME_THEME_SCRIPT)(window, { documentElement: root })
  const send = (data: unknown, source: unknown = parent) => listener!({ source, data })
  return { attrs, style, send }
}

describe('тема во фрейме гаджета', () => {
  it('фрейм применяет режим и проверенные переменные только от родителя', () => {
    const frame = runFrameScript()
    frame.send(hostThemeMessage({ mode: 'dark', accent: '#ae4b14' }), {})
    expect(frame.attrs).toEqual({})
    frame.send(hostThemeMessage({ mode: 'dark', accent: '#ae4b14' }))
    expect(frame.attrs['data-mode']).toBe('dark')
    expect(frame.style).toEqual(hostThemeVariables('#ae4b14'))
  })

  it('фрейм отбрасывает чужие имена, не-HEX и неверный режим', () => {
    const frame = runFrameScript()
    frame.send({ type: 'host-theme', mode: 'dark;x', vars: {
      '--host-accent': 'red', '--host-accent-hover': '#12345', '--host-accent-text': '#ae4b14;background:url(x)',
      '--host-accent-tint': 'var(--x)', '--host-accent-hue': '999', '--host-neutral-tint': '2',
      '--color-kumo-base': '#000000', '--host-accent-text-dark': '#ABCDEF',
    } })
    expect(frame.attrs).toEqual({})
    expect(frame.style).toEqual({ '--host-accent-text-dark': '#ABCDEF' })
    frame.send({ type: 'host-accent', vars: { '--host-accent': '#000000' } })
    expect(frame.style['--host-accent']).toBeUndefined()
  })

  it('оболочка отправляет только проверенные значения', () => {
    expect(filterHostVariables({ '--host-accent': '#ae4b14', '--host-accent-hue': '44.6', '--host-neutral-tint': '0.45', '--evil': '#000000', '--host-accent-tint': 'url(x)' }))
      .toEqual({ '--host-accent': '#ae4b14', '--host-accent-hue': '44.6', '--host-neutral-tint': '0.45' })
    expect(hostThemeMessage({ mode: 'sepia' as 'light', accent: 'javascript:1' })).toEqual(hostThemeMessage({ mode: 'light', accent: null }))
  })

  it('базовые токены: поверхности, линии, текст и шкала с light-dark() от переменных оболочки', () => {
    for (const token of ['--color-kumo-base', '--color-kumo-line', '--text-color-kumo-default', '--text-color-kumo-subtle', '--color-kumo-brand', '--text-page-title', '--radius-xl'])
      expect(HOST_BASE_CSS).toContain(`${token}:`)
    expect(HOST_BASE_CSS).toMatch(/--color-kumo-base:light-dark\(oklch\(0\.9708 calc\(0\.0045 \* var\(--host-neutral-tint, 1\)\) var\(--host-accent-hue, 167\.3\)\)/)
    expect(HOST_BASE_CSS).toContain('--color-kumo-brand:var(--host-accent, #21664f)')
    // Оболочка не включает тёмную схему сама: светлые редакторы не темнеют.
    expect(HOST_BASE_CSS).not.toContain('color-scheme')
    expect(HOST_BASE_CSS).not.toMatch(/@import|url\(|@font-face|%/)
  })

  it('строгий CSP фрейма сохраняется: стили — встроенные, сеть закрыта', () => {
    const html = createSandboxedHtml('1', undefined, { mode: 'dark', accent: '#ae4b14' })
    const csp = html.match(/Content-Security-Policy" content="([^"]*)"/)![1]
    expect(csp).toContain("style-src data: 'unsafe-inline'")
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("default-src 'none'")
    expect(html.match(/<style\b/g)).toHaveLength(1)
  })
})
