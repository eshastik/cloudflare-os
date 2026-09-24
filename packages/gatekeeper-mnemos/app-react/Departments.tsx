import { useEffect, useState } from "react";
import { Copy, Trash } from "@phosphor-icons/react";
import type { InvitationRole, OrganizationInvitation, OrgUnit, OrgUnitDeletion } from "../src/mnemos-api.ts";
import type { AdminPerson } from "../src/admin-people.ts";
import { useUi } from "./host.ts";
import { ActionForm, Notice } from "./ui.tsx";
import { Card, CardRow, Field, FieldInput, FieldSelect, Initials, Pill, PillInput, PillSelect, RowTitle, SectionHead, plural } from "./admin-ui.tsx";

export type OrgUnits = { units: OrgUnit[]; loading: boolean; failed: boolean; reload(): void };

/** Отделы, видимые человеку; ошибка чтения — пустой список (старый сервер отделов не знает). */
export function useOrgUnits(revision = 0): OrgUnits {
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

function dateOf(value?: string): string {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "";
}

export const ROLE_WORDS: Record<InvitationRole, string> = { employee: "Сотрудник", head: "Руководитель отдела", admin: "Администратор" };

/** Приглашения организации: список и перечитывание после создания или отзыва. */
export function useInvitations(): { list: OrganizationInvitation[] | null; failed: boolean; reload(): void } {
  const ui = useUi();
  const [list, setList] = useState<OrganizationInvitation[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true; setFailed(false);
    void Promise.resolve().then(() => ui.listInvitations()).then(out => { if (current) setList(out); }, () => { if (current) { setList([]); setFailed(true); } });
    return () => { current = false; };
  }, [ui, revision]);
  return { list, failed, reload: () => setRevision(v => v + 1) };
}

/** Строка приглашения словами: для кого, куда, с какой ролью, до какого дня. */
function invitationNote(i: OrganizationInvitation): string {
  return [i.display_name ? i.email : "", i.org_unit_name ? `отдел «${i.org_unit_name}»` : "", i.role && i.role !== "employee" ? ROLE_WORDS[i.role].toLowerCase() : "",
    i.status === "open" ? `приглашение ждёт входа, ссылка действует до ${dateOf(i.expires_at)}` : i.status === "expired" ? "срок ссылки истёк" : i.status === "revoked" ? "приглашение отозвано" : "",
    i.created_by_name ? `пригласил(а) ${i.created_by_name}` : ""].filter(Boolean).join(" · ");
}

/** Открытые приглашения строками карточки: приглашённый выглядит как будущий сотрудник, рядом — «Отозвать». */
export function InvitationRows({ list, onChanged }: { list: OrganizationInvitation[]; onChanged(): void }) {
  const ui = useUi();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const revoke = async (invitation: OrganizationInvitation) => {
    const who = invitation.display_name || invitation.email;
    setBusy(true); setNotice(null);
    try { await ui.revokeInvitation(invitation.invitation_id); setNotice({ tone: "success", text: `Приглашение для ${who} отозвано.` }); onChanged(); }
    catch { setNotice({ tone: "danger", text: "Ссылку не удалось отозвать. Обновите список и повторите." }); }
    finally { setBusy(false); }
  };
  const open = list.filter(i => i.status === "open");
  return <>
    {open.map(i => {
      const who = i.display_name || i.email;
      return <CardRow key={i.invitation_id} data-invitation="">
        <Initials name={who} />
        <RowTitle title={who} note={invitationNote(i)} />
        <Pill tone="ghost" aria-label={`Отозвать приглашение: ${who}`} disabled={busy} onClick={() => void revoke(i)}>Отозвать</Pill>
      </CardRow>;
    })}
    {notice && <div className="border-t border-kumo-fill px-4 py-2.5 first:border-t-0"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
  </>;
}

/** Форма приглашения в одну строку: почта, имя, отдел, роль → одноразовая ссылка.
 * Администратор выбирает любой отдел и любую роль, руководитель — только свой отдел и роли «Сотрудник» или «Руководитель отдела». */
export function InviteForm({ units, allowNoUnit, admin, onCreated }: { units: OrgUnit[]; allowNoUnit: boolean; admin: boolean; onCreated(): void }) {
  const ui = useUi();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState(allowNoUnit ? "" : units[0]?.org_unit_id ?? "");
  const [role, setRole] = useState<InvitationRole>("employee");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ link: string; who: string; email: string; mailed?: "sent" | "failed" | "not_configured" } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!allowNoUnit && !unit && units[0]) setUnit(units[0].org_unit_id); }, [allowNoUnit, unit, units]);

  const roleBlocked = role === "head" && !unit;
  const blocked = busy || !email.trim() || (!allowNoUnit && !unit) || roleBlocked;
  const submit = async () => {
    if (blocked) return;
    setBusy(true); setError(""); setCreated(null); setCopied(false);
    try {
      const out = await ui.createInvitation(email.trim(), name.trim(), unit, role);
      setCreated({ link: out.link, who: name.trim() || email.trim(), email: email.trim(), mailed: out.invitation.email_status });
      setEmail(""); setName(""); setRole("employee"); onCreated();
    } catch {
      setError("Приглашение не создано. Проверьте почту и что у вас есть право приглашать в этот отдел.");
    } finally { setBusy(false); }
  };
  const copy = async (link: string) => {
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  };
  const showUnit = units.length > 0 || !allowNoUnit;
  return <section aria-label="Пригласить сотрудника" className="grid gap-3">
    <Card className="p-5">
      <ActionForm aria-label="Приглашение" className="grid items-end gap-2.5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" onAction={() => void submit()}>
        <Field label="Почта"><FieldInput type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="anna@company.ru" /></Field>
        <Field label="Имя, если знаете"><FieldInput value={name} onChange={e => setName(e.target.value)} placeholder="Анна Смирнова" /></Field>
        {showUnit ? <Field label="Отдел"><FieldSelect aria-label="Отдел приглашения" value={unit} onChange={e => setUnit(e.target.value)}>
          {allowNoUnit && <option value="">Без отдела</option>}
          {units.map(u => <option key={u.org_unit_id} value={u.org_unit_id}>{u.name}</option>)}
        </FieldSelect></Field> : <span />}
        <Field label="Роль"><FieldSelect aria-label="Роль приглашённого" value={role} onChange={e => setRole(e.target.value as InvitationRole)}>
          <option value="employee">{ROLE_WORDS.employee}</option>
          <option value="head">{ROLE_WORDS.head}</option>
          {admin && <option value="admin">{ROLE_WORDS.admin}</option>}
        </FieldSelect></Field>
        <Pill tone="primary" size="md" className="h-[42px]" disabled={blocked} onClick={() => void submit()}>{busy ? "Отправляем…" : "Отправить приглашение"}</Pill>
      </ActionForm>
      <p className="mt-3 mb-0 text-[13px] text-kumo-subtle">Сотрудник получит письмо со ссылкой, войдёт по ней и сразу окажется в организации{units.length ? " и в выбранном отделе" : ""}. Ссылка сработает один раз и действует 7 дней.</p>
      {roleBlocked && <div className="mt-2"><Notice>Чтобы пригласить руководителя, выберите его отдел.</Notice></div>}
      {role === "admin" && <div className="mt-2"><Notice>Администратор видит и меняет материалы всех проектов, управляет людьми и правилами.</Notice></div>}
      {error && <div className="mt-2"><Notice tone="danger">{error}</Notice></div>}
      {created && <div role="region" aria-label="Ссылка-приглашение" className="mt-4 grid gap-2 border-t border-kumo-fill pt-4">
        {created.mailed === "sent"
          ? <Notice tone="success">Письмо со ссылкой отправлено на {created.email}. Ссылку ниже можно передать и самим.</Notice>
          : created.mailed === "failed"
            ? <Notice tone="danger">Письмо на {created.email} не ушло. Передайте ссылку сами — например, в мессенджере.</Notice>
            : <Notice>Отправка писем не настроена: передайте ссылку сами.</Notice>}
        <strong className="text-[14px] font-medium">Ссылка для: {created.who}</strong>
        <div className="flex flex-wrap items-center gap-2">
          <FieldInput readOnly aria-label="Ссылка-приглашение" value={created.link} onFocus={e => e.currentTarget.select()} className="min-w-0 flex-1" />
          <Pill onClick={() => void copy(created.link)}><Copy size={14} />Скопировать</Pill>
          {copied && <Notice tone="success">Скопировано.</Notice>}
        </div>
      </div>}
    </Card>
  </section>;
}

/** Приглашение и открытые приглашения — для руководителя отдела без полномочия управления людьми. */
export function InvitePanel({ units, allowNoUnit, admin }: { units: OrgUnit[]; allowNoUnit: boolean; admin: boolean }) {
  const invitations = useInvitations();
  const open = (invitations.list ?? []).filter(i => i.status === "open");
  return <div className="grid gap-6">
    <InviteForm units={units} allowNoUnit={allowNoUnit} admin={admin} onCreated={invitations.reload} />
    <section aria-label="Приглашения">
      <SectionHead title="Приглашения" />
      {invitations.list === null ? <Notice>Загрузка приглашений…</Notice> : invitations.failed ? <Notice tone="danger">Список приглашений недоступен.</Notice> : open.length === 0 ? <Notice>Открытых приглашений нет.</Notice> :
        <Card><InvitationRows list={invitations.list} onChanged={invitations.reload} /></Card>}
    </section>
  </div>;
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

/** Отделы для администратора: строка на отдел, «Удалить отдел» видна в строке сразу; состав раскрывается на месте. */
export function DepartmentsPanel({ people, org }: { people: AdminPerson[]; org: OrgUnits }) {
  const ui = useUi();
  const { units, loading, failed, reload } = org;
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
  const summary = (unit: OrgUnit): { text: string; warn: boolean } => {
    const heads = unit.members.filter(m => m.is_head).map(m => nameOf(m.principal_id, m.display_name));
    const count = unit.members.length ? `${unit.members.length} ${plural(unit.members.length, "сотрудник", "сотрудника", "сотрудников")}` : "пока никого";
    if (!unit.members.length) return { text: count, warn: false };
    return heads.length ? { text: `${count} · ${plural(heads.length, "руководитель", "руководители", "руководители")} ${heads.join(", ")}`, warn: false } : { text: `${count} · нет руководителя`, warn: true };
  };
  return <section aria-label="Отделы" className="min-w-0">
    <SectionHead title="Отделы" />
    {error && <div className="mb-2"><Notice tone="danger">{error}</Notice></div>}
    {result && <div className="mb-2"><Notice tone="success">{result}</Notice></div>}
    <Card>
      {loading ? <CardRow><Notice>Загрузка отделов…</Notice></CardRow> : failed ? <CardRow><Notice tone="danger">Отделы недоступны. Проверьте подключение и полномочия.</Notice></CardRow> : units.length === 0 ? <CardRow><Notice>Отделов пока нет. Руководитель отдела подтверждает, когда сотрудник делится проектом с отделом.</Notice></CardRow> :
        units.map(unit => {
          const inside = new Set(unit.members.map(m => m.principal_id));
          const candidates = people.filter(p => p.active && !inside.has(p.userName));
          const expanded = openUnit === unit.org_unit_id;
          const { text, warn } = summary(unit);
          return <section key={unit.org_unit_id} aria-label={`Отдел ${unit.name}`} className="border-t border-kumo-fill first:border-t-0">
            <div className="flex items-center gap-2.5 px-4 py-3">
              <span className="block min-w-0 flex-1">
                <button type="button" aria-expanded={expanded} onClick={() => setOpenUnit(expanded ? "" : unit.org_unit_id)} className="block max-w-full break-words text-left text-[15px] font-medium text-kumo-default hover:underline">{unit.name}</button>
                <span className={`block text-[13px] ${warn ? "text-kumo-warning" : "text-kumo-subtle"}`}>{text}</span>
              </span>
              {/* Кнопка видна в строке всегда: владелец не нашёл её за раскрытием отдела. */}
              {deleting !== unit.org_unit_id && <Pill tone="danger" disabled={busy} onClick={() => { setOpenUnit(unit.org_unit_id); setDeleting(unit.org_unit_id); setResult(""); }}>Удалить отдел</Pill>}
            </div>
            {expanded && <div className="grid gap-2 px-4 pb-4">
              {deleting === unit.org_unit_id && <div role="region" aria-label={`Удаление отдела ${unit.name}`} className="grid gap-2 rounded-xl bg-kumo-tint p-3 text-[13px]">
                <p className="m-0">Удалить отдел «{unit.name}»? Проекты, открытые отделу, станут видны только их создателям; сотрудники останутся в организации без отдела; незавершённые запросы и приглашения в отдел будут закрыты.</p>
                <div className="flex gap-2">
                  <Pill tone="primary" disabled={busy} onClick={() => remove(unit)}>Удалить</Pill>
                  <Pill tone="ghost" disabled={busy} onClick={() => setDeleting("")}>Отмена</Pill>
                </div>
              </div>}
              {unit.members.map(m => {
                const who = nameOf(m.principal_id, m.display_name);
                return <div key={m.principal_id} className="flex flex-wrap items-center gap-2 rounded-xl px-1 py-1 text-[14px]">
                  <span className="min-w-0 flex-1 break-words">{who}</span>
                  {m.is_head && <span className="rounded-full bg-kumo-tint px-2 py-0.5 text-[12px] text-kumo-brand">Руководитель</span>}
                  <Pill tone="ghost" disabled={busy} onClick={() => void run(() => ui.setOrgUnitMember(unit.org_unit_id, m.principal_id, true, !m.is_head), "Изменение не сохранено.")}>{m.is_head ? "Снять руководство" : "Сделать руководителем"}</Pill>
                  <Pill tone="ghost" aria-label={`Убрать из отдела: ${who}`} disabled={busy} onClick={() => void run(() => ui.setOrgUnitMember(unit.org_unit_id, m.principal_id, false, false), "Сотрудник не убран из отдела.")}><Trash size={14} /></Pill>
                </div>;
              })}
              {candidates.length > 0 && <div className="flex flex-wrap items-center gap-2">
                <PillSelect aria-label={`Добавить в отдел ${unit.name}`} value={adding[unit.org_unit_id] ?? ""} onChange={e => setAdding({ ...adding, [unit.org_unit_id]: e.target.value })}>
                  <option value="">Выберите сотрудника</option>
                  {candidates.map(p => <option key={p.userName} value={p.userName}>{p.displayName || "Сотрудник без имени"}</option>)}
                </PillSelect>
                <Pill disabled={busy || !adding[unit.org_unit_id]} onClick={() => { const who = adding[unit.org_unit_id]; if (who) void run(async () => { await ui.setOrgUnitMember(unit.org_unit_id, who, true, false); setAdding({ ...adding, [unit.org_unit_id]: "" }); }, "Сотрудник не добавлен в отдел."); }}>Добавить в отдел</Pill>
              </div>}
            </div>}
          </section>;
        })}
      <ActionForm aria-label="Новый отдел" className="flex flex-wrap items-center gap-2 border-t border-kumo-fill bg-kumo-base px-4 py-3" onAction={createUnit}>
        <label className="min-w-0 flex-1"><span className="sr-only">Новый отдел</span><PillInput className="w-full" value={name} onChange={e => setName(e.target.value)} placeholder="Новый отдел, например «Продажи»" /></label>
        <Pill disabled={busy || !name.trim()} onClick={createUnit}>Создать отдел</Pill>
      </ActionForm>
    </Card>
  </section>;
}
