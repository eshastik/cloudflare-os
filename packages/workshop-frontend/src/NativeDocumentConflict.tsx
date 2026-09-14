import { useEffect, useRef, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { GatekeeperNativeConflict, GatekeeperNativeDocumentWriteSelector, GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import type { NativeDocumentFormat, NativeDocumentSnapshot } from '@gadgets/workshop-shared/native-document'
import { useAuthenticatedApi } from './AuthContext'
import { WorkshopButton } from './components/WorkshopControls'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { openNativeWritesFrame } from './accountCapabilities'
import { downloadGatekeeperNativeDocument } from './gatekeeperAppDownload'
import NativeReviewSnapshot, { parseNativeReview } from './NativeReviewSnapshot'

type Props = { format: NativeDocumentFormat; initialScope?: string; initialResource?: string; onResolved?(): void; onClose?(): void }
type View = Awaited<ReturnType<GatekeeperNativeConflict['describe']>>
type Item = { id: string; name: string; sharedDeleted?: boolean }

export default function NativeDocumentConflict({ onClose, ...props }: Props) {
  const [closed, setClosed] = useState(false)
  if (closed) return null
  return <ConflictSection {...props} close={() => { setClosed(true); onClose?.() }} />
}

const selectClass = 'block w-full border border-kumo-line rounded-lg p-2 bg-kumo-base'

function ConflictSection({ format, initialScope, initialResource, onResolved, close }: Omit<Props, 'onClose'> & { close(): void }) {
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
        frame = await openNativeWritesFrame(authenticatedApi)
        if (abort.signal.aborted) { disposeGatekeeperFrame(frame); return }
        if (!frame?.nativeWrites) throw new Error()
        source.current = frame.nativeWrites.selector as RpcStub<GatekeeperNativeDocumentWriteSelector>
        origin.current = frame.nativeWrites.storageOrigin
        const page = await source.current.scopes(); abort.signal.throwIfAborted(); setScopes(page.scopes)
        if (initialScope) {
          setScope(initialScope)
          const list = await source.current.documents(initialScope, ''); abort.signal.throwIfAborted()
          setDocuments(list.documents); setCursor(list.nextCursor)
          if (initialResource) { setNode(initialResource); await loadConflict(abort.signal, initialScope, initialResource) }
        }
      } catch { if (!abort.signal.aborted) setError(source.current ? 'Конфликт не прочитан. Выберите документ и перечитайте конфликт.' : 'Подключение хранилища документов недоступно.') }
      finally { if (!abort.signal.aborted) { working.current = false; setBusy(false) } }
    })()
    return () => { abort.abort(); selected.current?.[Symbol.dispose](); selected.current = null; source.current = null; disposeGatekeeperFrame(frame) }
  }, [authenticatedApi, initialScope, initialResource])
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (working.current || !source.current) return
    working.current = true; setBusy(true); setError(''); setNotice('')
    const signal = lifetime.current.signal
    try { await action(signal) }
    catch { if (!signal.aborted) { reset(); setError('Результат не подтверждён. Перечитайте конфликт и проверьте личную версию перед новой попыткой: могли измениться права или документ.') } }
    finally { if (!signal.aborted) { working.current = false; setBusy(false) } }
  }
  async function loadConflict(signal: AbortSignal, project = scope, document = node) {
    reset()
    const conflict = await source.current!.selectConflict(project, document, format)
    if (signal.aborted) { conflict[Symbol.dispose](); return }
    selected.current = conflict
    const result = await conflict.describe(); signal.throwIfAborted(); setView(result)
  }
  const reviewed = !!view && view.terms.every((term, index) => term.negative || Object.hasOwn(previews, index))
  return <section className="flex flex-col gap-2 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default">
    <p className="m-0 text-[12px] leading-4 text-kumo-subtle">Просмотрите все варианты перед выбором. Сохраняются содержимое, имя и расположение выбранной стороны. После разрешения откройте личную версию и отправьте изменения на согласование.</p>
    <label>Проект<select aria-label="Проект конфликта" className={selectClass} disabled={busy} value={scope} onChange={e => {
      const project = e.target.value; setScope(project); setNode(''); setDocuments([]); setCursor(''); reset()
      if (project) void run(async signal => { const page = await source.current!.documents(project, ''); signal.throwIfAborted(); setDocuments(page.documents); setCursor(page.nextCursor) })
    }}><option value="">Выберите проект</option>{scopes.map(item => <option key={item.id} value={item.id}>{item.name}{item.sharedDeleted ? " — удалён из общей версии" : ""}</option>)}</select></label>
    <p className="m-0 text-[12px] leading-4 text-kumo-subtle">Общие правки переносятся в личную версию всего проекта. Сначала сохраните изменения редактора в Mnemos; после переноса откройте личную версию заново.</p>
    <div className="flex flex-wrap gap-2">
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
        onResolved?.()
      }) }}>Получить общие правки</WorkshopButton>}
    </div>
    <label>Документ<select aria-label="Документ конфликта" className={selectClass} disabled={busy || !scope} value={node} onChange={e => { setNode(e.target.value); reset() }}><option value="">Выберите документ</option>{documents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {cursor && <WorkshopButton disabled={busy} onClick={() => { void run(async signal => {
      const page = await source.current!.documents(scope, cursor); signal.throwIfAborted()
      setDocuments(old => [...new Map([...old, ...page.documents].map(item => [item.id, item])).values()]); setCursor(page.nextCursor)
    }) }}>Ещё документы</WorkshopButton>}
    <div className="flex flex-wrap gap-2">
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
      <WorkshopButton disabled={busy || !node} onClick={() => { void run(signal => loadConflict(signal)) }}>Перечитать конфликт</WorkshopButton>
    </div>
    {deleteHead && <div className="flex flex-col gap-2 rounded-xl border border-kumo-line bg-kumo-base p-3">
      <p className="m-0">Удалить «{documents.find(document => document.id === node)?.name || 'выбранный документ'}» из личной версии? Общая версия и история сохранятся. Для общего удаления потребуется согласование и публикация.</p>
      <WorkshopButton disabled={busy} onClick={() => { void run(async signal => {
        const expected = deleteHead; reset()
        await source.current!.deleteDocument(scope, node, expected, format); signal.throwIfAborted()
        setNotice('Документ удалён из личной версии. Для восстановления выберите опубликованную версию в «Открыть из Mnemos». Для общего удаления отправьте изменения на согласование.')
        onResolved?.()
      }) }}>Удалить из личной версии</WorkshopButton>
    </div>}
    {location && <div className="flex flex-col gap-2 rounded-xl border border-kumo-line bg-kumo-base p-3">
      <label>Имя<input aria-label="Новое имя документа" className={selectClass} value={newName} disabled={busy} onChange={e => setNewName(e.target.value)} /></label>
      <label>Папка<select aria-label="Новая папка документа" className={selectClass} value={newParent} disabled={busy} onChange={e => setNewParent(e.target.value)}>
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
        onResolved?.()
      }) }}>Сохранить имя и папку</WorkshopButton>
    </div>}
    {view?.terms.map((term, index) => <div className="flex flex-col gap-2 rounded-xl border border-kumo-line bg-kumo-base p-3" key={`${view.head}:${index}`}>
      <h3 className="m-0 text-[13px] leading-[18px] font-medium">{term.negative ? 'Базовая версия' : `Вариант ${index / 2 + 1}`}{!term.present ? ' — удаление' : ''}</h3>
      {term.metadata && <p className="m-0 text-[12px] leading-4 text-kumo-subtle">{term.metadata.name} · Папка: {term.metadata.parent_id || 'Корень проекта'} · {term.metadata.content_type}</p>}
      <WorkshopButton disabled={busy} onClick={() => { void run(async signal => {
        const conflict = selected.current!
        const ticket = await conflict.download(index); signal.throwIfAborted()
        const snapshot = ticket ? await downloadGatekeeperNativeDocument(origin.current, { ...ticket, content_type: `application/vnd.${format}+json` }, format, signal, () => conflict.validate()) : null
        if (snapshot) parseNativeReview(snapshot)
        await conflict.validate(); signal.throwIfAborted(); setPreviews(old => ({ ...old, [index]: snapshot }))
      }) }}>Просмотреть {term.negative ? 'базу' : `вариант ${index / 2 + 1}`}</WorkshopButton>
      {Object.hasOwn(previews, index) && (previews[index] ? <NativeReviewSnapshot snapshot={previews[index]!} /> : <p className="m-0">Документ отсутствует на этой стороне.</p>)}
      {!term.negative && <WorkshopButton tone="primary" className="!h-8" disabled={busy || !reviewed} onClick={() => { void run(async signal => {
        await selected.current!.resolve(index); signal.throwIfAborted(); reset()
        setNotice('Выбранная сторона сохранена в личной версии. Общая версия не опубликована.')
        onResolved?.()
      }) }}>{term.present ? `Сохранить вариант ${index / 2 + 1}` : 'Подтвердить удаление'}</WorkshopButton>}
    </div>)}
    {error && <p role="alert" className="m-0 text-kumo-danger">{error}</p>}{notice && <p role="status" className="m-0">{notice}</p>}{busy && <p role="status" className="m-0 text-kumo-subtle">Загрузка…</p>}
    <WorkshopButton disabled={busy} onClick={close}>Закрыть</WorkshopButton>
  </section>
}
