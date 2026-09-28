// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { GatekeeperAppFrame } from '@gadgets/workshop-shared/api'
import { createFrameStore, loadGatekeeperFrame, sha256Hex, type FrameStore } from './gatekeeperFrameCache'

const dispose = vi.hoisted(() => vi.fn<(frame: unknown) => void>())
vi.mock('./disposeGatekeeperFrame', () => ({ disposeGatekeeperFrame: dispose }))

const HTML = '<!doctype html><script>app()</script>'

/** Сервер как в gatekeeper-app-frame.ts: при известном хеше сборку не отдаёт. */
async function server(html = HTML) {
  const hash = await sha256Hex(html)
  const calls: (string[] | undefined)[] = []
  const api = {
    getGatekeeperApp: vi.fn(async (_id: string, _account?: number, known?: string[]) => {
      calls.push(known)
      const omitted = !!known?.includes(hash)
      // Ответ capnweb неизменяем, как и здесь.
      return Object.freeze({ iframeHtml: omitted ? '' : html, iframeHtmlSha256: hash, accountId: 3, ...(omitted ? { iframeHtmlOmitted: true } : {}), ui: {} }) as unknown as GatekeeperAppFrame
    }),
  }
  return { api, hash, calls }
}

/** Cache Storage в памяти: ровно то, что нужно хранилищу сборок. */
function fakeCaches() {
  const entries = new Map<string, string>()
  const cache = {
    async keys() { return [...entries.keys()].map(url => new Request(url)) },
    async match(request: Request) { const body = entries.get(request.url); return body === undefined ? undefined : new Response(body) },
    async put(request: Request, response: Response) { entries.set(request.url, await response.text()) },
    async delete(request: Request) { return entries.delete(request.url) },
  }
  return { entries, storage: { open: async () => cache } as unknown as CacheStorage }
}

describe('сборка фрейма по хешу', () => {
  it('первое открытие — полная передача, второе — без сборки, из сохранённой копии', async () => {
    const { api, hash, calls } = await server()
    const store = createFrameStore(undefined)
    expect((await loadGatekeeperFrame(api, 'mnemos', undefined, store))!.iframeHtml).toBe(HTML)
    const second = await loadGatekeeperFrame(api, 'mnemos', undefined, store)
    expect(second!.iframeHtml).toBe(HTML)
    expect(calls).toEqual([undefined, [hash]])
  })

  it('подменённая сохранённая сборка не вставляется: копия удаляется, сборка запрашивается целиком', async () => {
    const { api, hash, calls } = await server()
    const { entries, storage } = fakeCaches()
    const store = createFrameStore(storage)
    await loadGatekeeperFrame(api, 'mnemos', undefined, store)
    // Запись в Cache Storage идёт в фоне и открытие не задерживает.
    await vi.waitFor(() => expect(entries.size).toBe(1))
    const key = [...entries.keys()].find(url => url.endsWith(hash))!
    expect(entries.get(key)).toBe(HTML)
    // Чужой код того же адреса подменил сборку в Cache Storage; память вкладки пуста (новая вкладка).
    entries.set(key, '<!doctype html><script>steal()</script>')
    dispose.mockClear()
    const frame = await loadGatekeeperFrame(api, 'mnemos', undefined, createFrameStore(storage))
    expect(frame!.iframeHtml).toBe(HTML)
    expect(calls).toEqual([undefined, [hash], undefined])
    expect(dispose).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(entries.get(key)).toBe(HTML))
  })

  it('неизвестный серверу хеш — полная передача, новая сборка вытесняет старую', async () => {
    const old = await server('<p>old</p>')
    const store = createFrameStore(undefined)
    await loadGatekeeperFrame(old.api, 'mnemos', undefined, store)
    const fresh = await server()
    const frame = await loadGatekeeperFrame(fresh.api, 'mnemos', undefined, store)
    expect(fresh.calls).toEqual([[old.hash]])
    expect(frame!.iframeHtml).toBe(HTML)
    expect(await store.hashes('mnemos')).toEqual([old.hash, fresh.hash])
  })

  it('сборка, не совпавшая с хешем сервера, не сохраняется', async () => {
    const store: FrameStore = createFrameStore(undefined)
    const api = { getGatekeeperApp: vi.fn(async () => ({ iframeHtml: HTML, iframeHtmlSha256: '0'.repeat(64), accountId: 1, ui: {} }) as unknown as GatekeeperAppFrame) }
    await loadGatekeeperFrame(api, 'mnemos', 1, store)
    expect(await store.hashes('mnemos')).toEqual([])
  })

  it('пропавшая копия — повторный запрос целиком; сборки разных приложений не смешиваются', async () => {
    const { api, hash, calls } = await server()
    const store = createFrameStore(undefined)
    await loadGatekeeperFrame(api, 'mnemos', undefined, store)
    await store.delete('mnemos', hash)
    await store.put('context', hash, HTML)
    expect((await loadGatekeeperFrame(api, 'mnemos', undefined, store))!.iframeHtml).toBe(HTML)
    expect(calls).toEqual([undefined, undefined])
  })
})
