import { useState } from "react";
import { Button, Dialog } from "@cloudflare/kumo";
import type { ManagedAgentRequest } from "../src/account-session.ts";
import { formatBudgetUSD } from "../app/budget-money.ts";
import { useUi } from "./host.ts";
import { agentEnvironment, projectName, useLoad, type AgentConnection, type MemoryData } from "./data.ts";
import { LegacySwitch, useLegacySection } from "./legacy.tsx";
import { Block, Notice, Select, StatusBadge, TextInput } from "./ui.tsx";

type OpenLegacy = ReturnType<typeof useLegacySection>["open"];

export default function AgentsTab({ data }: { data: MemoryData }) {
  const ui = useUi();
  const legacy = useLegacySection();
  const [panel, setPanel] = useState<"" | "provision" | "external">("");
  const memory = useLoad(async () => {
    const selection = await ui.readPersonalMemory();
    if (!selection.node_id) return { selection, name: "" };
    const name = await ui.readDraftDocument(selection.project_id, selection.node_id).then(doc => doc.terms[0]?.metadata?.name || "Выбранный документ").catch(() => "Выбранный документ сейчас недоступен");
    return { selection, name };
  }, "Настройка памяти не прочитана.", [ui]);
  const telegram = useLoad(() => ui.listTelegram(), "Каналы Telegram не прочитаны.", [ui]);
  const task = data.task;
  const usage = useLoad(async () => task?.team_budget ? ui.readTeamBudgetUsage(task.team_budget.project_id, task.team_budget.proposal_id) : null, "расход не прочитан", [task?.team_budget?.proposal_id, ui]);
  const connections = [...data.connections].sort((a, b) => Number(a.revoked) - Number(b.revoked));

  return (
    <LegacySwitch state={legacy}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="m-0 flex-1 text-[12px] text-kumo-subtle">Ваши агенты: кто чем занят, что им разрешено и сколько это стоит.</p>
        <Button variant="secondary" size="sm" onClick={() => setPanel(panel === "external" ? "" : "external")}>Подключить Codex / Claude Code</Button>
        <Button variant="primary" size="sm" onClick={() => setPanel(panel === "provision" ? "" : "provision")}>Выдать агента</Button>
      </div>
      {panel === "provision" && <ProvisionPanel onDone={() => void data.reloadConnections()} />}
      <ExternalAgentDialog open={panel === "external"} onClose={() => setPanel("")} data={data} />
      {data.connectionsError && <div className="mb-3"><Notice tone="danger">{data.connectionsError}</Notice></div>}
      {data.taskError && <div className="mb-3"><Notice tone="danger">{data.taskError}</Notice></div>}
      {!data.connectionsError && !data.connectionsCursor && connections.length === 0 && <Notice>Агентов пока нет: выдайте управляемого агента или подключите своего.</Notice>}
      {data.connectionsCursor && <Button disabled={data.connectionsLoading} onClick={()=>void data.loadMoreConnections()}>Загрузить ещё агентов</Button>}
      {connections.map(agent => (
        <AgentCard key={agent.binding_id} agent={agent} data={data} openLegacy={legacy.open}
          memory={memory.value?.selection.node_id ? memory.value.name : memory.error || "Память отключена"}
          telegram={telegram.error ? telegram.error : (telegram.value?.connections ?? []).filter(c => c.binding === agent.binding_id).map(c => `@${c.username}${c.disconnected ? " — отключён" : c.channel_registered ? " — подключён" : " — требуется подтверждение"}`).join(", ") || "канал не подключён"}
          usage={task?.binding_id === agent.binding_id && task.team_budget ? (usage.value ? `расход ${formatBudgetUSD(usage.value.actual_usd_micros)} $ · зарезервировано ${formatBudgetUSD(usage.value.reserved_usd_micros)} $` : usage.error || "расход читается…") : "бюджет задаётся заявкой на задачу; текущей заявки нет"} />
      ))}
    </LegacySwitch>
  );
}

function AgentCard({ agent, data, openLegacy, memory, telegram, usage }: { agent: AgentConnection; data: MemoryData; openLegacy: OpenLegacy; memory: string; telegram: string; usage: string }) {
  const ui = useUi();
  const [confirming, setConfirming] = useState(false);
  const [rights, setRights] = useState(false);
  const [editingScope,setEditingScope]=useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [absenceProject, setAbsenceProject] = useState(data.projects[0]?.id ?? "");
  const managed = agent.managed_runtime === true;
  const task = data.task?.binding_id === agent.binding_id ? data.task : null;
  const absences = [...data.absences.values()].filter(a => a.enabled && (a.local_binding_id === agent.binding_id || a.managed_binding_id === agent.binding_id));
  const running = !!task && !!task.team_budget && task.submitted && !task.cancelled && task.outcome?.state !== "completed";

  async function revoke() {
    setBusy(true); setNotice(null);
    try {
      await ui.revokeAgentConnection(agent.binding_id);
      setNotice({ tone: "success", text: "Доступ отозван: следующие обращения агента сервер отклонит." });
      await data.reloadConnections();
    } catch {
      setNotice({ tone: "danger", text: "Результат отзыва не подтверждён. Обновите список перед повтором." });
    } finally { setBusy(false); setConfirming(false); }
  }
  async function stop() {
    if (!task) return;
    setBusy(true); setNotice(null);
    try {
      await ui.cancelSavedTeamTask(task.request_id);
      setNotice({ tone: "success", text: "Дальнейшие вызовы отменены. Уже начатый вызов может завершиться; задача перенесена в историю." });
      await data.reloadTask();
    } catch {
      setNotice({ tone: "danger", text: "Остановка не подтверждена. Проверьте состояние задачи в истории." });
    } finally { setBusy(false); }
  }

  const taskState = task ? (task.outcome?.state === "completed" ? "ждёт вашей приёмки" : task.outcome?.state === "budget_blocked" ? "остановлена бюджетом" : task.cancel_requested ? "отменяется" : task.submitted ? "в работе" : "сохранена, не отправлена") : "";

  return (
    <article data-agent={agent.binding_id} className="mb-4 rounded-xl border border-kumo-line bg-kumo-base p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[15px] font-semibold text-kumo-strong">{agent.agent_principal_id}</h2>
          <p className="mt-0.5 mb-0 text-[12px] text-kumo-subtle">Владелец — вы · среда {agentEnvironment(agent)}{managed ? ", управляемый" : ""} · {agent.runtime_id} · {agent.runtime_agent_id}</p>
        </div>
        <StatusBadge tone={agent.revoked ? "neutral" : running ? "info" : "success"}>{agent.revoked ? "Доступ отозван" : running ? "Работает" : "Ожидает"}</StatusBadge>
      </div>
      {notice && <div className="mt-2"><Notice tone={notice.tone}>{notice.text}</Notice></div>}

      <dl className="mt-3 mb-0 grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px] leading-[18px] text-kumo-default max-md:grid-cols-1">
        <dt className="m-0 text-kumo-subtle">Проекты и права</dt>
        <dd className="m-0">
          {agent.revoked ? "Доступ отозван." : agent.document_grants === undefined ? "Права не прочитаны. Обновите подключение." : agent.document_grants.length === 0 ? "Разрешений на документы не выдано." : agent.document_grants.map((g, i) => <div key={i}>{projectName(data.projects,g.project_id)} · {g.node_id ? `узел ${g.node_id}` : "весь проект"} · {g.mode === "write" ? "чтение и черновики" : "чтение"}{rights ? ` · выдано: ${g.granted_to} · ${g.resource_class}` : ""}</div>)}
          <span className="block text-kumo-subtle">Выданные разрешения ограничены текущими правами владельца. Доступ к каждому документу сервер проверяет при обращении.</span>
        {agent.runtime_id !== "workshop" && !agent.revoked && data.identity?.capabilities?.includes('principal.manage') && <>
          <Button size="sm" variant="secondary" onClick={()=>setEditingScope(!editingScope)}>Настроить доступ к проекту</Button>
          {editingScope && <AgentProjectAccess agent={agent} data={data} />}
        </>}
        {agent.runtime_id === "workshop" && !agent.revoked && <><Button size="sm" variant="secondary" onClick={()=>setEditingScope(!editingScope)}>Изменить проекты агента</Button>{editingScope && <WorkshopScope agent={agent} data={data} onDone={()=>setEditingScope(false)} />}</>}</dd>
        <dt className="m-0 text-kumo-subtle">Память агента</dt>
        <dd className="m-0 flex items-center gap-2">{memory}<Button variant="ghost" size="sm" onClick={() => openLegacy({ kind: "memory" }, "Личная память агента")}>Изменить</Button></dd>
        <dt className="m-0 text-kumo-subtle">Текущие задачи</dt>
        <dd className="m-0 flex items-center gap-2">{task ? `${task.message.slice(0, 100)} — ${taskState}` : "Текущих задач нет"}<Button variant="ghost" size="sm" onClick={() => openLegacy({ kind: "taskHistory" }, "История задач агента")}>История задач</Button></dd>
        <dt className="m-0 text-kumo-subtle">Бюджет</dt>
        <dd className="m-0 flex items-center gap-2">{usage}<Button variant="ghost" size="sm" onClick={() => openLegacy({ kind: "budget" }, "Бюджет проекта")}>Бюджет проекта</Button></dd>
        {managed && <>
          <dt className="m-0 text-kumo-subtle">Каналы</dt>
          <dd className="m-0 flex items-center gap-2">Telegram: {telegram}<Button variant="ghost" size="sm" onClick={() => openLegacy({ kind: "telegram" }, "Telegram")}>Настроить</Button></dd>
        </>}
        <dt className="m-0 text-kumo-subtle">Замещение</dt>
        <dd className="m-0 flex flex-wrap items-center gap-2">
          {absences.length ? absences.map(a => `${a.managed_binding_id === agent.binding_id ? "замещает" : "замещается"} в проекте «${projectName(data.projects, a.project_id)}» до ${new Date(a.ends_at).toLocaleString("ru-RU")}`).join("; ") : "Выключено"}
          <Select aria-label="Проект замещения" value={absenceProject} onChange={e => setAbsenceProject(e.target.value)}>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Button variant="ghost" size="sm" disabled={!absenceProject} onClick={() => openLegacy({ kind: "absence", project: absenceProject }, "Замещение на время отсутствия")}>Настроить замещение</Button>
        </dd>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-kumo-line pt-3">
        {managed ? (
          <>
            <Button variant="primary" size="sm" disabled={agent.revoked} onClick={() => openLegacy({ kind: "agentTask" }, "Задача агенту")}>Поставить задачу</Button>
            <Button variant="secondary" size="sm" disabled={agent.revoked} onClick={() => openLegacy({ kind: "taskHistory" }, "История задач агента")}>Внести корректировку</Button>
            <Button variant="secondary" size="sm" disabled={!running || busy} onClick={() => void stop()}>Остановить выполнение</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={() => openLegacy({ kind: "operationAudit" }, "Журнал операций")}>Журнал обращений</Button>
            <Button variant="secondary" size="sm" onClick={() => setRights(!rights)}>Выданные права</Button>
          </>
        )}
        <Button variant="secondary" size="sm" onClick={() => openLegacy({ kind: "engagement", binding: agent.binding_id, name: agent.agent_principal_id }, "Разрешения на привлечение")}>Кто может привлекать</Button>
        <div className="flex-1" />
        {!agent.revoked && !confirming && <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(true)}>Отозвать доступ</Button>}
        {!agent.revoked && confirming && <>
          <span className="text-[12px] text-kumo-subtle">Отозвать доступ этого агента к Mnemos?</span>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void revoke()}>Подтвердить отзыв</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>Отмена</Button>
        </>}
      </div>
      <p className="mt-2 mb-0 text-[12px] text-kumo-subtle">
        {managed
          ? "Управляемый агент AgenticOS: поставить задачу, внести корректировку по результату, остановить выполнение, отозвать доступ. Отзыв останавливает и связанные задачи."
          : "Собственный Claude Code / Codex: доступны только возможности подключения — отозвать доступ, журнал обращений, выданные права. Отзыв прекращает доступ к Mnemos, но не останавливает внешний процесс."}
      </p>
    </article>
  );
}

/** Выдача управляемого агента: заявка с устойчивым request_id, повтор не создаёт второго агента. */
function ProvisionPanel({ onDone }: { onDone: () => void }) {
  const ui = useUi();
  const saved = useLoad(() => ui.managedAgentRequest(), "Сохранённая заявка не прочитана: проверьте сессию.", [ui]);
  const [request, setRequest] = useState<ManagedAgentRequest | null | undefined>(undefined);
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = request === undefined ? saved.value : request;

  async function run(action: () => Promise<ManagedAgentRequest | null>) {
    setBusy(true); setError("");
    try { setRequest(await action()); }
    catch { setError("Результат не подтверждён. Сохранённая заявка останется доступна для повтора: обновите вкладку."); }
    finally { setBusy(false); }
  }

  return (
    <Block title="Выдать агента" count={undefined}>
      {saved.error && <Notice tone="danger">{saved.error}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {current ? (
        <div className="text-[13px] leading-[18px] text-kumo-default">
          <p className="m-0">Шаблон: {current.template_id} · заявка {current.request_id}</p>
          {current.result ? (
            <>
              <p className="mt-1 mb-2">Агент подготовлен: {current.result.agent_principal_id}. Права на документы назначаются отдельно.</p>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(async () => { await ui.finishManagedAgentRequest(current.request_id); onDone(); return null; })}>Новая заявка</Button>
            </>
          ) : (
            <>
              <p className="mt-1 mb-2">Заявка сохранена. При неизвестном результате повтор использует ту же заявку и не создаёт второго агента.</p>
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void run(() => ui.submitManagedAgent(current.request_id))}>Выполнить выдачу</Button>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <TextInput aria-label="ID разрешённого шаблона AgenticOS" placeholder="ID разрешённого шаблона AgenticOS" maxLength={255} value={template} onChange={e => setTemplate(e.target.value)} disabled={busy || saved.loading} />
          <Button variant="primary" size="sm" disabled={busy || saved.loading || !template.trim()} onClick={() => void run(() => ui.prepareManagedAgent(template.trim()))}>Подготовить заявку</Button>
        </div>
      )}
    </Block>
  );
}

function WorkshopScope({agent,data,onDone}:{agent:AgentConnection;data:MemoryData;onDone():void}) {
 const ui=useUi();const [selected,setSelected]=useState<string[]>([]);const [error,setError]=useState("");const [busy,setBusy]=useState(false);
 const scope=useLoad(async()=>{const result=await ui.readWorkshopAgentScope(agent.binding_id);setSelected(result.project_ids);return result},"Область доступа не прочитана.",[ui,agent.binding_id]);
 const projects=[...data.projects.map(p=>({id:p.id,name:p.name})),...(scope.value?.project_ids??[]).filter(id=>!data.projects.some(p=>p.id===id)).map(id=>({id,name:"Проект больше недоступен: "+id}))];
 return <section aria-label="Проекты агента"><p>Выберите проекты. Сервер ограничит доступ вашими текущими правами. Переподключение не требуется.</p>
 {projects.map(p=><label key={p.id} className="block"><input type="checkbox" checked={selected.includes(p.id)} disabled={busy||scope.loading} onChange={e=>setSelected(ids=>e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/>{p.name}</label>)}
 {(error||scope.error)&&<Notice tone="danger">{error||scope.error}</Notice>}
 <Button disabled={busy||!scope.value||!selected.length} onClick={async()=>{if(!scope.value||busy)return;setBusy(true);try{await ui.updateWorkshopAgentScope(agent.binding_id,scope.value.project_ids,selected);await data.reloadConnections();onDone()}catch{setError("Доступ не обновлён: могли измениться права или проекты. Перечитайте область доступа.");await scope.reload()}finally{setBusy(false)}}}>Сохранить доступ</Button>
 <Button disabled={busy} onClick={onDone}>Отмена</Button><p>Чтобы отключить все проекты, отзовите доступ агента.</p></section>;
}

function ExternalAgentDialog({open, onClose, data}: {open: boolean; onClose: () => void; data: MemoryData}) {
  return <Dialog.Root open={open} onOpenChange={value => {if (!value) onClose();}}>
    <Dialog size="lg" className="!w-[min(640px,calc(100vw-32px))] max-h-[85dvh] overflow-y-auto bg-kumo-base p-6">
      <Dialog.Title className="text-lg font-semibold">Подключить своего агента</Dialog.Title>
      <Dialog.Description className="mt-2 text-sm text-kumo-subtle">Подключите Codex или Claude Code к выбранной организации Mnemos.</Dialog.Description>
      {open && <ExternalAgentSetup data={data} />}
      <div className="mt-5 flex justify-end"><Dialog.Close render={props => <Button {...props}>Закрыть</Button>} /></div>
    </Dialog>
  </Dialog.Root>;
}

function ExternalAgentSetup({data}: {data: MemoryData}) {
  const ui = useUi();
  const setup = useLoad(() => ui.externalAgentSetup(), "Не удалось прочитать настройки подключения. Обновите вход в организацию.", [ui]);
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
    {!config && !setup.error && <p>Загрузка настроек…</p>}
    {config && <>
      <p className="font-medium">1. Выполните команды в своём терминале</p>
      <textarea aria-label="Команды подключения" readOnly value={command} onFocus={event => event.target.select()} className="w-full min-h-32 resize-y rounded-lg border border-kumo-line bg-kumo-elevated p-3 font-mono text-xs leading-6" />
      <p className="text-kumo-subtle">Команды рассчитаны на установленный {client === 'codex' ? 'Codex CLI' : 'Claude Code'}. Нажмите на поле, чтобы выделить и скопировать их.</p>
      <p className="font-medium">2. Подтвердите подключение в браузере</p>
      <p className="text-kumo-subtle">Клиент откроет Mnemos. Выберите организацию, проверьте запрошенные операции и нажмите «Подключить агента». Затем вернитесь в клиент.</p>
      <p className="font-medium">3. Выдайте доступ к проектам</p>
      <p className="text-kumo-subtle">После подключения обновите список агентов и нажмите «Настроить доступ к проекту» в карточке нового агента. Если у вас нет права выдачи доступа, это делает администратор организации. Чтение и работа с черновиками выдаются отдельно; публикация проходит через согласование.</p>
      <Button disabled={checking} onClick={async () => {setChecking(true);setNotice('');try {await data.reloadConnections();setNotice('Список обновлён. Закройте окно и выберите нового агента.');} catch {setNotice('Список не прочитан. Повторите обновление.');} finally {setChecking(false);}}}>{checking ? 'Обновление…' : 'Обновить список агентов'}</Button>
      {notice && <Notice>{notice}</Notice>}
    </>}
  </div>;
}

function AgentProjectAccess({agent,data}: {agent: AgentConnection; data: MemoryData}) {
  const ui=useUi(); const [project,setProject]=useState(data.projects[0]?.id ?? '');
  const [mode,setMode]=useState<'read'|'write'>('read'); const [busy,setBusy]=useState(false); const [notice,setNotice]=useState('');
  async function apply(enabled: boolean) {
    setBusy(true);setNotice('');
    try {await ui.setAgentProjectRight(agent.agent_principal_id,project,mode,enabled);await data.reloadConnections();setNotice(enabled?'Право выдано.':'Выбранное право снято.');}
    catch {setNotice('Изменение не подтверждено. Обновите список и проверьте свои полномочия.');}
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
