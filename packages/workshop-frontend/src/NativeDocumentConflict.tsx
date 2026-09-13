import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@cloudflare/kumo'
import type { RpcStub } from 'capnweb'
import type { GatekeeperNativeConflict, GatekeeperNativeDocumentWriteSelector, GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import type { NativeDocumentFormat, NativeDocumentSnapshot } from '@gadgets/workshop-shared/native-document'
import { useAuthenticatedApi } from './AuthContext'
import { WorkshopButton } from './components/WorkshopControls'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { downloadGatekeeperNativeDocument } from './gatekeeperAppDownload'
import NativeReviewSnapshot, { parseNativeReview } from './NativeReviewSnapshot'

type Props = { context: object; format: NativeDocumentFormat; disabled?: boolean }
type View = Awaited<ReturnType<GatekeeperNativeConflict['describe']>>
type Item = { id: string; name: string; sharedDeleted?: boolean }

export default function NativeDocumentConflict(props: Props) {
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [props.context, props.format])
  return <>
    <WorkshopButton disabled={props.disabled} onClick={() => setOpen(true)}>Конфликты Mnemos</WorkshopButton>
    {open && <ConflictDialog format={props.format} close={() => setOpen(false)} />}
  </>
}

function ConflictDialog({ format, close }: { format: NativeDocumentFormat; close(): void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const source = useRef<RpcStub<GatekeeperNativeDocumentWriteSelector> | null>(null)
  const selected = useRef<Awaited<ReturnType<RpcStub<GatekeeperNativeDocumentWriteSelector>['selectConflict']>> | null>(null)
  const origin = useRef(''), lifetime = useRef(new AbortController()), working = useRef(true)
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [scopes, setScopes] = useState<Item[]>([]), [documents, setDocuments] = useState<Item[]>([])
  const [scope, setScope] = useState(''), [node, setNode] = useState(''), [cursor, setCursor] = useState('')
  const [location, setLocation] = useState<{ head: string; name: string; parent: string } | null>(null)
  const [newName, setNewName] = useState(''), [newParent, setNewParent] = useState('')
  const [folders, setFolders] = useState<Item[]>([]), [folderCursor, setFolderCursor] = useState('')
  const [deleteHead, setDeleteHead] = useState('')
  const [updateHead, setUpdateHead] = useState('')
  const [view, setView] = useState<View | null>(null)
  const [previews, setPreviews] = useState<Record<number, NativeDocumentSnapshot | null>>({})
  const reset = () => { selected.current?.[Symbol.dispose](); selected.current = null; setView(null); setPreviews({}); setUpdateHead(''); setDeleteHead(''); setLocation(null); setFolders([]); setFolderCursor('') }
  useEffect(() => {
    const abort = new AbortController(); lifetime.current = abort
    let frame: GatekeeperUiFrame | null = null
    void (async () => {
      try {
        frame = await authenticatedApi.getGatekeeperApp('mnemos')
        if (abort.signal.aborted) { disposeGatekeeperFrame(frame); return }
        if (!frame?.nativeWrites) throw new Error()
        source.current = frame.nativeWrites.selector as RpcStub<GatekeeperNativeDocumentWriteSelector>
        origin.current = frame.nativeWrites.storageOrigin
        const page = await source.current.scopes(); abort.signal.throwIfAborted(); setScopes(page.scopes)
      } catch { if (!abort.signal.aborted) setError('Подключение Mnemos недоступно.') }
      finally { if (!abort.signal.aborted) { working.current = false; setBusy(false) } }
    })()
    return () => { abort.abort(); selected.current?.[Symbol.dispose](); selected.current = null; source.current = null; disposeGatekeeperFrame(frame) }
  }, [authenticatedApi])
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (working.current || !source.current) return
    working.current = true; setBusy(true); setError(''); setNotice('')
    const signal = lifetime.current.signal
    try { await action(signal) }
    catch { if (!signal.aborted) { reset(); setError('Результат не подтверждён. Перечитайте конфликт и проверьте личную версию перед новой попыткой: могли измениться права или документ.') } }
    finally { if (!signal.aborted) { working.current = false; setBusy(false) } }
  }
  async function loadConflict(signal: AbortSignal) {
    reset()
    const conflict = await source.current!.selectConflict(scope, node, format)
    if (signal.aborted) { conflict[Symbol.dispose](); return }
    selected.current = conflict
    const result = await conflict.describe(); signal.throwIfAborted(); setView(result)
  }
  const reviewed = !!view && view.terms.every((term, index) => term.negative || Object.hasOwn(previews, index))
  return <Dialog.Root open onOpenChange={value => { if (!value && !busy) close() }}><Dialog className="bg-kumo-base p-5" size="base">
    <Dialog.Title>Конфликт личной версии</Dialog.Title>
    <p className="my-3">Просмотрите все варианты перед выбором. Сохраняются содержимое, имя и расположение выбранной стороны. После разрешения откройте личную версию и отправьте изменения на согласование.</p>
    <label>Проект<select aria-label="Проект конфликта" disabled={busy} value={scope} onChange={e => {
      const project = e.target.value; setScope(project); setNode(''); setDocuments([]); setCursor(''); reset()
      if (project) void run(async signal => { const page = await source.current!.documents(project, ''); signal.throwIfAborted(); setDocuments(page.documents); setCursor(page.nextCursor) })
    }}><option value="">Выберите проект</option>{scopes.map(item => <option key={item.id} value={item.id}>{item.name}{item.sharedDeleted ? " — удалён из общей версии" : ""}</option>)}</select></label>
    <p>Общие правки переносятся в личную версию всего проекта. Сначала сохраните изменения редактора в Mnemos; после переноса откройте личную версию заново.</p>
    <WorkshopButton disabled={busy || !scope} onClick={() => { void run(async signal => {
      reset()
      const state = await source.current!.publicationState(scope); signal.throwIfAborted()
      if (!state.personal_exists) { setNotice('Сначала создайте или сохраните личную версию проекта.'); return }
      setUpdateHead(state.personal_head)
    }) }}>Подготовить получение общих правок</WorkshopButton>
    {updateHead && <WorkshopButton disabled={busy} onClick={() => { void run(async signal => {
      const expected = updateHead; reset()
      await source.current!.updateDraft(scope, expected); signal.throwIfAborted()
      setNotice('Общие правки перенесены в личную версию. Выберите документ и перечитайте конфликт либо откройте личную версию в редакторе.')
    }) }}>Получить общие правки</WorkshopButton>}
    <label>Документ<select aria-label="Документ конфликта" disabled={busy || !scope} value={node} onChange={e => { setNode(e.target.value); reset() }}><option value="">Выберите документ</option>{documents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {cursor && <WorkshopButton disabled={busy} onClick={() => { void run(async signal => {
      const page = await source.current!.documents(scope, cursor); signal.throwIfAborted()
      setDocuments(old => [...new Map([...old, ...page.documents].map(item => [item.id, item])).values()]); setCursor(page.nextCursor)
    }) }}>Ещё документы</WorkshopButton>}
    <WorkshopButton disabled={busy || !node} onClick={() => { void run(async signal => {
      reset()
      const value = await source.current!.documentLocation(scope, node, format); signal.throwIfAborted()
      const page = await source.current!.folders(scope, ''); signal.throwIfAborted()
      setLocation(value); setNewName(value.name); setNewParent(value.parent); setFolders(page.folders); setFolderCursor(page.nextCursor)
    }) }}>Изменить имя и папку</WorkshopButton>
    <WorkshopButton disabled={busy || !node} onClick={() => { void run(async signal => {
      reset()
      const state = await source.current!.restorationState(scope, node, format); signal.throwIfAborted()
      if (state.deleted) throw new Error('Already deleted')
      setDeleteHead(state.head)
    }) }}>Подготовить удаление документа</WorkshopButton>
    {deleteHead && <section className="my-3 border p-2">
      <p>Удалить «{documents.find(document => document.id === node)?.name || 'выбранный документ'}» из личной версии? Общая версия и история сохранятся. Для общего удаления потребуется согласование и публикация.</p>
      <WorkshopButton disabled={busy} onClick={() => { void run(async signal => {
        const expected = deleteHead; reset()
        await source.current!.deleteDocument(scope, node, expected, format); signal.throwIfAborted()
        setNotice('Документ удалён из личной версии. Для восстановления выберите опубликованную версию в «Открыть из Mnemos». Для общего удаления отправьте изменения на согласование.')
      }) }}>Удалить из личной версии</WorkshopButton>
    </section>}
    {location && <section className="my-3 border p-2">
      <label>Имя<input aria-label="Новое имя документа" value={newName} disabled={busy} onChange={e => setNewName(e.target.value)} /></label>
      <label>Папка<select aria-label="Новая папка документа" value={newParent} disabled={busy} onChange={e => setNewParent(e.target.value)}>
        <option value="">Корень проекта</option>
        {location.parent && !folders.some(f => f.id === location.parent) && <option value={location.parent}>Текущая папка</option>}
        {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select></label>
      {folderCursor && <WorkshopButton disabled={busy} onClick={() => { void run(async signal => {
        const page = await source.current!.folders(scope, folderCursor); signal.throwIfAborted()
        setFolders(old => [...new Map([...old, ...page.folders].map(f => [f.id, f])).values()]); setFolderCursor(page.nextCursor)
      }) }}>Ещё папки</WorkshopButton>}
      <WorkshopButton disabled={busy || !newName.trim()} onClick={() => { void run(async signal => {
        const expected = location.head; reset()
        await source.current!.saveLocation(scope, node, expected, newName, newParent, format); signal.throwIfAborted()
        setNotice('Имя и папка сохранены в личной версии. Для общей версии отправьте изменения на согласование.')
      }) }}>Сохранить имя и папку</WorkshopButton>
    </section>}
    <WorkshopButton disabled={busy || !node} onClick={() => { void run(loadConflict) }}>Перечитать конфликт</WorkshopButton>
    {view?.terms.map((term, index) => <section className="my-3 border p-2" key={`${view.head}:${index}`}>
      <h3>{term.negative ? 'Базовая версия' : `Вариант ${index / 2 + 1}`}{!term.present ? ' — удаление' : ''}</h3>
      {term.metadata && <p>{term.metadata.name} · Папка: {term.metadata.parent_id || 'Корень проекта'} · {term.metadata.content_type}</p>}
      <WorkshopButton disabled={busy} onClick={() => { void run(async signal => {
        const conflict = selected.current!
        const ticket = await conflict.download(index); signal.throwIfAborted()
        const snapshot = ticket ? await downloadGatekeeperNativeDocument(origin.current, { ...ticket, content_type: `application/vnd.${format}+json` }, format, signal, () => conflict.validate()) : null
        if (snapshot) parseNativeReview(snapshot)
        await conflict.validate(); signal.throwIfAborted(); setPreviews(old => ({ ...old, [index]: snapshot }))
      }) }}>Просмотреть {term.negative ? 'базу' : `вариант ${index / 2 + 1}`}</WorkshopButton>
      {Object.hasOwn(previews, index) && (previews[index] ? <NativeReviewSnapshot snapshot={previews[index]!} /> : <p>Документ отсутствует на этой стороне.</p>)}
      {!term.negative && <WorkshopButton disabled={busy || !reviewed} onClick={() => { void run(async signal => {
        await selected.current!.resolve(index); signal.throwIfAborted(); reset()
        setNotice('Выбранная сторона сохранена в личной версии. Общая версия не опубликована.')
      }) }}>{term.present ? `Сохранить вариант ${index / 2 + 1}` : 'Подтвердить удаление'}</WorkshopButton>}
    </section>)}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{busy && <p role="status">Загрузка…</p>}
    <WorkshopButton disabled={busy} onClick={close}>Закрыть</WorkshopButton>
  </Dialog></Dialog.Root>
}
