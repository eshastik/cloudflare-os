import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@cloudflare/kumo'
import type { RpcStub } from 'capnweb'
import type { GatekeeperNativeDocumentWriteSelector, GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import type { PublicationReview } from '@gadgets/workshop-shared/publication-review'
import { useAuthenticatedApi } from './AuthContext'
import { WorkshopButton } from './components/WorkshopControls'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'

type Selector = RpcStub<GatekeeperNativeDocumentWriteSelector>
type State = Awaited<ReturnType<Selector['publicationState']>>
type Props = { context: object; disabled?: boolean }

export default function NativeDocumentPublication({ context, disabled }: Props) {
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [context])
  return <>
    <WorkshopButton disabled={disabled} onClick={() => setOpen(true)}>Согласование Mnemos</WorkshopButton>
    {open && <PublicationDialog close={() => setOpen(false)} />}
  </>
}

function PublicationDialog({ close }: { close(): void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const source = useRef<Selector | null>(null)
  const lifetime = useRef(new AbortController())
  const [scopes, setScopes] = useState<{ id: string; name: string }[]>([])
  const [project, setProject] = useState(''), [state, setState] = useState<State | null>(null)
  const [review, setReview] = useState<PublicationReview | null>(null)
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const key = (scope: string) => `mnemos-native-review:${location.pathname}:${scope}`
  useEffect(() => {
    const abort = new AbortController(); lifetime.current = abort
    let frame: GatekeeperUiFrame | null = null
    void (async () => {
      try {
        frame = await authenticatedApi.getGatekeeperApp('mnemos')
        if (abort.signal.aborted) { disposeGatekeeperFrame(frame); return }
        if (!frame?.nativeWrites) throw new Error()
        source.current = frame.nativeWrites.selector as Selector
        const page = await source.current.scopes(); abort.signal.throwIfAborted()
        setScopes(page.scopes)
      } catch { if (!abort.signal.aborted) setError('Подключение недоступно. Переподключите Mnemos в «Коннекторах».') }
      finally { if (!abort.signal.aborted) setBusy(false) }
    })()
    return () => { abort.abort(); source.current = null; disposeGatekeeperFrame(frame) }
  }, [authenticatedApi])

  async function run(action: (selector: Selector, signal: AbortSignal) => Promise<void>) {
    if (busy || !source.current) return
    const signal = lifetime.current.signal
    setBusy(true); setError(''); setNotice('')
    try { await action(source.current, signal) }
    catch {
      if (!signal.aborted) {
        setReview(null); setState(null)
        setError('Результат не подтверждён. Перечитайте состояние: могли измениться версия, права или решения. Повтор отправки той же версии не создаёт дубликат.')
      }
    } finally { if (!signal.aborted) setBusy(false) }
  }
  async function load(selector: Selector, signal: AbortSignal, scope: string, id?: string) {
    setReview(null); setState(null)
    const current = await selector.publicationState(scope); signal.throwIfAborted()
    const saved = id || sessionStorage.getItem(key(scope))
    if (saved) {
      const proposal = await selector.review(saved); signal.throwIfAborted()
      if (proposal.candidate_id !== saved || proposal.project_id !== scope) throw new Error()
      setReview({ ...proposal, stale: proposal.stale || proposal.personal_head !== current.personal_head || proposal.shared_head !== current.shared_head })
    }
    setState(current)
  }
  const ready = !!review?.ready && !review.stale
  return <Dialog.Root open onOpenChange={value => { if (!value && !busy) close() }}><Dialog className="bg-kumo-base p-5" size="base">
    <Dialog.Title>Согласование и публикация</Dialog.Title>
    <p className="my-3">Сначала сохраните документ в Mnemos. На согласование и публикацию идут все сохранённые изменения вашей личной ветки выбранного проекта. Несохранённые правки редактора не включаются.</p>
    <label>Проект<select aria-label="Проект публикации" className="block w-full border rounded p-2" value={project} disabled={busy} onChange={e => {
      const scope = e.target.value; setProject(scope); setState(null); setReview(null)
      if (scope) void run((selector, signal) => load(selector, signal, scope))
    }}><option value="">Выберите проект</option>{scopes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {state && !state.personal_exists && <p>Личной ветки пока нет. Сохраните документ в этот проект.</p>}
    {review && <div className="my-3">
      <p>{review.stale ? 'Согласование устарело. Отправьте актуальные изменения заново.' : ready ? 'Все обязательные согласующие приняли эту версию.' : 'Ожидаются решения согласующих.'}</p>
      {review.domains.map(domain => <p key={domain.domain_id}>{domain.domain_id}: документов {domain.node_ids.length}; одобрено {domain.approvers.filter(id => domain.decisions.some(d => d.approver_id === id && d.approved)).length} из {domain.approvers.length}{domain.decisions.some(d => !d.approved) ? '; есть отказ' : ''}</p>)}
    </div>}
    <div className="flex flex-wrap gap-2 my-3">
      <WorkshopButton disabled={busy || !state?.personal_exists} onClick={() => { void run(async (selector, signal) => {
        const created = await selector.requestReview(project, state!.personal_head, state!.shared_head); signal.throwIfAborted()
        sessionStorage.setItem(key(project), created.candidate_id)
        await load(selector, signal, project, created.candidate_id)
        setNotice('Сохранённые изменения проекта отправлены на согласование.')
      }) }}>Отправить изменения проекта на согласование</WorkshopButton>
      <WorkshopButton disabled={busy || !project} onClick={() => { void run((selector, signal) => load(selector, signal, project)) }}>Перечитать состояние</WorkshopButton>
      <WorkshopButton disabled={busy || !project} onClick={() => { void run(async (selector, signal) => {
        sessionStorage.removeItem(key(project))
        await load(selector, signal, project)
      }) }}>Подготовить новое согласование</WorkshopButton>
      <WorkshopButton disabled={busy || !ready || !state} onClick={() => { void run(async (selector, signal) => {
        const selected = review!
        setReview(null); setState(null)
        const result = await selector.publishReview(project, selected.candidate_id); signal.throwIfAborted()
        if (result.published) {
          sessionStorage.removeItem(key(project))
          setNotice('Согласованные изменения проекта опубликованы. Откройте опубликованную версию через «Открыть из Mnemos».')
        } else setNotice(result.conflicted ? 'Обнаружен конфликт. Разрешите его перед новым согласованием.' : 'Публикация не выполнена. Перечитайте состояние проекта.')
      }) }}>Опубликовать согласованные изменения проекта</WorkshopButton>
    </div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{busy && <p role="status">Загрузка…</p>}
    <WorkshopButton disabled={busy} onClick={close}>Закрыть</WorkshopButton>
  </Dialog></Dialog.Root>
}
