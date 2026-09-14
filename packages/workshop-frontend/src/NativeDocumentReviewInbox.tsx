import { useEffect, useRef, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { GatekeeperNativeReviewMetadata, GatekeeperNativeDocumentWriteSelector, GatekeeperNativeDocumentSelector, GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import type { PublicationReview } from '@gadgets/workshop-shared/publication-review'
import type { NativeDocumentFormat, NativeDocumentSnapshot } from '@gadgets/workshop-shared/native-document'
import { useAuthenticatedApi } from './AuthContext'
import { WorkshopButton } from './components/WorkshopControls'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { openNativeWritesFrame } from './accountCapabilities'
import { downloadGatekeeperNativeReview } from './gatekeeperAppDownload'
import NativeReviewSnapshot from './NativeReviewSnapshot'

type Selector = RpcStub<GatekeeperNativeDocumentWriteSelector>
type Downloads = { selector: RpcStub<GatekeeperNativeDocumentSelector>; origin: string }
export type ReviewComparison = { metadata: (GatekeeperNativeReviewMetadata | undefined)[]; node: string; before: NativeDocumentSnapshot | null; after: NativeDocumentSnapshot | null }
type Props = { format: NativeDocumentFormat; closable?: boolean; onClose?(): void }

/** Скачивает обе стороны заявки и перечитывает её: сравнение показывается только для той же версии решения. */
export async function loadReviewComparison(source: Selector, transport: Downloads, current: PublicationReview, node: string, format: NativeDocumentFormat, signal: AbortSignal): Promise<{ review: PublicationReview; preview: ReviewComparison }> {
  const sides: (NativeDocumentSnapshot | null)[] = []
  const metadata: (GatekeeperNativeReviewMetadata | undefined)[] = [undefined, undefined]
  for (const side of ['before', 'after'] as const) {
    using selected = await transport.selector.selectReview(current.candidate_id, node, current.decision_version, side, format)
    signal.throwIfAborted()
    sides.push(await downloadGatekeeperNativeReview(transport.origin, selected, format, signal, value => { metadata[side === "before" ? 0 : 1] = value }))
  }
  const checked = await source.review(current.candidate_id); signal.throwIfAborted()
  if (checked.candidate_id !== current.candidate_id || checked.decision_version !== current.decision_version || checked.personal_head !== current.personal_head || checked.shared_head !== current.shared_head || checked.stale || !checked.domains.some(d => d.node_ids.includes(node))) throw new Error()
  return { review: checked, preview: { node, metadata, before: sides[0], after: sides[1] } }
}

export function ReviewComparisonView({ preview }: { preview: ReviewComparison }) {
  return <div className="flex flex-col gap-1 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default">
    <h3 className="m-0 text-[12px] leading-4 font-semibold uppercase tracking-[0.9px] text-kumo-subtle">До изменений</h3>{preview.metadata[0] && <p className="m-0 text-[12px] leading-4 text-kumo-subtle">Имя: {preview.metadata[0].name} · Папка: {preview.metadata[0].parent_id || "Корень проекта"}</p>}{preview.before ? <NativeReviewSnapshot snapshot={preview.before} /> : <p className="m-0">Документа не было.</p>}
    <h3 className="m-0 mt-2 text-[12px] leading-4 font-semibold uppercase tracking-[0.9px] text-kumo-subtle">Предложенная версия</h3>{preview.metadata[1] && <p className="m-0 text-[12px] leading-4 text-kumo-subtle">Имя: {preview.metadata[1].name} · Папка: {preview.metadata[1].parent_id || "Корень проекта"}</p>}{preview.after ? <NativeReviewSnapshot snapshot={preview.after} /> : <p className="m-0">Предложено удаление документа.</p>}
  </div>
}

export default function NativeDocumentReviewInbox({ format, closable = true, onClose }: Props) {
  const [closed, setClosed] = useState(false)
  if (closed) return null
  return <Inbox initialFormat={format} closable={closable} close={() => { setClosed(true); onClose?.() }} />
}

function Inbox({ initialFormat, closable, close }: { initialFormat: NativeDocumentFormat; closable: boolean; close(): void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const source = useRef<Selector | null>(null)
  const downloads = useRef<Downloads | null>(null)
  const lifetime = useRef(new AbortController())
  const [user, setUser] = useState(''), [rows, setRows] = useState<PublicationReview[]>([]), [cursor, setCursor] = useState('')
  const [review, setReview] = useState<PublicationReview | null>(null), [preview, setPreview] = useState<ReviewComparison | null>(null)
  const [format, setFormat] = useState(initialFormat), [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('')
  useEffect(() => {
    const abort = new AbortController(); lifetime.current = abort
    let frame: GatekeeperUiFrame | null = null
    void (async () => {
      try {
        frame = await openNativeWritesFrame(authenticatedApi)
        if (abort.signal.aborted) { disposeGatekeeperFrame(frame); return }
        if (!frame?.nativeWrites || !frame.nativeDownloads) throw new Error()
        source.current = frame.nativeWrites.selector as Selector
        downloads.current = { selector: frame.nativeDownloads.selector as RpcStub<GatekeeperNativeDocumentSelector>, origin: frame.nativeDownloads.storageOrigin }
        const identity = await source.current.reviewerIdentity(); abort.signal.throwIfAborted(); setUser(identity)
        const page = await source.current.reviewInbox(''); abort.signal.throwIfAborted()
        setRows(page.reviews); setCursor(page.next_cursor)
      } catch { if (!abort.signal.aborted) setError('Согласования недоступны. Проверьте подключение в разделе «Подключения».') }
      finally { if (!abort.signal.aborted) setBusy(false) }
    })()
    return () => { abort.abort(); source.current = null; downloads.current = null; disposeGatekeeperFrame(frame) }
  }, [authenticatedApi])
  async function run(action: (source: Selector, signal: AbortSignal) => Promise<void>) {
    if (busy || !source.current) return
    const signal = lifetime.current.signal
    setBusy(true); setError(''); setNotice(''); setPreview(null)
    try { await action(source.current, signal) }
    catch { if (!signal.aborted) { setReview(null); setError('Результат не подтверждён. Перечитайте согласования: могли измениться версия, права или решения.') } }
    finally { if (!signal.aborted) setBusy(false) }
  }
  async function read(source: Selector, signal: AbortSignal, id: string) {
    setReview(null)
    const current = await source.review(id); signal.throwIfAborted()
    if (current.candidate_id !== id) throw new Error()
    setRows(old => old.map(row => row.candidate_id === id ? current : row))
    setReview(current)
  }
  async function inspect(node: string) {
    const current = review, transport = downloads.current
    if (!current || !transport) return
    await run(async (source, signal) => {
      const loaded = await loadReviewComparison(source, transport, current, node, format, signal)
      setReview(loaded.review); setPreview(loaded.preview)
    })
  }
  const mine = rows.filter(r => r.domains.some(d => d.approvers.includes(user)))
  return <section className="flex flex-col gap-2 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default">
    {!busy && !error && mine.length === 0 && <p className="m-0 text-[12px] leading-4 text-kumo-subtle">Нет согласований, ожидающих вашего решения.</p>}
    {mine.map(r => <div key={r.candidate_id} className="flex items-center justify-between gap-2 rounded-xl border border-kumo-line bg-kumo-base px-3 py-2">
      <span className="min-w-0 truncate">{r.domains.map(d => d.domain_id).join(', ')} · {r.stale ? 'устарело' : r.ready ? 'согласовано' : 'ожидает решения'}</span>
      <WorkshopButton disabled={busy} onClick={() => { void run((source, signal) => read(source, signal, r.candidate_id)) }}>Открыть согласование</WorkshopButton>
    </div>)}
    {cursor && <WorkshopButton disabled={busy} onClick={() => { void run(async (source, signal) => {
      const page = await source.reviewInbox(cursor); signal.throwIfAborted(); setRows(old => [...new Map([...old, ...page.reviews].map(r => [r.candidate_id, r])).values()]); setCursor(page.next_cursor)
    }) }}>Ещё согласования</WorkshopButton>}
    {review && <div className="flex flex-col gap-2 rounded-xl border border-kumo-line bg-kumo-base p-3">
      <p className="m-0 text-[12px] leading-4 text-kumo-subtle">{review.stale ? 'Согласование устарело; требуется новое предложение.' : 'Решение относится к сохранённому предложению, а не к текущему содержимому редактора.'}</p>
      <label>Формат предпросмотра<select aria-label="Формат согласования" className="block w-full border border-kumo-line rounded-lg p-2 bg-kumo-base" disabled={busy} value={format} onChange={e => { setFormat(e.target.value as NativeDocumentFormat); setPreview(null) }}><option value="cloudflareos.document">Документ</option><option value="cloudflareos.spreadsheet">Таблица</option><option value="cloudflareos.presentation">Презентация</option></select></label>
      {[...new Set(review.domains.flatMap(d => d.node_ids))].map((node, index) => <div key={node}>
        <WorkshopButton disabled={busy || review.stale} onClick={() => { void inspect(node) }}>Проверить документ {index + 1}</WorkshopButton>
      </div>)}
      {preview && <div key={`${review.candidate_id}:${preview.node}`}><ReviewComparisonView preview={preview} /></div>}
      {review.domains.filter(d => d.approvers.includes(user)).map(domain => <div key={domain.domain_id} className="flex flex-col gap-2">
        <p className="m-0">{domain.domain_id}: {domain.decisions.find(d => d.approver_id === user)?.approved === true ? 'вы одобрили' : domain.decisions.find(d => d.approver_id === user)?.approved === false ? 'вы отклонили' : 'вашего решения нет'}</p>
        <div className="flex gap-2">{[true, false].map(approved => <WorkshopButton key={String(approved)} tone={approved ? 'primary' : 'secondary'} className={approved ? '!h-8' : ''} disabled={busy || review.stale} onClick={() => { const current = review; void run(async (source, signal) => {
          await source.decideReview(current.candidate_id, domain.domain_id, current.decision_version, approved); signal.throwIfAborted()
          await read(source, signal, current.candidate_id)
          setNotice(approved ? 'Одобрение записано.' : 'Отказ записан.')
        }) }}>{approved ? 'Одобрить' : 'Отклонить'}</WorkshopButton>)}</div>
      </div>)}
    </div>}
    <div className="flex flex-wrap gap-2">
      <WorkshopButton disabled={busy} onClick={() => { void run(async (source, signal) => {
        setReview(null); const page = await source.reviewInbox(''); signal.throwIfAborted(); setRows(page.reviews); setCursor(page.next_cursor)
      }) }}>Перечитать согласования</WorkshopButton>
      {closable && <WorkshopButton disabled={busy} onClick={close}>Закрыть</WorkshopButton>}
    </div>
    {error && <p role="alert" className="m-0 text-kumo-danger">{error}</p>}{notice && <p role="status" className="m-0">{notice}</p>}{busy && <p role="status" className="m-0 text-kumo-subtle">Загрузка…</p>}
  </section>
}
