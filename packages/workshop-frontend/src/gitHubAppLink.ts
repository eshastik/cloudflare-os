// Страницы GitHub, которые приложение Mnemos из изолированного фрейма может
// открыть в новой вкладке: вход в приложение GitHub, установка приложения и
// настройки установки. Фрейму не даны allow-popups и allow-top-navigation,
// поэтому адрес открывает хост, и только из этого узкого перечня.
export function isGitHubAppPage(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048) return false
  let url: URL
  try { url = new URL(raw) } catch { return false }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port !== '' || url.username !== '' || url.password !== '' || url.hash !== '') return false
  if (url.pathname === '/login/oauth/authorize') return isGitHubAppAuthorize(url.searchParams)
  return /^\/apps\/[a-z0-9][a-z0-9-]{0,99}\/installations\/(new|select_target)$/.test(url.pathname)
    || /^\/settings\/installations\/[1-9][0-9]{0,19}$/.test(url.pathname)
    || /^\/organizations\/[A-Za-z0-9][A-Za-z0-9-]{0,99}\/settings\/installations\/[1-9][0-9]{0,19}$/.test(url.pathname)
}

// Вход в приложение GitHub (OAuth) — только номер клиента GitHub App (они
// начинаются с «Iv»; у обычных OAuth-приложений другой вид) и одноразовый state.
// Без redirect_uri и scope: GitHub вернёт на адрес возврата, заданный в
// настройках приложения, а не на адрес из ссылки.
function isGitHubAppAuthorize(params: URLSearchParams): boolean {
  const keys = [...params.keys()]
  if (new Set(keys).size !== keys.length) return false
  if (keys.some(k => k !== 'client_id' && k !== 'state' && k !== 'prompt')) return false
  const prompt = params.get('prompt')
  return /^Iv[A-Za-z0-9.]{1,60}$/.test(params.get('client_id') ?? '')
    && /^[A-Za-z0-9_-]{16,128}$/.test(params.get('state') ?? '')
    && (prompt === null || prompt === 'select_account')
}

export interface GitHubReturn { result: 'connected' | 'updated' | 'failed'; reason: string }

// Итог возврата с GitHub из адреса страницы (?github=…&github_error=…).
// Параметры не входят в проверяемый поиск маршрута и пропадают при первой
// навигации, поэтому читаются один раз при загрузке модуля.
export function readGitHubReturn(search: string): GitHubReturn | null {
  const params = new URLSearchParams(search)
  const result = params.get('github')
  if (result !== 'connected' && result !== 'updated' && result !== 'failed') return null
  const reason = params.get('github_error') ?? ''
  return { result, reason: /^[a-z]{1,20}$/.test(reason) ? reason : '' }
}
