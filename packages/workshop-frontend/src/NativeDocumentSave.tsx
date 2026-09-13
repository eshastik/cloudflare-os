import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@cloudflare/kumo'
import { RpcStub, RpcTarget } from 'capnweb'
import type { ConnectedAccountsSubscriber, GadgetClient } from '@gadgets/workshop-shared/api'
import type { GatekeeperUiFrame, GatekeeperNativeDocumentWriteSelector } from '@gadgets/workshop-shared/gatekeeper'
import type { NativeDocumentFormat } from '@gadgets/workshop-shared/native-document'
import { useAuthenticatedApi } from './AuthContext'
import { WorkshopButton } from './components/WorkshopControls'
import { uploadGatekeeperNativeDocument } from './gatekeeperAppUpload'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import type { NativeSnapshotSourceRef } from './nativeSnapshotSource'

type Creator = Awaited<ReturnType<RpcStub<GatekeeperNativeDocumentWriteSelector>['create']>>
type Writer = Awaited<ReturnType<RpcStub<GatekeeperNativeDocumentWriteSelector>['select']>>

type Props = { gadget: RpcStub<GadgetClient>; format: NativeDocumentFormat; snapshotSource: NativeSnapshotSourceRef; chatId?: number; disabled?: boolean }

export default function NativeDocumentSave(props: Props) {
  const [open, setOpen] = useState(false), [storageKey, setStorageKey] = useState('')
  useEffect(() => {
    let cancelled = false
    setOpen(false); setStorageKey('')
    void props.gadget.getId().then(id => { if (!cancelled) setStorageKey(`mnemos-native-create:${location.pathname}:${id}:${props.format}`) }).catch(() => {})
    return () => { cancelled = true }
  }, [props.gadget, props.chatId, props.format])
  return <>
    <WorkshopButton disabled={props.disabled || !storageKey} onClick={() => setOpen(true)}>Сохранить в Mnemos</WorkshopButton>
    {open && <SaveDialog {...props} storageKey={storageKey} close={() => setOpen(false)} />}
  </>
}

function SaveDialog({ format, snapshotSource, storageKey, close }: Props & { storageKey: string; close(): void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const [scopes, setScopes] = useState<{ id: string; name: string }[]>([])
  const [documents, setDocuments] = useState<{ id: string; name: string }[]>([])
  const [scope, setScope] = useState(''), [resource, setResource] = useState('')
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
  const [accountId, setAccountId] = useState<number | null>(resumeAccount)
  const [resumeReady, setResumeReady] = useState(false)
  const [cursor, setCursor] = useState(''), [truncated, setTruncated] = useState(false)
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [saved, setSaved] = useState(false)
  const selected = useRef<{ writer: Writer; head: string } | null>(null)
  const source = useRef<{ selector: RpcStub<GatekeeperNativeDocumentWriteSelector>; storageOrigin: string } | null>(null)
  const lifetime = useRef(new AbortController())

  useEffect(() => {
    let cancelled = false, subscription: RpcStub<object> | undefined
    class Accounts extends RpcTarget implements ConnectedAccountsSubscriber {
      add(...[id, description, _vendor, _resources, valid, vendorId]: Parameters<ConnectedAccountsSubscriber['add']>) {
        if (cancelled || vendorId !== 'mnemos') return
        setAccounts(old => [...old.filter(a => a.id !== id), { id, name: description.displayName || 'Mnemos', valid }])
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
    source.current = null; setScopes([]); setScope(''); setResumeReady(false); setReady(false)
    if (accountId === null) { setLoading(false); return () => abort.abort() }
    setLoading(true); setError('')
    void (async () => {
      try {
        frame = await authenticatedApi.getGatekeeperApp('mnemos', accountId)
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
          if (!cancelled) setScopes(list.scopes)
        }
      } catch { if (!cancelled) setError('Не удалось подключиться к Mnemos. Проверьте подключение в разделе «Коннекторы».') }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true; abort.abort(); source.current = null; disposeGatekeeperFrame(frame) }
  }, [authenticatedApi, resume, format, accountId])

  useEffect(() => {
    let cancelled = false
    setDocuments([]); setCursor(''); setResource(''); setSaved(false); setError(''); setTruncated(false)
    if (!scope || !source.current) return
    setLoading(true)
    void source.current.selector.documents(scope, '').then(page => {
      if (!cancelled) { setDocuments(page.documents); setCursor(page.nextCursor); setTruncated(page.truncated) }
    }).catch(() => { if (!cancelled) setError('Не удалось прочитать документы проекта.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [scope, accountId])

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
  }, [scope, resource, format, accountId])

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
    } catch {
      if (!signal.aborted) {
        setReady(false)
        setError(isNew ? 'Создание не подтверждено. Повторите сохранение. Если заявка была отправлена, она восстановится после закрытия окна или перезагрузки.' : 'Сохранение не подтверждено. Проверьте личный черновик в Mnemos и заново выберите документ перед повтором.')
      }
    } finally { if (!signal.aborted) setBusy(false) }
  }

  return <Dialog.Root open onOpenChange={value => { if (!value && !busy) close() }}>
    <Dialog className="bg-kumo-base p-5" size="base">
      <Dialog.Title className="text-lg font-medium">Сохранить в личный черновик Mnemos</Dialog.Title>
      <p className="my-3 text-sm text-kumo-subtle">Снимок редактора сохранится в новом или выбранном документе. Общая версия изменится после отдельного согласования и публикации.</p>
      <label className="block my-3">Подключение
        <select aria-label="Подключение для сохранения Mnemos" value={accountId ?? ''} disabled={busy || loading || !!creation.current?.upload || resumeAccount !== null} onChange={e => setAccountId(e.target.value === '' ? null : Number(e.target.value))} className="block w-full border rounded p-2 bg-kumo-base">
          <option value="">Выберите подключение</option>{accounts.map(a => <option key={a.id} value={a.id} disabled={!a.valid}>{a.name}{a.valid ? '' : ' — требуется вход'}</option>)}
        </select>
      </label>
      {resume ? <p className="my-3">Восстановлена незавершённая заявка. Продолжение повторит сохранение прежнего снимка; текущие правки редактора не отправляются.</p> : <>
      <label className="block my-3">Проект
        <select aria-label="Проект Mnemos" value={scope} disabled={busy || loading || !!creation.current?.upload} onChange={e => setScope(e.target.value)} className="block w-full border rounded p-2 bg-kumo-base">
          <option value="">Выберите проект</option>{scopes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label className="block my-3">Документ
        <select aria-label="Документ Mnemos" value={resource} disabled={!scope || busy || loading || !!creation.current?.upload} onChange={e => setResource(e.target.value)} className="block w-full border rounded p-2 bg-kumo-base">
          <option value="">Выберите документ</option><option value="__new__">Создать новый документ</option>{documents.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      {resource === '__new__' && <label className="block my-3">Имя нового документа
        <input aria-label="Имя нового документа" value={name} disabled={busy || !!creation.current?.upload} onChange={e => setName(e.target.value)} className="block w-full border rounded p-2 bg-kumo-base" />
      </label>}
      {cursor && <WorkshopButton disabled={busy || loading} onClick={() => { void more() }}>Ещё документы</WorkshopButton>}
      {truncated && !cursor && <p className="text-sm">Показаны не все документы проекта.</p>}
      </>}
      {loading && <p role="status">Загрузка…</p>}
      {error && <p role="alert" className="my-3 text-sm text-kumo-danger">{error}</p>}
      {saved && <p role="status" className="my-3">Снимок сохранён в личном черновике.</p>}
      <div className="flex justify-end gap-2 mt-4">
        <WorkshopButton disabled={busy} onClick={close}>Закрыть</WorkshopButton>
        <WorkshopButton tone="primary" disabled={(resume ? !resumeReady : resource === '__new__' ? !name.trim() : !ready) || loading || busy || saved} onClick={() => { void save() }}>{busy ? 'Сохранение…' : resume ? 'Продолжить создание' : resource === '__new__' ? 'Создать в личном черновике' : 'Заменить в личном черновике'}</WorkshopButton>
      </div>
    </Dialog>
  </Dialog.Root>
}
