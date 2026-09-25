import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OperationAuditEvent } from "../src/operation-audit.ts";
import type { PlatformSignal, PlatformSignalOwnerPage, WorkJournalEntry } from "../src/mnemos-api.ts";
import { useUi } from "./host.ts";
import { agentNames, looksLikeId, UNNAMED_DOCUMENT, useLoad, type MemoryData } from "./data.ts";
import { MEANINGFUL_ACTIONS, mergeJournal, unitNamesFrom, type JournalNames } from "./journal-words.ts";
import { Notice, StatusBadge } from "./ui.tsx";
import { Card, Pill, PillInput, PillSelect } from "./admin-ui.tsx";
import { relativeTime } from "./time.ts";

/** Подсистемы состояния: название и сигналы, из которых складывается строка.
 * optional — строка есть, только если сервер прислал её сигнал (старый сервер его не отдаёт). */
type Subsystem = { title: string; keys: PlatformSignal["key"][]; ok: string; problem: string | ((own: PlatformSignal[]) => string); optional?: boolean };
const SUBSYSTEMS: Subsystem[] = [
  { title: "Сайт и вход", keys: ["external.readiness", "external.login"], ok: "Сайт открывается, сотрудники входят.", problem: "Сайт или вход работают с перебоями. Проверьте, открывается ли сайт; если нет — сообщите ответственному." },
  { title: "Хранилище", keys: ["dependencies"], ok: "База данных и хранилище файлов отвечают.", problem: "Хранилище отвечает с ошибками: материалы могут не сохраняться. Сообщите ответственному." },
  { title: "Чтение материалов", keys: ["external.read"], ok: "Материалы открываются.", problem: "Материалы открываются не всегда. Повторите позже; если не пройдёт — сообщите ответственному." },
  { title: "Сохранение материалов", keys: ["external.save"], ok: "Изменения сохраняются.", problem: "Изменения сохраняются не всегда. Не удаляйте локальные копии, пока не наладится." },
  { title: "Индексация новых файлов", keys: ["shared_projection"], optional: true, ok: "Новые файлы попадают в поиск.", problem: own => {
    const n = own.find(sig => sig.state === "firing")?.count ?? 0;
    return `Индексация новых файлов застряла: ${n ? `${n} ${tasksWord(n)}` : "есть задания"} дольше 10 минут — поиск их пока не находит.`;
  } },
];
/** «задание», «задания», «заданий» — по числу. */
function tasksWord(n: number): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "задание";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "задания";
  return "заданий";
}
const KNOWN_KEYS = new Set(SUBSYSTEMS.flatMap(s => s.keys));
type Health = "ok" | "problem" | "unknown";
const DOT: Record<Health, string> = { ok: "bg-kumo-success", problem: "bg-kumo-danger", unknown: "bg-kumo-fill" };

/** Проверки и их итог словами — для раскрытия «Подробнее для администратора». */
const SIGNAL_TITLES: Record<string, string> = { "external.readiness": "Сайт открывается", "external.login": "Вход сотрудников", dependencies: "База данных и хранилище файлов", "external.read": "Чтение материалов", "external.save": "Сохранение материалов", shared_projection: "Индексация новых файлов" };
const SIGNAL_STATES: Record<string, string> = { ok: "в порядке", firing: "есть сбой", unknown: "нет свежих данных" };
const SIGNAL_REASONS: Record<string, string> = { check_passed: "проверка прошла", check_failed: "проверка не прошла", observations_stale: "проверка давно не приходила", jobs_stalled: "задания индексации не завершаются" };

/** Страница обновляется сама: раз в `every` мс, пока вкладка видна, и сразу при возврате на вкладку. */
function useLiveRefresh(refresh: () => void, every: number) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const timer = setInterval(() => { if (visible()) latest.current(); }, every);
    const back = () => { if (visible()) latest.current(); };
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", back); };
  }, [every]);
}

/** Учётная запись внешней проверки установки (deploy/sophai/monitor.py): её вход,
 * чтение и сохранение раз в две минуты — служебные записи, а не дела людей. */
const SYNTHETIC_MONITOR = "synthetic-monitor";

/** «Журнал и состояние»: одна страница — строка состояния и журнал действий словами. */
export default function JournalTab({ data }: { data: MemoryData }) {
  const capabilities = data.identity?.capabilities ?? [];
  const admin = capabilities.includes("principal.manage");
  return <div className="grid max-w-[820px] gap-6">
    {capabilities.includes("platform.metrics.read") && <SystemState admin={admin} />}
    {admin && <Journal data={data} />}
  </div>;
}

/** Состояние системы одной карточкой: «Всё работает» или какие части с перебоями и что делать; числа — строкой ниже;
 * подробности проверок раскрываются на месте под «Подробнее для администратора». */
function SystemState({ admin }: { admin: boolean }) {
  const ui = useUi();
  const metrics = useLoad(() => ui.readPlatformMetrics(), "Состояние системы не прочитано. Повторим через минуту.", [ui]);
  useLiveRefresh(() => { void metrics.reload(); }, 60_000);
  const usage = metrics.value;
  const signals = usage?.signals ?? [];
  // Сигнал, которого интерфейс не знает (новая проверка сервера), — общей строкой с ключом, а не отказом страницы.
  const unknown: Subsystem[] = signals.filter(sig => !KNOWN_KEYS.has(sig.key)).map(sig => ({ title: `Проверка «${sig.key}»`, keys: [sig.key], ok: "Проверка прошла.", problem: "Проверка сообщает о сбое. Сообщите ответственному." }));
  const rows = [...SUBSYSTEMS, ...unknown].map(sub => {
    const own = signals.filter(sig => sub.keys.includes(sig.key));
    const health: Health = own.some(sig => sig.state === "firing") ? "problem" : own.length && own.every(sig => sig.state === "ok") ? "ok" : "unknown";
    return { ...sub, own, health, problem: typeof sub.problem === "function" ? sub.problem(own) : sub.problem };
  }).filter(r => !r.optional || r.own.length);
  const owners = [...new Set((usage?.signal_owners ?? []).filter(o => o.owner_id).map(o => o.owner_name || "сотрудник"))];
  const problems = rows.filter(r => r.health === "problem").length;
  const allOk = rows.every(r => r.health === "ok");
  const overall: Health = problems ? "problem" : allOk ? "ok" : "unknown";
  return <section aria-label="Состояние системы">
    {metrics.loading && !usage && <Notice>Загрузка…</Notice>}
    {metrics.error && <Notice tone="danger">{metrics.error}</Notice>}
    {usage && <Card data-system-state="">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${DOT[overall]}`} />
        <span className="flex-1 text-[15px] text-kumo-default">{problems ? `Есть проблемы: ${problems} из ${rows.length}.` : allOk ? "Всё работает." : "Часть проверок давно не приходила."}</span>
        <span className="text-[13px] text-kumo-subtle">{allOk ? rows.map(r => r.title.toLocaleLowerCase("ru-RU")).join(", ").replace(/^./, c => c.toLocaleUpperCase("ru-RU")) : `Проверено ${relativeTime(usage.readiness?.checked_at || usage.recorded_at) || "недавно"}`}</span>
      </div>
      {!allOk && <div className="grid gap-2 border-t border-kumo-fill px-5 py-3">{rows.map(r => <div key={r.title} data-subsystem={r.health} className="flex items-start gap-3 text-[13px]">
        <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[r.health]}`} />
        <span><span className="font-medium text-kumo-default">{r.title}.</span> <span className="text-kumo-subtle">{r.health === "ok" ? r.ok : r.health === "problem" ? r.problem : "Нет свежих данных проверки."}</span></span>
      </div>)}</div>}
      <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-kumo-fill px-5 py-3">
        {([["Сотрудников вошло за сутки", usage.authenticated_users_24h], ["Входов за сутки", usage.human_logins_24h], ["Опубликовано материалов", usage.shared_publications]] as const).map(([label, value]) =>
          <span key={label} className="text-[13px] text-kumo-subtle"><span className="mr-1 text-[15px] font-semibold text-kumo-default">{value}</span>{label}</span>)}
        <span className="text-[13px] text-kumo-subtle">{owners.length ? `Ответственный: ${owners.join(", ")}.` : "Ответственный не назначен."}</span>
      </div>
      {admin && <details aria-label="Подробнее для администратора" className="border-t border-kumo-fill px-5 py-3 text-[13px]">
        <summary className="cursor-pointer text-kumo-subtle">Подробнее для администратора</summary>
        <div className="mt-2 grid gap-3">
          <OwnerPicker onChanged={metrics.reload} />
          <div className="grid gap-1 text-[12px] text-kumo-subtle">
            {signals.map(sig => <p key={sig.key} className="m-0 break-words">{SIGNAL_TITLES[sig.key] ?? `Проверка «${sig.key}»`}: {SIGNAL_STATES[sig.state] ?? sig.state}{SIGNAL_REASONS[sig.reason] ? ` · ${SIGNAL_REASONS[sig.reason]}` : ""}{sig.observed_at ? ` · ${new Date(sig.observed_at).toLocaleString("ru-RU")}` : ""}</p>)}
            {!!usage.readiness?.reasons.length && <p className="m-0 break-words">Почему установка не готова: {usage.readiness.reasons.join("; ")}</p>}
            {usage.deployment && <p className="m-0 break-words">Версия установки: {usage.deployment.release}</p>}
          </div>
        </div>
      </details>}
    </Card>}
  </section>;
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
    <PillSelect aria-label="Ответственный за состояние" value={owner} disabled={busy || !people.value} onChange={e => setOwner(e.target.value)}>
      <option value="">Выберите ответственного</option>
      {(people.value ?? []).map(p => <option key={p.userName} value={p.userName}>{p.displayName || "Сотрудник без имени"}</option>)}
    </PillSelect>
    <Pill disabled={busy || !owner} onClick={() => void assign()}>Назначить ответственным</Pill>
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
  /** Вершина журнала на момент последнего чтения: новые записи дочитываются выше неё. */
  top: number;
  /** Время самой старой прочитанной записи, в том числе служебной. */
  oldestAt: string;
  /** Сколько служебных записей прочитано и сколько из них не сохранено. */
  technical: number;
  dropped: number;
  failed: boolean;
}
interface WorkSource { entries: WorkJournalEntry[]; cursor: string; failed: boolean }
const NO_AUDIT: AuditSource = { events: [], end: -1, top: -1, oldestAt: "", technical: 0, dropped: 0, failed: false };

function isMeaningful(e: OperationAuditEvent): boolean {
  return MEANINGFUL.has(e.action) && e.reason !== "requested" && e.actor !== SYNTHETIC_MONITOR && e.on_behalf_of !== SYNTHETIC_MONITOR;
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
      const top = from ? from.top : (await ui.readOperationAuditPage(0, 1)).checkpoint.sequence;
      let end = from ? from.end : top;
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
        return { events: [...base.events, ...events], end, top: from ? prev.top : top, oldestAt, technical: base.technical + technicalSeen, dropped: base.dropped + technicalSeen - kept.length, failed: false };
      });
    } catch {
      if (alive.current && run === auditRun.current) setAudit(prev => ({ ...(from ? prev : NO_AUDIT), failed: true, end: 0 }));
    }
  }), [ui]);

  // Новые записи над прочитанной вершиной: подгруженное «ранее» и раскрытая строка остаются на месте.
  // Если новых больше, чем помещается в одно чтение, журнал перечитывается целиком.
  const loadNewer = useCallback(() => busy(async () => {
    const run = auditRun.current;
    try {
      const top = (await ui.readOperationAuditPage(0, 1)).checkpoint.sequence;
      const from = auditTop.current;
      if (from < 0 || top <= from) return;
      if (top - from > AUDIT_PAGE * AUDIT_PAGES) { void loadAudit(null); return; }
      const fresh: OperationAuditEvent[] = [];
      for (let after = from; after < top;) {
        const out = await ui.readOperationAuditPage(after, Math.min(AUDIT_PAGE, top - after));
        const page = out.events.filter(e => Number(e.id) > after && !(Number(e.id) > top));
        if (!page.length) break;
        fresh.push(...page);
        after = Number(page.at(-1)!.id);
      }
      if (!alive.current || run !== auditRun.current) return;
      const meaningful = fresh.filter(isMeaningful);
      const technical = fresh.filter(e => !isMeaningful(e));
      setAudit(prev => {
        if (prev.top !== from) return prev;
        const known = new Set(prev.events.map(e => e.id));
        const added = [...meaningful, ...technical.slice(-TECHNICAL_KEEP)].filter(e => !known.has(e.id)).sort((a, b) => Number(b.id) - Number(a.id));
        return { ...prev, events: [...added, ...prev.events], top, technical: prev.technical + technical.length, dropped: prev.dropped + Math.max(0, technical.length - TECHNICAL_KEEP) };
      });
    } catch { /* следующий опрос повторит */ }
  }), [ui, loadAudit]);
  const auditTop = useRef(-1);
  auditTop.current = audit.top;

  // Первая страница журналов работ заново: новые записи встают сверху, догруженные ранее остаются.
  const loadNewerWork = useCallback((projects: string[]) => busy(async () => {
    const run = workRun.current;
    const results = await Promise.allSettled(projects.map(p => ui.listWorkJournal(p, "")));
    if (!alive.current || run !== workRun.current) return;
    setWork(prev => {
      const next = new Map(prev);
      projects.forEach((p, i) => {
        const got = results[i];
        if (got.status !== "fulfilled") return;
        const before = next.get(p);
        if (!before) { next.set(p, { entries: got.value.entries, cursor: got.value.next_cursor ?? "", failed: false }); return; }
        const known = new Set(before.entries.map(e => e.entry_id));
        const added = got.value.entries.filter(e => !known.has(e.entry_id));
        if (added.length || before.failed) next.set(p, { ...before, entries: [...added, ...before.entries], failed: false });
      });
      return next;
    });
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
  const items = useMemo(() => mergeJournal(audit.events, [...work.values()].flatMap(w => w.entries), names)
    .map(item => item.people.includes(SYNTHETIC_MONITOR) ? { ...item, line: { ...item.line, technical: true } } : item), [audit.events, work, names]);
  // Граница слияния: ниже самой поздней из «нижних точек» источников, у которых есть ещё записи,
  // лента не показывается — туда могут встать записи, которые ещё не прочитаны.
  const bounds = [audit.end > 0 ? audit.oldestAt : "", ...sources.filter(([, w]) => w.cursor).map(([, w]) => w.entries.at(-1)?.recorded_at ?? "")].filter(Boolean).map(at => Date.parse(at));
  const horizon = bounds.length ? Math.max(...bounds) : -Infinity;
  const loaded = items.filter(item => !(Date.parse(item.at) < horizon));
  const visible = loaded.filter(({ line }) => technical || !line.technical);
  const actors = [...new Set(visible.flatMap(item => item.people))];
  // Чипы проектов — только тех, где в прочитанной ленте что-то было; выбранный держится, даже если записей не осталось.
  const projectsInFeed = data.projects.filter(p => p.id === project || visible.some(item => item.line.projectId === p.id));
  const shown = visible.filter(({ people: involved, line }) => (!actor || involved.includes(actor)) && (!project || line.projectId === project)
    && (!query.trim() || line.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const hidden = audit.technical;
  const more = audit.end > 0 || sources.some(([, w]) => w.cursor);
  const started = audit.end !== -1 || audit.failed;
  const deniedProjects = sources.filter(([, w]) => w.failed).map(([id]) => names.project(id) || "без названия");
  const allFailed = audit.failed && sources.every(([, w]) => w.failed);
  useLiveRefresh(() => { if (!loading) { void loadNewer(); void loadNewerWork(projectIds); } }, 30_000);
  const earlier = () => { if (audit.end > 0) void loadAudit(audit); void loadWork(projectIds, work); };
  const groups: { day: string; items: typeof shown }[] = [];
  for (const item of shown) { const day = dayLabel(item.at); const last = groups.at(-1); if (last?.day === day) last.items.push(item); else groups.push({ day, items: [item] }); }
  return <section aria-label="Журнал действий" className="grid gap-3">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="m-0 flex-1 text-[17px] font-semibold text-kumo-default">Что происходило</h2>
      <PillInput type="search" aria-label="Поиск по журналу" placeholder="Кто, что, где" value={query} onChange={e => setQuery(e.target.value)} className="w-[200px]" />
    </div>
    <FilterChips label="Кто" value={actor} onChange={setActor} options={[...new Set([...(actor ? [actor] : []), ...actors])].map(a => ({ id: a, name: who(a) }))} />
    <FilterChips label="Проект журнала" value={project} onChange={setProject} options={projectsInFeed.map(p => ({ id: p.id, name: p.name }))} />
    {loading > 0 && !items.length && <Notice>Загрузка…</Notice>}
    {allFailed && <Notice tone="danger">Журнал не прочитан. Для просмотра нужны права администратора.</Notice>}
    {!loading && started && !allFailed && shown.length === 0 && <Notice>{visible.length ? "Под выбранные условия ничего не подходит." : "Действий людей и агентов пока не было."}</Notice>}
    {groups.map(group => <div key={group.day} className="grid gap-1.5">
      <div className="px-1 text-[13px] font-medium text-kumo-subtle">{group.day}</div>
      <Card>{group.items.map(item => {
        const { line } = item;
        const inProject = line.projectId ? data.projects.find(p => p.id === line.projectId) : undefined;
        const e = item.audit[0];
        const w = item.work;
        const state = w ? (w.outcome === "accepted" ? null : w.outcome === "awaiting_approval" ? { tone: "neutral" as const, label: "Ждёт одобрения" } : { tone: "neutral" as const, label: "Возвращено" })
          : e.reason === "requested" ? { tone: "neutral" as const, label: "Начато" } : e.allowed ? null : { tone: "danger" as const, label: "Не выполнено" };
        const author = w ? w.actor : e.actor;
        const behalf = w ? w.on_behalf_of ?? "" : e.on_behalf_of;
        const reference = w?.result.reference && !looksLikeId(w.result.reference) ? w.result.reference : "";
        return <div key={item.key} data-journal-event="" data-journal-source={w ? (item.audit.length ? "work+audit" : "work") : "audit"} data-technical={line.technical ? "" : undefined} className="border-t border-kumo-fill first:border-t-0">
          <button type="button" aria-expanded={opened === item.key} onClick={() => setOpened(opened === item.key ? "" : item.key)} className="flex w-full items-start gap-3.5 px-4 py-3 text-left text-[14px] hover:bg-kumo-tint">
            <span className="w-11 shrink-0 pt-px text-[13px] tabular-nums text-kumo-subtle">{clock(item.at)}</span>
            <span className={`min-w-0 flex-1 break-words ${line.technical ? "text-kumo-subtle" : "text-kumo-default"}`}>{/[.!?…]$/.test(line.text) ? line.text : `${line.text}.`}</span>
            {state && <StatusBadge tone={state.tone}>{state.label}</StatusBadge>}
          </button>
          {opened === item.key && <div className="grid gap-1 px-4 pb-3 text-[13px] sm:pl-[74px]">
            <p className="m-0">{who(author)}{behalf && behalf !== author ? ` по поручению: ${who(behalf)}` : ""} · {new Date(item.at).toLocaleString("ru-RU")}{inProject ? ` · проект «${inProject.name}»` : ""}</p>
            {w ? <>
              {w.purpose && <p className="m-0">Зачем: {w.purpose}</p>}
              {w.summary.trim().includes("\n") && <p className="m-0 whitespace-pre-line">{w.summary.trim()}</p>}
              <p className="m-0 text-kumo-subtle">{w.outcome === "accepted" ? "Работа принята." : w.outcome === "awaiting_approval" ? "Работа ждёт одобрения." : "Работа возвращена."}{w.changed.length ? ` Затронуто файлов: ${w.changed.length}.` : ""}{reference ? ` Результат: ${reference}.` : ""}</p>
            </> : <p className="m-0 text-kumo-subtle">{e.reason === "requested" ? "Действие начато; результат — отдельной записью." : e.allowed ? "Действие выполнено." : "Действие не выполнено: отказ или ошибка."}</p>}
          </div>}
        </div>;
      })}</Card>
    </div>)}
    {more && <div><Pill tone="ghost" disabled={loading > 0} onClick={earlier}>{loading > 0 ? "Загрузка…" : "Показать более ранние"}</Pill></div>}
    {!allFailed && (audit.failed || deniedProjects.length > 0) && <p data-journal-unavailable="" className="m-0 text-[12px] text-kumo-subtle">
      Показано не всё.{audit.failed ? " Журнал операций организации не прочитан: нужны права администратора." : ""}{deniedProjects.length ? ` Нет доступа к журналу работ ${deniedProjects.length === 1 ? "проекта" : "проектов"}: ${deniedProjects.map(n => `«${n}»`).join(", ")}.` : ""}
    </p>}
    <details aria-label="Настройки журнала" className="text-[13px]">
      <summary className="cursor-pointer text-kumo-subtle">Настройки журнала</summary>
      <label className="mt-2 flex items-center gap-2">
        <input type="checkbox" aria-label="Показывать служебные" checked={technical} onChange={e => setTechnical(e.target.checked)} />
        Показывать служебные записи{hidden ? ` (скрыто: ${hidden})` : ""}
      </label>
      <p className="mt-1 mb-0 text-kumo-subtle">Служебные записи — это технические шаги системы: чтения, продление входа, работа хранилища и поиска.{audit.dropped ? ` Их много, поэтому показаны только последние ${TECHNICAL_KEEP}.` : ""}</p>
    </details>
  </section>;
}

/** Фильтр строкой чипов: нажатый чип сужает ленту, повторное нажатие снимает. */
function FilterChips({ label, value, options, onChange }: { label: string; value: string; options: { id: string; name: string }[]; onChange(id: string): void }) {
  if (!options.length) return null;
  return <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
    {options.map(o => <Pill key={o.id} aria-pressed={value === o.id} tone={value === o.id ? "primary" : "secondary"} onClick={() => onChange(value === o.id ? "" : o.id)}>{o.name}</Pill>)}
  </div>;
}

/** «Сегодня», «Вчера» или дата словами — заголовок группы журнала. */
function dayLabel(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "Раньше";
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(date)) / 86_400_000);
  if (days === 0) return "Сегодня";
  if (days === 1) return "Вчера";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
}
function clock(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
