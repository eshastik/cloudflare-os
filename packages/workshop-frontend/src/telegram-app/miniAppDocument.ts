// Сохранение и версии документа в Mini App. Тело документа идёт из браузера прямо в хранилище Mnemos
// по билету; сервер Mini App выдаёт билеты только для своего документа, права проверяет Mnemos.
import { newWebSocketRpcSession, type RpcStub } from 'capnweb'
import type { NativeDocumentFormat, NativeDocumentSnapshot } from '@gadgets/workshop-shared/native-document'
import { MINI_APP_RPC_PATH, type MiniAppDocument, type MiniAppPublicApi } from '@gadgets/workshop-shared/telegram-mini-app'
import { uploadGatekeeperNativeDocument } from '../gatekeeperAppUpload'
import { downloadGatekeeperNativeDocument } from '../gatekeeperAppDownload'
import type { NativeSnapshotSource } from '../nativeSnapshotSource'

export type DocumentApi = RpcStub<MiniAppDocument>

/** Связь с точкой RPC Mini App: сессия уходит первым вызовом, cookie сайта не участвуют. */
export function openDocumentSession(session: string, location: Pick<Location, 'protocol' | 'host'> = window.location): { api: DocumentApi; close(): void } {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const root = newWebSocketRpcSession<MiniAppPublicApi>(`${scheme}//${location.host}${MINI_APP_RPC_PATH}`)
  const api = root.open(session) as unknown as DocumentApi
  return { api, close: () => { try { api[Symbol.dispose]() } catch { /* уже закрыто */ } try { root[Symbol.dispose]() } catch { /* уже закрыто */ } } }
}

/** Ревизия редактора из снимка; null — редактор её не сообщил. */
export function snapshotRevision(snapshot: NativeDocumentSnapshot): number | null {
  const revision = (snapshot.document as { revision?: unknown }).revision
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0 ? revision : null
}

export const DOCUMENT_CHANGED = 'DOCUMENT_CHANGED'
export const isDocumentChanged = (error: unknown) => String((error as { message?: unknown } | null)?.message ?? '').includes(DOCUMENT_CHANGED)

/** Сохранить текущий снимок редактора новой версией от base (версии, с которой правит редактор). */
export async function saveVersion({ api, read, format, storageOrigin, base, signal }: {
  api: DocumentApi; read: NativeSnapshotSource; format: NativeDocumentFormat; storageOrigin: string; base: string | null; signal: AbortSignal
}): Promise<string> {
  using writer = await api.writer()
  const head = base ?? await writer.head()
  signal.throwIfAborted()
  const snapshot = await read(format, signal)
  const upload = await uploadGatekeeperNativeDocument(snapshot, format, storageOrigin, (size, checksum) => writer.issue(head, size, checksum), signal)
  signal.throwIfAborted()
  return writer.save(head, upload, snapshotRevision(snapshot))
}

/** Первое сохранение в проект беседы: проект выбирает сервер. */
export async function createInProject({ api, read, format, storageOrigin, name, signal }: {
  api: DocumentApi; read: NativeSnapshotSource; format: NativeDocumentFormat; storageOrigin: string; name: string; signal: AbortSignal
}): Promise<void> {
  const snapshot = await read(format, signal)
  using creator = await api.creator(name)
  const upload = await uploadGatekeeperNativeDocument(snapshot, format, storageOrigin, (size, checksum) => creator.issue(size, checksum), signal)
  signal.throwIfAborted()
  await creator.save(upload, snapshotRevision(snapshot))
}

/** Скачать версию; доступ перепроверяется после передачи, до того как содержимое попадёт в редактор. */
export async function fetchVersion({ api, id, format, storageOrigin, signal }: {
  api: DocumentApi; id: string; format: NativeDocumentFormat; storageOrigin: string; signal: AbortSignal
}): Promise<NativeDocumentSnapshot> {
  using download = await api.version(id)
  const ticket = await download.issue()
  signal.throwIfAborted()
  return await downloadGatekeeperNativeDocument(storageOrigin, ticket, format, signal, () => download.validate())
}

/** Название документа для Mnemos из снимка: заголовок редактора, иначе запасное. */
export function documentName(snapshot: NativeDocumentSnapshot | null, fallback: string): string {
  const title = (snapshot?.document as { title?: unknown } | undefined)?.title
  const raw = typeof title === 'string' && title.trim() ? title : fallback
  return raw.replace(/[/\\\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Документ'
}
