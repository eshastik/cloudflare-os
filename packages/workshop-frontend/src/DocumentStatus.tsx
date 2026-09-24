import { readNativeDocumentLaunch, clearNativeDocumentLaunch, type NativeDocumentLaunch } from './nativeDocumentLaunch'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClockCounterClockwise } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import type { GadgetClient } from '@gadgets/workshop-shared/api'
import type { GatekeeperNativeDocumentSelector, GatekeeperNativeDocumentWriteSelector, GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import { cleanNativeTitle, nativeTitleSource, type NativeDocumentFormat, type NativeMnemosBinding, type NativeMnemosState } from '@gadgets/workshop-shared/native-document'
import type { PublicationReview } from '@gadgets/workshop-shared/publication-review'
import { useAuthenticatedApi } from './AuthContext'
import { WorkshopButton } from './components/WorkshopControls'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { listAccounts, storesDocuments, openNativeWritesFrame } from './accountCapabilities'
import DocumentVersionPanel, { type PanelSection } from './DocumentVersionPanel'
import { nativeOpenKey, readPendingNativeOpen } from './NativeDocumentOpen'
import { loadPublication, publishCandidate, reviewKey, submitReview, type PublicationState } from './NativeDocumentPublication'
import type { NativeSnapshotSourceRef } from './nativeSnapshotSource'
import { NATIVE_BINDING_EVENT, createMnemosDocument, mnemosDocumentName, type NativeBindingEventDetail } from './nativeMnemosDocument'

type Selector = RpcStub<GatekeeperNativeDocumentWriteSelector>
type Downloads = RpcStub<GatekeeperNativeDocumentSelector>
type Decision = PublicationReview['domains'][number]['decisions'][number] & { comment?: string }

/** Какой документ Mnemos открыт в редакторе и с какой ревизией редактора он последний раз совпадал. */
export type DocumentBinding = NativeMnemosBinding
export type Participant = Awaited<ReturnType<Selector['participants']>>['participants'][number]
export type HistoryEntry = { id: string; label: string; recordedAt: string; actor: string; onBehalfOf?: string; personal: boolean }
/** conflict null — черновик не прочитан; participants null — приглашённые не прочитаны. */
export type StatusData = { state: PublicationState | null; review: PublicationReview | null; conflict: boolean | null; participants: Participant[] | null; history: HistoryEntry[]; sharedVersion: string; me: string }

/** Несохранённые правки редактора: число; 'no-baseline' — ревизия сохранения неизвестна; 'unread' — снимок редактора не прочитан. */
export type Changes = number | 'no-baseline' | 'unread'
export type StatusInput = {
  personalExists: boolean
  /** null — черновик не прочитан: ни select, ни selectConflict не ответили. */
  conflict: boolean | null
  /** Имена приглашённых; «только вы» показывается лишь при пустом списке; null — список не прочитан. */
  invited: string[] | null
  review: PublicationReview | null
  sharedVersion: string
  savedAt: string | null
  changes: Changes
  now?: number
}
export type DocumentStatusKind = 'unread' | 'unverified' | 'unsaved' | 'saved' | 'reviewing' | 'rejected' | 'stale' | 'conflict' | 'ready' | 'published'
export type PrimaryKind = 'save' | 'submit' | 'rework' | 'resubmit' | 'resolve' | 'publish' | 'start'
export type DocumentStatusModel = {
  kind: DocumentStatusKind
  version: string
  audience: string
  saved: string
  tone: 'neutral' | 'warning' | 'danger' | 'success' | 'info'
  primary: { kind: PrimaryKind; label: string; hint?: string } | null
  secondary: { kind: 'withdraw'; label: string } | null
}

function pluralChanges(n: number) {
  const tail = n % 10, hundred = n % 100
  const word = tail === 1 && hundred !== 11 ? 'изменение' : tail >= 2 && tail <= 4 && (hundred < 12 || hundred > 14) ? 'изменения' : 'изменений'
  return `${n} ${word}`
}

export function formatAgo(iso: string, now = Date.now()) {
  const delta = now - Date.parse(iso)
  if (!Number.isFinite(delta)) return ''
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

const domainApproved = (domain: PublicationReview['domains'][number]) => domain.approvers.every(id => domain.decisions.some(d => d.approver_id === id && d.approved))

/** Три факта шапки и одно главное действие по состоянию; порядок проверок — от блокирующего к обычному. Непрочитанный факт не подменяется значением по умолчанию: без него главного действия нет. */
export function deriveDocumentStatus(input: StatusInput): DocumentStatusModel {
  const { personalExists, conflict, invited, review, sharedVersion, savedAt, changes, now = Date.now() } = input
  const audience = !personalExists ? 'видят все участники проекта' : invited === null ? 'кто видит — не прочитано' : invited.length === 0 ? 'только вы' : invited.length === 1 ? `видят вы и ${invited[0]}` : `видят вы, ${invited.join(', ')}`
  const personal = `Личная версия от ${sharedVersion}`, candidate = `Кандидат от ${sharedVersion}`
  if (!personalExists) return { kind: 'published', version: `Опубликована ${sharedVersion}`, audience, saved: 'без изменений', tone: 'neutral', primary: { kind: 'start', label: 'Начать личную версию', hint: 'Правка опубликованного начинается с личной версии; общая версия не меняется до публикации.' }, secondary: null }
  if (conflict === null) return { kind: 'unread', version: personal, audience, saved: 'черновик не прочитан · перечитайте состояние', tone: 'warning', primary: null, secondary: null }
  if (conflict) return { kind: 'conflict', version: personal, audience, saved: `опубликована ${sharedVersion} · есть конфликт`, tone: 'info', primary: { kind: 'resolve', label: 'Разрешить конфликт', hint: 'Молчаливого слияния нет: либо разрешённый документ, либо явный конфликт.' }, secondary: null }
  if (changes === 'unread') return { kind: 'unread', version: personal, audience, saved: 'изменения редактора не прочитаны', tone: 'warning', primary: null, secondary: null }
  if (changes === 'no-baseline') return { kind: 'unverified', version: personal, audience, saved: 'сверить не с чем · ревизия сохранения неизвестна', tone: 'warning', primary: { kind: 'save', label: 'Сохранить', hint: 'Ревизия последнего сохранения неизвестна. После сохранения шапка снова сверяет редактор с личной версией.' }, secondary: null }
  if (changes > 0) return { kind: 'unsaved', version: personal, audience, saved: `не сохранено · ${pluralChanges(changes)}`, tone: 'warning', primary: { kind: 'save', label: 'Сохранить', hint: 'Снимок редактора уйдёт в личную версию. Пока не сохранено, отправить на согласование нельзя.' }, secondary: null }
  if (review) {
    if (review.stale) return { kind: 'stale', version: personal, audience, saved: 'текст изменён после отправки · решения сброшены', tone: 'warning', primary: { kind: 'resubmit', label: 'Отправить заново', hint: 'Согласующие видят точно то, что будет опубликовано: изменение имени, папки или текста требует нового согласования.' }, secondary: null }
    const rejected = review.domains.flatMap(d => d.decisions.filter(x => !x.approved).map(x => ({ domain: d.domain_id, comment: (x as Decision).comment })))
    if (rejected.length) return { kind: 'rejected', version: candidate, audience, saved: rejected.map(r => `${r.domain}: отказ${r.comment ? ` — «${r.comment}»` : ''}`).join(' · '), tone: 'danger', primary: { kind: 'rework', label: 'Доработать', hint: 'Личная версия возвращается в редактирование; прежние решения остаются в истории.' }, secondary: null }
    if (review.ready) return { kind: 'ready', version: candidate, audience, saved: `одобрено: ${review.domains.map(d => d.domain_id).join(', ')}`, tone: 'success', primary: { kind: 'publish', label: 'Опубликовать', hint: 'Публикует человек: общая версия, история и аудит появляются одним действием.' }, secondary: null }
    return { kind: 'reviewing', version: candidate, audience, saved: review.domains.map(d => `${d.domain_id}: ${domainApproved(d) ? 'одобрено' : 'ждёт'}`).join(' · '), tone: 'warning', primary: null, secondary: { kind: 'withdraw', label: 'Отозвать' } }
  }
  return { kind: 'saved', version: personal, audience, saved: savedAt ? `сохранено ${formatAgo(savedAt, now)}` : 'сохранено', tone: 'neutral', primary: { kind: 'submit', label: 'На согласование', hint: 'На согласование уйдут имя, папка и текст личной версии; направления и согласующих задаёт политика проекта.' }, secondary: null }
}

const dotTone = { neutral: 'bg-kumo-inactive', warning: 'bg-kumo-warning', danger: 'bg-kumo-danger', success: 'bg-kumo-success', info: 'bg-kumo-info' } as const

export function DocumentStatusView({ model, bound, busy, disabled, versionOpen, saving, onPrimary, onSecondary, onOpenVersion, onSaveToProject }: {
  /** Привязка есть, но модели нет — состояние не прочитано, а не «не привязан». */
  model: DocumentStatusModel | null; bound?: boolean; busy?: boolean; disabled?: boolean; versionOpen: boolean
  /** Идёт автоматическое сохранение в проект: текст состояния. */
  saving?: string
  onPrimary(kind: PrimaryKind): void; onSecondary(): void; onOpenVersion(): void
  /** Документ не сохранён в Mnemos: открыть выбор проекта. */
  onSaveToProject?(): void
}) {
  const unsaved = !model && !bound && !busy && !saving
  // Шапка гаджета по макету: одна строка состояния некрупным серым текстом и пилюли действий.
  // Полный текст состояния — во всплывающей подсказке, если строка не помещается.
  const statusText = model ? `${model.version} · ${model.audience} · ${model.saved}` : undefined
  return <div className="flex min-w-0 items-center gap-2">
    <span data-document-status title={statusText} className="flex min-w-0 max-w-[340px] items-center gap-1.5 overflow-hidden whitespace-nowrap text-[13px] leading-4 text-kumo-subtle">
      {model ? <>
        <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotTone[model.tone]}`} />
        <span className={`min-w-0 max-w-full shrink truncate ${model.tone === 'warning' ? 'text-kumo-warning' : model.tone === 'neutral' ? '' : 'text-kumo-default'}`}>{model.saved}</span>
        <span className="min-w-0 flex-1 truncate text-kumo-inactive">· {model.version} · {model.audience}</span>
      </> : <span className="truncate">{saving ?? (busy ? 'Читаю состояние в Mnemos…' : bound ? 'Состояние документа не прочитано' : 'Не сохранён в Mnemos, версий нет')}</span>}
    </span>
    <button type="button" disabled={disabled} aria-pressed={versionOpen} onClick={onOpenVersion}
      className={`inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-kumo-fill-hover px-3 text-[13px] leading-4 text-kumo-default transition-colors duration-150 hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring disabled:cursor-not-allowed disabled:opacity-40 ${versionOpen ? 'bg-kumo-tint' : 'bg-kumo-overlay'}`}><ClockCounterClockwise size={15} aria-hidden="true" />Версии</button>
    {model?.secondary && <WorkshopButton className="!h-8 !rounded-full" disabled={disabled || busy} onClick={onSecondary}>{model.secondary.label}</WorkshopButton>}
    {model?.primary && <WorkshopButton tone="primary" className="!h-8 !rounded-full" data-primary-action title={model.primary.hint} disabled={disabled || busy} onClick={() => onPrimary(model.primary!.kind)}>{model.primary.label}</WorkshopButton>}
    {unsaved && onSaveToProject && <WorkshopButton tone="primary" className="!h-8 !rounded-full" data-primary-action title="Документ сохранится в выбранный проект Mnemos как ваш личный черновик; после этого появятся версии, согласование и скачивание в Word." disabled={disabled} onClick={onSaveToProject}>Сохранить в проект…</WorkshopButton>}
  </div>
}

const bindingKeyFor = (gadgetId: string | number, format: NativeDocumentFormat) => `mnemos-native-binding:${location.pathname}:${gadgetId}:${format}`

function readBinding(key: string): DocumentBinding | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null')
    if (value && typeof value.scope === 'string' && typeof value.resource === 'string' && (value.accountId === null || Number.isSafeInteger(value.accountId)) && (value.savedRevision === undefined || Number.isSafeInteger(value.savedRevision))) return value
  } catch { /* Повреждённая привязка равносильна её отсутствию. */ }
  return null
}

/** Подписи истории: при полной истории — порядковый номер публикации, иначе начало её идентификатора. */
function describeHistory(page: Awaited<ReturnType<Downloads['publications']>>, format: NativeDocumentFormat) {
  const items = page.publications.filter(p => p.format === format)
  const published = items.filter(p => !p.id.startsWith('private:'))
  const complete = !page.nextCursor && !page.historyLimited
  const label = (id: string, index: number) => complete ? `v${published.length - index}` : `v${id.slice(0, 7)}`
  const history: HistoryEntry[] = items.map(p => {
    const personal = p.id.startsWith('private:')
    return { id: p.id, recordedAt: p.recordedAt, actor: p.actor, onBehalfOf: p.onBehalfOf, personal, label: personal ? (p.actor ? 'Версия участника' : 'Личная версия') : label(p.id, published.indexOf(p)) }
  })
  return { history, sharedVersion: published.length ? label(published[0].id, 0) : '—' }
}

async function loadStatus(selector: Selector, downloads: Downloads | null, binding: DocumentBinding, format: NativeDocumentFormat, signal: AbortSignal): Promise<Omit<StatusData, 'me'>> {
  const { state, review } = await loadPublication(selector, signal, binding.scope)
  let conflict: boolean | null = false, head = '', participants: Participant[] | null = []
  if (state.personal_exists && binding.resource) {
    try { using writer = await selector.select(binding.scope, binding.resource, format); signal.throwIfAborted(); head = await writer.head() }
    catch {
      signal.throwIfAborted()
      // Черновик не открывается ровно тогда, когда документ в конфликте или недоступен для записи; конфликт различаем вторым запросом.
      // Ни черновика, ни конфликта (чужой или удалённый документ) — факт не прочитан, а не «сохранено».
      try { using selected = await selector.selectConflict(binding.scope, binding.resource, format); conflict = !!selected } catch { conflict = null }
    }
    signal.throwIfAborted()
    // Приглашённые читаются от головы черновика; без неё (конфликт, отказ) и при отказе самого запроса список не прочитан.
    participants = null
    if (head) { try { participants = (await selector.participants(binding.scope, binding.resource, head, '')).participants } catch { signal.throwIfAborted() } }
    signal.throwIfAborted()
  }
  let history: HistoryEntry[] = [], sharedVersion = '—'
  if (downloads && binding.resource) {
    try { const page = await downloads.publications(binding.scope, binding.resource, ''); ({ history, sharedVersion } = describeHistory(page, format)) } catch { /* без истории статус остаётся, только версия не подписана */ }
    signal.throwIfAborted()
  }
  return { state, review, conflict, participants, history, sharedVersion }
}

/** Текущая ревизия редактора из снимка; undefined — редактора нет или ревизии в снимке нет. */
async function readEditorRevision(snapshotSource: NativeSnapshotSourceRef, format: NativeDocumentFormat, signal: AbortSignal): Promise<number | undefined> {
  const read = snapshotSource.current
  if (!read) return undefined
  const snapshot = await read(format, signal)
  const revision = (snapshot.document as { revision?: unknown }).revision
  return typeof revision === 'number' && Number.isSafeInteger(revision) ? revision : undefined
}

async function countChanges(snapshotSource: NativeSnapshotSourceRef, format: NativeDocumentFormat, binding: DocumentBinding, signal: AbortSignal): Promise<Changes> {
  try {
    const revision = await readEditorRevision(snapshotSource, format, signal)
    if (revision === undefined) return 'unread'
    return binding.savedRevision === undefined ? 'no-baseline' : Math.max(0, revision - binding.savedRevision)
  } catch { signal.throwIfAborted(); return 'unread' }
}

const sameDocument = (a: DocumentBinding | null, b: DocumentBinding) => !!a && a.accountId === b.accountId && a.scope === b.scope && a.resource === b.resource

/** Опрос ревизии редактора: снимок — запрос к редактору, подписки на ревизию нет. */
export const CHANGES_POLL_MS = 10_000

export type DocumentStatusHandle = ReturnType<typeof useDocumentStatus>

/** Один хук на все факты шапки: черновик, конфликт, приглашённые, заявка, история — теми же RPC, что и секции панели. */
export function useDocumentStatus({ gadget, format, snapshotSource, chatId, projectChatId, changesPollMs = CHANGES_POLL_MS }: {
  gadget: RpcStub<GadgetClient>; format: NativeDocumentFormat; snapshotSource: NativeSnapshotSourceRef; chatId?: number
  /** Открытая беседа: её проект — место автосохранения, если беседа создания редактора неизвестна. */
  projectChatId?: number; changesPollMs?: number
}) {
  const { authenticatedApi } = useAuthenticatedApi()
  const [gadgetId, setGadgetId] = useState<string | number | null>(null)
  const [binding, setBindingState] = useState<DocumentBinding | null>(null)
  const [data, setData] = useState<StatusData | null>(null)
  const [projectLink, setProjectLink] = useState<{ name: string; href: string } | null>(null)
  const [changes, setChanges] = useState<Changes>('unread')
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [tick, setTick] = useState(0)
  /** Что знает рабочее место о документе Mnemos: привязка на сервере, начатое создание, проект беседы. null — не прочитано. */
  const [mnemos, setMnemos] = useState<NativeMnemosState | null>(null)
  const [saving, setSaving] = useState<string | undefined>()
  const source = useRef<{ selector: Selector; downloads: Downloads | null; origin: string } | null>(null)
  const lifetime = useRef(new AbortController())
  const working = useRef(false)
  const bindingKey = gadgetId === null ? '' : bindingKeyFor(gadgetId, format)

  useEffect(() => {
    let cancelled = false
    setGadgetId(null); setBindingState(null); setData(null); setChanges('unread'); setNotice(''); setMnemos(null)
    void (async () => {
      const id = await gadget.getId()
      // Привязка живёт на сервере рабочего места: её видят все вкладки и устройства человека.
      // Привязка, записанная раньше только во вкладке, переносится туда же.
      let state: NativeMnemosState | null = null
      try { state = await gadget.getMnemosDocument(projectChatId) } catch { state = null }
      if (cancelled) return
      const local = readBinding(bindingKeyFor(id, format))
      if (state && !state.binding && local) { state = { ...state, binding: local, creation: null, project: null }; void Promise.resolve(gadget.setMnemosDocument(local)).catch(() => {}) }
      setMnemos(state); setBindingState(state?.binding ?? local); setGadgetId(id)
    })().catch(() => {})
    return () => { cancelled = true }
  }, [gadget, chatId, format, projectChatId])

  useEffect(() => {
    if (!bindingKey) return
    const abort = new AbortController(); lifetime.current = abort
    let frame: GatekeeperUiFrame | null = null
    setBusy(true); setError(''); setProjectLink(null)
    void (async () => {
      try {
        frame = await openNativeWritesFrame(authenticatedApi, binding?.accountId ?? undefined)
        if (abort.signal.aborted) { disposeGatekeeperFrame(frame); return }
        if (!frame?.nativeWrites) throw new Error()
        const selector = frame.nativeWrites.selector as Selector
        const downloads = frame.nativeDownloads ? frame.nativeDownloads.selector as Downloads : null
        source.current = { selector, downloads, origin: frame.nativeDownloads?.storageOrigin ?? '' }
        const me = await selector.reviewerIdentity().catch(() => ''); abort.signal.throwIfAborted()
        if (!binding) { setData({ state: null, review: null, conflict: false, participants: [], history: [], sharedVersion: '—', me }); return }
        const loaded = await loadStatus(selector, downloads, binding, format, abort.signal)
        setData({ ...loaded, me })
        setChanges(await countChanges(snapshotSource, format, binding, abort.signal))
        try {
        const [scopes, accounts] = await Promise.all([selector.scopes(), listAccounts(authenticatedApi)])
        abort.signal.throwIfAborted()
        const account = accounts.find(a => storesDocuments(a) && (binding.accountId === null || a.id === binding.accountId))
        const project = scopes.scopes.find(p => p.id === binding.scope)
        if (account && project) setProjectLink({ name: project.name, href: `/gatekeepers/${encodeURIComponent(account.vendorId)}?account=${account.id}&project=${encodeURIComponent(project.id)}` })

        } catch { abort.signal.throwIfAborted() }

      } catch { if (!abort.signal.aborted) setError('Состояние документа не прочитано. Проверьте подключение Mnemos и выбранный документ.') }
      finally { if (!abort.signal.aborted) setBusy(false) }
    })()
    return () => { abort.abort(); source.current = null; disposeGatekeeperFrame(frame) }
  }, [authenticatedApi, bindingKey, binding, format, snapshotSource, tick])

  // Правки после загрузки: ревизия редактора перечитывается по таймеру, пока документ привязан и состояние прочитано.
  const statusLoaded = !!data?.state
  useEffect(() => {
    if (!binding || !statusLoaded || !(changesPollMs > 0)) return
    const abort = new AbortController()
    let inFlight = false
    const timer = setInterval(() => {
      // Снимок — полный экспорт документа редактором; в скрытой вкладке его не просим.
      if (inFlight || document.visibilityState === 'hidden') return
      inFlight = true
      void countChanges(snapshotSource, format, binding, abort.signal)
        .then(next => { if (!abort.signal.aborted) setChanges(next) }, () => {})
        .finally(() => { inFlight = false })
    }, changesPollMs)
    return () => { abort.abort(); clearInterval(timer) }
  }, [binding, statusLoaded, format, snapshotSource, changesPollMs])

  const model = useMemo(() => {
    if (!binding || !data || !data.state) return null
    const invited = data.participants === null ? null : data.participants.filter(p => p.mode !== '').map(p => p.name || 'Участник')
    const savedAt = data.history.find(h => h.personal && !h.actor)?.recordedAt ?? null
    return deriveDocumentStatus({ personalExists: data.state.personal_exists && !!binding.resource, conflict: data.conflict, invited, review: data.review, sharedVersion: data.sharedVersion, savedAt, changes })
  }, [binding, data, changes])

  function bind(next: DocumentBinding | null) {
    if (!bindingKey) return
    if (next) sessionStorage.setItem(bindingKey, JSON.stringify(next)); else sessionStorage.removeItem(bindingKey)
    setBindingState(next)
    // Вкладка хранит копию; источник истины — сервер рабочего места.
    if (mnemos) void Promise.resolve(gadget.setMnemosDocument(next)).catch(() => {})
  }
  /** Привязка, объявляющая текущую ревизию редактора сохранённой: сначала пишется сама привязка (за ней может идти перезагрузка), потом дочитывается ревизия. */
  async function bindAtEditorRevision(next: DocumentBinding) {
    bind(next)
    const key = bindingKey
    let revision: number | undefined
    try { revision = await readEditorRevision(snapshotSource, format, lifetime.current.signal) } catch { /* без ревизии привязка остаётся: шапка скажет «сверить не с чем» */ }
    if (revision === undefined || !key || !sameDocument(readBinding(key), next)) return
    bind({ ...next, savedRevision: revision })
  }
  async function run(action: (selector: Selector, signal: AbortSignal) => Promise<void>) {
    if (working.current || !source.current) return
    working.current = true
    const signal = lifetime.current.signal
    setBusy(true); setError(''); setNotice('')
    try { await action(source.current.selector, signal) }
    catch { if (!signal.aborted) setError('Результат не подтверждён. Перечитайте состояние: могли измениться версия, права или решения. Повтор отправки той же версии не создаёт дубликат.') }
    finally { working.current = false; if (!signal.aborted) setBusy(false) }
  }
  // Автосохранение в проект беседы: документ, таблица или презентация, созданные в беседе с проектом,
  // сразу получают документ в Mnemos (личный черновик человека) — без этого нет версий. Ждём, пока в
  // редакторе появится содержимое, чтобы в проект не ушёл пустой «Новый документ». Начатое и
  // оборвавшееся создание повторяется той же заявкой (creation с квитанцией), без второго документа.
  const autoResume = !binding && mnemos && gadgetId !== null && mnemos.creation?.receipt ? mnemos.creation : null
  const autoProject = !binding && mnemos && gadgetId !== null && !autoResume ? mnemos.project : null
  const autoKey = autoResume ? `resume:${autoResume.claim}` : autoProject ? `project:${autoProject.accountId}:${autoProject.projectId}` : ''
  useEffect(() => {
    if (!autoKey || !(changesPollMs > 0)) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined, failures = 0
    const later = (ms = changesPollMs) => { if (!abort.signal.aborted) timer = setTimeout(() => { void attempt() }, ms) }
    const attempt = async () => {
      if (working.current || document.visibilityState === 'hidden') return later()
      let frame: GatekeeperUiFrame | null = null
      try {
        const read = snapshotSource.current
        if (!read) return later()
        const snapshot = await read(format, abort.signal)
        if (!autoResume && !nativeTitleSource(format, snapshot.document).hasContent) return later()
        working.current = true
        setSaving(autoProject ? `Сохраняю в проект «${autoProject.title}»…` : 'Сохраняю в Mnemos…')
        // Имя в Mnemos совпадает с названием в шапке редактора: сначала название, потом документ.
        const title = autoResume ? null : await Promise.resolve(gadget.ensureNativeDocumentTitle(chatId)).catch(() => null)
        abort.signal.throwIfAborted()
        const name = autoResume?.name ?? (cleanNativeTitle(title ?? '') || mnemosDocumentName(format, snapshot.document, await Promise.resolve(gadget.getTitle()).catch(() => '')))
        const accountId = autoResume?.accountId ?? autoProject!.accountId
        const writes = await openNativeWritesFrame(authenticatedApi, accountId); frame = writes
        abort.signal.throwIfAborted()
        const created = await createMnemosDocument({ gadget, writes: { selector: writes.nativeWrites.selector as unknown as Selector, storageOrigin: writes.nativeWrites.storageOrigin },
          format, snapshotSource, accountId, scope: autoResume?.scope ?? autoProject!.projectId, name, resume: autoResume, signal: abort.signal })
        if (created) {
          bind(created)
          setNotice(autoProject ? `Документ сохранён в проект «${autoProject.title}» как ваш личный черновик. Здесь видны его версии.` : 'Документ сохранён в Mnemos как ваш личный черновик.')
          return
        }
        // Документ создаёт другая вкладка: ждём её привязку.
        const state = await gadget.getMnemosDocument(projectChatId)
        if (state.binding) { bind(state.binding); return }
        later()
      } catch {
        if (abort.signal.aborted) return
        if (++failures < 3) later(changesPollMs * failures * 3)
        else setError('Документ не сохранился в проект автоматически. Сохраните его кнопкой «Сохранить в проект…».')
      } finally {
        working.current = false
        if (!abort.signal.aborted) setSaving(undefined)
        disposeGatekeeperFrame(frame)
      }
    }
    void attempt()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [autoKey])

  // Выгрузка в Word сохраняет редактор сама — шапка принимает новую привязку.
  useEffect(() => {
    if (!bindingKey) return
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<NativeBindingEventDetail>).detail
      if (detail?.gadgetId !== gadgetId || detail.format !== format) return
      sessionStorage.setItem(bindingKey, JSON.stringify(detail.binding)); setBindingState(detail.binding)
    }
    window.addEventListener(NATIVE_BINDING_EVENT, listener)
    return () => window.removeEventListener(NATIVE_BINDING_EVENT, listener)
  }, [bindingKey, gadgetId, format])

  // Название: документ без названия, в котором появился текст, получает его сам (из заголовка, первой
  // строки или от быстрой модели), чтобы не оставаться «Новым документом». При автосохранении название
  // задаёт оно само.
  const [titled, setTitled] = useState(false)
  useEffect(() => { setTitled(false) }, [gadget, format])
  useEffect(() => {
    if (titled || !mnemos || gadgetId === null || autoKey || !(changesPollMs > 0)) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = async () => {
      try {
        const read = snapshotSource.current
        if (read && document.visibilityState !== 'hidden') {
          const source = nativeTitleSource(format, (await read(format, abort.signal)).document)
          if (source.title || (source.hasContent && await gadget.ensureNativeDocumentTitle(chatId))) { setTitled(true); return }
        }
      } catch { if (abort.signal.aborted) return }
      if (!abort.signal.aborted) timer = setTimeout(() => { void check() }, changesPollMs)
    }
    void check()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [titled, mnemos, gadgetId, autoKey, format, chatId, changesPollMs])

  const refresh = () => setTick(t => t + 1)
  const submit = () => run(async (selector, signal) => {
    if (!binding || !data?.state) return
    const loaded = await submitReview(selector, signal, binding.scope, data.state)
    setData(old => old && { ...old, state: loaded.state, review: loaded.review })
    setNotice('Сохранённые изменения проекта отправлены на согласование.')
  })
  const withdraw = () => run(async (selector, signal) => {
    if (!binding || !data?.review) return
    await selector.withdrawReview(data.review.candidate_id)
    signal.throwIfAborted()
    sessionStorage.removeItem(reviewKey(binding.scope))
    setData(old => old && { ...old, review: null })
    setNotice('Согласование отозвано. Для публикации потребуется новая отправка и новые решения.')
  })
  const publish = () => run(async (selector, signal) => {
    if (!binding || !data?.review) return
    const candidate = data.review.candidate_id
    setData(old => old && { ...old, review: null })
    setNotice(await publishCandidate(selector, signal, binding.scope, candidate))
    refresh()
  })
  const listScopes = async () => (await source.current?.selector.scopes())?.scopes ?? []
  const listDocuments = async (scope: string) => (await source.current?.selector.documents(scope, ''))?.documents ?? []
  const comparison = () => source.current ? { selector: source.current.selector, downloads: source.current.downloads, origin: source.current.origin } : null

  return { gadgetId, bindingKey, binding, projectLink, data, changes, model, busy, error, notice, saving, suggestedProject: mnemos?.project ?? null, refresh, bind, bindAtEditorRevision, submit, withdraw, publish, listScopes, listDocuments, comparison, lifetime }
}

export default function DocumentStatus({ gadget, format, snapshotSource, chatId, projectChatId, disabled, panelHost, onCollapseChat, changesPollMs }: {
  gadget: RpcStub<GadgetClient>; format: NativeDocumentFormat; snapshotSource: NativeSnapshotSourceRef; chatId?: number; disabled?: boolean
  /** Открытая беседа рабочего места: её проект — место автосохранения. */
  projectChatId?: number
  /** Куда монтировать панель; без него панель рисуется рядом с блоком. */
  panelHost?: Element | null; onCollapseChat?(): void
  /** Период опроса ревизии редактора, мс. */
  changesPollMs?: number
}) {
  const status = useDocumentStatus({ gadget, format, snapshotSource, chatId, projectChatId, changesPollMs })
  const [panel, setPanel] = useState<{ open: boolean; section: PanelSection | null }>({ open: false, section: null })
  const [launch, setLaunch] = useState<NativeDocumentLaunch | null>(null)

  // Незавершённое «Открыть из Mnemos» раньше всплывало диалогом само; теперь для него открывается панель.
  useEffect(() => {
    if (chatId !== undefined || status.gadgetId === null) return
    const requested = readNativeDocumentLaunch(format)
    setLaunch(requested)
    if (requested || readPendingNativeOpen(nativeOpenKey(status.gadgetId), format)) setPanel({ open: true, section: 'open' })
  }, [status.gadgetId, chatId, format])

  const onPrimary = (kind: PrimaryKind) => {
    if (kind === 'save' || kind === 'start') setPanel({ open: true, section: 'save' })
    else if (kind === 'resolve') setPanel({ open: true, section: 'conflict' })
    else if (kind === 'submit' || kind === 'resubmit') void status.submit()
    else if (kind === 'rework') status.withdraw()
    else if (kind === 'publish') void status.publish()
  }
  const panelNode = panel.open ? <DocumentVersionPanel
    key={`${chatId ?? 'workspace'}:${format}`} gadget={gadget} format={format} snapshotSource={snapshotSource} chatId={chatId} disabled={disabled}
    launch={launch ?? undefined} onLaunchConsumed={() => { clearNativeDocumentLaunch(); setLaunch(null) }}
    status={status} section={panel.section} onSection={section => setPanel({ open: true, section })}
    onClose={() => setPanel({ open: false, section: null })} onCollapseChat={onCollapseChat} /> : null
  return <>
    {status.projectLink && <a className="max-w-[140px] shrink-0 truncate text-[13px] text-kumo-subtle hover:text-kumo-default" title={`Проект: ${status.projectLink.name}`} href={status.projectLink.href}>{status.projectLink.name}</a>}
    <DocumentStatusView model={status.model} bound={!!status.binding} busy={status.busy} disabled={disabled} versionOpen={panel.open} saving={status.saving}
      onPrimary={onPrimary} onSecondary={status.withdraw} onOpenVersion={() => setPanel(old => ({ open: !old.open, section: null }))}
      onSaveToProject={() => setPanel({ open: true, section: 'save' })} />
    {panelHost ? createPortal(panelNode, panelHost) : panelNode}
  </>
}
