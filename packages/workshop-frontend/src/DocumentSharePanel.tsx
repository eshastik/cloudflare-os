import { useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, CaretLeft, CaretRight, Check, MagnifyingGlass } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import type { GatekeeperNativeDocumentWriteSelector } from '@gadgets/workshop-shared/gatekeeper'
import type { NativeDocumentFormat } from '@gadgets/workshop-shared/native-document'
import type { DocumentBinding } from './DocumentStatus'
import { plural } from './versionDiff'

/** Отделы организации для выбора людей (метод моста `orgUnits`; в общем описании селектора его пока нет). */
export type ShareUnit = { id: string; name: string; members: { id: string; name: string }[] }
type Selector = RpcStub<GatekeeperNativeDocumentWriteSelector>
type Page = Awaited<ReturnType<Selector['participants']>>
export type SharePerson = Page['participants'][number]
type Level = 'private' | 'department' | 'organization'
type Right = 'write' | 'read'

/** Сколько страниц людей читать; в странице 50 человек. */
const PEOPLE_PAGES = 5
/** Недавние приглашённые — удобство одного браузера, не источник прав. */
const RECENT_KEY = 'mnemos-share-recent'

const LEVELS: { id: Level; title: string }[] = [
  { id: 'private', title: 'Только приглашённые' },
  { id: 'department', title: 'Мой отдел' },
  { id: 'organization', title: 'Вся организация' },
]
function levelLine(level: Level, project: string, pending: Level | null) {
  if (pending) return `Запрос открыть проект «${project}» ${pending === 'organization' ? 'всей организации' : 'отделу'} ждёт решения руководителя.`
  return level === 'private' ? 'Видят только вы и те, кого вы пригласили.' : level === 'department' ? `Видит ваш отдел: весь проект «${project}».` : `Видит вся организация: весь проект «${project}».`
}

/** Человек в списке выбора: может ли его пригласить владелец документа и почему нет. */
export type Candidate = { id: string; name: string; unit: string; person: SharePerson | null }
export type CandidateGroup = { id: string; title: string; people: Candidate[]; mine: boolean; unit: boolean }

/**
 * Кого можно пригласить, по группам: «Недавние», затем отделы (свой первым), затем остальные коллеги.
 * Уже имеющие доступ сюда не попадают. Человек из отдела, которого нет среди людей проекта, остаётся в
 * списке с person=null: у него нет доступа к проекту, и молча его не прячем.
 */
export function shareCandidates(people: SharePerson[], units: ShareUnit[], me: string, recent: string[]): CandidateGroup[] {
  const byId = new Map(people.map(p => [p.id, p]))
  const has = (id: string) => (byId.get(id)?.mode ?? '') !== ''
  const unitOf = new Map<string, string>()
  for (const u of units) for (const m of u.members) if (!unitOf.has(m.id)) unitOf.set(m.id, u.name)
  const candidate = (id: string, name: string): Candidate => ({ id, name: byId.get(id)?.name || name || 'Коллега', unit: unitOf.get(id) ?? '', person: byId.get(id) ?? null })
  const sort = (list: Candidate[]) => list.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  const groups: CandidateGroup[] = []
  const recentPeople = recent.filter(id => id !== me && !has(id) && (byId.has(id) || unitOf.has(id))).map(id => candidate(id, units.flatMap(u => u.members).find(m => m.id === id)?.name ?? ''))
  if (recentPeople.length) groups.push({ id: 'recent', title: 'Недавние', people: recentPeople.slice(0, 6), mine: false, unit: false })
  const placed = new Set<string>()
  const ordered = [...units].sort((a, b) => Number(b.members.some(m => m.id === me)) - Number(a.members.some(m => m.id === me)) || a.name.localeCompare(b.name, 'ru'))
  for (const u of ordered) {
    const list = sort(u.members.filter(m => m.id !== me && !has(m.id)).map(m => candidate(m.id, m.name)))
    list.forEach(c => placed.add(c.id))
    if (list.length) groups.push({ id: `unit:${u.id}`, title: u.name, people: list, mine: u.members.some(m => m.id === me), unit: true })
  }
  const rest = sort(people.filter(p => p.id !== me && p.mode === '' && !placed.has(p.id)).map(p => candidate(p.id, p.name)))
  if (rest.length) groups.push({ id: 'rest', title: units.length ? 'Другие коллеги' : 'Коллеги', people: rest, mine: !units.length, unit: false })
  return groups
}

function readRecent(): string[] {
  try { const value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string').slice(0, 20) : [] } catch { return [] }
}
function rememberRecent(ids: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([...new Set([...ids, ...readRecent()])].slice(0, 20))) } catch { /* без памяти браузера список «Недавние» просто короче */ }
}

const tones = ['bg-selection-bg text-selection-text', 'bg-kumo-warning-tint text-kumo-warning', 'bg-kumo-info-tint text-kumo-default', 'bg-kumo-tint text-kumo-default']
function Avatar({ name, id }: { name: string; id: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'
  const tone = tones[[...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % tones.length]
  return <span aria-hidden="true" className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${tone}`}>{initials}</span>
}

const RIGHTS: { id: Right; title: string }[] = [{ id: 'write', title: 'может править' }, { id: 'read', title: 'может смотреть' }]

/** Право приглашённого в строке: «может править ▾» раскрывает два варианта; выбор сохраняется сразу. */
function RightMenu({ person, disabled, onChange }: { person: SharePerson; disabled: boolean; onChange(mode: Right): void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const value: Right = person.mode === 'write' ? 'write' : 'read'
  return <div ref={box} className="relative">
    <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Право: ${person.name || 'Коллега'}`} disabled={disabled} onClick={() => setOpen(o => !o)}
      className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border-0 bg-transparent px-2.5 text-[14px] text-kumo-subtle transition-colors hover:bg-kumo-tint hover:text-kumo-default disabled:cursor-not-allowed">
      {RIGHTS.find(r => r.id === value)!.title}<CaretDown size={12} aria-hidden="true" /></button>
    {open && <div role="menu" className="absolute top-9 right-0 z-10 flex w-48 flex-col rounded-xl border border-kumo-fill bg-kumo-overlay p-1 shadow-[0_8px_24px_rgba(24,32,28,0.12)]">
      {RIGHTS.map(r => {
        const off = r.id === 'write' && !person.canWrite
        return <button key={r.id} type="button" role="menuitemradio" aria-checked={value === r.id} disabled={off} title={off ? 'У человека нет права записи в папку документа' : undefined}
          onClick={() => { setOpen(false); if (r.id !== value) onChange(r.id) }}
          className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 text-left text-[14px] text-kumo-default hover:bg-kumo-tint disabled:cursor-not-allowed disabled:text-kumo-inactive disabled:hover:bg-transparent">
          <span className="w-4">{value === r.id && <Check size={14} aria-hidden="true" />}</span>{r.title}</button>
      })}
    </div>}
  </div>
}

/**
 * «Поделиться» документом по макету Share: уровень доступа одной строкой, кто имеет доступ, список людей
 * организации для приглашения (недавние, свой отдел, остальные отделы свёрнуты) и одна кнопка «Пригласить N».
 * Всё сохраняется сразу и перечитывается само: без «Применить» и «Перечитать».
 */
export default function DocumentSharePanel({ selector, binding, format, documentName, onClose }: {
  selector: Selector | null; binding: DocumentBinding | null; format: NativeDocumentFormat; documentName: string | null; onClose(): void
}) {
  const [people, setPeople] = useState<SharePerson[] | null>(null)
  const [units, setUnits] = useState<ShareUnit[]>([]), [me, setMe] = useState(''), [recent, setRecent] = useState<string[]>(() => readRecent())
  const [owner, setOwner] = useState<boolean | null>(null)
  const [level, setLevel] = useState<{ name: string; level: Level; canEdit: boolean; pending: Level | null } | null>(null)
  const [query, setQuery] = useState(''), [right, setRight] = useState<Right>('write'), [picked, setPicked] = useState<string[]>([])
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const alive = useRef(true)
  const scope = binding?.scope ?? '', resource = binding?.resource ?? ''

  async function load() {
    if (!selector || !scope || !resource) return
    using writer = await selector.select(scope, resource, format)
    const head = await writer.head()
    const access = (await Promise.resolve(writer.access()).catch(() => undefined)) ?? 'owner'
    if (!alive.current) return
    if (access !== 'owner') { setOwner(false); setPeople([]); return }
    const all: SharePerson[] = []
    let cursor = ''
    for (let page = 0; page < PEOPLE_PAGES; page++) {
      const result = await selector.participants(scope, resource, head, cursor)
      all.push(...result.participants)
      cursor = result.nextCursor
      if (!cursor) break
    }
    if (!alive.current) return
    setOwner(true); setPeople(all)
    const extra = selector as unknown as { orgUnits?(): Promise<ShareUnit[]> }
    const [project, orgUnits, identity, sharedWithMe] = await Promise.all([
      Promise.resolve(selector.projectLevel(scope)).catch(() => null),
      Promise.resolve(extra.orgUnits?.()).catch(() => undefined),
      Promise.resolve(selector.reviewerIdentity()).catch(() => ''),
      Promise.resolve(selector.sharedDocuments()).catch(() => null),
    ])
    if (!alive.current) return
    setLevel(project ?? null); setUnits(Array.isArray(orgUnits) ? orgUnits : []); setMe(typeof identity === 'string' ? identity : '')
    // «Недавние»: кого вы приглашали в этом браузере и кто делился документами с вами.
    const owners = sharedWithMe?.documents.map(d => d.owner) ?? []
    setRecent(old => [...new Set([...old, ...owners])])
  }
  useEffect(() => {
    alive.current = true
    setPeople(null); setOwner(null); setError(''); setPicked([])
    void load().catch(() => { if (alive.current) setError('Доступ к документу не прочитан. Проверьте подключение Mnemos.') })
    return () => { alive.current = false }
  }, [selector, scope, resource, format])

  /** Изменения доступа по одному; право сверяется с текущей версией документа, после — список перечитывается сам. */
  async function change(steps: { person: SharePerson; mode: '' | Right }[], done: string) {
    if (!selector || busy || !steps.length) return false
    setBusy(true); setError(''); setNotice('')
    try {
      using writer = await selector.select(scope, resource, format)
      const head = await writer.head()
      for (const step of steps) await selector.setParticipant(scope, resource, head, step.person.id, step.person.mode, step.mode)
      await load()
      if (alive.current) setNotice(done)
      return true
    } catch {
      if (alive.current) { setError('Доступ изменён не для всех: документ или права могли измениться. Список обновлён.'); void load().catch(() => {}) }
      return false
    } finally { if (alive.current) setBusy(false) }
  }
  async function invite() {
    const chosen = picked.map(id => people?.find(p => p.id === id)).filter((p): p is SharePerson => !!p && p.mode === '')
    if (!chosen.length) return
    const readOnly = right === 'write' ? chosen.filter(p => !p.canWrite) : []
    const names = chosen.map(p => p.name || 'Коллега')
    const who = names.length === 1 ? names[0]! : names.length === 2 ? `${names[0]} и ${names[1]}` : `${names[0]} и ещё ${plural(names.length - 1, 'человек', 'человека', 'человек')}`
    const ok = await change(chosen.map(person => ({ person, mode: right === 'write' && person.canWrite ? 'write' : 'read' })),
      `${who} ${chosen.length === 1 ? 'получит' : 'получат'} уведомление во «Входящих» и письмо.${readOnly.length ? ` Смотреть, но не править: ${readOnly.map(p => p.name || 'коллега').join(', ')} — нет права записи в папку документа.` : ''}`)
    if (ok && alive.current) { rememberRecent(chosen.map(p => p.id)); setRecent(readRecent()); setPicked([]); setQuery('') }
  }
  async function changeLevel(next: Level) {
    if (!selector || !level || busy || next === level.level) return
    setBusy(true); setError(''); setNotice('')
    try {
      const out = await selector.setProjectLevel(scope, next, level.canEdit)
      if (!out.applied) setNotice('Расширение доступа ушло на решение руководителю — в его «Входящие».')
      await load()
    } catch { if (alive.current) setError('Уровень доступа не изменён: нужно право менять видимость проекта.') }
    finally { if (alive.current) setBusy(false) }
  }

  const withAccess = (people ?? []).filter(p => p.mode !== '')
  const groups = useMemo(() => shareCandidates(people ?? [], units, me, recent), [people, units, me, recent])
  const q = query.trim().toLocaleLowerCase('ru-RU')
  const found = q ? [...new Map(groups.flatMap(g => g.people).filter(c => c.name.toLocaleLowerCase('ru-RU').includes(q)).map(c => [c.id, c])).values()] : null
  const selectable = (c: Candidate) => !!c.person && c.person.canRead
  const toggle = (c: Candidate) => { if (selectable(c)) setPicked(old => old.includes(c.id) ? old.filter(id => id !== c.id) : [...old, c.id]) }
  const isOpen = (g: CandidateGroup) => open[g.id] ?? (g.id === 'recent' || g.mine)
  const pickedPeople = picked.map(id => people?.find(p => p.id === id)).filter((p): p is SharePerson => !!p)

  const row = (c: Candidate, withUnit: boolean) => {
    const on = picked.includes(c.id), ok = selectable(c)
    const note = !c.person ? 'нет доступа к проекту' : !c.person.canWrite ? 'может только смотреть' : ''
    const sub = [withUnit ? c.unit : '', note].filter(Boolean).join(' · ')
    return <li key={c.id}>
      <button type="button" data-candidate="" aria-pressed={on} disabled={busy || !ok}
        title={!c.person ? 'Пригласить можно, когда у человека есть доступ к проекту: откройте проект отделу или попросите администратора.' : undefined}
        onClick={() => toggle(c)}
        className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border-0 px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring disabled:cursor-default ${on ? 'bg-kumo-tint' : 'bg-transparent enabled:hover:bg-kumo-tint/60'}`}>
        <Avatar name={c.name} id={c.id} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[15px] leading-5 ${ok ? 'text-kumo-default' : 'text-kumo-subtle'}`}>{c.name}</span>
          {sub && <span className="block truncate text-[13px] leading-[18px] text-kumo-subtle">{sub}</span>}
        </span>
        {ok && <span aria-hidden="true" className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${on ? 'border-kumo-brand bg-kumo-brand text-white' : 'border-kumo-interact'}`}>{on && <Check size={12} weight="bold" />}</span>}
      </button>
    </li>
  }

  return <aside data-share-panel aria-label="Поделиться" className="absolute top-0 right-0 z-30 flex max-h-full w-[min(640px,100%)] flex-col rounded-[20px] bg-kumo-overlay shadow-[0_1px_2px_rgba(24,32,28,0.05),0_16px_40px_rgba(24,32,28,0.08)]">
    <header className="flex shrink-0 items-center gap-3 px-7 pt-[26px] pb-5">
      <button type="button" aria-label="Назад к документу" onClick={onClose}
        className="inline-flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-kumo-fill-hover bg-transparent text-kumo-default hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring"><CaretLeft size={16} /></button>
      <div className="min-w-0 flex-1">
        <h2 className="m-0 text-[20px] leading-7 font-semibold tracking-[-0.3px] text-kumo-default">Поделиться</h2>
        {documentName && <p title={documentName} className="m-0 truncate text-[14px] leading-5 text-kumo-subtle">{documentName}</p>}
      </div>
    </header>
    <div className="flex min-h-0 flex-col gap-6 overflow-y-auto px-7 pb-[26px] text-[14px] text-kumo-default">
      {!binding && <p className="m-0 text-kumo-subtle">Документ ещё не сохранён в проект. Поделиться можно, когда он сохранится.</p>}
      {binding && owner === false && <p className="m-0 text-kumo-subtle">С вами поделились этим документом. Приглашать других может его владелец.</p>}
      {binding && owner && <>
        {level && <div className="flex flex-col gap-2">
          <div role="radiogroup" aria-label="Доступ" className="grid grid-cols-3 gap-0.5 rounded-full bg-kumo-tint p-1">
            {LEVELS.map(l => <button key={l.id} type="button" role="radio" aria-checked={level.level === l.id} disabled={busy || !selector}
              onClick={() => { void changeLevel(l.id) }}
              className={`h-8 cursor-pointer truncate rounded-full border-0 px-2 text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring disabled:cursor-default ${level.level === l.id ? 'bg-kumo-overlay font-semibold text-kumo-default shadow-[0_1px_3px_rgba(24,32,28,0.12)]' : 'bg-transparent text-kumo-subtle hover:text-kumo-default'}`}>
              {l.title}{level.pending === l.id ? ' · ждёт' : ''}</button>)}
          </div>
          <p data-level-line="" className="m-0 px-1 text-[13px] leading-[18px] text-kumo-subtle">{levelLine(level.level, level.name, level.pending)}</p>
        </div>}

        <section aria-label="Имеют доступ" className="flex flex-col">
          <h3 className="m-0 pb-1 text-[15px] leading-5 font-semibold">Имеют доступ</h3>
          <div className="flex items-center gap-3 border-b border-kumo-fill py-2.5"><Avatar name="Вы" id={me || 'me'} /><span className="min-w-0 flex-1 text-[15px]">Вы</span><span className="px-2.5 text-[14px] text-kumo-subtle">владелец</span></div>
          {withAccess.map(p => <div key={p.id} data-share-person="" className="group flex items-center gap-3 border-b border-kumo-fill py-2.5 last:border-b-0">
            <Avatar name={p.name || 'Коллега'} id={p.id} />
            <span className="min-w-0 flex-1 truncate text-[15px]">{p.name || 'Коллега'}</span>
            <button type="button" disabled={busy} onClick={() => { void change([{ person: p, mode: '' }], `${p.name || 'Коллега'} больше не видит документ.`) }}
              className="h-8 cursor-pointer rounded-full border-0 bg-transparent px-2.5 text-[13px] text-kumo-subtle opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-kumo-danger focus-visible:opacity-100 disabled:cursor-not-allowed">Убрать</button>
            <RightMenu person={p} disabled={busy} onChange={mode => { void change([{ person: p, mode }], `${p.name || 'Коллега'} теперь ${mode === 'write' ? 'может править' : 'может смотреть'}.`) }} />
          </div>)}
        </section>

        <section aria-label="Пригласить" className="flex flex-col gap-2.5">
          <h3 className="m-0 text-[15px] leading-5 font-semibold">Пригласить поработать вместе</h3>
          <label className="relative block">
            <span className="sr-only">Найти коллегу</span>
            <MagnifyingGlass size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-kumo-subtle" />
            <input id="share-person" type="search" autoComplete="off" placeholder="Найти по имени" value={query} disabled={people === null}
              onChange={e => setQuery(e.target.value)}
              className="h-10 w-full rounded-full border border-kumo-fill-hover bg-kumo-overlay pr-4 pl-10 text-[15px] text-kumo-default outline-none placeholder:text-kumo-inactive focus:border-kumo-brand focus:ring-2 focus:ring-kumo-ring/30" />
          </label>
          {found && <ul aria-label="Найденные коллеги" className="m-0 flex list-none flex-col p-0">{found.map(c => row(c, true))}</ul>}
          {found?.length === 0 && <p className="m-0 px-2 text-[13px] text-kumo-subtle">Никого не нашли по «{query.trim()}».</p>}
          {!found && groups.map(g => {
            const eligible = g.people.filter(selectable)
            const all = eligible.length > 0 && eligible.every(c => picked.includes(c.id))
            return <div key={g.id} data-group={g.id} className="flex flex-col">
              <div className="flex items-center gap-1">
                <button type="button" aria-expanded={isOpen(g)} onClick={() => setOpen(o => ({ ...o, [g.id]: !isOpen(g) }))}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent px-1 py-1.5 text-left text-[13px] leading-[18px] font-medium text-kumo-subtle hover:text-kumo-default">
                  {isOpen(g) ? <CaretDown size={12} aria-hidden="true" /> : <CaretRight size={12} aria-hidden="true" />}
                  <span className="truncate">{g.mine && g.unit ? `Мой отдел · ${g.title}` : g.title}</span><span className="text-kumo-inactive">{g.people.length}</span>
                </button>
                {g.unit && eligible.length > 1 && <button type="button" disabled={busy} onClick={() => setPicked(old => all ? old.filter(id => !eligible.some(c => c.id === id)) : [...new Set([...old, ...eligible.map(c => c.id)])])}
                  className="h-7 cursor-pointer rounded-full border-0 bg-transparent px-2.5 text-[13px] text-kumo-brand hover:bg-kumo-tint">{all ? 'Снять отдел' : 'Весь отдел'}</button>}
              </div>
              {isOpen(g) && <ul aria-label={g.title} className="m-0 flex list-none flex-col p-0">{g.people.map(c => row(c, !g.unit))}</ul>}
            </div>
          })}
          {people !== null && !groups.length && !found && <p className="m-0 px-1 text-[13px] text-kumo-subtle">Все коллеги с доступом к проекту уже приглашены.</p>}
        </section>
      </>}
      {people === null && !error && <p role="status" className="m-0 text-kumo-subtle">Загрузка…</p>}
      {error && <p role="alert" className="m-0 text-kumo-danger">{error}</p>}
      {notice && <p role="status" className="m-0">{notice}</p>}
    </div>
    {pickedPeople.length > 0 && <footer className="flex shrink-0 flex-wrap items-center gap-3 rounded-b-[20px] border-t border-kumo-fill bg-kumo-overlay px-7 py-3.5">
      <div role="radiogroup" aria-label="Право приглашённых" className="inline-flex rounded-full bg-kumo-tint p-0.5">
        {RIGHTS.map(r => <button key={r.id} type="button" role="radio" aria-checked={right === r.id} disabled={busy} onClick={() => setRight(r.id)}
          className={`h-8 cursor-pointer rounded-full border-0 px-3 text-[13px] transition-colors ${right === r.id ? 'bg-kumo-overlay font-medium text-kumo-default shadow-[0_1px_3px_rgba(24,32,28,0.12)]' : 'bg-transparent text-kumo-subtle hover:text-kumo-default'}`}>{r.title}</button>)}
      </div>
      <button type="button" disabled={busy} onClick={() => setPicked([])} className="h-8 cursor-pointer rounded-full border-0 bg-transparent px-2 text-[13px] text-kumo-subtle hover:text-kumo-default">Сбросить</button>
      <button type="button" data-share-invite="" disabled={busy} onClick={() => { void invite() }}
        className="ml-auto inline-flex h-[38px] cursor-pointer items-center rounded-full border-0 bg-kumo-brand px-5 text-[14px] font-medium text-white hover:bg-kumo-brand-hover disabled:cursor-wait disabled:opacity-60">{busy ? 'Приглашаю…' : `Пригласить ${pickedPeople.length}`}</button>
    </footer>}
  </aside>
}
