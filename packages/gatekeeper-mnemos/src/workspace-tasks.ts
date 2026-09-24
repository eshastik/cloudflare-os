import type { AccountStorage } from "./account-session.ts";
import type { AgentCredential, MergeRequestView, WorkshopAgentConnection } from "./mnemos-api.ts";
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
/** Столько репозиториев служба рабочих мест принимает в одну задачу. */
export const MAX_TASK_REPOSITORIES = 5;
const INDEX = "workspaceTasks";
const RECORD = "workspaceTask:";

/** Репозиторий в запросе на задачу; name — имя для человека, из него служба делает папку. */
export interface WorkspaceRepositoryRef { connection_id: string; repository_id: string; name?: string }
/** Ответ контрольного API службы mnemos-workspace. */
export interface RemoteTask { task_id: string; binding_id: string; project_id: string; branch: string; title: string; state: WorkspaceState; reason?: string; cost_usd: number; created_at: string; session_id?: string; repositories?: { connection_id: string; repository_id: string; dir: string }[] }
/** Репозиторий задачи: dir — папка в рабочем месте, repository_name — имя из привязки проекта. */
export interface WorkspaceTaskRepository { connection_id: string; repository_id: string; repository_name: string; dir: string }
/** Запрос на слияние, открытый «Принять»; round — номер нажатия, «Вернуть как было» отменяет весь round. */
export interface WorkspaceTaskMerge { dir: string; connection_id: string; repository_id: string; index: number; head: string; outcome: AcceptOutcome["outcome"]; round: number }
export interface WorkspaceTaskView {
  task_id: string; project_id: string; connection_id: string; repository_id: string; repository_name: string;
  title: string; prompt: string; branch: string; state: WorkspaceState; reason: string; cost_usd: number; created_at: string; finished_at: string;
  /** Все репозитории задачи; у записей до нескольких репозиториев поля нет — там один, из полей выше. */
  repositories?: WorkspaceTaskRepository[];
  /** Последний запрос на слияние по каждому репозиторию. */
  merges?: WorkspaceTaskMerge[];
}
export interface WorkspaceTaskDetails extends WorkspaceProgress { task: WorkspaceTaskView }
export class WorkspaceError extends Error {
  constructor(readonly code: "unconfigured" | "scope" | "repository" | "unavailable" | "not_found" | "invalid" | "no_changes" | "no_repository" | "stopped" | "not_ready", message: string) { super(message); }
}

/** Файл контекста беседы в рабочем месте (путь от /workspace). */
export const WORKSPACE_CONTEXT_FILE = ".mnemos/context.md";
/** Папка файлов, приложенных к беседе (путь от /workspace). */
export const WORKSPACE_ATTACHMENTS_DIR = ".mnemos/attachments/";
/** Пределы службы: один файл и все файлы задачи вместе. */
export const WORKSPACE_FILE_MAX_BYTES = 10 << 20;
export const WORKSPACE_TASK_FILES_MAX_BYTES = 50 << 20;
const MAX_ATTACHMENT_NAME_BYTES = 200;

/** Те же правила пути, что у службы: context.md или attachments/<имя> без «/», «..» и управляющих символов. */
export function validWorkspaceFilePath(path: unknown): path is string {
  if (path === WORKSPACE_CONTEXT_FILE) return true;
  if (typeof path !== "string" || !path.startsWith(WORKSPACE_ATTACHMENTS_DIR)) return false;
  const name = path.slice(WORKSPACE_ATTACHMENTS_DIR.length);
  if (!name || name === "." || name.includes("/") || name.includes("..") || /\p{Cc}/u.test(name)) return false;
  // Одиночный суррогат не кодируется в UTF-8 без замены: служба такое имя не примет.
  if (!name.isWellFormed()) return false;
  return new TextEncoder().encode(name).length <= MAX_ATTACHMENT_NAME_BYTES;
}

function toBase64(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Строгий разбор base64; null — строка не base64 или больше maxBytes после разбора. */
function fromBase64(text: unknown, maxBytes: number): Uint8Array | null {
  if (typeof text !== "string" || text.length % 4 !== 0 || text.length / 4 * 3 > maxBytes + 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  let binary: string;
  try { binary = atob(text); } catch { return null; }
  if (binary.length > maxBytes) return null;
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
export type WorkspaceChangedFile = { path: string; status: "added" | "modified" | "deleted" | "renamed"; additions: number; deletions: number };
/** Изменения одного репозитория задачи; name — имя репозитория для человека. */
export interface WorkspaceRepositoryChanges { dir: string; name: string; connection_id: string; repository_id: string; files: WorkspaceChangedFile[]; diff: string; truncated: boolean }
/** С какого места считаются изменения: с последнего «Принять» или с начала задачи. */
export type WorkspaceChangesSince = "accepted" | "start";
/** Изменения рабочей копии задачи, включая ещё не сохранённые. При нескольких репозиториях
 * пути в files и diff начинаются с папки репозитория; repositories — то же по репозиториям. */
export interface WorkspaceChanges { files: WorkspaceChangedFile[]; diff: string; truncated: boolean; since?: WorkspaceChangesSince; repositories?: WorkspaceRepositoryChanges[] }
export interface WorkspaceEventsPage { events: WorkspaceEvent[]; next: number; state: WorkspaceState }
export type AcceptOutcome = { outcome: "accepted" | "awaiting_approval" | "rejected" | "no_approver" | "reverted"; note: string; mergeRequest?: number };
/** Сохранённая работа: head_sha — первого отправленного репозитория, repositories — всех. */
export interface WorkspacePublished { branch: string; head_sha: string; repositories?: { dir: string; head_sha?: string; pushed: boolean }[] }
/** «Принято до этого места»: откуда дальше считаются изменения каждого репозитория. */
export interface WorkspaceAccepted { repositories: { dir: string; accepted: string; head: string }[] }

/** Имя репозитория для человека: последняя часть пути без «.git» («org/site.git» → «site»). */
export function repositoryTitle(name: string, fallback = ""): string {
  const last = (name ?? "").trim().replace(/\/+$/, "").split("/").pop() ?? "";
  return last.replace(/\.git$/i, "").trim() || fallback;
}

/** Отказы Mnemos по коду — словами для человека. */
const GIT_FAILURE_NOTES: Record<string, string> = {
  "git.merge.stale": "Агент изменил результат после вашего просмотра — проверьте снова.",
  "git.merge.not_ready": "Изменения ещё не готовы к принятию — попробуйте через минуту.",
  "git.merge.not_responsible": "Согласовать эти изменения может только ответственный за проект.",
  "git.merge.not_approved": "Изменения ещё не согласованы.",
  "git.merge.revert_conflict": "Файл уже изменили после принятия — вернуть автоматически нельзя.",
  "git.merge.revert_unsupported": "Эти изменения нельзя вернуть автоматически.",
  "git.unavailable": "Хранилище кода сейчас недоступно — попробуйте позже.",
};
function gitFailureCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}
/** Понятная человеку ошибка вместо «Mnemos request failed» для известных отказов. */
function humanGitError(error: unknown): unknown {
  const note = GIT_FAILURE_NOTES[gitFailureCode(error) ?? ""];
  return note ? new Error(note) : error;
}

export interface WorkspaceControl {
  /** repositories — до пяти, пусто — задача без репозитория; agent_name — короткое имя агента для ветки. */
  create(input: { binding_id: string; agent_credential: string; project_id: string; repositories: WorkspaceRepositoryRef[]; agent_name?: string; prompt: string; title: string }): Promise<RemoteTask>;
  status(id: string): Promise<RemoteTask>;
  credential(id: string, token: string): Promise<void>;
  events(id: string): Promise<WorkspaceEvent[]>;
  message(id: string, text: string): Promise<void>;
  abort(id: string): Promise<void>;
  /** Остановить текущий ответ агента; задача остаётся и принимает следующее сообщение. */
  interrupt(id: string): Promise<void>;
  /** Долгий опрос событий после after, без повторов. */
  eventsAfter(id: string, after: number, waitMs: number): Promise<WorkspaceEventsPage>;
  changes(id: string, since?: WorkspaceChangesSince): Promise<WorkspaceChanges>;
  /** «Принято до этого места»: изменения дальше считаются от текущего состояния. В ветку ничего не пишется. */
  accept(id: string): Promise<WorkspaceAccepted>;
  /** Сохранить работу: коммит рабочей копии и отправка ветки агента. */
  publish(id: string, message: string): Promise<WorkspacePublished>;
  /** Положить файл в /workspace/.mnemos задачи (вне репозиториев). not_ready — задача ещё запускается или уже остановлена. */
  putFile(id: string, path: string, content: Uint8Array): Promise<void>;
}

function remoteTask(value: unknown): RemoteTask {
  const v = value as RemoteTask;
  if (!v || typeof v.task_id !== "string" || !/^[0-9a-f]{8,64}$/.test(v.task_id) || !STATES.includes(v.state) || typeof v.branch !== "string" || typeof v.cost_usd !== "number" || !Number.isFinite(v.cost_usd) || typeof v.created_at !== "string") throw new WorkspaceError("unavailable", "Служба рабочих мест ответила неожиданно.");
  return v;
}

const FILE_STATUSES = ["added", "modified", "deleted", "renamed"];
function changedFiles(files: unknown[]): WorkspaceChangedFile[] {
  return (files as Partial<WorkspaceChangedFile>[])
    .filter(f => f && typeof f.path === "string" && FILE_STATUSES.includes(f.status as string))
    .map(f => ({ path: f.path!, status: f.status!, additions: Number.isSafeInteger(f.additions) ? f.additions! : 0, deletions: Number.isSafeInteger(f.deletions) ? f.deletions! : 0 }));
}

/** Контрольный API: сервисный токен есть только у серверной части CloudflareOS. */
export class WorkspaceClient implements WorkspaceControl {
  #origin: string; #token: string; #fetch: typeof fetch; #window: number;
  constructor(origin: string, token: string, fetcher: typeof fetch = fetch, eventsWindowMs = EVENTS_WINDOW_MS) {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin.replace(/\/$/, "") || !token) throw new WorkspaceError("unconfigured", "Рабочие места агентов не настроены.");
    // Рантайм Workers бросает «Illegal invocation», если fetch вызвать с this клиента.
    this.#origin = url.origin; this.#token = token; this.#fetch = fetcher.bind(globalThis); this.#window = eventsWindowMs;
  }
  /** conflict — чем заменить ответ 409; функция получает код ошибки службы из тела ответа.
   * failure — чем заменить 502, invalid — 400. */
  async #call(path: string, method: string, body?: unknown, signal?: AbortSignal, conflict?: WorkspaceError | ((code: string) => WorkspaceError), failure?: WorkspaceError, invalid?: WorkspaceError): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(this.#origin + path, { method, signal, headers: { Authorization: `Bearer ${this.#token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw error;
      throw new WorkspaceError("unavailable", "Служба рабочих мест недоступна.");
    }
    if (response.status === 404) throw new WorkspaceError("not_found", "Задача не найдена в службе рабочих мест.");
    if (response.status === 400 && invalid) throw invalid;
    if (response.status === 409 && conflict) {
      if (conflict instanceof WorkspaceError) throw conflict;
      let code = "";
      try { const value = await response.json() as { error?: unknown }; code = typeof value?.error === "string" ? value.error : ""; } catch { /* тело без кода */ }
      throw conflict(code);
    }
    if (response.status === 409 || response.status === 429 || response.status === 503) throw new WorkspaceError("unavailable", "Сейчас все рабочие места заняты. Повторите позже.");
    if (response.status === 502 && failure) throw failure;
    if (!response.ok) throw new WorkspaceError("unavailable", "Служба рабочих мест отказала.");
    return response;
  }
  async create(input: Parameters<WorkspaceControl["create"]>[0]) { return remoteTask(await (await this.#call("/v1/workspace/tasks", "POST", input)).json()); }
  async status(id: string) { return remoteTask(await (await this.#call(`/v1/workspace/tasks/${encodeURIComponent(id)}`, "GET")).json()); }
  async credential(id: string, token: string) { await this.#call(`/v1/workspace/tasks/${encodeURIComponent(id)}/credential`, "PUT", { agent_credential: token }); }
  async message(id: string, text: string) { await this.#call(`/v1/workspace/tasks/${encodeURIComponent(id)}/messages`, "POST", { text }); }
  async abort(id: string) { await this.#call(`/v1/workspace/tasks/${encodeURIComponent(id)}/abort`, "POST"); }
  async putFile(id: string, path: string, content: Uint8Array) {
    if (!validWorkspaceFilePath(path)) throw new WorkspaceError("invalid", "Недопустимое имя файла для рабочего места.");
    if (!(content instanceof Uint8Array) || content.byteLength > WORKSPACE_FILE_MAX_BYTES) throw new WorkspaceError("invalid", "Файл больше 10 МиБ.");
    await this.#call(`/v1/workspace/tasks/${encodeURIComponent(id)}/files`, "PUT", { path, content_base64: toBase64(content) }, undefined,
      new WorkspaceError("not_ready", "Рабочее место сейчас не принимает файлы."),
      new WorkspaceError("unavailable", "Файл не записан в рабочее место."),
      new WorkspaceError("invalid", "Служба рабочих мест не приняла файл: путь или размер."));
  }
  async interrupt(id: string) {
    await this.#call(`/v1/workspace/tasks/${encodeURIComponent(id)}/interrupt`, "POST", undefined, undefined,
      new WorkspaceError("stopped", "Агент сейчас не работает — останавливать нечего."),
      new WorkspaceError("unavailable", "Агент не остановился. Попробуйте ещё раз."));
  }
  async accept(id: string): Promise<WorkspaceAccepted> {
    const value = await (await this.#call(`/v1/workspace/tasks/${encodeURIComponent(id)}/accept`, "POST", undefined, undefined,
      code => code === "no_repository" ? new WorkspaceError("no_repository", "У этой работы нет подключённого кода.") : new WorkspaceError("stopped", "Работа с кодом уже остановлена."))).json() as { repositories?: unknown };
    if (!Array.isArray(value?.repositories)) throw new WorkspaceError("unavailable", "Служба рабочих мест ответила неожиданно.");
    const repositories = (value.repositories as { dir?: unknown; accepted?: unknown; head?: unknown }[])
      .filter(r => r && typeof r.dir === "string" && typeof r.accepted === "string" && typeof r.head === "string")
      .map(r => ({ dir: r.dir as string, accepted: r.accepted as string, head: r.head as string }));
    return { repositories };
  }
  async eventsAfter(id: string, after: number, waitMs: number): Promise<WorkspaceEventsPage> {
    if (!Number.isSafeInteger(after) || after < 0) throw new WorkspaceError("invalid", "Неверный курсор событий.");
    const wait = Math.max(0, Math.min(30_000, Math.floor(waitMs)));
    const value = await (await this.#call(`/v1/workspace/tasks/${encodeURIComponent(id)}/events?after=${after}&wait=${wait}`, "GET")).json() as { events?: unknown; next?: unknown; state?: unknown };
    if (!Array.isArray(value.events) || !STATES.includes(value.state as WorkspaceState) || typeof value.next !== "number") throw new WorkspaceError("unavailable", "Служба рабочих мест ответила неожиданно.");
    const events: WorkspaceEvent[] = [];
    for (const raw of value.events as { seq?: unknown; type?: unknown; properties?: unknown; data?: unknown }[]) {
      if (typeof raw?.seq === "number" && Number.isSafeInteger(raw.seq) && typeof raw.type === "string") events.push({ seq: raw.seq, type: raw.type, data: raw.properties ?? raw.data });
    }
    return { events, next: value.next, state: value.state as WorkspaceState };
  }
  async changes(id: string, since?: WorkspaceChangesSince): Promise<WorkspaceChanges> {
    if (since !== undefined && since !== "accepted" && since !== "start") throw new WorkspaceError("invalid", "Неизвестно, с какого места показывать изменения.");
    const query = since === "start" ? "?since=start" : "";
    const value = await (await this.#call(`/v1/workspace/tasks/${encodeURIComponent(id)}/changes${query}`, "GET")).json() as WorkspaceChanges & { repositories?: unknown };
    if (!value || !Array.isArray(value.files) || typeof value.diff !== "string") throw new WorkspaceError("unavailable", "Служба рабочих мест ответила неожиданно.");
    const out: WorkspaceChanges = { files: changedFiles(value.files), diff: value.diff, truncated: value.truncated === true };
    if (value.since === "accepted" || value.since === "start") out.since = value.since;
    if (Array.isArray(value.repositories)) {
      out.repositories = (value.repositories as Partial<WorkspaceRepositoryChanges>[])
        .filter(r => r && typeof r.dir === "string" && r.dir && Array.isArray(r.files) && typeof r.diff === "string")
        .map(r => ({ dir: r.dir!, name: r.dir!, connection_id: typeof r.connection_id === "string" ? r.connection_id : "", repository_id: typeof r.repository_id === "string" ? r.repository_id : "", files: changedFiles(r.files!), diff: r.diff!, truncated: r.truncated === true }));
    }
    return out;
  }
  async publish(id: string, message: string): Promise<WorkspacePublished> {
    const value = await (await this.#call(`/v1/workspace/tasks/${encodeURIComponent(id)}/publish`, "POST", { message }, undefined,
      code => code === "no_repository" ? new WorkspaceError("no_repository", "У этой работы нет подключённого кода.") : new WorkspaceError("no_changes", "Изменений нет."))).json() as { branch?: unknown; head_sha?: unknown; repositories?: unknown };
    if (typeof value.branch !== "string" || !value.branch || typeof value.head_sha !== "string" || !value.head_sha) throw new WorkspaceError("unavailable", "Служба рабочих мест ответила неожиданно.");
    const out: WorkspacePublished = { branch: value.branch, head_sha: value.head_sha };
    if (Array.isArray(value.repositories)) {
      out.repositories = (value.repositories as { dir?: unknown; head_sha?: unknown; pushed?: unknown }[])
        .filter(r => r && typeof r.dir === "string")
        .map(r => ({ dir: r.dir as string, pushed: r.pushed === true, ...(typeof r.head_sha === "string" && r.head_sha ? { head_sha: r.head_sha } : {}) }));
    }
    return out;
  }
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
  /** Агент наследует права человека: область расширяется от его имени (не шире его прав). */
  updateWorkshopAgentScope(binding: string, expected: string[], projects: string[]): Promise<WorkshopAgentConnection>;
  openMergeRequest?(project: string, connection: string, repository: string, head: string, title: string, body: string): Promise<MergeRequestView>;
  acceptMergeRequest?(project: string, connection: string, repository: string, index: number, expectedHead: string): Promise<MergeRequestView>;
  revertMergeRequest?(project: string, connection: string, repository: string, index: number): Promise<MergeRequestView>;
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
    return (await this.startTask(project, connection, repository, prompt)).task;
  }

  /** То же, что start; scopeExtended — проект добавлен в область агента этим вызовом.
   * allRepositories — кроме указанного, взять остальные включённые репозитории проекта (всего до пяти);
   * agentName — короткое имя агента для ветки (агент беседы — «chat»). */
  async startTask(project: string, connection: string, repository: string, prompt: string, options: { agentName?: string; allRepositories?: boolean } = {}): Promise<{ task: WorkspaceTaskView; scopeExtended: boolean }> {
    const control = this.#control();
    const body = typeof prompt === "string" ? prompt.trim() : "";
    if (!body || body.length > MAX_PROMPT || [project, connection, repository].some(v => typeof v !== "string" || !v || v.length > 255)) throw new WorkspaceError("invalid", "Опишите задачу для агента.");
    const agentName = typeof options.agentName === "string" ? options.agentName.trim().slice(0, 40) : "";
    const { bindingId } = await this.#deps.agent();
    const human = this.#deps.human();
    let chosen: { connection_id: string; repository_id: string; repository_name: string }[] = [];
    let scopeExtended = false;
    try {
      const scope = await human.readWorkshopAgentScope(bindingId);
      if (scope.revoked) throw new WorkspaceError("scope", "Ваш агент отключён. Подключите его заново во вкладке «Агенты».");
      if (!scope.project_ids.includes(project)) {
        // Решение владельца 23.09: агент наследует права человека. Сервер откажет, если у самого
        // человека нет права на проект, — тогда область не меняется.
        try { await human.updateWorkshopAgentScope(bindingId, scope.project_ids, [...scope.project_ids, project]); }
        catch { throw new WorkspaceError("scope", "Не удалось подключить проект агенту: проверьте, есть ли у вас доступ к проекту."); }
        scopeExtended = true;
      }
      const enabled = (await human.listProjectGitRepositories(project)).repositories.filter(r => r.enabled);
      const repo = enabled.find(r => r.connection_id === connection && r.repository_id === repository);
      if (!repo) throw new WorkspaceError("repository", "Репозиторий не подключён к проекту.");
      // Указанный репозиторий идёт первым: его папка и запрос на слияние — основные для задачи.
      chosen = [repo, ...(options.allRepositories ? enabled.filter(r => r !== repo) : [])].slice(0, MAX_TASK_REPOSITORIES)
        .map(r => ({ connection_id: r.connection_id, repository_id: r.repository_id, repository_name: r.repository_name }));
    } finally { human.dispose(); }
    const token = await this.#credential(bindingId);
    const title = body.split("\n").find(line => line.trim())!.trim().slice(0, 120);
    const repositories: WorkspaceRepositoryRef[] = chosen.map(r => {
      const name = repositoryTitle(r.repository_name);
      return { connection_id: r.connection_id, repository_id: r.repository_id, ...(name ? { name } : {}) };
    });
    const remote = await control.create({ binding_id: bindingId, agent_credential: token, project_id: project, repositories, ...(agentName ? { agent_name: agentName } : {}), prompt: body, title });
    const dirs = Array.isArray(remote.repositories) ? remote.repositories : [];
    const taskRepos = chosen.map(r => ({ ...r, dir: dirs.find(d => d && d.connection_id === r.connection_id && d.repository_id === r.repository_id && typeof d.dir === "string")?.dir ?? "" }));
    const task: WorkspaceTaskView = { task_id: remote.task_id, project_id: project, connection_id: connection, repository_id: repository, repository_name: chosen[0].repository_name, title, prompt: body, branch: remote.branch, state: remote.state, reason: remote.reason ?? "", cost_usd: remote.cost_usd, created_at: remote.created_at, finished_at: "", repositories: taskRepos };
    this.#save(task);
    await this.#arm();
    return { task, scopeExtended };
  }

  /** События задачи после after; состояние задачи обновляется по ответу службы. */
  async events(project: string, id: string, after: number, waitMs: number): Promise<WorkspaceEventsPage> {
    let task = this.#own(project, id);
    if (finished(task.state)) return { events: [], next: after, state: task.state };
    let page: WorkspaceEventsPage;
    try { page = await this.#control().eventsAfter(id, after, waitMs); }
    catch (error) {
      if (!(error instanceof WorkspaceError) || error.code !== "not_found") throw error;
      task = { ...task, state: "stopped", reason: task.reason || "служба рабочих мест больше не знает эту задачу", finished_at: new Date(this.#clock()).toISOString() };
      this.#save(task); await this.#arm();
      return { events: [], next: after, state: "stopped" };
    }
    if (page.state !== task.state) {
      task = { ...task, state: page.state };
      if (finished(task.state) && !task.finished_at) task.finished_at = new Date(this.#clock()).toISOString();
      this.#save(task); await this.#arm();
    }
    return page;
  }

  /** Репозитории задачи; у старых записей — один, из полей connection_id/repository_id. */
  #repos(task: WorkspaceTaskView): WorkspaceTaskRepository[] {
    if (task.repositories?.length) return task.repositories;
    return [{ connection_id: task.connection_id, repository_id: task.repository_id, repository_name: task.repository_name, dir: "" }];
  }

  /** Изменения с последнего «Принять» (since="accepted", по умолчанию) или с начала задачи. */
  async changes(project: string, id: string, since?: WorkspaceChangesSince): Promise<WorkspaceChanges> {
    const task = this.#own(project, id);
    const value = await this.#control().changes(id, since);
    if (!value.repositories) return value;
    const repos = this.#repos(task);
    return { ...value, repositories: value.repositories.map(r => {
      const known = repos.find(x => x.dir && x.dir === r.dir) ?? repos.find(x => x.connection_id === r.connection_id && x.repository_id === r.repository_id);
      return { ...r, name: repositoryTitle(known?.repository_name ?? "", r.dir) };
    }) };
  }

  /** «Остановить»: прервать текущий ответ агента; работа с кодом остаётся и принимает следующее сообщение. */
  async interrupt(project: string, id: string): Promise<void> {
    const task = this.#own(project, id);
    if (finished(task.state)) throw new WorkspaceError("stopped", "Работа с кодом уже завершена.");
    try { await this.#control().interrupt(id); }
    catch (error) {
      if (!(error instanceof WorkspaceError) || error.code !== "not_found") throw error;
      this.#save({ ...task, state: "stopped", reason: task.reason || "служба рабочих мест больше не знает эту задачу", finished_at: new Date(this.#clock()).toISOString() });
      await this.#arm();
      throw new WorkspaceError("stopped", "Работа с кодом уже завершена.");
    }
    this.#save({ ...task, state: "idle" });
    await this.#arm();
  }

  /** «Принять»: сохранить работу агента и влить её в проект (или отправить на согласование, если оно включено).
   * При нескольких репозиториях запрос на слияние открывается в каждом, где есть изменения. После
   * принятия служба запоминает место: «Что изменилось» дальше показывает только новое. */
  async accept(project: string, id: string, summary: string): Promise<AcceptOutcome> {
    const task = this.#own(project, id);
    const control = this.#control();
    const title = (summary.split("\n").find(line => line.trim()) ?? task.title).trim().slice(0, 200) || task.title;
    let published: WorkspacePublished;
    try { published = await control.publish(id, title); }
    catch (error) {
      if (error instanceof WorkspaceError && (error.code === "no_changes" || error.code === "no_repository")) return { outcome: "accepted", note: "Изменений нет — принимать нечего." };
      throw error;
    }
    const repos = this.#repos(task);
    const targets = published.repositories?.length
      ? published.repositories.filter(r => r.pushed && r.head_sha).map(r => ({ repo: repos.find(x => x.dir && x.dir === r.dir) ?? (repos.length === 1 ? repos[0] : undefined), head: r.head_sha! }))
      : [{ repo: repos[0], head: published.head_sha }];
    if (targets.some(t => !t.repo)) throw new WorkspaceError("unavailable", "Служба рабочих мест ответила неожиданно.");
    const merges = [...(task.merges ?? [])];
    const round = merges.reduce((max, m) => Math.max(max, m.round), 0) + 1;
    const results: { name: string; outcome: AcceptOutcome["outcome"]; index: number; responsible: string[] }[] = [];
    const remember = (repo: WorkspaceTaskRepository, head: string, index: number, outcome: AcceptOutcome["outcome"]) => {
      const at = merges.findIndex(m => m.connection_id === repo.connection_id && m.repository_id === repo.repository_id);
      const entry: WorkspaceTaskMerge = { dir: repo.dir, connection_id: repo.connection_id, repository_id: repo.repository_id, index, head, outcome, round };
      if (at >= 0) merges[at] = entry; else merges.push(entry);
    };
    const human = this.#deps.human();
    try {
      if (!human.openMergeRequest || !human.acceptMergeRequest) throw new WorkspaceError("unavailable", "Принятие изменений недоступно на этой установке.");
      for (const { repo, head } of targets as { repo: WorkspaceTaskRepository; head: string }[]) {
        const known = merges.find(m => m.connection_id === repo.connection_id && m.repository_id === repo.repository_id && m.head === head);
        // Повторное «Принять» без новых изменений в этом репозитории не открывает второй запрос.
        if (known?.outcome === "accepted") continue;
        const name = repositoryTitle(repo.repository_name, repo.dir || "репозиторий");
        try {
          const index = known?.outcome === "awaiting_approval" ? known.index
            : (await human.openMergeRequest(project, repo.connection_id, repo.repository_id, published.branch, title, summary.slice(0, 16_000))).index;
          let outcome: AcceptOutcome["outcome"], responsible: string[] = [];
          try {
            const result = await human.acceptMergeRequest(project, repo.connection_id, repo.repository_id, index, head);
            outcome = result.outcome === "awaiting_approval" ? "awaiting_approval" : result.outcome === "rejected" || result.outcome === "closed" ? "rejected" : result.outcome === "reverted" ? "reverted" : "accepted";
            responsible = (result.responsible ?? []).map(r => r.display_name || r.principal_id).filter(Boolean);
          } catch (error) {
            if (gitFailureCode(error) !== "git.merge.no_approver") throw error;
            outcome = "no_approver";
          }
          remember(repo, head, index, outcome);
          results.push({ name, outcome, index, responsible });
        } catch (error) {
          const done = results.filter(r => r.outcome === "accepted" || r.outcome === "awaiting_approval").map(r => `«${r.name}»`);
          if (!done.length) throw error;
          throw new Error(`Изменения в ${done.join(", ")} приняты, в «${name}» — нет: ${(humanGitError(error) as Error)?.message ?? "ошибка"}`);
        }
      }
    } catch (error) { throw humanGitError(error); }
    finally {
      human.dispose();
      if (results.length) this.#save({ ...(this.#get(id) ?? task), merges });
    }
    const outcomes = results.map(r => r.outcome);
    const outcome: AcceptOutcome["outcome"] = (["rejected", "no_approver", "reverted", "awaiting_approval"] as const).find(o => outcomes.includes(o)) ?? "accepted";
    const names = [...new Set(results.flatMap(r => r.responsible))];
    const note = outcome === "awaiting_approval" ? (names.length ? `Ждёт согласования у ${names.join(", ")}` : "Ждёт согласования")
      : outcome === "no_approver" ? "Некому согласовать: назначьте ответственного за проект."
      : outcome === "rejected" ? "Изменения отклонены."
      : outcome === "reverted" ? "Возвращено как было." : "Принято";
    // Человек увидел и принял это состояние: «Что изменилось» дальше считается от него.
    if (outcome === "accepted" || outcome === "awaiting_approval") await control.accept(id).catch(() => {});
    const mergeRequest = results[0]?.index;
    return { outcome, note, ...(mergeRequest ? { mergeRequest } : {}) };
  }

  /** «Вернуть как было»: отменить принятые изменения задачи — все репозитории того же «Принять». */
  async revert(project: string, id: string, mergeRequest: number): Promise<AcceptOutcome> {
    const task = this.#own(project, id);
    if (!Number.isSafeInteger(mergeRequest) || mergeRequest < 1) throw new WorkspaceError("invalid", "Неизвестно, какие изменения вернуть.");
    const merges = [...(task.merges ?? [])];
    // Номера запросов свои у каждого репозитория: при совпадении берётся последнее «Принять».
    const hit = merges.filter(m => m.index === mergeRequest && m.outcome === "accepted").sort((a, b) => b.round - a.round)[0];
    const targets = hit ? merges.filter(m => m.round === hit.round && m.outcome === "accepted")
      : [{ connection_id: task.connection_id, repository_id: task.repository_id, index: mergeRequest, dir: "" }];
    const repos = this.#repos(task);
    const reverted: string[] = [];
    const human = this.#deps.human();
    try {
      if (!human.revertMergeRequest) throw new WorkspaceError("unavailable", "Возврат изменений недоступен на этой установке.");
      for (const target of targets) {
        const name = repositoryTitle(repos.find(r => r.connection_id === target.connection_id && r.repository_id === target.repository_id)?.repository_name ?? "", target.dir || "репозиторий");
        try {
          const result = await human.revertMergeRequest(project, target.connection_id, target.repository_id, target.index);
          if (result.outcome !== "reverted") throw new Error("Вернуть изменения не удалось.");
        } catch (error) {
          if (!reverted.length) throw error;
          throw new Error(`Изменения в ${reverted.map(n => `«${n}»`).join(", ")} возвращены, в «${name}» — нет: ${(humanGitError(error) as Error)?.message ?? "ошибка"}`);
        }
        reverted.push(name);
        const at = merges.findIndex(m => m.connection_id === target.connection_id && m.repository_id === target.repository_id && m.index === target.index);
        if (at >= 0) merges[at] = { ...merges[at], outcome: "reverted" };
      }
      return { outcome: "reverted", note: "Возвращено как было.", mergeRequest };
    } catch (error) { throw humanGitError(error); }
    finally {
      human.dispose();
      if (reverted.length && task.merges) this.#save({ ...(this.#get(id) ?? task), merges });
    }
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

  /** Положить файл в /workspace/.mnemos задачи: контекст беседы или приложенный к беседе файл. */
  async putFile(project: string, id: string, path: string, contentBase64: string): Promise<void> {
    const task = this.#own(project, id);
    if (!validWorkspaceFilePath(path)) throw new WorkspaceError("invalid", "Недопустимое имя файла для рабочего места.");
    const content = fromBase64(contentBase64, WORKSPACE_FILE_MAX_BYTES);
    if (!content) throw new WorkspaceError("invalid", "Файл повреждён или больше 10 МиБ.");
    if (finished(task.state)) throw new WorkspaceError("stopped", "Работа с кодом уже завершена.");
    await this.#control().putFile(id, path, content);
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
