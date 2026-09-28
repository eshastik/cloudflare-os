// Сборка фрейма приложения (у Mnemos 1,25 МБ) хранится в браузере по SHA-256: в памяти вкладки и в
// Cache Storage. Сервер получает хеши сохранённых сборок и при совпадении не передаёт сборку повторно.
// Сохранённую сборку перед вставкой сверяем с хешем от сервера: подменённая или повреждённая копия не
// вставляется, вместо неё запрашивается полная. Изоляция фрейма (sandbox, CSP сборки) от этого не меняется.
import { MAX_KNOWN_FRAME_HASHES, type AuthenticatedApi, type GatekeeperAppFrame } from '@gadgets/workshop-shared/api'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'

const CACHE_NAME = 'gatekeeper-frames-v1'
/** Сколько сборок одного приложения хранится: текущая и предыдущая (на время выпуска). */
const KEEP_PER_APP = 2
const HASH = /^[0-9a-f]{64}$/

export interface FrameStore {
  hashes(appId: string): Promise<string[]>
  get(appId: string, hash: string): Promise<string | undefined>
  put(appId: string, hash: string, html: string): Promise<void>
  delete(appId: string, hash: string): Promise<void>
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Память вкладки поверх Cache Storage; без Cache Storage (не https, приватный режим) — только память. */
export function createFrameStore(storage: CacheStorage | undefined = typeof caches === 'undefined' ? undefined : caches): FrameStore {
  const memory = new Map<string, Map<string, string>>()
  const key = (appId: string, hash: string) => new Request(`${location.origin}/__gatekeeper-frame/${encodeURIComponent(appId)}/${hash}`)
  const open = async () => { try { return storage ? await storage.open(CACHE_NAME) : undefined } catch { return undefined } }
  const prefix = (appId: string) => `/__gatekeeper-frame/${encodeURIComponent(appId)}/`
  return {
    async hashes(appId) {
      const found = [...(memory.get(appId)?.keys() ?? [])]
      const cache = await open()
      if (cache) {
        try {
          for (const request of await cache.keys()) {
            const path = new URL(request.url).pathname
            if (!path.startsWith(prefix(appId))) continue
            const hash = path.slice(prefix(appId).length)
            if (HASH.test(hash) && !found.includes(hash)) found.push(hash)
          }
        } catch { /* хранилище недоступно: работаем с памятью */ }
      }
      return found.slice(0, MAX_KNOWN_FRAME_HASHES)
    },
    async get(appId, hash) {
      const held = memory.get(appId)?.get(hash)
      if (held !== undefined) return held
      const cache = await open()
      try {
        const response = await cache?.match(key(appId, hash))
        return response ? await response.text() : undefined
      } catch { return undefined }
    },
    async put(appId, hash, html) {
      const app = memory.get(appId) ?? new Map<string, string>()
      app.delete(hash); app.set(hash, html)
      while (app.size > KEEP_PER_APP) app.delete(app.keys().next().value!)
      memory.set(appId, app)
      const cache = await open()
      if (!cache) return
      try {
        await cache.put(key(appId, hash), new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
        for (const request of await cache.keys()) {
          const path = new URL(request.url).pathname
          if (path.startsWith(prefix(appId)) && !app.has(path.slice(prefix(appId).length))) await cache.delete(request)
        }
      } catch { /* переполнение или запрет: остаётся копия в памяти */ }
    },
    async delete(appId, hash) {
      memory.get(appId)?.delete(hash)
      const cache = await open()
      try { await cache?.delete(key(appId, hash)) } catch { /* нечего удалять */ }
    },
  }
}

let defaultStore: FrameStore | undefined

/**
 * Запрос фрейма с учётом сохранённых сборок. Сохранённая сборка вставляется, только если её SHA-256
 * совпал с хешем от сервера; иначе копия удаляется и сборка запрашивается целиком.
 */
export async function loadGatekeeperFrame(api: Pick<AuthenticatedApi, 'getGatekeeperApp'>, appId: string, accountId: number | undefined,
    store: FrameStore = (defaultStore ??= createFrameStore())): Promise<GatekeeperAppFrame | null> {
  const known = await store.hashes(appId).catch(() => [] as string[])
  let frame = known.length ? await api.getGatekeeperApp(appId, accountId, known) : await api.getGatekeeperApp(appId, accountId)
  if (!frame) return null
  if (frame.iframeHtmlOmitted) {
    const hash = frame.iframeHtmlSha256
    const html = HASH.test(hash) ? await store.get(appId, hash) : undefined
    // Ответ capnweb менять нельзя (присваивание молча не действует), поэтому новый объект с теми же ссылками.
    if (html !== undefined && await sha256Hex(html) === hash) return { ...frame, iframeHtml: html }
    await store.delete(appId, hash).catch(() => {})
    disposeGatekeeperFrame(frame)
    frame = await api.getGatekeeperApp(appId, accountId)
    if (!frame) return null
  }
  const hash = frame.iframeHtmlSha256
  if (typeof hash === 'string' && HASH.test(hash) && frame.iframeHtml && await sha256Hex(frame.iframeHtml) === hash) {
    void store.put(appId, hash, frame.iframeHtml).catch(() => {})
  }
  return frame
}
