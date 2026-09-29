import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcStub, RpcTarget } from 'capnweb'
import type { NativeDocumentEditor } from '@gadgets/workshop-shared/native-document'
import type { MiniAppDocumentInfo, MiniAppVersion } from '@gadgets/workshop-shared/telegram-mini-app'
import type { NativeSnapshotSource } from '../nativeSnapshotSource'
import EditorFrame from './EditorFrame'
import { applyTelegramTheme, telegramThemeMode, type TelegramWebApp } from './telegram'
import {
  createInProject, documentName, fetchVersion, isDocumentChanged, openDocumentSession, saveVersion, snapshotRevision,
  type DocumentApi,
} from './miniAppDocument'

// Документ в Mini App: шапка с названием и состоянием, настоящий редактор, «Версии». Сохранение —
// главная кнопка Telegram (вне Telegram — кнопка внизу страницы), назад из «Версий» — кнопка «Назад».

/** Как часто спрашивать ревизию редактора, чтобы знать, есть ли несохранённые правки. */
export const REVISION_POLL_MS = 3000

type Phase = { kind: 'loading' } | { kind: 'ready'; info: MiniAppDocumentInfo } | { kind: 'ended' } | { kind: 'failed' }
type Message = { tone: 'note' | 'error'; text: string } | null

const SESSION_ENDED = 'Сессия Mini App закончилась'
const ended = (error: unknown) => String((error as { message?: unknown } | null)?.message ?? '').startsWith(SESSION_ENDED)

function when(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'время неизвестно'
  const date = new Date(t)
  const today = new Date()
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return date.toDateString() === today.toDateString() ? `сегодня в ${time}` : `${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, ${time}`
}

function who(version: MiniAppVersion): string {
  if (version.onBehalfOf) return `Агент по просьбе: ${version.onBehalfOf}`
  return version.author || 'Вы'
}

export default function DocumentScreen({ session, webApp, siteUrl, title, connect = openDocumentSession, pollMs = REVISION_POLL_MS, Frame = EditorFrame }: {
  session: string; webApp: TelegramWebApp | null; siteUrl: string | null; title: string
  connect?: typeof openDocumentSession; pollMs?: number; Frame?: typeof EditorFrame
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [api, setApi] = useState<{ api: DocumentApi } | null>(null)
  const [read, setRead] = useState<{ read: NativeSnapshotSource } | null>(null)
  const [revision, setRevision] = useState<number | null>(null)
  const [busy, setBusy] = useState<'save' | 'restore' | null>(null)
  const [message, setMessage] = useState<Message>(null)
  const [changedByOther, setChangedByOther] = useState(false)
  // Тема Telegram для фрейма редактора или приложения; меняется на лету вместе с темой Telegram.
  const [mode, setMode] = useState(() => telegramThemeMode(webApp))
  const [versions, setVersions] = useState<{ list: MiniAppVersion[]; next: string; loading: boolean } | null>(null)
  const [chosen, setChosen] = useState<MiniAppVersion | null>(null)
  const lifetime = useRef(new AbortController())

  const fail = useCallback((error: unknown) => {
    if (ended(error)) { setPhase({ kind: 'ended' }); return true }
    return false
  }, [])

  // Связь и описание документа.
  useEffect(() => {
    const abort = new AbortController(); lifetime.current = abort
    const link = connect(session)
    setApi({ api: link.api })
    link.api.describe().then(info => {
      if (abort.signal.aborted) return
      applyTelegramTheme(webApp, info.accent)
      setMode(telegramThemeMode(webApp))
      setPhase({ kind: 'ready', info })
    }, error => { if (!abort.signal.aborted && !fail(error)) setPhase({ kind: 'failed' }) })
    return () => { abort.abort(); link.close() }
  }, [session, connect, webApp, fail])

  // Тема Telegram меняется на лету (человек переключил тему).
  useEffect(() => {
    if (!webApp?.onEvent || phase.kind !== 'ready') return
    const accent = phase.info.accent
    const update = () => { applyTelegramTheme(webApp, accent); setMode(telegramThemeMode(webApp)) }
    webApp.onEvent('themeChanged', update)
    return () => webApp.offEvent?.('themeChanged', update)
  }, [webApp, phase])

  const info = phase.kind === 'ready' ? phase.info : null
  // Приложение (ADR 0028): экран без сохранения и версий — код и версии меняются на сайте.
  const isApp = info?.format === 'cloudflareos.app'
  const bound = info?.mnemos.kind === 'bound' && !isApp ? info.mnemos : null

  // Ревизия редактора: сравнение с сохранённой говорит, есть ли несохранённые правки.
  useEffect(() => {
    if (!api || !info || !pollMs || info.format === 'cloudflareos.app') return
    let probe: RpcStub<RpcTarget> | null = null, stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        probe ??= await api.api.connectEditor()
        const doc = await (probe as unknown as RpcStub<NativeDocumentEditor>).getDocument()
        if (!stopped && typeof doc?.revision === 'number') setRevision(doc.revision)
      } catch (error) { if (!stopped && fail(error)) return }
      if (!stopped) timer = setTimeout(() => { void tick() }, pollMs)
    }
    void tick()
    return () => { stopped = true; clearTimeout(timer); probe?.[Symbol.dispose]() }
  }, [api, info, pollMs, fail])

  const dirty = bound ? (bound.savedRevision === null || revision === null ? true : revision !== bound.savedRevision) : false
  const canSave = !!info && !isApp && !!read && !busy && !changedByOther && !!info.storageOrigin &&
    ((bound && bound.access !== 'read' && dirty) || info.mnemos.kind === 'project')

  const refresh = useCallback(async () => {
    if (!api) return
    const next = await api.api.describe()
    setPhase({ kind: 'ready', info: next })
  }, [api])

  const save = useCallback(async () => {
    if (!api || !info || !read || busy) return
    const format = info.format
    if (format === 'cloudflareos.app') return
    const signal = lifetime.current.signal
    setBusy('save'); setMessage(null)
    try {
      if (info.mnemos.kind === 'project') {
        const snapshot = await read.read(format, signal).catch(() => null)
        await createInProject({ api: api.api, read: read.read, format, storageOrigin: info.storageOrigin, name: documentName(snapshot, info.title), signal })
        setMessage({ tone: 'note', text: `Сохранено в проект «${info.mnemos.projectTitle}» как ваш черновик.` })
      } else if (bound) {
        await saveVersion({ api: api.api, read: read.read, format, storageOrigin: info.storageOrigin, base: bound.savedHead, signal })
        setMessage({ tone: 'note', text: 'Новая версия сохранена в Mnemos.' })
      }
      await refresh()
    } catch (error) {
      if (signal.aborted || fail(error)) return
      if (isDocumentChanged(error)) {
        setChangedByOther(true)
        setMessage({ tone: 'error', text: 'Документ изменили после того, как вы его открыли. Ваша правка не записана и осталась в редакторе. Откройте последнюю версию в «Версиях» или сохраните на сайте.' })
      } else setMessage({ tone: 'error', text: 'Не сохранилось: Mnemos не принял версию или закрыл доступ. Правка осталась в редакторе, повторите позже.' })
    } finally { if (!signal.aborted) setBusy(null) }
  }, [api, info, read, busy, bound, refresh, fail])

  // Главная кнопка Telegram: «Сохранить», пока есть что сохранять; «Сохранено» — неактивна.
  const mainLabel = !info || isApp ? '' : busy === 'save' ? 'Сохраняю…' : info.mnemos.kind === 'project' ? `Сохранить в «${info.mnemos.projectTitle}»` : bound && bound.access !== 'read' ? (dirty && !changedByOther ? 'Сохранить' : 'Сохранено') : ''
  const telegramMain = webApp?.MainButton ?? null
  useEffect(() => {
    if (!telegramMain) return
    if (!mainLabel || versions) { telegramMain.hide(); return }
    telegramMain.setText(mainLabel)
    const color = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()
    try { telegramMain.setParams?.({ ...(/^#[0-9a-f]{6}$/i.test(color) ? { color } : {}), text_color: '#ffffff' }) } catch { /* старый клиент */ }
    if (canSave) telegramMain.enable(); else telegramMain.disable()
    telegramMain.show()
    const click = () => { void save() }
    telegramMain.onClick(click)
    return () => telegramMain.offClick(click)
  }, [telegramMain, mainLabel, canSave, save, versions])
  useEffect(() => () => telegramMain?.hide(), [telegramMain])

  // Несохранённые правки: Telegram переспросит, прежде чем закрыть окно.
  useEffect(() => {
    if (!webApp?.enableClosingConfirmation) return
    if (bound && dirty && bound.access !== 'read') webApp.enableClosingConfirmation(); else webApp.disableClosingConfirmation?.()
  }, [webApp, bound, dirty])

  const openVersions = useCallback(async (cursor = '') => {
    if (!api) return
    setVersions(old => ({ list: cursor ? old?.list ?? [] : [], next: '', loading: true }))
    try {
      const page = await api.api.versions(cursor)
      setVersions(old => ({ list: [...(cursor ? old?.list ?? [] : []), ...page.versions], next: page.nextCursor, loading: false }))
    } catch (error) {
      if (fail(error)) return
      setVersions(old => ({ list: old?.list ?? [], next: '', loading: false }))
      setMessage({ tone: 'error', text: 'Версии не прочитаны: Mnemos не ответил или закрыл доступ.' })
    }
  }, [api, fail])
  const closeVersions = useCallback(() => { setVersions(null); setChosen(null) }, [])

  // «Назад» Telegram закрывает «Версии».
  const back = webApp?.BackButton ?? null
  useEffect(() => {
    if (!back) return
    if (!versions) { back.hide(); return }
    const onBack = () => { if (chosen) setChosen(null); else closeVersions() }
    back.show(); back.onClick(onBack)
    return () => back.offClick(onBack)
  }, [back, versions, chosen, closeVersions])

  const restore = useCallback(async (version: MiniAppVersion) => {
    if (!api || !info || !read || busy) return
    const format = info.format
    if (format === 'cloudflareos.app') return
    const signal = lifetime.current.signal
    setBusy('restore'); setMessage(null)
    try {
      const snapshot = await fetchVersion({ api: api.api, id: version.id, format, storageOrigin: info.storageOrigin, signal })
      const current = snapshotRevision(await read.read(format, signal))
      if (current === null) throw new Error('no revision')
      using editor = await api.api.connectEditor() as unknown as RpcStub<NativeDocumentEditor>
      await editor.restoreDocumentSnapshot(snapshot, current)
      setChangedByOther(false)
      closeVersions()
      setMessage({ tone: 'note', text: `В редакторе версия ${when(version.recordedAt)}. Сохраните, чтобы она стала новой версией.` })
    } catch (error) {
      if (signal.aborted || fail(error)) return
      setMessage({ tone: 'error', text: 'Версия не открылась: она изменилась или доступ закрыт.' })
    } finally { if (!signal.aborted) setBusy(null) }
  }, [api, info, read, busy, closeVersions, fail])

  // Страница уходит (Telegram закрыл Mini App): сессия удаляется сразу. Сворачивание (visibilitychange)
  // сессию не трогает — человек вернётся к тому же документу. Обрыв связи сервер тоже считает закрытием.
  useEffect(() => {
    if (!api) return
    const leave = () => { void Promise.resolve(api.api.close()).catch(() => {}) }
    addEventListener('pagehide', leave)
    return () => removeEventListener('pagehide', leave)
  }, [api])
  const closeApp = () => {
    if (api) void Promise.resolve(api.api.close()).catch(() => {})
    webApp?.close()
  }

  const openSite = () => {
    const url = siteUrl ?? (info ? new URL(info.sitePath, window.location.origin).href : null)
    if (!url) return
    if (webApp?.openLink) webApp.openLink(url); else window.open(url, '_blank', 'noopener,noreferrer')
  }

  if (phase.kind === 'ended') return (
    <main className="ma">
      <h1 className="ma-heading">Сессия закончилась</h1>
      <p className="ma-note">Документ открывается в Telegram на 30 минут и закрывается, если отключить бота или сменить аккаунт Mnemos. Нажмите «Открыть» в чате с ботом ещё раз.</p>
      <div className="ma-actions"><button type="button" className="ma-secondary" onClick={closeApp}>Закрыть</button></div>
    </main>
  )
  if (phase.kind === 'failed') return (
    <main className="ma">
      <h1 className="ma-heading">Документ не открылся</h1>
      <p className="ma-note">Возможно, беседу удалили или доступ к её материалам изменился. На сайте видно, в чём дело.</p>
      <div className="ma-actions">
        {siteUrl && <button type="button" className="ma-primary" onClick={openSite}>Открыть на сайте</button>}
        <button type="button" className="ma-secondary" onClick={closeApp}>Закрыть</button>
      </div>
    </main>
  )

  const status = !info ? 'подключаюсь…'
    : isApp ? (info.mnemos.kind === 'bound' ? (info.mnemos.access === 'read' ? 'приложение проекта · только просмотр' : 'приложение проекта') : 'приложение беседы')
    : busy === 'save' ? 'сохраняю…'
    : busy === 'restore' ? 'открываю версию…'
    : changedByOther ? 'документ изменили без вас'
    : bound ? (bound.access === 'read' ? 'только чтение' : dirty ? 'есть несохранённые правки' : 'версия сохранена')
    : info.mnemos.kind === 'project' ? `ещё не сохранён, проект «${info.mnemos.projectTitle}»`
    : 'не сохранён, правки хранятся в беседе'

  return (
    <div className="md" data-busy={busy ? 'true' : undefined}>
      <header className="md-head">
        <div className="md-titles">
          {/* Название видно в шапке самого редактора; здесь — для чтения с экрана. */}
          <h1 className="md-title">{info?.title ?? title}</h1>
          <p className={`md-status${changedByOther ? ' md-status-alert' : ''}`} role="status">{status}</p>
        </div>
        {bound && <button type="button" className="md-versions" onClick={() => { void openVersions() }} disabled={!!busy}>Версии</button>}
      </header>
      <div className="md-progress" aria-hidden="true" />
      {message && <p className={`md-message md-message-${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      {isApp && <p className="md-message md-message-note">Код и версии приложения меняются на сайте. <button type="button" className="md-link" onClick={openSite}>Открыть на сайте</button></p>}
      {!isApp && info?.mnemos.kind === 'none' && <p className="md-message md-message-note">В Mnemos этот документ сохраняется на сайте: там выбирается проект. <button type="button" className="md-link" onClick={openSite}>Открыть на сайте</button></p>}
      {info && !isApp && !info.storageOrigin && info.mnemos.kind !== 'none' && <p className="md-message md-message-note">Хранилище Mnemos недоступно из Telegram. <button type="button" className="md-link" onClick={openSite}>Сохранить на сайте</button></p>}
      <div className="md-stage">
        {api && info && <Frame api={api.api} accent={info.accent} mode={mode} onSnapshotSource={next => setRead(next ? { read: next } : null)} onFailed={() => setPhase({ kind: 'failed' })} />}
      </div>
      {!telegramMain && mainLabel && !versions && (
        <footer className="md-foot">
          <button type="button" className="ma-primary" disabled={!canSave} onClick={() => { void save() }}>{mainLabel}</button>
        </footer>
      )}
      {versions && (
        <section className="md-sheet" aria-label="Версии документа">
          <div className="md-sheet-head">
            <h2 className="md-sheet-title">Версии</h2>
            {!back && <button type="button" className="md-link" onClick={closeVersions}>Закрыть</button>}
          </div>
          {versions.loading && !versions.list.length && <p className="ma-status">Читаю версии…</p>}
          {!versions.loading && !versions.list.length && <p className="ma-note">Сохранённых версий пока нет.</p>}
          <ol className="md-list">
            {versions.list.map((version, index) => (
              <li key={version.id}>
                <button type="button" className="md-row" aria-pressed={chosen?.id === version.id} onClick={() => setChosen(chosen?.id === version.id ? null : version)}>
                  <span className="md-row-when">{index === 0 ? 'Последняя, ' : ''}{when(version.recordedAt)}</span>
                  <span className="md-row-who">{who(version)}</span>
                </button>
                {chosen?.id === version.id && (
                  <div className="md-row-act">
                    <p className="ma-note">Версия встанет в редактор вместо текущего текста. В Mnemos она станет новой версией, когда вы сохраните.</p>
                    <button type="button" className="ma-primary" disabled={!!busy || !read} onClick={() => { void restore(version) }}>{busy === 'restore' ? 'Открываю…' : 'Вернуть эту версию'}</button>
                  </div>
                )}
              </li>
            ))}
          </ol>
          {versions.next && <button type="button" className="ma-secondary md-more" disabled={versions.loading} onClick={() => { void openVersions(versions.next) }}>Показать раньше</button>}
        </section>
      )}
    </div>
  )
}
