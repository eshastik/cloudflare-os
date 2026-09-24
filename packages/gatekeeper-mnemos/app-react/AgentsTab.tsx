import { useEffect, useState, type ReactNode } from "react";
import { formatBudgetUSD, parseBudgetUSD } from "../app/budget-money.ts";
import { projectExpenses, type ProjectExpenses } from "../app/budget-overview.ts";
import { PERIOD_LABELS, SPENDING_PERIODS, formatRUB, formatUSD, groupName, kindLabel, operationLabel } from "../app/spending-view.ts";
import type { AdminPerson } from "../src/admin-people.ts";
import type { ProjectBudgetPolicy, SpendingGroup, SpendingPeriod } from "../src/mnemos-api.ts";
import { useUi } from "./host.ts";
import { agentKind, agentNames, isAdministrator, personName, projectName, UNNAMED_DOCUMENT, useLoad, type AgentConnection, type MemoryData } from "./data.ts";
import { ActionForm, Notice, StatusBadge } from "./ui.tsx";
import { Card, CardRow, Field, FieldInput, FieldSelect, Pill, PillSelect, RowTitle } from "./admin-ui.tsx";

/** Сколько проектов обходить за задачами команд агентов: каждый проект — несколько запросов к серверу. */
const EXPENSE_PROJECTS = 10;
/** Экран моделей — страница оболочки, а не этого приложения. */

/** Заголовок секции со счётчиком: h2 и число сразу за ним. */
function Head({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
    <h2 className="m-0 text-[17px] font-semibold text-kumo-default">{title}</h2>
    {count !== undefined && <span className="rounded-full bg-kumo-tint px-2 text-[12px] leading-5 font-medium text-kumo-subtle">{count}</span>}
    <div className="flex-1" />
    {children}
  </div>;
}

/** «Агенты и расходы»: сколько потрачено, расходы и бюджеты по проектам, агенты организации — одной страницей. */
export default function AgentsTab({ data }: { data: MemoryData }) {
  const [external, setExternal] = useState(false);
  return <div className="grid max-w-[820px] gap-8">
    <ExpensesPanel data={data} />
    <section aria-label="Бюджеты проектов"><Head title="Бюджеты проектов" /><BudgetPanel data={data} /></section>
    <section aria-label="Агенты">
      <Head title="Агенты" count={data.connectionsError || data.connectionsLoading ? undefined : data.connections.filter(c => !c.revoked).length}>
        <Pill aria-expanded={external} onClick={() => setExternal(!external)}>{external ? "Свернуть" : "Подключить Codex или Claude Code"}</Pill>
      </Head>
      {external && <ExternalAgentSetup data={data} />}
      <AgentList data={data} />
    </section>
    <p className="m-0 text-[13px] text-kumo-subtle">Какие модели отвечают агентам и сколько стоит их работа, настраивается в «Настройках», раздел «Модели».</p>
  </div>;
}

function AgentList({ data }: { data: MemoryData }) {
  const ui = useUi();
  const telegram = useLoad(() => ui.listTelegram(), "Каналы Telegram не прочитаны.", [ui]);
  // Отозванные подключения не работают и только засоряют список: они свёрнуты внизу.
  const active = data.connections.filter(c => !c.revoked);
  const revoked = data.connections.filter(c => c.revoked);
  const titles = agentNames(data.connections);
  const card = (agent: AgentConnection) => <AgentCard key={agent.binding_id} agent={agent} title={titles.get(agent.binding_id) ?? agentKind(agent)} data={data}
    telegram={telegram.error ? telegram.error : (telegram.value?.connections ?? []).filter(c => c.binding === agent.binding_id).map(c => `@${c.username}${c.disconnected ? " — отключён" : c.channel_registered ? "" : " — ждёт подтверждения"}`).join(", ")} />;
  if (data.connectionsError) return <Notice tone="danger">{data.connectionsError}</Notice>;
  if (data.connectionsLoading && data.connections.length === 0) return <Notice>Загрузка агентов…</Notice>;
  return <>
    {data.taskError && <div className="mb-3"><Notice tone="danger">{data.taskError}</Notice></div>}
    {!data.connectionsCursor && active.length === 0 && <Notice>{revoked.length ? "Действующих агентов нет." : "Агентов пока нет."} Агент беседы появляется сам, когда сотрудник начинает беседу; свой Codex или Claude Code подключается кнопкой выше.</Notice>}
    {active.length > 0 && <Card>{active.map(card)}</Card>}
    {data.connectionsCursor && <div className="mt-2"><Pill disabled={data.connectionsLoading} onClick={() => void data.loadMoreConnections()}>Показать ещё агентов</Pill></div>}
    {revoked.length > 0 && <details aria-label="Отключённые агенты" className="mt-3 text-[13px]">
      <summary className="cursor-pointer text-kumo-subtle">Отключённые ({revoked.length})</summary>
      <Card className="mt-2">{revoked.map(card)}</Card>
    </details>}
  </>;
}

function AgentCard({ agent, title, data, telegram }: { agent: AgentConnection; title: string; data: MemoryData; telegram: string }) {
  const ui = useUi();
  const [confirming, setConfirming] = useState(false);
  const [editingScope, setEditingScope] = useState(false);
  const [history, setHistory] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const task = data.task?.binding_id === agent.binding_id ? data.task : null;
  const absences = [...data.absences.values()].filter(a => a.enabled && (a.local_binding_id === agent.binding_id || a.managed_binding_id === agent.binding_id));
  const running = !!task && !!task.team_budget && task.submitted && !task.cancelled && task.outcome?.state !== "completed";
  const admin = isAdministrator(data.identity);

  async function revoke() {
    setBusy(true); setNotice(null);
    try {
      await ui.revokeAgentConnection(agent.binding_id);
      setNotice({ tone: "success", text: "Доступ отозван: агент больше не сможет обращаться к памяти." });
      await data.reloadConnections();
    } catch {
      setNotice({ tone: "danger", text: "Отзыв не подтверждён. Обновите страницу и проверьте ещё раз." });
    } finally { setBusy(false); setConfirming(false); }
  }
  async function stop() {
    if (!task) return;
    setBusy(true); setNotice(null);
    try {
      await ui.cancelSavedTeamTask(task.request_id);
      setNotice({ tone: "success", text: "Работа остановлена. Уже начатый шаг может завершиться." });
      await data.reloadTask();
    } catch {
      setNotice({ tone: "danger", text: "Остановка не подтверждена. Проверьте историю задач." });
    } finally { setBusy(false); }
  }

  const taskState = task ? (task.outcome?.state === "completed" ? "ждёт вашей приёмки" : task.outcome?.state === "budget_blocked" ? "остановлена: закончился бюджет" : task.cancel_requested ? "останавливается" : task.submitted ? "в работе" : "не отправлена") : "";
  const status = agentStatus(agent, running);
  const where = agent.runtime_id === "workshop" ? "работает в беседах" : agent.managed_runtime === true ? "работает на платформе агентов" : "подключён со своего компьютера";

  return (
    <article data-agent={agent.binding_id} className="border-t border-kumo-fill px-4 py-4 first:border-t-0">
      <div className="flex items-center gap-3">
        <span className="block min-w-0 flex-1">
          <h3 className="m-0 text-[15px] font-medium text-kumo-default">{title}</h3>
          <span className="block text-[13px] text-kumo-subtle">{where}</span>
        </span>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>
      {notice && <div className="mt-2"><Notice tone={notice.tone}>{notice.text}</Notice></div>}

      <dl className="mt-3 mb-0 grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px] leading-[18px] text-kumo-default max-md:grid-cols-1">
        <dt className="m-0 text-kumo-subtle">Проекты</dt>
        <dd className="m-0">
          {agent.revoked ? "Доступ отозван." : !agent.document_grants?.length ? "Доступа к проектам нет." : agent.document_grants.map((g, i) => <div key={i}>«{projectName(data.projects, g.project_id)}» · {g.node_id ? documentLabel(data, g.project_id, g.node_id) : "весь проект"} · {g.mode === "write" ? "чтение и черновики" : "только чтение"}</div>)}
          <span className="block text-kumo-subtle">Агент видит не больше, чем его владелец.</span>
          {!agent.revoked && agent.runtime_id === "workshop" && <><Pill className="mt-2" aria-expanded={editingScope} onClick={() => setEditingScope(!editingScope)}>Изменить проекты агента</Pill>{editingScope && <WorkshopScope agent={agent} data={data} onDone={() => setEditingScope(false)} />}</>}
          {!agent.revoked && agent.runtime_id !== "workshop" && admin && <><Pill className="mt-2" aria-expanded={editingScope} onClick={() => setEditingScope(!editingScope)}>Настроить доступ к проекту</Pill>{editingScope && <AgentProjectAccess agent={agent} data={data} />}</>}
        </dd>
        <dt className="m-0 text-kumo-subtle">Сейчас</dt>
        <dd className="m-0 flex flex-wrap items-center gap-2">{task ? `${(task.message ?? "").slice(0, 100) || "задача"} — ${taskState}` : "задач нет"}{agent.managed_runtime === true && <Pill tone="ghost" aria-expanded={history} onClick={() => setHistory(!history)}>{history ? "Скрыть историю" : "История задач"}</Pill>}</dd>
        {telegram && <><dt className="m-0 text-kumo-subtle">Telegram</dt><dd className="m-0">{telegram}</dd></>}
        {absences.length > 0 && <><dt className="m-0 text-kumo-subtle">Замещение</dt>
          <dd className="m-0">{absences.map(a => `${a.managed_binding_id === agent.binding_id ? "замещает" : "замещается"} в проекте «${projectName(data.projects, a.project_id)}» до ${new Date(a.ends_at).toLocaleString("ru-RU")}`).join("; ")}</dd></>}
      </dl>
      {history && <TaskHistory binding={agent.binding_id} />}

      {(running || !agent.revoked) && <div className="mt-3 flex flex-wrap items-center gap-2">
        {running && <Pill disabled={busy} onClick={() => void stop()}>Остановить работу</Pill>}
        <div className="flex-1" />
        {!agent.revoked && !confirming && <Pill tone="danger" disabled={busy} onClick={() => setConfirming(true)}>Отозвать доступ</Pill>}
        {!agent.revoked && confirming && <>
          <span className="text-[13px] text-kumo-subtle">Отозвать доступ этого агента к памяти?</span>
          <Pill tone="primary" disabled={busy} onClick={() => void revoke()}>Подтвердить отзыв</Pill>
          <Pill tone="ghost" disabled={busy} onClick={() => setConfirming(false)}>Отмена</Pill>
        </>}
      </div>}
    </article>
  );
}

/** Состояние агента словами: отозван, выполняет задачу, работает с проектами или ещё никуда не допущен.
 * Сервер не сообщает, запущен ли агент сейчас; «Работает» значит, что доступ к проектам у агента есть. */
export function agentStatus(agent: AgentConnection, running: boolean): { tone: "neutral" | "info" | "success" | "warning"; label: string } {
  if (agent.revoked) return { tone: "neutral", label: "Доступ отозван" };
  if (running) return { tone: "info", label: "Выполняет задачу" };
  if (agent.document_grants?.length) return { tone: "success", label: "Работает" };
  return { tone: "warning", label: "Не подключён ни к одному проекту" };
}

/** Завершённые задачи агента раскрываются прямо в карточке: что просили и что получилось. */
function TaskHistory({ binding }: { binding: string }) {
  const ui = useUi();
  const tasks = useLoad(async () => (await ui.finishedAgentTasks("")).requests.filter(t => t.binding_id === binding), "История задач не прочитана.", [ui, binding]);
  const [opened, setOpened] = useState("");
  const result = useLoad(async () => opened ? ui.readFinishedAgentTask(opened) : null, "Результат задачи не прочитан.", [ui, opened]);
  return <section aria-label="История задач" className="mt-3 rounded-xl bg-kumo-base p-3 text-[13px]">
    {tasks.loading && <Notice>Загрузка…</Notice>}
    {tasks.error && <Notice tone="danger">{tasks.error}</Notice>}
    {tasks.value?.length === 0 && <Notice>Завершённых задач пока нет.</Notice>}
    {(tasks.value ?? []).map(t => <div key={t.request_id} className="border-t border-kumo-fill py-2 first:border-t-0">
      <button type="button" className="text-left font-medium hover:underline" aria-expanded={opened === t.request_id} onClick={() => setOpened(opened === t.request_id ? "" : t.request_id)}>{(t.message ?? "").slice(0, 160) || "Задача"}</button>
      {opened === t.request_id && <div className="mt-1 whitespace-pre-wrap text-kumo-subtle">{result.loading ? "Загрузка…" : result.error || result.value?.outcome?.result?.content || "Текст результата не сохранён."}</div>}
    </div>)}
  </section>;
}

function documentLabel(data: MemoryData, project: string, node: string): string {
  const found = data.projects.find(p => p.id === project);
  // Пока документы проекта не прочитаны, имя неизвестно — это не «документ без названия».
  const name = found?.nodes.find(n => n.node_id === node)?.name || found?.privateDocs.get(node)?.name;
  if (name) return `документ «${name}»`;
  return (found?.nodes.length ? `документ «${UNNAMED_DOCUMENT}»` : "отдельный документ");
}

function WorkshopScope({agent,data,onDone}:{agent:AgentConnection;data:MemoryData;onDone():void}) {
 const ui=useUi();const [selected,setSelected]=useState<string[]>([]);const [error,setError]=useState("");const [busy,setBusy]=useState(false);
 const scope=useLoad(async()=>{const result=await ui.readWorkshopAgentScope(agent.binding_id);setSelected(result.project_ids);return result},"Проекты агента не прочитаны.",[ui,agent.binding_id]);
 const projects=[...data.projects.map(p=>({id:p.id,name:p.name})),...(scope.value?.project_ids??[]).filter(id=>!data.projects.some(p=>p.id===id)).map(id=>({id,name:"Проект, который вам больше недоступен"}))];
 return <section aria-label="Проекты агента" className="mt-3 grid gap-2 rounded-xl bg-kumo-base p-3"><p className="m-0">Выберите проекты. Агент получит к ним доступ не шире вашего.</p>
 {projects.map(p=><label key={p.id} className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(p.id)} disabled={busy||scope.loading} onChange={e=>setSelected(ids=>e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/>{p.name}</label>)}
 {(error||scope.error)&&<Notice tone="danger">{error||scope.error}</Notice>}
 <div className="flex gap-2"><Pill tone="primary" disabled={busy||!scope.value||!selected.length} onClick={async()=>{if(!scope.value||busy)return;setBusy(true);try{await ui.updateWorkshopAgentScope(agent.binding_id,scope.value.project_ids,selected);await data.reloadConnections();onDone()}catch{setError("Доступ не обновлён: могли измениться права или проекты. Обновите страницу.");await scope.reload()}finally{setBusy(false)}}}>Сохранить</Pill>
 <Pill tone="ghost" disabled={busy} onClick={onDone}>Отмена</Pill></div><p className="m-0 text-kumo-subtle">Чтобы закрыть агенту все проекты, отзовите его доступ.</p></section>;
}

function AgentProjectAccess({agent,data}: {agent: AgentConnection; data: MemoryData}) {
  const ui=useUi(); const [project,setProject]=useState(data.projects[0]?.id ?? '');
  const [mode,setMode]=useState<'read'|'write'>('read'); const [busy,setBusy]=useState(false); const [notice,setNotice]=useState('');
  async function apply(enabled: boolean) {
    setBusy(true);setNotice('');
    try {await ui.setAgentProjectRight(agent.agent_principal_id,project,mode,enabled);await data.reloadConnections();setNotice(enabled?'Право выдано.':'Выбранное право снято.');}
    catch {setNotice('Изменение не подтверждено. Обновите страницу и проверьте свои полномочия.');}
    finally {setBusy(false);}
  }
  return <div className="mt-3 grid gap-2 rounded-xl bg-kumo-base p-3">
    <div className="flex flex-wrap items-center gap-2">
      <PillSelect aria-label="Проект доступа агента" value={project} disabled={busy} onChange={e=>setProject(e.target.value)}>
        <option value="">Выберите проект</option>{data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </PillSelect>
      <PillSelect aria-label="Право агента" value={mode} disabled={busy} onChange={e=>setMode(e.target.value as 'read'|'write')}>
        <option value="read">Чтение</option><option value="write">Чтение и черновики</option>
      </PillSelect>
    </div>
    <div className="flex flex-wrap gap-2"><Pill tone="primary" disabled={busy||!project} onClick={()=>void apply(true)}>Выдать право</Pill><Pill disabled={busy||!project} onClick={()=>void apply(false)}>Снять это право</Pill></div>
    {notice && <Notice>{notice}</Notice>}
  </div>;
}

/** Подключение своего Codex или Claude Code — раскрывается на странице, без всплывающего окна. */
function ExternalAgentSetup({data}: {data: MemoryData}) {
  const ui = useUi();
  const setup = useLoad(() => ui.externalAgentSetup(), "Не удалось подготовить команды подключения. Обновите страницу.", [ui]);
  const [client, setClient] = useState<'codex' | 'claude'>('codex');
  const [notice, setNotice] = useState('');
  const [checking, setChecking] = useState(false);
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  const config = setup.value;
  const command = config ? client === 'codex'
    ? `codex mcp add mnemos --url ${quote(config.resource)} --oauth-client-id ${quote(config.clientId)}`
    : `claude mcp add --transport http --scope user --client-id ${quote(config.clientId)} --callback-port 19450 mnemos ${quote(config.resource)}\nclaude mcp login mnemos`
    : '';
  return <section aria-label="Подключить своего агента" className="mb-4 grid gap-3 rounded-2xl border border-kumo-fill bg-kumo-overlay p-5 text-[14px]">
    <p className="m-0 text-kumo-subtle">Подключите Codex или Claude Code на своём компьютере к памяти организации.</p>
    <div className="flex gap-2" aria-label="Клиент агента">
      <Pill tone={client === 'codex' ? 'secondary' : 'ghost'} aria-pressed={client === 'codex'} onClick={() => {setClient('codex');setNotice('');}}>Codex</Pill>
      <Pill tone={client === 'claude' ? 'secondary' : 'ghost'} aria-pressed={client === 'claude'} onClick={() => {setClient('claude');setNotice('');}}>Claude Code</Pill>
    </div>
    {setup.error && <Notice tone="danger">{setup.error}</Notice>}
    {!config && !setup.error && <p className="m-0">Готовим команды…</p>}
    {config && <>
      <p className="m-0 font-medium">1. Выполните команды в терминале своего компьютера</p>
      <textarea aria-label="Команды подключения" readOnly value={command} onFocus={event => event.target.select()} className="min-h-28 w-full resize-y rounded-xl border border-kumo-fill bg-kumo-base p-3 font-mono text-xs leading-6" />
      <p className="m-0 font-medium">2. Подтвердите подключение в браузере</p>
      <p className="m-0 text-kumo-subtle">Откроется страница входа. Выберите организацию и нажмите «Подключить агента».</p>
      <p className="m-0 font-medium">3. Откройте агенту проекты</p>
      <p className="m-0 text-kumo-subtle">Обновите список и нажмите «Настроить доступ к проекту» в строке нового агента.</p>
      <div className="flex flex-wrap items-center gap-2"><Pill disabled={checking} onClick={async () => {setChecking(true);setNotice('');try {await data.reloadConnections();setNotice('Список обновлён.');} catch {setNotice('Список не обновился. Повторите.');} finally {setChecking(false);}}}>{checking ? 'Обновляем…' : 'Обновить список агентов'}</Pill>
      {notice && <Notice>{notice}</Notice>}</div>
    </>}
  </section>;
}

/** Бюджет проекта: по умолчанию без ограничения; лимит — необязательная настройка, которую задаёт администратор. */
function BudgetPanel({ data }: { data: MemoryData }) {
  const ui = useUi();
  const [project, setProject] = useState("");
  const [policy, setPolicy] = useState<ProjectBudgetPolicy | null>(null);
  const [form, setForm] = useState({ owner: "", limit: "0", automatic: "0", team: "1" });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const people = useLoad(async () => (await ui.listPeople()).users as AdminPerson[], "", [ui]);
  const unlimited = !policy || policy.revision === 0 || policy.limit_usd_micros === "0";
  useEffect(() => {
    let current = true;
    setPolicy(null); setNotice(null); setEditing(false);
    if (!project) return;
    setBusy(true);
    void ui.readProjectBudget(project).then(p => {
      if (!current) return;
      setPolicy(p);
      setForm({ owner: p.owner_id, limit: formatBudgetUSD(p.limit_usd_micros), automatic: formatBudgetUSD(p.automatic_usd_micros), team: String(p.automatic_team_size || 1) });
    }, () => { if (current) setNotice({ tone: "danger", text: "Бюджет проекта не прочитан: его видит владелец бюджета или администратор." }); }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [ui, project]);

  async function save(values: typeof form, done: string) {
    if (!policy || busy) return;
    setBusy(true); setNotice(null);
    try {
      const saved = await ui.setProjectBudget(project, { revision: policy.revision, owner_id: values.owner, limit_usd_micros: parseBudgetUSD(values.limit), automatic_usd_micros: parseBudgetUSD(values.automatic), automatic_team_size: Number(values.team) });
      setPolicy(saved);
      setForm({ owner: saved.owner_id, limit: formatBudgetUSD(saved.limit_usd_micros), automatic: formatBudgetUSD(saved.automatic_usd_micros), team: String(saved.automatic_team_size || 1) });
      setEditing(false);
      setNotice({ tone: "success", text: done });
    } catch {
      setNotice({ tone: "danger", text: "Бюджет не сохранён. Проверьте суммы: порог без согласования не больше лимита, согласующий выбран." });
    } finally { setBusy(false); }
  }
  const owners = people.value ?? [];
  const ownerKnown = owners.some(p => p.userName === form.owner);
  const showForm = !!policy && (!unlimited || editing);
  return <ActionForm aria-label="Бюджет проекта" onAction={() => void save(form, "Бюджет сохранён.")} className="grid gap-3 rounded-2xl border border-kumo-fill bg-kumo-overlay p-5 text-[14px]">
    <p className="m-0 text-[13px] text-kumo-subtle">По умолчанию у проекта нет денежного лимита: агенты работают без остановки и без согласования. Лимит администратор задаёт сам. Суммы в долларах США.</p>
    <Field label="Проект" className="max-w-[360px]">
      <FieldSelect aria-label="Проект бюджета" value={project} disabled={busy} onChange={e => setProject(e.target.value)}>
        <option value="">Выберите проект</option>
        {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </FieldSelect>
    </Field>
    {policy && unlimited && !editing && <div className="flex flex-wrap items-center gap-3">
      <span className="font-medium text-kumo-default">Без ограничения</span>
      <Pill tone="primary" disabled={busy} onClick={() => { setEditing(true); setNotice(null); setForm(f => ({ ...f, limit: f.limit === "0" ? "" : f.limit, automatic: "0", team: f.team || "1" })); }}>Задать лимит</Pill>
    </div>}
    {showForm && <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Лимит проекта, $"><FieldInput aria-label="Общий бюджет" inputMode="decimal" value={form.limit} disabled={busy} onChange={e => setForm({ ...form, limit: e.target.value })} /></Field>
        <Field label="Без согласования — до, $"><FieldInput aria-label="Порог без согласования" inputMode="decimal" value={form.automatic} disabled={busy} onChange={e => setForm({ ...form, automatic: e.target.value })} /></Field>
        <Field label="Без согласования — агентов в команде до"><FieldInput aria-label="Размер команды без согласования" inputMode="numeric" value={form.team} disabled={busy} onChange={e => setForm({ ...form, team: e.target.value })} /></Field>
        <Field label="Кто согласует расходы сверх порога">
          <FieldSelect aria-label="Владелец бюджета" value={form.owner} disabled={busy || !owners.length} onChange={e => setForm({ ...form, owner: e.target.value })}>
            <option value="">Не назначен</option>
            {!ownerKnown && form.owner && <option value={form.owner}>{personName(form.owner)}</option>}
            {owners.filter(p => p.active).map(p => <option key={p.userName} value={p.userName}>{p.displayName || "Сотрудник без имени"}</option>)}
          </FieldSelect>
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Pill tone="primary" disabled={busy} onClick={() => void save(form, "Бюджет сохранён.")}>Сохранить бюджет</Pill>
        {!unlimited && <Pill disabled={busy} onClick={() => void save({ ...form, limit: "0", automatic: "0", team: "1" }, "Лимит снят: проект работает без ограничения.")}>Снять лимит</Pill>}
        {unlimited && editing && <Pill tone="ghost" disabled={busy} onClick={() => setEditing(false)}>Отмена</Pill>}
      </div>
    </>}
    {busy && !policy && project && <Notice>Загрузка…</Notice>}
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
  </ActionForm>;
}

/** Строка разбивки: имя словами, сумма, рубли и пометка об оценке. */
function SpendRow({ title, group, rate }: { title: string; group: SpendingGroup; rate?: number }) {
  const rub = formatRUB(group.micro_usd, rate);
  const note = `операций ${group.count}${group.estimated_count ? ` · из них по оценке ${group.estimated_count}` : ""}`;
  return <CardRow><RowTitle title={title} note={note} /><span className="shrink-0 text-right text-[13px] text-kumo-default">{formatUSD(group.micro_usd)}{rub && <span className="block text-kumo-subtle">{rub}</span>}</span></CardRow>;
}

type SpendKey = "kinds" | "operations" | "projects" | "people" | "agents" | "models";

/** Сколько потрачено на модели и платные службы: итог за период и разбивки по видам, проектам, людям, агентам и моделям. */
function ExpensesPanel({ data }: { data: MemoryData }) {
  const ui = useUi();
  const [period, setPeriod] = useState<SpendingPeriod>("30d");
  const timeZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""; } catch { return ""; } })();
  const summary = useLoad(() => ui.readSpending(period, timeZone), "Расходы не прочитаны. Обновите страницу.", [ui, period]);
  const projects = data.projects.slice(0, EXPENSE_PROJECTS);
  // Задачи команд на платформе агентов считает сама платформа: их суммы показаны отдельно, за всё время.
  const teams = useLoad(async () => {
    const api = ui as unknown as Parameters<typeof projectExpenses>[0];
    const rows: ProjectExpenses[] = [];
    for (let i = 0; i < projects.length; i += 4) rows.push(...await Promise.all(projects.slice(i, i + 4).map(p => projectExpenses(api, p.id, p.name))));
    return rows.filter(r => r.proposals > 0 || r.known !== "0");
  }, "", [ui, projects.map(p => p.id).join(",")]);
  const s = summary.value;
  const rate = s?.usd_rub_rate;
  const section = (title: string, key: SpendKey, name: (g: SpendingGroup) => string, skipEmptyKey = false) => {
    const rows = (s?.[key] ?? []).filter(g => !(skipEmptyKey && !g.key));
    return <section aria-label={title} key={key}>
      <Head title={title} />
      {rows.length ? <Card>{rows.map(g => <SpendRow key={g.key || "-"} title={name(g)} group={g} rate={rate} />)}</Card> : <Notice>{s ? "Трат нет." : "…"}</Notice>}
    </section>;
  };
  return <section aria-label="Расходы" className="grid gap-5">
    <div className="flex flex-wrap gap-2" aria-label="Период расходов">
      {SPENDING_PERIODS.map(p => <Pill key={p} tone={p === period ? "secondary" : "ghost"} aria-pressed={p === period} onClick={() => setPeriod(p)}>{PERIOD_LABELS[p]}</Pill>)}
    </div>
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[34px] font-semibold tracking-[-1px] text-kumo-default" data-spending-total>{s ? formatUSD(s.micro_usd) : "—"}</span>
        {s && rate ? <span className="text-[17px] text-kumo-default">{formatRUB(s.micro_usd, rate)}</span> : null}
        <span className="text-[14px] text-kumo-subtle">{s ? `${s.all_visible ? "потрачено в организации" : "потрачено от вашего имени"} · ${PERIOD_LABELS[period].toLowerCase()}` : ""}</span>
      </div>
      {summary.loading && !s && <div className="mt-2"><Notice>Считаем расходы…</Notice></div>}
      {summary.error && <div className="mt-2"><Notice tone="danger">{summary.error}</Notice></div>}
      {s && <p className="mt-2 mb-0 text-[12px] text-kumo-subtle">Операций {s.count}{s.estimated_count ? `, из них ${s.estimated_count} по оценке: поставщик не назвал цену, она посчитана по каталогу` : ""}. Цена берётся из ответа поставщика моделей, в долларах США{rate ? `; рубли — по курсу установки ${rate}` : ""}.</p>}
    </Card>
    {section("По видам", "kinds", g => kindLabel(g.key))}
    {section("По операциям", "operations", g => operationLabel(g.key))}
    {section("Расходы по проектам", "projects", g => groupName("projects", g.key, g.name))}
    {section("По людям", "people", g => groupName("people", g.key, g.name))}
    {section("По агентам", "agents", g => groupName("agents", g.key, g.name), true)}
    {section("По моделям", "models", g => groupName("models", g.key, g.name))}
    {(teams.value ?? []).length > 0 && <section aria-label="Задачи команд агентов">
      <Head title="Задачи команд агентов" />
      <p className="mt-0 mb-2 text-[12px] text-kumo-subtle">Эти задачи считает платформа агентов; суммы за всё время, в итог выше не входят.</p>
      <Card>{(teams.value ?? []).map(r => <CardRow key={r.project}>
        <RowTitle title={r.name} note={`потрачено ${formatBudgetUSD(r.known)} $ · зарезервировано ${formatBudgetUSD(r.reserved)} $ · заявок ${r.proposals}${r.complete ? "" : " · данные неполные"}`} />
      </CardRow>)}</Card>
      {data.projects.length > EXPENSE_PROJECTS && <p className="mt-2 mb-0 text-[12px] text-kumo-subtle">Показаны первые {EXPENSE_PROJECTS} проектов.</p>}
    </section>}
  </section>;
}
