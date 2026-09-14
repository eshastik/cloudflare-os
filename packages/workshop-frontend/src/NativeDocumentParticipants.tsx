import { useEffect, useRef, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { GatekeeperNativeDocumentWriteSelector, GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import type { NativeDocumentFormat } from '@gadgets/workshop-shared/native-document'
import { useAuthenticatedApi } from './AuthContext'
import { WorkshopButton } from './components/WorkshopControls'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { openNativeWritesFrame } from './accountCapabilities'

type Selector = RpcStub<GatekeeperNativeDocumentWriteSelector>
type Writer = Awaited<ReturnType<Selector['select']>>
type Page = Awaited<ReturnType<Selector['participants']>>
type Person = Page['participants'][number]
type Props = { format: NativeDocumentFormat; initialScope?: string; initialResource?: string; onChanged?(): void; onClose?(): void }

export default function NativeDocumentParticipants({ onClose, ...props }: Props) {
  const [closed, setClosed] = useState(false)
  if (closed) return null
  return <ParticipantsSection {...props} close={() => { setClosed(true); onClose?.() }} />
}

function ParticipantsSection({ format, initialScope, initialResource, onChanged, close }: Omit<Props, 'onClose'> & { close(): void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const source = useRef<Selector | null>(null), selected = useRef<Writer | null>(null)
  const alive = useRef(true)
  const [scopes, setScopes] = useState<{ id: string; name: string }[]>([])
  const [documents, setDocuments] = useState<{ id: string; name: string }[]>([])
  const [scope, setScope] = useState(''), [resource, setResource] = useState(''), [head, setHead] = useState('')
  const [docCursor, setDocCursor] = useState(''), [page, setPage] = useState<Page | null>(null)
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const check = () => { if (!alive.current) throw new Error('Section closed') }
  useEffect(() => {
    alive.current = true
    let frame: GatekeeperUiFrame | null = null, cancelled = false
    void (async () => {
      try {
        frame = await openNativeWritesFrame(authenticatedApi)
        if (cancelled) { disposeGatekeeperFrame(frame); return }
        if (!frame?.nativeWrites) throw new Error()
        source.current = frame.nativeWrites.selector as Selector
        const list = await source.current.scopes()
        if (cancelled) return
        setScopes(list.scopes)
        if (initialScope) { await chooseProject(initialScope); if (initialResource) await chooseDocument(initialResource, initialScope) }
      } catch { if (!cancelled) setError('Подключение недоступно. Переподключите его в разделе «Подключения».') }
      finally { if (!cancelled) setBusy(false) }
    })()
    return () => { cancelled = true; alive.current = false; selected.current?.[Symbol.dispose](); selected.current = null; source.current = null; disposeGatekeeperFrame(frame) }
  }, [authenticatedApi, initialScope, initialResource])

  async function run(action: () => Promise<void>) {
    if (busy || !source.current) return
    setBusy(true); setError(''); setNotice('')
    try { await action() }
    catch { if (alive.current) { setPage(null); setError('Операция не подтверждена. Перечитайте участников: могли измениться права или версия документа.') } }
    finally { if (alive.current) setBusy(false) }
  }
  async function chooseProject(project: string) {
    setScope(project); setResource(''); setDocuments([]); setDocCursor(''); setPage(null); setHead('')
    selected.current?.[Symbol.dispose](); selected.current = null
    if (!project) return
    const result = await source.current!.documents(project, ''); check()
    setDocuments(result.documents); setDocCursor(result.nextCursor)
  }
  async function chooseDocument(node: string, project = scope) {
    setResource(node); setPage(null); setHead('')
    selected.current?.[Symbol.dispose](); selected.current = null
    if (!node) return
    const writer = await source.current!.select(project, node, format)
    if (!alive.current) { writer[Symbol.dispose](); return }
    selected.current = writer
    const current = await writer.head(); check()
    const result = await source.current!.participants(project, node, current, ''); check()
    setHead(current); setPage(result)
  }
  async function refresh() {
    if (!selected.current) return
    setPage(null)
    const current = await selected.current.head(); check()
    const result = await source.current!.participants(scope, resource, current, ''); check()
    setHead(current); setPage(result)
  }
  async function change(person: Person, mode: Person['mode']) {
    await source.current!.setParticipant(scope, resource, head, person.id, person.mode, mode); check()
    await refresh(); check()
    setNotice('Приглашение обновлено. Ранее отправленные согласования может потребоваться создать заново.')
    onChanged?.()
  }
  return <section className="flex flex-col gap-2 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default">
    <p className="m-0 text-[12px] leading-4 text-kumo-subtle">Приглашения меняет владелец; права папки действуют независимо. Отзыв приглашения закрывает приватные версии, а доступ к уже опубликованным версиям определяется правами проекта.</p>
    <label className="block">Проект<select aria-label="Проект участников" className="block w-full border border-kumo-line rounded-lg p-2 bg-kumo-base" value={scope} disabled={busy} onChange={e => { void run(() => chooseProject(e.target.value)) }}>
      <option value="">Выберите проект</option>{scopes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select></label>
    <label className="block">Документ<select aria-label="Документ участников" className="block w-full border border-kumo-line rounded-lg p-2 bg-kumo-base" value={resource} disabled={busy || !scope} onChange={e => { void run(() => chooseDocument(e.target.value)) }}>
      <option value="">Выберите документ</option>{documents.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
    </select></label>
    {docCursor && <WorkshopButton disabled={busy} onClick={() => { void run(async () => {
      const result = await source.current!.documents(scope, docCursor); check()
      setDocuments(old => [...new Map([...old, ...result.documents].map(d => [d.id, d])).values()]); setDocCursor(result.nextCursor)
    }) }}>Ещё документы</WorkshopButton>}
    {page?.participants.map(person => <ParticipantRow key={`${person.id}:${person.mode}`} person={person} busy={busy} apply={mode => { void run(() => change(person, mode)) }} />)}
    {page && page.participants.length === 0 && <p className="m-0">На этой странице нет доступных участников.</p>}
    {page?.nextCursor && <WorkshopButton disabled={busy} onClick={() => { void run(async () => {
      const result = await source.current!.participants(scope, resource, head, page.nextCursor); check()
      setPage({ ...result, participants: [...page.participants, ...result.participants] })
    }) }}>Ещё участники</WorkshopButton>}
    <div className="flex flex-wrap gap-2">
      {resource && <WorkshopButton disabled={busy || !selected.current} onClick={() => { void run(refresh) }}>Перечитать участников</WorkshopButton>}
      <WorkshopButton disabled={busy} onClick={close}>Закрыть</WorkshopButton>
    </div>
    {error && <p role="alert" className="m-0 text-kumo-danger">{error}</p>}{notice && <p role="status" className="m-0">{notice}</p>}{busy && <p role="status" className="m-0 text-kumo-subtle">Загрузка…</p>}
  </section>
}

function ParticipantRow({ person, busy, apply }: { person: Person; busy: boolean; apply(mode: Person['mode']): void }) {
  const [mode, setMode] = useState(person.mode)
  return <div className="flex gap-2 items-center">
    <label className="flex-1 min-w-0">{person.name || 'Участник'}<select aria-label={`Доступ: ${person.name || 'Участник'}`} className="block w-full border border-kumo-line rounded-lg p-1.5 bg-kumo-base" value={mode} disabled={busy} onChange={e => setMode(e.target.value as Person['mode'])}>
      <option value="">Без приглашения</option><option value="read" disabled={!person.canRead}>Чтение</option><option value="write" disabled={!person.canRead || !person.canWrite}>Редактирование</option>
    </select></label>
    <WorkshopButton disabled={busy || mode === person.mode} onClick={() => apply(mode)}>Применить</WorkshopButton>
  </div>
}
