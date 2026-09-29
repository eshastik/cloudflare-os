import type {AuthenticatedApi} from '@gadgets/workshop-shared/api'

/** Открытие приложения из Mnemos (ADR 0028): какой узел и какую версию загрузить в гаджет рабочего места. */
export type MnemosAppLaunch = {accountId: number; scope: string; resource: string; publication: string; gadgetId: number; at: number}

const key = (path: string) => `mnemos-app-launch:${path}`
/** Сколько живёт заявка на открытие: только что нажатая ссылка, не старая вкладка. */
const LAUNCH_MS = 30 * 60 * 1000

/** Заявка открытия для текущей страницы рабочего места; адрес страницы прав не даёт — их проверяет Mnemos. */
export function readMnemosAppLaunch(): MnemosAppLaunch | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key(location.pathname)) || 'null')
    if (value && Number.isSafeInteger(value.accountId) && Number.isSafeInteger(value.gadgetId) &&
        [value.scope, value.resource, value.publication].every(v => typeof v === 'string' && v && v.length <= 300) &&
        Number.isFinite(value.at) && Date.now() >= value.at && Date.now() - value.at < LAUNCH_MS) return value
  } catch { /* повреждённая заявка равносильна её отсутствию */ }
  return null
}
export function clearMnemosAppLaunch() { try { sessionStorage.removeItem(key(location.pathname)) } catch { /* нечего чистить */ } }

/** Своё рабочее место на каждый узел приложения, как у документа: второе открытие попадает в то же место. */
export async function launchMnemosApp(api: Pick<AuthenticatedApi, 'listGadgets' | 'newGadget'>, accountId: number, scope: string, resource: string, publication: string,
  navigate: (id: string) => void | Promise<void>): Promise<boolean> {
  const workspaceKey = `mnemos-app-workspace:${JSON.stringify([accountId, scope, resource])}`
  const remember = (workspace: string, gadgetId: number) => {
    sessionStorage.setItem(key(`/workspace/${encodeURIComponent(workspace)}`), JSON.stringify({accountId, scope, resource, publication, gadgetId, at: Date.now()} satisfies MnemosAppLaunch))
  }
  let previous: {workspace: string; gadgetId: number} | null = null
  try {
    const stored = JSON.parse(localStorage.getItem(workspaceKey) || 'null')
    if (stored && typeof stored.workspace === 'string' && Number.isSafeInteger(stored.gadgetId)) previous = stored
  } catch { /* хранилище браузера может быть отключено */ }
  if (previous && (await api.listGadgets()).some(item => item.id === previous!.workspace)) {
    remember(previous.workspace, previous.gadgetId)
    await navigate(previous.workspace)
    return true
  }
  const overseer = await api.newGadget()
  try {
    const {id} = await overseer.getMetadata()
    const gadget = await overseer.createGadget('Приложение')
    let gadgetId: number
    try { gadgetId = await gadget.getId() } finally { gadget[Symbol.dispose]() }
    remember(id, gadgetId)
    try { localStorage.setItem(workspaceKey, JSON.stringify({workspace: id, gadgetId})) } catch { /* приложение всё равно откроется */ }
    await navigate(id)
    return true
  } finally { overseer[Symbol.dispose]() }
}
