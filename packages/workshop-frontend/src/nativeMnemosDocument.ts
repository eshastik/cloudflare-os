import type { RpcStub } from 'capnweb'
import type { GadgetClient } from '@gadgets/workshop-shared/api'
import type { GatekeeperNativeDocumentWriteSelector } from '@gadgets/workshop-shared/gatekeeper'
import { cleanNativeTitle, defaultNativeTitle, nativeTitleSource, type NativeDocumentFormat, type NativeMnemosBinding, type NativeMnemosCreation } from '@gadgets/workshop-shared/native-document'
import { uploadGatekeeperNativeDocument } from './gatekeeperAppUpload'
import { downloadGatekeeperOffice } from './gatekeeperAppDownload'
import type { NativeSnapshotSourceRef } from './nativeSnapshotSource'

type Selector = RpcStub<GatekeeperNativeDocumentWriteSelector>
type Gadget = Pick<RpcStub<GadgetClient>, 'claimMnemosDocument' | 'recordMnemosDocumentReceipt' | 'setMnemosDocument'>
export type WritesSource = { selector: Selector; storageOrigin: string }

/** Ревизия редактора из снимка; undefined — ревизии в снимке нет. */
export function snapshotRevision(document: unknown): number | undefined {
  const revision = (document as { revision?: unknown } | null)?.revision
  return typeof revision === 'number' && Number.isSafeInteger(revision) ? revision : undefined
}

/** Имя документа в Mnemos — название из шапки редактора; без названия — запасное. */
export function mnemosDocumentName(format: NativeDocumentFormat, document: unknown, fallback = ''): string {
  const title = nativeTitleSource(format, document).title
  return cleanNativeTitle(title ?? fallback) || defaultNativeTitle(format)
}

/**
 * Создать документ в проекте Mnemos из текущего снимка редактора и привязать к нему редактор.
 *
 * Дубликатов нет по построению: создание захватывается на сервере рабочего места (вторая вкладка
 * получает null), а квитанция замороженной заявки записывается туда до отправки. Вкладка,
 * открытая после сбоя, повторяет ту же заявку (creation с квитанцией), и Mnemos возвращает уже
 * созданный документ. Правки не теряются: в Mnemos уходит снимок, который редактор выгрузил на
 * подтверждённой ревизии; всё, что пришло позже, шапка покажет как несохранённое.
 */
export async function createMnemosDocument({ gadget, writes, format, snapshotSource, accountId, scope, name, resume, signal }: {
  gadget: Gadget; writes: WritesSource; format: NativeDocumentFormat; snapshotSource: NativeSnapshotSourceRef
  accountId: number; scope: string; name: string; resume?: NativeMnemosCreation | null; signal: AbortSignal
}): Promise<NativeMnemosBinding | null> {
  if (resume?.receipt) {
    using writer = await writes.selector.resumeCreation(resume.receipt, format)
    const state = await writer.recoveryState(); signal.throwIfAborted()
    await writer.save(state.head, state.uploadId); signal.throwIfAborted()
    // Ревизия, с которой делался прежний снимок, неизвестна: шапка предложит сохранить заново.
    const binding: NativeMnemosBinding = { accountId: resume.accountId, scope: resume.scope, resource: await writer.document() }
    await gadget.setMnemosDocument(binding)
    return binding
  }
  const claim = await gadget.claimMnemosDocument(accountId, scope, name)
  if (!claim) return null
  signal.throwIfAborted()
  using writer = await writes.selector.create(scope, claim.name, format)
  const head = await writer.head(); signal.throwIfAborted()
  const read = snapshotSource.current
  if (!read) throw new Error('Editor is not ready')
  const snapshot = await read(format, signal); signal.throwIfAborted()
  const revision = snapshotRevision(snapshot.document)
  const upload = await uploadGatekeeperNativeDocument(snapshot, format, writes.storageOrigin, (size, checksum) => writer.issue(head, size, checksum), signal)
  signal.throwIfAborted()
  const receipt = await writer.checkpoint(head, upload)
  await gadget.recordMnemosDocumentReceipt(claim.claim, receipt)
  const saved = await writer.save(head, upload)
  const binding: NativeMnemosBinding = { accountId, scope, resource: await writer.document(), ...(revision !== undefined ? { savedRevision: revision } : {}), ...(/^[a-f0-9]{64}$/.test(saved) ? { savedHead: saved } : {}) }
  await gadget.setMnemosDocument(binding)
  return binding
}

/** Документ изменил другой человек после версии, от которой правит редактор. Правка не записана и остаётся в редакторе. */
export class MnemosDocumentChanged extends Error {
  constructor() { super('Документ изменили после того, как вы его открыли') }
}
export const isDocumentChanged = (error: unknown) => error instanceof MnemosDocumentChanged || String((error as { message?: unknown } | null)?.message ?? '').includes('DOCUMENT_CHANGED')

/**
 * Сохранить текущий снимок редактора в привязанный документ — свой или тот, куда пригласили с правом правки.
 * Базой служит версия, от которой правит редактор (binding.savedHead): если сам документ с тех пор изменили,
 * сервер отказывает, и функция бросает MnemosDocumentChanged — молча чужая правка не затирается.
 * Возвращает ревизию редактора и новую версию документа.
 */
export async function saveToMnemosDocument({ writes, format, snapshotSource, binding, signal }: {
  writes: WritesSource; format: NativeDocumentFormat; snapshotSource: NativeSnapshotSourceRef; binding: NativeMnemosBinding; signal: AbortSignal
}): Promise<{ revision: number | undefined; head: string }> {
  using writer = await writes.selector.select(binding.scope, binding.resource, format)
  const base = binding.savedHead ?? await writer.head(); signal.throwIfAborted()
  const read = snapshotSource.current
  if (!read) throw new Error('Editor is not ready')
  const snapshot = await read(format, signal); signal.throwIfAborted()
  const upload = await uploadGatekeeperNativeDocument(snapshot, format, writes.storageOrigin, (size, checksum) => writer.issue(base, size, checksum), signal)
  signal.throwIfAborted()
  let head: string
  try { head = await writer.save(base, upload) }
  catch (error) { if (isDocumentChanged(error)) throw new MnemosDocumentChanged(); throw error }
  return { revision: snapshotRevision(snapshot.document), head }
}

/** Событие окна: привязку изменили вне шапки (выгрузка сохранила редактор); шапка обновляется без перезагрузки. */
export const NATIVE_BINDING_EVENT = 'mnemos-native-binding'
export type NativeBindingEventDetail = { gadgetId: string | number; format: NativeDocumentFormat; binding: NativeMnemosBinding }

export const OFFICE_EXTENSION: Record<NativeDocumentFormat, string> = { 'cloudflareos.document': '.docx', 'cloudflareos.spreadsheet': '.xlsx', 'cloudflareos.presentation': '.pptx' }
export const OFFICE_LABEL: Record<NativeDocumentFormat, string> = { 'cloudflareos.document': 'Word (.docx)', 'cloudflareos.spreadsheet': 'Excel (.xlsx)', 'cloudflareos.presentation': 'PowerPoint (.pptx)' }

/** Имя скачиваемого файла: кириллица сохраняется, запрещённые в именах файлов знаки заменяются. */
export function officeFilename(name: string, format: NativeDocumentFormat): string {
  const base = name.replace(/\.(docx|xlsx|pptx|cfdoc|cfsheet|cfslides)$/i, '').replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').trim() || 'Документ'
  return base + OFFICE_EXTENSION[format]
}

/** Выгрузить сохранённую личную версию документа в Word, Excel или PowerPoint. Конвертирует сервер Mnemos. */
export async function exportMnemosOffice({ writes, format, binding, signal }: {
  writes: WritesSource; format: NativeDocumentFormat; binding: NativeMnemosBinding; signal: AbortSignal
}): Promise<{ bytes: Uint8Array; contentType: string }> {
  let head: string
  { using writer = await writes.selector.select(binding.scope, binding.resource, format); head = await writer.head() }
  signal.throwIfAborted()
  using download = await writes.selector.exportOffice(binding.scope, binding.resource, head, format)
  const ticket = await download.issue(); signal.throwIfAborted()
  const bytes = await downloadGatekeeperOffice(writes.storageOrigin, ticket, format, signal, () => download.validate())
  return { bytes, contentType: ticket.content_type }
}
