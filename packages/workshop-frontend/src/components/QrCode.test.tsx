// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QrCode, qrPath } from './QrCode'

describe('QR-код ссылки на бота', () => {
  const link = 'https://t.me/mnemos_test_bot?start=ABCDEFGH2345'

  it('кодирует ссылку целиком: версия под длину, три поисковых узора по углам', () => {
    const { size, path } = qrPath(link)
    expect(size).toBeGreaterThanOrEqual(25)
    // Поисковый узор 7×7 начинается тёмными модулями в трёх углах.
    for (const [col, row] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      expect(path).toContain(`M${col} ${row}h1v1h-1z`)
    }
  })

  it('разные коды дают разные изображения', () => {
    expect(qrPath(link).path).not.toBe(qrPath(link.replace('ABCD', 'WXYZ')).path)
  })

  it('чёрный на белом с полем 4 модуля, подписан для чтения с экрана', () => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<QrCode value={link} label="QR-код бота" />)
    const svg = host.querySelector('svg')!
    expect(svg.getAttribute('aria-label')).toBe('QR-код бота')
    expect(svg.getAttribute('viewBox')).toMatch(/^-4 -4 /)
    expect(svg.querySelector('path')!.getAttribute('fill')).toBe('#000')
  })
})
