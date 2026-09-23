import type { AccountStorage } from "./account-session.ts";
import type { AgentCredential, WorkshopAgentConnection } from "./mnemos-api.ts";
import type { GitProjectRepositoryPage } from "./git-connections.ts";
import { workspaceProgress, type WorkspaceEvent, type WorkspaceProgress } from "./workspace-steps.ts";

export type WorkspaceState = "starting" | "running" | "idle" | "stopped" | "failed";
const STATES: readonly WorkspaceState[] = ["starting", "running", "idle", "stopped", "failed"];
/** Ключ агента живёт 15 минут; служба останавливает задачу без обновления. */
export const WORKSPACE_REFRESH_MS = 10 * 60_000;
const EVENTS_WINDOW_MS = 800;
const MAX_EVENT_BYTES = 8 << 20;
const MAX_TASKS = 50;
const MAX_PROMPT = 16_000;
const INDEX = "workspaceTasks";
const RECORD = "workspaceTask:";

/** Ответ контрольного API службы mnemos-workspace. */
export interface RemoteTask { task_id: string; binding_id: string; project_id: string; branch: string; title: string; state: WorkspaceState; reason?: string; cost_usd: number; created_at: string; session_id?: string }
export interface WorkspaceTaskView {
  task_id: string; project_id: string; connection_id: string; repository_id: string; repository_name: string;
  title: string; prompt: string; branch: string; state: WorkspaceState; reason: string; cost_usd: number; created_at: string; finished_at: string;
}
export interface WorkspaceTaskDetails extends WorkspaceProgress { task: WorkspaceTaskView }
export class WorkspaceError extends Error {
  constructor(readonly code: "unconfigured" | "scope" | "repository" | "unavailable" | "not_found" | "invalid", message: string) { super(message); }
}

export interface WorkspaceControl {
  create(input: { binding_id: string; agent_credential: string; project_id: string; connection_id: string; repository_id: string; prompt: string; title: string }): Promise<RemoteTask>;
  status(id: string): Promise<RemoteTask>;
  credential(id: string, token: string): Promise<void>;
  events(id: string): Promise<WorkspaceEvent[]>;
  message(id: string, text: string): Promise<void>;
  abort(id: string): Promise<void>;
}

function remoteTask(value: unknown): RemoteTask {
  const v = value as RemoteTask;
  if (!v || typeof v.task_id !== "string" || !/^[0-9a-f]{8,64}$/.test(v.task_id) || !STATES.includes(v.state) || typeof v.branch !== "string" || typeof v.cost_usd !== "number" || !Number.isFinite(v.cost_usd) || typeof v.created_at !== "string") throw new WorkspaceError("unavailable", "Служба рабочих мест ответила неожиданно.");
  return v;
}

/** Контрольный API: сервисный токен есть только у серверной части CloudflareOS. */
export class WorkspaceClient implements WorkspaceControl {
  #origin: string; #token: string; #fetch: typeof fetch; #window: number;
  constructor(origin: string, token: string, fetcher: typeof fetch = fetch, eventsWindowMs = EVENTS_WINDOW_MS) {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin.replace(/\/$/, "") || !token) throw new WorkspaceError("unconfigured", "Рабочие места агентов не настроены.");
    this.#origin = url.origin; this.#token = token; this.#fetch = fetcher; this.#window = eventsWindowMs;
  }
  async #call(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(this.#origin + path, { method, signal, headers: { Authorization: `Bearer ${this.#token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw error;
      throw new WorkspaceError("unavailable", "Служба рабочих мест недоступна.");
    }
    if (response.status === 404) throw new WorkspaceError("not_found", "Задача не найдена в службе рабочих мест.");
    if (response.status === 409 || response.status === 429 || response.status === 503) throw new WorkspaceError("unavailable", "Сейчас все рабочие места заняты. Повторите позже.");
    if (!response.ok) throw new WorkspaceError("unavailable", "Служба рабочих мест отказала.");
    return response;
  }
  async create(input: Parameters<WorkspaceControl["create"]>[0]) { return remoteTask(await (await this.#call("/v1/workspace/tasks", "POST", input)).json()); }
  async status(id: string) { return remoteTask(await (await this.#call(`/v1/workspace/tasks/${encodeURIComponent(id)}`, "GET")).json()); }
  async credential(id: string, token: string) { await this.#call(`/v1/workspace/tasks/${encodeURIComponent(id)}/credential`, "PUT", { agent_credential: token }); }
  async message(id: string, text: string) { await this.#call(`/v1/workspace/tasks/${encodeURIComponent(id)}/messages`, "POST", { text }); }
  async abort(id: string) { await this.#call(`/v1/workspace/tasks/${encodeURIComponent(id)}/abort`, "POST"); }
  /** Служба повторяет сохранённый хвост при каждом подключении, поэтому хватает короткого окна чтения. */
  async events(id: string): Promise<WorkspaceEvent[]> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    // Окно закрывает и запрос, и чтение тела: поток событий службы сам не заканчивается.
    const timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => {}); }, this.#window);
    const out: WorkspaceEvent[] = [];
    let buffer = "", total = 0;
    try {
      const response = await this.#call(`/v1/workspace/tasks/${encodeURIComponent(id)}/events`, "GET", undefined, controller.signal);
      reader = response.body?.getReader();
      if (!reader) return out;
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_EVENT_BYTES) { controller.abort(); void reader.cancel().catch(() => {}); break; }
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
          const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
          if (!data) continue;
          try {
            const event = JSON.parse(data) as WorkspaceEvent;
            if (typeof event.seq === "number" && typeof event.type === "string") out.push({ seq: event.seq, type: event.type, data: event.data });
          } catch { /* повреждённый блок пропускается, следующий опрос повторит хвост */ }
        }
      }
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") throw error;
    } finally { clearTimeout(timer); }
    return out;
  }
}

/** Права человека, через которые выдаются ключ агента и проверяется проект. */
export interface WorkspaceHuman {
  issueAgentCredential(binding: string): Promise<AgentCredential>;
  readWorkshopAgentScope(binding: string): Promise<WorkshopAgentConnection>;
  listProjectGitRepositories(project: string): Promise<GitProjectRepositoryPage>;
  dispose(): void;
}
export interface WorkspaceDeps {
  control: WorkspaceControl | null;
  agent(): Promise<{ bindingId: string }>;
  human(): WorkspaceHuman;
  /** Будильник обновления ключа; null — будильник снимается. */
  wake(at: number | null): Promise<void>;
  clock?: () => number;
  refreshEveryMs?: number;
}

function active(state: WorkspaceState) { return state === "starting" || state === "running"; }
function finished(state: WorkspaceState) { return state === "stopped" || state === "failed"; }

/** Задачи агентов пользователя: список по проектам, запуск, ход работы, обновление ключа агента. */
export class WorkspaceTasks {
  #kv: AccountStorage; #deps: WorkspaceDeps; #clock: () => number; #every: number;
  constructor(kv: AccountStorage, deps: WorkspaceDeps) {
    this.#kv = kv; this.#deps = deps; this.#clock = deps.clock ?? Date.now; this.#every = deps.refreshEveryMs ?? WORKSPACE_REFRESH_MS;
  }
  available(): boolean { return this.#deps.control !== null; }
  #control(): WorkspaceControl {
    if (!this.#deps.control) throw new WorkspaceError("unconfigured", "Рабочие места агентов не настроены на этой установке.");
    return this.#deps.control;
  }
  #ids(): string[] { return this.#kv.get<string[]>(INDEX) ?? []; }
  #get(id: string): WorkspaceTaskView | undefined { return this.#kv.get<WorkspaceTaskView>(RECORD + id); }
  #own(project: string, id: string): WorkspaceTaskView {
    const task = typeof id === "string" ? this.#get(id) : undefined;
    if (!task || task.project_id !== project) throw new WorkspaceError("not_found", "Задача не найдена.");
    return task;
  }
  #save(task: WorkspaceTaskView) {
    this.#kv.put(RECORD + task.task_id, task);
    const ids = [task.task_id, ...this.#ids().filter(id => id !== task.task_id)];
    for (const old of ids.slice(MAX_TASKS)) this.#kv.delete(RECORD + old);
    this.#kv.put(INDEX, ids.slice(0, MAX_TASKS));
  }
  #apply(task: WorkspaceTaskView, remote: RemoteTask): WorkspaceTaskView {
    const next = { ...task, state: remote.state, reason: remote.reason ?? "", cost_usd: remote.cost_usd, branch: remote.branch || task.branch };
    if (finished(next.state) && !next.finished_at) next.finished_at = new Date(this.#clock()).toISOString();
    this.#save(next);
    return next;
  }
  async #credential(binding: string): Promise<string> {
    const human = this.#deps.human();
    try {
      const credential = await human.issueAgentCredential(binding);
      if (credential.token_type !== "Bearer" || !credential.access_token) throw new WorkspaceError("unavailable", "Ключ агента не выдан.");
      return credential.access_token;
    } finally { human.dispose(); }
  }
  async #arm() {
    const due = this.#ids().map(id => this.#get(id)).some(t => t && active(t.state));
    await this.#deps.wake(due ? this.#clock() + this.#every : null);
  }

  list(project: string): WorkspaceTaskView[] {
    return this.#ids().map(id => this.#get(id)).filter((t): t is WorkspaceTaskView => !!t && t.project_id === project);
  }

  /** Поручает задачу Workshop-агенту человека в репозитории проекта. */
  async start(project: string, connection: string, repository: string, prompt: string): Promise<WorkspaceTaskView> {
    const control = this.#control();
    const body = typeof prompt === "string" ? prompt.trim() : "";
    if (!body || body.length > MAX_PROMPT || [project, connection, repository].some(v => typeof v !== "string" || !v || v.length > 255)) throw new WorkspaceError("invalid", "Опишите задачу для агента.");
    const { bindingId } = await this.#deps.agent();
    const human = this.#deps.human();
    let repositoryName = "";
    try {
      const scope = await human.readWorkshopAgentScope(bindingId);
      if (scope.revoked || !scope.project_ids.includes(project)) throw new WorkspaceError("scope", "У вашего агента нет доступа к этому проекту. Добавьте проект агенту во вкладке «Агенты».");
      const repos = await human.listProjectGitRepositories(project);
      const repo = repos.repositories.find(r => r.enabled && r.connection_id === connection && r.repository_id === repository);
      if (!repo) throw new WorkspaceError("repository", "Репозиторий не подключён к проекту.");
      repositoryName = repo.repository_name;
    } finally { human.dispose(); }
    const token = await this.#credential(bindingId);
    const title = body.split("\n").find(line => line.trim())!.trim().slice(0, 120);
    const remote = await control.create({ binding_id: bindingId, agent_credential: token, project_id: project, connection_id: connection, repository_id: repository, prompt: body, title });
    const task: WorkspaceTaskView = { task_id: remote.task_id, project_id: project, connection_id: connection, repository_id: repository, repository_name: repositoryName, title, prompt: body, branch: remote.branch, state: remote.state, reason: remote.reason ?? "", cost_usd: remote.cost_usd, created_at: remote.created_at, finished_at: "" };
    this.#save(task);
    await this.#arm();
    return task;
  }

  /** Состояние и ход работы; закончившиеся задачи больше не опрашиваются. */
  async read(project: string, id: string): Promise<WorkspaceTaskDetails> {
    let task = this.#own(project, id);
    if (finished(task.state)) return { task, steps: [], answer: "" };
    const control = this.#control();
    try { task = this.#apply(task, await control.status(id)); }
    catch (error) {
      if (!(error instanceof WorkspaceError) || error.code !== "not_found") throw error;
      task = { ...task, state: "stopped", reason: task.reason || "служба рабочих мест больше не знает эту задачу", finished_at: new Date(this.#clock()).toISOString() };
      this.#save(task); await this.#arm();
      return { task, steps: [], answer: "" };
    }
    const progress = workspaceProgress(await control.events(id));
    return { task, ...progress };
  }

  /** Следующее сообщение агенту: ключ обновляется до отправки, будильник снова взводится. */
  async message(project: string, id: string, text: string): Promise<void> {
    const task = this.#own(project, id);
    const body = typeof text === "string" ? text.trim() : "";
    if (!body || body.length > MAX_PROMPT) throw new WorkspaceError("invalid", "Напишите сообщение агенту.");
    if (finished(task.state)) throw new WorkspaceError("not_found", "Задача уже завершена. Поручите новую.");
    const control = this.#control();
    const { bindingId } = await this.#deps.agent();
    await control.credential(id, await this.#credential(bindingId));
    await control.message(id, body);
    this.#save({ ...task, state: "running" });
    await this.#arm();
  }

  async abort(project: string, id: string): Promise<void> {
    const task = this.#own(project, id);
    if (finished(task.state)) return;
    try { await this.#control().abort(id); }
    catch (error) { if (!(error instanceof WorkspaceError) || error.code !== "not_found") throw error; }
    this.#save({ ...task, state: "stopped", reason: "остановлена человеком", finished_at: new Date(this.#clock()).toISOString() });
    await this.#arm();
  }

  /** Будильник: свежий ключ получают только задачи в работе; готовые и остановленные — нет. */
  async refresh(): Promise<void> {
    const control = this.#deps.control;
    if (!control) { await this.#deps.wake(null); return; }
    let bindingId = "";
    for (const id of this.#ids()) {
      let task = this.#get(id);
      if (!task || !active(task.state)) continue;
      try { task = this.#apply(task, await control.status(id)); }
      catch (error) {
        if (error instanceof WorkspaceError && error.code === "not_found") this.#save({ ...task, state: "stopped", reason: "служба рабочих мест больше не знает эту задачу", finished_at: new Date(this.#clock()).toISOString() });
        continue;
      }
      if (!active(task.state)) continue;
      try {
        bindingId ||= (await this.#deps.agent()).bindingId;
        await control.credential(id, await this.#credential(bindingId));
      } catch { /* без свежего ключа служба сама остановит задачу по сроку */ }
    }
    await this.#arm();
  }
}
