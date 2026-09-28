import type { RpcStub } from 'capnweb'
import type { PublicApi } from '@gadgets/workshop-shared/api'

// Вход через гейткипер на той же странице. На телефоне всплывающих окон нет, а вкладка, ждущая
// ответа по WebSocket, засыпает в фоне, поэтому вход идёт переходами в одной вкладке:
// /api/login/start → гейткипер → /api/login/finish → исходный адрес с #login=<код>.
// Код одноразовый, живёт 90 секунд и срабатывает только в этом браузере; ключ сеанса в адрес
// не попадает, его приложение получает обменом кода по RPC.

const LOGIN_START_PATH = '/api/login/start'

/** Переход страницы; вынесен, чтобы тесты могли его перехватить (jsdom переходов не делает). */
export const loginNavigation = {
  assign(url: string) { window.location.assign(url) },
}

export function gatekeeperLoginHref(vendorId: string): string {
  const returnTo = window.location.pathname + window.location.search
  return `${LOGIN_START_PATH}?${new URLSearchParams({ vendor: vendorId, return_to: returnTo })}`
}

/** Уводит текущую страницу на вход через гейткипер. */
export function startGatekeeperLogin(vendorId: string): void {
  loginNavigation.assign(gatekeeperLoginHref(vendorId))
}

const REASONS: Record<string, string> = {
  no_email: 'У этой учётной записи нет подтверждённой почты, войти через неё нельзя.',
  signups_disabled: 'Регистрация новых пользователей на этой установке закрыта. Попросите руководителя прислать приглашение.',
  expired: 'Вход не завершён: ссылка входа устарела или открыта в другом браузере. Войдите ещё раз.',
  failed: 'Не удалось войти. Попробуйте ещё раз.',
  other_tab: 'Вход был начат в другой вкладке или другом браузере. Нажмите «Войти» ещё раз здесь.',
}

type Captured = { code: string } | { error: string } | null
let captured: Captured | undefined
let exchange: Promise<string | null> | undefined
let lastError: string | null = null

/** Один раз за загрузку страницы забирает из адреса #login=<код> или #login-error=<причина> и
 * убирает фрагмент из адреса и истории. Прочие фрагменты (например, #invite) не трогает. */
export function captureLoginReturn(): Captured {
  if (captured !== undefined) return captured
  const hash = window.location.hash
  const code = /^#login=([A-Za-z0-9_-]{43})$/.exec(hash)?.[1]
  const error = /^#login-error=([a-z_]{1,32})$/.exec(hash)?.[1]
  if (code || error) {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }
  captured = code ? { code } : error ? { error } : null
  if (error) lastError = REASONS[error] ?? REASONS.failed
  return captured
}

/** Меняет код возврата на ключ сеанса (один раз за загрузку) и кладёт ключ в localStorage.
 * null — кода нет или обмен отклонён; причина тогда в loginReturnError(). */
export function completeLoginReturn(publicApi: RpcStub<PublicApi>): Promise<string | null> {
  const pending = captureLoginReturn()
  if (!pending || !('code' in pending)) return Promise.resolve(null)
  return exchange ??= (async () => {
    try {
      const token = await publicApi.completeGatekeeperLogin(pending.code)
      localStorage.setItem('authToken', token)
      return token
    } catch {
      lastError = REASONS.expired
      return null
    }
  })()
}

/** Возвращает true, если в адресе был код входа и обмен ещё предстоит или идёт. */
export function hasLoginCode(): boolean {
  const pending = captureLoginReturn()
  return !!pending && 'code' in pending
}

export function loginReturnError(): string | null { return lastError }

export function resetLoginReturnForTests(): void {
  captured = undefined
  exchange = undefined
  lastError = null
}
