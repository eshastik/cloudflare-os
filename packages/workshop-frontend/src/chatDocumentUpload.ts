import type { ChatAttachmentUploaded, Overseer } from '@gadgets/workshop-shared/api'
import { uploadIntakeFile } from '../../gatekeeper-mnemos/src/intake.ts'
import { MAX_CHAT_ATTACHMENT_BYTES, MAX_CHAT_DOCUMENT_BYTES, chatDocumentContentType } from './chatAttachmentFiles'

// Документ беседы идёт прямо в хранилище Mnemos (ADR 0003): беседе — только описание и сумма,
// байты — PUT по одноразовой ссылке. Беседа потом хранит лишь место документа.

type DocumentOverseer = Pick<Overseer, 'beginChatDocumentUpload' | 'finishChatDocumentUpload'>

export type ChatDocumentUploadOptions = {
  /** Беседа, в которую прикрепляется файл; без неё — новая беседа. */
  chatId?: number
  /** Для ещё не созданной беседы — первый выбранный в ней проект, иначе личное пространство. */
  project?: { accountId: number; projectId: string }
  send?: typeof fetch
  signal?: AbortSignal
}

export async function uploadChatDocument(
    overseer: DocumentOverseer, file: File, options: ChatDocumentUploadOptions = {}): Promise<ChatAttachmentUploaded> {
  const contentType = chatDocumentContentType(file.type, file.name)
  if (!contentType) throw new Error('Этот файл нельзя прикрепить как документ.')
  if (file.size <= 0) throw new Error(`Файл «${file.name}» пустой.`)
  if (file.size > MAX_CHAT_DOCUMENT_BYTES) throw new Error('Прямая загрузка одним PUT ограничена 5 ГиБ.')
  let token = ''
  const send = options.send ?? fetch
  await uploadIntakeFile(file, async (size, checksum) => {
    const ticket = await overseer.beginChatDocumentUpload(
      { name: file.name, mimeType: contentType, size, checksum },
      options.chatId,
      options.chatId === undefined ? options.project : undefined)
    if (new URL(ticket.upload.url).origin !== new URL(ticket.storageOrigin).origin) {
      throw new Error('Адрес хранилища не совпадает с настройкой установки')
    }
    token = ticket.token
    // У билета беседы нет upload_id приёмной: его роль играет token для finish.
    return { ...ticket.upload, upload_id: ticket.token }
  }, (url, init) => send(url, { ...init, signal: options.signal }), { maxBytes: MAX_CHAT_DOCUMENT_BYTES, digest: (source) => chatDocumentDigest(source, options.signal) })
  return await overseer.finishChatDocumentUpload(token)
}

/**
 * Выгрузка подготовленного вложения: документ — через хранилище Mnemos, остальное (картинки,
 * небольшие файлы) — прежним путём, байтами через беседу. Без подключения Mnemos документу некуда
 * лечь: текст и PDF идут прежним путём до 1 МиБ, Office и ZIP без Mnemos не прочитать.
 */
export async function uploadPreparedAttachment(
    overseer: DocumentOverseer & Pick<Overseer, 'uploadChatAttachment' | 'chatDocumentsAvailable'>,
    attachment: { blob: Blob; mimeType: string; name?: string },
    options: ChatDocumentUploadOptions & { modelId: string | null }): Promise<ChatAttachmentUploaded> {
  const { blob, name } = attachment
  let mimeType = attachment.mimeType
  const documentType = blob instanceof File ? chatDocumentContentType(blob.type || mimeType, blob.name) : undefined
  if (blob instanceof File && documentType) {
    if (await overseer.chatDocumentsAvailable()) return await uploadChatDocument(overseer, blob, options)
    if (documentType === 'application/zip') {
      throw new Error('Архивы ZIP читаются через Mnemos: подключите Mnemos к беседе.')
    }
    if (documentType.startsWith('application/vnd.openxmlformats-officedocument.')) {
      throw new Error('Документы Word, Excel и PowerPoint читаются через Mnemos: подключите Mnemos или сохраните файл как PDF.')
    }
    if (blob.size > MAX_CHAT_ATTACHMENT_BYTES) {
      throw new Error('Без подключённого Mnemos файл должен быть не больше 1 МБ.')
    }
    mimeType = documentType
  }
  const content = new Uint8Array(await blob.arrayBuffer())
  return await overseer.uploadChatAttachment({ mimeType, content, name }, options.modelId, options.chatId)
}


/** Контрольная сумма считается по частям, не удерживая большой PDF в памяти браузера. */
export async function chatDocumentDigest(file: File, signal?: AbortSignal): Promise<Uint8Array> {
  const { createSHA256 } = await import('hash-wasm')
  const hash = await createSHA256()
  hash.init()
  const reader = file.stream().getReader()
  try {
    while (true) {
      signal?.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) break
      hash.update(chunk.value)
    }
    return hash.digest('binary')
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}
