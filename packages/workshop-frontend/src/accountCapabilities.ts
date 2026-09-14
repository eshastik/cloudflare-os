import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import type { SupportedResource } from '@gadgets/workshop-shared/gatekeeper'
import { AccountsSubscriberAdapter, type AccountEvent } from './accountsSubscriber'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'

type Api = Pick<RpcStub<AuthenticatedApi>, 'subscribeConnectedAccounts' | 'getGatekeeperApp'>
type Frame = NonNullable<Awaited<ReturnType<Api['getGatekeeperApp']>>>
type SourceKind = NonNullable<SupportedResource['receives']>

/** Аккаунт объявил себя получателем источников этого вида (см. SupportedResource.receives). */
export function receives(resources: SupportedResource[], kind: SourceKind): boolean {
  return resources.some(resource => resource.receives === kind)
}

/** Хранилище документов: аккаунт с экраном управления, принимающий файлы с дисков. Наличие nativeWrites подтверждает фрейм. */
export function storesDocuments(account: Pick<AccountEvent, 'description' | 'supportedResources'>): boolean {
  return !!account.description.providesUi && receives(account.supportedResources, 'drive')
}

/** Снимок подключённых аккаунтов на момент ready(); подписка закрывается сразу после него. */
export async function listAccounts(api: Pick<Api, 'subscribeConnectedAccounts'>): Promise<AccountEvent[]> {
  const accounts = new Map<number, AccountEvent>()
  let settle!: () => void
  const ready = new Promise<void>(resolve => { settle = resolve })
  const subscription = await api.subscribeConnectedAccounts(new AccountsSubscriberAdapter({
    add(event) { accounts.set(event.id, event) },
    remove(id) { accounts.delete(id) },
    ready() { settle() },
  }))
  try { await ready } finally { subscription[Symbol.dispose]() }
  return [...accounts.values()]
}

type StoreCapability = 'nativeWrites' | 'nativeDownloads'
type StoreFrame<K extends StoreCapability> = Frame & { [P in K]: NonNullable<Frame[P]> }
export type NativeWritesFrame = StoreFrame<'nativeWrites'>
export type NativeDownloadsFrame = StoreFrame<'nativeDownloads'>

/** Открывает фрейм хранилища документов с нужной возможностью; без accountId берётся первый подходящий аккаунт. */
async function openStoreFrame<K extends StoreCapability>(api: Api, capability: K, accountId?: number): Promise<StoreFrame<K>> {
  const candidates = (await listAccounts(api)).filter(account => storesDocuments(account) && (accountId === undefined || account.id === accountId))
  for (const account of candidates) {
    const frame = await api.getGatekeeperApp(account.vendorId, account.id)
    if (frame?.[capability]) return frame as StoreFrame<K>
    disposeGatekeeperFrame(frame)
  }
  throw new Error(`No connected account provides ${capability}`)
}

export const openNativeWritesFrame = (api: Api, accountId?: number) => openStoreFrame(api, 'nativeWrites', accountId)
export const openNativeDownloadsFrame = (api: Api, accountId?: number) => openStoreFrame(api, 'nativeDownloads', accountId)

export type AgentConsentFrame = Frame & { agentConsent: NonNullable<Frame['agentConsent']> }

/** Открывает фрейм первого аккаунта с экраном управления, который выдаёт подтверждение агента; остальные фреймы закрываются. */
export async function openAgentConsentFrame(api: Api): Promise<{ frame: AgentConsentFrame; vendorId: string; accountId: number } | null> {
  for (const account of (await listAccounts(api)).filter(account => !!account.description.providesUi)) {
    const frame = await api.getGatekeeperApp(account.vendorId, account.id)
    if (frame?.agentConsent) return { frame: frame as AgentConsentFrame, vendorId: account.vendorId, accountId: account.id }
    disposeGatekeeperFrame(frame)
  }
  return null
}
