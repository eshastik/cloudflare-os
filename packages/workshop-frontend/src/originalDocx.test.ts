// @vitest-environment jsdom
// @ts-expect-error Node используется только средой проверок; приложение собирается с типами браузера.
import { Blob } from 'node:buffer'
// @ts-expect-error Node используется только средой проверок.
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { renderOriginalDocx } from './originalDocx'

it('DOCX сохраняет таблицу, жирный текст и разрыв страницы в изолированном читателе', async () => {
  const bytes = readFileSync('src/__fixtures__/reader.docx')
  const html = await renderOriginalDocx(new Blob([bytes]))
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  expect(parsed.querySelectorAll('section.docx')).toHaveLength(2)
  expect(parsed.querySelectorAll('table tr')).toHaveLength(2)
  expect(parsed.querySelector('table')?.textContent).toContain('ВыпускОктябрь')
  expect(parsed.body.textContent).toContain('Вторая страница')
  expect(parsed.querySelector('span')?.style.fontWeight).toBe('bold')
  expect(parsed.querySelector('meta[http-equiv]')?.getAttribute('content')).toContain("default-src 'none'")
  expect(parsed.querySelector('script')).toBeNull()
})
