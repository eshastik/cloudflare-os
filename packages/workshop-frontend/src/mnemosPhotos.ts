import { useEffect, useState, useSyncExternalStore } from 'react'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import type { GatekeeperNativeDocumentWriteSelector, GatekeeperPersonPhoto } from '@gadgets/workshop-shared/gatekeeper'
import { listAccounts, storesDocuments } from './accountCapabilities'
import { compressAvatar } from './avatarUtils'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { useAuthenticatedApi } from './AuthContext'

// Фотографии людей Mnemos: человек сам ставит свою, видят все люди организации. Тело идёт
// браузер ↔ хранилище напрямую (presigned PUT и GET); через RPC — только размер, сумма и ссылка.

type Api = Pick<RpcStub<AuthenticatedApi>, 'subscribeConnectedAccounts' | 'getGatekeeperApp'>
type Selector = RpcStub<GatekeeperNativeDocumentWriteSelector>

/** Снимок фотографий одного подключения: me — служебный ключ вызывающего, photos — id → ссылка. */
export type PhotoBook = { me: string; photos: Map<string, string>; origin: string }

const EMPTY: PhotoBook = { me: '', photos: new Map(), origin: '' }
/** Ссылки живут 15 минут; перечитываем раньше, чтобы показ не упирался в истёкшую подпись. */
const FRESH_MS = 10 * 60 * 1000

let book: PhotoBook = EMPTY
let loadedAt = 0
let pending: Promise<PhotoBook> | null = null
const listeners = new Set<() => void>()
function publish(next: PhotoBook) { book = next; loadedAt = Date.now(); for (const l of listeners) l() }

/** Ссылка годится для показа, только если ведёт в хранилище этого подключения по https. */
export function photoMap(photos: GatekeeperPersonPhoto[], origin: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const p of photos) {
    try {
      const url = new URL(p.url)
      if (url.protocol === 'https:' && !url.username && !url.password && (!origin || url.origin === origin)) out.set(p.id, url.href)
    } catch { /* ссылку, которую нельзя разобрать, не показываем */ }
  }
  return out
}

async function withSelector<T>(api: Api, use: (selector: Selector, origin: string) => Promise<T>): Promise<T | null> {
  const account = (await listAccounts(api)).find(storesDocuments)
  if (!account) return null
  const frame = await api.getGatekeeperApp(account.vendorId, account.id)
  try {
    const selector = frame?.nativeWrites?.selector as Selector | undefined
    if (!selector || !frame?.nativeWrites) return null
    return await use(selector, frame.nativeWrites.storageOrigin)
  } finally { disposeGatekeeperFrame(frame) }
}

/** Перечитать фотографии (без повторов, пока идёт чтение). Сбой оставляет прежний снимок. */
export function refreshPhotos(api: Api): Promise<PhotoBook> {
  pending ??= withSelector(api, async (selector, origin) => {
    const [me, list] = await Promise.all([selector.reviewerIdentity(), selector.peoplePhotos()])
    return { me, photos: photoMap(list.photos, origin), origin }
  }).then(next => { publish(next ?? EMPTY); return book }, () => book).finally(() => { pending = null })
  return pending
}

/** Снимок фотографий подключения Mnemos для показа аватаров; перечитывается раз в 10 минут. */
export function useMnemosPhotos(api: Api | null | undefined): PhotoBook {
  const current = useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l) } }, () => book, () => EMPTY)
  useEffect(() => {
    if (api && Date.now() - loadedAt > FRESH_MS) void refreshPhotos(api)
  }, [api])
  return current
}

/** Ссылка на фото человека из общего снимка или null. Один снимок на вкладку: экраны своих чтений фото не делают. */
export function useMnemosPhoto(id: string | undefined): string | null {
  const { authenticatedApi } = useAuthenticatedApi()
  const current = useMnemosPhotos(authenticatedApi)
  return id ? current.photos.get(id) ?? null : null
}

// Пользователь оболочки → принципал Mnemos (склейка на сервере: принципал из справочника входа или
// почта). Нужен, чтобы аватар пользователя платформы брал фото из того же снимка. Запросы одного
// прохода отрисовки идут одним вызовом; ответ держится 10 минут, как и снимок фото.
type PrincipalApi = { mnemosPrincipals?(ids: string[]): Promise<Record<string, string>> }
const principals = new Map<string, { at: number; principal: string | null }>()
const principalWaiters = new Map<string, ((principal: string | null) => void)[]>()
let principalBatch: { api: PrincipalApi; ids: Set<string> } | null = null

async function flushPrincipals() {
  const batch = principalBatch
  principalBatch = null
  if (!batch) return
  const ids = [...batch.ids]
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200)
    let found: Record<string, string> | null = null
    try { found = await batch.api.mnemosPrincipals!(part) } catch { found = null }
    for (const id of part) {
      const principal = typeof found?.[id] === 'string' ? found[id]! : null
      // Сбой не запоминаем надолго: пустой ответ живёт столько же, сколько удачный, а сбой — до следующего запроса.
      if (found) principals.set(id, { at: Date.now(), principal })
      for (const done of principalWaiters.get(id) ?? []) done(principal)
      principalWaiters.delete(id)
    }
  }
}

/** Принципал Mnemos пользователя оболочки или null, пока связи нет. */
export function mnemosPrincipal(api: PrincipalApi, userId: string): Promise<string | null> {
  const known = principals.get(userId)
  if (known && Date.now() - known.at < FRESH_MS) return Promise.resolve(known.principal)
  if (typeof api.mnemosPrincipals !== 'function') return Promise.resolve(null)
  return new Promise(resolve => {
    const waiting = principalWaiters.get(userId)
    if (waiting) { waiting.push(resolve); return }
    principalWaiters.set(userId, [resolve])
    if (!principalBatch || principalBatch.api !== api) {
      void flushPrincipals()
      principalBatch = { api, ids: new Set() }
      setTimeout(() => void flushPrincipals(), 0)
    }
    principalBatch.ids.add(userId)
  })
}

/** Для тестов: забыть склейку пользователей с принципалами. */
export function forgetMnemosPrincipals() { principals.clear(); principalWaiters.clear(); principalBatch = null }

/** Фото из Mnemos для пользователя оболочки (по склейке с принципалом) или null. */
export function useUserMnemosPhoto(userId: string | null | undefined): string | null {
  const { authenticatedApi } = useAuthenticatedApi()
  const [principal, setPrincipal] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    setPrincipal(null)
    if (userId) void mnemosPrincipal(authenticatedApi as unknown as PrincipalApi, userId).then(p => { if (current) setPrincipal(p) })
    return () => { current = false }
  }, [authenticatedApi, userId])
  return useMnemosPhoto(principal ?? undefined)
}

/** Сумма SHA-256 в base64 — так её подписывает хранилище в x-amz-checksum-sha256. */
async function checksumOf(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
  return btoa(String.fromCharCode(...digest))
}

/**
 * Загрузить свою фотографию: браузер режет снимок до квадрата 256×256 и сжимает в JPEG,
 * кладёт тело прямо в хранилище по билету и просит сервер сделать его фотографией.
 */
export async function uploadMyPhoto(api: Api, file: File): Promise<void> {
  const bytes = await compressAvatar(file)
  const done = await withSelector(api, async (selector, origin) => {
    const checksum = await checksumOf(bytes)
    const ticket = await selector.beginPhotoUpload(bytes.byteLength, checksum)
    const url = new URL(ticket.url)
    if (url.origin !== origin || url.protocol !== 'https:' || ticket.method !== 'PUT' || ticket.checksum_value !== checksum || ticket.content_length !== bytes.byteLength) throw new Error('Хранилище выдало неверный билет загрузки.')
    const response = await fetch(url.href, { method: 'PUT', body: bytes as BodyInit, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
      headers: { 'x-amz-checksum-sha256': checksum }, signal: AbortSignal.timeout(30_000) })
    await response.body?.cancel()
    if (!response.ok) throw new Error('Хранилище не приняло фотографию.')
    await selector.savePhoto(ticket.upload_id)
    return true
  })
  if (!done) throw new Error('Подключение Mnemos недоступно.')
  loadedAt = 0
  await refreshPhotos(api)
}

/** Убрать свою фотографию. */
export async function removeMyPhoto(api: Api): Promise<void> {
  const done = await withSelector(api, async selector => { await selector.removePhoto(); return true })
  if (!done) throw new Error('Подключение Mnemos недоступно.')
  loadedAt = 0
  await refreshPhotos(api)
}
