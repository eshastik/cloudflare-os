import type { GatekeeperPersonPhoto } from '@gadgets/workshop-shared/gatekeeper'

// Фотографии людей для встроенного приложения Mnemos. Фрейм сети не имеет (CSP connect-src 'none',
// img-src только blob:), поэтому оболочка сама скачивает фото по ссылке из хранилища и отдаёт фрейму
// байты; фрейм показывает их через blob:-адрес. Так фрейму не нужно разрешение ходить в хранилище.

export type FramePhoto = { sha256: string; type: string; bytes: Uint8Array }
type PhotoLister = { peoplePhotos(): Promise<{ photos: GatekeeperPersonPhoto[] }> }
type Listing = Map<string, GatekeeperPersonPhoto>

/** Ссылки живут 15 минут; список перечитывается раньше, чтобы скачивание не упиралось в истёкшую подпись. */
export const PHOTO_LIST_FRESH_MS = 10 * 60 * 1000
/** Аватар сжимается в браузере до 256×256; больший ответ — не фотография человека. */
export const MAX_PHOTO_BYTES = 1024 * 1024
const MAX_CACHED_PHOTOS = 2000
const MAX_PARALLEL_DOWNLOADS = 6

/** Тип картинки по первым байтам; всё прочее (в том числе SVG) не показывается. */
export function photoType(bytes: Uint8Array): string | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')
}

// Байты общие для всех фреймов вкладки и ключуются суммой: одна и та же фотография скачивается один раз,
// пока не сменится. Сумма сверяется с байтами, поэтому общий ключ безопасен.
const downloaded = new Map<string, Promise<FramePhoto | null>>()

/** Для тестов: забыть скачанное. */
export function forgetDownloadedPhotos() { downloaded.clear() }

export class FramePersonPhotos {
  readonly #lister: PhotoLister & { [Symbol.dispose]?(): void }
  readonly #origin: string
  readonly #fetch: typeof fetch
  readonly #now: () => number
  readonly #lifetime = new AbortController()
  #listing: Promise<Listing> | null = null
  /** До этого момента список годен: не позже 10 минут и за минуту до самой ранней подписи. */
  #until = 0
  #active = 0
  readonly #queue: (() => void)[] = []

  constructor(lister: PhotoLister, storageOrigin: string, options: { fetch?: typeof fetch; now?: () => number } = {}) {
    const dup = (lister as { dup?: () => PhotoLister }).dup
    this.#lister = typeof dup === 'function' ? dup.call(lister) : lister
    this.#origin = storageOrigin
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init))
    this.#now = options.now ?? Date.now
  }

  /** Фото человека или null, если его нет или оно не скачалось. */
  async photo(id: string): Promise<FramePhoto | null> {
    if (typeof id !== 'string' || !id || id.length > 255) return null
    this.#lifetime.signal.throwIfAborted()
    const entry = (await this.#list()).get(id)
    if (!entry || !/^[0-9a-f]{64}$/.test(entry.sha256)) return null
    let bytes = downloaded.get(entry.sha256)
    if (!bytes) {
      bytes = this.#limited(() => this.#download(entry)).catch(() => null)
      downloaded.set(entry.sha256, bytes)
      // Неудачу не запоминаем: следующий запрос попробует снова.
      void bytes.then(result => { if (!result && downloaded.get(entry.sha256) === bytes) downloaded.delete(entry.sha256) })
      while (downloaded.size > MAX_CACHED_PHOTOS) downloaded.delete(downloaded.keys().next().value!)
    }
    return bytes
  }

  #list(): Promise<Listing> {
    if (this.#listing && this.#now() < this.#until) return this.#listing
    const at = this.#now()
    this.#until = at + PHOTO_LIST_FRESH_MS
    const listing = this.#lister.peoplePhotos().then(({ photos }) => {
      const map: Listing = new Map()
      let until = at + PHOTO_LIST_FRESH_MS
      for (const photo of Array.isArray(photos) ? photos : []) {
        if (!photo || typeof photo.id !== 'string' || typeof photo.url !== 'string' || typeof photo.sha256 !== 'string') continue
        map.set(photo.id, photo)
        // Самая ранняя подпись минус минута запаса: к этому сроку список перечитывается.
        const expires = Date.parse(photo.expiresAt)
        if (Number.isFinite(expires)) until = Math.min(until, expires - 60_000)
      }
      if (this.#listing === listing) this.#until = until
      return map
    })
    this.#listing = listing
    listing.catch(() => { if (this.#listing === listing) this.#listing = null })
    return listing
  }

  async #limited<T>(run: () => Promise<T>): Promise<T> {
    if (this.#active >= MAX_PARALLEL_DOWNLOADS) await new Promise<void>(resolve => this.#queue.push(resolve))
    this.#active++
    try { return await run() }
    finally { this.#active--; this.#queue.shift()?.() }
  }

  async #download(photo: GatekeeperPersonPhoto): Promise<FramePhoto | null> {
    const url = new URL(photo.url)
    if (url.protocol !== 'https:' || url.origin !== this.#origin || url.username || url.password) return null
    const signal = AbortSignal.any([this.#lifetime.signal, AbortSignal.timeout(30_000)])
    const response = await this.#fetch(url.href, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' })
    if (!response.ok) { await response.body?.cancel(); return null }
    const declared = Number(response.headers.get('content-length') ?? '0')
    if (declared > MAX_PHOTO_BYTES) { await response.body?.cancel(); return null }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_PHOTO_BYTES) return null
    const type = photoType(bytes)
    if (!type || await sha256Hex(bytes) !== photo.sha256) return null
    return { sha256: photo.sha256, type, bytes }
  }

  dispose() {
    this.#lifetime.abort()
    for (const resolve of this.#queue.splice(0)) resolve()
    this.#lister[Symbol.dispose]?.()
  }
}
