import { useEffect, useRef, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { GatekeeperNativeDocumentWriteSelector, GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import type { PublicationReview } from '@gadgets/workshop-shared/publication-review'
import { useAuthenticatedApi } from './AuthContext'
import { WorkshopButton } from './components/WorkshopControls'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { openNativeWritesFrame } from './accountCapabilities'

type Selector = RpcStub<GatekeeperNativeDocumentWriteSelector>
export type PublicationState = Awaited<ReturnType<Selector['publicationState']>>
type Props = { initialScope?: string; onClose?(): void }

export const reviewKey = (scope: string) => `mnemos-native-review:${location.pathname}:${scope}`

/** Читает текущие головы проекта и сохранённую заявку; устаревание сверяется с головами, а не только с флагом сервера. */
export async function loadPublication(selector: Selector, signal: AbortSignal, scope: string, id?: string): Promise<{ state: PublicationState; review: PublicationReview | null }> {
  const current = await selector.publicationState(scope); signal.throwIfAborted()
  const saved = id || sessionStorage.getItem(reviewKey(scope))
  let review: PublicationReview | null = null
  if (saved) {
    const proposal = await selector.review(saved); signal.throwIfAborted()
    if (proposal.candidate_id !== saved || proposal.project_id !== scope) throw new Error()
    review = { ...proposal, stale: proposal.stale || proposal.personal_head !== current.personal_head || proposal.shared_head !== current.shared_head }
  }
  return { state: current, review }
}

/** Отправляет сохранённые изменения проекта на согласование при показанных головах и запоминает заявку. */
export async function submitReview(selector: Selector, signal: AbortSignal, scope: string, state: PublicationState) {
  const created = await selector.requestReview(scope, state.personal_head, state.shared_head); signal.throwIfAborted()
  sessionStorage.setItem(reviewKey(scope), created.candidate_id)
  return loadPublication(selector, signal, scope, created.candidate_id)
}

/** Итог удачной публикации заявки: по нему шапка документа узнаёт, что версия стала общей. */
export const CANDIDATE_PUBLISHED_NOTICE = 'Согласованные изменения проекта опубликованы. Откройте опубликованную версию через «Открыть из Mnemos».'

/** Публикует готовую заявку; возвращает текст для человека, ответ сервера не перепроверяется повтором. */
export async function publishCandidate(selector: Selector, signal: AbortSignal, scope: string, candidateId: string): Promise<string> {
  const result = await selector.publishReview(scope, candidateId); signal.throwIfAborted()
  if (result.refused) return result.refused
  if (result.published) {
    sessionStorage.removeItem(reviewKey(scope))
    return CANDIDATE_PUBLISHED_NOTICE
  }
  return result.conflicted ? 'Обнаружен конфликт. Разрешите его перед новым согласованием.' : 'Публикация не выполнена. Перечитайте состояние проекта.'
}

export default function NativeDocumentPublication({ initialScope, onClose }: Props) {
  const [closed, setClosed] = useState(false)
  if (closed) return null
  return <PublicationSection initialScope={initialScope} close={() => { setClosed(true); onClose?.() }} />
}

function PublicationSection({ initialScope, close }: { initialScope?: string; close(): void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const source = useRef<Selector | null>(null)
  const lifetime = useRef(new AbortController())
  const [scopes, setScopes] = useState<{ id: string; name: string }[]>([])
  const [project, setProject] = useState(initialScope ?? ''), [state, setState] = useState<PublicationState | null>(null)
  const [review, setReview] = useState<PublicationReview | null>(null)
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('')
  useEffect(() => {
    const abort = new AbortController(); lifetime.current = abort
    let frame: GatekeeperUiFrame | null = null
    void (async () => {
      try {
        frame = await openNativeWritesFrame(authenticatedApi)
        if (abort.signal.aborted) { disposeGatekeeperFrame(frame); return }
        if (!frame?.nativeWrites) throw new Error()
        source.current = frame.nativeWrites.selector as Selector
        const page = await source.current.scopes(); abort.signal.throwIfAborted()
        setScopes(page.scopes)
        if (initialScope) { const loaded = await loadPublication(source.current, abort.signal, initialScope); setReview(loaded.review); setState(loaded.state) }
      } catch { if (!abort.signal.aborted) setError('Подключение недоступно. Переподключите его в разделе «Подключения».') }
      finally { if (!abort.signal.aborted) setBusy(false) }
    })()
    return () => { abort.abort(); source.current = null; disposeGatekeeperFrame(frame) }
  }, [authenticatedApi, initialScope])

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
    const loaded = await loadPublication(selector, signal, scope, id)
    setReview(loaded.review); setState(loaded.state)
  }
  const ready = !!review?.ready && !review.stale
  return <section className="flex flex-col gap-2 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default">
    <p className="m-0 text-[12px] leading-4 text-kumo-subtle">Сначала сохраните документ в Mnemos. На согласование и публикацию идут все сохранённые изменения вашей личной ветки выбранного проекта. Несохранённые правки редактора не включаются.</p>
    <label>Проект<select aria-label="Проект публикации" className="block w-full border border-kumo-line rounded-lg p-2 bg-kumo-base" value={project} disabled={busy} onChange={e => {
      const scope = e.target.value; setProject(scope); setState(null); setReview(null)
      if (scope) void run((selector, signal) => load(selector, signal, scope))
    }}><option value="">Выберите проект</option>{scopes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {state && !state.personal_exists && <p className="m-0">Личной ветки пока нет. Сохраните документ в этот проект.</p>}
    {review && <div className="my-1">
      <p className="m-0">{review.stale ? 'Согласование устарело. Отправьте актуальные изменения заново.' : ready ? 'Все обязательные согласующие приняли эту версию.' : 'Ожидаются решения согласующих.'}</p>
      {review.domains.map(domain => <p className="m-0 text-[12px] leading-4 text-kumo-subtle" key={domain.domain_id}>{domain.domain_id}: документов {domain.node_ids.length}; одобрено {domain.approvers.filter(id => domain.decisions.some(d => d.approver_id === id && d.approved)).length} из {domain.approvers.length}{domain.decisions.some(d => !d.approved) ? '; есть отказ' : ''}</p>)}
    </div>}
    <div className="flex flex-wrap gap-2 my-1">
      <WorkshopButton disabled={busy || !state?.personal_exists} onClick={() => { void run(async (selector, signal) => {
        const loaded = await submitReview(selector, signal, project, state!)
        setReview(loaded.review); setState(loaded.state)
        setNotice('Сохранённые изменения проекта отправлены на согласование.')
      }) }}>Отправить изменения проекта на согласование</WorkshopButton>
      <WorkshopButton disabled={busy || !project} onClick={() => { void run((selector, signal) => load(selector, signal, project)) }}>Перечитать состояние</WorkshopButton>
      <WorkshopButton disabled={busy || !project} onClick={() => { void run(async (selector, signal) => {
        sessionStorage.removeItem(reviewKey(project))
        await load(selector, signal, project)
      }) }}>Подготовить новое согласование</WorkshopButton>
      <WorkshopButton disabled={busy || !ready || !state} onClick={() => { void run(async (selector, signal) => {
        const selected = review!
        setReview(null); setState(null)
        setNotice(await publishCandidate(selector, signal, project, selected.candidate_id))
      }) }}>Опубликовать согласованные изменения проекта</WorkshopButton>
    </div>
    {error && <p role="alert" className="m-0 text-kumo-danger">{error}</p>}{notice && <p role="status" className="m-0">{notice}</p>}{busy && <p role="status" className="m-0 text-kumo-subtle">Загрузка…</p>}
    <WorkshopButton disabled={busy} onClick={close}>Закрыть</WorkshopButton>
  </section>
}
