import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import type { GatekeeperNativeDocumentSelector, GatekeeperNativeDocumentWriteSelector, GatekeeperSharedDocument } from '@gadgets/workshop-shared/gatekeeper'
import { listAccounts, storesDocuments } from './accountCapabilities'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { launchNativeDocument } from './nativeDocumentLaunch'

type Api = Pick<RpcStub<AuthenticatedApi>, 'subscribeConnectedAccounts' | 'getGatekeeperApp' | 'listOutputFormats' | 'newGadgetFromBlueprint' | 'listGadgets'>

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

/** Открыть документ в его редакторе (документ, таблица, презентация) и снять отметку «новое». */
export async function openSharedDocument(api: Api, item: SharedDocumentItem, navigate: (id: string) => void | Promise<void>): Promise<boolean> {
  const frame = await api.getGatekeeperApp(item.vendorId, item.accountId)
  try {
    const downloads = frame?.nativeDownloads?.selector as RpcStub<GatekeeperNativeDocumentSelector> | undefined
    if (!downloads) return false
    const opened = await launchNativeDocument(api, downloads, item.accountId, item.scope, item.resource, navigate)
    const writes = frame?.nativeWrites?.selector as RpcStub<GatekeeperNativeDocumentWriteSelector> | undefined
    await writes?.sharedDocumentSeen(item.scope, item.owner, item.resource).catch(() => {})
    return opened
  } finally { disposeGatekeeperFrame(frame) }
}

/** Подпись без технических опознавателей: кто поделился и какое право. */
export function sharedDocumentNote(item: Pick<GatekeeperSharedDocument, 'grantedByName' | 'ownerName' | 'mode'>): string {
  return `${item.grantedByName || item.ownerName || 'коллега'} · ${item.mode === 'write' ? 'можно править' : 'можно читать'}`
}
