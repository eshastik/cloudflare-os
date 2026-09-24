import type {NativeDocumentLaunch} from './nativeDocumentLaunch'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CaretLeft, SidebarSimple } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import type { GadgetClient } from '@gadgets/workshop-shared/api'
import type { NativeDocumentFormat } from '@gadgets/workshop-shared/native-document'
import { WorkshopButton, WorkshopIconButton } from './components/WorkshopControls'
import { formatAgo, type DocumentStatusHandle, type HistoryEntry } from './DocumentStatus'
import { useAuthenticatedApi } from './AuthContext'
import { listAccounts, storesDocuments } from './accountCapabilities'
import { downloadGatekeeperNativeDocument } from './gatekeeperAppDownload'
import NativeDocumentConflict from './NativeDocumentConflict'
import NativeDocumentOpen from './NativeDocumentOpen'
import { ReviewComparisonView, type ReviewComparison } from './NativeDocumentReviewInbox'
import NativeDocumentSave from './NativeDocumentSave'
import NativeEditorUpdate from './NativeEditorUpdate'
import type { NativeSnapshotSourceRef } from './nativeSnapshotSource'
import { createMnemosDocument, mnemosDocumentName } from './nativeMnemosDocument'

export type PanelSection = 'save' | 'conflict' | 'open' | 'bind' | 'share' | 'reopen' | 'restore'
type Props = {
  launch?: NativeDocumentLaunch; onLaunchConsumed?(): void
  gadget: RpcStub<GadgetClient>; format: NativeDocumentFormat; snapshotSource: NativeSnapshotSourceRef; chatId?: number; disabled?: boolean
  status: DocumentStatusHandle; section: PanelSection | null; onSection(section: PanelSection | null): void; onClose(): void; onCollapseChat?(): void
}

const PANEL_DOCKED_MIN_WIDTH = 1200

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

/** Кто сохранил версию, одной строкой: человек или агент по чьей-то просьбе. */
export function versionAuthor(entry: HistoryEntry): string {
  if (entry.onBehalfOf) return `Агент по просьбе: ${entry.onBehalfOf}`
  if (entry.personal) return entry.author || (entry.actor ? 'Владелец документа' : 'Вы')
  return entry.actor || 'Участник'
}

function when(iso: string) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return Date.now() - t < 24 * 3_600_000 ? formatAgo(iso) : new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

/**
 * «Версии» по макету: плоский список версий, новые сверху; щелчок выбирает версию; внизу «Сравнить N−1 и N» и
 * «Вернуть версию». Одна главная кнопка по состоянию публикации. Сохранение автоматическое, выбора подключения,
 * проекта и документа здесь нет; кто видит документ — в «Поделиться».
 */
export default function DocumentVersionPanel({ launch, onLaunchConsumed, gadget, format, snapshotSource, chatId, disabled, status, section, onSection, onClose, onCollapseChat }: Props) {
  const docked = useDocked()
  const { binding, data, model } = status
  const [comparison, setComparison] = useState<ReviewComparison | null>(null), [comparing, setComparing] = useState(false), [compareError, setCompareError] = useState('')
  const [selected, setSelected] = useState(0)
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)
  const review = data?.review ?? null
  const names = new Map(data?.participants?.map(p => [p.id, p.name || 'Коллега']) ?? [])
  const rows = useMemo(() => versionRows(data?.history ?? []), [data?.history])
  const shared = data?.access && data.access !== 'owner'
  const showConflict = section === 'conflict' || model?.kind === 'conflict'
  const current = rows[selected] ?? null, previous = rows[selected + 1] ?? null
  const restoreRow = selected === 0 ? previous : current
  const title = data?.name ? `Версии «${data.name}»` : 'Версии'
  useEffect(() => { setSelected(0); setComparison(null) }, [binding?.scope, binding?.resource, rows.length])

  async function compare() {
    const transport = status.comparison()
    if (!binding || !current || !previous || !transport?.downloads || comparing) return
    setComparing(true); setCompareError(''); setComparison(null)
    const signal = status.lifetime.current.signal
    try {
      const side = async (row: VersionRow) => {
        using download = await transport.downloads!.select(binding.scope, binding.resource, row.id)
        const ticket = await download.issue(); signal.throwIfAborted()
        return downloadGatekeeperNativeDocument(transport.origin, ticket as never, format, signal, () => download.validate())
      }
      const before = await side(previous), after = await side(current)
      setComparison({ node: binding.resource, metadata: [undefined, undefined], before, after })
    } catch { if (!signal.aborted) setCompareError('Сравнение не открылось: версия могла стать недоступной. Попробуйте ещё раз.') }
    finally { if (!signal.aborted) setComparing(false) }
  }
  // «Вернуть версию»: содержимое версии открывается в редакторе и сохраняется новой версией — старые не пропадают.
  function restore(row: VersionRow) { setRestoreTarget(row.id); onSection('restore') }

  const rejected = !!review?.domains.some(d => d.decisions.some(x => !x.approved))
  const waiting = review && !review.ready && !review.stale && !rejected
  const waitingFor = waiting ? [...new Set(review!.domains.flatMap(d => d.approvers.filter(id => !d.decisions.some(x => x.approver_id === id))))].map(id => names.get(id) ?? 'согласующего') : []
  const primary = !binding || shared || !model ? null
    : waiting ? { label: `Ждёт согласования: ${waitingFor.join(', ') || 'согласующих'}`, disabled: true, run() {} }
    : review?.ready && !review.stale ? { label: 'Опубликовать', disabled: false, run() { void status.publish() } }
    : model.kind === 'saved' ? { label: 'Опубликовать', disabled: false, run() { void status.submit() } }
    : null

  // Панель шириной 640 ложится поверх карточки гаджета справа (макет «Версии»).
  return <aside data-version-panel aria-label="Версии" className="absolute inset-y-0 right-0 z-30 flex w-[min(640px,100%)] flex-col rounded-[20px] bg-kumo-overlay shadow-[0_1px_2px_rgba(24,32,28,0.05),0_16px_40px_rgba(24,32,28,0.08)]">
    <header className="flex shrink-0 items-center gap-3 px-7 pt-6 pb-4">
      <button type="button" aria-label="Назад к документу" title="Закрыть" onClick={onClose}
        className="inline-flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-kumo-fill-hover text-kumo-default transition-colors hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring"><CaretLeft size={16} /></button>
      <h2 className="m-0 min-w-0 flex-1 truncate text-[20px] leading-7 font-semibold tracking-[-0.3px] text-kumo-default">{title}</h2>
      {!docked && onCollapseChat && <WorkshopIconButton aria-label="Свернуть беседу" title="Свернуть беседу" className="!h-8 !w-8" onClick={onCollapseChat}><SidebarSimple size={16} /></WorkshopIconButton>}
    </header>
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-7 pb-6">
      {status.error && <p role="alert" className={`m-0 ${rowText} text-kumo-danger`}>{status.error}</p>}
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
        <ol aria-label="Версии документа" className="m-0 flex list-none flex-col p-0">
          {rows.map((row, index) => {
            const published = !row.personal
            const pending = index === 0 && row.personal && waiting
            const on = index === selected
            return <li key={row.id}>
              <button type="button" aria-pressed={on} onClick={() => { setSelected(index); setComparison(null) }}
                className={`grid w-full cursor-pointer grid-cols-[20px_minmax(0,1fr)_auto] gap-3.5 border-0 border-b border-kumo-fill px-1 py-3.5 text-left last:border-b-0 ${on ? 'bg-kumo-tint' : 'bg-transparent hover:bg-kumo-tint'}`}>
                <span className={`mt-1 h-3 w-3 rounded-full ${pending ? 'bg-kumo-warning' : published && rows.findIndex(r => !r.personal) === index ? 'bg-kumo-brand' : 'border-2 border-kumo-interact'}`} />
                <span className="min-w-0">
                  <span className={`block text-[15px] leading-5 text-kumo-default ${index === 0 || published ? 'font-semibold' : ''}`}>Версия {row.number}{published ? ' · опубликована' : pending ? ' — ждёт согласования' : ''}</span>
                  <span className={`${subText} mt-0.5 block truncate text-[14px]`}>{versionAuthor(row)}</span>
                </span>
                <span className={subText}>{when(row.recordedAt)}</span>
              </button>
            </li>
          })}
        </ol>
        {data && rows.length === 0 && <p className={`m-0 px-0.5 ${subText}`}>Версий пока нет: первая появится после сохранения.</p>}
        {current && <div className="flex flex-wrap gap-2 pt-1">
          {previous && <WorkshopButton disabled={comparing || disabled} onClick={() => { void compare() }}>Сравнить {previous.number} и {current.number}</WorkshopButton>}
          {restoreRow && chatId === undefined && data?.access !== 'read' && <WorkshopButton disabled={disabled} onClick={() => restore(restoreRow)}>Вернуть версию {restoreRow.number}</WorkshopButton>}
        </div>}
        {compareError && <p role="alert" className={`m-0 ${rowText} text-kumo-danger`}>{compareError}</p>}
        {comparing && <p role="status" className={`m-0 ${subText}`}>Загрузка сравнения…</p>}
        {comparison && current && previous && <div className="rounded-xl border border-kumo-line bg-kumo-base p-3"><ReviewComparisonView preview={comparison} labels={[`Версия ${previous.number}`, `Версия ${current.number}`]} /></div>}
        <p className={`m-0 ${subText}`}>Ни одна версия не пропадает. Вернуть можно любую — это станет новой версией.</p>
      </Section>}

      {chatId === undefined && <NativeDocumentOpen gadget={gadget} format={format} snapshotSource={snapshotSource} disabled={disabled}
        open={section === 'open' || section === 'reopen' || section === 'restore'} autoApply={section === 'reopen' || section === 'restore' || !!launch?.publication}
        initialPublication={section === 'restore' ? restoreTarget ?? undefined : section === 'reopen' ? rows[0]?.id : launch?.publication}
        initialAccountId={launch?.accountId ?? binding?.accountId ?? undefined} initialScope={launch?.scope ?? binding?.scope} initialResource={launch?.resource ?? (binding?.resource || undefined)}
        onOpened={async result => {
          const restoring = section === 'restore'
          // Версия, от которой правит редактор: открытая личная версия; при возврате старой — текущая версия документа.
          const head = !restoring && result.publication?.startsWith('private:') ? result.publication.slice(8) : restoring ? status.data?.head : undefined
          await status.bindAtEditorRevision({ accountId: result.accountId, scope: result.scope, resource: result.resource, ...(head && /^[a-f0-9]{64}$/.test(head) ? { savedHead: head } : {}) }, restoring)
          status.reopened(); onLaunchConsumed?.()
        }}
        onClose={() => { onLaunchConsumed?.(); onSection(null) }} reconnect={() => window.location.reload()} />}

      {chatId === undefined && <NativeEditorUpdate gadget={gadget} disabled={disabled} snapshotSource={snapshotSource} format={format} onUpdated={() => window.location.reload()} />}
    </div>
    {primary && <footer className="flex shrink-0 justify-end gap-2 border-t border-kumo-fill px-7 py-4">
      <WorkshopButton tone="primary" data-version-primary="" disabled={primary.disabled || status.busy || disabled} onClick={primary.run}>{primary.label}</WorkshopButton>
    </footer>}
  </aside>
}

/** Документ ещё не в Mnemos: одна кнопка «Сохранить в проект…» и выбор одного проекта. */
function SaveToProject({ gadget, format, snapshotSource, disabled, status }: { gadget: RpcStub<GadgetClient>; format: NativeDocumentFormat; snapshotSource: NativeSnapshotSourceRef; disabled?: boolean; status: DocumentStatusHandle }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const [open, setOpen] = useState(false), [scopes, setScopes] = useState<{ id: string; name: string }[] | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    let cancelled = false
    status.listScopes().then(list => { if (!cancelled) setScopes(list) }).catch(() => { if (!cancelled) setError('Проекты не прочитаны. Проверьте подключение Mnemos.') })
    return () => { cancelled = true }
  }, [open, status.busy])
  async function save(scope: string) {
    const selector = status.selector()
    if (!selector || busy) return
    setBusy(true); setError('')
    const signal = status.lifetime.current.signal
    try {
      const accountId = status.suggestedProject?.accountId ?? (await listAccounts(authenticatedApi)).find(storesDocuments)?.id
      if (accountId === undefined) throw new Error('no account')
      const read = snapshotSource.current
      const snapshot = read ? await read(format, signal) : null
      const name = mnemosDocumentName(format, snapshot?.document, await Promise.resolve(gadget.getTitle()).catch(() => ''))
      const writes = { selector, storageOrigin: status.writesOrigin() }
      const created = await createMnemosDocument({ gadget, writes, format, snapshotSource, accountId, scope, name, signal })
      if (created) status.bind(created)
      else setError('Документ уже сохраняется в другой вкладке. Обновите страницу через минуту.')
    } catch { if (!signal.aborted) setError('Документ не сохранился в проект. Повторите попытку.') }
    finally { if (!signal.aborted) setBusy(false) }
  }
  return <Section name="save">
    <p className={`m-0 ${rowText}`}>Документ ещё не сохранён в Mnemos. После сохранения появятся версии и доступ для коллег.</p>
    {!open ? <div><WorkshopButton tone="primary" disabled={disabled} onClick={() => setOpen(true)}>Сохранить в проект…</WorkshopButton></div>
      : <div role="list" aria-label="Проекты" className="flex flex-wrap gap-2">
        {scopes === null && !error && <p role="status" className={`m-0 ${subText}`}>Загрузка проектов…</p>}
        {scopes?.map(s => <WorkshopButton key={s.id} role="listitem" disabled={busy || disabled} onClick={() => { void save(s.id) }}>{s.name}</WorkshopButton>)}
        {scopes?.length === 0 && <p className={`m-0 ${subText}`}>Нет проектов, куда можно сохранить.</p>}
      </div>}
    {busy && <p role="status" className={`m-0 ${subText}`}>Сохраняю…</p>}
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
