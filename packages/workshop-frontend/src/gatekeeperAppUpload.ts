import { decodeBlueprintTemplate, MAX_BLUEPRINT_TEMPLATE_BYTES } from "@gadgets/workshop-shared/blueprint-template";
import { isNativeDocumentFormat } from "@gadgets/workshop-shared/native-document";
import type { GatekeeperUploadTicket } from "@gadgets/workshop-shared/gatekeeper"
import type { NativeDocumentFormat, NativeDocumentSnapshot } from "@gadgets/workshop-shared/native-document"
export type { GatekeeperUploadTicket } from "@gadgets/workshop-shared/gatekeeper"

/** Issued by the host's authenticated capability, never supplied by the iframe. */
export type IssueGatekeeperUpload = (
  size: number, checksum: string, signal: AbortSignal,
) => Promise<GatekeeperUploadTicket>

const MAX_TEXT_BYTES = 256 * 1024

/**
 * Transfers a bounded text edit directly from the browser to S3. The trusted host
 * supplies the storage origin and ticket issuer; the iframe supplies only text.
 * Returns the receipt ID for a separate draft save, without publishing anything.
 */
export async function uploadGatekeeperText(
  text: string,
  storageOrigin: string,
  issue: IssueGatekeeperUpload,
  signal: AbortSignal,
): Promise<string> {
  return uploadVerifiedText(text, storageOrigin, issue, signal, MAX_TEXT_BYTES)
}

/** Upload a native data envelope without including code, bindings or credentials. */
export async function uploadGatekeeperNativeDocument(
  snapshot: NativeDocumentSnapshot, format: NativeDocumentFormat, storageOrigin: string,
  issue: IssueGatekeeperUpload, signal: AbortSignal,
): Promise<string> {
  if (!snapshot || (!isNativeDocumentFormat(format)) ||
      snapshot.format !== format || snapshot.formatVersion !== 1 || !snapshot.document ||
      typeof snapshot.document !== 'object' || Array.isArray(snapshot.document) ||
      Object.keys(snapshot).some(key => !['format', 'formatVersion', 'document'].includes(key))) throw new Error('Invalid native document snapshot.')
  const text = JSON.stringify({ format, formatVersion: 1, document: snapshot.document })
  return uploadVerifiedText(text, storageOrigin, issue, signal, 4 * 1024 * 1024)
}

/** Upload exact preview text: reserialization would change the server-bound checksum. */
export async function uploadGatekeeperOfficePreview(text: string, storageOrigin: string, issue: IssueGatekeeperUpload, signal: AbortSignal): Promise<string> {
  return uploadVerifiedText(text,storageOrigin,issue,signal,4 * 1024 * 1024)
}

/** Проверяет снимок кода и данных перед загрузкой в существующее хранилище. */
export async function uploadGatekeeperBlueprintTemplate(bytes: Uint8Array, storageOrigin: string, issue: IssueGatekeeperUpload, signal: AbortSignal): Promise<string> {
  await decodeBlueprintTemplate(bytes);
  signal.throwIfAborted();
  return uploadVerifiedText(new TextDecoder("utf-8", {fatal:true}).decode(bytes), storageOrigin, issue, signal, MAX_BLUEPRINT_TEMPLATE_BYTES);
}

async function uploadVerifiedText(
  text: string, storageOrigin: string, issue: IssueGatekeeperUpload, signal: AbortSignal, maxBytes: number,
): Promise<string> {
  const failed = () => new Error('Document upload failed.')
  let origin: URL
  try { origin = new URL(storageOrigin) } catch { throw failed() }
  if (origin.protocol !== 'https:' || origin.origin !== storageOrigin) throw failed()
  if (typeof text !== 'string' || text.length > maxBytes) throw failed()
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength > maxBytes) throw failed()
  const lifetime = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
  lifetime.throwIfAborted()
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const checksum = btoa(String.fromCharCode(...digest))
  lifetime.throwIfAborted()
  // Do not let an RPC or fetch exception expose a signed URL in the UI/logs.
  try {
    const ticket = await issue(bytes.byteLength, checksum, lifetime)
    lifetime.throwIfAborted()
    const url = new URL(ticket.url)
    if (url.origin !== storageOrigin || url.username || url.password || url.hash ||
        ticket.method !== 'PUT' || ticket.checksum_header !== 'x-amz-checksum-sha256' ||
        ticket.checksum_value !== checksum || ticket.content_length !== bytes.byteLength ||
        typeof ticket.upload_id !== 'string' || !ticket.upload_id || ticket.upload_id.length > 255) {
      throw failed()
    }
    const response = await fetch(url.href, {
      method: 'PUT', body: bytes, signal: lifetime, credentials: 'omit',
      redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
      headers: { 'x-amz-checksum-sha256': checksum },
    })
    // The browser sets Content-Length from the exact bytes. Script cannot set it.
    await response.body?.cancel()
    lifetime.throwIfAborted()
    if (!response.ok) throw failed()
    return ticket.upload_id
  } catch { throw failed() }
}
