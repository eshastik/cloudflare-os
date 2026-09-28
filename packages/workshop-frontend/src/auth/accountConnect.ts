import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { loginNavigation } from './loginReturn'

// Подключение внешнего аккаунта (первое, повторное, расширение доступа) на той же странице.
//
// Раньше адрес гейткипера открывался в новой вкладке: на телефоне исходная вкладка засыпала, а
// пересланная кому-то ссылка подключала чужой аккаунт отправителю. Теперь страница уходит к
// гейткиперу и возвращается с #connect=<код>; код меняется на результат в сеансе того же
// пользователя, и только тогда аккаунт записывается (workshop-backend/src/auth/connect-return.ts).

export type ConnectRequest =
  | { kind: 'connect'; vendorId: string; resourceUrlPatterns?: string[] }
  | { kind: 'reconnect'; accountId: number }
  | { kind: 'resources'; accountId: number; resourceUrlPatterns: string[] }

type ConnectResult = Awaited<ReturnType<AuthenticatedApi['completeConnect']>>
export type ConnectReturn = { ok: true; result: ConnectResult } | { ok: false; reason: string }

const RESTORE_KEY = 'accountConnectRestore'

/** Состояние окна, из которого начали подключение: вернётся ему после возврата на тот же адрес. */
export type RestoreState = { key: string; state: unknown }

const currentAddress = () => window.location.pathname + window.location.search

/** Начинает подключение. 'navigating' — страница уходит к гейткиперу; 'done' — действий в браузере
 * не нужно (доступ уже есть). Отказ сервера — исключение с его текстом. */
export async function startAccountConnect(request: ConnectRequest, restore?: RestoreState): Promise<'navigating' | 'done'> {
  const returnTo = currentAddress()
  const token = localStorage.getItem('authToken')
  const response = await fetch('/api/connect/start', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ ...request, returnTo }),
  })
  let body: { url?: string; done?: boolean; error?: string } = {}
  try { body = await response.json() } catch { /* пустой ответ */ }
  if (!response.ok) throw new Error(body.error || 'Не удалось начать подключение.')
  if (!body.url) return 'done'
  if (restore) {
    try { sessionStorage.setItem(RESTORE_KEY, JSON.stringify({ returnTo, key: restore.key, state: restore.state })) } catch { /* без восстановления */ }
  } else {
    try { sessionStorage.removeItem(RESTORE_KEY) } catch { /* нет хранилища */ }
  }
  loginNavigation.assign(body.url)
  return 'navigating'
}

type Captured = { code: string } | { error: string } | null
let captured: Captured | undefined
let restorable: { key: string; state: unknown } | null = null
let exchange: Promise<ConnectReturn | null> | undefined

/** Один раз за загрузку забирает из адреса #connect=<код> или #connect-error=<причина> и убирает
 * фрагмент. Сохранённое состояние окна остаётся доступным, только если это возврат на тот же адрес. */
export function captureConnectReturn(): Captured {
  if (captured !== undefined) return captured
  const hash = window.location.hash
  const code = /^#connect=([A-Za-z0-9_-]{43})$/.exec(hash)?.[1]
  const error = /^#connect-error=([a-z_]{1,32})$/.exec(hash)?.[1]
  if (code || error) window.history.replaceState(window.history.state, '', currentAddress())
  captured = code ? { code } : error ? { error } : null
  let saved: { returnTo?: string; key?: string; state?: unknown } | null = null
  try {
    saved = JSON.parse(sessionStorage.getItem(RESTORE_KEY) ?? 'null')
    sessionStorage.removeItem(RESTORE_KEY)
  } catch { saved = null }
  restorable = captured && saved?.key && saved.returnTo === currentAddress() ? { key: saved.key, state: saved.state } : null
  return captured
}

/** Отдаёт состояние окна key, сохранённое перед уходом к гейткиперу. Один раз. */
export function restoreAfterConnect<T>(key: string): T | null {
  captureConnectReturn()
  if (!restorable || restorable.key !== key) return null
  const state = restorable.state as T
  restorable = null
  return state
}

/** Меняет код возврата на результат (один раз за загрузку). null — это не возврат из подключения. */
export function completeConnectReturn(api: RpcStub<AuthenticatedApi>): Promise<ConnectReturn | null> {
  const pending = captureConnectReturn()
  if (!pending) return Promise.resolve(null)
  return exchange ??= 'error' in pending
    ? Promise.resolve({ ok: false, reason: pending.error })
    : api.completeConnect(pending.code).then(
        (result): ConnectReturn => ({ ok: true, result }),
        (): ConnectReturn => ({ ok: false, reason: 'rejected' }))
}

export function connectReturnMessage(value: ConnectReturn): string {
  if (value.ok) {
    return value.result.kind === 'connect' ? 'Аккаунт подключён.'
      : value.result.kind === 'reconnect' ? 'Аккаунт переподключён.' : 'Доступ расширен.'
  }
  if (value.reason === 'other_tab') return 'Подключение было начато в другой вкладке или другом браузере. Начните его ещё раз здесь.'
  if (value.reason === 'rejected') return 'Ссылка подключения устарела или открыта в другом браузере. Подключите аккаунт ещё раз.'
  return 'Не удалось подключить аккаунт. Попробуйте ещё раз.'
}

let noticeClaimed = false
/** Итог возврата показывается один раз за загрузку страницы, сколько бы раз ни перерисовалась оболочка. */
export function claimConnectReturnNotice(): boolean {
  if (noticeClaimed) return false
  noticeClaimed = true
  return true
}

export function resetConnectReturnForTests(): void {
  noticeClaimed = false
  captured = undefined
  restorable = null
  exchange = undefined
}
