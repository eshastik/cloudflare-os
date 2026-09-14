import { useEffect, useState, type ReactNode } from 'react'
import { Plus, SidebarSimple, X } from '@phosphor-icons/react'
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

export type PanelSection = 'save' | 'conflict' | 'invite' | 'open' | 'bind'
type Props = {
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

const rowText = 'text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default'
const subText = 'text-[12px] leading-4 tracking-[-0.2px] text-kumo-subtle'
const modeLabel = (mode: string) => mode === 'write' ? 'Приглашение · Редактирование' : 'Приглашение · Чтение'
const badgeTone = { neutral: 'bg-kumo-fill text-kumo-default', success: 'bg-kumo-success-tint text-kumo-default', warning: 'bg-kumo-warning-tint text-kumo-default', danger: 'bg-kumo-danger-tint text-kumo-default' } as const

function Badge({ tone, children }: { tone: keyof typeof badgeTone; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[12px] leading-4 font-medium whitespace-nowrap ${badgeTone[tone]}`}>{children}</span>
}
function Section({ label, name, children }: { label: string; name?: string; children: ReactNode }) {
  return <section data-section={name} className="flex flex-col gap-2.5">
    <h3 className="m-0 text-[11px] leading-4 font-semibold uppercase tracking-[0.9px] text-kumo-subtle">{label}</h3>
    {children}
  </section>
}
function Rows({ children }: { children: ReactNode }) {
  return <div className="flex flex-col divide-y divide-kumo-line overflow-hidden rounded-xl border border-kumo-line bg-kumo-base">{children}</div>
}
function Row({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex items-center gap-3 px-3 py-2.5 ${className}`}>{children}</div>
}
function Avatar({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'
  return <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-[11px] font-semibold text-kumo-default">{initials}</span>
}

export default function DocumentVersionPanel({ gadget, format, snapshotSource, chatId, disabled, status, section, onSection, onClose, onCollapseChat }: Props) {
  const docked = useDocked()
  const { binding, data, model } = status
  const [comparison, setComparison] = useState<ReviewComparison | null>(null), [comparing, setComparing] = useState(false), [compareError, setCompareError] = useState('')
  const names = new Map(data?.participants?.map(p => [p.id, p.name || 'Участник']) ?? [])
  const review = data?.review ?? null
  const invited = data?.participants?.filter(p => p.mode !== '') ?? []
  const showConflict = section === 'conflict' || model?.kind === 'conflict'

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

  return <aside data-version-panel className={`flex flex-col border-l border-kumo-line bg-kumo-elevated ${docked ? 'h-full w-[320px] shrink-0' : 'absolute inset-y-0 right-0 z-20 w-[320px] max-w-full shadow-[0_10px_28px_-16px_rgba(20,17,16,0.4)]'}`}>
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-kumo-line px-4">
      <h2 className="m-0 text-[14px] leading-5 font-medium tracking-[-0.25px] text-kumo-strong">Версия</h2>
      <div className="flex items-center gap-1">
        {!docked && onCollapseChat && <WorkshopIconButton aria-label="Свернуть чат" title="Свернуть чат" className="!h-7 !w-7" onClick={onCollapseChat}><SidebarSimple size={15} /></WorkshopIconButton>}
        <WorkshopIconButton aria-label="Закрыть панель" title="Закрыть" className="!h-7 !w-7" onClick={onClose}><X size={14} /></WorkshopIconButton>
      </div>
    </header>
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
      <Section label="Документ Mnemos" name="binding">
        {binding && section !== 'bind' ? <Rows><Row>
          <div className="min-w-0 flex-1">
            <div className={`${rowText} truncate`}>{binding.resource || 'Документ не выбран'}</div>
            <div className={`${subText} truncate`}>Проект: {binding.scope}</div>
          </div>
          <WorkshopButton disabled={status.busy} onClick={() => onSection('bind')}>Сменить</WorkshopButton>
          <WorkshopButton disabled={status.busy} onClick={status.refresh}>Перечитать</WorkshopButton>
        </Row></Rows> : <BindingChooser status={status} onDone={() => onSection(null)} />}
        {status.error && <p role="alert" className={`m-0 ${rowText} text-kumo-danger`}>{status.error}</p>}
        {status.notice && <p role="status" className={`m-0 ${rowText}`}>{status.notice}</p>}
      </Section>

      {section === 'save' && binding && <Section label={model?.kind === 'published' ? 'Начать личную версию' : 'Сохранить в личную версию'} name="save">
        <NativeDocumentSave gadget={gadget} format={format} snapshotSource={snapshotSource} chatId={chatId} disabled={disabled}
          initialAccountId={binding.accountId ?? undefined} initialScope={binding.scope} initialResource={binding.resource || undefined}
          onSaved={result => status.bind({ accountId: result.accountId, scope: result.scope, resource: result.resource || binding.resource, savedRevision: result.revision })}
          onClose={() => { onSection(null); status.refresh() }} />
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
              <Avatar name={names.get(id) ?? id} />
              <div className="min-w-0 flex-1">
                <div className={rowText}>{domain.domain_id}</div>
                <div className={`${subText} truncate`}>{names.get(id) ?? id}</div>
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
        <div className="flex flex-col">
          {data?.history.map(entry => <div key={entry.id} className="flex gap-2.5 px-0.5 py-1.5">
            <span className={`mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full ${entry.personal ? 'bg-kumo-brand' : 'bg-kumo-inactive'}`} />
            <div className="min-w-0">
              <div className={rowText}>{entry.personal ? entry.label : `${entry.label} опубликована`}</div>
              <div className={`${subText} truncate`}>{entry.personal ? `сохранена ${formatAgo(entry.recordedAt)}` : `${new Date(entry.recordedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}${entry.onBehalfOf ? ` · агент ${entry.actor} от имени ${entry.onBehalfOf}` : entry.actor ? ` · ${entry.actor}` : ''}`}</div>
            </div>
          </div>)}
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
        initialAccountId={binding?.accountId ?? undefined} initialScope={binding?.scope} initialResource={binding?.resource || undefined}
        onOpened={result => status.bindAtEditorRevision({ accountId: result.accountId, scope: result.scope, resource: result.resource })}
        onClose={() => onSection(null)} reconnect={() => window.location.reload()} />}

      <Section label="Согласование мне" name="inbox">
        <NativeDocumentReviewInbox format={format} closable={false} />
      </Section>

      {chatId === undefined && <NativeEditorUpdate gadget={gadget} disabled={disabled} snapshotSource={snapshotSource} format={format} onUpdated={() => window.location.reload()} />}
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
