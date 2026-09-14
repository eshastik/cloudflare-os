import { useEffect, useRef, useState } from 'react'
import { RpcStub, RpcTarget } from 'capnweb'
import type { ConnectedAccountsSubscriber, GadgetClient } from '@gadgets/workshop-shared/api'
import type { GatekeeperUiFrame, GatekeeperNativeDocumentWriteSelector } from '@gadgets/workshop-shared/gatekeeper'
import type { NativeDocumentFormat } from '@gadgets/workshop-shared/native-document'
import { useAuthenticatedApi } from './AuthContext'
import { WorkshopButton } from './components/WorkshopControls'
import { uploadGatekeeperNativeDocument } from './gatekeeperAppUpload'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { openNativeWritesFrame, storesDocuments } from './accountCapabilities'
import type { NativeSnapshotSourceRef } from './nativeSnapshotSource'

type Creator = Awaited<ReturnType<RpcStub<GatekeeperNativeDocumentWriteSelector>['create']>>
type Writer = Awaited<ReturnType<RpcStub<GatekeeperNativeDocumentWriteSelector>['select']>>

/** Куда и с какой ревизией редактора ушло сохранение; пустой resource — новый документ, чей адрес сервер не вернул. */
export type NativeSaveResult = { accountId: number; scope: string; resource: string; revision?: number }
type Props = {
  gadget: RpcStub<GadgetClient>; format: NativeDocumentFormat; snapshotSource: NativeSnapshotSourceRef; chatId?: number; disabled?: boolean
  initialAccountId?: number; initialScope?: string; initialResource?: string; onSaved?(result: NativeSaveResult): void; onClose?(): void
}

const selectClass = 'block w-full border border-kumo-line rounded-lg p-2 bg-kumo-base'

export default function NativeDocumentSave({ onClose, ...props }: Props) {
  const [closed, setClosed] = useState(false), [storageKey, setStorageKey] = useState('')
  useEffect(() => {
    let cancelled = false
    setClosed(false); setStorageKey('')
    void props.gadget.getId().then(id => { if (!cancelled) setStorageKey(`mnemos-native-create:${location.pathname}:${id}:${props.format}`) }).catch(() => {})
    return () => { cancelled = true }
  }, [props.gadget, props.chatId, props.format])
  if (closed || !storageKey) return null
  return <SaveSection {...props} storageKey={storageKey} close={() => { setClosed(true); onClose?.() }} />
}

function SaveSection({ format, snapshotSource, storageKey, initialAccountId, initialScope, initialResource, onSaved, close }: Omit<Props, 'onClose'> & { storageKey: string; close(): void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const [scopes, setScopes] = useState<{ id: string; name: string }[]>([])
  const [documents, setDocuments] = useState<{ id: string; name: string }[]>([])
  const [scope, setScope] = useState(initialScope ?? ''), [resource, setResource] = useState(initialResource ?? '')
  const [name, setName] = useState('')
  const creation = useRef<{ writer: Creator; head: string; upload?: string; receipt?: string } | null>(null)
  const [resume] = useState(() => { try { return sessionStorage.getItem(storageKey) || '' } catch { return '' } })
  const [resumeAccount] = useState<number | null>(() => {
    try {
      const value = sessionStorage.getItem(`${storageKey}:account`)
      return resume && value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null
    } catch { return null }
  })
  const [accounts, setAccounts] = useState<{ id: number; name: string; valid: boolean }[]>([])
  const [accountId, setAccountId] = useState<number | null>(resumeAccount ?? initialAccountId ?? null)
  const [resumeReady, setResumeReady] = useState(false)
  const [cursor, setCursor] = useState(''), [truncated, setTruncated] = useState(false)
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [saved, setSaved] = useState(false)
  // Счётчик подключений: эффекты выбора проекта и документа должны перезапуститься, когда селектор появился позже их первого запуска.
  const [sourceVersion, setSourceVersion] = useState(0)
  const selected = useRef<{ writer: Writer; head: string } | null>(null)
  const source = useRef<{ selector: RpcStub<GatekeeperNativeDocumentWriteSelector>; storageOrigin: string } | null>(null)
  const lifetime = useRef(new AbortController())

  useEffect(() => {
    let cancelled = false, subscription: RpcStub<object> | undefined
    class Accounts extends RpcTarget implements ConnectedAccountsSubscriber {
      add(...[id, description, _vendor, resources, valid, vendorId]: Parameters<ConnectedAccountsSubscriber['add']>) {
        if (cancelled || !storesDocuments({ description, supportedResources: resources })) return
        setAccounts(old => [...old.filter(a => a.id !== id), { id, name: description.displayName || description.uniqueName || vendorId, valid }])
      }
      remove(id: number) {
        if (!cancelled) { setAccounts(old => old.filter(a => a.id !== id)); setAccountId(old => old === id ? null : old) }
      }
      ready() { if (!cancelled) setLoading(false) }
    }
    void authenticatedApi.subscribeConnectedAccounts(new Accounts()).then(value => {
      if (cancelled) value[Symbol.dispose](); else subscription = value
    }).catch(() => { if (!cancelled) { setLoading(false); setError('Не удалось прочитать подключения.') } })
    return () => { cancelled = true; subscription?.[Symbol.dispose]() }
  }, [authenticatedApi])

  useEffect(() => {
    let cancelled = false, frame: GatekeeperUiFrame | null = null
    const abort = new AbortController(); lifetime.current = abort
    source.current = null; setScopes([]); setResumeReady(false); setReady(false)
    if (accountId === null) { setLoading(false); return () => abort.abort() }
    setLoading(true); setError('')
    void (async () => {
      try {
        frame = await openNativeWritesFrame(authenticatedApi, accountId)
        if (cancelled) { disposeGatekeeperFrame(frame); return }
        if (!frame?.nativeWrites) throw new Error()
        const selector = frame.nativeWrites.selector as RpcStub<GatekeeperNativeDocumentWriteSelector>
        source.current = { selector, storageOrigin: frame.nativeWrites.storageOrigin }
        if (resume) {
          const restored = await selector.resumeCreation(resume, format)
          if (cancelled) { restored[Symbol.dispose](); return }
          try {
            const state = await restored.recoveryState()
            if (cancelled) { restored[Symbol.dispose](); return }
            creation.current = { writer: restored, head: state.head, upload: state.uploadId, receipt: resume }
            setResumeReady(true)
          } catch (error) { restored[Symbol.dispose](); throw error }
        } else {
          const list = await selector.scopes()
          if (!cancelled) { setScopes(list.scopes); setSourceVersion(v => v + 1) }
        }
      } catch { if (!cancelled) setError('Не удалось открыть подключение. Проверьте его в разделе «Подключения».') }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true; abort.abort(); source.current = null; disposeGatekeeperFrame(frame) }
  }, [authenticatedApi, resume, format, accountId])

  useEffect(() => {
    let cancelled = false
    setDocuments([]); setCursor(''); setSaved(false); setError(''); setTruncated(false)
    // Предвыбранный документ переживает ожидание селектора и первую загрузку списка; смена проекта руками его сбрасывает.
    setResource(old => old === initialResource && scope === initialScope ? old : '')
    if (!scope || !source.current) return
    setLoading(true)
    void source.current.selector.documents(scope, '').then(page => {
      if (!cancelled) { setDocuments(page.documents); setCursor(page.nextCursor); setTruncated(page.truncated) }
    }).catch(() => { if (!cancelled) setError('Не удалось прочитать документы проекта.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [scope, accountId, sourceVersion])

  useEffect(() => {
    let cancelled = false, writer: Writer | undefined
    setReady(false); selected.current = null; setSaved(false)
    if (!scope || !resource || resource === "__new__" || !source.current) return
    setLoading(true); setError('')
    void (async () => {
      try {
        writer = await source.current!.selector.select(scope, resource, format)
        if (cancelled) { writer[Symbol.dispose](); return }
        const head = await writer.head()
        if (!cancelled) { selected.current = { writer, head }; setReady(true) }
      } catch { if (!cancelled) setError('Нужен существующий документ того же нативного формата без конфликта и с правом записи.') }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true; selected.current = null; writer?.[Symbol.dispose]() }
  }, [scope, resource, format, accountId, sourceVersion])

  useEffect(() => {
    setSaved(false)
    return () => { creation.current?.writer[Symbol.dispose](); creation.current = null }
  }, [scope, resource, name, format, accountId])

  async function more() {
    if (!source.current || !cursor || loading) return
    setLoading(true)
    try {
      const page = await source.current.selector.documents(scope, cursor)
      lifetime.current.signal.throwIfAborted()
      setDocuments(old => [...new Map([...old, ...page.documents].map(d => [d.id, d])).values()])
      setCursor(page.nextCursor); setTruncated(page.truncated)
    } catch { if (!lifetime.current.signal.aborted) setError('Не удалось прочитать следующую страницу.') }
    finally { if (!lifetime.current.signal.aborted) setLoading(false) }
  }

  async function save() {
    const isNew = !!resume || resource === '__new__'
    if (accountId === null || !source.current || busy || (isNew ? (resume ? !resumeReady : !name.trim()) : !selected.current || !ready)) return
    const { storageOrigin } = source.current
    const signal = lifetime.current.signal
    setBusy(true); setError('')
    let revision: number | undefined
    try {
      if (isNew && !creation.current) {
        const writer = await source.current!.selector.create(scope, name.trim(), format)
        if (signal.aborted) { writer[Symbol.dispose](); return }
        try {
          const head = await writer.head()
          if (signal.aborted) { writer[Symbol.dispose](); return }
          creation.current = { writer, head }
        } catch (error) { writer[Symbol.dispose](); throw error }
      }
      const target = isNew ? creation.current! : selected.current!
      const { writer, head } = target
      let upload = isNew ? creation.current!.upload : undefined
      if (!upload) {
        const read = snapshotSource.current
        if (!read) throw new Error('Editor is not ready')
        const snapshot = await read(format, signal)
        signal.throwIfAborted()
        const current = (snapshot.document as { revision?: unknown }).revision
        if (typeof current === 'number' && Number.isSafeInteger(current)) revision = current
        upload = await uploadGatekeeperNativeDocument(snapshot, format, storageOrigin,
          (size, checksum) => writer.issue(head, size, checksum), signal)
        signal.throwIfAborted()
        if (isNew) creation.current!.upload = upload
      }
      if (isNew) {
        const pending = creation.current!
        pending.receipt ??= await pending.writer.checkpoint(head, upload)
        signal.throwIfAborted()
        // Persist before creation: a lost save response can then be retried after reload.
        sessionStorage.setItem(`${storageKey}:account`, String(accountId))
        sessionStorage.setItem(storageKey, pending.receipt)
      }
      await writer.save(head, upload)
      signal.throwIfAborted()
      if (isNew) { sessionStorage.removeItem(storageKey); sessionStorage.removeItem(`${storageKey}:account`) }
      setReady(false); setSaved(true)
      onSaved?.({ accountId, scope, resource: isNew ? '' : resource, revision })
    } catch {
      if (!signal.aborted) {
        setReady(false)
        setError(isNew ? 'Создание не подтверждено. Повторите сохранение. Если заявка была отправлена, она восстановится после закрытия раздела или перезагрузки.' : 'Сохранение не подтверждено. Проверьте личный черновик в Mnemos и заново выберите документ перед повтором.')
      }
    } finally { if (!signal.aborted) setBusy(false) }
  }

  return <section className="flex flex-col gap-2 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default">
    <p className="m-0 text-[12px] leading-4 text-kumo-subtle">Снимок редактора сохранится в новом или выбранном документе. Общая версия изменится после отдельного согласования и публикации.</p>
    <label className="block">Подключение
      <select aria-label="Подключение для сохранения" value={accountId ?? ''} disabled={busy || loading || !!creation.current?.upload || resumeAccount !== null} onChange={e => setAccountId(e.target.value === '' ? null : Number(e.target.value))} className={selectClass}>
        <option value="">Выберите подключение</option>{accounts.map(a => <option key={a.id} value={a.id} disabled={!a.valid}>{a.name}{a.valid ? '' : ' — требуется вход'}</option>)}
      </select>
    </label>
    {resume ? <p className="m-0">Восстановлена незавершённая заявка. Продолжение повторит сохранение прежнего снимка; текущие правки редактора не отправляются.</p> : <>
    <label className="block">Проект
      <select aria-label="Проект" value={scope} disabled={busy || loading || !!creation.current?.upload} onChange={e => setScope(e.target.value)} className={selectClass}>
        <option value="">Выберите проект</option>{scopes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </label>
    <label className="block">Документ
      <select aria-label="Документ" value={resource} disabled={!scope || busy || loading || !!creation.current?.upload} onChange={e => setResource(e.target.value)} className={selectClass}>
        <option value="">Выберите документ</option><option value="__new__">Создать новый документ</option>{documents.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </label>
    {resource === '__new__' && <label className="block">Имя нового документа
      <input aria-label="Имя нового документа" value={name} disabled={busy || !!creation.current?.upload} onChange={e => setName(e.target.value)} className={selectClass} />
    </label>}
    {cursor && <WorkshopButton disabled={busy || loading} onClick={() => { void more() }}>Ещё документы</WorkshopButton>}
    {truncated && !cursor && <p className="m-0 text-[12px] leading-4 text-kumo-subtle">Показаны не все документы проекта.</p>}
    </>}
    {loading && <p role="status" className="m-0 text-kumo-subtle">Загрузка…</p>}
    {error && <p role="alert" className="m-0 text-kumo-danger">{error}</p>}
    {saved && <p role="status" className="m-0">Снимок сохранён в личном черновике.</p>}
    <div className="flex justify-end gap-2 mt-1">
      <WorkshopButton disabled={busy} onClick={close}>Закрыть</WorkshopButton>
      <WorkshopButton tone="primary" className="!h-8" disabled={(resume ? !resumeReady : resource === '__new__' ? !name.trim() : !ready) || loading || busy || saved} onClick={() => { void save() }}>{busy ? 'Сохранение…' : resume ? 'Продолжить создание' : resource === '__new__' ? 'Создать в личном черновике' : 'Заменить в личном черновике'}</WorkshopButton>
    </div>
  </section>
}
