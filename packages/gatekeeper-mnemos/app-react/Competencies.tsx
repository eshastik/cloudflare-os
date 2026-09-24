import { useEffect, useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import type { OrganizationRole, PrincipalMembership } from "../src/mnemos-api.ts";
import type { AdminPerson } from "../src/admin-people.ts";
import { useUi } from "./host.ts";
import { ActionForm, Notice } from "./ui.tsx";
import { Card, CardRow, Chip, Pill, PillInput, PillSelect, SectionHead, plural } from "./admin-ui.tsx";

/** Группа администраторов организации: членство в ней даёт полный доступ ко всем проектам. */
export const ADMINS_GROUP = "system:organization-admins";
/** Сколько сотрудников опрашивать одновременно при чтении членства. */
const PARALLEL = 4;

type Ui = ReturnType<typeof useUi>;

/** Все функциональные роли (компетенции) организации со всех страниц каталога. */
export function useCompetencies(revision = 0): { roles: OrganizationRole[]; generation: number; loading: boolean; failed: boolean; reload(): void } {
  const ui = useUi();
  const [state, setState] = useState<{ roles: OrganizationRole[]; generation: number; loading: boolean; failed: boolean }>({ roles: [], generation: 0, loading: true, failed: false });
  const [own, setOwn] = useState(0);
  useEffect(() => {
    let current = true;
    setState(s => ({ ...s, loading: true, failed: false }));
    void (async () => {
      const roles: OrganizationRole[] = []; let cursor = "", generation = 0; const seen = new Set<string>();
      do {
        if (seen.has(cursor)) throw Error("Повтор страницы каталога");
        seen.add(cursor);
        const page = await ui.listOrganizationRoles(cursor);
        roles.push(...page.roles); generation = page.generation; cursor = page.next_cursor;
      } while (cursor);
      if (current) setState({ roles: roles.filter(r => r.kind === "functional_role" && r.active), generation, loading: false, failed: false });
    })().catch(() => { if (current) setState({ roles: [], generation: 0, loading: false, failed: true }); });
    return () => { current = false; };
  }, [ui, revision, own]);
  return { ...state, reload: () => setOwn(v => v + 1) };
}

/** Членство или null, если прочитать не удалось: отказ не должен ронять карточку. */
async function membership(ui: Ui, container: string, member: string): Promise<PrincipalMembership | null> {
  try { return await ui.readPrincipalMembership(container, member); } catch { return null; }
}
async function toggle(ui: Ui, state: PrincipalMembership, enabled: boolean): Promise<PrincipalMembership> {
  return ui.setPrincipalMembership(state.container_id, state.member_id, { expected_generation: state.generation, expected_enabled: state.enabled, enabled });
}
async function limited<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}

/** Переключатель «Администратор» в строке сотрудника: то же членство в группе администраторов, с предупреждением и подтверждением. */
export function AdminSwitch({ person }: { person: AdminPerson }) {
  const ui = useUi();
  const [state, setState] = useState<PrincipalMembership | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { let current = true; setState(undefined); void membership(ui, ADMINS_GROUP, person.userName).then(s => { if (current) setState(s); }); return () => { current = false; }; }, [ui, person.userName]);
  async function confirm() {
    if (!state || busy) return;
    setBusy(true); setError("");
    try { setState(await toggle(ui, state, !state.enabled)); setPending(false); }
    catch { setError("Изменение не подтверждено: состав мог измениться. Обновите страницу."); setState(await membership(ui, ADMINS_GROUP, person.userName)); setPending(false); }
    finally { setBusy(false); }
  }
  if (state === undefined) return <Notice>Проверяем права…</Notice>;
  if (state === null) return <Notice>Права администратора не проверены. Обновите страницу.</Notice>;
  return <div className="grid gap-2">
    <label className="flex items-center gap-2 text-[13px] text-kumo-default">
      <input type="checkbox" role="switch" aria-label="Администратор" aria-checked={state.enabled} checked={pending ? !state.enabled : state.enabled} disabled={busy || (!state.enabled && !state.member_active)} onChange={() => setPending(!pending)} />
      Администратор
    </label>
    {pending && <div role="region" aria-label="Подтверждение администратора" className="grid gap-2 rounded-xl bg-kumo-tint p-3 text-[13px]">
      {!state.enabled && <p className="m-0">Администратор читает и меняет материалы всех проектов организации, управляет людьми и правилами. Согласование специалистами сохраняется. Назначайте только тем, кому нужен полный доступ.</p>}
      {state.enabled && <p className="m-0">Сотрудник потеряет права администратора. Личные права и доступ к проектам сохранятся.</p>}
      <div className="flex gap-2">
        <Pill tone="primary" disabled={busy} onClick={() => void confirm()}>{state.enabled ? "Снять права администратора" : "Сделать администратором"}</Pill>
        <Pill tone="ghost" disabled={busy} onClick={() => setPending(false)}>Отмена</Pill>
      </div>
    </div>}
    {error && <Notice tone="danger">{error}</Notice>}
  </div>;
}

/** Компетенции сотрудника метками: добавить и убрать. */
export function PersonCompetencies({ person }: { person: AdminPerson }) {
  const ui = useUi();
  const { roles, loading, failed } = useCompetencies();
  const [held, setHeld] = useState<Map<string, PrincipalMembership>>(new Map());
  const [reading, setReading] = useState(true);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true; setReading(true);
    void limited(roles, r => membership(ui, r.id, person.userName)).then(list => {
      if (!current) return;
      setHeld(new Map(list.filter((s): s is PrincipalMembership => !!s).map(s => [s.container_id, s])));
      setReading(false);
    });
    return () => { current = false; };
  }, [ui, roles, person.userName, revision]);
  async function change(role: string, enabled: boolean) {
    if (busy || !role) return;
    setBusy(true); setError("");
    try {
      const state = held.get(role) ?? await ui.readPrincipalMembership(role, person.userName);
      await toggle(ui, state, enabled);
      setAdding("");
    } catch { setError("Компетенция не изменена. Обновите страницу и повторите."); }
    finally { setBusy(false); setRevision(v => v + 1); }
  }
  if (loading || reading) return <Notice>Загрузка компетенций…</Notice>;
  if (failed) return <Notice tone="danger">Компетенции недоступны.</Notice>;
  const mine = roles.filter(r => held.get(r.id)?.enabled);
  const others = roles.filter(r => !held.get(r.id)?.enabled);
  return <div className="grid gap-2">
    <div className="flex flex-wrap items-center gap-2">
      {mine.length === 0 && <span className="text-[13px] text-kumo-subtle">Компетенции не отмечены.</span>}
      {mine.map(r => <Chip key={r.id}>{r.name}
        <button type="button" aria-label={`Убрать компетенцию: ${r.name}`} disabled={busy} onClick={() => void change(r.id, false)} className="inline-flex text-kumo-subtle hover:text-kumo-default"><X size={12} /></button>
      </Chip>)}
      {others.length > 0 && <>
        <PillSelect aria-label="Добавить компетенцию" value={adding} disabled={busy} onChange={e => setAdding(e.target.value)}>
          <option value="">Компетенция…</option>
          {others.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </PillSelect>
        <Pill disabled={busy || !adding} onClick={() => void change(adding, true)}><Plus size={14} />Добавить</Pill>
      </>}
    </div>
    {roles.length === 0 && <Notice>В организации ещё нет компетенций. Создайте их ниже, в блоке «Компетенции».</Notice>}
    {error && <Notice tone="danger">{error}</Notice>}
  </div>;
}

/** «Компетенции»: что сотрудники умеют и могут согласовывать. Строка на компетенцию; у кого она есть — раскрытием на месте. */
export function CompetenciesPanel({ people }: { people: AdminPerson[] }) {
  const ui = useUi();
  const [revision, setRevision] = useState(0);
  const { roles, generation, loading, failed } = useCompetencies(revision);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create() {
    const value = name.trim();
    if (!value || busy || failed) return;
    setBusy(true); setError("");
    try {
      const role = await ui.createOrganizationRole({ id: crypto.randomUUID(), kind: "functional_role", name: value, expected_generation: generation });
      setName(""); setSelected(role.id); setRevision(v => v + 1);
    } catch { setError("Компетенция не создана. Обновите список и повторите: возможно, её уже создали."); setRevision(v => v + 1); }
    finally { setBusy(false); }
  }
  return <section aria-label="Компетенции" className="min-w-0">
    <SectionHead title="Компетенции" />
    <p className="mt-0 mb-3 max-w-[650px] text-[13px] text-kumo-subtle">Компетенция — то, что сотрудник умеет или вправе проверять, например «Проверка ТЗ» или «Юридическая экспертиза». По компетенциям назначают согласующих и открывают доступ к материалам своей области.</p>
    {error && <div className="mb-2"><Notice tone="danger">{error}</Notice></div>}
    <Card>
      {loading ? <CardRow><Notice>Загрузка компетенций…</Notice></CardRow> : failed ? <CardRow><Notice tone="danger">Компетенции недоступны. Обновите страницу.</Notice></CardRow> : roles.length === 0 ? <CardRow><Notice>Компетенций пока нет. Создайте первую.</Notice></CardRow> :
        roles.map(r => <div key={r.id} className="border-t border-kumo-fill first:border-t-0">
          <button type="button" aria-expanded={selected === r.id} onClick={() => setSelected(selected === r.id ? "" : r.id)} className={`flex w-full items-center gap-3 px-4 py-3 text-left text-[15px] font-medium ${selected === r.id ? "bg-kumo-tint" : "hover:bg-kumo-tint"}`}>{r.name || "Без названия"}</button>
          {selected === r.id && <div className="px-4 pb-4 pt-2"><Holders key={r.id} role={r} people={people} /></div>}
        </div>)}
      <ActionForm aria-label="Новая компетенция" onAction={() => void create()} className="flex flex-wrap items-center gap-2 border-t border-kumo-fill bg-kumo-base px-4 py-3">
        <label className="min-w-0 flex-1"><span className="sr-only">Новая компетенция</span><PillInput className="w-full" value={name} maxLength={255} disabled={busy} onChange={e => setName(e.target.value)} placeholder="Новая компетенция, например «Проверка ТЗ»" /></label>
        <Pill disabled={busy || !name.trim()} onClick={() => void create()}><Plus size={14} />Создать</Pill>
      </ActionForm>
    </Card>
  </section>;
}

function Holders({ role, people }: { role: OrganizationRole; people: AdminPerson[] }) {
  const ui = useUi();
  const [states, setStates] = useState<Map<string, PrincipalMembership> | null>(null);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const active = people.filter(p => p.active);
  useEffect(() => {
    let current = true; setStates(null);
    void limited(active, p => membership(ui, role.id, p.userName)).then(list => { if (current) setStates(new Map(list.filter((s): s is PrincipalMembership => !!s).map(s => [s.member_id, s]))); });
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui, role.id, people, revision]);
  async function change(person: string, enabled: boolean) {
    const state = states?.get(person);
    if (busy || !state) return;
    setBusy(true); setError("");
    try { await toggle(ui, state, enabled); setAdding(""); }
    catch { setError("Изменение не сохранено. Обновите страницу и повторите."); }
    finally { setBusy(false); setRevision(v => v + 1); }
  }
  if (!states) return <Notice>Проверяем, у кого есть «{role.name}»…</Notice>;
  const holders = active.filter(p => states.get(p.userName)?.enabled);
  const others = active.filter(p => states.has(p.userName) && !states.get(p.userName)!.enabled);
  return <section aria-label={`Компетенция ${role.name}`} className="grid gap-2">
    <p className="m-0 text-[13px] text-kumo-subtle">{holders.length ? `Есть у ${holders.length} ${plural(holders.length, "сотрудника", "сотрудников", "сотрудников")}.` : "Ни у кого из сотрудников нет этой компетенции."}</p>
    {holders.length > 0 && <div className="flex flex-wrap gap-2">{holders.map(p => <Chip key={p.userName}>{p.displayName || "Сотрудник без имени"}
      <button type="button" aria-label={`Убрать у сотрудника: ${p.displayName || "без имени"}`} disabled={busy} onClick={() => void change(p.userName, false)} className="inline-flex text-kumo-subtle hover:text-kumo-default"><X size={12} /></button>
    </Chip>)}</div>}
    {others.length > 0 && <div className="flex flex-wrap items-center gap-2">
      <PillSelect aria-label={`Добавить сотрудника в компетенцию ${role.name}`} value={adding} disabled={busy} onChange={e => setAdding(e.target.value)}>
        <option value="">Выберите сотрудника</option>
        {others.map(p => <option key={p.userName} value={p.userName}>{p.displayName || "Сотрудник без имени"}</option>)}
      </PillSelect>
      <Pill disabled={busy || !adding} onClick={() => void change(adding, true)}>Добавить</Pill>
    </div>}
    {error && <Notice tone="danger">{error}</Notice>}
  </section>;
}
