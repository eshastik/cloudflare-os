import type {NativeDocumentLaunch} from './nativeDocumentLaunch'
import { useEffect, useState, type ReactNode } from 'react'
import { CaretLeft, Plus, SidebarSimple } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import type { GadgetClient } from '@gadgets/workshop-shared/api'
import type { NativeDocumentFormat } from '@gadgets/workshop-shared/native-document'
import { WorkshopButton, WorkshopIconButton } from './components/WorkshopControls'
import { formatAgo, type DocumentStatusHandle } from './DocumentStatus'
import NativeDocumentConflict from './NativeDocumentConflict'
import NativeDocumentOpen from './NativeDocumentOpen'
import NativeDocumentParticipants from './NativeDocumentParticipants'
import NativeDocumentReviewInbox, { ReviewComparisonView, loadReviewComparison, type ReviewComparison } from './NativeDocumentReviewInbox'
import NativeDocumentSave from './NativeDocumentSave'
import NativeEditorUpdate from './NativeEditorUpdate'
import type { NativeSnapshotSourceRef } from './nativeSnapshotSource'
import { mnemosDocumentName } from './nativeMnemosDocument'

export type PanelSection = 'save' | 'conflict' | 'invite' | 'open' | 'bind'
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
const modeLabel = (mode: string) => mode === 'write' ? 'Приглашение · Редактирование' : 'Приглашение · Чтение'
const badgeTone = { neutral: 'bg-kumo-fill text-kumo-default', success: 'bg-kumo-success-tint text-kumo-default', warning: 'bg-kumo-warning-tint text-kumo-default', danger: 'bg-kumo-danger-tint text-kumo-default' } as const

function Badge({ tone, children }: { tone: keyof typeof badgeTone; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[12px] leading-4 font-medium whitespace-nowrap ${badgeTone[tone]}`}>{children}</span>
}
function Section({ label, name, children }: { label: string; name?: string; children: ReactNode }) {
  return <section data-section={name} className="flex flex-col gap-2.5">
    <h3 className="m-0 text-[15px] leading-5 font-semibold text-kumo-default">{label}</h3>
    {children}
  </section>
}
function Rows({ children }: { children: ReactNode }) {
  return <div className="flex flex-col divide-y divide-kumo-fill overflow-hidden rounded-2xl border border-kumo-fill bg-kumo-overlay">{children}</div>
}
function Row({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex items-center gap-3 px-4 py-3 ${className}`}>{children}</div>
}
function Avatar({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'
  return <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-kumo-tint text-[13px] font-semibold text-kumo-default">{initials}</span>
}

export default function DocumentVersionPanel({ launch, onLaunchConsumed, gadget, format, snapshotSource, chatId, disabled, status, section, onSection, onClose, onCollapseChat }: Props) {
  const docked = useDocked()
  const { binding, data, model } = status
  const [comparison, setComparison] = useState<ReviewComparison | null>(null), [comparing, setComparing] = useState(false), [compareError, setCompareError] = useState('')
  const names = new Map(data?.participants?.map(p => [p.id, p.name || 'Участник']) ?? [])
  const review = data?.review ?? null
  const invited = data?.participants?.filter(p => p.mode !== '') ?? []
  const showConflict = section === 'conflict' || model?.kind === 'conflict'
  // Имя нового документа в Mnemos — название из шапки редактора.
  const [documentTitle, setDocumentTitle] = useState<string | null>(null)
  useEffect(() => {
    if (binding || section !== 'save') return
    const abort = new AbortController()
    setDocumentTitle(null)
    const read = snapshotSource.current
    void (read ? read(format, abort.signal) : Promise.reject(new Error())).then(
      snapshot => { if (!abort.signal.aborted) setDocumentTitle(mnemosDocumentName(format, snapshot.document)) },
      () => { if (!abort.signal.aborted) setDocumentTitle('') })
    return () => abort.abort()
  }, [binding, section, format, snapshotSource])
  // В панели документ и проект называются по имени, а не опознавателем хранилища.
  const [documentName, setDocumentName] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setDocumentName(null)
    if (!binding?.resource) return
    status.listDocuments(binding.scope)
      .then(list => { if (!cancelled) setDocumentName(list.find(d => d.id === binding.resource)?.name ?? null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [binding?.scope, binding?.resource, status.busy])

  async function compare() {
    const transport = status.comparison()
    if (!review || !binding || !transport?.downloads || comparing) return
    const node = review.domains.some(d => d.node_ids.includes(binding.resource)) ? binding.resource : review.domains[0]?.node_ids[0]
    if (!node) return
    setComparing(true); setCompareError(''); setComparison(null)
    const signal = status.lifetime.current.signal
    try {
      const loaded = await loadReviewComparison(transport.selector, { selector: transport.downloads, origin: transport.origin }, review, node, format, signal)
      setComparison(loaded.preview)
    } catch { if (!signal.aborted) setCompareError('Сравнение не подтверждено: заявка могла измениться. Перечитайте состояние.') }
    finally { if (!signal.aborted) setComparing(false) }
  }

  // Панель шириной 640 ложится поверх карточки гаджета справа (макет «Версии»).
  return <aside data-version-panel aria-label="Версии" className="absolute inset-y-0 right-0 z-30 flex w-[min(640px,100%)] flex-col rounded-[20px] bg-kumo-overlay shadow-[0_1px_2px_rgba(24,32,28,0.05),0_16px_40px_rgba(24,32,28,0.08)]">
    <header className="flex shrink-0 items-center gap-3 px-7 pt-6 pb-4">
      <button type="button" aria-label="Назад к документу" title="Закрыть" onClick={onClose}
        className="inline-flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-kumo-fill-hover text-kumo-default transition-colors hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring"><CaretLeft size={16} /></button>
      <h2 className="m-0 min-w-0 flex-1 truncate text-[20px] leading-7 font-semibold tracking-[-0.3px] text-kumo-default">Версии</h2>
      {!docked && onCollapseChat && <WorkshopIconButton aria-label="Свернуть беседу" title="Свернуть беседу" className="!h-8 !w-8" onClick={onCollapseChat}><SidebarSimple size={16} /></WorkshopIconButton>}
    </header>
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-7 pb-6">
      <Section label="Документ Mnemos" name="binding">
        {binding && section !== 'bind' ? <Rows><Row>
          <div className="min-w-0 flex-1">
            <div className={`${rowText} truncate`}>{binding.resource ? documentName ?? 'Документ Mnemos' : 'Документ не выбран'}</div>
            <div className={`${subText} truncate`}>Проект: {status.projectLink?.name ?? 'выбран'}</div>
          </div>
          <WorkshopButton disabled={status.busy} onClick={() => onSection('bind')}>Сменить</WorkshopButton>
          <WorkshopButton disabled={status.busy} onClick={status.refresh}>Перечитать</WorkshopButton>
        </Row></Rows> : <>
          {!binding && section !== 'save' && <Rows><Row>
            <div className="min-w-0 flex-1">
              <div className={rowText}>Документ ещё не сохранён в Mnemos</div>
              <div className={subText}>После сохранения в проект появятся версии, согласование и скачивание в Word.</div>
            </div>
            <WorkshopButton tone="primary" disabled={disabled} onClick={() => onSection('save')}>Сохранить в проект…</WorkshopButton>
          </Row></Rows>}
          {section !== 'save' && <BindingChooser status={status} onDone={() => onSection(null)} />}
        </>}
        {status.error && <p role="alert" className={`m-0 ${rowText} text-kumo-danger`}>{status.error}</p>}
        {status.notice && <p role="status" className={`m-0 ${rowText}`}>{status.notice}</p>}
      </Section>

      {section === 'save' && binding && <Section label={model?.kind === 'published' ? 'Начать личную версию' : 'Сохранить в личную версию'} name="save">
        <NativeDocumentSave gadget={gadget} format={format} snapshotSource={snapshotSource} chatId={chatId} disabled={disabled}
          initialAccountId={binding.accountId ?? undefined} initialScope={binding.scope} initialResource={binding.resource || undefined}
          onSaved={result => status.bind({ accountId: result.accountId, scope: result.scope, resource: result.resource || binding.resource, savedRevision: result.revision })}
          onClose={() => { onSection(null); status.refresh() }} />
      </Section>}

      {section === 'save' && !binding && <Section label="Сохранить в проект" name="save">
        {documentTitle === null && <p role="status" className={`m-0 ${subText}`}>Читаю название документа…</p>}
        {documentTitle !== null && 
        <NativeDocumentSave gadget={gadget} format={format} snapshotSource={snapshotSource} chatId={chatId} disabled={disabled}
          initialAccountId={status.suggestedProject?.accountId} initialScope={status.suggestedProject?.projectId} initialName={documentTitle ?? ''}
          onSaved={result => { if (result.resource) status.bind({ accountId: result.accountId, scope: result.scope, resource: result.resource, savedRevision: result.revision }) }}
          onClose={() => { onSection(null); status.refresh() }} />}
      </Section>}

      {showConflict && binding && <Section label="Конфликт с новой публикацией" name="conflict">
        <NativeDocumentConflict format={format} initialScope={binding.scope} initialResource={binding.resource || undefined} onResolved={status.refresh} onClose={() => onSection(null)} />
      </Section>}

      {binding && model && <Section label="Что уйдёт на согласование" name="scope">
        <Rows><Row><div className="min-w-0 flex-1">
          <div className={rowText}>Имя, папка и текст личной версии</div>
          <div className={subText}>{model.kind === 'unsaved' || model.kind === 'unverified' ? `${model.saved} · сначала сохраните` : model.kind === 'unread' ? model.saved : model.kind === 'published' ? 'личной версии пока нет' : 'все сохранённые изменения личной ветки проекта'}</div>
        </div></Row></Rows>
      </Section>}

      {binding && <Section label="Согласование для публикации" name="approvers">
        <Rows>
          {review ? review.domains.flatMap(domain => domain.approvers.map(id => {
            const decision = domain.decisions.find(d => d.approver_id === id) as (typeof domain.decisions[number] & { comment?: string }) | undefined
            return <Row key={`${domain.domain_id}:${id}`}>
              <Avatar name={names.get(id) ?? 'Согласующий'} />
              <div className="min-w-0 flex-1">
                <div className={rowText}>{domain.domain_id}</div>
                <div className={`${subText} truncate`}>{names.get(id) ?? 'Согласующий'}</div>
                {decision && !decision.approved && <div className={`${subText} mt-0.5 text-kumo-default`}>{decision.comment ? `«${decision.comment}»` : 'без комментария'}</div>}
              </div>
              {review.stale ? <Badge tone="warning">Устарело</Badge> : !decision ? <Badge tone="neutral">Ждёт</Badge> : decision.approved ? <Badge tone="success">Одобрено</Badge> : <Badge tone="danger">Отклонено</Badge>}
            </Row>
          })) : <Row><div className="min-w-0 flex-1">
            <div className={rowText}>Направления задаст политика проекта</div>
            <div className={subText}>согласующие станут известны после отправки</div>
          </div><Badge tone="neutral">Не отправлено</Badge></Row>}
        </Rows>
        <p className={`m-0 px-0.5 ${subText}`}>Задано политикой проекта для этой папки. Изменение имени, папки или текста после отправки запускает согласование заново.</p>
      </Section>}

      {binding && <Section label="Кто видит эту версию" name="participants">
        <Rows>
          <Row><Avatar name="Вы" /><div className="min-w-0 flex-1"><div className={rowText}>Вы</div><div className={subText}>{model?.kind === 'published' ? 'Опубликованную версию видят все участники проекта' : 'Владелец личной версии'}</div></div></Row>
          {invited.map(p => <Row key={p.id}><Avatar name={p.name || 'Участник'} /><div className="min-w-0 flex-1"><div className={`${rowText} truncate`}>{p.name || 'Участник'}</div><div className={subText}>{modeLabel(p.mode)}</div></div></Row>)}
          {data && data.participants === null && model?.kind !== 'published' && <Row><div className={`min-w-0 flex-1 ${subText}`}>Приглашённые не прочитаны: список видит владелец черновика.</div></Row>}
          <Row className="text-kumo-subtle"><button type="button" className={`flex flex-1 cursor-pointer items-center gap-3 bg-transparent p-0 text-left ${rowText} text-kumo-subtle hover:text-kumo-default`} disabled={disabled} onClick={() => onSection(section === 'invite' ? null : 'invite')}>
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-kumo-ring"><Plus size={14} /></span>Пригласить
          </button></Row>
        </Rows>
        {section === 'invite' && <NativeDocumentParticipants format={format} initialScope={binding.scope} initialResource={binding.resource || undefined} onChanged={status.refresh} onClose={() => onSection(null)} />}
      </Section>}

      {binding && <Section label="История" name="history">
        <ol className="m-0 flex list-none flex-col p-0">
          {data?.history.map((entry, index) => <li key={entry.id} className="grid grid-cols-[20px_minmax(0,1fr)] gap-3.5 border-b border-kumo-fill py-3.5 last:border-b-0">
            <span className={`mt-1 h-3 w-3 rounded-full ${entry.personal ? 'bg-kumo-warning' : index === data.history.findIndex(h => !h.personal) ? 'bg-kumo-brand' : 'border-2 border-kumo-interact'}`} />
            <div className="min-w-0">
              <div className={`text-[15px] leading-5 text-kumo-default ${entry.personal || index === data.history.findIndex(h => !h.personal) ? 'font-semibold' : ''}`}>{entry.personal ? entry.label : `${entry.label} · опубликована`}</div>
              <div className={`${subText} mt-0.5 truncate text-[14px]`}>{entry.personal ? `сохранена ${formatAgo(entry.recordedAt)}` : `${new Date(entry.recordedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}${entry.onBehalfOf ? ` · агент ${entry.actor} от имени ${entry.onBehalfOf}` : entry.actor ? ` · ${entry.actor}` : ''}`}</div>
            </div>
          </li>)}
        </ol>
        <div className="flex flex-col">
          {data && data.history.length === 0 && <p className={`m-0 px-0.5 ${subText}`}>Версий пока нет.</p>}
          <div className="flex flex-wrap gap-2 px-0.5 pt-1.5">
            {review && !review.stale && data?.sharedVersion && <WorkshopButton disabled={comparing} onClick={() => { void compare() }}>Сравнить с {data.sharedVersion}</WorkshopButton>}
            {chatId === undefined && <WorkshopButton disabled={disabled} onClick={() => onSection(section === 'open' ? null : 'open')}>Открыть другую версию</WorkshopButton>}
          </div>
          {compareError && <p role="alert" className={`m-0 px-0.5 ${rowText} text-kumo-danger`}>{compareError}</p>}
          {comparing && <p role="status" className={`m-0 px-0.5 ${subText}`}>Загрузка сравнения…</p>}
        </div>
        {comparison && <div className="rounded-xl border border-kumo-line bg-kumo-base p-3"><ReviewComparisonView preview={comparison} /></div>}
      </Section>}

      {chatId === undefined && <NativeDocumentOpen gadget={gadget} format={format} snapshotSource={snapshotSource} disabled={disabled} open={section === 'open'}
        initialPublication={launch?.publication}
        initialAccountId={launch?.accountId ?? binding?.accountId ?? undefined} initialScope={launch?.scope ?? binding?.scope} initialResource={launch?.resource ?? (binding?.resource || undefined)}
        onOpened={async result => { await status.bindAtEditorRevision({ accountId: result.accountId, scope: result.scope, resource: result.resource }); onLaunchConsumed?.() }}
        onClose={() => { onLaunchConsumed?.(); onSection(null) }} reconnect={() => window.location.reload()} />}

      <Section label="Согласование мне" name="inbox">
        <NativeDocumentReviewInbox format={format} closable={false} />
      </Section>

      {chatId === undefined && <NativeEditorUpdate gadget={gadget} disabled={disabled} snapshotSource={snapshotSource} format={format} onUpdated={() => window.location.reload()} />}
      <p className="m-0 mt-auto text-[13px] leading-5 text-kumo-subtle">Опубликованные версии не пропадают. Открыть можно любую из истории.</p>
    </div>
  </aside>
}

/** Выбор проекта и документа Mnemos, к которым относится редактор; выбор хранится на вкладке. */
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
    <p className={`m-0 ${subText}`}>Укажите, какой документ Mnemos открыт в редакторе: по нему читаются версия, приглашённые и согласование.</p>
    <label>Проект<select aria-label="Проект документа" className={selectClass} value={scope} onChange={e => { setScope(e.target.value); setResource('') }}>
      <option value="">Выберите проект</option>{scopes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>Документ<select aria-label="Документ Mnemos в редакторе" className={selectClass} value={resource} disabled={!scope} onChange={e => setResource(e.target.value)}>
      <option value="">Выберите документ</option>{documents.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    {error && <p role="alert" className="m-0 text-kumo-danger">{error}</p>}
    <div className="flex justify-end gap-2">
      {status.binding && <WorkshopButton onClick={onDone}>Отмена</WorkshopButton>}
      <WorkshopButton tone="primary" className="!h-8" disabled={!scope || !resource} onClick={() => { void status.bindAtEditorRevision({ accountId: status.binding?.accountId ?? null, scope, resource }); onDone() }}>Привязать</WorkshopButton>
    </div>
  </div>
}
