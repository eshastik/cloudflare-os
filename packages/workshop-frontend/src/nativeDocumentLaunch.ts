import {nativeFormatForOutput} from '@gadgets/workshop-shared/native-document'
import type {NativeDocumentFormat} from '@gadgets/workshop-shared/native-document'
import type {GatekeeperNativeDocumentSelector} from '@gadgets/workshop-shared/gatekeeper'
import type {AuthenticatedApi} from '@gadgets/workshop-shared/api'

export type NativeDocumentLaunch = {accountId: number; scope: string; resource: string; format: NativeDocumentFormat; publication: string; at: number}
const key = (path: string) => `mnemos-document-launch:${path}`
export function readNativeDocumentLaunch(format: NativeDocumentFormat): NativeDocumentLaunch | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key(location.pathname)) || 'null')
    if (value && value.format === format && Number.isSafeInteger(value.accountId) && typeof value.scope === 'string' && value.scope && typeof value.resource === 'string' && value.resource && typeof value.publication === 'string' && value.publication && Number.isFinite(value.at) && Date.now() >= value.at && Date.now() - value.at < 1800000) return value
  } catch { /* Локальный адрес не даёт прав на документ. */ }
  return null
}
export function clearNativeDocumentLaunch() { sessionStorage.removeItem(key(location.pathname)) }

/** Содержимое читает редактор через обычную проверку доступа; здесь только выбор нужного гаджета. */
export async function launchNativeDocument(api: Pick<AuthenticatedApi, 'listOutputFormats' | 'newGadgetFromBlueprint' | 'listGadgets'>, selector: Pick<GatekeeperNativeDocumentSelector, 'publications'>, accountId: number, scope: string, resource: string, navigate: (id: string) => void | Promise<void>): Promise<boolean> {
  if (!Number.isSafeInteger(accountId) || !scope || !resource || scope.length > 255 || resource.length > 255) throw Error('Не выбран документ')
  const history = await selector.publications(scope, resource, '')
  const version = history.publications[0]
  if (!version) return false
  const workspaceKey = `mnemos-document-workspace:${JSON.stringify([accountId, scope, resource, version.format])}`
  let previous: string | null = null
  try { previous = localStorage.getItem(workspaceKey) } catch { /* Хранилище браузера может быть отключено. */ }
  const remember = (id: string) => {
    const path = `/workspace/${encodeURIComponent(id)}`
    sessionStorage.setItem(key(path), JSON.stringify({accountId, scope, resource, format: version.format, publication: version.id, at: Date.now()} satisfies NativeDocumentLaunch))
  }
  if (previous) {
    const workspaces = await api.listGadgets()
    if (workspaces.some(item => item.id === previous)) {
      remember(previous)
      await navigate(previous)
      return true
    }
  }
  const formats = await api.listOutputFormats()
  const format = formats.find(item => nativeFormatForOutput(item.output.id) === version.format && !item.requiresSetup)
  if (!format) throw Error('Редактор этого формата пока не настроен')
  const overseer = await api.newGadgetFromBlueprint(format.blueprintId, {})
  try {
    const {id} = await overseer.getMetadata()
    remember(id)
    try { localStorage.setItem(workspaceKey, id) } catch { /* Сам документ сохранён на сервере. */ }
    await navigate(id)
    return true
  } finally { overseer[Symbol.dispose]() }
}
