import { HISTORY_POLL_MS, historyPreparing, type HistoryProgress } from '../../gatekeeper-mnemos/src/history-preparing.ts'
import HistoryPreparingNotice from './HistoryPreparingNotice'
import { useEffect, useRef, useState } from 'react'
import NativeOfficeImport from './NativeOfficeImport'
import { RpcStub, RpcTarget } from 'capnweb'
import type { ConnectedAccountsSubscriber, GadgetClient } from '@gadgets/workshop-shared/api'
import type { GatekeeperNativeDocumentSelector, GatekeeperNativeDocumentWriteSelector, GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import type { MnemosNodeFormat, NativeDocumentEditor, NativeDocumentFormat } from '@gadgets/workshop-shared/native-document'
import { downloadGatekeeperOffice } from './gatekeeperAppDownload'
import { useAuthenticatedApi } from './AuthContext'
import { WorkshopButton } from './components/WorkshopControls'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { openNativeDownloadsFrame, storesDocuments } from './accountCapabilities'
import { downloadGatekeeperNativeDocument } from './gatekeeperAppDownload'
import type { NativeSnapshotSourceRef } from './nativeSnapshotSource'

type Pending = { accountId: number; resourceUrl: string; publication: string; revision: number; label: string; format: NativeDocumentFormat; at: number; sourceId?: number; scope?: string; resource?: string }
/** Ограничиваем также подготовку: до apply могут зависнуть адрес и каталог версий. */
async function boundedOpening<T>(operation: Promise<T>, timeoutMs: number, disposeLate?: (value: T) => void): Promise<T> {
  let expired = false
  let timer!: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error('Opening timed out')) }, timeoutMs) })
  try { return await Promise.race([operation.then(value => { if (expired) { if (disposeLate) disposeLate(value); else (value as Partial<Disposable> | null)?.[Symbol.dispose]?.(); throw new Error('Opening timed out') }; return value }), timeout]) }
  finally { clearTimeout(timer) }
}

/** Что открыто в редакторе: адрес документа в Mnemos для привязки состояния. */
export type NativeOpenResult = { accountId: number; scope: string; resource: string; publication?: string
  /** Ревизия редактора сразу после того, как в него встала открытая версия; undefined — редактор её не сообщил. */
  revision?: number }
type Props = {
  gadget: Pick<RpcStub<GadgetClient>, 'getId' | 'prepareNativeDocumentRead' | 'readNativeDocument' | 'connectToGadget' | 'onRpcBroken'>; format: NativeDocumentFormat; snapshotSource: NativeSnapshotSourceRef; disabled?: boolean; reconnect(): void
  /** Секция видна по запросу; незавершённое открытие показывается независимо от этого флага. */
  open?: boolean; initialAccountId?: number; initialScope?: string; initialResource?: string; initialPublication?: string; onOpened?(result: NativeOpenResult): void | Promise<void>; onClose?(): void
  /** Открыть заданную версию сразу, без кнопки: «Открыть» из «Входящих», новая версия после чужой правки, возврат версии. */
  autoApply?: boolean
  openingTimeoutMs?: number
}
type Item = { id: string; name: string; sharedDeleted?: boolean }
type Publication = { id: string; recordedAt: string; actor: string; onBehalfOf?: string; recordedBy?: {actor: string; onBehalfOf: string}; format: MnemosNodeFormat }

const editorRevision = (value: unknown) => {
  const revision = (value as { revision?: unknown } | null | undefined)?.revision
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0 ? revision : undefined
}

export const nativeOpenKey = (gadgetId: string | number) => `mnemos-native-open:${location.pathname}:${gadgetId}`

/** Незавершённое открытие из sessionStorage: только свежее (до 5 минут) и того же формата; повреждённая запись стирается. */
export function readPendingNativeOpen(storageKey: string, format: NativeDocumentFormat): Pending | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) || 'null')
    if (value && value.format === format && Number.isSafeInteger(value.accountId) && Number.isSafeInteger(value.revision) &&
      typeof value.resourceUrl === 'string' && typeof value.publication === 'string' && typeof value.label === 'string' &&
      Number.isFinite(value.at) && Date.now() - value.at >= 0 && Date.now() - value.at < 300000) return value
    sessionStorage.removeItem(storageKey)
  } catch { /* An invalid local resume hint conveys no authority. */ }
  return null
}

export default function NativeDocumentOpen({ open = true, onClose, ...props }: Props) {
  const [closed, setClosed] = useState(false), [key, setKey] = useState(''), [pending, setPending] = useState<Pending | null>(null), [attempt, setAttempt] = useState(0), [loadError, setLoadError] = useState(false)
  useEffect(() => {
    let cancelled = false
    setClosed(false); setKey(''); setPending(null); setLoadError(false)
    void boundedOpening(props.gadget.getId(), props.openingTimeoutMs ?? 20000).then(id => {
      if (cancelled) return
      const storageKey = nativeOpenKey(id)
      setKey(storageKey)
      setPending(readPendingNativeOpen(storageKey, props.format))
    }).catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [props.gadget, props.format, attempt])
  function close() { sessionStorage.removeItem(key); setPending(null); setClosed(true); onClose?.() }
  if (loadError && open) return <section aria-label="Открытие документа"><p role="alert">Не удалось открыть рабочее место. Повторите попытку.</p><WorkshopButton onClick={() => setAttempt(value => value + 1)}>Повторить открытие</WorkshopButton></section>
  if (!key || closed || (!open && !pending)) return null
  return <OpenSection key={attempt} {...props} storageKey={key} resume={pending} close={close} retry={() => { setPending(readPendingNativeOpen(key, props.format)); setAttempt(value => value + 1) }} />
}

function OpenSection({ gadget, format, snapshotSource, reconnect, storageKey, resume: resumed, close, initialAccountId, initialScope, initialResource, initialPublication, onOpened, autoApply, openingTimeoutMs = 20000, retry }: Omit<Props, 'open' | 'onClose'> & { storageKey: string; resume: Pending | null; close(): void; retry(): void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  // Незавершённое открытие продолжается само: человек уже выбрал документ до перезагрузки. «Выбрать версию»
  // после ошибки переводит карточку в ручной выбор и забывает незавершённое открытие.
  const [resume, setResume] = useState(resumed), [manual, setManual] = useState(false)
  const auto = !manual && (!!resume || !!autoApply)
  const [accounts, setAccounts] = useState<{ id: number; name: string; valid: boolean }[]>([])
  const [accountId, setAccountId] = useState<number | null>(initialAccountId ?? null)
  const [scopes, setScopes] = useState<Item[]>([]), [documents, setDocuments] = useState<Item[]>([])
  const [scope, setScope] = useState(initialScope ?? ''), [document, setDocument] = useState(initialResource ?? ''), [publication, setPublication] = useState('')
  const [publications, setPublications] = useState<Publication[]>([]), [resourceUrl, setResourceUrl] = useState('')
  const [historyLimited,setHistoryLimited]=useState(false)
  /** История проекта готовится на сервере: публикации перечитываются сами через HISTORY_POLL_MS. */
  const [preparing, setPreparing] = useState<HistoryProgress | null>(null), [historyRound, setHistoryRound] = useState(0)
  useEffect(() => {
    if (!preparing) return
    const timer = setTimeout(() => setHistoryRound(round => round + 1), HISTORY_POLL_MS)
    return () => clearTimeout(timer)
  }, [preparing])
  const [docCursor, setDocCursor] = useState(''), [pubCursor, setPubCursor] = useState(''), [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(!resume), [busy, setBusy] = useState(false), [error, setError] = useState(''), [timedOut, setTimedOut] = useState(false)
  const selector = useRef<RpcStub<GatekeeperNativeDocumentSelector> | null>(null)
  const storageOrigin = useRef('')
  const writer = useRef<RpcStub<GatekeeperNativeDocumentWriteSelector> | null>(null)
  const [restoreDeleted, setRestoreDeleted] = useState(false)
  const [sharedDeleted, setSharedDeleted] = useState<boolean | undefined>()
  const [restoreHead, setRestoreHead] = useState(''), [notice, setNotice] = useState('')
  useEffect(() => { setRestoreHead(''); setNotice('') }, [accountId, scope, document, publication])
  const lifetime = useRef(new AbortController())
  // Счётчик подключений: эффекты выбора проекта и документа перезапускаются, когда селектор появился позже их первого запуска.
  const [sourceVersion, setSourceVersion] = useState(0)
  useEffect(() => { const abort = new AbortController(); lifetime.current = abort; return () => abort.abort() }, [])
  useEffect(() => {
    if (resume) return
    let cancelled = false, subscription: RpcStub<object> | undefined
    class Accounts extends RpcTarget implements ConnectedAccountsSubscriber {
      add(...[id, description, _vendor, resources, valid, vendorId]: Parameters<ConnectedAccountsSubscriber['add']>) {
        if (cancelled || !storesDocuments({ description, supportedResources: resources })) return
        setAccounts(old => [...old.filter(a => a.id !== id), { id, name: description.displayName || description.uniqueName || vendorId, valid }])
      }
      remove(id: number) { if (!cancelled) { setAccounts(old => old.filter(a => a.id !== id)); setAccountId(old => old === id ? null : old) } }
      ready() { if (!cancelled) setLoading(false) }
    }
    void authenticatedApi.subscribeConnectedAccounts(new Accounts()).then(value => {
      if (cancelled) value[Symbol.dispose](); else subscription = value
    }).catch(() => { if (!cancelled) { setError('Не удалось прочитать подключения.'); setLoading(false) } })
    return () => { cancelled = true; subscription?.[Symbol.dispose]() }
  }, [authenticatedApi, resume])
  useEffect(() => {
    let cancelled = false, frame: GatekeeperUiFrame | null = null
    selector.current = null; writer.current = null; storageOrigin.current = ''; setRestoreHead(''); setScopes([]); setScope(old => old === initialScope ? old : '')
    if (accountId === null) { setLoading(false); return }
    setLoading(true); setError('')
    void (async () => {
      try {
        frame = await boundedOpening(openNativeDownloadsFrame(authenticatedApi, accountId), openingTimeoutMs, disposeGatekeeperFrame)
        if (cancelled) { disposeGatekeeperFrame(frame); return }
        if (!frame?.nativeDownloads) throw new Error()
        selector.current = frame.nativeDownloads.selector as RpcStub<GatekeeperNativeDocumentSelector>
        writer.current = frame.nativeWrites?.selector as RpcStub<GatekeeperNativeDocumentWriteSelector> | undefined || null
        storageOrigin.current = frame.nativeWrites?.storageOrigin || ''
        const page = await boundedOpening(selector.current.scopes(), openingTimeoutMs)
        if (!cancelled) { setScopes(page.scopes); setSourceVersion(v => v + 1) }
      } catch { if (!cancelled) setError('Подключение недоступно. Переподключите его в разделе «Подключения».') }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true; selector.current = null; writer.current = null; disposeGatekeeperFrame(frame) }
  }, [authenticatedApi, accountId])
  useEffect(() => {
    let cancelled = false
    setDocuments([]); setDocCursor(''); setTruncated(false)
    setDocument(old => old === initialResource && scope === initialScope ? old : '')
    if (!scope || !selector.current) return
    setLoading(true); setError('')
    void boundedOpening(selector.current.documents(scope, ''), openingTimeoutMs).then(page => {
      if (!cancelled) { setDocuments(page.documents); setDocCursor(page.nextCursor); setTruncated(page.truncated) }
    }).catch(() => { if (!cancelled) setError('Не удалось прочитать документы.') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [scope, accountId, sourceVersion])
  useEffect(() => {
    let cancelled = false
    setPublications([]); setPublication(scope === initialScope && document === initialResource ? initialPublication ?? '' : ''); setPubCursor(''); setHistoryLimited(false); setResourceUrl(''); setSharedDeleted(undefined)
    if (!scope || !document || !selector.current) { setPreparing(null); return }
    if (/\.(docx|xlsx)$/i.test(documents.find(d => d.id === document)?.name || '')) return
    setLoading(true); setError('')
    void boundedOpening(selector.current.publications(scope, document, ''), openingTimeoutMs).then(page => {
      if (!cancelled) { setPreparing(null); setPublications(page.publications.filter(p => p.format === format)); setPubCursor(page.nextCursor); setHistoryLimited(old=>old||!!page.historyLimited); setResourceUrl(page.resourceUrl); setSharedDeleted(page.sharedDeleted) }
    }).catch(error => {
      if (cancelled) return
      const progress = historyPreparing(error)
      if (progress) setPreparing(progress); else { setPreparing(null); setError('Не удалось прочитать публикации.') }
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [scope, document, accountId, format, sourceVersion, historyRound])
  async function more(kind: 'documents' | 'publications') {
    if (!selector.current || loading || busy) return
    setLoading(true)
    try {
      if (kind === 'documents') {
        const page = await selector.current.documents(scope, docCursor); lifetime.current.signal.throwIfAborted()
        setDocuments(old => [...new Map([...old, ...page.documents].map(d => [d.id, d])).values()]); setDocCursor(page.nextCursor); setTruncated(page.truncated)
      } else {
        const page = await selector.current.publications(scope, document, pubCursor); lifetime.current.signal.throwIfAborted()
        if (page.resourceUrl !== resourceUrl) throw new Error()
        setPublications(old => [...new Map([...old, ...page.publications.filter(p => p.format === format)].map(p => [p.id, p])).values()]); setPubCursor(page.nextCursor); setHistoryLimited(old=>old||!!page.historyLimited)
      }
    } catch { if (!lifetime.current.signal.aborted) setError('Не удалось прочитать следующую страницу.') }
    finally { if (!lifetime.current.signal.aborted) setLoading(false) }
  }
  async function exportOffice(original = false) {
    const selected = publications.find(p => p.id === publication)
    if (busy || loading || !writer.current || !selected || !publication.startsWith('private:') || selected.actor) return
    const signal = lifetime.current.signal
    setBusy(true); setError(''); setNotice('')
    try {
      using download = original ? await writer.current.originalOffice(scope, document, publication.slice(8)) : await writer.current.exportOffice(scope, document, publication.slice(8), format)
      if (!download) { setNotice('Для этой копии не записан офисный оригинал.'); return }
      const ticket = await download.issue()
      const bytes = await downloadGatekeeperOffice(storageOrigin.current, ticket, format, signal, () => download.validate())
      const suffix = format === 'cloudflareos.document' ? '.docx' : format === 'cloudflareos.presentation' ? '.pptx' : '.xlsx'
      const name = (documents.find(d => d.id === document)?.name || 'Документ').replace(/\.(cfdoc|cfsheet|cfslides)$/i, '').replace(/[/\\\u0000-\u001f]/g, '_') + (original ? ' — оригинал' : '') + suffix
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], {type: ticket.content_type}))
      const link = globalThis.document.createElement('a'); link.href = url; link.download = name
      globalThis.document.body.append(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice(original ? 'Сохранённый оригинал подготовлен для скачивания.' : 'Экспорт выбранной личной версии подготовлен для скачивания.')
    } catch { if (!signal.aborted) setError('Экспорт не выполнен: проверьте выбранную версию и права. Некоторые свойства формата пока не поддерживаются.') }
    finally { if (!signal.aborted) setBusy(false) }
  }
  async function restore() {
    if (busy || loading || !writer.current || !publication) return
    const signal = lifetime.current.signal
    setBusy(true); setError(''); setNotice('')
    try {
      if (!restoreHead) {
        const state = await writer.current.restorationState(scope, document, format); signal.throwIfAborted()
        if(state.deleted&&publication.startsWith('private:'))throw Error('Личная версия восстанавливается только в существующий документ.')
        setRestoreHead(state.head); setRestoreDeleted(state.deleted)
        setNotice(state.deleted ? 'Документ удалён. Восстановление вернёт содержимое, имя и папку выбранной публикации в личную версию; другие документы сохранятся.' : 'Выбрана текущая личная версия. Восстановление заменит в ней содержимое этого документа; другие документы сохранятся.')
      } else {
        const expected = restoreHead
        setRestoreHead('')
        await writer.current.restorePublication(scope, document, publication, expected, format, restoreDeleted)
        signal.throwIfAborted()
        const page = await selector.current!.publications(scope, document, ''); signal.throwIfAborted()
        setPublications(page.publications.filter(p => p.format === format)); setPubCursor(page.nextCursor); setHistoryLimited(old=>old||!!page.historyLimited); setSharedDeleted(page.sharedDeleted)
        setNotice('Содержимое восстановлено в личной версии Mnemos. Выберите «Личная версия», чтобы открыть её в редакторе. Для публикации отправьте сохранённые изменения на согласование.')
      }
    } catch {
      if (!signal.aborted) { setRestoreHead(''); setError('Восстановление не подтверждено. Откройте личную версию и проверьте результат перед новой попыткой; могли измениться права или версия.') }
    } finally { if (!signal.aborted) setBusy(false) }
  }
  async function apply() {
    if (busy || loading || (!resume && (accountId === null || !resourceUrl || !publication))) return
    const deadline = new AbortController()
    const attemptTimer = setTimeout(() => deadline.abort(new Error('Opening timed out')), openingTimeoutMs)
    const signal = AbortSignal.any([lifetime.current.signal, deadline.signal])
    // Ожидание RPC заканчивается вместе с попыткой; поздний ответ не продолжает открытие.
    async function wait<T>(operation: Promise<T>): Promise<T> {
      signal.throwIfAborted()
      let cancel!: () => void
      const aborted = new Promise<never>((_, reject) => { cancel = () => reject(signal.reason); signal.addEventListener('abort', cancel, { once: true }) })
      try { return await Promise.race([operation.then(value => {
        if (signal.aborted) { (value as Partial<Disposable> | null)?.[Symbol.dispose]?.(); throw signal.reason }
        return value
      }), aborted]) }
      finally { signal.removeEventListener('abort', cancel) }
    }
    setBusy(true); setError('')
    try {
      const flush = snapshotSource.current
      if (!flush) throw new Error()
      const current = await wait(flush(format, signal)), revision = current.document.revision
      if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || (resume && resume.revision !== revision)) throw new Error()
      const intent: Pending = resume ?? { accountId: accountId!, resourceUrl, publication, revision, label: documents.find(d => d.id === document)?.name || 'Документ', format, at: Date.now(), scope, resource: document }
      signal.throwIfAborted()
      sessionStorage.setItem(storageKey, JSON.stringify(intent))
      const prepared = await wait(gadget.prepareNativeDocumentRead(intent.accountId, intent.resourceUrl, intent.publication))
      signal.throwIfAborted()
      sessionStorage.setItem(storageKey, JSON.stringify({ ...intent, sourceId: prepared.sourceId }))
      if (prepared.restartRequired) {
        // Перезагрузка для этого открытия уже была: вторая означала бы петлю перезагрузок без открытия.
        if (resume?.sourceId !== undefined) throw new Error('Restart repeated')
        // Wait for the old session to close: reloading on the prepare response can reconnect
        // to that same instance before its deferred abort, leaving the editor with dead RPCs.
        await new Promise<void>((resolve, reject) => {
          let done = false, probe: ReturnType<typeof setTimeout> | undefined
          const finish = (error?: Error) => {
            if (done) return
            done = true; clearTimeout(timer); clearTimeout(probe)
            signal.removeEventListener('abort', cancelled); error ? reject(error) : resolve()
          }
          const check = () => {
            if (done) return
            // Native stubs may report breakage only after an invocation. Probe metadata,
            // never the download capability, while waiting for the old context to end.
            void gadget.getId().then(() => { if (!done) probe = setTimeout(check, 100) }, () => finish())
          }
          const cancelled = () => finish(new Error('Opening cancelled'))
          const timer = setTimeout(() => finish(new Error('Reconnect not observed')), 20000)
          signal.addEventListener('abort', cancelled, { once: true })
          gadget.onRpcBroken(() => finish())
          if (!done) probe = setTimeout(check, 100)
          if (signal.aborted) cancelled()
        })
        signal.throwIfAborted(); reconnect(); return
      }
      const read = await wait(gadget.readNativeDocument(prepared.sourceId))
      // Ревизию после восстановления сообщает сам редактор (ответ restore или getDocument на сервере гаджета):
      // запрос снимка у окна редактора сразу после восстановления отказывает, пока оно перерисовывается.
      let opened: number | undefined
      try {
        const ticket = await wait(read.download.issue())
        const snapshot = await wait(downloadGatekeeperNativeDocument(read.storageOrigin, ticket, format, signal, () => read.download.validate()))
        const editor = await wait(gadget.connectToGadget()) as RpcStub<NativeDocumentEditor>
        try {
          await wait(read.download.validate()); signal.throwIfAborted()
          const restored = await wait(editor.restoreDocumentSnapshot(snapshot, revision))
          opened = editorRevision(restored) ?? editorRevision(await wait((async () => editor.getDocument())().catch(() => undefined)))
        } finally { editor[Symbol.dispose]() }
      } finally { read[Symbol.dispose]() }
      signal.throwIfAborted()
      // Если запись в редактор уже завершилась, повтор сверяет именно эту ревизию.
      // Правки человека после неё по-прежнему запрещают автоматическое восстановление.
      if (opened !== undefined) sessionStorage.setItem(storageKey, JSON.stringify({ ...intent, sourceId: prepared.sourceId, revision: opened }))
      if (intent.scope && intent.resource) await wait(Promise.resolve(onOpened?.({ accountId: intent.accountId, scope: intent.scope, resource: intent.resource, publication: intent.publication, ...(opened !== undefined ? { revision: opened } : {}) })))
      signal.throwIfAborted(); close(); reconnect()
    } catch {
      if (!lifetime.current.signal.aborted) setError(deadline.signal.aborted ? 'Открытие заняло слишком много времени. Повторите попытку.' : 'Документ не открылся: он изменился или доступ закрыт. Выберите версию ещё раз.')
    } finally { clearTimeout(attemptTimer); if (!lifetime.current.signal.aborted) setBusy(false) }
  }
  // Открытие без кнопки: один раз, когда заданная версия выбрана и адрес документа прочитан.
  const autoTried = useRef(false)
  // Общий срок включает ожидание React-состояния между запросами, а не только сами RPC.
  useEffect(() => {
    if (!auto) return
    const timer = setTimeout(() => { autoTried.current = true; lifetime.current.abort(); setTimedOut(true); setBusy(false) }, openingTimeoutMs)
    return () => clearTimeout(timer)
  }, [auto, openingTimeoutMs])
  useEffect(() => {
    if (!auto || autoTried.current || busy || loading) return
    if (!resume && (accountId === null || !resourceUrl || !publication || publication !== initialPublication)) return
    autoTried.current = true
    void apply()
  }, [auto, resume, accountId, resourceUrl, publication, busy, loading])
  // Заданной версии нет среди публикаций документа: ждать нечего, человек выбирает сам.
  useEffect(() => {
    if (!auto || resume || autoTried.current || busy || loading || !resourceUrl || !initialPublication) return
    if (!publications.some(p => p.id === initialPublication) && !pubCursor) setError('Этой версии документа больше нет. Выберите другую.')
  }, [auto, resume, busy, loading, resourceUrl, publications, pubCursor, initialPublication])
  function chooseManually() {
    sessionStorage.removeItem(storageKey); setResume(null); setManual(true); setError(''); setLoading(true)
  }
  // На телефоне поле выбора 40 px и шрифт 16 px: мельче iOS приближает страницу при касании.
  const selectClass = 'mt-1 block h-10 w-full rounded-lg border border-kumo-line bg-kumo-base px-2 text-[16px] sm:h-9 sm:text-[13px]'
  const opening = resume?.label || documents.find(d => d.id === document)?.name || ''
  const openingError = timedOut ? 'Открытие заняло слишком много времени. Повторите попытку.' : error
  if (auto) return <section aria-label="Открытие документа" className="flex flex-col gap-3 text-[14px] leading-5 text-kumo-default">
      {openingError ? <p role="alert" className="m-0 text-kumo-danger">{openingError}</p>
        : <p role="status" className="m-0">{opening ? `Открываю «${opening}»…` : 'Открываю документ…'}</p>}
      {preparing && !openingError && <HistoryPreparingNotice progress={preparing} subject="Документ откроется" />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <WorkshopButton className="!h-10 w-full sm:!h-8 sm:w-auto" onClick={close}>Отменить</WorkshopButton>
        {openingError && !timedOut && <WorkshopButton className="!h-10 w-full sm:!h-9 sm:w-auto" onClick={chooseManually}>Выбрать версию</WorkshopButton>}
        {openingError && <WorkshopButton tone="primary" className="!h-10 w-full sm:!h-9 sm:w-auto" onClick={retry}>Повторить открытие</WorkshopButton>}
      </div>
    </section>
  return <section className="flex flex-col gap-2 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default">
      <p className="m-0 text-[13px] leading-[18px] text-kumo-subtle">Выбранная версия заменит то, что сейчас в редакторе.</p>
      {resume ? <p className="m-0">{resume.label}</p> : <>
        <label className="block">Подключение<select aria-label="Подключение Mnemos" className={selectClass} disabled={loading || busy} value={accountId ?? ''} onChange={e => setAccountId(e.target.value === '' ? null : Number(e.target.value))}>
          <option value="">Выберите подключение</option>{accounts.map(a => <option key={a.id} value={a.id} disabled={!a.valid}>{a.name}{a.valid ? '' : ' — нужно переподключить'}</option>)}</select></label>
        <label className="block">Проект<select aria-label="Проект для открытия" className={selectClass} disabled={loading || busy || accountId === null} value={scope} onChange={e => setScope(e.target.value)}>
          <option value="">Выберите проект</option>{scopes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="block">Документ<select aria-label="Документ для открытия" className={selectClass} disabled={loading || busy || !scope} value={document} onChange={e => setDocument(e.target.value)}>
          <option value="">Выберите документ</option>{documents.map(d => <option key={d.id} value={d.id}>{d.name}{d.sharedDeleted ? " — удалён из общей версии" : ""}</option>)}</select></label>
        {docCursor && <WorkshopButton disabled={loading || busy} onClick={() => { void more('documents') }}>Ещё документы</WorkshopButton>}
        {truncated && !docCursor && <p className="text-sm">Показаны не все документы.</p>}
        {sharedDeleted === true && <p role="status">Документ удалён из общей версии. Ниже доступны сохранённые версии: их можно открыть или восстановить в личную версию. Для возвращения в общую версию потребуется публикация.</p>}
        <label className="block">Публикация<select aria-label="Публикация Mnemos" className={selectClass} disabled={loading || busy || !document} value={publication} onChange={e => setPublication(e.target.value)}>
          <option value="">Выберите версию</option>{publications.map(p => <option key={p.id} value={p.id}>{p.id.startsWith('private:') ? (p.actor ? `Версия участника — ${p.actor}` : `Личная версия${p.recordedAt ? ' — '+new Date(p.recordedAt).toLocaleString() : ''} — ${p.id.slice(8,16)}`) : `${new Date(p.recordedAt).toLocaleString()} — ${p.onBehalfOf ? `Агент ${p.actor} от имени ${p.onBehalfOf}` : (p.actor || 'Участник')}`}</option>)}</select></label>
        {pubCursor && <WorkshopButton disabled={loading || busy} onClick={() => { void more('publications') }}>Ещё публикации</WorkshopButton>}
        {!loading && document && !publications.length && <p className="text-sm">На этой странице нет публикаций подходящего нативного формата.</p>}
      </>}
      {!resume && writer.current && scope && document && (format === 'cloudflareos.document' ? /\.docx$/i : format === 'cloudflareos.presentation' ? /\.pptx$/i : /\.xlsx$/i).test(documents.find(d => d.id === document)?.name || '') && <NativeOfficeImport
        key={`${accountId}:${scope}:${document}`} selector={writer.current} updateSelector={writer.current} storageOrigin={storageOrigin.current} scope={scope} resource={document}
        name={documents.find(d => d.id === document)?.name || 'Document'} format={format}
        receiptKey={`mnemos-office-create:${location.pathname}:${accountId}:${scope}:${document}:${format}`} onBusy={setBusy}
        onCreated={async () => { const page = await selector.current!.documents(scope, ''); lifetime.current.signal.throwIfAborted(); setDocuments(page.documents); setDocCursor(page.nextCursor) }} />}
      {historyLimited && <p>Показана история в пределах последних 10 000 снимков проекта. Более ранние версии не перечислены.</p>}
      {!resume && writer.current && publication && <WorkshopButton disabled={loading || busy} onClick={() => { void restore() }}>{restoreHead ? (restoreDeleted ? 'Восстановить удалённый документ' : 'Восстановить содержимое в личной версии') : 'Подготовить восстановление в Mnemos'}</WorkshopButton>}
      {!resume && publication.startsWith('private:') && publications.find(p => p.id === publication)?.recordedBy && <p>
        Версию проекта сохранил: {(() => { const author = publications.find(p => p.id === publication)!.recordedBy!; return author.onBehalfOf ? `Агент ${author.actor} от имени ${author.onBehalfOf}` : author.actor })()}
      </p>}
      {!resume && publication.startsWith('private:') && !publications.find(p => p.id === publication)?.actor && writer.current && <WorkshopButton disabled={loading || busy} onClick={() => { void exportOffice() }}>Скачать {format === 'cloudflareos.document' ? 'DOCX' : format === 'cloudflareos.presentation' ? 'PPTX' : 'XLSX'}</WorkshopButton>}
      {!resume && publication.startsWith('private:') && writer.current && <WorkshopButton disabled={loading || busy} onClick={() => { void exportOffice(true) }}>Скачать оригинал</WorkshopButton>}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Загрузка…</p>}
      {preparing && <HistoryPreparingNotice progress={preparing} subject="Публикации документа появятся" />}
      {error && <p role="alert" className="m-0 text-kumo-danger">{error}</p>}
      <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><WorkshopButton className="!h-10 w-full sm:!h-8 sm:w-auto" onClick={close}>Отменить</WorkshopButton>
        <WorkshopButton tone="primary" className="!h-10 w-full sm:!h-8 sm:w-auto" disabled={loading || busy || (!resume && !publication)} onClick={() => { void apply() }}>{busy ? 'Открываю…' : 'Открыть версию'}</WorkshopButton></div>
  </section>
}
