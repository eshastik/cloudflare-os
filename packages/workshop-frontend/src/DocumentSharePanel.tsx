import { useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, CaretLeft, CaretRight, Check, MagnifyingGlass } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import type { GatekeeperNativeDocumentWriteSelector } from '@gadgets/workshop-shared/gatekeeper'
import type { NativeDocumentFormat } from '@gadgets/workshop-shared/native-document'
import type { DocumentBinding } from './DocumentStatus'
import { plural } from './versionDiff'
import { useAuthenticatedApi } from './AuthContext'
import { listAccounts, storesDocuments } from './accountCapabilities'
import MnemosAvatar from './components/MnemosAvatar'
import { photoMap } from './mnemosPhotos'

/** Отделы организации для выбора людей (метод моста `departments`). */
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

/**
 * Кто видит проект документа — одной строкой. Панель документа уровень проекта не меняет: переключатель
 * здесь открывал весь проект отделу или организации, хотя человек менял доступ к одному документу.
 * Меняется это на странице проекта, раздел «Кто видит».
 */
export function projectLine(level: Level, project: string, unit: string, pending: Level | null): string {
  const who = level === 'private' ? 'только автор' : level === 'department' ? (unit ? `отдел «${unit}»` : 'отдел') : 'вся организация'
  const wait = pending ? ` Запрос открыть его ${pending === 'organization' ? 'всей организации' : 'отделу'} ждёт решения руководителя.` : ''
  return `Проект «${project}» видят: ${who}.${wait}`
}

/** Человек в списке выбора: может ли его пригласить владелец документа и почему нет. */
export type Candidate = { id: string; name: string; unit: string; person: SharePerson | null }
export type CandidateGroup = { id: string; title: string; people: Candidate[]; mine: boolean; unit: boolean }

/**
 * Кого можно пригласить, по группам: «Недавние», затем отделы (свой первым: «Мой отдел · …»), затем «Без отдела».
 * Человек стоит ровно в одной группе: попавший в «Недавние» ниже не повторяется, состоящий в нескольких
 * отделах стоит в своём (общем с вами) или в первом по имени. Уже имеющие доступ сюда не попадают.
 * Отделы человека приходят вместе со списком людей; состав отделов из `departments` дополняет его
 * отключёнными людьми: такой остаётся в списке с person=null и не выбирается — молча его не прячем.
 */
export function shareCandidates(people: SharePerson[], units: ShareUnit[], me: string, recent: string[]): CandidateGroup[] {
  const byId = new Map(people.map(p => [p.id, p]))
  const has = (id: string) => (byId.get(id)?.mode ?? '') !== ''
  const mine = new Set(units.filter(u => u.members.some(m => m.id === me)).map(u => u.id))
  const unitsOf = new Map<string, { id: string; name: string }[]>()
  const names = new Map<string, string>()
  for (const p of people) if (p.units?.length) unitsOf.set(p.id, p.units)
  for (const u of units) for (const m of u.members) {
    if (!names.has(m.id)) names.set(m.id, m.name)
    if (byId.get(m.id)?.units?.length) continue
    const list = unitsOf.get(m.id) ?? []
    if (!list.some(x => x.id === u.id)) unitsOf.set(m.id, [...list, { id: u.id, name: u.name }])
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ru')
  const home = (id: string) => { const list = [...(unitsOf.get(id) ?? [])].sort(byName); return list.find(u => mine.has(u.id)) ?? list[0] ?? null }
  const candidate = (id: string): Candidate => ({ id, name: byId.get(id)?.name || names.get(id) || 'Коллега',
    unit: [...(unitsOf.get(id) ?? [])].sort(byName).map(u => u.name).join(', '), person: byId.get(id) ?? null })
  const pool = new Set<string>()
  for (const p of people) if (p.id !== me && p.mode === '') pool.add(p.id)
  for (const id of names.keys()) if (id !== me && !has(id)) pool.add(id)

  const groups: CandidateGroup[] = []
  const recentPeople = [...new Set(recent)].filter(id => pool.has(id)).slice(0, 6).map(candidate)
  if (recentPeople.length) groups.push({ id: 'recent', title: 'Недавние', people: recentPeople, mine: false, unit: false })
  const shown = new Set(recentPeople.map(c => c.id))
  const placed = new Map<string, { unit: { id: string; name: string }; people: Candidate[] }>()
  const rest: Candidate[] = []
  for (const id of pool) {
    if (shown.has(id)) continue
    const unit = home(id)
    if (!unit) { rest.push(candidate(id)); continue }
    const group = placed.get(unit.id) ?? { unit, people: [] }
    group.people.push(candidate(id)); placed.set(unit.id, group)
  }
  const ordered = [...placed.values()].sort((a, b) => Number(mine.has(b.unit.id)) - Number(mine.has(a.unit.id)) || byName(a.unit, b.unit))
  for (const g of ordered) groups.push({ id: `unit:${g.unit.id}`, title: g.unit.name, people: g.people.sort(byName), mine: mine.has(g.unit.id), unit: true })
  const known = unitsOf.size > 0
  if (rest.length) groups.push({ id: 'rest', title: known ? 'Без отдела' : 'Коллеги', people: rest.sort(byName), mine: !known, unit: false })
  return groups
}

function readRecent(): string[] {
  try { const value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string').slice(0, 20) : [] } catch { return [] }
}
function rememberRecent(ids: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([...new Set([...ids, ...readRecent()])].slice(0, 20))) } catch { /* без памяти браузера список «Недавние» просто короче */ }
}

const RIGHTS: { id: Right; title: string }[] = [{ id: 'write', title: 'может править' }, { id: 'read', title: 'может смотреть' }]

/** Пометка человека без доступа к папке документа: приглашение откроет ему только этот документ. */
export const DOCUMENT_ONLY_NOTE = 'получит доступ только к этому документу'

/** Откроет ли приглашение с этим правом человеку только документ (без папки). */
export function documentOnlyWith(p: SharePerson, right: Right): boolean {
  return right === 'write' ? !!p.documentOnlyWrite : !!p.documentOnlyRead
}

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
        // Право правки даёт само приглашение: своё право записи в папку не требуется.
        return <button key={r.id} type="button" role="menuitemradio" aria-checked={value === r.id}
          onClick={() => { setOpen(false); if (r.id !== value) onChange(r.id) }}
          className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 text-left text-[14px] text-kumo-default hover:bg-kumo-tint disabled:cursor-not-allowed disabled:text-kumo-inactive disabled:hover:bg-transparent">
          <span className="w-4">{value === r.id && <Check size={14} aria-hidden="true" />}</span>{r.title}</button>
      })}
    </div>}
  </div>
}

/**
 * «Поделиться» документом по макету Share: кто видит проект одной строкой (меняется на странице проекта), кто имеет доступ, список людей
 * организации для приглашения (недавние, свой отдел, остальные отделы свёрнуты) и одна кнопка «Пригласить N».
 * Всё сохраняется сразу и перечитывается само: без «Применить» и «Перечитать».
 */
export default function DocumentSharePanel({ selector, binding, format, documentName, onClose }: {
  selector: Selector | null; binding: DocumentBinding | null; format: NativeDocumentFormat; documentName: string | null; onClose(): void
}) {
  const [people, setPeople] = useState<SharePerson[] | null>(null)
  const [units, setUnits] = useState<ShareUnit[]>([]), [me, setMe] = useState(''), [recent, setRecent] = useState<string[]>(() => readRecent())
  const [owner, setOwner] = useState<boolean | null>(null)
  const [documentOnly, setDocumentOnly] = useState(false)
  const [level, setLevel] = useState<{ name: string; level: Level; pending: Level | null; unit?: string } | null>(null)
  const [photos, setPhotos] = useState<Map<string, string>>(new Map())
  const [projectHref, setProjectHref] = useState('')
  const { authenticatedApi, currentUser } = useAuthenticatedApi()
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
    if (access !== 'owner') {
      setOwner(false); setPeople([])
      const mine = await Promise.resolve(selector.sharedDocuments()).catch(() => null)
      if (alive.current) setDocumentOnly(!!mine?.documents.find(d => d.scope === scope && d.resource === resource)?.documentOnly)
      return
    }
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
    const [project, departments, identity, sharedWithMe, pictures] = await Promise.all([
      Promise.resolve(selector.projectLevel(scope)).catch(() => null),
      Promise.resolve(selector.departments()).catch(() => null),
      Promise.resolve(selector.reviewerIdentity()).catch(() => ''),
      Promise.resolve(selector.sharedDocuments()).catch(() => null),
      Promise.resolve(selector.peoplePhotos()).catch(() => null),
    ])
    if (!alive.current) return
    setLevel(project ?? null); setUnits(Array.isArray(departments?.units) ? departments.units : []); setMe(typeof identity === 'string' ? identity : '')
    setPhotos(photoMap(Array.isArray(pictures?.photos) ? pictures.photos : [], ''))
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
    const only = chosen.filter(p => documentOnlyWith(p, right))
    const names = chosen.map(p => p.name || 'Коллега')
    const who = names.length === 1 ? names[0]! : names.length === 2 ? `${names[0]} и ${names[1]}` : `${names[0]} и ещё ${plural(names.length - 1, 'человек', 'человека', 'человек')}`
    const ok = await change(chosen.map(person => ({ person, mode: right })),
      `${who} ${chosen.length === 1 ? 'получит' : 'получат'} уведомление во «Входящих» и письмо.${only.length ? ` Только этот документ, без папки проекта: ${only.map(p => p.name || 'коллега').join(', ')}.` : ''}`)
    if (ok && alive.current) { rememberRecent(chosen.map(p => p.id)); setRecent(readRecent()); setPicked([]); setQuery('') }
  }
  // Ссылка на раздел «Кто видит» страницы проекта: уровень доступа проекта меняется там, осознанно.
  useEffect(() => {
    let cancelled = false
    setProjectHref('')
    if (!scope || !authenticatedApi) return
    void listAccounts(authenticatedApi).then(accounts => {
      const account = accounts.find(a => storesDocuments(a) && (binding?.accountId == null || a.id === binding.accountId))
      if (!cancelled && account) setProjectHref(`/gatekeepers/${encodeURIComponent(account.vendorId)}?account=${account.id}&section=projects&project=${encodeURIComponent(scope)}&view=members`)
    }, () => {})
    return () => { cancelled = true }
  }, [authenticatedApi, scope, binding?.accountId])

  const withAccess = (people ?? []).filter(p => p.mode !== '')
  // Инициалы владельца — от его имени, а не от подписи «Вы».
  const myName = units.flatMap(u => u.members).find(m => m.id === me)?.name || currentUser?.name || ''
  const groups = useMemo(() => shareCandidates(people ?? [], units, me, recent), [people, units, me, recent])
  const q = query.trim().toLocaleLowerCase('ru-RU')
  const found = q ? [...new Map(groups.flatMap(g => g.people).filter(c => c.name.toLocaleLowerCase('ru-RU').includes(q)).map(c => [c.id, c])).values()] : null
  const selectable = (c: Candidate) => !!c.person
  const toggle = (c: Candidate) => { if (selectable(c)) setPicked(old => old.includes(c.id) ? old.filter(id => id !== c.id) : [...old, c.id]) }
  const isOpen = (g: CandidateGroup) => open[g.id] ?? (g.id === 'recent' || g.mine)
  const pickedPeople = picked.map(id => people?.find(p => p.id === id)).filter((p): p is SharePerson => !!p)

  const row = (c: Candidate, withUnit: boolean) => {
    const on = picked.includes(c.id), ok = selectable(c)
    // Пометка — по выбранному праву: сервер даёт основание «только документ»,
    // если у человека нет этого права на папку.
    const only = !!c.person && documentOnlyWith(c.person, right)
    const note = !c.person ? 'нельзя пригласить' : only ? DOCUMENT_ONLY_NOTE : ''
    const sub = [withUnit ? c.unit : '', note].filter(Boolean).join(' · ')
    return <li key={c.id}>
      <button type="button" data-candidate="" aria-pressed={on} disabled={busy || !ok}
        title={!c.person ? 'Учётная запись человека отключена.' : only ? 'У человека нет такого права на папку документа: приглашение откроет ему только этот документ.' : undefined}
        onClick={() => toggle(c)}
        className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border-0 px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring disabled:cursor-default ${on ? 'bg-kumo-tint' : 'bg-transparent enabled:hover:bg-kumo-tint/60'}`}>
        <MnemosAvatar name={c.name} id={c.id} photo={photos.get(c.id)} />
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
      {binding && owner === false && <p className="m-0 text-kumo-subtle">С вами поделились этим документом.{documentOnly ? ' Вам открыт только он, без папки проекта.' : ''} Приглашать других может его владелец.</p>}
      {binding && owner && <>
        {level && <p data-project-line="" className="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] leading-[18px] text-kumo-subtle">
          <span>{projectLine(level.level, level.name, units.find(u => u.id === level.unit)?.name ?? '', level.pending)}</span>
          {projectHref && <a href={projectHref} className="text-kumo-link hover:underline">Изменить доступ к проекту</a>}
        </p>}

        <section aria-label="Имеют доступ" className="flex flex-col">
          <h3 className="m-0 pb-1 text-[15px] leading-5 font-semibold">Имеют доступ</h3>
          <div className="flex items-center gap-3 border-b border-kumo-fill py-2.5"><MnemosAvatar name={myName || 'Вы'} id={me || 'me'} photo={photos.get(me)} /><span className="min-w-0 flex-1 text-[15px]">Вы</span><span className="px-2.5 text-[14px] text-kumo-subtle">владелец</span></div>
          {withAccess.map(p => <div key={p.id} data-share-person="" className="group flex items-center gap-3 border-b border-kumo-fill py-2.5 last:border-b-0">
            <MnemosAvatar name={p.name || 'Коллега'} id={p.id} photo={photos.get(p.id)} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px]">{p.name || 'Коллега'}</span>
              {documentOnlyWith(p, p.mode === 'write' ? 'write' : 'read') && <span className="block truncate text-[13px] leading-[18px] text-kumo-subtle">только этот документ</span>}
            </span>
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
          {people !== null && !groups.length && !found && <p className="m-0 px-1 text-[13px] text-kumo-subtle">Все коллеги уже приглашены.</p>}
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
