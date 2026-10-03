/** Кэш изображений по SHA-256: максимум 100 записей и 10 МиБ, без ссылок с подписями. */
const NAME = 'mnemos-profile-images-v1'
const MAX_BYTES = 10 * 1024 * 1024
const MAX_COUNT = 100

/** Кэш необязателен: приватный режим, квота или повреждение не мешают сетевой загрузке. */
export async function browserPhoto(version: string, download: () => Promise<Uint8Array>): Promise<Uint8Array> {
  const key = new URL('/_profile-image-cache/' + version, typeof location === 'undefined' ? 'https://cache.invalid' : location.origin).href
  let cache: Cache | null = null
  try { cache = await caches.open(NAME) } catch { /* кэш может быть запрещён браузером */ }
  const valid = async (bytes: Uint8Array) => {
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(b => b.toString(16).padStart(2, '0')).join('')
    return sha === version
  }
  try {
    const response = await cache?.match(key)
    if (response) {
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (await valid(bytes)) return bytes
      await cache?.delete(key)
    }
  } catch { cache = null }
  const bytes = await download()
  if (!await valid(bytes)) throw new Error('Не совпала версия фотографии')
  try {
    if (cache && bytes.byteLength <= 512 * 1024) {
      await cache.delete(key)
      await cache.put(key, new Response(new Uint8Array(bytes), { headers: { 'Content-Length': String(bytes.byteLength) } }))
      const keys = await cache.keys()
      let total = 0
      for (let i = keys.length - 1; i >= 0; i--) {
        const response = await cache.match(keys[i]!)
        total += Number(response?.headers.get('Content-Length') ?? MAX_BYTES)
        if (total > MAX_BYTES || keys.length - i > MAX_COUNT) await cache.delete(keys[i]!)
      }
    }
  } catch { /* исчерпанный кэш не отменяет загрузку */ }
  return bytes
}
