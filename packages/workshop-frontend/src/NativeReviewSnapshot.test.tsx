import { renderToStaticMarkup } from 'react-dom/server'
// @vitest-environment jsdom
import { expect, it } from 'vitest'
import NativeReviewSnapshot, { parseNativeReview, reviewMarkup } from './NativeReviewSnapshot'
it('shows merged ranges including empty ranges when reviewing a spreadsheet', () => {
  const snapshot = { format: 'cloudflareos.spreadsheet' as const, formatVersion: 1 as const,
    document: { title: 'Team', sheetOrder: ['s'], sheets: { s: { name: 'Team', merges: ['A1:C1', 'AA101:AB102'] } }, cells: { s: { A1: { value: 'Title' } } } } }
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(<NativeReviewSnapshot snapshot={snapshot} />)
  expect(container.textContent).toContain('Объединённые диапазоны: A1:C1, AA101:AB102')
  expect(container.textContent).toContain('Title')
  snapshot.document.sheets.s.merges = ['<img src=x>']
  expect(() => parseNativeReview(snapshot)).toThrow()
})
it('retains passive document structure while removing navigation, scripts and remote resources', () => {
  const result = reviewMarkup('<meta http-equiv="refresh" content="0;url=https://evil.example"><script>steal()</script><p onclick="steal()" style="color: red; background-image:url(https://evil.example);position:fixed"><strong>План</strong></p><table><tr><td colspan="2">Итог</td></tr></table><a href="javascript:steal()">Ссылка</a><img src="https://evil.example"><svg onload="steal()"></svg>')
  expect(result).toContain('<strong>План</strong>')
  expect(result).toContain('colspan="2"')
  expect(result).toContain('color: red')
  expect(result).toContain('Ссылка')
  expect(result).not.toMatch(/steal|evil|script|onclick|href|src|svg|meta|position|background-image/)
})

it('preserves list numbering and nesting without accepting malformed numbering attributes', () => {
  const container = document.createElement('div')
  container.innerHTML = reviewMarkup('<ol start="7"><li>First<ul><li>Nested</li></ul></li><li value="10">Next</li></ol><ol start="2147483648"><li value="2x">Invalid</li></ol>')
  expect(container.querySelector('ol')?.getAttribute('start')).toBe('7')
  expect(container.querySelector('ol > li > ul > li')?.textContent).toBe('Nested')
  expect(container.querySelector('li[value]')?.getAttribute('value')).toBe('10')
  expect(container.querySelectorAll('ol')[1].hasAttribute('start')).toBe(false)
  expect(container.querySelectorAll('ol')[1].querySelector('li')?.hasAttribute('value')).toBe(false)
})

it('shows every presentation slide and full structural data without executing markup', () => {
  const snapshot = { format: 'cloudflareos.presentation' as const, formatVersion: 1 as const,
    document: { themeVersion: 'workspace.1', slides: [
      { id: 'one', background: { color: '#ffeeaa' }, blocks: [{ id: 'b1', type: 'text', props: { text: '<img src="https://example.invalid/secret" onerror="steal()">' } }] },
      { id: 'two', blocks: [{ id: 'b2', type: 'svg', props: { markup: '<svg onload="steal()"></svg>', alt: 'Диаграмма' } }] },
    ] } }
  const view = parseNativeReview(snapshot)
  expect(view.title).toBe('Презентация')
  expect(view.slides).toHaveLength(2)
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(<NativeReviewSnapshot snapshot={snapshot} />)
  expect(container.textContent).toContain('Слайд 2')
  expect(container.textContent).toContain('Диаграмма')
  expect(container.textContent).toContain('#ffeeaa')
  expect(container.querySelectorAll('details')).toHaveLength(2)
  expect(container.querySelector('img,svg,script,iframe')).toBeNull()
  const bad = structuredClone(snapshot)
  bad.document.slides[1].id = 'one'
  expect(() => parseNativeReview(bad)).toThrow()
})
