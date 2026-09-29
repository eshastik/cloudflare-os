// Приложение как файл проекта Mnemos (ADR 0028 Mnemos, этапы 1–2): шапка гаджета рабочего места.
//
// Открывается так же, как документ: код версии узла встаёт в гаджет своего рабочего места, шапка
// показывает состояние, «Поделиться» и «Версии». Совместное приложение (collaborative) работает одним
// общим экземпляром на узел: экран подключается к нему, пока код рабочего места совпадает с
// сохранённой версией. Правки кода (в беседе или принятые, но не сохранённые) показываются
// предпросмотром — отдельным экземпляром рабочего места, живой экземпляр их не видит и не сбрасывается.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaretLeft } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi, GadgetClient } from '@gadgets/workshop-shared/api'
import type { GatekeeperNativeDocumentSelector, GatekeeperNativeDocumentWriteSelector, GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import {
  GADGET_APP_FORMAT, gadgetAppText, parseGadgetAppText,
  type GadgetAppPermission, type MnemosAppBinding, type MnemosAppConnection, type MnemosAppInfo, type MnemosAppState,
} from '@gadgets/workshop-shared/gadget-app'
import { DocumentStatusView, DOCUMENT_SHARE_EVENT, DOCUMENT_VERSIONS_EVENT, formatAgo, type DocumentStatusModel, type PrimaryKind } from './DocumentStatus'
import DocumentSharePanel from './DocumentSharePanel'
import { PANEL_CLASS, PANEL_HEADER_CLASS, pillButton, primaryButton } from './DocumentVersionPanel'
import { listAccounts, openNativeWritesFrame, storesDocuments } from './accountCapabilities'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { downloadGatekeeperAppText } from './gatekeeperAppDownload'
import { uploadGatekeeperAppText } from './gatekeeperAppUpload'
import { clearMnemosAppLaunch, readMnemosAppLaunch } from './mnemosAppLaunch'
import { isDocumentChanged } from './nativeMnemosDocument'
import { useAuthenticatedApi } from './AuthContext'

type Writes = RpcStub<GatekeeperNativeDocumentWriteSelector>
type Downloads = RpcStub<GatekeeperNativeDocumentSelector>
type Api = Pick<RpcStub<AuthenticatedApi>, 'subscribeConnectedAccounts' | 'getGatekeeperApp' | 'openMnemosApp'>
type Gadget = Pick<RpcStub<GadgetClient>, 'getId' | 'getMnemosApp' | 'setMnemosApp' | 'exportAppModules' | 'restoreAppModules'>
type Source = { accountId: number; writes: Writes; downloads: Downloads; origin: string; frame: GatekeeperUiFrame }
type Live = { connection: RpcStub<MnemosAppConnection>; info: MnemosAppInfo }
/** Право на узел: владелец личной версии, правка по приглашению или проекту, только просмотр. */
export type AppAccess = 'owner' | 'edit' | 'read'
export type AppVersion = { id: string; recordedAt: string; author: string; personal: boolean }

/** Как часто шапка сверяет код рабочего места и работающую версию общего экземпляра. */
export const APP_POLL_MS = 10_000

/** Опубликованная версия узла (не личная): только она работает в общем экземпляре. */
export const isPublishedVersion = (version?: string | null) => !!version && !version.startsWith('private:')

/** Три факта шапки и одно главное действие для приложения; порядок — от блокирующего к обычному. */
export function deriveAppStatus(input: {
  access: AppAccess | null; collaborative: boolean; unsaved: boolean; savedVersion?: string
  liveVersion?: string | null; liveError?: string; savedAt?: string | null; now?: number
}): DocumentStatusModel {
  const { access, collaborative, unsaved, savedVersion, liveVersion, liveError, savedAt, now = Date.now() } = input
  const version = collaborative ? 'Общее приложение' : 'Приложение'
  const audience = access === 'read' ? 'только просмотр' : collaborative ? 'одна база на всех, кому открыт файл' : 'данные у каждого свои'
  const editor = access === 'owner' || access === 'edit'
  if (access === null) return { kind: 'unread', version, audience, saved: 'права на файл не прочитаны', tone: 'warning', primary: null, secondary: null }
  if (unsaved) {
    if (!editor) return { kind: 'readonly', version, audience, saved: 'правки не сохранятся: файл открыт только для просмотра', tone: 'warning', primary: null, secondary: null }
    return { kind: 'unsaved', version, audience, saved: 'не сохранено · это предпросмотр со своими данными', tone: 'warning',
      primary: { kind: 'save', label: 'Сохранить', hint: collaborative ? 'Сохранится личная версия файла. У всех она заработает после публикации.' : 'Новая версия файла появится в проекте.' }, secondary: null }
  }
  if (liveError && !(collaborative && editor && !isPublishedVersion(savedVersion))) return { kind: 'unread', version, audience, saved: liveError, tone: 'danger', primary: null, secondary: null }
  const when = savedAt ? `сохранено ${formatAgo(savedAt, now)}` : 'сохранено'
  if (collaborative && !isPublishedVersion(savedVersion) && editor) {
    // Личная версия: у всех работает опубликованная, эта — только в предпросмотре автора.
    return { kind: 'saved', version, audience, saved: `${when} · личная версия, у всех — опубликованная`, tone: 'neutral',
      primary: access === 'owner' ? { kind: 'submit', label: 'Опубликовать', hint: 'В общем экземпляре работает только опубликованная версия, как у документа.' } : null, secondary: null }
  }
  if (collaborative && liveVersion && savedVersion && liveVersion !== savedVersion) {
    return { kind: 'changed', version, audience, saved: 'у всех работает другая версия', tone: 'info',
      primary: editor && isPublishedVersion(savedVersion) ? { kind: 'start', label: 'Запустить эту версию', hint: 'Общий экземпляр перейдёт на эту опубликованную версию. Данные приложения сохранятся.' } : null, secondary: null }
  }
  if (access === 'owner' && !isPublishedVersion(savedVersion)) {
    return { kind: 'saved', version, audience, saved: `${when} · личная версия`, tone: 'neutral',
      primary: { kind: 'submit', label: 'Опубликовать', hint: 'Отдел и организация видят только опубликованную версию.' }, secondary: null }
  }
  return { kind: isPublishedVersion(savedVersion) ? 'published' : 'saved', version, audience, saved: isPublishedVersion(savedVersion) ? 'опубликовано' : when, tone: isPublishedVersion(savedVersion) ? 'success' : 'neutral', primary: null, secondary: null }
}

const dispose = (value: unknown) => { try { (value as Partial<Disposable> | null | undefined)?.[Symbol.dispose]?.() } catch { /* уже закрыт */ } }
const errorText = (error: unknown, fallback: string) => error instanceof Error && /[А-Яа-яЁё]/.test(error.message) ? error.message : fallback

async function openSource(api: Api, accountId?: number): Promise<Source> {
  const frame = await openNativeWritesFrame(api, accountId)
  if (!frame.nativeDownloads) { disposeGatekeeperFrame(frame); throw new Error('Подключение Mnemos недоступно.') }
  const accounts = await listAccounts(api)
  const account = accounts.find(a => storesDocuments(a) && (accountId === undefined || a.id === accountId))
  if (!account) { disposeGatekeeperFrame(frame); throw new Error('Подключение Mnemos недоступно.') }
  return { accountId: account.id, writes: frame.nativeWrites.selector as unknown as Writes, downloads: frame.nativeDownloads.selector as unknown as Downloads, origin: frame.nativeWrites.storageOrigin, frame }
}

/** Точный текст версии узла: сумму и тип сверяет браузер, доступ к версии — Mnemos. */
async function downloadVersion(source: Source, scope: string, resource: string, version: string, signal: AbortSignal): Promise<string> {
  using download = await source.downloads.select(scope, resource, version)
  const ticket = await download.issue(); signal.throwIfAborted()
  return await downloadGatekeeperAppText(source.origin, ticket as never, signal, () => download.validate())
}

async function readAccess(source: Source, scope: string, resource: string): Promise<AppAccess> {
  const app = await source.writes.appAccess(scope, resource, false)
  if (app.access === 'read') return 'read'
  try { using writer = await source.writes.select(scope, resource, GADGET_APP_FORMAT); return (await writer.access()) === 'owner' ? 'owner' : 'edit' }
  catch { return 'edit' }
}

async function readVersions(source: Source, scope: string, resource: string): Promise<AppVersion[]> {
  const page = await source.downloads.publications(scope, resource, '')
  return page.publications.filter(p => p.format === GADGET_APP_FORMAT).map(p => ({ id: p.id, recordedAt: p.recordedAt, author: p.author || p.actor || '', personal: p.id.startsWith('private:') }))
}

export type MnemosAppHandle = ReturnType<typeof useMnemosApp>

/**
 * Всё о приложении текущего гаджета: привязка к узлу, право, общий экземпляр и действия шапки.
 * previewChatId — беседа с предложенными правками: пока она открыта, экран показывает предпросмотр.
 */
export function useMnemosApp({ api, gadget, previewChatId, pollMs = APP_POLL_MS }: { api: Api; gadget: Gadget | null; previewChatId?: number; pollMs?: number }) {
  const [app, setApp] = useState<MnemosAppState | null>(null)
  const [access, setAccess] = useState<AppAccess | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [liveError, setLiveError] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [versions, setVersions] = useState<AppVersion[] | null>(null)
  const [tick, setTick] = useState(0)
  const source = useRef<Source | null>(null)
  const lifetime = useRef(new AbortController())
  useEffect(() => { const own = new AbortController(); lifetime.current = own; return () => own.abort() }, [gadget])
  const binding = app?.binding ?? null
  const identity = binding ? JSON.stringify([binding.accountId, binding.scope, binding.resource]) : ''

  const reload = useCallback(async () => {
    if (!gadget) return null
    const next = await gadget.getMnemosApp()
    setApp(next)
    return next
  }, [gadget])

  // Состояние рабочего места и опрос версии кода: принятая правка делает приложение несохранённым.
  useEffect(() => {
    setApp(null); setAccess(null); setLive(null); setLiveError(''); setError(''); setNotice(''); setVersions(null)
    if (!gadget) return
    let stopped = false
    void reload().catch(() => {})
    const timer = pollMs > 0 ? setInterval(() => { if (!stopped && document.visibilityState !== 'hidden') void reload().catch(() => {}) }, pollMs) : undefined
    return () => { stopped = true; clearInterval(timer) }
  }, [gadget, reload, pollMs])

  // Подключение Mnemos привязки и право на узел.
  useEffect(() => {
    if (!identity || !binding) return
    let cancelled = false, opened: Source | null = null
    void (async () => {
      try {
        opened = await openSource(api, binding.accountId)
        if (cancelled) { disposeGatekeeperFrame(opened.frame); return }
        source.current = opened
        setAccess(await readAccess(opened, binding.scope, binding.resource))
      } catch (caught) { if (!cancelled) setError(errorText(caught, 'Права на файл приложения не прочитаны. Проверьте подключение Mnemos.')) }
    })()
    return () => { cancelled = true; if (source.current === opened) source.current = null; if (opened) disposeGatekeeperFrame(opened.frame) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перечитывается при смене узла
  }, [api, identity, tick])

  // Экземпляр приложения: общий у совместного, свой у остальных; связь и работающая версия, опрос смены версии.
  const collaborative = !!binding?.collaborative
  useEffect(() => {
    if (!identity || !binding) { setLive(null); setLiveError(''); return }
    let cancelled = false, connection: RpcStub<MnemosAppConnection> | null = null
    let timer: ReturnType<typeof setInterval> | undefined
    void (async () => {
      try {
        connection = await api.openMnemosApp(binding.accountId, binding.scope, binding.resource, !binding.collaborative) as unknown as RpcStub<MnemosAppConnection>
        const info = await connection.describe()
        if (cancelled) { dispose(connection); return }
        setLive({ connection, info }); setLiveError(info.deployed ? '' : binding.collaborative ? 'приложение ещё не опубликовано' : 'приложение ещё не запущено')
        if (pollMs > 0) timer = setInterval(() => {
          if (document.visibilityState === 'hidden' || !connection) return
          void connection.describe().then(next => { if (!cancelled) setLive(old => old && old.info.deployed?.sha256 === next.deployed?.sha256 ? old : { connection: connection!, info: next }) },
            caught => { if (!cancelled) setLiveError(errorText(caught, 'связь с приложением закрыта')) })
        }, pollMs * 3)
      } catch (caught) {
        if (!cancelled) { setLive(null); setLiveError(errorText(caught, 'приложение недоступно')) }
      }
    })()
    return () => { cancelled = true; clearInterval(timer); dispose(connection) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перечитывается при смене узла
  }, [api, identity, collaborative, tick])

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (busy) return
    const signal = lifetime.current.signal
    setBusy(true); setError(''); setNotice('')
    try { await action(signal) }
    catch (caught) { if (!signal.aborted) setError(errorText(caught, 'Действие не выполнено: Mnemos не ответил. Повторите попытку.')) }
    finally { if (!signal.aborted) setBusy(false) }
  }

  /**
   * Открыть версию узла. С правом правки код версии встаёт в гаджет рабочего места (для правки и
   * предпросмотра). Без права правки код в рабочее место не кладётся и в браузер не скачивается: манифест
   * и запуск читает сама оболочка, страница получает только экран экземпляра.
   */
  async function openVersion(accountId: number, scope: string, resource: string, publication: string, signal: AbortSignal) {
    if (!gadget) return
    const opened = source.current?.accountId === accountId ? source.current : await openSource(api, accountId)
    try {
      const rights = await readAccess(opened, scope, resource); signal.throwIfAborted()
      const editor = rights !== 'read'
      const state = await gadget.getMnemosApp()
      const same = state.binding && state.binding.scope === scope && state.binding.resource === resource
      if (same && state.binding!.savedCodeVersion !== undefined && state.binding!.savedCodeVersion !== state.codeVersion) {
        setNotice('В этом рабочем месте есть несохранённые правки приложения: открыта ваша копия. Сохраните её или верните версию в «Версиях».')
        return
      }
      let manifest, codeVersion: number | undefined
      if (editor) {
        const text = await downloadVersion(opened, scope, resource, publication, signal)
        const { document } = parseGadgetAppText(text)
        manifest = document.manifest
        codeVersion = same && state.binding!.savedVersion === publication && state.binding!.savedCodeVersion !== undefined
          ? state.binding!.savedCodeVersion : await gadget.restoreAppModules(document.modules, document.manifest.title, state.codeVersion)
      } else {
        using connection = await api.openMnemosApp(accountId, scope, resource, false) as unknown as RpcStub<MnemosAppConnection>
        manifest = await connection.manifest(publication)
      }
      const next: MnemosAppBinding = {
        accountId, scope, resource, description: manifest.description, collaborative: manifest.collaborative, session: manifest.session,
        permissions: manifest.permissions, savedVersion: publication, ...(codeVersion !== undefined ? { savedCodeVersion: codeVersion } : {}),
        ...(editor && publication.startsWith('private:') && /^[a-f0-9]{64}$/.test(publication.slice(8)) ? { savedHead: publication.slice(8) } : {}),
      }
      await gadget.setMnemosApp(next)
      if (manifest.collaborative) {
        // Пустой общий экземпляр поднимается только опубликованной версией; работающую версию открытие не меняет.
        using connection = await api.openMnemosApp(accountId, scope, resource, false) as unknown as RpcStub<MnemosAppConnection>
        const info = await connection.describe()
        if (!info.deployed && isPublishedVersion(publication)) await connection.deploy(publication).catch(() => {})
      } else {
        // Свой экземпляр: работает открытая версия.
        using connection = await api.openMnemosApp(accountId, scope, resource, true) as unknown as RpcStub<MnemosAppConnection>
        const info = await connection.describe()
        if (info.deployed?.version !== publication) await connection.deploy(publication)
      }
      await reload(); setTick(t => t + 1)
    } finally { if (opened !== source.current) disposeGatekeeperFrame(opened.frame) }
  }

  // Открытие из Mnemos: заявка страницы выполняется один раз для своего гаджета.
  const launched = useRef(false)
  useEffect(() => {
    if (!gadget || !app || launched.current) return
    const launch = readMnemosAppLaunch()
    if (!launch) return
    launched.current = true
    void gadget.getId().then(id => {
      if (id !== launch.gadgetId) return
      clearMnemosAppLaunch()
      return run(signal => openVersion(launch.accountId, launch.scope, launch.resource, launch.publication, signal))
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз на гаджет
  }, [gadget, app])

  /** Текст новой версии из принятого кода рабочего места. */
  async function currentText(current: MnemosAppBinding | null, choice?: { collaborative: boolean; description: string; permissions: GadgetAppPermission[] }) {
    if (!gadget) throw new Error('Гаджет не выбран.')
    const exported = await gadget.exportAppModules()
    const collaborative = choice?.collaborative ?? current?.collaborative ?? false
    // Признак session — из кода: сервер объявил метод session(caller). Общим данным он обязателен.
    const session = /\bsession\s*\(/.test(exported.modules['server.js'])
    if (collaborative && !session) throw new Error('Для общих данных в server.js нужен метод session(caller): по нему приложение знает, кто вызывает.')
    const manifest = { title: exported.title.trim().slice(0, 120) || 'Приложение', description: choice?.description ?? current?.description ?? '',
      collaborative, session, formatVersion: 1 as const, permissions: choice?.permissions ?? current?.permissions ?? [] }
    return { text: gadgetAppText({ manifest, modules: exported.modules }), codeVersion: exported.codeVersion, session }
  }

  /** Запуск версии: код читает сама оболочка. Общий экземпляр — только опубликованные версии. */
  async function deploy(current: MnemosAppBinding, version: string) {
    using connection = await api.openMnemosApp(current.accountId, current.scope, current.resource, !current.collaborative) as unknown as RpcStub<MnemosAppConnection>
    await connection.deploy(version)
  }

  /** «Сохранить»: новая личная версия узла. У совместного приложения общий экземпляр не меняется до публикации. */
  const save = () => run(async signal => {
    const current = binding, way = source.current
    if (!current || !way || !gadget) return
    const { text, codeVersion, session } = await currentText(current)
    using writer = await way.writes.select(current.scope, current.resource, GADGET_APP_FORMAT)
    const base = current.savedHead ?? await writer.head(); signal.throwIfAborted()
    const upload = await uploadGatekeeperAppText(text, way.origin, (size, checksum) => writer.issue(base, size, checksum), signal)
    let head: string
    try { head = await writer.save(base, upload) }
    catch (caught) { if (isDocumentChanged(caught)) throw new Error('Файл приложения изменил другой участник после вашего открытия. Откройте новую версию в «Версиях».'); throw caught }
    const next: MnemosAppBinding = { ...current, session, savedCodeVersion: codeVersion, savedHead: head, savedVersion: `private:${head}` }
    await gadget.setMnemosApp(next)
    if (!current.collaborative) await deploy(next, `private:${head}`)
    setNotice(current.collaborative ? 'Личная версия сохранена. У всех она заработает после публикации.' : 'Версия сохранена в проект.')
    await reload(); setTick(t => t + 1)
  })

  /** «Сохранить в проект»: новый файл приложения в проекте. */
  const saveToProject = (choice: { accountId: number; scope: string; collaborative: boolean; description: string; permissions: GadgetAppPermission[] }) => run(async signal => {
    if (!gadget) return
    const way = await openSource(api, choice.accountId)
    try {
      const { text, codeVersion, session } = await currentText(null, choice)
      const name = parseGadgetAppText(text).document.manifest.title
      using creator = await way.writes.create(choice.scope, name, GADGET_APP_FORMAT)
      const head = await creator.head(); signal.throwIfAborted()
      const upload = await uploadGatekeeperAppText(text, way.origin, (size, checksum) => creator.issue(head, size, checksum), signal)
      const saved = await creator.save(head, upload)
      const resource = await creator.document()
      const next: MnemosAppBinding = { accountId: way.accountId, scope: choice.scope, resource, description: choice.description, collaborative: choice.collaborative, session,
        permissions: choice.permissions, savedCodeVersion: codeVersion, ...(/^[a-f0-9]{64}$/.test(saved) ? { savedHead: saved, savedVersion: `private:${saved}` } : {}) }
      await gadget.setMnemosApp(next)
      if (!choice.collaborative && next.savedVersion) await deploy(next, next.savedVersion)
      setNotice(choice.collaborative ? 'Приложение сохранено в проект личной версией. У всех оно заработает после публикации.' : 'Приложение сохранено в проект. Поделиться им можно кнопкой «Поделиться».')
      await reload(); setTick(t => t + 1)
    } finally { disposeGatekeeperFrame(way.frame) }
  })

  /** «Опубликовать»: как у документа; опубликованная версия становится работающей у совместного приложения. */
  const publish = () => run(async signal => {
    const current = binding, way = source.current
    if (!current || !way || !gadget) return
    const state = await way.writes.publicationState(current.scope); signal.throwIfAborted()
    const outcome = await way.writes.publishOrRequestReview(current.scope, state.personal_head, state.shared_head)
    if (outcome.status === 'review') { setNotice('Версия отправлена на согласование. После публикации она заработает у отдела и организации.'); return }
    if (outcome.status === 'denied') throw new Error('Публикация не прошла: нет права записи в проект. Попросите владельца проекта открыть вам правку.')
    if (outcome.status === 'folder_removed') throw new Error(outcome.message)
    if (outcome.status !== 'published') { setNotice(outcome.status === 'conflict' ? 'Обнаружен конфликт с опубликованной версией.' : 'Публиковать нечего: версия не отличается от опубликованной.'); return }
    const published = (await readVersions(way, current.scope, current.resource)).find(v => !v.personal)
    if (published) {
      const next = { ...current, savedVersion: published.id }
      await gadget.setMnemosApp(next)
      await deploy(next, published.id)
    }
    setNotice('Версия опубликована.')
    await reload(); setTick(t => t + 1)
  })

  /** «Запустить эту версию»: общий экземпляр переходит на открытую опубликованную версию (нужна правка). */
  const start = () => run(async () => {
    const current = binding
    if (!current?.savedVersion || !isPublishedVersion(current.savedVersion)) return
    await deploy(current, current.savedVersion)
    setNotice('Эта версия теперь работает у всех.'); setTick(t => t + 1)
  })

  const loadVersions = () => run(async () => {
    const way = source.current
    if (!binding || !way) return
    setVersions(await readVersions(way, binding.scope, binding.resource))
  })

  /** «Вернуть версию»: код версии встаёт в рабочее место несохранённым; «Сохранить» сделает его новой версией. */
  const restoreVersion = (version: AppVersion) => run(async signal => {
    const way = source.current
    if (!binding || !way || !gadget) return
    const text = await downloadVersion(way, binding.scope, binding.resource, version.id, signal)
    const { document } = parseGadgetAppText(text)
    const state = await gadget.getMnemosApp()
    await gadget.restoreAppModules(document.modules, document.manifest.title, state.codeVersion)
    setNotice('Код версии открыт в рабочем месте. Сохраните его, чтобы он стал новой версией.')
    await reload()
  })

  /** Код приложения лежит в рабочем месте (открывший с правом правки или сохранивший из беседы). */
  const hasCode = !!binding && binding.savedCodeVersion !== undefined
  const unsaved = hasCode && app !== null && binding!.savedCodeVersion !== app.codeVersion
  const preview = previewChatId !== undefined
  /** Экран общего экземпляра: только для сохранённого кода и без предпросмотра беседы. */
  // Рабочее место (предпросмотр со своими данными): правки, беседа с правками или своя версия автора,
  // которая не совпадает с работающей. Иначе — экран экземпляра узла; у читателя кода в рабочем месте нет.
  const showWorkspace = !binding || preview || unsaved || (hasCode && live?.info.deployed?.version !== binding.savedVersion)
  const liveGadget = useMemo(() => {
    if (!live?.info.deployed || showWorkspace) return null
    const connection = live.connection
    return { getUiBundle: () => connection.getUiBundle(), connectToGadget: () => connection.connectToGadget(), key: live.info.deployed.sha256 }
  }, [live, showWorkspace])

  const model = useMemo(() => {
    if (!binding) return null
    return deriveAppStatus({ access, collaborative, unsaved: unsaved || preview, savedVersion: binding.savedVersion, liveVersion: live?.info.deployed?.version ?? null, liveError, savedAt: null })
  }, [binding, access, collaborative, unsaved, preview, live, liveError])

  return { app, binding, access, live, liveError, liveGadget, showWorkspace, hasCode, unsaved, preview, model, busy, error, notice, versions,
    save, saveToProject, publish, start, loadVersions, restoreVersion, writes: () => source.current?.writes ?? null, refresh: () => setTick(t => t + 1) }
}

type PanelSection = 'share' | 'versions' | 'save'

/** Шапка приложения: строка состояния, главное действие, «Версии» и «Поделиться» (события шапки гаджета). */
export default function MnemosAppStatus({ handle, compact, panelHost, onShareShown }: {
  handle: MnemosAppHandle; compact?: boolean; panelHost?: Element | null; onShareShown?(shown: boolean): void
}) {
  const [panel, setPanel] = useState<PanelSection | null>(null)
  useEffect(() => {
    const share = () => setPanel('share')
    const versions = () => setPanel(old => old === 'versions' ? null : 'versions')
    window.addEventListener(DOCUMENT_SHARE_EVENT, share)
    window.addEventListener(DOCUMENT_VERSIONS_EVENT, versions)
    return () => { window.removeEventListener(DOCUMENT_SHARE_EVENT, share); window.removeEventListener(DOCUMENT_VERSIONS_EVENT, versions) }
  }, [])
  useEffect(() => { if (panel === 'versions') handle.loadVersions() }, [panel, handle.binding?.resource])
  const onPrimary = (kind: PrimaryKind) => {
    if (kind === 'save') void handle.save()
    else if (kind === 'submit') void handle.publish()
    else if (kind === 'start') void handle.start()
  }
  // Привязанный к узлу гаджет в другой проект не сохраняется: чужое приложение не уносится копией.
  const exportable = handle.app?.notExportable === null && !handle.binding
  const node = panel === 'share'
    ? <DocumentSharePanel selector={handle.writes()} binding={handle.binding ? { accountId: handle.binding.accountId, scope: handle.binding.scope, resource: handle.binding.resource } : null}
        format={GADGET_APP_FORMAT} documentName={handle.app?.title ?? null} onClose={() => setPanel(null)} />
    : panel === 'versions' ? <AppVersionsPanel handle={handle} onClose={() => setPanel(null)} />
    : panel === 'save' ? <SaveAppPanel handle={handle} onClose={() => setPanel(null)} />
    : null
  return <>
    <DocumentStatusView model={handle.model} bound={!!handle.binding} busy={handle.busy || (!!handle.binding && !handle.model)} versionOpen={panel === 'versions'}
      error={panel ? undefined : handle.error || undefined} flash={panel ? undefined : handle.notice || undefined} compact={compact}
      onShare={compact ? () => setPanel('share') : undefined} onShareShown={onShareShown}
      onPrimary={onPrimary} onSecondary={() => {}} onOpenVersion={() => setPanel(old => old === 'versions' ? null : 'versions')}
      onSaveToProject={exportable ? () => setPanel('save') : undefined} />
    {panelHost ? createPortal(node, panelHost) : node}
  </>
}

function PanelHeader({ title, subtitle, onClose }: { title: string; subtitle?: string | null; onClose(): void }) {
  return <header className={PANEL_HEADER_CLASS}>
    <button type="button" aria-label="Назад к приложению" onClick={onClose}
      className="inline-flex h-10 w-10 sm:h-[34px] sm:w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-kumo-fill-hover bg-transparent text-kumo-default hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring"><CaretLeft size={16} /></button>
    <div className="min-w-0 flex-1">
      <h2 className="m-0 text-[20px] leading-7 font-semibold tracking-[-0.3px] text-kumo-default">{title}</h2>
      {subtitle && <p title={subtitle} className="m-0 text-[14px] leading-5 text-kumo-subtle [overflow-wrap:anywhere] sm:truncate">{subtitle}</p>}
    </div>
  </header>
}

const rowText = 'text-[14px] leading-5 text-kumo-default'
const subText = 'text-[13px] leading-[18px] text-kumo-subtle'
const ACTIONS = 'flex flex-col items-stretch gap-2 pt-1 sm:flex-row sm:flex-wrap sm:items-center'

/** «Версии» приложения: список версий узла, «Вернуть версию» ставит код в рабочее место. */
function AppVersionsPanel({ handle, onClose }: { handle: MnemosAppHandle; onClose(): void }) {
  const rows = handle.versions ?? []
  const canEdit = handle.access === 'owner' || handle.access === 'edit'
  return <aside data-app-versions aria-label="Версии" className={PANEL_CLASS}>
    <PanelHeader title="Версии" subtitle={handle.app?.title} onClose={onClose} />
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:px-7 sm:pb-[26px]">
      {!handle.binding && <p className={`m-0 ${rowText}`}>Приложение ещё не сохранено в проект: версий нет.</p>}
      {handle.error && <p role="alert" className={`m-0 ${rowText} text-kumo-danger`}>{handle.error}</p>}
      {handle.notice && <p role="status" className={`m-0 ${rowText}`}>{handle.notice}</p>}
      {handle.binding && handle.versions === null && !handle.error && <p role="status" className={`m-0 ${subText}`}>Загрузка версий…</p>}
      {handle.binding && <ol aria-label="Версии приложения" className="m-0 -mx-3 flex list-none flex-col gap-0.5 p-0">
        {rows.map((row, index) => {
          const running = handle.live?.info.deployed?.version === row.id
          return <li key={row.id} className="flex items-start gap-4 rounded-[14px] px-3 py-3">
            <span className="min-w-0 flex-1">
              <span className={`block text-[15px] leading-5 text-kumo-default ${index === 0 ? 'font-semibold' : ''}`}>Версия {rows.length - index}</span>
              <span className="mt-[3px] block truncate text-[14px] leading-5 text-kumo-subtle">{row.author || (row.personal ? 'Личная версия' : 'Участник')}{row.recordedAt ? ` · ${formatAgo(row.recordedAt)}` : ''}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1.5">
              {!row.personal && <span className="rounded-full bg-selection-bg px-2.5 py-0.5 text-[12px] leading-4 font-medium text-selection-text">опубликована</span>}
              {running && <span className="rounded-full bg-kumo-tint px-2.5 py-0.5 text-[12px] leading-4 font-medium text-kumo-subtle">работает у всех</span>}
              {canEdit && index > 0 && <button type="button" className={pillButton} disabled={handle.busy} onClick={() => { void handle.restoreVersion(row) }}>Вернуть</button>}
            </span>
          </li>
        })}
      </ol>}
      {handle.binding && handle.versions !== null && rows.length === 0 && <p className={`m-0 ${subText}`}>Версий пока нет.</p>}
      {rows.length > 0 && <p className={`m-0 ${subText}`}>Ни одна версия не пропадает. Возвращённый код становится новой версией после сохранения; данные приложения при этом не меняются.</p>}
    </div>
  </aside>
}

/** «Сохранить в проект»: проект, совместная работа и описание. */
function SaveAppPanel({ handle, onClose }: { handle: MnemosAppHandle; onClose(): void }) {
  const [scopes, setScopes] = useState<{ accountId: number; id: string; name: string }[] | null>(null)
  const [scope, setScope] = useState(''), [collaborative, setCollaborative] = useState(true), [description, setDescription] = useState('')
  const [directory, setDirectory] = useState(false), [loadError, setLoadError] = useState('')
  const api = useApi()
  useEffect(() => {
    let cancelled = false, opened: Source | null = null
    void openSource(api).then(async way => {
      opened = way
      const page = await way.writes.scopes()
      if (!cancelled) setScopes(page.scopes.map(s => ({ accountId: way.accountId, id: s.id, name: s.name })))
    }).catch(() => { if (!cancelled) setLoadError('Проекты не прочитаны. Проверьте подключение Mnemos.') }).finally(() => { if (opened) disposeGatekeeperFrame(opened.frame) })
    return () => { cancelled = true }
  }, [api])
  const chosen = scopes?.find(s => s.id === scope)
  const blocked = handle.app?.notExportable
  return <aside data-app-save aria-label="Сохранить в проект" className={PANEL_CLASS}>
    <PanelHeader title="Сохранить в проект" subtitle={handle.app?.title} onClose={onClose} />
    <form className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-[26px] sm:px-7" onSubmit={event => {
      event.preventDefault()
      if (chosen) void handle.saveToProject({ accountId: chosen.accountId, scope: chosen.id, collaborative, description: description.trim(), permissions: directory ? ['directory'] : [] }).then(onClose)
    }}>
      <p className={`m-0 ${rowText}`}>Приложение станет файлом проекта: с версиями, публикацией и доступом, как у документа.</p>
      {blocked && <p role="alert" className={`m-0 ${rowText} text-kumo-danger`}>{blocked}</p>}
      <label className={`flex flex-col gap-1.5 ${rowText}`}>Проект
        <select aria-label="Проект" value={scope} onChange={event => setScope(event.target.value)} disabled={!scopes}
          className="h-10 rounded-lg border border-kumo-line bg-kumo-base px-2 text-[16px] sm:h-9 sm:text-[14px]">
          <option value="">{scopes ? 'Выберите проект' : 'Загрузка проектов…'}</option>
          {scopes?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className={`mb-1.5 p-0 ${rowText}`}>Данные приложения</legend>
        <label className={`flex items-start gap-2.5 ${rowText}`}><input type="radio" name="collaborative" checked={collaborative} onChange={() => setCollaborative(true)} className="mt-1 accent-[var(--color-kumo-brand)]" />
          <span>Общие для всех<span className={`block ${subText}`}>Один экземпляр и одна база на всех, кому открыт файл: участникам, отделу или организации.</span></span></label>
        <label className={`flex items-start gap-2.5 ${rowText}`}><input type="radio" name="collaborative" checked={!collaborative} onChange={() => setCollaborative(false)} className="mt-1 accent-[var(--color-kumo-brand)]" />
          <span>У каждого свои<span className={`block ${subText}`}>Каждый, кто откроет файл, работает со своей пустой базой.</span></span></label>
      </fieldset>
      <label className={`flex items-start gap-2.5 ${rowText}`}><input type="checkbox" checked={directory} onChange={event => setDirectory(event.target.checked)} className="mt-1 accent-[var(--color-kumo-brand)]" />
        <span>Выбор людей и отделов<span className={`block ${subText}`}>Приложение видит список людей и отделов организации с правами открывшего.</span></span></label>
      <label className={`flex flex-col gap-1.5 ${rowText}`}>Описание
        <textarea value={description} maxLength={2000} rows={3} onChange={event => setDescription(event.target.value)} placeholder="Что делает приложение"
          className="rounded-lg border border-kumo-line bg-kumo-base px-2 py-1.5 text-[16px] sm:text-[14px]" />
      </label>
      {loadError && <p role="alert" className={`m-0 ${rowText} text-kumo-danger`}>{loadError}</p>}
      {handle.error && <p role="alert" className={`m-0 ${rowText} text-kumo-danger`}>{handle.error}</p>}
      <div className={ACTIONS}>
        <button type="submit" className={primaryButton} disabled={!chosen || !!blocked || handle.busy}>{handle.busy ? 'Сохраняю…' : 'Сохранить в проект'}</button>
        <button type="button" className={pillButton} onClick={onClose}>Отмена</button>
      </div>
    </form>
  </aside>
}

// Экрану сохранения нужен тот же сеанс, что и шапке; берётся из контекста оболочки.
function useApi(): Api { return useAuthenticatedApi().authenticatedApi as unknown as Api }

/** Экран вместо приложения, когда общий экземпляр недоступен. */
export function MnemosAppUnavailable({ height, reason }: { height: string; reason: string }) {
  return <div className="flex items-center justify-center px-6 text-center" style={{ height }}>
    <div className="max-w-[380px]">
      <p className="m-0 text-[15px] leading-[22px] font-semibold text-kumo-default">Приложение не открылось</p>
      <p className="mt-1.5 mb-0 text-[13px] leading-[19px] text-kumo-subtle">{reason.charAt(0).toUpperCase() + reason.slice(1)}</p>
    </div>
  </div>
}
