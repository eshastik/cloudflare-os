import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog } from "@cloudflare/kumo";
import { CheckCircle, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import type { GitProjectRepository } from "../src/git-connections.ts";
import type { WorkspaceState, WorkspaceTaskDetails, WorkspaceTaskView } from "../src/workspace-tasks.ts";
import type { WorkspaceStep } from "../src/workspace-steps.ts";
import { useUi } from "./host.ts";
import { ActionForm, AdminDetails, Block, EmptyTab, Notice, Row, RowList, RowText, Select, StatusBadge, type BadgeTone } from "./ui.tsx";

/** Опрос хода задачи, пока агент работает. */
export const TASK_POLL_MS = 2000;

const STATE: Record<WorkspaceState, { tone: BadgeTone; label: string }> = {
  starting: { tone: "info", label: "Запускается" },
  running: { tone: "info", label: "В работе" },
  idle: { tone: "success", label: "Готово" },
  stopped: { tone: "neutral", label: "Остановлена" },
  failed: { tone: "danger", label: "Ошибка" },
};
const working = (state: WorkspaceState) => state === "starting" || state === "running";
const repoKey = (r: { connection_id: string; repository_id: string }) => `${r.connection_id}/${r.repository_id}`;

function money(usd: number): string {
  return `$${usd.toFixed(usd >= 1 ? 2 : usd >= 0.01 ? 2 : 3).replace(".", ",")}`;
}
function duration(task: WorkspaceTaskView, now: number): string {
  const end = task.finished_at ? Date.parse(task.finished_at) : now;
  const seconds = Math.max(0, Math.round((end - Date.parse(task.created_at)) / 1000));
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} мин` : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}
function errorText(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  // Сообщения службы и прав уже написаны для человека; технические — заменяются общим текстом.
  return /[а-яё]/i.test(message) && message.length < 300 ? message : fallback;
}

/** Кнопка поручения для шапок вкладок «Код» и «Задачи агентов». */
export function AssignTask({ projectId, repositories, onStarted }: { projectId: string; repositories: GitProjectRepository[] | undefined; onStarted(task: WorkspaceTaskView): void }) {
  const ui = useUi();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void ui.workspaceAvailable().then(value => { if (alive) setAvailable(value); }, () => { if (alive) setAvailable(false); });
    return () => { alive = false; };
  }, [ui]);
  // Пока настройка и репозитории не прочитаны, причину не называем: иначе она была бы неверной.
  const reason = available === false ? "Рабочие места агентов не настроены на этой установке. Обратитесь к администратору." : available && repositories?.length === 0 ? "Подключите к проекту репозиторий, чтобы поручать агенту работу с кодом." : "";
  const list = repositories ?? [];
  return (
    <>
      <span title={reason || undefined} data-reason={reason || undefined} className="inline-flex"><Button size="sm" disabled={!available || list.length === 0} onClick={() => setOpen(true)}>Поручить агенту</Button></span>
      <AssignDialog open={open} onClose={() => setOpen(false)} projectId={projectId} repositories={list} onStarted={task => { setOpen(false); onStarted(task); }} />
    </>
  );
}

function AssignDialog({ open, onClose, projectId, repositories, onStarted }: { open: boolean; onClose(): void; projectId: string; repositories: GitProjectRepository[]; onStarted(task: WorkspaceTaskView): void }) {
  const ui = useUi();
  const [repo, setRepo] = useState(() => repositories[0] ? repoKey(repositories[0]) : "");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = repositories.find(r => repoKey(r) === repo) ?? repositories[0];
  async function submit() {
    if (busy || !prompt.trim() || !selected) return;
    setBusy(true); setError("");
    try {
      const task = await ui.startWorkspaceTask(projectId, selected.connection_id, selected.repository_id, prompt.trim());
      setPrompt("");
      onStarted(task);
    } catch (e) { setError(errorText(e, "Задача не поручена. Проверьте доступ агента к проекту и повторите.")); }
    finally { setBusy(false); }
  }
  return (
    <Dialog.Root open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}>
      <Dialog size="lg" className="!w-[min(640px,calc(100vw-32px))] max-h-[85dvh] overflow-y-auto bg-kumo-base p-6">
        <Dialog.Title className="text-lg font-semibold">Поручить агенту</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm text-kumo-subtle">Агент работает в отдельной копии кода проекта. Основная версия меняется только после вашего решения.</Dialog.Description>
        <ActionForm aria-label="Задача агенту" className="mt-5 grid gap-3 text-sm" onAction={() => void submit()}>
          {repositories.length > 1 && (
            <label className="grid gap-1.5">Код проекта
              <Select aria-label="Репозиторий задачи" value={selected ? repoKey(selected) : ""} onChange={e => setRepo(e.target.value)} disabled={busy}>
                {repositories.map(r => <option key={repoKey(r)} value={repoKey(r)}>{r.repository_name}</option>)}
              </Select>
            </label>
          )}
          <label className="grid gap-1.5">Что сделать
            <textarea aria-label="Текст задачи" rows={6} maxLength={16000} value={prompt} disabled={busy} onChange={e => setPrompt(e.target.value)}
              placeholder="Например: добавь проверку пустого названия проекта и тест на неё"
              className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-base p-2 text-[13px] leading-[18px] text-kumo-default outline-none focus:border-kumo-ring" />
          </label>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Отмена</Button>
            <Button type="button" disabled={busy || !prompt.trim() || !selected} onClick={() => void submit()}>{busy ? "Поручаем…" : "Поручить"}</Button>
          </div>
        </ActionForm>
      </Dialog>
    </Dialog.Root>
  );
}

/** Вкладка «Задачи агентов»: список задач проекта и ход выбранной. */
export default function ProjectTasks({ projectId, repositories, onCompare, admin = false }: { projectId: string; repositories: GitProjectRepository[] | undefined; onCompare(task: WorkspaceTaskView): void; admin?: boolean }) {
  const ui = useUi();
  const [tasks, setTasks] = useState<WorkspaceTaskView[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const load = useCallback(async () => {
    try { setTasks((await ui.listWorkspaceTasks(projectId)).tasks); setError(""); }
    catch { setError("Задачи агентов не прочитаны. Обновите страницу."); }
  }, [ui, projectId]);
  useEffect(() => { void load(); }, [load]);
  const current = tasks?.find(t => t.task_id === selected) ?? tasks?.[0];
  return (
    <div>
      <Block title="Задачи агентов" count={tasks?.length ?? 0}
        actions={<AssignTask projectId={projectId} repositories={repositories} onStarted={task => { setSelected(task.task_id); setTasks(list => [task, ...(list ?? []).filter(t => t.task_id !== task.task_id)]); }} />}>
        {error && <Notice tone="danger">{error}</Notice>}
        {tasks === null && !error && <Notice>Загружаем задачи…</Notice>}
        {tasks?.length === 0 && <EmptyTab description="Здесь появятся задачи, которые вы поручите агентам: ход работы, ответ и изменения в коде." />}
        {tasks && tasks.length > 0 && (
          <RowList>
            {tasks.map(task => (
              <Row key={task.task_id} data-task={task.task_id} className={task.task_id === current?.task_id ? "bg-kumo-tint" : ""}>
                <button type="button" className="min-w-0 flex-1 text-left" aria-current={task.task_id === current?.task_id ? "true" : undefined} onClick={() => setSelected(task.task_id)}>
                  <RowText title={task.title} note={`${task.repository_name} · ${money(task.cost_usd)} · ${duration(task, Date.now())}`} />
                </button>
                <StatusBadge tone={STATE[task.state].tone}>{STATE[task.state].label}</StatusBadge>
              </Row>
            ))}
          </RowList>
        )}
      </Block>
      {current && <TaskDetails key={current.task_id} admin={admin} projectId={projectId} task={current} onChanged={task => setTasks(list => (list ?? []).map(t => t.task_id === task.task_id ? task : t))} onCompare={onCompare} />}
    </div>
  );
}

function TaskDetails({ admin, projectId, task: initial, onChanged, onCompare }: { admin: boolean; projectId: string; task: WorkspaceTaskView; onChanged(task: WorkspaceTaskView): void; onCompare(task: WorkspaceTaskView): void }) {
  const ui = useUi();
  const [details, setDetails] = useState<WorkspaceTaskDetails | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // Опрос перезапускается после действий: сообщение агенту снова переводит задачу в работу.
  const [wake, setWake] = useState(0);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const task = details?.task ?? initial;
  const refresh = useCallback(async (alive: () => boolean) => {
    try {
      const next = await ui.readWorkspaceTask(projectId, initial.task_id);
      if (!alive()) return null;
      // Закончившаяся задача больше не отдаёт шаги; последняя лента остаётся на экране.
      setDetails(previous => next.steps.length || !previous ? next : { ...previous, task: next.task });
      setError("");
      changed.current(next.task);
      return next;
    } catch (e) {
      if (alive()) setError(errorText(e, "Ход задачи не прочитан. Повторим автоматически."));
      return null;
    }
  }, [ui, projectId, initial.task_id]);
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const next = await refresh(() => alive);
      if (alive && (!next || working(next.task.state))) timer = setTimeout(() => void tick(), TASK_POLL_MS);
    };
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [refresh, wake]);

  async function act(run: () => Promise<void>, failure: string) {
    if (busy) return;
    setBusy(true); setError("");
    try { await run(); setWake(n => n + 1); }
    catch (e) { setError(errorText(e, failure)); }
    finally { setBusy(false); }
  }
  function send() {
    const text = message.trim();
    if (text) void act(async () => { await ui.messageWorkspaceTask(projectId, task.task_id, text); setMessage(""); }, "Сообщение не отправлено. Повторите.");
  }
  const finished = task.state === "stopped" || task.state === "failed";
  return (
    <section aria-label="Ход задачи" className="mb-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="m-0 min-w-0 flex-1 truncate text-[15px] font-semibold text-kumo-strong">{task.title}</h2>
        <StatusBadge tone={STATE[task.state].tone}>{STATE[task.state].label}</StatusBadge>
      </div>
      {task.reason && <p className="mt-0 mb-3 text-[12px] text-kumo-subtle">{task.reason}</p>}
      <AdminDetails show={admin} items={[["Задача", task.task_id], ["Ветка", task.branch]]} />
      {error && <div className="mb-2"><Notice tone="danger">{error}</Notice></div>}
      {details && details.steps.length > 0 && (
        <ol aria-label="Шаги агента" className="m-0 mb-4 grid list-none gap-1 p-0">
          {details.steps.map(step => <Step key={step.id} step={step} />)}
        </ol>
      )}
      {!details && !error && <Notice>Загружаем ход работы…</Notice>}
      {details?.answer && (
        <div aria-label="Ответ агента" className="mb-4 max-w-[650px] whitespace-pre-wrap rounded-xl border border-kumo-line bg-kumo-base p-3 text-sm leading-[1.43] text-kumo-default">{details.answer}</div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => onCompare(task)}>Показать изменения</Button>
        {!finished && <Button variant="secondary" size="sm" disabled={busy} onClick={() => void act(() => ui.abortWorkspaceTask(projectId, task.task_id), "Задача не остановлена. Повторите.")}>Остановить</Button>}
      </div>
      {!finished && (
        <ActionForm aria-label="Сообщение агенту" className="mt-3 flex max-w-[650px] gap-2" onAction={send}>
          <input aria-label="Сообщение агенту" value={message} disabled={busy} onChange={e => setMessage(e.target.value)} placeholder="Уточните задачу или попросите доделать"
            className="h-8 min-w-0 flex-1 rounded-lg border border-kumo-line bg-kumo-base px-2 text-[13px] text-kumo-default outline-none focus:border-kumo-ring" />
          <Button type="button" variant="secondary" size="sm" disabled={busy || !message.trim()} onClick={send}>Написать агенту</Button>
        </ActionForm>
      )}
    </section>
  );
}

function Step({ step }: { step: WorkspaceStep }) {
  const icon = step.status === "running" ? <CircleNotch size={14} className="shrink-0 animate-spin text-kumo-info motion-reduce:animate-none" aria-label="выполняется" />
    : step.status === "error" ? <WarningCircle size={14} className="shrink-0 text-kumo-danger" aria-label="ошибка" />
    : <CheckCircle size={14} className="shrink-0 text-kumo-subtle" aria-label="готово" />;
  return <li data-step={step.kind} className="flex items-start gap-2 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default">{icon}<span className="min-w-0 break-words">{step.text}</span></li>;
}
