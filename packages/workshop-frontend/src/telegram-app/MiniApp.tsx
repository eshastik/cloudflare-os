import { useEffect, useRef, useState } from 'react'

// Экран Mini App в Telegram (ADR 0027 Mnemos, этап 6). Страница отдельная от приложения: без входа
// и без сессии человека. Она отправляет на сервер подписанные Telegram данные запуска (initData) и
// одноразовый токен экрана из адреса кнопки; сервер проверяет подпись, владельца бота и токен.
//
// Сессии, ограниченной одним документом, в оболочке пока нет, поэтому редактор здесь не
// открывается: экран называет документ и ведёт на сайт.

/** Часть Telegram.WebApp, которой пользуется экран. */
export type TelegramWebApp = {
  initData: string;
  colorScheme?: 'light' | 'dark';
  ready(): void;
  expand?(): void;
  close(): void;
  openLink?(url: string): void;
};

export type OpenResult =
  | { status: 'ok'; title: string; siteUrl: string | null }
  | { status: 'expired'; siteUrl: string | null }
  | { status: 'denied' };

type View =
  | { kind: 'checking' }
  | { kind: 'outside' }
  | { kind: 'failed' }
  | { kind: 'ok'; title: string; siteUrl: string | null }
  | { kind: 'expired'; siteUrl: string | null }
  | { kind: 'denied' };

function viewOf(result: OpenResult): View {
  if (result.status === 'ok') return { kind: 'ok', title: result.title, siteUrl: result.siteUrl }
  if (result.status === 'expired') return { kind: 'expired', siteUrl: result.siteUrl }
  return { kind: 'denied' }
}

export const OPEN_PATH = '/api/telegram-app/open'
const TOKEN = /^[0-9a-f]{64}\.[A-Za-z0-9_-]{43}$/

export async function openScreen(token: string, initData: string, fetcher: typeof fetch = fetch): Promise<OpenResult> {
  const response = await fetcher(OPEN_PATH, {
    method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, initData }),
  })
  const body = await response.json().catch(() => null) as Partial<OpenResult> | null
  if (body?.status === 'ok' && typeof body.title === 'string') return { status: 'ok', title: body.title, siteUrl: safeUrl(body.siteUrl) }
  if (body?.status === 'expired') return { status: 'expired', siteUrl: safeUrl(body.siteUrl) }
  return { status: 'denied' }
}

/** Ссылка на сайт — только своя установка (тот же источник, что у этой страницы). */
function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.origin === window.location.origin && (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : null
  } catch { return null }
}

export default function MiniApp({ webApp, token, fetcher }: { webApp: TelegramWebApp | null; token: string | null; fetcher?: typeof fetch }) {
  const [view, setView] = useState<View>({ kind: 'checking' })
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    if (!webApp || !webApp.initData || !token || !TOKEN.test(token)) { setView({ kind: 'outside' }); return }
    webApp.ready()
    webApp.expand?.()
    openScreen(token, webApp.initData, fetcher).then(result => setView(viewOf(result)), () => setView({ kind: 'failed' }))
  }, [webApp, token, fetcher])

  const openSite = (url: string) => {
    if (webApp?.openLink) webApp.openLink(url)
    else window.open(url, '_blank', 'noopener,noreferrer')
  }
  const close = () => webApp?.close()

  return (
    <main className="ma" aria-busy={view.kind === 'checking'}>
      <p className="ma-mark">Mnemos</p>
      {view.kind === 'checking' && <p role="status" className="ma-status">Проверяем, что это вы…</p>}
      {view.kind === 'ok' && (
        <>
          <article className="ma-doc">
            <h1 className="ma-title">{view.title}</h1>
            <p className="ma-note">Редактор в Telegram пока не открывается: документ откроется на сайте, там же сохранение и версии.</p>
          </article>
          <Actions site={view.siteUrl} label="Открыть на сайте" onSite={openSite} onClose={close} />
        </>
      )}
      {view.kind === 'expired' && (
        <>
          <h1 className="ma-heading">Кнопка устарела</h1>
          <p className="ma-note">Кнопка «Открыть» действует 15 минут и один раз. Откройте документ на сайте или попросите агента прислать его снова.</p>
          <Actions site={view.siteUrl} label="Открыть на сайте" onSite={openSite} onClose={close} />
        </>
      )}
      {view.kind === 'denied' && (
        <>
          <h1 className="ma-heading">Открыть не получилось</h1>
          <p className="ma-note">Документ открывается только владельцу бота и только из его чата с ботом.</p>
          <Actions site={null} label="" onSite={openSite} onClose={close} />
        </>
      )}
      {view.kind === 'outside' && (
        <>
          <h1 className="ma-heading">Откройте из Telegram</h1>
          <p className="ma-note">Эта страница работает только по кнопке «Открыть» в чате с вашим ботом.</p>
        </>
      )}
      {view.kind === 'failed' && (
        <>
          <h1 className="ma-heading">Нет связи с сервером</h1>
          <p className="ma-note">Закройте окно и нажмите «Открыть» ещё раз.</p>
          <Actions site={null} label="" onSite={openSite} onClose={close} />
        </>
      )}
    </main>
  )
}

function Actions({ site, label, onSite, onClose }: { site: string | null; label: string; onSite: (url: string) => void; onClose: () => void }) {
  return (
    <div className="ma-actions">
      {site && <button type="button" className="ma-primary" onClick={() => onSite(site)}>{label}</button>}
      <button type="button" className="ma-secondary" onClick={onClose}>Закрыть</button>
    </div>
  )
}
