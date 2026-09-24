import type { RefObject } from 'react'
import type { NativeDocumentFormat, NativeDocumentSnapshot } from '@gadgets/workshop-shared/native-document'

export type NativeSnapshotSource = (format: NativeDocumentFormat, signal: AbortSignal) => Promise<NativeDocumentSnapshot>
export type NativeSnapshotSourceRef = RefObject<NativeSnapshotSource | null>

/** Ask only the displayed editor to flush and export data; sends no account authority. */
export function requestNativeSnapshot(target: Window, format: NativeDocumentFormat, signal: AbortSignal): Promise<NativeDocumentSnapshot> {
  return new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel()
    const lifetime = AbortSignal.any([signal, AbortSignal.timeout(20_000)])
    const cleanup = () => { port1.close(); port2.close(); lifetime.removeEventListener('abort', cancel) }
    const cancel = () => { cleanup(); reject(new Error('Редактор не отдал документ.')) }
    if (lifetime.aborted) { cancel(); return }
    lifetime.addEventListener('abort', cancel, { once: true })
    port1.onmessage = event => {
      cleanup()
      const snapshot = event.data?.snapshot
      if (!snapshot || snapshot.format !== format || snapshot.formatVersion !== 1 ||
          !snapshot.document || typeof snapshot.document !== 'object' || Array.isArray(snapshot.document) ||
          Object.keys(snapshot).some(key => !['format', 'formatVersion', 'document'].includes(key))) {
        reject(new Error('Редактор не смог сохранить текущую версию.')); return
      }
      resolve(snapshot)
    }
    port1.onmessageerror = cancel
    try { target.postMessage({ type: 'native-snapshot-request', format }, '*', [port2]) }
    catch { cancel() }
  })
}

/**
 * Запросы снимка к одному редактору по очереди. Редактор отвечает на один запрос за раз и на второй,
 * пришедший во время первого, отказывает; шапка же спрашивает снимок из нескольких мест сразу (опрос правок,
 * название, открытие версии, сохранение). Без очереди случайный отказ оставлял ревизию сохранения неизвестной
 * и обрывал открытие документа.
 */
export function queueNativeSnapshots(read: NativeSnapshotSource): NativeSnapshotSource {
  let tail: Promise<unknown> = Promise.resolve(), waiting = 0
  return (format, signal) => {
    // Свободный редактор получает запрос сразу, без лишнего шага очереди.
    const turn = waiting === 0 ? (signal.aborted ? Promise.reject(signal.reason) : read(format, signal)) : tail.then(() => { signal.throwIfAborted(); return read(format, signal) })
    waiting++
    const settled = turn.then(() => {}, () => {}).finally(() => { waiting-- })
    tail = settled
    return turn
  }
}
