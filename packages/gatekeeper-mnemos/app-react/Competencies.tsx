import { useEffect, useState } from "react";
import { Button } from "@cloudflare/kumo";
import { Plus, X } from "@phosphor-icons/react";
import type { OrganizationRole, PrincipalMembership } from "../src/mnemos-api.ts";
import type { AdminPerson } from "../src/admin-people.ts";
import { useUi } from "./host.ts";
import { ActionForm, Notice, Row, RowList, RowText, Select, StatusBadge, TextInput } from "./ui.tsx";

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

/** Переключатель «Администратор» в карточке сотрудника: то же членство в группе администраторов, с предупреждением и подтверждением. */
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
  if (state === undefined) return <Notice>Проверяем…</Notice>;
  if (state === null) return <Notice>Не удалось проверить. Обновите страницу.</Notice>;
  return <div className="grid gap-2">
    <label className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" role="switch" aria-label="Администратор" aria-checked={state.enabled} checked={pending ? !state.enabled : state.enabled} disabled={busy || (!state.enabled && !state.member_active)} onChange={() => setPending(!pending)} />
      Администратор организации
    </label>
    {pending && <div role="region" aria-label="Подтверждение администратора" className="grid gap-2 rounded-lg border border-kumo-line bg-kumo-elevated p-3 text-[13px]">
      {!state.enabled && <p className="m-0">Администратор читает и меняет материалы всех проектов организации, управляет людьми и правилами. Согласование специалистами сохраняется. Назначайте только тем, кому нужен полный доступ.</p>}
      {state.enabled && <p className="m-0">Сотрудник потеряет права администратора. Личные права и доступ к проектам сохранятся.</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void confirm()}>{state.enabled ? "Снять права администратора" : "Сделать администратором"}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPending(false)}>Отмена</Button>
      </div>
    </div>}
    {error && <Notice tone="danger">{error}</Notice>}
  </div>;
}

/** Метки компетенций сотрудника: добавить и убрать. */
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
    <div className="flex flex-wrap gap-1.5">
      {mine.length === 0 && <span className="text-[13px] text-kumo-subtle">Компетенции не отмечены.</span>}
      {mine.map(r => <span key={r.id} className="inline-flex items-center gap-1 rounded-full bg-kumo-fill px-2 py-0.5 text-[12px]">{r.name}
        <button type="button" aria-label={`Убрать компетенцию: ${r.name}`} disabled={busy} onClick={() => void change(r.id, false)} className="text-kumo-subtle hover:text-kumo-default"><X size={12} /></button>
      </span>)}
    </div>
    {others.length > 0 && <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Добавить компетенцию" value={adding} disabled={busy} onChange={e => setAdding(e.target.value)}>
        <option value="">Выберите компетенцию</option>
        {others.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </Select>
      <Button size="sm" variant="secondary" disabled={busy || !adding} onClick={() => void change(adding, true)}><Plus size={14} />Добавить</Button>
    </div>}
    {roles.length === 0 && <Notice>В организации ещё нет компетенций. Создайте их в разделе «Компетенции».</Notice>}
    {error && <Notice tone="danger">{error}</Notice>}
  </div>;
}

/** «Компетенции»: что сотрудники умеют и могут согласовывать. Список, создание, кто владеет. */
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
  const role = roles.find(r => r.id === selected);
  return <section aria-label="Компетенции" className="grid gap-5">
    <p className="m-0 max-w-[650px] text-sm text-kumo-subtle">Компетенция — то, что сотрудник умеет или вправе проверять, например «Проверка ТЗ» или «Юридическая экспертиза». По компетенциям назначают согласующих и открывают доступ к материалам своей области.</p>
    <ActionForm aria-label="Новая компетенция" onAction={() => void create()} className="flex max-w-lg flex-wrap items-end gap-2">
      <label className="grid flex-1 gap-1.5 text-sm">Новая компетенция<TextInput value={name} maxLength={255} disabled={busy} onChange={e => setName(e.target.value)} placeholder="Например, Проверка ТЗ" /></label>
      <Button type="button" variant="secondary" disabled={busy || !name.trim()} onClick={() => void create()}><Plus size={16} />Создать</Button>
    </ActionForm>
    {error && <Notice tone="danger">{error}</Notice>}
    {loading ? <Notice>Загрузка компетенций…</Notice> : failed ? <Notice tone="danger">Компетенции недоступны. Обновите страницу.</Notice> : roles.length === 0 ? <Notice>Компетенций пока нет. Создайте первую.</Notice> :
      <div className="grid items-start gap-5 md:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="Список компетенций" className="flex flex-col gap-1">
          {roles.map(r => <button key={r.id} type="button" aria-pressed={selected === r.id} onClick={() => setSelected(r.id)} className={`rounded-lg px-3 py-2 text-left text-sm ${selected === r.id ? "bg-kumo-fill font-medium" : "hover:bg-kumo-tint"}`}>{r.name || "Без названия"}</button>)}
        </nav>
        <div className="min-w-0">{role ? <Holders key={role.id} role={role} people={people} /> : <Notice>Выберите компетенцию, чтобы увидеть, у кого она есть.</Notice>}</div>
      </div>}
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
  return <section aria-label={`Компетенция ${role.name}`} className="grid gap-3">
    <h3 className="m-0 text-[15px] font-semibold">{role.name}</h3>
    {holders.length === 0 ? <Notice>Ни у кого из сотрудников нет этой компетенции.</Notice> :
      <RowList>{holders.map(p => <Row key={p.userName}>
        <RowText title={p.displayName || "Сотрудник без имени"} />
        <StatusBadge tone="success">Владеет</StatusBadge>
        <Button size="sm" variant="ghost" aria-label={`Убрать у сотрудника: ${p.displayName || "без имени"}`} disabled={busy} onClick={() => void change(p.userName, false)}><X size={14} /></Button>
      </Row>)}</RowList>}
    {others.length > 0 && <div className="flex flex-wrap items-center gap-2">
      <Select aria-label={`Добавить сотрудника в компетенцию ${role.name}`} value={adding} disabled={busy} onChange={e => setAdding(e.target.value)}>
        <option value="">Выберите сотрудника</option>
        {others.map(p => <option key={p.userName} value={p.userName}>{p.displayName || "Сотрудник без имени"}</option>)}
      </Select>
      <Button size="sm" variant="secondary" disabled={busy || !adding} onClick={() => void change(adding, true)}>Добавить</Button>
    </div>}
    {error && <Notice tone="danger">{error}</Notice>}
  </section>;
}
