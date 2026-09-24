import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@cloudflare/kumo";
import type { OperationAuditEvent } from "../src/operation-audit.ts";
import type { PlatformSignal, PlatformSignalOwnerPage } from "../src/mnemos-api.ts";
import { useUi } from "./host.ts";
import { agentNames, looksLikeId, UNNAMED_DOCUMENT, useLoad, type MemoryData } from "./data.ts";
import { describeEvent, MEANINGFUL_ACTIONS, type JournalNames } from "./journal-words.ts";
import { AdminDetails, Block, Notice, Row, RowList, RowText, Select, StatusBadge, TextInput } from "./ui.tsx";
import { relativeTime } from "./time.ts";

/** Сколько последних событий журнала читать за раз. */
const JOURNAL_EVENTS = 100;

/** Подсистемы состояния: название и сигналы, из которых складывается строка. */
const SUBSYSTEMS: { title: string; keys: PlatformSignal["key"][]; ok: string; problem: string }[] = [
  { title: "Сайт и вход", keys: ["external.readiness", "external.login"], ok: "Сайт открывается, сотрудники входят.", problem: "Сайт или вход работают с перебоями. Проверьте, открывается ли сайт; если нет — сообщите ответственному." },
  { title: "Хранилище", keys: ["dependencies"], ok: "База данных и хранилище файлов отвечают.", problem: "Хранилище отвечает с ошибками: материалы могут не сохраняться. Сообщите ответственному." },
  { title: "Чтение материалов", keys: ["external.read"], ok: "Материалы открываются.", problem: "Материалы открываются не всегда. Повторите позже; если не пройдёт — сообщите ответственному." },
  { title: "Сохранение материалов", keys: ["external.save"], ok: "Изменения сохраняются.", problem: "Изменения сохраняются не всегда. Не удаляйте локальные копии, пока не наладится." },
];
type Health = "ok" | "problem" | "unknown";
const DOT: Record<Health, string> = { ok: "bg-kumo-success", problem: "bg-kumo-danger", unknown: "bg-kumo-fill" };

/** «Журнал и состояние»: одна страница — панель состояния и журнал действий словами. */
export default function JournalTab({ data }: { data: MemoryData }) {
  const capabilities = data.identity?.capabilities ?? [];
  const admin = capabilities.includes("principal.manage");
  return <>
    {capabilities.includes("platform.metrics.read") && <SystemState admin={admin} />}
    {admin && <Journal data={data} />}
  </>;
}

/** Состояние системы одной панелью: строка на подсистему словами, числа карточками;
 * техническое раскрывается на месте под «Подробнее для администратора». */
function SystemState({ admin }: { admin: boolean }) {
  const ui = useUi();
  const metrics = useLoad(() => ui.readPlatformMetrics(), "Состояние системы не прочитано. Обновите страницу.", [ui]);
  const usage = metrics.value;
  const signals = usage?.signals ?? [];
  const rows = SUBSYSTEMS.map(sub => {
    const own = signals.filter(sig => sub.keys.includes(sig.key));
    const health: Health = own.some(sig => sig.state === "firing") ? "problem" : own.length && own.every(sig => sig.state === "ok") ? "ok" : "unknown";
    return { ...sub, health };
  });
  const owners = [...new Set((usage?.signal_owners ?? []).filter(o => o.owner_id).map(o => o.owner_name || "сотрудник"))];
  const problems = rows.filter(r => r.health === "problem").length;
  return <Block title="Состояние системы">
    {metrics.loading && !usage && <Notice>Загрузка…</Notice>}
    {metrics.error && <Notice tone="danger">{metrics.error}</Notice>}
    {usage && <div className="grid gap-3" data-system-state="">
      <p className="m-0 text-[13px] text-kumo-default">{problems ? `Есть проблемы: ${problems} из ${rows.length}.` : rows.every(r => r.health === "ok") ? "Всё работает." : "Часть проверок давно не приходила."} <span className="text-kumo-subtle">Проверено {relativeTime(usage.readiness?.checked_at || usage.recorded_at) || "недавно"}.</span></p>
      <RowList>{rows.map(r => <Row key={r.title} data-subsystem={r.health}>
        <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[r.health]}`} />
        <RowText title={r.title} note={r.health === "ok" ? r.ok : r.health === "problem" ? r.problem : "Нет свежих данных проверки."} />
      </Row>)}</RowList>
      <p className="m-0 text-[13px] text-kumo-subtle">{owners.length ? `Ответственный: ${owners.join(", ")}.` : "Ответственный не назначен."}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {([["Сотрудников вошло за сутки", usage.authenticated_users_24h], ["Входов за сутки", usage.human_logins_24h], ["Опубликовано материалов", usage.shared_publications]] as const).map(([label, value]) =>
          <div key={label} className="rounded-lg border border-kumo-line p-3"><div className="text-lg font-semibold">{value}</div><div className="text-[12px] text-kumo-subtle">{label}</div></div>)}
      </div>
      {admin && <details aria-label="Подробнее для администратора" className="text-[13px]">
        <summary className="cursor-pointer text-kumo-subtle">Подробнее для администратора</summary>
        <div className="mt-2 grid gap-3">
          <OwnerPicker onChanged={metrics.reload} />
          <div className="grid gap-1 text-[12px] text-kumo-subtle">
            {signals.map(sig => <p key={sig.key} className="m-0 break-words">{sig.key}: {sig.state} · {sig.reason}{sig.observed_at ? ` · ${sig.observed_at}` : ""}</p>)}
            {!!usage.readiness?.reasons.length && <p className="m-0 break-words">readiness: {usage.readiness.reasons.join("; ")}</p>}
            {usage.deployment && <p className="m-0 break-words">{usage.deployment.environment} · {usage.deployment.release} · {usage.deployment.source_revision}</p>}
          </div>
        </div>
      </details>}
    </div>}
  </Block>;
}

/** Один ответственный за состояние: назначается сразу на все проверки, по имени сотрудника. */
function OwnerPicker({ onChanged }: { onChanged(): Promise<void> }) {
  const ui = useUi();
  const people = useLoad(async () => (await ui.listPeople()).users.filter(p => p.active), "", [ui]);
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function assign() {
    if (busy || !owner) return;
    setBusy(true); setNotice(null);
    try {
      let page: PlatformSignalOwnerPage = await ui.listPlatformSignalOwners();
      for (const row of [...page.owners]) {
        const current = page.owners.find(o => o.signal_key === row.signal_key)!;
        page = await ui.setPlatformSignalOwner(row.signal_key, { owner_id: owner, expected_generation: page.generation, expected_revision: current.revision });
      }
      setNotice({ tone: "success", text: "Ответственный назначен." });
      await onChanged();
    } catch { setNotice({ tone: "danger", text: "Назначение не сохранено. Обновите страницу и повторите." }); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-2">
    <Select aria-label="Ответственный за состояние" value={owner} disabled={busy || !people.value} onChange={e => setOwner(e.target.value)}>
      <option value="">Выберите ответственного</option>
      {(people.value ?? []).map(p => <option key={p.userName} value={p.userName}>{p.displayName || "Сотрудник без имени"}</option>)}
    </Select>
    <Button size="sm" variant="secondary" disabled={busy || !owner} onClick={() => void assign()}>Назначить ответственным</Button>
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
  </div>;
}

/** Сколько значимых записей набирать за одно чтение и сколько страниц журнала читать ради этого. */
const JOURNAL_WANTED = 50;
const JOURNAL_PAGES = 10;

/** Журнал действий словами: поиск и фильтр по человеку и проекту; строка раскрывается на месте.
 * Технические записи сервера (чтения, продление входа, работа хранилища и индекса) по умолчанию скрыты. */
function Journal({ data }: { data: MemoryData }) {
  const ui = useUi();
  const [events, setEvents] = useState<OperationAuditEvent[]>([]);
  // Номер записи, до которой журнал уже прочитан (сам номер не включён); 0 — прочитан до начала.
  const [oldest, setOldest] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [technical, setTechnical] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  // Читаем страницы назад, пока не наберётся достаточно значимых записей: у сервера
  // технических записей бывает в десятки раз больше, чем дел людей.
  const load = useCallback(async (before: number, fresh: boolean) => {
    setLoading(true); setError("");
    try {
      let end = before < 0 ? (await ui.readOperationAudit(0)).checkpoint.sequence : before;
      const found: OperationAuditEvent[] = [];
      for (let page = 0; page < JOURNAL_PAGES && end > 0 && found.filter(isMeaningful).length < JOURNAL_WANTED; page++) {
        const start = Math.max(0, end - JOURNAL_EVENTS);
        const out = await ui.readOperationAudit(start);
        found.push(...out.events.filter(e => !(Number(e.id) > end)).reverse());
        end = start;
      }
      if (!alive.current) return;
      setEvents(prev => fresh ? found : [...prev, ...found]);
      setOldest(end);
    } catch {
      if (alive.current) setError("Журнал не прочитан. Для просмотра нужны права администратора.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [ui]);
  useEffect(() => { void load(-1, true); }, [load]);
  const people = useLoad(async () => new Map((await ui.listPeople()).users.map(p => [p.userName, p.displayName] as const)), "", [ui]);
  const units = useLoad(async () => new Map((await ui.listOrgUnits()).map(u => [u.org_unit_id, u.name] as const)), "", [ui]);
  const invitations = useLoad(async () => new Map((await ui.listInvitations()).map(i => [i.invitation_id, { name: i.display_name, email: i.email }] as const)), "", [ui]);
  const agents = useMemo(() => agentNames(data.connections), [data.connections]);
  const names = useMemo<JournalNames>(() => ({
    actor: id => agents.get(id) || people.value?.get(id) || (id && !looksLikeId(id) ? id : ""),
    project: id => data.projects.find(p => p.id === id)?.name ?? "",
    document: (project, node) => {
      const found = data.projects.find(p => p.id === project);
      const shared = found?.nodes.find(n => n.node_id === node);
      if (shared) return { name: shared.name || UNNAMED_DOCUMENT, dir: shared.is_dir };
      const own = found?.privateDocs.get(node);
      return own ? { name: own.name || UNNAMED_DOCUMENT, dir: false } : null;
    },
    unit: id => units.value?.get(id) ?? "",
    invitation: id => invitations.value?.get(id) ?? null,
  }), [agents, people.value, units.value, invitations.value, data.projects]);
  const who = (id: string) => names.actor(id) || "коллега";
  const [query, setQuery] = useState("");
  const [actor, setActor] = useState("");
  const [project, setProject] = useState("");
  const [opened, setOpened] = useState("");
  const lines = events.map(e => ({ e, line: describeEvent(e, names) }));
  const visible = lines.filter(({ line }) => technical || !line.technical);
  const actors = [...new Set(visible.map(({ e }) => e.actor))];
  const shown = visible.filter(({ e, line }) => (!actor || e.actor === actor || e.on_behalf_of === actor) && (!project || line.projectId === project)
    && (!query.trim() || line.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const hidden = lines.length - visible.length;
  return <Block title="Журнал действий" actions={<Button variant="ghost" size="sm" disabled={loading} onClick={() => void load(-1, true)}>Обновить журнал</Button>}>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <TextInput type="search" aria-label="Поиск по журналу" placeholder="Найти: человек, действие, проект" value={query} onChange={e => setQuery(e.target.value)} className="min-w-[220px] flex-1" />
      <Select aria-label="Кто" value={actor} onChange={e => setActor(e.target.value)}><option value="">Все люди и агенты</option>{actors.map(a => <option key={a} value={a}>{who(a)}</option>)}</Select>
      <Select aria-label="Проект журнала" value={project} onChange={e => setProject(e.target.value)}><option value="">Все проекты</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
    </div>
    {loading && !events.length && <Notice>Загрузка…</Notice>}
    {error && <Notice tone="danger">{error}</Notice>}
    {!loading && !error && shown.length === 0 && <Notice>{visible.length ? "Под выбранные условия ничего не подходит." : "Действий людей и агентов пока не было."}</Notice>}
    {shown.length > 0 && <RowList>{shown.map(({ e, line }) => {
      const inProject = line.projectId ? data.projects.find(p => p.id === line.projectId) : undefined;
      const state = e.reason === "requested" ? { tone: "neutral" as const, label: "Начато" } : e.allowed ? { tone: "success" as const, label: "Выполнено" } : { tone: "danger" as const, label: "Не выполнено" };
      return <div key={e.id} data-journal-event="" data-technical={line.technical ? "" : undefined} className="border-t border-kumo-line first:border-t-0">
        <button type="button" aria-expanded={opened === e.id} onClick={() => setOpened(opened === e.id ? "" : e.id)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-kumo-tint">
          <RowText title={line.text} note={relativeTime(e.at)} />
          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
        </button>
        {opened === e.id && <div className="px-3 pb-3 text-[13px]">
          <p className="m-0">{who(e.actor)}{e.on_behalf_of && e.on_behalf_of !== e.actor ? ` по поручению: ${who(e.on_behalf_of)}` : ""} · {new Date(e.at).toLocaleString("ru-RU")}{inProject ? ` · проект «${inProject.name}»` : ""}</p>
          <p className="m-0 text-kumo-subtle">{e.reason === "requested" ? "Действие начато; результат — отдельной записью." : e.allowed ? "Действие выполнено." : "Действие не выполнено: отказ или ошибка."}</p>
          <AdminDetails show items={[["Операция", e.action], ["Объект", e.resource], ["Запись", e.id]]} />
        </div>}
      </div>;
    })}</RowList>}
    {oldest > 0 && <div className="mt-2"><Button variant="ghost" size="sm" disabled={loading} onClick={() => void load(oldest, false)}>{loading ? "Загрузка…" : "Показать более ранние"}</Button></div>}
    <details aria-label="Настройки журнала" className="mt-3 text-[13px]">
      <summary className="cursor-pointer text-kumo-subtle">Настройки журнала</summary>
      <label className="mt-2 flex items-center gap-2">
        <input type="checkbox" aria-label="Показывать служебные" checked={technical} onChange={e => setTechnical(e.target.checked)} />
        Показывать служебные записи{hidden ? ` (скрыто: ${hidden})` : ""}
      </label>
      <p className="mt-1 mb-0 text-kumo-subtle">Служебные записи — это технические шаги системы: чтения, продление входа, работа хранилища и поиска.</p>
    </details>
  </Block>;
}

function isMeaningful(e: OperationAuditEvent): boolean {
  return MEANINGFUL_ACTIONS.includes(e.action) && e.reason !== "requested";
}
