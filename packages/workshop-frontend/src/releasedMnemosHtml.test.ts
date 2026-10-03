// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { releasedMnemosHtml, sha256Hex } from './gatekeeperFrameCache'

afterEach(() => { document.head.innerHTML = ''; vi.restoreAllMocks() })

it('без закреплённой сборки сохраняет интерфейс сервера', async () => {
  expect(await releasedMnemosHtml('server')).toBe('server')
})

it('загружает закреплённую сборку и отклоняет повреждённую', async () => {
  const html = '<html><body>new</body></html>'
  const hash = await sha256Hex(html)
  document.head.innerHTML = `<meta name="mnemos-app-sha256" content="${hash}">`
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(html))
  expect(await releasedMnemosHtml('old')).toBe(html)
  expect(fetcher).toHaveBeenCalledWith(`/_mnemos-ui/${hash}.html`, { credentials: 'omit', redirect: 'error' })
  fetcher.mockResolvedValueOnce(new Response('wrong'))
  await expect(releasedMnemosHtml('old')).rejects.toThrow('повреждена')
  fetcher.mockResolvedValueOnce(new Response('', { status: 404 }))
  await expect(releasedMnemosHtml('old')).rejects.toThrow('Не удалось загрузить')
})
