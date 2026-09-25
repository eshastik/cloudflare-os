import HistoryPreparingNotice from './HistoryPreparingNotice'
import type {NativeDocumentLaunch} from './nativeDocumentLaunch'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CaretLeft, SidebarSimple, X } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import type { GadgetClient } from '@gadgets/workshop-shared/api'
import type { GatekeeperNativeDocumentSelector } from '@gadgets/workshop-shared/gatekeeper'
import type { NativeDocumentEditor, NativeDocumentFormat, NativeDocumentSnapshot } from '@gadgets/workshop-shared/native-document'
import { WorkshopButton, WorkshopIconButton } from './components/WorkshopControls'
import { formatAgo, type DocumentStatusHandle, type HistoryEntry } from './DocumentStatus'
import { downloadGatekeeperNativeDocument } from './gatekeeperAppDownload'
import { reloadPage } from './pageReload'
import NativeDocumentConflict from './NativeDocumentConflict'
import NativeDocumentOpen from './NativeDocumentOpen'
import NativeDocumentSave from './NativeDocumentSave'
import NativeEditorUpdate from './NativeEditorUpdate'
import type { NativeSnapshotSourceRef } from './nativeSnapshotSource'
import { compareSnapshots, type ParagraphChange, type Piece, type VersionDiff } from './versionDiff'

export type PanelSection = 'save' | 'conflict' | 'open' | 'bind' | 'share' | 'reopen' | 'restore'
type Props = {
  launch?: NativeDocumentLaunch; onLaunchConsumed?(): void
  gadget: RpcStub<GadgetClient>; format: NativeDocumentFormat; snapshotSource: NativeSnapshotSourceRef; chatId?: number; disabled?: boolean
  status: DocumentStatusHandle; section: PanelSection | null; onSection(section: PanelSection | null): void; onClose(): void; onCollapseChat?(): void
}

const PANEL_DOCKED_MIN_WIDTH = 1200
/** Сколько последних версий панель скачивает сама, чтобы подписать, что в них изменилось. */
export const DESCRIBED_VERSIONS = 12

/** Ширина окна: от 1200px панель стоит рядом с документом, уже — ложится поверх него. */
function useDocked() {
  const [docked, setDocked] = useState(() => typeof window === 'undefined' || window.innerWidth >= PANEL_DOCKED_MIN_WIDTH)
  useEffect(() => {
    const query = window.matchMedia?.(`(min-width: ${PANEL_DOCKED_MIN_WIDTH}px)`)
    if (!query) return
    const update = () => setDocked(query.matches)
    update(); query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return docked
}

const rowText = 'text-[14px] leading-5 text-kumo-default'
const subText = 'text-[13px] leading-[18px] text-kumo-subtle'
/** Вторичная кнопка-пилюля макета: белая, линия, высота 38. */
export const pillButton = 'inline-flex h-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-kumo-fill-hover bg-kumo-overlay px-4 text-[14px] leading-5 text-kumo-default transition-colors hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring disabled:cursor-not-allowed disabled:border-kumo-fill disabled:text-kumo-inactive disabled:hover:bg-kumo-overlay'
/** Главная кнопка-пилюля: заливка акцентом. */
export const primaryButton = 'inline-flex h-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-kumo-brand px-5 text-[14px] leading-5 font-medium text-white transition-colors hover:bg-kumo-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring disabled:cursor-not-allowed disabled:bg-kumo-fill disabled:text-kumo-inactive'

function Section({ name, children }: { name?: string; children: ReactNode }) {
  return <section data-section={name} className="flex flex-col gap-2.5">{children}</section>
}

/** Версия в списке: номер от старой к новой, новые сверху. */
export type VersionRow = HistoryEntry & { number: number }

/** Версии документа по времени, новые сверху; номер — порядковый от самой старой. Версии без времени считаются новейшими. */
export function versionRows(history: HistoryEntry[]): VersionRow[] {
  const time = (entry: HistoryEntry) => { const t = Date.parse(entry.recordedAt); return Number.isFinite(t) ? t : Infinity }
  const sorted = history.map((entry, index) => ({ entry, index })).sort((a, b) => time(b.entry) - time(a.entry) || a.index - b.index).map(x => x.entry)
  return sorted.map((entry, index) => ({ ...entry, number: sorted.length - index }))
}

/** Кто сохранил версию, одной строкой: человек или агент по чьей-то просьбе. me — опознаватель смотрящего. */
export function versionAuthor(entry: HistoryEntry, me = ''): string {
  if (entry.onBehalfOf) return entry.onBehalfOf === me ? 'Агент по вашей просьбе' : `Агент по просьбе: ${entry.onBehalfOf}`
  if (entry.personal) return entry.author || (entry.actor ? 'Владелец документа' : 'Вы')
  return entry.actor || 'Участник'
}

/** Строка «что изменилось»: автор и краткая разница с предыдущей версией, если она прочитана. */
export function versionLine(entry: HistoryEntry, summary: string | undefined, me = ''): string {
  const author = versionAuthor(entry, me)
  return summary ? `${author}: ${summary}` : author
}

function when(iso: string) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  if (Date.now() - t < 24 * 3_600_000) return formatAgo(iso).replace(' назад', '')
  if (Date.now() - t < 48 * 3_600_000) return 'вчера'
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
}

type Transport = { downloads: RpcStub<GatekeeperNativeDocumentSelector>; origin: string }

/**
 * Содержимое одной версии. Скачивание ждётся ВНУТРИ блока `using`: проверка доступа после скачивания
 * зовёт выбранную версию, а освобождённая заглушка RPC на неё уже не отвечает.
 */
export async function fetchVersion(transport: Transport, scope: string, resource: string, id: string, format: NativeDocumentFormat, signal: AbortSignal): Promise<NativeDocumentSnapshot> {
  using download = await transport.downloads.select(scope, resource, id)
  signal.throwIfAborted()
  const ticket = await download.issue(); signal.throwIfAborted()
  return await downloadGatekeeperNativeDocument(transport.origin, ticket as never, format, signal, () => download.validate())
}

/**
 * «Версии» по макету: список версий, новые сверху, у каждой — кто и что изменил. Щелчок выбирает версию; под
 * списком «Сравнить N−1 и N» и «Вернуть версию». Одна главная кнопка по состоянию публикации — внизу.
 * Кто видит документ — в «Поделиться», согласования — во «Входящих».
 */
export default function DocumentVersionPanel({ launch, onLaunchConsumed, gadget, format, snapshotSource, chatId, disabled, status, section, onSection, onClose, onCollapseChat }: Props) {
  const docked = useDocked()
  const { binding, data, model } = status
  const [comparison, setComparison] = useState<{ diff: VersionDiff; labels: [string, string] } | null>(null)
  const [comparing, setComparing] = useState(false), [actionError, setActionError] = useState(''), [actionNotice, setActionNotice] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [selected, setSelected] = useState(0)
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, NativeDocumentSnapshot | null>>(new Map())
  const cache = useRef(new Map<string, Promise<NativeDocumentSnapshot> & { signal: AbortSignal }>())
  const review = data?.review ?? null
  const names = new Map(data?.participants?.map(p => [p.id, p.name || 'Коллега']) ?? [])
  const rows = useMemo(() => versionRows(data?.history ?? []), [data?.history])
  const shared = data?.access && data.access !== 'owner'
  const showConflict = section === 'conflict' || model?.kind === 'conflict'
  const current = rows[selected] ?? null, previous = rows[selected + 1] ?? null
  const restoreRow = selected === 0 ? previous : current
  const title = data?.name ? `Версии «${data.name}»` : 'Версии'
  useEffect(() => { setSelected(0); setComparison(null) }, [binding?.scope, binding?.resource, rows.length])
  useEffect(() => { cache.current.clear(); setSnapshots(new Map()) }, [binding?.scope, binding?.resource, format])

  function transport(): Transport | null {
    const source = status.comparison()
    return source?.downloads ? { downloads: source.downloads, origin: source.origin } : null
  }
  /** Версия скачивается один раз за жизнь панели: и для подписи, и для сравнения. Общая загрузка живёт,
   *  пока жива связь с Mnemos, а не пока жив её первый заказчик: иначе отменённый заказ достался бы следующему. */
  function load(row: VersionRow) {
    const signal = status.lifetime.current.signal
    const known = cache.current.get(row.id)
    if (known && !known.signal.aborted) return known
    const way = transport()
    if (!binding || !way) return Object.assign(Promise.reject(new Error('Mnemos недоступен')), { signal })
    const next = Object.assign(fetchVersion(way, binding.scope, binding.resource, row.id, format, signal), { signal })
    cache.current.set(row.id, next)
    next.catch(() => { if (cache.current.get(row.id) === next) cache.current.delete(row.id) })
    return next
  }

  // Подписи «что изменилось»: последние версии скачиваются по одной, пока панель открыта.
  const ready = !!binding && !status.busy && rows.length > 0
  useEffect(() => {
    if (!ready) return
    const abort = new AbortController()
    const stopped = () => abort.signal.aborted || status.lifetime.current.signal.aborted
    void (async () => {
      for (const row of rows.slice(0, DESCRIBED_VERSIONS + 1)) {
        if (stopped()) return
        // Связь с Mnemos пересоздаётся при каждом перечитывании состояния; оборванная ею загрузка повторяется.
        for (let attempt = 0; attempt < 3; attempt++) {
          const pending = load(row)
          try { const snapshot = await pending; if (!stopped()) setSnapshots(old => new Map(old).set(row.id, snapshot)); break }
          catch {
            if (stopped()) return
            if (pending.signal.aborted && attempt < 2) continue
            setSnapshots(old => new Map(old).set(row.id, null)); break
          }
        }
      }
    })()
    return () => abort.abort()
  }, [ready, rows])

  const summaries = useMemo(() => {
    const out = new Map<string, string>()
    rows.forEach((row, index) => {
      const after = snapshots.get(row.id), older = rows[index + 1]
      if (!after) return
      const before = older ? snapshots.get(older.id) : null
      if (older && !before) return
      try { out.set(row.id, compareSnapshots(before ?? null, after).summary) } catch { /* непонятная структура — подписи нет */ }
    })
    return out
  }, [rows, snapshots])

  async function compare() {
    if (!binding || !current || !previous || comparing) return
    setComparing(true); setActionError(''); setActionNotice(''); setComparison(null)
    const signal = status.lifetime.current.signal
    try {
      const before = await load(previous), after = await load(current)
      setComparison({ diff: compareSnapshots(before, after), labels: [`Версия ${previous.number}`, `Версия ${current.number}`] })
    } catch { if (!signal.aborted) setActionError('Сравнение не открылось: версия не скачалась из Mnemos. Проверьте подключение и попробуйте ещё раз.') }
    finally { if (!signal.aborted) setComparing(false) }
  }

  /** «Вернуть версию»: её содержимое встаёт в редактор и сохраняется новой версией — старые не пропадают. */
  async function restore(row: VersionRow) {
    if (!binding || restoring) return
    setRestoring(true); setActionError(''); setActionNotice(''); setComparison(null)
    const signal = status.lifetime.current.signal
    try {
      const snapshot = await load(row)
      const read = snapshotSource.current
      if (!read) throw new Error('Редактор не готов')
      const revision = (await read(format, signal)).document.revision
      if (typeof revision !== 'number' || !Number.isSafeInteger(revision)) throw new Error('Ревизия редактора неизвестна')
      const editor = await gadget.connectToGadget() as unknown as RpcStub<NativeDocumentEditor>
      try { await editor.restoreDocumentSnapshot(snapshot, revision) } finally { editor[Symbol.dispose]() }
      signal.throwIfAborted()
      const head = status.data?.head
      await status.bindAtEditorRevision({ accountId: binding.accountId, scope: binding.scope, resource: binding.resource, ...(head && /^[a-f0-9]{64}$/.test(head) ? { savedHead: head } : {}) }, true)
      status.reopened()
      setActionNotice(`Версия ${row.number} открыта в редакторе и сохранится как новая версия.`)
    } catch { if (!signal.aborted) setActionError(`Версия ${row.number} не вернулась: не удалось скачать её или обновить редактор. Документ не изменён.`) }
    finally { if (!signal.aborted) setRestoring(false) }
  }

  const rejected = !!review?.domains.some(d => d.decisions.some(x => !x.approved))
  const waiting = review && !review.ready && !review.stale && !rejected
  const waitingFor = waiting ? [...new Set(review!.domains.flatMap(d => d.approvers.filter(id => !d.decisions.some(x => x.approver_id === id))))].map(id => names.get(id) ?? 'согласующего') : []
  const primary = !binding || shared || !model ? null
    : waiting ? { label: `Ждёт согласования: ${waitingFor.join(', ') || 'согласующих'}`, disabled: true, run() {} }
    : review?.ready && !review.stale ? { label: 'Опубликовать', disabled: false, run() { void status.publish() } }
    : model.kind === 'saved' ? { label: 'Опубликовать', disabled: false, run() { void status.submit() } }
    : null
  const canRestore = data?.access !== 'read'
  const busy = comparing || restoring || !!disabled

  // Высота панели — по содержимому, не выше карточки гаджета: короткая история не растягивается.
  return <aside data-version-panel aria-label="Версии" className="absolute top-0 right-0 z-30 flex max-h-full w-[min(640px,100%)] flex-col rounded-[20px] bg-kumo-overlay shadow-[0_1px_2px_rgba(24,32,28,0.05),0_16px_40px_rgba(24,32,28,0.08)]">
    <header className="flex shrink-0 items-center gap-3 px-7 pt-[26px] pb-5">
      <button type="button" aria-label="Назад к документу" title="Закрыть" onClick={onClose}
        className="inline-flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-kumo-fill-hover bg-transparent text-kumo-default transition-colors hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring"><CaretLeft size={16} /></button>
      <h2 className="m-0 min-w-0 flex-1 truncate text-[20px] leading-7 font-semibold tracking-[-0.3px] text-kumo-default">{title}</h2>
      {!docked && onCollapseChat && <WorkshopIconButton aria-label="Свернуть беседу" title="Свернуть беседу" className="!h-8 !w-8" onClick={onCollapseChat}><SidebarSimple size={16} /></WorkshopIconButton>}
    </header>
    <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-7 pb-[26px]">
      {status.error && <p role="alert" className={`m-0 ${rowText} text-kumo-danger`}>{status.error}</p>}
      {status.preparing && <HistoryPreparingNotice progress={status.preparing} />}
      {status.notice && <p role="status" className={`m-0 ${rowText}`}>{status.notice}</p>}

      {!binding && section !== 'open' && <SaveToProject gadget={gadget} format={format} snapshotSource={snapshotSource} disabled={disabled} status={status} />}
      {section === 'bind' && <BindingChooser status={status} onDone={() => onSection(null)} />}
      {section === 'save' && binding && model?.kind === 'published' && <Section name="save">
        <NativeDocumentSave gadget={gadget} format={format} snapshotSource={snapshotSource} chatId={chatId} disabled={disabled}
          initialAccountId={binding.accountId ?? undefined} initialScope={binding.scope} initialResource={binding.resource || undefined}
          onSaved={result => status.bind({ accountId: result.accountId, scope: result.scope, resource: result.resource || binding.resource, savedRevision: result.revision })}
          onClose={() => { onSection(null); status.refresh() }} />
      </Section>}

      {showConflict && binding && <Section name="conflict">
        <h3 className="m-0 text-[15px] leading-5 font-semibold text-kumo-default">Конфликт с новой публикацией</h3>
        <NativeDocumentConflict format={format} initialScope={binding.scope} initialResource={binding.resource || undefined} onResolved={status.refresh} onClose={() => onSection(null)} />
      </Section>}

      {binding && <Section name="history">
        <ol aria-label="Версии документа" className="m-0 -mx-3 flex list-none flex-col gap-0.5 p-0">
          {rows.map((row, index) => {
            const published = !row.personal
            const pending = index === 0 && row.personal && waiting
            const decide = index === 0 && row.personal && !waiting && !shared && model?.kind === 'saved'
            const on = index === selected
            const line = versionLine(row, summaries.get(row.id), data?.me)
            return <li key={row.id}>
              <button type="button" aria-pressed={on} onClick={() => { setSelected(index); setComparison(null); setActionError(''); setActionNotice('') }}
                className={`flex w-full cursor-pointer items-start gap-4 rounded-[14px] border-0 px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring ${on ? 'bg-kumo-tint' : 'bg-transparent hover:bg-kumo-tint/60'}`}>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[15px] leading-5 text-kumo-default ${index === 0 || published || on ? 'font-semibold' : ''}`}>Версия {row.number}</span>
                  <span title={line} className="mt-[3px] block truncate text-[14px] leading-5 text-kumo-subtle">{line}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5 pt-px">
                  {published && <span className="rounded-full bg-selection-bg px-2.5 py-0.5 text-[12px] leading-4 font-medium text-selection-text">опубликована</span>}
                  {pending && <span className="rounded-full bg-kumo-warning-tint px-2.5 py-0.5 text-[12px] leading-4 font-medium text-kumo-warning">на согласовании</span>}
                  {decide && <span className="rounded-full bg-kumo-warning-tint px-2.5 py-0.5 text-[12px] leading-4 font-medium text-kumo-warning">ждёт вашего решения</span>}
                  <span className={subText}>{when(row.recordedAt)}</span>
                </span>
              </button>
            </li>
          })}
        </ol>
        {data && rows.length === 0 && <p className={`m-0 ${subText}`}>Версий пока нет: первая появится после сохранения.</p>}
        {current && (previous || (restoreRow && canRestore)) && <div className="flex flex-wrap items-center gap-2 pt-1">
          {previous && <button type="button" className={pillButton} disabled={busy} onClick={() => { void compare() }}>{comparing ? 'Сравниваю…' : `Сравнить ${previous.number} и ${current.number}`}</button>}
          {restoreRow && canRestore && <button type="button" className={pillButton} disabled={busy} onClick={() => { void restore(restoreRow) }}>{restoring ? 'Возвращаю…' : `Вернуть версию ${restoreRow.number}`}</button>}
        </div>}
        {actionError && <p role="alert" className={`m-0 ${rowText} text-kumo-danger`}>{actionError}</p>}
        {actionNotice && <p role="status" className={`m-0 ${rowText}`}>{actionNotice}</p>}
        {comparison && <VersionComparison diff={comparison.diff} labels={comparison.labels} onClose={() => setComparison(null)} />}
        {rows.length > 0 && <p className="m-0 text-[13px] leading-[1.5] text-kumo-subtle">Ни одна версия не пропадает. Вернуть можно любую — это станет новой версией.</p>}
      </Section>}

      {chatId === undefined && (section === 'open' || section === 'reopen') && <NativeDocumentOpen gadget={gadget} format={format} snapshotSource={snapshotSource} disabled={disabled}
        open autoApply={section === 'reopen' || !!launch?.publication}
        initialPublication={section === 'reopen' ? rows[0]?.id : launch?.publication}
        initialAccountId={launch?.accountId ?? binding?.accountId ?? undefined} initialScope={launch?.scope ?? binding?.scope} initialResource={launch?.resource ?? (binding?.resource || undefined)}
        onOpened={async result => {
          // Версия, от которой правит редактор: открытая личная версия.
          const head = result.publication?.startsWith('private:') ? result.publication.slice(8) : undefined
          // Ревизию после открытия сообщает редактор: без неё шапка после перезагрузки сочла бы нетронутый документ несохранённым.
          await status.bindAtEditorRevision({ accountId: result.accountId, scope: result.scope, resource: result.resource, ...(head && /^[a-f0-9]{64}$/.test(head) ? { savedHead: head } : {}), ...(result.revision !== undefined ? { savedRevision: result.revision } : {}) })
          status.reopened(); onLaunchConsumed?.()
        }}
        onClose={() => { onLaunchConsumed?.(); onSection(null) }} reconnect={reloadPage} />}

      {chatId === undefined && <NativeEditorUpdate gadget={gadget} disabled={disabled} snapshotSource={snapshotSource} format={format} onUpdated={() => window.location.reload()} />}

      {primary && <div className="flex justify-end pt-1">
        <button type="button" className={primaryButton} data-version-primary="" disabled={primary.disabled || status.busy || disabled} onClick={primary.run}>{primary.label}</button>
      </div>}
    </div>
  </aside>
}

function Pieces({ pieces }: { pieces: Piece[] }) {
  return <>{pieces.map((piece, i) => piece.op === 'add'
    ? <ins key={i} className="rounded-[3px] bg-selection-bg px-0.5 text-selection-text no-underline">{piece.text}</ins>
    : piece.op === 'del'
      ? <del key={i} className="rounded-[3px] bg-kumo-danger-tint px-0.5 text-kumo-danger">{piece.text}</del>
      : <span key={i}>{piece.text}</span>)}</>
}

/** Абзацы с правками и по одному неизменённому вокруг; длинные неизменённые куски свёрнуты в «…». */
function ParagraphList({ paragraphs }: { paragraphs: ParagraphChange[] }) {
  const changed = paragraphs.map(p => p.op !== 'same')
  const shown = paragraphs.map((_, i) => changed[i] || changed[i - 1] || changed[i + 1])
  const out: ReactNode[] = []
  let lastSection: string | undefined
  paragraphs.forEach((p, i) => {
    if (!shown[i]) { if (shown[i - 1]) out.push(<li key={`gap-${i}`} aria-hidden="true" className="text-kumo-inactive">…</li>); return }
    if (p.op !== 'same' && p.section && p.section !== lastSection) { lastSection = p.section; out.push(<li key={`section-${i}`} className="pt-1 text-[12px] leading-4 font-medium text-kumo-subtle">Раздел «{p.section}»</li>) }
    out.push(<li key={i} data-change={p.op} className={`border-l-2 pl-3 ${p.op === 'same' ? 'border-transparent text-kumo-subtle' : p.op === 'add' ? 'border-kumo-brand' : p.op === 'del' ? 'border-kumo-danger' : 'border-kumo-warning'}`}><Pieces pieces={p.pieces} /></li>)
  })
  return <ol className="m-0 flex list-none flex-col gap-2 p-0 font-serif text-[15px] leading-[1.55] text-kumo-default">{out}</ol>
}

/** Что изменилось между двумя версиями: текст с выделенными добавлениями и удалениями, ячейки, слайды. */
export function VersionComparison({ diff, labels, onClose }: { diff: VersionDiff; labels: [string, string]; onClose(): void }) {
  const nothing = diff.kind === 'document' ? !diff.paragraphs.some(p => p.op !== 'same') && diff.title[0] === diff.title[1]
    : diff.kind === 'spreadsheet' ? !diff.cells.length && !diff.sheets.length : !diff.slides.length
  return <section data-version-comparison aria-label={`Сравнение: ${labels[0]} и ${labels[1]}`} className="flex flex-col gap-3 rounded-2xl border border-kumo-fill p-4">
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="m-0 text-[15px] leading-5 font-semibold text-kumo-default">{labels[0]} → {labels[1]}</h3>
        <p className="m-0 mt-0.5 text-[13px] leading-[18px] text-kumo-subtle">{diff.summary.charAt(0).toUpperCase() + diff.summary.slice(1)}</p>
      </div>
      <button type="button" aria-label="Скрыть сравнение" title="Скрыть сравнение" onClick={onClose}
        className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"><X size={14} /></button>
    </div>
    {nothing && <p className={`m-0 ${subText}`}>Содержимое версий совпадает.</p>}
    {diff.kind === 'document' && diff.title[0] !== diff.title[1] && <p className="m-0 text-[14px] leading-5">Название: <Pieces pieces={[{ text: diff.title[0], op: 'del' }, { text: ' ', op: 'same' }, { text: diff.title[1], op: 'add' }]} /></p>}
    {diff.kind === 'document' && !nothing && <ParagraphList paragraphs={diff.paragraphs} />}
    {diff.kind === 'spreadsheet' && <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[14px] leading-5">
      {diff.sheets.map(s => <li key={`sheet-${s.name}-${s.op}`}>{s.op === 'add' ? 'Добавлен лист' : 'Удалён лист'} «{s.name}»</li>)}
      {diff.cells.slice(0, 200).map(c => <li key={`${c.sheet}-${c.ref}`} data-change="cell" className="flex flex-wrap items-baseline gap-x-2">
        <span className="min-w-[88px] text-kumo-subtle">{c.sheet} · {c.ref}</span>
        {c.before ? <del className="rounded-[3px] bg-kumo-danger-tint px-1 text-kumo-danger">{c.before}</del> : <span className="text-kumo-inactive">пусто</span>}
        <span aria-hidden="true" className="text-kumo-inactive">→</span>
        {c.after ? <ins className="rounded-[3px] bg-selection-bg px-1 text-selection-text no-underline">{c.after}</ins> : <span className="text-kumo-inactive">пусто</span>}
      </li>)}
      {diff.cells.length > 200 && <li className="text-kumo-subtle">И ещё {diff.cells.length - 200} изменённых ячеек.</li>}
    </ul>}
    {diff.kind === 'presentation' && <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {diff.slides.map(s => <li key={`${s.op}-${s.number}`} className="flex flex-col gap-1.5">
        <span className="text-[13px] leading-[18px] font-medium text-kumo-default">Слайд {s.number}: {s.op === 'add' ? 'добавлен' : s.op === 'del' ? 'удалён' : s.op === 'layout' ? 'изменено оформление, текст тот же' : 'изменён текст'}</span>
        {s.paragraphs.length > 0 && <ParagraphList paragraphs={s.paragraphs} />}
      </li>)}
    </ul>}
  </section>
}

/** Документ ещё не в Mnemos. Документ из беседы с проектом сохраняется туда сам — панель говорит, куда и что
 *  происходит; выбор проекта нужен, только когда проект неизвестен или человек хочет другой. */
function SaveToProject({ disabled, status }: { gadget: RpcStub<GadgetClient>; format: NativeDocumentFormat; snapshotSource: NativeSnapshotSourceRef; disabled?: boolean; status: DocumentStatusHandle }) {
  const suggested = status.suggestedProject
  const [open, setOpen] = useState(false), [scopes, setScopes] = useState<{ id: string; name: string }[] | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [chosen, setChosen] = useState('')
  useEffect(() => {
    if (!open) return
    let cancelled = false
    status.listScopes().then(list => { if (!cancelled) setScopes(list) }).catch(() => { if (!cancelled) setError('Проекты не прочитаны. Проверьте подключение Mnemos.') })
    return () => { cancelled = true }
  }, [open, status.busy])
  async function save(scope: string, accountId?: number) {
    if (busy) return
    setBusy(true); setError(''); setChosen(scope)
    const signal = status.lifetime.current.signal
    try { await status.saveToProject(scope, accountId) }
    catch { if (!signal.aborted) setError('Документ не сохранился в проект: Mnemos не ответил. Повторите попытку.') }
    finally { if (!signal.aborted) setBusy(false) }
  }
  const elsewhere = status.creationElsewhere
  const working = busy || !!status.saving
  return <Section name="save">
    <p className={`m-0 ${rowText}`}>Документ ещё не сохранён в Mnemos. После сохранения появятся версии и доступ для коллег.</p>
    {elsewhere ? <p role="status" data-creation-elsewhere="" className={`m-0 ${rowText}`}>
        Документ уже сохраняет другая ваша вкладка или устройство (с {new Date(elsewhere.since).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}). Когда оно закончится, версии появятся здесь сами.
      </p>
      : working ? <p role="status" className={`m-0 ${subText}`}>{status.saving ?? 'Сохраняю…'}</p>
      : suggested && !open ? <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={primaryButton} disabled={disabled} onClick={() => { void save(suggested.projectId, suggested.accountId) }}>Сохранить в «{suggested.title}»</button>
        <button type="button" className={pillButton} disabled={disabled} onClick={() => setOpen(true)}>Другой проект…</button>
      </div>
      : !open ? <div><button type="button" className={primaryButton} disabled={disabled} onClick={() => setOpen(true)}>Сохранить в проект…</button></div>
      : <div role="list" aria-label="Проекты" className="flex flex-wrap gap-2">
        {scopes === null && !error && <p role="status" className={`m-0 ${subText}`}>Загрузка проектов…</p>}
        {scopes?.map(s => <button type="button" key={s.id} role="listitem" aria-pressed={s.id === (chosen || suggested?.projectId)} className={pillButton} disabled={disabled} onClick={() => { void save(s.id) }}>{s.name}</button>)}
        {scopes?.length === 0 && <p className={`m-0 ${subText}`}>Нет проектов, куда можно сохранить.</p>}
      </div>}
    {suggested && !elsewhere && !working && !error && !status.error && !open && <p className={`m-0 ${subText}`}>Документ создан в беседе проекта «{suggested.title}» и сохраняется туда сам, как только в нём появится текст.</p>}
    {error && <p role="alert" className={`m-0 ${rowText} text-kumo-danger`}>{error}</p>}
  </Section>
}

/** Смена документа Mnemos, к которому привязан редактор: редкое действие из меню «…» шапки гаджета. */
function BindingChooser({ status, onDone }: { status: DocumentStatusHandle; onDone(): void }) {
  const [scopes, setScopes] = useState<{ id: string; name: string }[]>([]), [documents, setDocuments] = useState<{ id: string; name: string }[]>([])
  const [scope, setScope] = useState(status.binding?.scope ?? ''), [resource, setResource] = useState(status.binding?.resource ?? '')
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    status.listScopes().then(list => { if (!cancelled) setScopes(list) }).catch(() => { if (!cancelled) setError('Проекты не прочитаны. Проверьте подключение Mnemos.') })
    return () => { cancelled = true }
  }, [status.busy])
  useEffect(() => {
    let cancelled = false
    setDocuments([])
    if (!scope) return
    status.listDocuments(scope).then(list => { if (!cancelled) setDocuments(list) }).catch(() => { if (!cancelled) setError('Документы проекта не прочитаны.') })
    return () => { cancelled = true }
  }, [scope])
  const selectClass = 'block w-full border border-kumo-line rounded-lg p-2 bg-kumo-base'
  return <div className={`flex flex-col gap-2 ${rowText}`}>
    <h3 className="m-0 text-[15px] leading-5 font-semibold">Другой документ Mnemos</h3>
    <label>Проект<select aria-label="Проект документа" className={selectClass} value={scope} onChange={e => { setScope(e.target.value); setResource('') }}>
      <option value="">Выберите проект</option>{scopes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>Документ<select aria-label="Документ Mnemos в редакторе" className={selectClass} value={resource} disabled={!scope} onChange={e => setResource(e.target.value)}>
      <option value="">Выберите документ</option>{documents.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    {error && <p role="alert" className="m-0 text-kumo-danger">{error}</p>}
    <div className="flex justify-end gap-2">
      <WorkshopButton onClick={onDone}>Отмена</WorkshopButton>
      <WorkshopButton tone="primary" className="!h-8" disabled={!scope || !resource} onClick={() => { void status.bindAtEditorRevision({ accountId: status.binding?.accountId ?? null, scope, resource }); onDone() }}>Привязать</WorkshopButton>
    </div>
  </div>
}
