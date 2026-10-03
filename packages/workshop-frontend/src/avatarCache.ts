import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { browserPhoto } from './browserPhotoCache'
import { avatarBlobUrl } from './avatarUtils'

type Api = Pick<AuthenticatedApi, 'getAvatar' | 'getAvatarReference'>
const LIMIT = 100
const memory = new Map<string, string | null>()
const loadedAt = new Map<string, number>()
const pending = new Map<string, Promise<string | null>>()
let currentApi: Api | null = null
let generation = 0
const revisions = new Map<string, number>()
const listeners = new Set<() => void>()

/** Изменение версии заставляет все экземпляры аватара перечитать данные. */
export function avatarRevision(id: string) { return revisions.get(id) ?? 0 }
/** Подписка компонентов на замену изображения. */
export function subscribeAvatarRevision(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
/** Забыть снимок сессии; поздние ответы предыдущей сессии отбрасываются. */
export function clearAvatarMemory() {
  generation++
  for (const url of memory.values()) if (url) URL.revokeObjectURL(url)
  memory.clear(); loadedAt.clear(); pending.clear(); revisions.clear(); currentApi = null
}
/** Забыть конкретное фото после сохранения или снятия. */
export function invalidateAvatarCache(id: string) {
  const url = memory.get(id)
  if (url) URL.revokeObjectURL(url)
  memory.delete(id); loadedAt.delete(id); pending.delete(id)
  revisions.set(id, avatarRevision(id) + 1)
  for (const listener of listeners) listener()
}

async function cachedBytes(api: Api, id: string): Promise<Uint8Array | null> {
  const photo = await api.getAvatarReference(id)
  // Старые установки до переключения S3 сохраняют прежнее чтение.
  if (!photo) return api.getAvatar(id)
  if (!/^[0-9a-f]{64}$/.test(photo.version) || photo.sizeBytes < 1 || photo.sizeBytes > 102400
      || !['image/jpeg', 'image/png'].includes(photo.mediaType) || new URL(photo.url).protocol !== 'https:') throw new Error('Неверные метаданные фотографии')
  const bytes = await browserPhoto(photo.version, async () => {
    const response = await fetch(photo.url, { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) { await response.body?.cancel(); throw new Error('Фотография недоступна') }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength !== photo.sizeBytes) throw new Error('Неверный размер фотографии')
    return bytes
  })
  return bytes
}

/** Одна загрузка на пользователя; сбой не запоминается как отсутствие фотографии. */
export async function loadAvatar(api: Api, id: string): Promise<string | null> {
  if (currentApi !== api) { clearAvatarMemory(); currentApi = api }
  const known = memory.get(id)
  if (memory.has(id) && Date.now() - (loadedAt.get(id) ?? 0) < 120_000) { memory.delete(id); memory.set(id, known!); return known! }
  const waiting = pending.get(id)
  if (waiting) return waiting
  const revision = avatarRevision(id), started = generation
  const task = cachedBytes(api, id).then(bytes => {
    if (started !== generation || revision !== avatarRevision(id) || pending.get(id) !== task) return null
    const url = bytes?.byteLength ? avatarBlobUrl(bytes) : null
    while (memory.size >= LIMIT) {
      const oldest = memory.keys().next().value!
      const prior = memory.get(oldest)
      if (prior) URL.revokeObjectURL(prior)
      memory.delete(oldest); loadedAt.delete(oldest); revisions.delete(oldest)
    }
    const prior = memory.get(id)
    if (prior) URL.revokeObjectURL(prior)
    memory.set(id, url); loadedAt.set(id, Date.now())
    return url
  }).finally(() => { if (pending.get(id) === task) pending.delete(id) })
  pending.set(id, task)
  return task
}
