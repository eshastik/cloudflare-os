import { useEffect, useRef, useState } from 'react'
import NativeOfficeImport from './NativeOfficeImport'
import { Dialog } from '@cloudflare/kumo'
import { RpcStub, RpcTarget } from 'capnweb'
import type { ConnectedAccountsSubscriber, GadgetClient } from '@gadgets/workshop-shared/api'
import type { GatekeeperNativeDocumentSelector, GatekeeperNativeDocumentWriteSelector, GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import type { NativeDocumentEditor, NativeDocumentFormat } from '@gadgets/workshop-shared/native-document'
import { downloadGatekeeperOffice } from './gatekeeperAppDownload'
import { useAuthenticatedApi } from './AuthContext'
import { WorkshopButton } from './components/WorkshopControls'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { downloadGatekeeperNativeDocument } from './gatekeeperAppDownload'
import type { NativeSnapshotSourceRef } from './nativeSnapshotSource'

type Pending = { accountId: number; resourceUrl: string; publication: string; revision: number; label: string; format: NativeDocumentFormat; at: number; sourceId?: number }
type Props = { gadget: Pick<RpcStub<GadgetClient>, 'getId' | 'prepareNativeDocumentRead' | 'readNativeDocument' | 'connectToGadget' | 'onRpcBroken'>; format: NativeDocumentFormat; snapshotSource: NativeSnapshotSourceRef; disabled?: boolean; reconnect(): void }
type Item = { id: string; name: string; sharedDeleted?: boolean }
type Publication = { id: string; recordedAt: string; actor: string; onBehalfOf?: string; recordedBy?: {actor: string; onBehalfOf: string}; format: NativeDocumentFormat }

export default function NativeDocumentOpen(props: Props) {
  const [open, setOpen] = useState(false), [key, setKey] = useState(''), [pending, setPending] = useState<Pending | null>(null)
  useEffect(() => {
    let cancelled = false
    setOpen(false); setKey(''); setPending(null)
    void props.gadget.getId().then(id => {
      if (cancelled) return
      const storageKey = `mnemos-native-open:${location.pathname}:${id}`
      setKey(storageKey)
      try {
        const value = JSON.parse(sessionStorage.getItem(storageKey) || 'null')
        if (value && value.format === props.format && Number.isSafeInteger(value.accountId) && Number.isSafeInteger(value.revision) &&
          typeof value.resourceUrl === 'string' && typeof value.publication === 'string' && typeof value.label === 'string' &&
          Number.isFinite(value.at) && Date.now() - value.at >= 0 && Date.now() - value.at < 300000) {
          setPending(value); setOpen(true)
        } else sessionStorage.removeItem(storageKey)
      } catch { /* An invalid local resume hint conveys no authority. */ }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [props.gadget, props.format])
  function close() { sessionStorage.removeItem(key); setPending(null); setOpen(false) }
  return <>
    <WorkshopButton disabled={props.disabled || !key} onClick={() => setOpen(true)}>Открыть из Mnemos</WorkshopButton>
    {open && <OpenDialog {...props} storageKey={key} resume={pending} close={close} />}
  </>
}

function OpenDialog({ gadget, format, snapshotSource, reconnect, storageKey, resume, close }: Props & { storageKey: string; resume: Pending | null; close(): void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const [accounts, setAccounts] = useState<{ id: number; name: string; valid: boolean }[]>([])
  const [accountId, setAccountId] = useState<number | null>(null)
  const [scopes, setScopes] = useState<Item[]>([]), [documents, setDocuments] = useState<Item[]>([])
  const [scope, setScope] = useState(''), [document, setDocument] = useState(''), [publication, setPublication] = useState('')
  const [publications, setPublications] = useState<Publication[]>([]), [resourceUrl, setResourceUrl] = useState('')
  const [historyLimited,setHistoryLimited]=useState(false)
  const [docCursor, setDocCursor] = useState(''), [pubCursor, setPubCursor] = useState(''), [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(!resume), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const selector = useRef<RpcStub<GatekeeperNativeDocumentSelector> | null>(null)
  const storageOrigin = useRef('')
  const writer = useRef<RpcStub<GatekeeperNativeDocumentWriteSelector> | null>(null)
  const [restoreDeleted, setRestoreDeleted] = useState(false)
  const [sharedDeleted, setSharedDeleted] = useState<boolean | undefined>()
  const [restoreHead, setRestoreHead] = useState(''), [notice, setNotice] = useState('')
  useEffect(() => { setRestoreHead(''); setNotice('') }, [accountId, scope, document, publication])
  const lifetime = useRef(new AbortController())
  useEffect(() => { const abort = new AbortController(); lifetime.current = abort; return () => abort.abort() }, [])
  useEffect(() => {
    if (resume) return
    let cancelled = false, subscription: RpcStub<object> | undefined
    class Accounts extends RpcTarget implements ConnectedAccountsSubscriber {
      add(...[id, description, _vendor, _resources, valid, vendorId]: Parameters<ConnectedAccountsSubscriber['add']>) {
        if (cancelled || vendorId !== 'mnemos') return
        setAccounts(old => [...old.filter(a => a.id !== id), { id, name: description.displayName || 'Mnemos', valid }])
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
    selector.current = null; writer.current = null; storageOrigin.current = ''; setRestoreHead(''); setScopes([]); setScope('')
    if (accountId === null) { setLoading(false); return }
    setLoading(true); setError('')
    void (async () => {
      try {
        frame = await authenticatedApi.getGatekeeperApp('mnemos', accountId)
        if (cancelled) { disposeGatekeeperFrame(frame); return }
        if (!frame?.nativeDownloads) throw new Error()
        selector.current = frame.nativeDownloads.selector as RpcStub<GatekeeperNativeDocumentSelector>
        writer.current = frame.nativeWrites?.selector as RpcStub<GatekeeperNativeDocumentWriteSelector> | undefined || null
        storageOrigin.current = frame.nativeWrites?.storageOrigin || ''
        const page = await selector.current.scopes()
        if (!cancelled) setScopes(page.scopes)
      } catch { if (!cancelled) setError('Подключение недоступно. Переподключите Mnemos в «Коннекторах».') }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true; selector.current = null; writer.current = null; disposeGatekeeperFrame(frame) }
  }, [authenticatedApi, accountId])
  useEffect(() => {
    let cancelled = false
    setDocuments([]); setDocument(''); setDocCursor(''); setTruncated(false)
    if (!scope || !selector.current) return
    setLoading(true); setError('')
    void selector.current.documents(scope, '').then(page => {
      if (!cancelled) { setDocuments(page.documents); setDocCursor(page.nextCursor); setTruncated(page.truncated) }
    }).catch(() => { if (!cancelled) setError('Не удалось прочитать документы.') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [scope, accountId])
  useEffect(() => {
    let cancelled = false
    setPublications([]); setPublication(''); setPubCursor(''); setHistoryLimited(false); setResourceUrl(''); setSharedDeleted(undefined)
    if (!scope || !document || !selector.current) return
    if (/\.(docx|xlsx)$/i.test(documents.find(d => d.id === document)?.name || '')) return
    setLoading(true); setError('')
    void selector.current.publications(scope, document, '').then(page => {
      if (!cancelled) { setPublications(page.publications.filter(p => p.format === format)); setPubCursor(page.nextCursor); setHistoryLimited(old=>old||!!page.historyLimited); setResourceUrl(page.resourceUrl); setSharedDeleted(page.sharedDeleted) }
    }).catch(() => { if (!cancelled) setError('Не удалось прочитать публикации.') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [scope, document, accountId, format])
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
      const name = (documents.find(d => d.id === document)?.name || 'Document').replace(/\.(cfdoc|cfsheet|cfslides)$/i, '').replace(/[\/\\\u0000-\u001f]/g, '_') + (original ? ' — оригинал' : '') + suffix
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
    const signal = lifetime.current.signal
    setBusy(true); setError('')
    try {
      const flush = snapshotSource.current
      if (!flush) throw new Error()
      const current = await flush(format, signal), revision = current.document.revision
      if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || (resume && resume.revision !== revision)) throw new Error()
      const intent: Pending = resume ?? { accountId: accountId!, resourceUrl, publication, revision, label: documents.find(d => d.id === document)?.name || 'Документ', format, at: Date.now() }
      signal.throwIfAborted()
      sessionStorage.setItem(storageKey, JSON.stringify(intent))
      const prepared = await gadget.prepareNativeDocumentRead(intent.accountId, intent.resourceUrl, intent.publication)
      signal.throwIfAborted()
      sessionStorage.setItem(storageKey, JSON.stringify({ ...intent, sourceId: prepared.sourceId }))
      if (prepared.restartRequired) {
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
      const read = await gadget.readNativeDocument(prepared.sourceId)
      try {
        const ticket = await read.download.issue()
        const snapshot = await downloadGatekeeperNativeDocument(read.storageOrigin, ticket, format, signal, () => read.download.validate())
        const editor = await gadget.connectToGadget() as RpcStub<NativeDocumentEditor>
        try {
          await read.download.validate(); signal.throwIfAborted()
          await editor.restoreDocumentSnapshot(snapshot, revision)
        } finally { editor[Symbol.dispose]() }
      } finally { read[Symbol.dispose]() }
      signal.throwIfAborted(); close(); reconnect()
    } catch {
      if (!signal.aborted) setError('Открытие не подтверждено. Документ мог измениться или доступ недоступен. Закройте диалог и выберите публикацию заново; после переподключения можно продолжить сохранённый выбор.')
    } finally { if (!signal.aborted) setBusy(false) }
  }
  return <Dialog.Root open onOpenChange={value => { if (!value && !busy) close() }}>
    <Dialog className="bg-kumo-base p-5" size="base">
      <Dialog.Title className="text-lg font-medium">Открыть из Mnemos</Dialog.Title>
      <p className="my-3 text-sm">Опубликованная версия заменит содержимое этого редактора. При первом подключении пространство переподключится для проверки доступа. Участникам нужно завершить ввод и дождаться сохранения правок.</p>
      {resume ? <p className="my-3">Продолжить открытие: {resume.label}</p> : <>
        <label className="block my-2">Подключение<select aria-label="Подключение Mnemos" className="block w-full border rounded p-2 bg-kumo-base" disabled={loading || busy} value={accountId ?? ''} onChange={e => setAccountId(e.target.value === '' ? null : Number(e.target.value))}>
          <option value="">Выберите подключение</option>{accounts.map(a => <option key={a.id} value={a.id} disabled={!a.valid}>{a.name}{a.valid ? '' : ' — нужно переподключить'}</option>)}</select></label>
        <label className="block my-2">Проект<select aria-label="Проект для открытия" className="block w-full border rounded p-2 bg-kumo-base" disabled={loading || busy || accountId === null} value={scope} onChange={e => setScope(e.target.value)}>
          <option value="">Выберите проект</option>{scopes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="block my-2">Документ<select aria-label="Документ для открытия" className="block w-full border rounded p-2 bg-kumo-base" disabled={loading || busy || !scope} value={document} onChange={e => setDocument(e.target.value)}>
          <option value="">Выберите документ</option>{documents.map(d => <option key={d.id} value={d.id}>{d.name}{d.sharedDeleted ? " — удалён из общей версии" : ""}</option>)}</select></label>
        {docCursor && <WorkshopButton disabled={loading || busy} onClick={() => { void more('documents') }}>Ещё документы</WorkshopButton>}
        {truncated && !docCursor && <p className="text-sm">Показаны не все документы.</p>}
        {sharedDeleted === true && <p role="status">Документ удалён из общей версии. Ниже доступны сохранённые версии: их можно открыть или восстановить в личную версию. Для возвращения в общую версию потребуется публикация.</p>}
        <label className="block my-2">Публикация<select aria-label="Публикация Mnemos" className="block w-full border rounded p-2 bg-kumo-base" disabled={loading || busy || !document} value={publication} onChange={e => setPublication(e.target.value)}>
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
      {error && <p role="alert" className="my-3 text-sm text-kumo-danger">{error}</p>}
      <div className="flex justify-end gap-2 mt-4"><WorkshopButton disabled={busy} onClick={close}>Отмена</WorkshopButton>
        <WorkshopButton tone="primary" disabled={loading || busy || (!resume && !publication)} onClick={() => { void apply() }}>{busy ? 'Открытие…' : 'Заменить содержимое редактора'}</WorkshopButton></div>
    </Dialog>
  </Dialog.Root>
}
