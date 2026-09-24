import { useEffect, useState } from "react";
import { Button, Dialog } from "@cloudflare/kumo";
import { formatBudgetUSD, parseBudgetUSD } from "../app/budget-money.ts";
import { projectExpenses, type ProjectExpenses } from "../app/budget-overview.ts";
import type { AdminPerson } from "../src/admin-people.ts";
import type { ProjectBudgetPolicy } from "../src/mnemos-api.ts";
import { useUi } from "./host.ts";
import { agentKind, agentNames, isAdministrator, personName, projectName, UNNAMED_DOCUMENT, useLoad, type AgentConnection, type MemoryData } from "./data.ts";
import { ActionForm, AdminDetails, Block, Notice, Row, RowList, RowText, Select, StatusBadge, TextInput } from "./ui.tsx";

/** Сколько проектов считать в расходах за раз: каждый проект — несколько запросов к серверу. */
const EXPENSE_PROJECTS = 10;

/** «Агенты и расходы»: агенты по именам, бюджеты проектов и расходы на работу агентов. */
export default function AgentsTab({ data }: { data: MemoryData }) {
  const [external, setExternal] = useState(false);
  return (
    <>
      <Block title="Агенты" count={data.connectionsError || data.connectionsLoading ? undefined : data.connections.filter(c => !c.revoked).length}
        actions={<Button variant="secondary" size="sm" onClick={() => setExternal(true)}>Подключить Codex или Claude Code</Button>}>
        <AgentList data={data} />
      </Block>
      <ExternalAgentDialog open={external} onClose={() => setExternal(false)} data={data} />
      <Block title="Бюджеты проектов"><BudgetPanel data={data} /></Block>
      <Block title="Расходы по проектам"><ExpensesPanel data={data} /></Block>
    </>
  );
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
    {active.map(card)}
    {data.connectionsCursor && <Button disabled={data.connectionsLoading} onClick={() => void data.loadMoreConnections()}>Показать ещё агентов</Button>}
    {revoked.length > 0 && <details aria-label="Отключённые агенты" className="mt-2 text-[13px]">
      <summary className="cursor-pointer text-kumo-subtle">Отключённые ({revoked.length})</summary>
      <div className="mt-3">{revoked.map(card)}</div>
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
    <article data-agent={agent.binding_id} className="mb-4 rounded-xl border border-kumo-line bg-kumo-base p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[15px] font-semibold text-kumo-strong">{title}</h3>
          <p className="mt-0.5 mb-0 text-[12px] text-kumo-subtle">{where}</p>
          <AdminDetails show={admin} items={[["Подключение", agent.binding_id], ["Учётная запись агента", agent.agent_principal_id]]} />
        </div>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>
      {notice && <div className="mt-2"><Notice tone={notice.tone}>{notice.text}</Notice></div>}

      <dl className="mt-3 mb-0 grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px] leading-[18px] text-kumo-default max-md:grid-cols-1">
        <dt className="m-0 text-kumo-subtle">Проекты</dt>
        <dd className="m-0">
          {agent.revoked ? "Доступ отозван." : !agent.document_grants?.length ? "Доступа к проектам нет." : agent.document_grants.map((g, i) => <div key={i}>«{projectName(data.projects, g.project_id)}» · {g.node_id ? documentLabel(data, g.project_id, g.node_id) : "весь проект"} · {g.mode === "write" ? "чтение и черновики" : "только чтение"}</div>)}
          <span className="block text-kumo-subtle">Агент видит не больше, чем его владелец.</span>
          {!agent.revoked && agent.runtime_id === "workshop" && <><Button size="sm" variant="secondary" onClick={() => setEditingScope(!editingScope)}>Изменить проекты агента</Button>{editingScope && <WorkshopScope agent={agent} data={data} onDone={() => setEditingScope(false)} />}</>}
          {!agent.revoked && agent.runtime_id !== "workshop" && admin && <><Button size="sm" variant="secondary" onClick={() => setEditingScope(!editingScope)}>Настроить доступ к проекту</Button>{editingScope && <AgentProjectAccess agent={agent} data={data} />}</>}
        </dd>
        <dt className="m-0 text-kumo-subtle">Сейчас</dt>
        <dd className="m-0 flex items-center gap-2">{task ? `${(task.message ?? "").slice(0, 100) || "задача"} — ${taskState}` : "задач нет"}{agent.managed_runtime === true && <Button variant="ghost" size="sm" aria-expanded={history} onClick={() => setHistory(!history)}>{history ? "Скрыть историю" : "История задач"}</Button>}</dd>
        {telegram && <><dt className="m-0 text-kumo-subtle">Telegram</dt><dd className="m-0">{telegram}</dd></>}
        {absences.length > 0 && <><dt className="m-0 text-kumo-subtle">Замещение</dt>
          <dd className="m-0">{absences.map(a => `${a.managed_binding_id === agent.binding_id ? "замещает" : "замещается"} в проекте «${projectName(data.projects, a.project_id)}» до ${new Date(a.ends_at).toLocaleString("ru-RU")}`).join("; ")}</dd></>}
      </dl>
      {history && <TaskHistory binding={agent.binding_id} />}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-kumo-line pt-3">
        {running && <Button variant="secondary" size="sm" disabled={busy} onClick={() => void stop()}>Остановить работу</Button>}
        <div className="flex-1" />
        {!agent.revoked && !confirming && <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(true)}>Отозвать доступ</Button>}
        {!agent.revoked && confirming && <>
          <span className="text-[12px] text-kumo-subtle">Отозвать доступ этого агента к памяти?</span>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void revoke()}>Подтвердить отзыв</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>Отмена</Button>
        </>}
      </div>
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
  return <section aria-label="История задач" className="mt-3 rounded-lg border border-kumo-line bg-kumo-elevated p-3 text-[13px]">
    {tasks.loading && <Notice>Загрузка…</Notice>}
    {tasks.error && <Notice tone="danger">{tasks.error}</Notice>}
    {tasks.value?.length === 0 && <Notice>Завершённых задач пока нет.</Notice>}
    {(tasks.value ?? []).map(t => <div key={t.request_id} className="border-t border-kumo-line py-2 first:border-t-0">
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
 return <section aria-label="Проекты агента"><p>Выберите проекты. Агент получит к ним доступ не шире вашего.</p>
 {projects.map(p=><label key={p.id} className="block"><input type="checkbox" checked={selected.includes(p.id)} disabled={busy||scope.loading} onChange={e=>setSelected(ids=>e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/>{p.name}</label>)}
 {(error||scope.error)&&<Notice tone="danger">{error||scope.error}</Notice>}
 <Button disabled={busy||!scope.value||!selected.length} onClick={async()=>{if(!scope.value||busy)return;setBusy(true);try{await ui.updateWorkshopAgentScope(agent.binding_id,scope.value.project_ids,selected);await data.reloadConnections();onDone()}catch{setError("Доступ не обновлён: могли измениться права или проекты. Обновите страницу.");await scope.reload()}finally{setBusy(false)}}}>Сохранить</Button>
 <Button disabled={busy} onClick={onDone}>Отмена</Button><p>Чтобы закрыть агенту все проекты, отзовите его доступ.</p></section>;
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
  return <div className="mt-3 space-y-3 rounded-lg border border-kumo-line p-3">
    <label className="block">Проект<Select aria-label="Проект доступа агента" value={project} disabled={busy} onChange={e=>setProject(e.target.value)}>
      <option value="">Выберите проект</option>{data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
    </Select></label>
    <label className="block">Право<Select aria-label="Право агента" value={mode} disabled={busy} onChange={e=>setMode(e.target.value as 'read'|'write')}>
      <option value="read">Чтение</option><option value="write">Чтение и черновики</option>
    </Select></label>
    <div className="flex flex-wrap gap-2"><Button disabled={busy||!project} onClick={()=>void apply(true)}>Выдать право</Button><Button variant="secondary" disabled={busy||!project} onClick={()=>void apply(false)}>Снять это право</Button></div>
    {notice && <Notice>{notice}</Notice>}
  </div>;
}

function ExternalAgentDialog({open, onClose, data}: {open: boolean; onClose: () => void; data: MemoryData}) {
  return <Dialog.Root open={open} onOpenChange={value => {if (!value) onClose();}}>
    <Dialog size="lg" className="!w-[min(640px,calc(100vw-32px))] max-h-[85dvh] overflow-y-auto bg-kumo-base p-6">
      <Dialog.Title className="text-lg font-semibold">Подключить своего агента</Dialog.Title>
      <Dialog.Description className="mt-2 text-sm text-kumo-subtle">Подключите Codex или Claude Code на своём компьютере к памяти организации.</Dialog.Description>
      {open && <ExternalAgentSetup data={data} />}
      <div className="mt-5 flex justify-end"><Dialog.Close render={props => <Button {...props}>Закрыть</Button>} /></div>
    </Dialog>
  </Dialog.Root>;
}

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
  return <div className="mt-5 space-y-4 text-sm">
    <div className="flex gap-2" aria-label="Клиент агента">
      <Button variant={client === 'codex' ? 'secondary' : 'ghost'} aria-pressed={client === 'codex'} onClick={() => {setClient('codex');setNotice('');}}>Codex</Button>
      <Button variant={client === 'claude' ? 'secondary' : 'ghost'} aria-pressed={client === 'claude'} onClick={() => {setClient('claude');setNotice('');}}>Claude Code</Button>
    </div>
    {setup.error && <Notice tone="danger">{setup.error}</Notice>}
    {!config && !setup.error && <p>Готовим команды…</p>}
    {config && <>
      <p className="font-medium">1. Выполните команды в терминале своего компьютера</p>
      <textarea aria-label="Команды подключения" readOnly value={command} onFocus={event => event.target.select()} className="w-full min-h-32 resize-y rounded-lg border border-kumo-line bg-kumo-elevated p-3 font-mono text-xs leading-6" />
      <p className="font-medium">2. Подтвердите подключение в браузере</p>
      <p className="text-kumo-subtle">Откроется страница входа. Выберите организацию и нажмите «Подключить агента».</p>
      <p className="font-medium">3. Откройте агенту проекты</p>
      <p className="text-kumo-subtle">Обновите список и нажмите «Настроить доступ к проекту» в карточке нового агента.</p>
      <Button disabled={checking} onClick={async () => {setChecking(true);setNotice('');try {await data.reloadConnections();setNotice('Список обновлён.');} catch {setNotice('Список не обновился. Повторите.');} finally {setChecking(false);}}}>{checking ? 'Обновляем…' : 'Обновить список агентов'}</Button>
      {notice && <Notice>{notice}</Notice>}
    </>}
  </div>;
}

/** Бюджет проекта: общий предел, порог без согласования, размер команды и владелец — по имени, из списка сотрудников. */
function BudgetPanel({ data }: { data: MemoryData }) {
  const ui = useUi();
  const [project, setProject] = useState("");
  const [policy, setPolicy] = useState<ProjectBudgetPolicy | null>(null);
  const [form, setForm] = useState({ owner: "", limit: "0", automatic: "0", team: "1" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const people = useLoad(async () => (await ui.listPeople()).users as AdminPerson[], "", [ui]);
  useEffect(() => {
    let current = true;
    setPolicy(null); setNotice(null);
    if (!project) return;
    setBusy(true);
    void ui.readProjectBudget(project).then(p => {
      if (!current) return;
      setPolicy(p);
      setForm({ owner: p.owner_id, limit: formatBudgetUSD(p.limit_usd_micros), automatic: formatBudgetUSD(p.automatic_usd_micros), team: String(p.automatic_team_size || 1) });
    }, () => { if (current) setNotice({ tone: "danger", text: "Бюджет проекта не прочитан: его видит владелец бюджета или администратор." }); }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [ui, project]);

  async function save() {
    if (!policy || busy) return;
    setBusy(true); setNotice(null);
    try {
      const saved = await ui.setProjectBudget(project, { revision: policy.revision, owner_id: form.owner, limit_usd_micros: parseBudgetUSD(form.limit), automatic_usd_micros: parseBudgetUSD(form.automatic), automatic_team_size: Number(form.team) });
      setPolicy(saved);
      setNotice({ tone: "success", text: "Бюджет сохранён." });
    } catch {
      setNotice({ tone: "danger", text: "Бюджет не сохранён. Проверьте суммы: порог без согласования не больше общего бюджета." });
    } finally { setBusy(false); }
  }
  const owners = people.value ?? [];
  const ownerKnown = owners.some(p => p.userName === form.owner);
  return <ActionForm aria-label="Бюджет проекта" onAction={() => void save()} className="grid max-w-[560px] gap-3 text-[13px]">
    <p className="m-0 text-kumo-subtle">Бюджет ограничивает расходы агентов в проекте. Суммы в долларах США.</p>
    <label className="grid gap-1">Проект
      <Select aria-label="Проект бюджета" value={project} disabled={busy} onChange={e => setProject(e.target.value)}>
        <option value="">Выберите проект</option>
        {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
    </label>
    {policy && <>
      {!policy.revision && <Notice>Бюджет ещё не задан: расходы не ограничены этим правилом.</Notice>}
      <label className="grid gap-1">Общий бюджет, $<TextInput aria-label="Общий бюджет" inputMode="decimal" value={form.limit} disabled={busy} onChange={e => setForm({ ...form, limit: e.target.value })} /></label>
      <label className="grid gap-1">Без согласования — до, $<TextInput aria-label="Порог без согласования" inputMode="decimal" value={form.automatic} disabled={busy} onChange={e => setForm({ ...form, automatic: e.target.value })} /></label>
      <label className="grid gap-1">Без согласования — агентов в команде до<TextInput aria-label="Размер команды без согласования" inputMode="numeric" value={form.team} disabled={busy} onChange={e => setForm({ ...form, team: e.target.value })} /></label>
      <label className="grid gap-1">Кто согласует расходы сверх порога
        <Select aria-label="Владелец бюджета" value={form.owner} disabled={busy || !owners.length} onChange={e => setForm({ ...form, owner: e.target.value })}>
          <option value="">Не назначен</option>
          {!ownerKnown && form.owner && <option value={form.owner}>{personName(form.owner)}</option>}
          {owners.filter(p => p.active).map(p => <option key={p.userName} value={p.userName}>{p.displayName || "Сотрудник без имени"}</option>)}
        </Select>
      </label>
      <div><Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => void save()}>Сохранить бюджет</Button></div>
    </>}
    {busy && !policy && project && <Notice>Загрузка…</Notice>}
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
  </ActionForm>;
}

/** Расходы агентов по проектам из учёта вызовов; неполные данные честно помечены. */
function ExpensesPanel({ data }: { data: MemoryData }) {
  const ui = useUi();
  const projects = data.projects.slice(0, EXPENSE_PROJECTS);
  const expenses = useLoad(async () => {
    const api = ui as unknown as Parameters<typeof projectExpenses>[0];
    const rows: ProjectExpenses[] = [];
    for (let i = 0; i < projects.length; i += 4) rows.push(...await Promise.all(projects.slice(i, i + 4).map(p => projectExpenses(api, p.id, p.name))));
    return rows;
  }, "Расходы не прочитаны. Обновите страницу.", [ui, projects.map(p => p.id).join(",")]);
  if (expenses.loading && !expenses.value) return <Notice>Считаем расходы…</Notice>;
  if (expenses.error) return <Notice tone="danger">{expenses.error}</Notice>;
  const rows = (expenses.value ?? []).filter(r => r.proposals > 0 || r.known !== "0");
  if (!rows.length) return <Notice>Агенты пока ничего не потратили в ваших проектах.</Notice>;
  return <>
    <p className="mt-0 mb-2 text-[12px] text-kumo-subtle">Расчёт по учтённым вызовам агентов, в долларах США. Это не счёт поставщика.</p>
    <RowList>{rows.map(r => <Row key={r.project}>
      <RowText title={r.name} note={`потрачено ${formatBudgetUSD(r.known)} $ · зарезервировано ${formatBudgetUSD(r.reserved)} $ · заявок ${r.proposals}${r.complete ? "" : " · данные неполные"}`} />
    </Row>)}</RowList>
    {data.projects.length > EXPENSE_PROJECTS && <p className="mt-2 mb-0 text-[12px] text-kumo-subtle">Показаны первые {EXPENSE_PROJECTS} проектов.</p>}
  </>;
}
