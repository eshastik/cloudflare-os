import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@cloudflare/kumo";
import type { OperationAuditEvent } from "../src/operation-audit.ts";
import type { PlatformSignal, PlatformSignalOwnerPage, WorkJournalEntry } from "../src/mnemos-api.ts";
import { useUi } from "./host.ts";
import { agentNames, looksLikeId, UNNAMED_DOCUMENT, useLoad, type MemoryData } from "./data.ts";
import { MEANINGFUL_ACTIONS, mergeJournal, unitNamesFrom, type JournalNames } from "./journal-words.ts";
import { AdminDetails, Block, Notice, Row, RowList, RowText, Select, StatusBadge, TextInput } from "./ui.tsx";
import { relativeTime } from "./time.ts";

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

/** Журнал операций читается страницами по 1000 записей (предел сервера) назад от вершины.
 * На установке его забивают технические записи — каждый запрос интерфейса оставляет
 * «request.admit», — поэтому страниц за одно чтение много, а служебных в памяти
 * держится не больше TECHNICAL_KEEP. */
const AUDIT_PAGE = 1000;
const AUDIT_PAGES = 10;
const JOURNAL_WANTED = 50;
const TECHNICAL_KEEP = 300;
const MEANINGFUL = new Set(MEANINGFUL_ACTIONS);

interface AuditSource {
  events: OperationAuditEvent[];
  /** Номер записи, до которой журнал прочитан (сам номер не включён); 0 — прочитан до начала, -1 — не читался. */
  end: number;
  /** Время самой старой прочитанной записи, в том числе служебной. */
  oldestAt: string;
  /** Сколько служебных записей прочитано и сколько из них не сохранено. */
  technical: number;
  dropped: number;
  failed: boolean;
}
interface WorkSource { entries: WorkJournalEntry[]; cursor: string; failed: boolean }
const NO_AUDIT: AuditSource = { events: [], end: -1, oldestAt: "", technical: 0, dropped: 0, failed: false };

function isMeaningful(e: OperationAuditEvent): boolean {
  return MEANINGFUL.has(e.action) && e.reason !== "requested";
}

/** Журнал действий словами: журнал операций организации и журналы работ доступных проектов
 * одной лентой. Поиск и фильтр по человеку и проекту; строка раскрывается на месте.
 * Технические записи сервера (чтения, продление входа, работа хранилища и индекса) по умолчанию скрыты. */
function Journal({ data }: { data: MemoryData }) {
  const ui = useUi();
  const [audit, setAudit] = useState<AuditSource>(NO_AUDIT);
  const [work, setWork] = useState<Map<string, WorkSource>>(new Map());
  const [loading, setLoading] = useState(0);
  const [technical, setTechnical] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  // Номер чтения: ответ устаревшего чтения (после «Обновить») отбрасывается.
  const auditRun = useRef(0);
  const workRun = useRef(0);
  const busy = async (job: () => Promise<void>) => { setLoading(n => n + 1); try { await job(); } finally { if (alive.current) setLoading(n => n - 1); } };

  // Читаем страницы назад, пока не наберётся достаточно значимых записей.
  const loadAudit = useCallback((from: AuditSource | null) => busy(async () => {
    const run = from ? auditRun.current : ++auditRun.current;
    try {
      let end = from ? from.end : (await ui.readOperationAuditPage(0, 1)).checkpoint.sequence;
      const meaningful: OperationAuditEvent[] = [];
      const kept: OperationAuditEvent[] = [];
      let technicalSeen = 0, oldestAt = from?.oldestAt ?? "";
      const keptBefore = from ? from.events.filter(e => !isMeaningful(e)).length : 0;
      for (let page = 0; page < AUDIT_PAGES && end > 0 && meaningful.length < JOURNAL_WANTED; page++) {
        const start = Math.max(0, end - AUDIT_PAGE);
        const out = await ui.readOperationAuditPage(start, end - start);
        for (const e of out.events.filter(e => !(Number(e.id) > end)).reverse()) {
          oldestAt = e.at;
          if (isMeaningful(e)) meaningful.push(e);
          else { technicalSeen++; if (keptBefore + kept.length < TECHNICAL_KEEP) kept.push(e); }
        }
        end = start;
      }
      if (!alive.current || run !== auditRun.current) return;
      const events = [...meaningful, ...kept].sort((a, b) => Number(b.id) - Number(a.id));
      setAudit(prev => {
        const base = from ? prev : NO_AUDIT;
        return { events: [...base.events, ...events], end, oldestAt, technical: base.technical + technicalSeen, dropped: base.dropped + technicalSeen - kept.length, failed: false };
      });
    } catch {
      if (alive.current && run === auditRun.current) setAudit(prev => ({ ...(from ? prev : NO_AUDIT), failed: true, end: 0 }));
    }
  }), [ui]);

  // Журналы работ: по странице с каждого проекта; «ещё» — только у проектов, где записи остались.
  const loadWork = useCallback((projects: string[], from: Map<string, WorkSource> | null) => busy(async () => {
    const run = from ? workRun.current : ++workRun.current;
    const wanted = from ? projects.filter(p => from.get(p)?.cursor) : projects;
    const results = await Promise.allSettled(wanted.map(p => ui.listWorkJournal(p, from?.get(p)?.cursor ?? "")));
    if (!alive.current || run !== workRun.current) return;
    setWork(prev => {
      const next = new Map(from ? prev : []);
      wanted.forEach((p, i) => {
        const got = results[i];
        const before = next.get(p);
        next.set(p, got.status === "fulfilled"
          ? { entries: [...(before?.entries ?? []), ...got.value.entries], cursor: got.value.next_cursor ?? "", failed: false }
          : { entries: before?.entries ?? [], cursor: "", failed: true });
      });
      return next;
    });
  }), [ui]);

  const projectIds = data.projects.map(p => p.id);
  const projectKey = projectIds.join("\n");
  useEffect(() => { void loadAudit(null); }, [loadAudit]);
  // Список проектов сравнивается по ключу: подгрузка документов проектов его не меняет.
  useEffect(() => { void loadWork(projectIds, null); }, [loadWork, projectKey]);

  const people = useLoad(async () => new Map((await ui.listPeople()).users.map(p => [p.userName, p.displayName] as const)), "", [ui]);
  const units = useLoad(async () => new Map((await ui.listOrgUnits()).map(u => [u.org_unit_id, u.name] as const)), "", [ui]);
  const invitations = useLoad(async () => new Map((await ui.listInvitations()).map(i => [i.invitation_id, { name: i.display_name, email: i.email }] as const)), "", [ui]);
  const agents = useMemo(() => agentNames(data.connections), [data.connections]);
  const deletedUnits = useMemo(() => unitNamesFrom(audit.events), [audit.events]);
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
    unit: id => units.value?.get(id) || deletedUnits.get(id) || "",
    invitation: id => invitations.value?.get(id) ?? null,
  }), [agents, people.value, units.value, invitations.value, deletedUnits, data.projects]);
  const who = (id: string) => names.actor(id) || "коллега";
  const [query, setQuery] = useState("");
  const [actor, setActor] = useState("");
  const [project, setProject] = useState("");
  const [opened, setOpened] = useState("");

  const sources = [...work.entries()];
  const items = useMemo(() => mergeJournal(audit.events, [...work.values()].flatMap(w => w.entries), names), [audit.events, work, names]);
  // Граница слияния: ниже самой поздней из «нижних точек» источников, у которых есть ещё записи,
  // лента не показывается — туда могут встать записи, которые ещё не прочитаны.
  const bounds = [audit.end > 0 ? audit.oldestAt : "", ...sources.filter(([, w]) => w.cursor).map(([, w]) => w.entries.at(-1)?.recorded_at ?? "")].filter(Boolean).map(at => Date.parse(at));
  const horizon = bounds.length ? Math.max(...bounds) : -Infinity;
  const loaded = items.filter(item => !(Date.parse(item.at) < horizon));
  const visible = loaded.filter(({ line }) => technical || !line.technical);
  const actors = [...new Set(visible.flatMap(item => item.people))];
  const shown = visible.filter(({ people: involved, line }) => (!actor || involved.includes(actor)) && (!project || line.projectId === project)
    && (!query.trim() || line.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const hidden = audit.technical;
  const more = audit.end > 0 || sources.some(([, w]) => w.cursor);
  const started = audit.end !== -1 || audit.failed;
  const deniedProjects = sources.filter(([, w]) => w.failed).map(([id]) => names.project(id) || "без названия");
  const allFailed = audit.failed && sources.every(([, w]) => w.failed);
  const refresh = () => { void loadAudit(null); void loadWork(projectIds, null); };
  const earlier = () => { if (audit.end > 0) void loadAudit(audit); void loadWork(projectIds, work); };
  return <Block title="Журнал действий" actions={<Button variant="ghost" size="sm" disabled={loading > 0} onClick={refresh}>Обновить журнал</Button>}>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <TextInput type="search" aria-label="Поиск по журналу" placeholder="Найти: человек, действие, проект" value={query} onChange={e => setQuery(e.target.value)} className="min-w-[220px] flex-1" />
      <Select aria-label="Кто" value={actor} onChange={e => setActor(e.target.value)}><option value="">Все люди и агенты</option>{actors.map(a => <option key={a} value={a}>{who(a)}</option>)}</Select>
      <Select aria-label="Проект журнала" value={project} onChange={e => setProject(e.target.value)}><option value="">Все проекты</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
    </div>
    {loading > 0 && !items.length && <Notice>Загрузка…</Notice>}
    {allFailed && <Notice tone="danger">Журнал не прочитан. Для просмотра нужны права администратора.</Notice>}
    {!loading && started && !allFailed && shown.length === 0 && <Notice>{visible.length ? "Под выбранные условия ничего не подходит." : "Действий людей и агентов пока не было."}</Notice>}
    {shown.length > 0 && <RowList>{shown.map(item => {
      const { line } = item;
      const inProject = line.projectId ? data.projects.find(p => p.id === line.projectId) : undefined;
      const e = item.audit[0];
      const w = item.work;
      const state = w ? (w.outcome === "accepted" ? { tone: "success" as const, label: "Выполнено" } : w.outcome === "awaiting_approval" ? { tone: "neutral" as const, label: "Ждёт одобрения" } : { tone: "neutral" as const, label: "Возвращено" })
        : e.reason === "requested" ? { tone: "neutral" as const, label: "Начато" } : e.allowed ? { tone: "success" as const, label: "Выполнено" } : { tone: "danger" as const, label: "Не выполнено" };
      const author = w ? w.actor : e.actor;
      const behalf = w ? w.on_behalf_of ?? "" : e.on_behalf_of;
      return <div key={item.key} data-journal-event="" data-journal-source={w ? (item.audit.length ? "work+audit" : "work") : "audit"} data-technical={line.technical ? "" : undefined} className="border-t border-kumo-line first:border-t-0">
        <button type="button" aria-expanded={opened === item.key} onClick={() => setOpened(opened === item.key ? "" : item.key)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-kumo-tint">
          <RowText title={line.text} note={relativeTime(item.at)} />
          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
        </button>
        {opened === item.key && <div className="px-3 pb-3 text-[13px]">
          <p className="m-0">{who(author)}{behalf && behalf !== author ? ` по поручению: ${who(behalf)}` : ""} · {new Date(item.at).toLocaleString("ru-RU")}{inProject ? ` · проект «${inProject.name}»` : ""}</p>
          {w ? <>
            {w.purpose && <p className="m-0">Зачем: {w.purpose}</p>}
            {w.summary.trim().includes("\n") && <p className="m-0 whitespace-pre-line">{w.summary.trim()}</p>}
            <p className="m-0 text-kumo-subtle">{w.outcome === "accepted" ? "Работа принята." : w.outcome === "awaiting_approval" ? "Работа ждёт одобрения." : "Работа возвращена."}{w.changed.length ? ` Затронуто файлов: ${w.changed.length}.` : ""}</p>
          </> : <p className="m-0 text-kumo-subtle">{e.reason === "requested" ? "Действие начато; результат — отдельной записью." : e.allowed ? "Действие выполнено." : "Действие не выполнено: отказ или ошибка."}</p>}
          <AdminDetails show items={[
            ...(w ? [["Журнал работ", `${w.source} · запись ${w.entry_id}${w.result.reference ? ` · ${w.result.reference}` : ""}`] as [string, string]] : []),
            ...item.audit.map(a => [`Операция ${a.id}`, `${a.action} · ${a.resource}`] as [string, string]),
          ]} />
        </div>}
      </div>;
    })}</RowList>}
    {more && <div className="mt-2"><Button variant="ghost" size="sm" disabled={loading > 0} onClick={earlier}>{loading > 0 ? "Загрузка…" : "Показать более ранние"}</Button></div>}
    {!allFailed && (audit.failed || deniedProjects.length > 0) && <p data-journal-unavailable="" className="mt-2 mb-0 text-[12px] text-kumo-subtle">
      Показано не всё.{audit.failed ? " Журнал операций организации не прочитан: нужны права администратора." : ""}{deniedProjects.length ? ` Нет доступа к журналу работ ${deniedProjects.length === 1 ? "проекта" : "проектов"}: ${deniedProjects.map(n => `«${n}»`).join(", ")}.` : ""}
    </p>}
    <details aria-label="Настройки журнала" className="mt-3 text-[13px]">
      <summary className="cursor-pointer text-kumo-subtle">Настройки журнала</summary>
      <label className="mt-2 flex items-center gap-2">
        <input type="checkbox" aria-label="Показывать служебные" checked={technical} onChange={e => setTechnical(e.target.checked)} />
        Показывать служебные записи{hidden ? ` (скрыто: ${hidden})` : ""}
      </label>
      <p className="mt-1 mb-0 text-kumo-subtle">Служебные записи — это технические шаги системы: чтения, продление входа, работа хранилища и поиска.{audit.dropped ? ` Их много, поэтому показаны только последние ${TECHNICAL_KEEP}.` : ""}</p>
    </details>
  </Block>;
}
