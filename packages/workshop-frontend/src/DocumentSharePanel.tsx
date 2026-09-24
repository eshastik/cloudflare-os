import { useEffect, useRef, useState } from 'react'
import { CaretLeft } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import type { GatekeeperNativeDocumentWriteSelector } from '@gadgets/workshop-shared/gatekeeper'
import type { NativeDocumentFormat } from '@gadgets/workshop-shared/native-document'
import type { DocumentBinding } from './DocumentStatus'

type Selector = RpcStub<GatekeeperNativeDocumentWriteSelector>
type Page = Awaited<ReturnType<Selector['participants']>>
export type SharePerson = Page['participants'][number]
type Level = 'private' | 'department' | 'organization'
type Right = 'write' | 'read'

/** Сколько страниц людей читать для подсказок; дальше — поиск по имени сужает выбор. */
const PEOPLE_PAGES = 5

const LEVELS: { id: Level; title: string; note: string }[] = [
  { id: 'private', title: 'Только приглашённые', note: 'и вы' },
  { id: 'department', title: 'Мой отдел', note: 'весь проект' },
  { id: 'organization', title: 'Вся организация', note: 'весь проект' },
]

/** Люди, которым можно предложить доступ: ещё без доступа, могут читать папку документа, имя совпадает с поиском. */
export function shareSuggestions(people: SharePerson[], query: string, limit = 6): SharePerson[] {
  const q = query.trim().toLocaleLowerCase('ru-RU')
  if (!q) return []
  return people.filter(p => p.mode === '' && p.canRead && (p.name || '').toLocaleLowerCase('ru-RU').includes(q)).slice(0, limit)
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'
  return <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-kumo-tint text-[13px] font-semibold text-kumo-default">{initials}</span>
}

function Toggle({ value, onChange, disabled, label, canWrite = true }: { value: Right; onChange(value: Right): void; disabled?: boolean; label: string; canWrite?: boolean }) {
  const item = (id: Right, text: string, off = false) => <button type="button" role="radio" aria-checked={value === id} disabled={disabled || off}
    title={off ? 'У человека нет права записи в папку документа' : undefined}
    className={`h-8 cursor-pointer rounded-lg border-0 px-2.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${value === id ? 'bg-kumo-overlay font-medium text-kumo-default shadow-[0_1px_3px_rgba(24,32,28,0.12)]' : 'bg-transparent text-kumo-subtle hover:text-kumo-default'}`}
    onClick={() => onChange(id)}>{text}</button>
  return <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-[10px] bg-kumo-tint p-0.5">
    {item('write', 'может править', !canWrite)}{item('read', 'может смотреть')}
  </div>
}

/**
 * «Поделиться» документом (макет Share): одно поле с подсказками людей организации, право «может править /
 * может смотреть» и список тех, у кого доступ. Всё сохраняется сразу: без «Применить» и «Перечитать».
 * Уровень сверху — видимость проекта документа целиком; расширение может уйти на решение руководителю.
 */
export default function DocumentSharePanel({ selector, binding, format, documentName, onClose }: {
  selector: Selector | null; binding: DocumentBinding | null; format: NativeDocumentFormat; documentName: string | null; onClose(): void
}) {
  const [people, setPeople] = useState<SharePerson[] | null>(null)
  const [owner, setOwner] = useState<boolean | null>(null)
  const [level, setLevel] = useState<{ name: string; level: Level; canEdit: boolean; pending: Level | null } | null>(null)
  const [query, setQuery] = useState(''), [right, setRight] = useState<Right>('write'), [picked, setPicked] = useState<SharePerson | null>(null)
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
    const project = await Promise.resolve(selector.projectLevel(scope)).catch(() => null)
    if (alive.current) setLevel(project ?? null)
  }
  useEffect(() => {
    alive.current = true
    setPeople(null); setOwner(null); setError('')
    void load().catch(() => { if (alive.current) setError('Доступ к документу не прочитан. Проверьте подключение Mnemos.') })
    return () => { alive.current = false }
  }, [selector, scope, resource, format])

  /** Одно изменение доступа: право сверяется с текущей версией документа, после — список перечитывается сам. */
  async function change(person: SharePerson, mode: '' | Right, done: string) {
    if (!selector || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      using writer = await selector.select(scope, resource, format)
      await selector.setParticipant(scope, resource, await writer.head(), person.id, person.mode, mode)
      await load()
      if (alive.current) setNotice(done)
    } catch {
      if (alive.current) { setError('Доступ не изменён: документ или права могли измениться. Список обновлён.'); void load().catch(() => {}) }
    } finally { if (alive.current) setBusy(false) }
  }
  async function invite() {
    const person = picked ?? shareSuggestions(people ?? [], query, 1)[0]
    if (!person) { setError('Выберите человека из подсказок.'); return }
    const mode: Right = right === 'write' && person.canWrite ? 'write' : 'read'
    await change(person, mode, `${person.name || 'Коллега'} получит уведомление во «Входящих» и письмо.${mode !== right ? ' Править он не сможет: у него нет права записи в папку документа.' : ''}`)
    if (alive.current) { setQuery(''); setPicked(null) }
  }
  async function changeLevel(next: Level) {
    if (!selector || !level || busy || next === level.level) return
    setBusy(true); setError(''); setNotice('')
    try {
      const out = await selector.setProjectLevel(scope, next, level.canEdit)
      setNotice(out.applied ? `Проект «${level.name}» теперь видят: ${LEVELS.find(l => l.id === out.level)?.title.toLowerCase()}.` : 'Расширение доступа ушло на решение руководителю — в его «Входящие».')
      await load()
    } catch { if (alive.current) setError('Уровень доступа не изменён: нужно право менять видимость проекта.') }
    finally { if (alive.current) setBusy(false) }
  }

  const withAccess = (people ?? []).filter(p => p.mode !== '')
  const suggestions = picked ? [] : shareSuggestions(people ?? [], query)
  const title = documentName ? `Кто видит «${documentName}»` : 'Кто видит документ'
  return <aside data-share-panel aria-label="Поделиться" className="absolute inset-y-0 right-0 z-30 flex w-[min(640px,100%)] flex-col rounded-[20px] bg-kumo-overlay shadow-[0_1px_2px_rgba(24,32,28,0.05),0_16px_40px_rgba(24,32,28,0.08)]">
    <header className="flex shrink-0 items-center gap-3 px-7 pt-6 pb-4">
      <button type="button" aria-label="Назад к документу" onClick={onClose}
        className="inline-flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-kumo-fill-hover text-kumo-default hover:bg-kumo-tint"><CaretLeft size={16} /></button>
      <h2 className="m-0 min-w-0 flex-1 truncate text-[20px] leading-7 font-semibold tracking-[-0.3px] text-kumo-default">{title}</h2>
    </header>
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-7 pb-6 text-[14px] text-kumo-default">
      {!binding && <p className="m-0 text-kumo-subtle">Документ ещё не сохранён в проект. Поделиться можно, когда он сохранится.</p>}
      {binding && owner === false && <p className="m-0 text-kumo-subtle">С вами поделились этим документом. Приглашать других может его владелец.</p>}
      {binding && owner && <>
        {level && <div role="radiogroup" aria-label="Доступ" className="grid grid-cols-3 rounded-2xl bg-kumo-tint p-1">
          {LEVELS.map(l => <button key={l.id} type="button" role="radio" aria-checked={level.level === l.id} disabled={busy || !selector}
            onClick={() => { void changeLevel(l.id) }}
            className={`flex h-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border-0 ${level.level === l.id ? 'bg-kumo-overlay shadow-[0_1px_3px_rgba(24,32,28,0.12)]' : 'bg-transparent'}`}>
            <span className={`text-[15px] ${level.level === l.id ? 'font-semibold' : 'font-medium'}`}>{l.title}</span>
            <span className="text-[12px] text-kumo-subtle">{level.pending === l.id ? 'ждёт решения' : l.note}</span>
          </button>)}
        </div>}
        <div className="flex flex-col gap-2.5">
          <label htmlFor="share-person" className="text-[15px] font-semibold">Пригласить поработать вместе</label>
          <div className="flex flex-wrap items-center gap-2">
            <input id="share-person" autoComplete="off" placeholder="Имя коллеги" value={picked ? picked.name : query} disabled={busy || people === null}
              onChange={e => { setPicked(null); setQuery(e.target.value) }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void invite() } }}
              className="h-11 min-w-0 flex-1 rounded-xl border border-kumo-line bg-kumo-base px-3.5 text-[15px] outline-none focus:ring-2 focus:ring-kumo-ring" />
            <Toggle label="Право приглашённого" value={right} onChange={setRight} disabled={busy} />
            <button type="button" disabled={busy || (!picked && !query.trim())} onClick={() => { void invite() }}
              className="h-11 cursor-pointer rounded-xl border-0 bg-kumo-brand px-4 text-[15px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">Пригласить</button>
          </div>
          {suggestions.length > 0 && <ul role="listbox" aria-label="Подсказки" className="m-0 flex list-none flex-col overflow-hidden rounded-xl border border-kumo-fill p-0">
            {suggestions.map(p => <li key={p.id}><button type="button" role="option" aria-selected="false" className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-3 py-2 text-left hover:bg-kumo-tint"
              onClick={() => { setPicked(p); if (!p.canWrite) setRight('read') }}><Avatar name={p.name || 'Коллега'} /><span className="flex-1">{p.name || 'Коллега'}</span>{!p.canWrite && <span className="text-[12px] text-kumo-subtle">только смотреть</span>}</button></li>)}
          </ul>}
          {query.trim() && !picked && suggestions.length === 0 && people !== null && <p className="m-0 text-[13px] text-kumo-subtle">Никого не нашли. Пригласить можно тех, у кого есть доступ к проекту.</p>}
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-3 border-b border-kumo-fill py-3"><Avatar name="Вы" /><div className="flex-1"><div className="text-[15px]">Вы</div><div className="text-[13px] text-kumo-subtle">автор</div></div><span className="text-kumo-subtle">Владелец</span></div>
          {withAccess.map(p => <div key={p.id} data-share-person="" className="flex flex-wrap items-center gap-3 border-b border-kumo-fill py-3 last:border-b-0">
            <Avatar name={p.name || 'Коллега'} />
            <div className="min-w-0 flex-1 truncate text-[15px]">{p.name || 'Коллега'}</div>
            <Toggle label={`Право: ${p.name || 'Коллега'}`} value={p.mode === 'write' ? 'write' : 'read'} canWrite={p.canWrite} disabled={busy}
              onChange={mode => { if (mode !== p.mode) void change(p, mode, `Право изменено: ${p.name || 'коллега'} ${mode === 'write' ? 'может править' : 'может смотреть'}.`) }} />
            <button type="button" disabled={busy} onClick={() => { void change(p, '', `${p.name || 'Коллега'} больше не видит документ.`) }}
              className="h-8 cursor-pointer rounded-lg border border-kumo-line bg-transparent px-2.5 text-[13px] text-kumo-default hover:bg-kumo-tint disabled:opacity-40">Убрать</button>
          </div>)}
        </div>
      </>}
      {people === null && !error && <p role="status" className="m-0 text-kumo-subtle">Загрузка…</p>}
      {error && <p role="alert" className="m-0 text-kumo-danger">{error}</p>}
      {notice && <p role="status" className="m-0">{notice}</p>}
    </div>
  </aside>
}
