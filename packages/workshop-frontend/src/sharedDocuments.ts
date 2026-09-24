import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import type { GatekeeperNativeDocumentSelector, GatekeeperNativeDocumentWriteSelector, GatekeeperSharedDocument, GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import { listAccounts, storesDocuments } from './accountCapabilities'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { launchNativeDocument } from './nativeDocumentLaunch'

type Api = Pick<RpcStub<AuthenticatedApi>, 'subscribeConnectedAccounts' | 'getGatekeeperApp' | 'listOutputFormats' | 'newGadgetFromBlueprint' | 'listGadgets'>
type LaunchApi = Pick<RpcStub<AuthenticatedApi>, 'listOutputFormats' | 'newGadgetFromBlueprint' | 'listGadgets'>

/** Документ, которым поделились, вместе с подключением Mnemos, через которое он открывается. */
export type SharedDocumentItem = GatekeeperSharedDocument & { accountId: number; vendorId: string }

/** «Поделились с вами» из всех подключений хранилища документов; сбой одного подключения не прячет остальные. */
export async function loadSharedDocuments(api: Api): Promise<SharedDocumentItem[]> {
  const out: SharedDocumentItem[] = []
  for (const account of (await listAccounts(api)).filter(storesDocuments)) {
    const frame = await api.getGatekeeperApp(account.vendorId, account.id).catch(() => null)
    try {
      const selector = frame?.nativeWrites?.selector as RpcStub<GatekeeperNativeDocumentWriteSelector> | undefined
      if (!selector) continue
      const page = await selector.sharedDocuments().catch(() => ({ documents: [] as GatekeeperSharedDocument[] }))
      for (const document of page.documents) if (document.format) out.push({ ...document, accountId: account.id, vendorId: account.vendorId })
    } finally { disposeGatekeeperFrame(frame) }
  }
  return out.sort((a, b) => Date.parse(b.grantedAt) - Date.parse(a.grantedAt))
}

/**
 * Открыть чужой документ по приглашению через уже открытый фрейм подключения. Отметка «прочитано»
 * ставится до перехода в редактор: переход закрывает страницу, с которой позвали открытие
 * («Входящие» в своём фрейме), и её продолжение после перехода не выполняется.
 * false — документ не нашёлся среди доступных человеку версий (нет доступа или он отозван).
 */
export async function launchSharedDocument(api: LaunchApi, frame: Pick<GatekeeperUiFrame, 'nativeDownloads' | 'nativeWrites'> | null | undefined, accountId: number,
  document: { scope: string; owner: string; resource: string }, navigate: (id: string) => void | Promise<void>): Promise<boolean> {
  const downloads = frame?.nativeDownloads?.selector as RpcStub<GatekeeperNativeDocumentSelector> | undefined
  if (!downloads) throw new Error('Подключение Mnemos недоступно. Переподключите его в разделе «Подключения».')
  const writes = frame?.nativeWrites?.selector as RpcStub<GatekeeperNativeDocumentWriteSelector> | undefined
  return launchNativeDocument(api, downloads, accountId, document.scope, document.resource, async id => {
    if (document.owner) await writes?.sharedDocumentSeen(document.scope, document.owner, document.resource).catch(() => {})
    await navigate(id)
  })
}

/** Открыть документ в его редакторе (документ, таблица, презентация) и снять отметку «новое». */
export async function openSharedDocument(api: Api, item: SharedDocumentItem, navigate: (id: string) => void | Promise<void>): Promise<boolean> {
  const frame = await api.getGatekeeperApp(item.vendorId, item.accountId)
  try {
    return await launchSharedDocument(api, frame, item.accountId, item, navigate)
  } finally { disposeGatekeeperFrame(frame) }
}

/** Понятная причина, почему документ по приглашению не открылся; name — название документа. */
export function sharedDocumentFailure(name: string, error?: unknown): string {
  if (error === undefined) return `Документ «${name}» не открылся: у вас сейчас нет доступа к нему или к папке, где он лежит. Попросите владельца документа открыть доступ заново.`
  const reason = error instanceof Error && /[А-Яа-яЁё]/.test(error.message) ? error.message.replace(/\.$/, '') : 'не удалось связаться с Mnemos'
  return `Документ «${name}» не открылся: ${reason}. Повторите попытку.`
}

/** Подпись без технических опознавателей: кто поделился и какое право. */
export function sharedDocumentNote(item: Pick<GatekeeperSharedDocument, 'grantedByName' | 'ownerName' | 'mode'>): string {
  return `${item.grantedByName || item.ownerName || 'коллега'} · ${item.mode === 'write' ? 'можно править' : 'можно читать'}`
}
