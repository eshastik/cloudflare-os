// Приложение Mnemos из беседы открывается в боковой панели этой же беседы, а не в новом рабочем месте.
//
// Путь тот же, что у раздела «Проекты» (launchMnemosApp): в рабочем месте заводится пустой гаджет, для него
// пишется заявка открытия, а привязку к узлу ставит шапка приложения (useMnemosApp.openVersion) после
// проверки прав в Mnemos. Код узла в рабочее место не кладётся.
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi, WorkpieceSummary } from '@gadgets/workshop-shared/api'
import { GADGET_APP_FORMAT, type MnemosAppState } from '@gadgets/workshop-shared/gadget-app'
import { nativeFormatForOutput } from '@gadgets/workshop-shared/native-document'
import { openNativeDownloadsFrame } from './accountCapabilities'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { rememberMnemosAppLaunch } from './mnemosAppLaunch'

export type AppTarget = { accountId: number; scope: string; resource: string; title?: string }

type Api = Pick<RpcStub<AuthenticatedApi>, 'subscribeConnectedAccounts' | 'getGatekeeperApp'>
type GadgetHandle = { getId(): Promise<number>; getMnemosApp(): Promise<MnemosAppState>; [Symbol.dispose]?(): void }
export type AppWorkspace = {
  id: string
  overseer: { getGadget(id: number): GadgetHandle; createGadget(title: string): Promise<GadgetHandle> }
  gadgets: readonly Pick<WorkpieceSummary, 'id' | 'filesRoot' | 'output'>[]
}

const dispose = (value: GadgetHandle) => { try { value[Symbol.dispose]?.() } catch { /* уже закрыт */ } }
const storeKey = (workspace: string, target: AppTarget) => `mnemos-app-chat:${JSON.stringify([workspace, target.accountId, target.scope, target.resource])}`

/** Последняя доступная человеку версия узла, если узел — приложение; null — документ или версий нет. */
export async function latestAppVersion(api: Api, target: AppTarget): Promise<string | null> {
  const frame = await openNativeDownloadsFrame(api, target.accountId)
  try {
    const latest = (await frame.nativeDownloads.selector.publications(target.scope, target.resource, '')).publications[0]
    return latest?.format === GADGET_APP_FORMAT ? latest.id : null
  } finally { disposeGatekeeperFrame(frame) }
}

/**
 * Гаджет этого рабочего места, уже открывающий узел: сначала запомненный этим браузером (у получателя
 * привязка ведёт на его копию, а не на узел из ссылки), потом по привязке. Кандидаты — только гаджеты
 * без файлов: у гаджета-узла код закрыт, у гаджета беседы привязки нет.
 */
export async function findAppGadget(workspace: AppWorkspace, target: AppTarget): Promise<number | null> {
  let stored: number | null = null
  try {
    const raw = localStorage.getItem(storeKey(workspace.id, target))
    if (raw && /^\d+$/.test(raw)) stored = Number(raw)
  } catch { /* хранилище отключено */ }
  if (stored !== null) {
    if (workspace.gadgets.some(g => g.id === stored)) return stored
    // Только что созданный гаджет может ещё не дойти до списка рабочего места: спрашиваем его самого.
    const gadget = workspace.overseer.getGadget(stored)
    try { if (await gadget.getId() === stored) return stored } catch { /* гаджет удалён */ } finally { dispose(gadget) }
  }
  for (const summary of workspace.gadgets) {
    if (summary.filesRoot !== undefined || nativeFormatForOutput(summary.output?.id)) continue
    const gadget = workspace.overseer.getGadget(summary.id)
    try {
      const binding = (await gadget.getMnemosApp()).binding
      if (binding && binding.accountId === target.accountId && binding.scope === target.scope && binding.resource === target.resource) return summary.id
    } catch { /* гаджет удалён или недоступен — ищем дальше */ } finally { dispose(gadget) }
  }
  return null
}

const inFlight = new Map<string, Promise<number | null>>()

/**
 * Открыть приложение в рабочем месте беседы. Возвращает номер гаджета для панели или null, если узел не
 * приложение (тогда документ открывается прежним путём). Повторный вызов, в том числе двойной щелчок,
 * второй гаджет не создаёт.
 */
export function openAppInWorkspace(api: Api, workspace: AppWorkspace, target: AppTarget): Promise<number | null> {
  const key = storeKey(workspace.id, target)
  const running = inFlight.get(key)
  if (running) return running
  const job = (async () => {
    const existing = await findAppGadget(workspace, target)
    if (existing !== null) return existing
    const publication = await latestAppVersion(api, target)
    if (!publication) return null
    const gadget = await workspace.overseer.createGadget(target.title?.trim().slice(0, 120) || 'Приложение')
    let gadgetId: number
    try { gadgetId = await gadget.getId() } finally { dispose(gadget) }
    rememberMnemosAppLaunch(workspace.id, { accountId: target.accountId, scope: target.scope, resource: target.resource, publication, gadgetId })
    try { localStorage.setItem(key, String(gadgetId)) } catch { /* найдётся по привязке */ }
    return gadgetId
  })()
  inFlight.set(key, job)
  void job.finally(() => { if (inFlight.get(key) === job) inFlight.delete(key) }).catch(() => {})
  return job
}
