// Приложение как файл проекта Mnemos (ADR 0028 Mnemos, этапы 1–3): шапка гаджета рабочего места.
//
// Открывается так же, как документ: шапка показывает состояние, «Поделиться» и «Версии», экран — экземпляр
// узла. Совместное приложение (collaborative) работает одним общим экземпляром на узел, остальные — своим.
//
// Код узла платформа не выдаёт никому, даже человеку с правом правки (ADR 0028, п. 4): в браузер и в
// рабочее место он не попадает, версию запускает и читает сама оболочка. Править приложение можно только
// через агента кода в беседе; «Вернуть версию» делает Mnemos, текст версии при этом через браузер не идёт.
//
// Приложение без совместной работы (этап 3): получатель без права правки открывает не оригинал, а свою
// копию — узел в своём проекте с опубликованной версией автора и своей пустой базой. Когда автор
// публикует новую версию, шапка копии предлагает обновиться; обновление ставится только по согласию.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaretLeft } from '@phosphor-icons/react'
import { Dialog } from '@cloudflare/kumo'
import { WorkshopButton } from './components/WorkshopControls'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi, GadgetClient } from '@gadgets/workshop-shared/api'
import type { GatekeeperNativeDocumentSelector, GatekeeperNativeDocumentWriteSelector, GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import {
  GADGET_APP_FORMAT, gadgetAppText, parseGadgetAppText,
  type GadgetAppPermission, type MnemosAppBinding, type MnemosAppConnection, type MnemosAppCopyState, type MnemosAppInfo,
  type MnemosAppOffer, type MnemosAppRelease, type MnemosAppState,
} from '@gadgets/workshop-shared/gadget-app'
import { DocumentStatusView, DOCUMENT_SHARE_EVENT, DOCUMENT_VERSIONS_EVENT, formatAgo, type DocumentStatusModel, type PrimaryKind } from './DocumentStatus'
import DocumentSharePanel from './DocumentSharePanel'
import { PANEL_CLASS, PANEL_HEADER_CLASS, pillButton, primaryButton } from './DocumentVersionPanel'
import { listAccounts, openNativeWritesFrame, storesDocuments } from './accountCapabilities'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { uploadGatekeeperAppText } from './gatekeeperAppUpload'
import { clearMnemosAppLaunch, readMnemosAppLaunch, MNEMOS_APP_LAUNCH_EVENT } from './mnemosAppLaunch'
import { useAuthenticatedApi } from './AuthContext'

type Writes = RpcStub<GatekeeperNativeDocumentWriteSelector>
type Downloads = RpcStub<GatekeeperNativeDocumentSelector>
type Api = Pick<RpcStub<AuthenticatedApi>, 'subscribeConnectedAccounts' | 'getGatekeeperApp' | 'openMnemosApp' | 'openMnemosAppPreview'>
type Gadget = Pick<RpcStub<GadgetClient>, 'getId' | 'getMnemosApp' | 'setMnemosApp' | 'exportAppModules'>
type Source = { accountId: number; writes: Writes; downloads: Downloads; origin: string; frame: GatekeeperUiFrame }
type Connection = RpcStub<MnemosAppConnection>
/** serial — номер связи: экран приложения пересоздаётся с каждой новой связью, старую он не трогает. */
type Live = { connection: Connection; info: MnemosAppInfo; serial: number }
/** Право на узел: владелец личной версии, правка по приглашению или проекту, только просмотр. */
export type AppAccess = 'owner' | 'edit' | 'read'
export type AppVersion = { id: string; recordedAt: string; author: string; personal: boolean }

/** Как часто шапка сверяет код рабочего места и работающую версию общего экземпляра. */
export const APP_POLL_MS = 10_000

/** Опубликованная версия узла (не личная): только она работает в общем экземпляре. */
export const isPublishedVersion = (version?: string | null) => !!version && !version.startsWith('private:')

/** Причина вместо экрана приложения, пока получатель не создал свою копию. */
export const APP_COPY_OFFER = 'copy-offer'
/** Событие окна: открыть панель «Своя копия». */
export const APP_COPY_EVENT = 'mnemos-app-copy'

/** Подпись версии автора: «версия от 29 сентября, 14:05». */
export function releaseLabel(release: Pick<MnemosAppRelease, 'publishedAt'>): string {
  const at = Date.parse(release.publishedAt)
  if (!Number.isFinite(at)) return 'новая версия'
  return `версия от ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(at)}`
}
const authorOf = (name: string) => name.trim() || 'автора'

/** Три факта шапки и одно главное действие для приложения; порядок — от блокирующего к обычному. */
export function deriveAppStatus(input: {
  access: AppAccess | null; collaborative: boolean; savedVersion?: string
  liveVersion?: string | null; liveError?: string; savedAt?: string | null; now?: number
  /** Получатель открыл чужое приложение без совместной работы: ready — у автора есть опубликованная версия. */
  offer?: { ready: boolean } | null
  /** Это своя копия чужого приложения. */
  copy?: Pick<MnemosAppCopyState, 'author' | 'origin' | 'update' | 'dismissed'> | null
  /** Личная версия совместного приложения у того, кто правит: active — экран предпросмотра, published — есть опубликованная. */
  preview?: { active: boolean; published: boolean } | null
}): DocumentStatusModel {
  const { access, collaborative, savedVersion, liveVersion, liveError, savedAt, offer, copy, preview, now = Date.now() } = input
  const version = copy ? `Копия приложения ${authorOf(copy.author)}` : collaborative ? 'Общее приложение' : 'Приложение'
  const audience = copy ? (copy.origin === 'closed' ? 'автор закрыл доступ к оригиналу, обновлений не будет' : 'данные только ваши')
    : access === 'read' ? 'только просмотр' : collaborative ? 'одна база на всех, кому открыт файл' : 'данные у каждого свои'
  const editor = access === 'owner' || access === 'edit'
  if (access === null) return { kind: 'unread', version, audience, saved: 'права на файл не прочитаны', tone: 'warning', primary: null, secondary: null }
  if (offer) {
    return offer.ready
      ? { kind: 'readonly', version, audience: 'у вас будет своя копия с пустыми данными', saved: 'откройте свою копию', tone: 'info',
          primary: { kind: 'copy', label: 'Создать копию', hint: 'То же приложение, своя пустая база, файл в вашем проекте. Код приложения вам не показывается, данные автора не видны.' }, secondary: null }
      : { kind: 'readonly', version, audience: 'у вас будет своя копия с пустыми данными', saved: 'автор ещё не опубликовал приложение', tone: 'warning', primary: null, secondary: null }
  }
  if (liveError && !(collaborative && editor && !isPublishedVersion(savedVersion))) return { kind: 'unread', version, audience, saved: liveError, tone: 'danger', primary: null, secondary: null }
  const when = savedAt ? `сохранено ${formatAgo(savedAt, now)}` : 'сохранено'
  if (copy?.update && !copy.dismissed && access === 'owner') {
    return { kind: 'changed', version, audience, saved: `доступно обновление от ${authorOf(copy.author)}: ${releaseLabel(copy.update)}`, tone: 'info',
      primary: { kind: 'update', label: 'Обновить', hint: 'Код копии заменится опубликованной версией автора. Данные приложения сохранятся, прежний код останется в «Версиях».' },
      secondary: { kind: 'dismiss', label: 'Не сейчас' } }
  }
  if (preview && collaborative && editor && !isPublishedVersion(savedVersion)) {
    const publish = access === 'owner' ? { kind: 'submit' as const, label: 'Опубликовать', hint: 'У всех заработает эта версия; данные общего экземпляра сохранятся.' } : null
    return preview.active
      ? { kind: 'saved', version, audience: 'своя пустая база', saved: 'Предпросмотр личной версии — данные не сохраняются для других', tone: 'info',
          primary: publish, secondary: preview.published ? { kind: 'published', label: 'Показать опубликованную' } : null }
      : { kind: 'saved', version, audience, saved: 'показана опубликованная версия · ваша личная версия не опубликована', tone: 'neutral',
          primary: publish, secondary: { kind: 'preview', label: 'Предпросмотр личной версии' } }
  }
  const status = appVersionStatus({ access, collaborative, editor, savedVersion, liveVersion, version, audience, when })
  // Своя копия с открытым оригиналом: её можно «сделать своей» — дальше её правит агент кода.
  if (copy && access === 'owner' && copy.origin === 'open' && !status.secondary) return { ...status, secondary: { kind: 'own', label: 'Сделать своей' } }
  return status
}

function appVersionStatus({ access, collaborative, editor, savedVersion, liveVersion, version, audience, when }: {
  access: AppAccess; collaborative: boolean; editor: boolean; savedVersion?: string; liveVersion?: string | null; version: string; audience: string; when: string
}): DocumentStatusModel {
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
 * previewChatId — беседа с предложенными правками гаджета беседы; у гаджета-узла кода в рабочем месте нет,
 * и предпросмотра у него не бывает.
 */
export function useMnemosApp({ api, gadget, previewChatId, pollMs = APP_POLL_MS }: { api: Api; gadget: Gadget | null; previewChatId?: number; pollMs?: number }) {
  const [app, setApp] = useState<MnemosAppState | null>(null)
  const [access, setAccess] = useState<AppAccess | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [liveError, setLiveError] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [versions, setVersions] = useState<AppVersion[] | null>(null)
  /** Оригинал без совместной работы: версия для копий и уже сделанная копия. */
  const [offer, setOffer] = useState<MnemosAppOffer | null>(null)
  /** Своя копия чужого приложения: автор, доступ к оригиналу, обновление. */
  const [copy, setCopy] = useState<MnemosAppCopyState | null>(null)
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

  // Привязка гаджета рабочего места к узлу: читается сразу и опросом (её меняют и другие вкладки).
  useEffect(() => {
    setApp(null); setAccess(null); setLive(null); setLiveError(''); setError(''); setNotice(''); setVersions(null); setOffer(null); setCopy(null)
    if (!gadget) return
    let stopped = false
    void reload().catch(() => {})
    const timer = pollMs > 0 ? setInterval(() => { if (!stopped && document.visibilityState !== 'hidden') void reload().catch(() => {}) }, pollMs) : undefined
    return () => { stopped = true; clearInterval(timer) }
  }, [gadget, reload, pollMs])

  // Право прежнего узла к новому не относится.
  useEffect(() => { setAccess(null) }, [identity])
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
        const known = await readVersions(opened, binding.scope, binding.resource).catch(() => [])
        if (!cancelled) setPublished(known.some(v => !v.personal))
      } catch (caught) { if (!cancelled) setError(errorText(caught, 'Права на файл приложения не прочитаны. Проверьте подключение Mnemos.')) }
    })()
    return () => { cancelled = true; if (source.current === opened) source.current = null; if (opened) disposeGatekeeperFrame(opened.frame) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перечитывается при смене узла
  }, [api, identity, tick])

  // Экземпляр приложения: общий у совместного, свой у остальных; связь и работающая версия, опрос смены версии.
  const collaborative = !!binding?.collaborative
  /** Есть ли у узла опубликованная версия (для переключателя предпросмотр ↔ опубликованная). */
  const [published, setPublished] = useState(false)
  const [showPublished, setShowPublished] = useState(false)
  useEffect(() => { setShowPublished(false) }, [identity, binding?.savedVersion])
  // Предпросмотр: у того, кто правит, открыта личная версия совместного приложения — она идёт в отдельный
  // экземпляр со своей базой (ADR 0028 п. 2), общий экземпляр не трогается.
  const previewMode = collaborative && (access === 'owner' || access === 'edit') && !isPublishedVersion(binding?.savedVersion) && !showPublished
  // Пока право не прочитано, неизвестно, какой экземпляр открывать: общий или предпросмотр. Связь,
  // открытая наугад, закрывалась бы при переключении, пока экран приложения к ней подключается.
  const waitAccess = collaborative && !isPublishedVersion(binding?.savedVersion) && access === null
  const connections = useRef(0)
  useEffect(() => {
    if (!identity || !binding) { setLive(null); setLiveError(''); setOffer(null); setCopy(null); return }
    if (waitAccess) { setLive(null); return }
    let cancelled = false, connection: Connection | null = null
    let timer: ReturnType<typeof setInterval> | undefined
    void (async () => {
      try {
        connection = (previewMode
          ? await api.openMnemosAppPreview(binding.accountId, binding.scope, binding.resource)
          : await api.openMnemosApp(binding.accountId, binding.scope, binding.resource, !binding.collaborative)) as unknown as Connection
        let info = await connection.describe()
        if (previewMode && binding.savedVersion && info.deployed?.version !== binding.savedVersion) info = await connection.deploy(binding.savedVersion)
        if (cancelled) { dispose(connection); return }
        const serial = ++connections.current
        setLive({ connection, info, serial }); setLiveError(info.deployed ? '' : binding.collaborative ? 'приложение ещё не опубликовано' : 'приложение ещё не запущено')
        if (!binding.collaborative) {
          // Копии: версия для копий (у автора — для «Поделиться») и состояние своей копии.
          const [nextOffer, nextCopy] = await Promise.all([connection.offer().catch(() => null), connection.copyState().catch(() => null)])
          if (!cancelled) { setOffer(nextOffer); setCopy(nextCopy) }
        } else { setOffer(null); setCopy(null) }
        if (pollMs > 0) timer = setInterval(() => {
          if (document.visibilityState === 'hidden' || !connection) return
          void connection.describe().then(next => { if (!cancelled) setLive(old => !old || old.serial !== serial || old.info.deployed?.sha256 === next.deployed?.sha256 ? old : { connection: connection!, info: next, serial }) },
            caught => { if (!cancelled) setLiveError(errorText(caught, 'связь с приложением закрыта')) })
        }, pollMs * 3)
      } catch (caught) {
        if (!cancelled) { setLive(null); setLiveError(errorText(caught, 'приложение недоступно')) }
      }
    })()
    // Экран приложения снимается раньше, чем закрывается его связь: иначе он обратится к закрытой связи.
    return () => { cancelled = true; clearInterval(timer); setLive(null); dispose(connection) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перечитывается при смене узла
  }, [api, identity, collaborative, previewMode, waitAccess, previewMode ? binding?.savedVersion : '', tick])

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (busy) return
    const signal = lifetime.current.signal
    setBusy(true); setError(''); setNotice('')
    try { await action(signal) }
    catch (caught) { if (!signal.aborted) setError(errorText(caught, 'Действие не выполнено: Mnemos не ответил. Повторите попытку.')) }
    finally { if (!signal.aborted) setBusy(false) }
  }

  /**
   * Открыть версию узла. Код не скачивается и в рабочее место не кладётся ни при каком праве: манифест и
   * запуск читает сама оболочка, страница получает только экран экземпляра (ADR 0028, п. 4).
   */
  async function openVersion(accountId: number, scope: string, resource: string, publication: string, signal: AbortSignal) {
    if (!gadget) return
    const opened = source.current?.accountId === accountId ? source.current : await openSource(api, accountId)
    try {
      const rights = await readAccess(opened, scope, resource); signal.throwIfAborted()
      const editor = rights !== 'read'
      let manifest
      {
        using connection = await api.openMnemosApp(accountId, scope, resource, false) as unknown as Connection
        manifest = await connection.manifest(publication)
      }
      signal.throwIfAborted()
      if (!editor) {
        const read = manifest
        if (!read.collaborative) {
          // Чужое приложение без совместной работы: своя копия вместо оригинала.
          await gadget.setMnemosApp({ accountId, scope, resource, description: read.description, collaborative: false, session: read.session, permissions: read.permissions, savedVersion: publication })
          using own = await api.openMnemosApp(accountId, scope, resource, true) as unknown as Connection
          const found = await own.offer()
          setOffer(found)
          if (found.copy) {
            try { await openCopy(accountId, found.copy, signal); setNotice('Открыта ваша копия приложения.'); return }
            catch { signal.throwIfAborted(); setError('Прежняя копия не открылась: возможно, её удалили. Создайте новую.') }
          }
          await reload(); setTick(t => t + 1)
          return
        }
      }
      const next: MnemosAppBinding = {
        accountId, scope, resource, description: manifest.description, collaborative: manifest.collaborative, session: manifest.session,
        permissions: manifest.permissions, savedVersion: publication,
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

  /** Открыть свою копию: последняя версия узла копии встаёт в это рабочее место. */
  async function openCopy(accountId: number, target: { scope: string; resource: string }, signal: AbortSignal) {
    const opened = source.current?.accountId === accountId ? source.current : await openSource(api, accountId)
    try {
      const latest = (await readVersions(opened, target.scope, target.resource))[0]
      if (!latest) throw new Error('Копия приложения не найдена.')
      await openVersion(accountId, target.scope, target.resource, latest.id, signal)
    } finally { if (opened !== source.current) disposeGatekeeperFrame(opened.frame) }
  }

  // Открытие из Mnemos: заявка страницы выполняется один раз для своего гаджета. Проверка идёт по каждому
  // выбранному гаджету: из беседы заявка пишется, пока в панели открыт другой гаджет.
  const [launchTick, setLaunchTick] = useState(0)
  const launched = useRef<string | null>(null)
  useEffect(() => {
    const changed = () => setLaunchTick(value => value + 1)
    window.addEventListener(MNEMOS_APP_LAUNCH_EVENT, changed)
    return () => window.removeEventListener(MNEMOS_APP_LAUNCH_EVENT, changed)
  }, [])
  useEffect(() => {
    if (!gadget || !app) return
    const launch = readMnemosAppLaunch()
    if (!launch) return
    const key = JSON.stringify(launch)
    if (launched.current === key) return
    let cancelled = false
    void gadget.getId().then(id => {
      if (cancelled || id !== launch.gadgetId || launched.current === key) return
      launched.current = key
      clearMnemosAppLaunch()
      return run(signal => openVersion(launch.accountId, launch.scope, launch.resource, launch.publication, signal))
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- заявка выполняется при выборе гаджета или новом нажатии «Открыть»
  }, [gadget, app, launchTick])

  /** Текст файла из кода гаджета беседы: только для «Сохранить в проект». Гаджет-узел кода в рабочем месте
   *  не держит, и оболочка выгрузку ему не отдаёт. */
  async function chatGadgetText(choice: { collaborative: boolean; description: string; permissions: GadgetAppPermission[] }) {
    if (!gadget) throw new Error('Гаджет не выбран.')
    const exported = await gadget.exportAppModules()
    const collaborative = choice.collaborative
    // Признак session — из кода: сервер объявил метод session(caller). Общим данным он обязателен.
    const session = /\bsession\s*\(/.test(exported.modules['server.js'])
    if (collaborative && !session) throw new Error('Для общих данных в server.js нужен метод session(caller): по нему приложение знает, кто вызывает.')
    const manifest = { title: exported.title.trim().slice(0, 120) || 'Приложение', description: choice.description,
      collaborative, session, formatVersion: 1 as const, permissions: choice.permissions }
    return { text: gadgetAppText({ manifest, modules: exported.modules }), session }
  }

  /** Запуск версии: код читает сама оболочка. Общий экземпляр — только опубликованные версии. */
  async function deploy(current: MnemosAppBinding, version: string) {
    using connection = await api.openMnemosApp(current.accountId, current.scope, current.resource, !current.collaborative) as unknown as RpcStub<MnemosAppConnection>
    await connection.deploy(version)
  }

  /** «Сохранить в проект»: гаджет беседы становится новым файлом приложения в проекте. */
  const saveToProject = (choice: { accountId: number; scope: string; collaborative: boolean; description: string; permissions: GadgetAppPermission[] }) => run(async signal => {
    if (!gadget) return
    const way = await openSource(api, choice.accountId)
    try {
      const { text, session } = await chatGadgetText(choice)
      const name = parseGadgetAppText(text).document.manifest.title
      using creator = await way.writes.create(choice.scope, name, GADGET_APP_FORMAT)
      const head = await creator.head(); signal.throwIfAborted()
      const upload = await uploadGatekeeperAppText(text, way.origin, (size, checksum) => creator.issue(head, size, checksum), signal)
      const saved = await creator.save(head, upload)
      const resource = await creator.document()
      const next: MnemosAppBinding = { accountId: way.accountId, scope: choice.scope, resource, description: choice.description, collaborative: choice.collaborative, session,
        permissions: choice.permissions, ...(/^[a-f0-9]{64}$/.test(saved) ? { savedHead: saved, savedVersion: `private:${saved}` } : {}) }
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

  /** «Создать копию»: свой узел в выбранном проекте, код — опубликованная версия автора, база пустая. */
  const makeCopy = (scope: string, again: boolean) => run(async signal => {
    const current = binding
    if (!current || current.collaborative) return
    let target: { scope: string; resource: string }
    {
      using connection = await api.openMnemosApp(current.accountId, current.scope, current.resource, true) as unknown as Connection
      target = await connection.makeCopy(scope, again)
    }
    signal.throwIfAborted()
    setOffer(null)
    await openCopy(current.accountId, target, signal)
    setNotice('Копия создана в вашем проекте. Данные в ней видите только вы.')
  })

  /** «Обновить»: опубликованная версия автора становится новой версией копии; база та же. */
  const applyUpdate = () => run(async signal => {
    const current = binding, update = copy?.update
    if (!current || !update) return
    let version: string
    {
      using connection = await api.openMnemosApp(current.accountId, current.scope, current.resource, true) as unknown as Connection
      version = (await connection.applyUpdate(update.version)).version
    }
    signal.throwIfAborted()
    setCopy(old => old && { ...old, update: null, dismissed: false })
    await openVersion(current.accountId, current.scope, current.resource, version, signal)
    setNotice('Приложение обновлено. Данные сохранены.')
  })

  /** «Не сейчас»: обновление не предлагается в шапке, пока автор не опубликует следующее. */
  const dismissUpdate = () => run(async () => {
    const current = binding, update = copy?.update
    if (!current || !update) return
    using connection = await api.openMnemosApp(current.accountId, current.scope, current.resource, true) as unknown as Connection
    await connection.dismissUpdate(update.version)
    setCopy(old => old && { ...old, dismissed: true })
    setNotice('Обновление можно поставить позже в «Версиях».')
  })

  /** «Сделать своей»: исходники версии автора переносятся к копии, связь с оригиналом снимается.
   *  Возвращает текст отказа (для окна подтверждения) или null при успехе. */
  const makeOwn = async (): Promise<string | null> => {
    const current = binding
    if (!current || !copy || busy) return 'Копия приложения не выбрана.'
    const signal = lifetime.current.signal
    setBusy(true); setError(''); setNotice('')
    try {
      {
        using connection = await api.openMnemosApp(current.accountId, current.scope, current.resource, true) as unknown as Connection
        await connection.makeOwn()
      }
      if (signal.aborted) return null
      setCopy(null)
      setNotice('Гаджет теперь ваш: меняйте его через агента кода в беседе. Обновления от автора больше не придут.')
      setTick(t => t + 1)
      return null
    } catch (caught) {
      return errorText(caught, 'Не получилось сделать копию своей: Mnemos или служба исходников не ответили. Повторите позже.')
    } finally { if (!signal.aborted) setBusy(false) }
  }

  const loadVersions = () => run(async () => {
    const way = source.current
    if (!binding || !way) return
    setVersions(await readVersions(way, binding.scope, binding.resource))
  })

  /**
   * «Вернуть версию»: Mnemos сам делает выбранную версию новой личной версией узла (как у документа),
   * текст версии через браузер не идёт. Своё приложение сразу запускает её в своём экземпляре.
   */
  const restoreVersion = (version: AppVersion) => run(async signal => {
    const current = binding, way = source.current
    if (!current || !way || !gadget) return
    const state = await way.writes.restorationState(current.scope, current.resource, GADGET_APP_FORMAT); signal.throwIfAborted()
    if (state.deleted) throw new Error('Файл приложения удалён из проекта: вернуть версию нельзя.')
    let head: string
    try { head = (await way.writes.restorePublication(current.scope, current.resource, version.id, state.head, GADGET_APP_FORMAT)).head }
    catch (caught) { throw new Error(errorText(caught, 'Версия не вернулась: файл изменили или прав на правку нет. Откройте «Версии» заново и повторите.')) }
    signal.throwIfAborted()
    const { savedCodeVersion: _code, ...rest } = current
    const next: MnemosAppBinding = { ...rest, savedHead: head, savedVersion: `private:${head}` }
    await gadget.setMnemosApp(next)
    if (!current.collaborative) await deploy(next, next.savedVersion!)
    setNotice(current.collaborative ? 'Версия возвращена личной версией файла. У всех она заработает после публикации.' : 'Версия возвращена и уже работает.')
    setVersions(await readVersions(way, current.scope, current.resource))
    await reload(); setTick(t => t + 1)
  })

  /** Предпросмотр беседы — только у гаджета беседы: у гаджета-узла кода в рабочем месте нет. */
  const preview = previewChatId !== undefined && !binding
  /** Рабочее место показывается только гаджету беседы; гаджет-узел — всегда экраном экземпляра узла. */
  const showWorkspace = !binding
  /** Получатель открыл чужое приложение без совместной работы: вместо экрана — предложение своей копии. */
  const offerMode = !!binding && !binding.collaborative && access === 'read'
  const liveGadget = useMemo(() => {
    if (!live?.info.deployed || showWorkspace || offerMode) return null
    const connection = live.connection
    return { getUiBundle: () => connection.getUiBundle(), connectToGadget: () => connection.connectToGadget(), key: `${live.serial}:${live.info.deployed.sha256}` }
  }, [live, showWorkspace, offerMode])

  const model = useMemo(() => {
    if (!binding) return null
    return deriveAppStatus({ access, collaborative, savedVersion: binding.savedVersion, liveVersion: live?.info.deployed?.version ?? null,
      liveError: offerMode || previewMode ? '' : liveError, savedAt: null, offer: offerMode ? { ready: !!offer?.release } : null, copy,
      preview: collaborative ? { active: previewMode, published } : null })
  }, [binding, access, collaborative, live, liveError, offerMode, offer, copy, previewMode, published])

  return { app, binding, access, live, liveError: offerMode ? APP_COPY_OFFER : liveError, liveGadget, showWorkspace, preview, model, busy, error, notice, versions,
    offer, copy, offerMode, makeCopy, applyUpdate, dismissUpdate, makeOwn, previewMode, setShowPublished,
    saveToProject, publish, start, loadVersions, restoreVersion, writes: () => source.current?.writes ?? null, refresh: () => setTick(t => t + 1) }
}

type PanelSection = 'share' | 'versions' | 'save' | 'copy'

/** Шапка приложения: строка состояния, главное действие, «Версии» и «Поделиться» (события шапки гаджета). */
export default function MnemosAppStatus({ handle, compact, panelHost, onShareShown }: {
  handle: MnemosAppHandle; compact?: boolean; panelHost?: Element | null; onShareShown?(shown: boolean): void
}) {
  const [panel, setPanel] = useState<PanelSection | null>(null)
  useEffect(() => {
    const share = () => setPanel('share')
    const versions = () => setPanel(old => old === 'versions' ? null : 'versions')
    const copy = () => setPanel('copy')
    window.addEventListener(DOCUMENT_SHARE_EVENT, share)
    window.addEventListener(DOCUMENT_VERSIONS_EVENT, versions)
    window.addEventListener(APP_COPY_EVENT, copy)
    return () => { window.removeEventListener(DOCUMENT_SHARE_EVENT, share); window.removeEventListener(DOCUMENT_VERSIONS_EVENT, versions); window.removeEventListener(APP_COPY_EVENT, copy) }
  }, [])
  // Получатель открыл чужое приложение без общих данных: сразу предлагается своя копия.
  const offered = useRef(false)
  useEffect(() => {
    if (handle.offerMode && handle.offer && !offered.current) { offered.current = true; setPanel(old => old ?? 'copy') }
    if (!handle.offerMode) { offered.current = false; setPanel(old => old === 'copy' ? null : old) }
  }, [handle.offerMode, handle.offer])
  useEffect(() => { if (panel === 'versions') handle.loadVersions() }, [panel, handle.binding?.resource])
  const onPrimary = (kind: PrimaryKind) => {
    if (kind === 'submit') void handle.publish()
    else if (kind === 'start') void handle.start()
    else if (kind === 'copy') setPanel('copy')
    else if (kind === 'update') void handle.applyUpdate()
  }
  const [owning, setOwning] = useState(false)
  const onSecondary = () => {
    if (handle.model?.secondary?.kind === 'dismiss') void handle.dismissUpdate()
    else if (handle.model?.secondary?.kind === 'published') handle.setShowPublished(true)
    else if (handle.model?.secondary?.kind === 'preview') handle.setShowPublished(false)
    else if (handle.model?.secondary?.kind === 'own') setOwning(true)
  }
  // Привязанный к узлу гаджет в другой проект не сохраняется: чужое приложение не уносится копией.
  const exportable = handle.app?.notExportable === null && !handle.binding
  const node = panel === 'share'
    ? <DocumentSharePanel selector={handle.writes()} binding={handle.binding ? { accountId: handle.binding.accountId, scope: handle.binding.scope, resource: handle.binding.resource } : null}
        format={GADGET_APP_FORMAT} documentName={handle.app?.title ?? null} onClose={() => setPanel(null)}
        copies={handle.binding && !handle.binding.collaborative ? { release: handle.offer?.release ?? null } : undefined} />
    : panel === 'versions' ? <AppVersionsPanel handle={handle} onClose={() => setPanel(null)} />
    : panel === 'copy' ? <CopyAppPanel handle={handle} onClose={() => setPanel(null)} />
    : panel === 'save' ? <SaveAppPanel handle={handle} onClose={() => setPanel(null)} />
    : null
  return <>
    <DocumentStatusView model={handle.model} bound={!!handle.binding} busy={handle.busy || (!!handle.binding && !handle.model)} versionOpen={panel === 'versions'}
      error={panel ? undefined : handle.error || undefined} flash={panel ? undefined : handle.notice || undefined} compact={compact}
      onShare={compact ? () => setPanel('share') : undefined} onShareShown={onShareShown}
      onPrimary={onPrimary} onSecondary={onSecondary} onOpenVersion={() => setPanel(old => old === 'versions' ? null : 'versions')}
      onSaveToProject={exportable ? () => setPanel('save') : undefined} />
    {panelHost ? createPortal(node, panelHost) : node}
    <MakeOwnDialog handle={handle} open={owning} onOpenChange={setOwning} />
  </>
}

/** Подтверждение «Сделать своей»: после него копию правит агент кода, обновлений от автора нет. */
export function MakeOwnDialog({ handle, open, onOpenChange }: { handle: Pick<MnemosAppHandle, 'makeOwn' | 'busy' | 'copy'>; open: boolean; onOpenChange(open: boolean): void }) {
  const [failure, setFailure] = useState('')
  useEffect(() => { if (open) setFailure('') }, [open])
  const confirm = async () => {
    const refused = await handle.makeOwn()
    if (refused) setFailure(refused)
    else onOpenChange(false)
  }
  return <Dialog.Root open={open} onOpenChange={next => { if (!handle.busy) onOpenChange(next) }}>
    <Dialog className="!z-[1000] !w-[min(440px,calc(100vw-32px))] overflow-hidden bg-kumo-base p-0 !top-[20%] !-translate-y-0" size="sm">
      <div className="border-b border-kumo-line px-5 py-4">
        <Dialog.Title className="text-[15px] leading-5 font-medium tracking-[-0.3px] text-kumo-default">Сделать копию своей?</Dialog.Title>
        <Dialog.Description className="mt-1.5 text-[13px] leading-[18px] text-kumo-subtle">
          Вы сможете менять гаджет через агента кода. Обновления от автора больше не будут приходить.
        </Dialog.Description>
        {failure && <p role="alert" className="mt-3 mb-0 text-[13px] leading-[18px] text-kumo-danger">{failure}</p>}
      </div>
      <div className="flex flex-col-reverse items-stretch gap-2 bg-kumo-base px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
        <Dialog.Close render={props => <WorkshopButton {...props} className="!h-10 sm:!h-9" disabled={handle.busy}>Отмена</WorkshopButton>} />
        <WorkshopButton tone="primary" className="!h-10 sm:!h-9" disabled={handle.busy} onClick={() => { void confirm() }}>{handle.busy ? 'Переношу…' : 'Сделать своей'}</WorkshopButton>
      </div>
    </Dialog>
  </Dialog.Root>
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

/** «Версии» приложения: список версий узла; «Вернуть» делает версию новой версией файла на стороне Mnemos. */
function AppVersionsPanel({ handle, onClose }: { handle: MnemosAppHandle; onClose(): void }) {
  const rows = handle.versions ?? []
  const canEdit = handle.access === 'owner' || handle.access === 'edit'
  return <aside data-app-versions aria-label="Версии" className={PANEL_CLASS}>
    <PanelHeader title="Версии" subtitle={handle.app?.title} onClose={onClose} />
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:px-7 sm:pb-[26px]">
      {!handle.binding && <p className={`m-0 ${rowText}`}>Приложение ещё не сохранено в проект: версий нет.</p>}
      {handle.error && <p role="alert" className={`m-0 ${rowText} text-kumo-danger`}>{handle.error}</p>}
      {handle.notice && <p role="status" className={`m-0 ${rowText}`}>{handle.notice}</p>}
      {handle.copy && <CopyOriginNote handle={handle} />}
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
      {rows.length > 0 && <p className={`m-0 ${subText}`}>Ни одна версия не пропадает. «Вернуть» делает выбранную версию новой версией файла; данные приложения при этом не меняются.</p>}
      {canEdit && <p className={`m-0 ${subText}`}>Код приложения закрыт: платформа его не показывает. Изменить приложение можно через агента кода в беседе.</p>}
    </div>
  </aside>
}

/** Происхождение своей копии в «Версиях»: автор, доступ к оригиналу и обновление (здесь оно доступно и на телефоне). */
function CopyOriginNote({ handle }: { handle: MnemosAppHandle }) {
  const copy = handle.copy!
  const owner = handle.access === 'owner'
  const updated = copy.updatedAt && copy.updatedAt !== copy.copiedAt ? `, обновлена ${formatAgo(copy.updatedAt)}` : ''
  return <section data-app-copy-origin aria-label="Копия приложения" className="flex flex-col gap-2 rounded-xl border border-kumo-line px-3 py-3">
    <h3 className={`m-0 ${rowText} font-medium`}>Копия приложения {authorOf(copy.author)}</h3>
    <p className={`m-0 ${subText}`}>Сделана {formatAgo(copy.copiedAt)}{updated}. Данные в копии видите только вы; данные автора вам не видны.</p>
    {copy.origin === 'closed' && <p className={`m-0 ${subText}`}>Автор закрыл вам доступ к оригиналу. Копия остаётся вашей вместе с данными, но обновления от автора больше не придут.</p>}
    {copy.origin === 'unknown' && <p className={`m-0 ${subText}`}>Доступ к оригиналу сейчас не проверить. Копия работает как обычно; обновления проверятся при следующем открытии.</p>}
    {copy.origin === 'open' && !copy.update && <p className={`m-0 ${subText}`}>У вас последняя опубликованная версия автора.</p>}
    {copy.origin === 'open' && owner && <OwnCopyAction handle={handle} />}
    {copy.update && <>
      <p className={`m-0 ${rowText}`}>Доступно обновление от {authorOf(copy.author)}: {releaseLabel(copy.update)}.</p>
      <p className={`m-0 ${subText}`}>Код копии заменится версией автора, данные сохранятся. Прежний код останется в списке версий ниже.</p>
      {owner && <div className={ACTIONS}>
        <button type="button" className={primaryButton} disabled={handle.busy} onClick={() => { void handle.applyUpdate() }}>{handle.busy ? 'Обновляю…' : 'Обновить'}</button>
        {!copy.dismissed && <button type="button" className={pillButton} disabled={handle.busy} onClick={() => { void handle.dismissUpdate() }}>Не сейчас</button>}
      </div>}
    </>}
  </section>
}

/** «Сделать своей» в «Версиях»: на телефоне второй кнопки в шапке нет. */
function OwnCopyAction({ handle }: { handle: MnemosAppHandle }) {
  const [open, setOpen] = useState(false)
  return <div className="flex flex-col gap-2 pt-1">
    <p className={`m-0 ${subText}`}>Хотите менять гаджет сами? Сделайте копию своей: правки — через агента кода, обновления от автора больше не придут.</p>
    <div className={ACTIONS}><button type="button" className={pillButton} disabled={handle.busy} onClick={() => setOpen(true)}>Сделать своей</button></div>
    <MakeOwnDialog handle={handle} open={open} onOpenChange={setOpen} />
  </div>
}

/** Последний проект, куда человек клал копию: удобство одного браузера. */
const COPY_PROJECT_KEY = 'mnemos-app-copy-project'

/** «Своя копия»: получатель выбирает проект, оболочка создаёт узел-копию с пустой базой. */
function CopyAppPanel({ handle, onClose }: { handle: MnemosAppHandle; onClose(): void }) {
  const [scopes, setScopes] = useState<{ id: string; name: string }[] | null>(null)
  const [scope, setScope] = useState(''), [loadError, setLoadError] = useState('')
  const api = useApi()
  const accountId = handle.binding?.accountId
  useEffect(() => {
    let cancelled = false, opened: Source | null = null
    void openSource(api, accountId).then(async way => {
      opened = way
      const page = await way.writes.scopes()
      if (cancelled) return
      const list = page.scopes.map(s => ({ id: s.id, name: s.name }))
      let remembered = ''
      try { remembered = localStorage.getItem(COPY_PROJECT_KEY) ?? '' } catch { /* без памяти браузера проект выбирается заново */ }
      setScopes(list)
      setScope(old => old || (list.some(s => s.id === remembered) ? remembered : list.length === 1 ? list[0]!.id : ''))
    }).catch(() => { if (!cancelled) setLoadError('Проекты не прочитаны. Проверьте подключение Mnemos.') }).finally(() => { if (opened) disposeGatekeeperFrame(opened.frame) })
    return () => { cancelled = true }
  }, [api, accountId])
  const release = handle.offer?.release ?? null
  const again = !!handle.offer?.copy
  return <aside data-app-copy aria-label="Своя копия" className={PANEL_CLASS}>
    <PanelHeader title="Своя копия" subtitle={release?.title ?? handle.app?.title} onClose={onClose} />
    <form className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:px-7 sm:pb-[26px]" onSubmit={event => {
      event.preventDefault()
      if (!scope || !release) return
      try { localStorage.setItem(COPY_PROJECT_KEY, scope) } catch { /* необязательно */ }
      // Панель закроется сама, когда копия откроется в этом рабочем месте.
      void handle.makeCopy(scope, again)
    }}>
      <p className={`m-0 ${rowText}`}>С вами поделились приложением без общих данных. У вас будет своя копия: то же приложение и своя пустая база, файл в вашем проекте. Код приложения вам не показывается.</p>
      {release && <p className={`m-0 ${subText}`}>{release.authorName ? `Автор: ${release.authorName}, ` : 'Опубликована '}{release.authorName ? releaseLabel(release) : releaseLabel(release).replace(/^версия /, '')}</p>}
      <div className="flex flex-col gap-1.5">
        <p className={`m-0 ${subText}`}>Данные автора и других получателей вам не видны, а ваши — им.</p>
        <p className={`m-0 ${subText}`}>Когда автор опубликует новую версию, в шапке копии появится «Обновить». Без вашего согласия копия не меняется, данные при обновлении сохраняются.</p>
        <p className={`m-0 ${subText}`}>Если автор закроет доступ, копия останется у вас, но обновления приходить перестанут.</p>
      </div>
      {!release && <p role="status" className={`m-0 ${rowText} text-kumo-warning`}>Автор ещё не опубликовал приложение. Копию можно будет создать после публикации.</p>}
      <label className={`flex flex-col gap-1.5 ${rowText}`}>Проект для копии
        <select aria-label="Проект для копии" value={scope} onChange={event => setScope(event.target.value)} disabled={!scopes}
          className="h-10 rounded-lg border border-kumo-line bg-kumo-base px-2 text-[16px] sm:h-9 sm:text-[14px]">
          <option value="">{scopes ? 'Выберите проект' : 'Загрузка проектов…'}</option>
          {scopes?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <p className={`m-0 ${subText}`}>Копия ляжет вашей личной версией: другие участники проекта увидят её, только если вы её опубликуете.</p>
      {loadError && <p role="alert" className={`m-0 ${rowText} text-kumo-danger`}>{loadError}</p>}
      {handle.error && <p role="alert" className={`m-0 ${rowText} text-kumo-danger`}>{handle.error}</p>}
      <div className={ACTIONS}>
        <button type="submit" className={primaryButton} disabled={!scope || !release || handle.busy}>{handle.busy ? 'Создаю копию…' : 'Создать копию'}</button>
        <button type="button" className={pillButton} onClick={onClose}>Не сейчас</button>
      </div>
    </form>
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
  if (reason === APP_COPY_OFFER) return <div data-app-copy-offer className="flex items-center justify-center px-6 text-center" style={{ height }}>
    <div className="flex max-w-[380px] flex-col items-center gap-3">
      <p className="m-0 text-[15px] leading-[22px] font-semibold text-kumo-default">Приложение откроется вашей копией</p>
      <p className="m-0 text-[13px] leading-[19px] text-kumo-subtle">То же приложение, своя пустая база. Данные автора вам не видны, ваши — ему.</p>
      <button type="button" className={primaryButton} onClick={() => window.dispatchEvent(new CustomEvent(APP_COPY_EVENT))}>Создать копию…</button>
    </div>
  </div>
  return <div className="flex items-center justify-center px-6 text-center" style={{ height }}>
    <div className="max-w-[380px]">
      <p className="m-0 text-[15px] leading-[22px] font-semibold text-kumo-default">Приложение не открылось</p>
      <p className="mt-1.5 mb-0 text-[13px] leading-[19px] text-kumo-subtle">{reason.charAt(0).toUpperCase() + reason.slice(1)}</p>
    </div>
  </div>
}
