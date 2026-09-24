import { useEffect, useState } from "react";
import { Button } from "@cloudflare/kumo";
import { Copy, Plus, Trash, UserPlus } from "@phosphor-icons/react";
import type { OrganizationInvitation, OrgUnit } from "../src/mnemos-api.ts";
import type { AdminPerson } from "../src/admin-people.ts";
import { useUi } from "./host.ts";
import { AdminDetails, Notice, Row, RowList, RowText, Select, StatusBadge, TextInput, type BadgeTone } from "./ui.tsx";

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

/** «Пригласить»: почта, имя, отдел → одноразовая ссылка. Администратор выбирает любой отдел, руководитель — свой. */
export function InvitePanel({ units, allowNoUnit, admin }: { units: OrgUnit[]; allowNoUnit: boolean; admin: boolean }) {
  const ui = useUi();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState(allowNoUnit ? "" : units[0]?.org_unit_id ?? "");
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

  const submit = async () => {
    if (busy) return;
    setBusy(true); setError(""); setCreated(null); setCopied(false);
    try {
      const out = await ui.createInvitation(email.trim(), name.trim(), unit);
      setCreated({ link: out.link, who: name.trim() || email.trim() });
      setEmail(""); setName(""); setRevision(v => v + 1);
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
    <form className="grid max-w-lg gap-3" onSubmit={e => { e.preventDefault(); void submit(); }}>
      <h2 className="m-0 text-base font-semibold">Пригласить сотрудника</h2>
      <p className="m-0 text-sm text-kumo-subtle">Получите ссылку и отправьте её сотруднику. Он войдёт по ней и сразу окажется в организации{units.length ? " и в выбранном отделе" : ""}.</p>
      <label className="grid gap-1.5 text-sm">Почта<TextInput type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="anna@company.ru" /></label>
      <label className="grid gap-1.5 text-sm">Имя (необязательно)<TextInput value={name} onChange={e => setName(e.target.value)} placeholder="Анна Смирнова" /></label>
      {(units.length > 0 || !allowNoUnit) && <label className="grid gap-1.5 text-sm">Отдел<Select aria-label="Отдел приглашения" value={unit} onChange={e => setUnit(e.target.value)}>
        {allowNoUnit && <option value="">Без отдела</option>}
        {units.map(u => <option key={u.org_unit_id} value={u.org_unit_id}>{u.name}</option>)}
      </Select></label>}
      {error && <Notice tone="danger">{error}</Notice>}
      <div><Button type="submit" variant="primary" disabled={busy || !email.trim() || (!allowNoUnit && !unit)}><UserPlus size={16} />{busy ? "Создаём…" : "Получить ссылку"}</Button></div>
    </form>
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
            <RowText title={who} note={[i.display_name ? i.email : "", i.org_unit_name ? `отдел «${i.org_unit_name}»` : "", i.status === "accepted" && i.accepted_by_name ? `вошёл как ${i.accepted_by_name}` : "", i.status === "open" ? `до ${dateOf(i.expires_at)}` : "", i.created_by_name ? `пригласил(а) ${i.created_by_name}` : ""].filter(Boolean).join(" · ")}>
              <AdminDetails show={admin} items={[["Приглашение", i.invitation_id], ["Сотрудник", i.accepted_by]]} />
            </RowText>
            <StatusBadge tone={tone}>{label}</StatusBadge>
            {i.status === "open" && <Button size="sm" variant="ghost" aria-label={`Отозвать приглашение: ${who}`} disabled={busy} onClick={() => void revoke(i)}><Trash size={16} /></Button>}
          </Row>;
        })}</RowList>}
    </div>
  </section>;
}

/** Отделы для администратора: создать отдел, состав, руководитель. */
export function DepartmentsPanel({ people }: { people: AdminPerson[] }) {
  const ui = useUi();
  const { units, loading, failed, reload } = useOrgUnits();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<Record<string, string>>({});
  const nameOf = (id: string, fallback: string) => fallback || people.find(p => p.userName === id)?.displayName || "Сотрудник";
  const run = async (work: () => Promise<unknown>, failure: string) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await work(); reload(); } catch { setError(failure); } finally { setBusy(false); }
  };
  return <section aria-label="Отделы" className="grid gap-5">
    <form className="flex max-w-lg flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); const value = name.trim(); if (value) void run(async () => { await ui.createOrgUnit(value); setName(""); }, "Отдел не создан. Возможно, у вас нет права администратора организации."); }}>
      <label className="grid flex-1 gap-1.5 text-sm">Новый отдел<TextInput value={name} onChange={e => setName(e.target.value)} placeholder="Например, Продажи" /></label>
      <Button type="submit" variant="secondary" disabled={busy || !name.trim()}><Plus size={16} />Создать отдел</Button>
    </form>
    {error && <Notice tone="danger">{error}</Notice>}
    {loading ? <Notice>Загрузка отделов…</Notice> : failed ? <Notice tone="danger">Отделы недоступны. Проверьте подключение и полномочия.</Notice> : units.length === 0 ? <Notice>Отделов пока нет. Создайте первый: руководитель отдела подтверждает, когда сотрудник делится проектом с отделом.</Notice> :
      units.map(unit => {
        const inside = new Set(unit.members.map(m => m.principal_id));
        const candidates = people.filter(p => p.active && !inside.has(p.userName));
        const heads = unit.members.filter(m => m.is_head).length;
        return <section key={unit.org_unit_id} aria-label={`Отдел ${unit.name}`} className="rounded-xl border border-kumo-line p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="m-0 text-[15px] font-semibold">{unit.name}</h3>
            <span className="text-[12px] text-kumo-subtle">{unit.members.length ? `сотрудников: ${unit.members.length}` : "пока никого"}</span>
            {heads === 0 && unit.members.length > 0 && <StatusBadge tone="warning">Нет руководителя</StatusBadge>}
          </div>
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
          <AdminDetails show items={[["Отдел", unit.org_unit_id]]} />
        </section>;
      })}
  </section>;
}
