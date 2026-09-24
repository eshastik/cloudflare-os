// Страницы GitHub, которые приложение Mnemos из изолированного фрейма может
// открыть в новой вкладке: установка приложения GitHub и настройки установки.
// Фрейму не даны allow-popups и allow-top-navigation, поэтому адрес открывает
// хост, и только из этого узкого перечня.
export function isGitHubAppPage(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048) return false
  let url: URL
  try { url = new URL(raw) } catch { return false }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port !== '' || url.username !== '' || url.password !== '' || url.hash !== '') return false
  return /^\/apps\/[a-z0-9][a-z0-9-]{0,99}\/installations\/(new|select_target)$/.test(url.pathname)
    || /^\/settings\/installations\/[1-9][0-9]{0,19}$/.test(url.pathname)
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
