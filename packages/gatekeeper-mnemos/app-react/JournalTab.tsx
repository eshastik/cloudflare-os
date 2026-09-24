import { useMemo, useState } from "react";
import { Button } from "@cloudflare/kumo";
import type { OperationAuditEvent } from "../src/operation-audit.ts";
import type { PlatformSignal, PlatformSignalOwnerPage } from "../src/mnemos-api.ts";
import { useUi } from "./host.ts";
import { agentNames, personName, useLoad, type MemoryData } from "./data.ts";
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

/** Действие журнала словами; неизвестное называется честно служебным. */
export function actionWords(action: string): string {
  const a = action.toLowerCase();
  const words: [RegExp, string][] = [
    [/login|session|auth/, "вход"], [/invit/, "приглашение"], [/publish/, "публикация"], [/review|decision|approv/, "решение по согласованию"],
    [/revoke/, "отзыв доступа"], [/grant|right|permission|member/, "изменение доступа"], [/delete|remove/, "удаление"],
    [/create|register/, "создание"], [/upload|inbox|intake/, "загрузка материалов"], [/write|save|update|draft|put/, "изменение"],
    [/search/, "поиск"], [/read|get|list|browse|download/, "чтение"],
  ];
  return words.find(([re]) => re.test(a))?.[1] ?? "служебное действие";
}

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

/** Журнал действий словами: поиск и фильтр по человеку и проекту; строка раскрывается на месте. */
function Journal({ data }: { data: MemoryData }) {
  const ui = useUi();
  const events = useLoad(async (): Promise<OperationAuditEvent[]> => {
    const head = await ui.readOperationAudit(0);
    const page = await ui.readOperationAudit(Math.max(0, head.checkpoint.sequence - JOURNAL_EVENTS));
    return [...page.events].reverse();
  }, "Журнал не прочитан. Для просмотра нужны права администратора.", [ui]);
  const people = useLoad(async () => new Map((await ui.listPeople()).users.map(p => [p.userName, p.displayName] as const)), "", [ui]);
  const agents = useMemo(() => agentNames(data.connections), [data.connections]);
  const who = (id: string) => agents.get(id) ?? personName(id, people.value ?? undefined);
  const [query, setQuery] = useState("");
  const [actor, setActor] = useState("");
  const [project, setProject] = useState("");
  const [opened, setOpened] = useState("");
  const all = events.value ?? [];
  const actors = [...new Set(all.map(e => e.actor))];
  const projectOf = (e: OperationAuditEvent) => data.projects.find(p => e.resource.includes(p.id) || e.subject.includes(p.id));
  const shown = all.filter(e => (!actor || e.actor === actor || e.on_behalf_of === actor) && (!project || projectOf(e)?.id === project)
    && (!query.trim() || `${who(e.actor)} ${actionWords(e.action)} ${projectOf(e)?.name ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  return <Block title="Журнал действий" actions={<Button variant="ghost" size="sm" disabled={events.loading} onClick={() => void events.reload()}>Обновить журнал</Button>}>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <TextInput type="search" aria-label="Поиск по журналу" placeholder="Найти: человек, действие, проект" value={query} onChange={e => setQuery(e.target.value)} className="min-w-[220px] flex-1" />
      <Select aria-label="Кто" value={actor} onChange={e => setActor(e.target.value)}><option value="">Все люди и агенты</option>{actors.map(a => <option key={a} value={a}>{who(a)}</option>)}</Select>
      <Select aria-label="Проект журнала" value={project} onChange={e => setProject(e.target.value)}><option value="">Все проекты</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
    </div>
    {events.loading && !events.value && <Notice>Загрузка…</Notice>}
    {events.error && <Notice tone="danger">{events.error}</Notice>}
    {events.value && shown.length === 0 && <Notice>{all.length ? "Под выбранные условия ничего не подходит." : "Действий пока не было."}</Notice>}
    {shown.length > 0 && <RowList>{shown.map(e => {
      const inProject = projectOf(e);
      return <div key={e.id} data-journal-event="" className="border-t border-kumo-line first:border-t-0">
        <button type="button" aria-expanded={opened === e.id} onClick={() => setOpened(opened === e.id ? "" : e.id)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-kumo-tint">
          <RowText title={`${who(e.actor)}: ${actionWords(e.action)}`} note={[inProject ? `проект «${inProject.name}»` : "", relativeTime(e.at)].filter(Boolean).join(" · ")} />
          <StatusBadge tone={e.reason === "requested" ? "neutral" : e.allowed ? "success" : "danger"}>{e.reason === "requested" ? "Начато" : e.allowed ? "Выполнено" : "Отказано"}</StatusBadge>
        </button>
        {opened === e.id && <div className="px-3 pb-3 text-[13px]">
          <p className="m-0">{who(e.actor)}{e.on_behalf_of ? ` по поручению: ${who(e.on_behalf_of)}` : ""} · {new Date(e.at).toLocaleString("ru-RU")}</p>
          <p className="m-0 text-kumo-subtle">{e.reason === "requested" ? "Действие начато; результат — отдельной записью." : e.allowed ? "Действие разрешено и выполнено." : "В действии отказано."}</p>
          <AdminDetails show items={[["Действие", e.action], ["Объект", e.resource], ["Запись", e.id]]} />
        </div>}
      </div>;
    })}</RowList>}
  </Block>;
}
