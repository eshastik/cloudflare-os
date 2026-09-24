import { useEffect, useState } from "react";
import { Button } from "@cloudflare/kumo";
import { Copy, Plus, Trash, UserPlus } from "@phosphor-icons/react";
import type { InvitationRole, OrganizationInvitation, OrgUnit, OrgUnitDeletion } from "../src/mnemos-api.ts";
import type { AdminPerson } from "../src/admin-people.ts";
import { useUi } from "./host.ts";
import { ActionForm, AdminDetails, Notice, Row, RowList, RowText, Select, StatusBadge, TextInput, type BadgeTone } from "./ui.tsx";

/** Отделы, видимые человеку; ошибка чтения — пустой список (старый сервер отделов не знает). */
export function useOrgUnits(revision = 0): { units: OrgUnit[]; loading: boolean; failed: boolean; reload(): void } {
  const ui = useUi();
  const [units, setUnits] = useState<OrgUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [own, setOwn] = useState(0);
  useEffect(() => {
    let current = true; setLoading(true); setFailed(false);
    void Promise.resolve().then(() => ui.listOrgUnits()).then(list => { if (current) setUnits(list.map(u => ({ ...u, members: u.members ?? [] }))); },
      () => { if (current) { setUnits([]); setFailed(true); } }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [ui, revision, own]);
  return { units, loading, failed, reload: () => setOwn(v => v + 1) };
}

/** Отделы, где человек — руководитель. */
export function headedUnits(units: OrgUnit[], userId: string): OrgUnit[] {
  return units.filter(u => u.members.some(m => m.principal_id === userId && m.is_head));
}

const STATUS: Record<OrganizationInvitation["status"], [string, BadgeTone]> = {
  open: ["Ждёт входа", "info"], accepted: ["Вошёл", "success"], revoked: ["Отозвано", "neutral"], expired: ["Срок истёк", "neutral"],
};

function dateOf(value?: string): string {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "";
}

const ROLE_WORDS: Record<InvitationRole, string> = { employee: "Сотрудник", head: "Руководитель отдела", admin: "Администратор" };

/** «Пригласить»: почта, имя, отдел и роль → одноразовая ссылка. Администратор выбирает любой отдел и любую роль,
 * руководитель — только свой отдел и роли «Сотрудник» или «Руководитель отдела». */
export function InvitePanel({ units, allowNoUnit, admin }: { units: OrgUnit[]; allowNoUnit: boolean; admin: boolean }) {
  const ui = useUi();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState(allowNoUnit ? "" : units[0]?.org_unit_id ?? "");
  const [role, setRole] = useState<InvitationRole>("employee");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ link: string; who: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [list, setList] = useState<OrganizationInvitation[] | null>(null);
  const [listError, setListError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true; setListError(false);
    void Promise.resolve().then(() => ui.listInvitations()).then(out => { if (current) setList(out); }, () => { if (current) { setList([]); setListError(true); } });
    return () => { current = false; };
  }, [ui, revision]);
  useEffect(() => { if (!allowNoUnit && !unit && units[0]) setUnit(units[0].org_unit_id); }, [allowNoUnit, unit, units]);

  const roleBlocked = role === "head" && !unit;
  const submit = async () => {
    if (busy || !email.trim() || (!allowNoUnit && !unit) || roleBlocked) return;
    setBusy(true); setError(""); setCreated(null); setCopied(false);
    try {
      const out = await ui.createInvitation(email.trim(), name.trim(), unit, role);
      setCreated({ link: out.link, who: name.trim() || email.trim() });
      setEmail(""); setName(""); setRole("employee"); setRevision(v => v + 1);
    } catch {
      setError("Приглашение не создано. Проверьте почту и что у вас есть право приглашать в этот отдел.");
    } finally { setBusy(false); }
  };
  const copy = async (link: string) => {
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  };
  const revoke = async (invitation: OrganizationInvitation) => {
    setBusy(true); setError("");
    try { await ui.revokeInvitation(invitation.invitation_id); setRevision(v => v + 1); }
    catch { setError("Ссылку не удалось отозвать. Обновите список и повторите."); }
    finally { setBusy(false); }
  };

  return <section aria-label="Пригласить сотрудника" className="grid gap-5">
    <ActionForm aria-label="Приглашение" className="grid max-w-lg gap-3" onAction={() => void submit()}>
      <h2 className="m-0 text-base font-semibold">Пригласить сотрудника</h2>
      <p className="m-0 text-sm text-kumo-subtle">Получите ссылку и отправьте её сотруднику. Он войдёт по ней и сразу окажется в организации{units.length ? " и в выбранном отделе" : ""}.</p>
      <label className="grid gap-1.5 text-sm">Почта<TextInput type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="anna@company.ru" /></label>
      <label className="grid gap-1.5 text-sm">Имя (необязательно)<TextInput value={name} onChange={e => setName(e.target.value)} placeholder="Анна Смирнова" /></label>
      {(units.length > 0 || !allowNoUnit) && <label className="grid gap-1.5 text-sm">Отдел<Select aria-label="Отдел приглашения" value={unit} onChange={e => setUnit(e.target.value)}>
        {allowNoUnit && <option value="">Без отдела</option>}
        {units.map(u => <option key={u.org_unit_id} value={u.org_unit_id}>{u.name}</option>)}
      </Select></label>}
      <label className="grid gap-1.5 text-sm">Роль<Select aria-label="Роль приглашённого" value={role} onChange={e => setRole(e.target.value as InvitationRole)}>
        <option value="employee">{ROLE_WORDS.employee}</option>
        <option value="head">{ROLE_WORDS.head}</option>
        {admin && <option value="admin">{ROLE_WORDS.admin}</option>}
      </Select></label>
      {roleBlocked && <Notice>Чтобы пригласить руководителя, выберите его отдел.</Notice>}
      {role === "admin" && <Notice>Администратор видит и меняет материалы всех проектов, управляет людьми и правилами.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      <div><Button type="button" variant="primary" disabled={busy || !email.trim() || (!allowNoUnit && !unit) || roleBlocked} onClick={() => void submit()}><UserPlus size={16} />{busy ? "Создаём…" : "Получить ссылку"}</Button></div>
    </ActionForm>
    {created && <div role="region" aria-label="Ссылка-приглашение" className="grid max-w-2xl gap-2 rounded-xl border border-kumo-line bg-kumo-elevated p-4">
      <strong className="text-sm">Ссылка для: {created.who}</strong>
      <TextInput readOnly aria-label="Ссылка-приглашение" value={created.link} onFocus={e => e.currentTarget.select()} className="w-full" />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => void copy(created.link)}><Copy size={16} />Скопировать</Button>
        {copied && <Notice tone="success">Скопировано.</Notice>}
      </div>
      <p className="m-0 text-[12px] text-kumo-subtle">Ссылка сработает один раз и действует 7 дней. Сотрудник входит тем же способом, что и все в организации.</p>
    </div>}
    <div>
      <h3 className="m-0 mb-2 text-[15px] font-semibold">Приглашения</h3>
      {list === null ? <Notice>Загрузка приглашений…</Notice> : listError ? <Notice tone="danger">Список приглашений недоступен.</Notice> : list.length === 0 ? <Notice>Приглашений пока нет.</Notice> :
        <RowList>{list.map(i => {
          const [label, tone] = STATUS[i.status];
          const who = i.display_name || i.email;
          return <Row key={i.invitation_id}>
            <RowText title={who} note={[i.display_name ? i.email : "", i.org_unit_name ? `отдел «${i.org_unit_name}»` : "", i.role && i.role !== "employee" ? ROLE_WORDS[i.role].toLowerCase() : "", i.status === "accepted" && i.accepted_by_name ? `вошёл как ${i.accepted_by_name}` : "", i.status === "open" ? `до ${dateOf(i.expires_at)}` : "", i.created_by_name ? `пригласил(а) ${i.created_by_name}` : ""].filter(Boolean).join(" · ")}>
              <AdminDetails show={admin} items={[["Приглашение", i.invitation_id], ["Сотрудник", i.accepted_by]]} />
            </RowText>
            <StatusBadge tone={tone}>{label}</StatusBadge>
            {i.status === "open" && <Button size="sm" variant="ghost" aria-label={`Отозвать приглашение: ${who}`} disabled={busy} onClick={() => void revoke(i)}><Trash size={16} /></Button>}
          </Row>;
        })}</RowList>}
    </div>
  </section>;
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
}
/** Итог удаления отдела словами. */
export function deletionSummary(name: string, out: OrgUnitDeletion): string {
  const parts = [
    out.projects_made_private ? `${out.projects_made_private} ${plural(out.projects_made_private, "проект стал личным", "проекта стали личными", "проектов стали личными")}` : "",
    out.members_removed ? `${out.members_removed} ${plural(out.members_removed, "сотрудник остался", "сотрудника остались", "сотрудников остались")} без отдела` : "",
    out.requests_closed ? `закрыто запросов: ${out.requests_closed}` : "",
    out.invitations_revoked ? `отозвано приглашений: ${out.invitations_revoked}` : "",
  ].filter(Boolean);
  return `Отдел «${name}» удалён.${parts.length ? " " + parts.join(", ") + "." : ""}`;
}

/** Отделы для администратора: создать и удалить отдел, состав, руководитель. */
export function DepartmentsPanel({ people }: { people: AdminPerson[] }) {
  const ui = useUi();
  const { units, loading, failed, reload } = useOrgUnits();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState("");
  const [openUnit, setOpenUnit] = useState("");
  const [result, setResult] = useState("");
  const nameOf = (id: string, fallback: string) => fallback || people.find(p => p.userName === id)?.displayName || "Сотрудник";
  const run = async (work: () => Promise<unknown>, failure: string) => {
    if (busy) return;
    setBusy(true); setError(""); setResult("");
    try { await work(); reload(); } catch { setError(failure); } finally { setBusy(false); }
  };
  const remove = (unit: OrgUnit) => void run(async () => {
    const out = await ui.deleteOrgUnit(unit.org_unit_id);
    setDeleting("");
    setResult(deletionSummary(unit.name, out));
  }, "Отдел не удалён. Удалять отделы может только администратор организации; обновите список и повторите.");
  const createUnit = () => { const value = name.trim(); if (value) void run(async () => { await ui.createOrgUnit(value); setName(""); }, "Отдел не создан. Возможно, у вас нет права администратора организации."); };
  return <section aria-label="Отделы" className="grid gap-5">
    <ActionForm aria-label="Новый отдел" className="flex max-w-lg flex-wrap items-end gap-2" onAction={createUnit}>
      <label className="grid flex-1 gap-1.5 text-sm">Новый отдел<TextInput value={name} onChange={e => setName(e.target.value)} placeholder="Например, Продажи" /></label>
      <Button type="button" variant="secondary" disabled={busy || !name.trim()} onClick={createUnit}><Plus size={16} />Создать отдел</Button>
    </ActionForm>
    {error && <Notice tone="danger">{error}</Notice>}
    {result && <Notice tone="success">{result}</Notice>}
    {loading ? <Notice>Загрузка отделов…</Notice> : failed ? <Notice tone="danger">Отделы недоступны. Проверьте подключение и полномочия.</Notice> : units.length === 0 ? <Notice>Отделов пока нет. Создайте первый: руководитель отдела подтверждает, когда сотрудник делится проектом с отделом.</Notice> :
      units.map(unit => {
        const inside = new Set(unit.members.map(m => m.principal_id));
        const candidates = people.filter(p => p.active && !inside.has(p.userName));
        const heads = unit.members.filter(m => m.is_head).length;
        return <section key={unit.org_unit_id} aria-label={`Отдел ${unit.name}`} className="rounded-xl border border-kumo-line p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-expanded={openUnit === unit.org_unit_id} onClick={() => setOpenUnit(openUnit === unit.org_unit_id ? "" : unit.org_unit_id)} className="text-left text-[15px] font-semibold hover:underline">{unit.name}</button>
            <span className="text-[12px] text-kumo-subtle">{unit.members.length ? `сотрудников: ${unit.members.length}` : "пока никого"}</span>
            {heads === 0 && unit.members.length > 0 && <StatusBadge tone="warning">Нет руководителя</StatusBadge>}
            <div className="flex-1" />
            {openUnit === unit.org_unit_id && deleting !== unit.org_unit_id && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDeleting(unit.org_unit_id); setResult(""); }}>Удалить отдел</Button>}
          </div>
          {openUnit === unit.org_unit_id && <div className="mt-3">
          {deleting === unit.org_unit_id && <div role="region" aria-label={`Удаление отдела ${unit.name}`} className="mb-3 grid gap-2 rounded-lg border border-kumo-line bg-kumo-elevated p-3 text-[13px]">
            <p className="m-0">Удалить отдел «{unit.name}»? Проекты, открытые отделу, станут видны только их создателям; сотрудники останутся в организации без отдела; незавершённые запросы и приглашения в отдел будут закрыты.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" disabled={busy} onClick={() => remove(unit)}>Удалить</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeleting("")}>Отмена</Button>
            </div>
          </div>}
          {unit.members.length > 0 && <RowList>{unit.members.map(m => {
            const who = nameOf(m.principal_id, m.display_name);
            return <Row key={m.principal_id}>
              <RowText title={who} />
              {m.is_head && <StatusBadge tone="success">Руководитель</StatusBadge>}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => ui.setOrgUnitMember(unit.org_unit_id, m.principal_id, true, !m.is_head), "Изменение не сохранено.")}>{m.is_head ? "Снять руководство" : "Сделать руководителем"}</Button>
              <Button size="sm" variant="ghost" aria-label={`Убрать из отдела: ${who}`} disabled={busy} onClick={() => void run(() => ui.setOrgUnitMember(unit.org_unit_id, m.principal_id, false, false), "Сотрудник не убран из отдела.")}><Trash size={16} /></Button>
            </Row>;
          })}</RowList>}
          {candidates.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select aria-label={`Добавить в отдел ${unit.name}`} value={adding[unit.org_unit_id] ?? ""} onChange={e => setAdding({ ...adding, [unit.org_unit_id]: e.target.value })}>
              <option value="">Выберите сотрудника</option>
              {candidates.map(p => <option key={p.userName} value={p.userName}>{p.displayName || "Сотрудник без имени"}</option>)}
            </Select>
            <Button size="sm" variant="secondary" disabled={busy || !adding[unit.org_unit_id]} onClick={() => { const who = adding[unit.org_unit_id]; if (who) void run(async () => { await ui.setOrgUnitMember(unit.org_unit_id, who, true, false); setAdding({ ...adding, [unit.org_unit_id]: "" }); }, "Сотрудник не добавлен в отдел."); }}>Добавить в отдел</Button>
          </div>}
          </div>}
        </section>;
      })}
  </section>;
}
