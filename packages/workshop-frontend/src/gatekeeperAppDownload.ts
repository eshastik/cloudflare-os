import { isNativeDocumentFormat } from "@gadgets/workshop-shared/native-document";
import type { NativeDocumentFormat, NativeDocumentSnapshot } from "@gadgets/workshop-shared/native-document"
import type { GatekeeperDownloadTicket, GatekeeperNativeReviewDownload } from "@gadgets/workshop-shared/gatekeeper"

/** Read exact UTF-8 text directly from configured storage, without browser credentials. */
export async function downloadGatekeeperText(
  storageOrigin: string,
  ticket: GatekeeperDownloadTicket,
  signal: AbortSignal,
): Promise<string> {
  return downloadVerifiedText(storageOrigin, ticket, signal, 262144)
}

/** Получает исходный файл и проверяет доступ перед сохранением на компьютер. */
export async function downloadGatekeeperFile(storageOrigin:string,ticket:GatekeeperDownloadTicket,signal:AbortSignal,validateAccess:()=>Promise<void>):Promise<Uint8Array> {
 const bytes=await downloadVerifiedBytes(storageOrigin,ticket,signal,64*1024*1024)
 await validateAccess()
 signal.throwIfAborted()
 return bytes
}

async function downloadVerifiedBytes(
  storageOrigin: string, ticket: GatekeeperDownloadTicket, signal: AbortSignal, maxBytes: number,
): Promise<Uint8Array> {
  const failure = () => new Error('Document download failed.')
  try {
    const origin = new URL(storageOrigin), url = new URL(ticket.url)
    if (origin.protocol !== 'https:' || origin.origin !== storageOrigin ||
        url.origin !== storageOrigin || url.username || url.password || url.hash ||
        ticket.method !== 'GET' || !Number.isSafeInteger(ticket.size_bytes) ||
        ticket.size_bytes < 0 || ticket.size_bytes > maxBytes ||
        typeof ticket.sha256_hex !== 'string' || !/^[0-9a-f]{64}$/.test(ticket.sha256_hex)) throw failure()
    const lifetime = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
    lifetime.throwIfAborted()
    const response = await fetch(url.href, { signal: lifetime, credentials: 'omit',
      redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' })
    if (!response.ok || !response.body) { await response.body?.cancel(); throw failure() }
    const reader = response.body.getReader()
    const bytes = new Uint8Array(ticket.size_bytes)
    let offset = 0
    try {
      for (;;) {
        lifetime.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        if (offset + value.byteLength > bytes.byteLength) throw failure()
        bytes.set(value, offset); offset += value.byteLength
      }
    } finally { await reader.cancel(); reader.releaseLock() }
    if (offset !== bytes.byteLength) throw failure()
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    if (Array.from(hash, b => b.toString(16).padStart(2, '0')).join('') !== ticket.sha256_hex) throw failure()
    lifetime.throwIfAborted()
    return bytes
  } catch { throw failure() }
}

async function downloadVerifiedText(storageOrigin: string, ticket: GatekeeperDownloadTicket, signal: AbortSignal, maxBytes: number): Promise<string> {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await downloadVerifiedBytes(storageOrigin, ticket, signal, maxBytes)) }
  catch { throw new Error('Document download failed.') }
}

/** Fetch a bounded office export and recheck source access before offering a local download. */
export async function downloadGatekeeperOffice(storageOrigin: string, ticket: GatekeeperDownloadTicket & {content_type: string}, format: NativeDocumentFormat, signal: AbortSignal, validateAccess: () => Promise<void>): Promise<Uint8Array> {
  const mime = format === 'cloudflareos.document' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
    format === 'cloudflareos.spreadsheet' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : format === 'cloudflareos.presentation' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : ''
  if (!mime || ticket.content_type !== mime) throw new Error('Office export format mismatch.')
  const bytes = await downloadVerifiedBytes(storageOrigin, ticket, signal, 4 * 1024 * 1024)
  await validateAccess()
  signal.throwIfAborted()
  return bytes
}

/** Keep conversion bytes unchanged so creation can verify the server's preview checksum. */
export async function downloadGatekeeperOfficePreview(storageOrigin: string, ticket: GatekeeperDownloadTicket & {content_type: string}, format: NativeDocumentFormat, signal: AbortSignal, validateAccess: () => Promise<void>): Promise<string> {
  if (!['cloudflareos.document','cloudflareos.spreadsheet','cloudflareos.presentation'].includes(format) || ticket.content_type !== `application/vnd.${format}+json`) throw new Error('Office preview format mismatch.')
  const text = await downloadVerifiedText(storageOrigin,ticket,signal,4 * 1024 * 1024)
  await validateAccess(); signal.throwIfAborted()
  return text
}

/** Download a native data envelope and recheck access before making it available to an editor. */
export async function downloadGatekeeperNativeDocument(
  storageOrigin: string,
  ticket: GatekeeperDownloadTicket & { content_type: string },
  format: NativeDocumentFormat,
  signal: AbortSignal,
  validateAccess: () => Promise<void>,
): Promise<NativeDocumentSnapshot> {
  const failure = () => new Error('Native document download failed.')
  try {
    const mime = `application/vnd.${format}+json`
    if ((!isNativeDocumentFormat(format)) ||
        (ticket.content_type !== 'application/json' && ticket.content_type !== mime)) throw failure()
    const text = await downloadVerifiedText(storageOrigin, ticket, signal, 4 * 1024 * 1024)
    const snapshot: unknown = JSON.parse(text)
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
        !('format' in snapshot) || snapshot.format !== format ||
        !('formatVersion' in snapshot) || snapshot.formatVersion !== 1 ||
        !('document' in snapshot) || !snapshot.document || typeof snapshot.document !== 'object' ||
        Array.isArray(snapshot.document) ||
        Object.keys(snapshot).some(key => !['format', 'formatVersion', 'document'].includes(key))) throw failure()
    await validateAccess()
    signal.throwIfAborted()
    return { format, formatVersion: 1, document: snapshot.document as Record<string, unknown> }
  } catch { throw failure() }
}

/** Read one approval side, including absence, only while the displayed review remains authorized. */
export async function downloadGatekeeperNativeReview(
  storageOrigin: string,
  download: Pick<GatekeeperNativeReviewDownload, 'issue' | 'validate'>,
  format: NativeDocumentFormat,
  signal: AbortSignal,
  onMetadata?: (metadata: NonNullable<Awaited<ReturnType<GatekeeperNativeReviewDownload['issue']>>>['metadata']) => void,
): Promise<NativeDocumentSnapshot | null> {
  signal.throwIfAborted()
  const ticket = await download.issue()
  if (ticket === null) {
    await download.validate()
    signal.throwIfAborted()
    return null
  }
  const snapshot = await downloadGatekeeperNativeDocument(storageOrigin, ticket, format, signal, () => download.validate())
  onMetadata?.(ticket.metadata)
  return snapshot
}
