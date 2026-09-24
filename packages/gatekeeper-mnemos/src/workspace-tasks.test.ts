import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkspaceClient, WorkspaceError, WorkspaceTasks, validWorkspaceFilePath, type RemoteTask, type WorkspaceControl, type WorkspaceHuman } from "./workspace-tasks.ts";
import { workspaceProgress } from "./workspace-steps.ts";
import type { AccountStorage } from "./account-session.ts";

function memory(): AccountStorage & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return { map, get: <T>(k: string) => map.get(k) as T | undefined, put: (k, v) => { map.set(k, structuredClone(v)); }, delete: k => { map.delete(k); } };
}
const TASK = "0123456789abcdef";
function remote(state: RemoteTask["state"], extra: Partial<RemoteTask> = {}): RemoteTask {
  return { task_id: TASK, binding_id: "binding", project_id: "p", branch: "agents/binding/" + TASK, title: "t", state, cost_usd: 0.02, created_at: "2026-09-23T10:00:00Z", ...extra };
}

class FakeControl implements WorkspaceControl {
  calls: unknown[][] = []; state: RemoteTask["state"] = "running"; missing = false;
  async create(input: Parameters<WorkspaceControl["create"]>[0]) { this.calls.push(["create", input]); return remote("starting", { repositories: input.repositories.map((r, i) => ({ connection_id: r.connection_id, repository_id: r.repository_id, dir: r.name ?? `repo-${i + 1}` })) }); }
  interruptError: WorkspaceError | null = null;
  async interrupt(id: string) { this.calls.push(["interrupt", id]); if (this.interruptError) throw this.interruptError; }
  async accept(id: string) { this.calls.push(["markAccepted", id]); return { repositories: [] }; }
  async status(id: string) { this.calls.push(["status", id]); if (this.missing) throw new WorkspaceError("not_found", "нет"); return remote(this.state); }
  async credential(id: string, token: string) { this.calls.push(["credential", id, token]); }
  async events(id: string) { this.calls.push(["events", id]); return []; }
  async message(id: string, text: string) { this.calls.push(["message", id, text]); }
  async abort(id: string) { this.calls.push(["abort", id]); }
  page: Awaited<ReturnType<WorkspaceControl["eventsAfter"]>> = { events: [], next: 0, state: "running" };
  async eventsAfter(id: string, after: number, waitMs: number) { this.calls.push(["eventsAfter", id, after, waitMs]); if (this.missing) throw new WorkspaceError("not_found", "нет"); return this.page; }
  changesValue: Awaited<ReturnType<WorkspaceControl["changes"]>> = { files: [{ path: "a.go", status: "modified" as const, additions: 2, deletions: 1 }], diff: "diff --git a/a.go b/a.go", truncated: false };
  async changes(id: string, since?: string) { this.calls.push(["changes", id, since]); return this.changesValue; }
  noChanges = false;
  published: Awaited<ReturnType<WorkspaceControl["publish"]>> = { branch: "agents/binding/" + TASK, head_sha: "abc123" };
  async publish(id: string, message: string) { this.calls.push(["publish", id, message]); if (this.noChanges) throw new WorkspaceError("no_changes", "Изменений нет."); return this.published; }
  async putFile(id: string, path: string, content: Uint8Array) { this.calls.push(["putFile", id, path, new TextDecoder().decode(content)]); }
}
function human(log: string[], overrides: Partial<WorkspaceHuman> = {}): () => WorkspaceHuman {
  let n = 0;
  return () => ({
    async issueAgentCredential(b) { log.push("issue:" + b); return { access_token: `token-${++n}`, token_type: "Bearer", expires_in: 900 }; },
    async readWorkshopAgentScope(b) { return { binding_id: b, agent_principal_id: "agent", runtime_id: "", runtime_agent_id: "", revoked: false, connection_name: "Агент", project_ids: ["p"] }; },
    async listProjectGitRepositories() { return { repositories: [{ project_id: "p", connection_id: "c", repository_id: "1", repository_name: "org/repo", revision: 1, enabled: true, provider: "gitea" as const, connection_revision: 1 }] }; },
    dispose() { log.push("dispose"); },
    ...overrides,
  });
}
function setup(overrides: Partial<WorkspaceHuman> = {}) {
  const kv = memory(), control = new FakeControl(), log: string[] = [], wakes: (number | null)[] = [];
  let now = 1_000;
  const tasks = new WorkspaceTasks(kv, { control, agent: async () => ({ bindingId: "binding" }), human: human(log, overrides), wake: async at => { wakes.push(at); }, clock: () => now, refreshEveryMs: 50 });
  return { kv, control, log, wakes, tasks, advance: (ms: number) => { now += ms; } };
}

test("Поручение проверяет доступ агента к проекту и репозиторий, выдаёт ключ и взводит обновление", async () => {
  const { control, log, wakes, tasks } = setup();
  const task = await tasks.start("p", "c", "1", "  Добавь проверку\nподробности  ");
  assert.equal(task.title, "Добавь проверку");
  assert.equal(task.repository_name, "org/repo");
  const create = control.calls.find(c => c[0] === "create")![1] as Record<string, string>;
  assert.equal(create.agent_credential, "token-1");
  assert.equal(create.binding_id, "binding");
  assert.equal(create.prompt, "Добавь проверку\nподробности");
  assert.deepEqual(wakes, [1_050]);
  assert.ok(log.filter(l => l === "dispose").length >= 2, "сессии человека закрываются");
  assert.deepEqual(tasks.list("p").map(t => t.task_id), [TASK]);
  assert.deepEqual(tasks.list("other"), []);
});

test("Проект вне области агента подключается от имени человека; отказ сервера останавливает до выдачи ключа", async () => {
  const updates: unknown[][] = [];
  const extended = setup({
    async readWorkshopAgentScope(b) { return { binding_id: b, agent_principal_id: "a", runtime_id: "", runtime_agent_id: "", revoked: false, connection_name: "", project_ids: ["other"] }; },
    async updateWorkshopAgentScope(b, expected, projects) { updates.push([b, expected, projects]); return { binding_id: b, agent_principal_id: "a", runtime_id: "", runtime_agent_id: "", revoked: false, connection_name: "", project_ids: projects }; },
  });
  const started = await extended.tasks.startTask("p", "c", "1", "задача");
  assert.equal(started.scopeExtended, true);
  assert.deepEqual(updates, [["binding", ["other"], ["other", "p"]]], "область расширяется с проверкой прежнего набора");
  const inScope = setup({ async updateWorkshopAgentScope() { throw new Error("не должен вызываться"); } });
  assert.equal((await inScope.tasks.startTask("p", "c", "1", "задача")).scopeExtended, false);
  const revoked = setup({ async readWorkshopAgentScope(b) { return { binding_id: b, agent_principal_id: "a", runtime_id: "", runtime_agent_id: "", revoked: true, connection_name: "", project_ids: [] }; } });
  await assert.rejects(revoked.tasks.start("p", "c", "1", "задача"), (e: WorkspaceError) => e.code === "scope");
});

test("Проект, на который у человека нет прав, и неподключённый репозиторий отклоняются до выдачи ключа", async () => {
  const outOfScope = setup({
    async readWorkshopAgentScope(b) { return { binding_id: b, agent_principal_id: "a", runtime_id: "", runtime_agent_id: "", revoked: false, connection_name: "", project_ids: ["other"] }; },
    async updateWorkshopAgentScope() { throw new Error("403"); },
  });
  await assert.rejects(outOfScope.tasks.start("p", "c", "1", "задача"), (e: WorkspaceError) => e.code === "scope");
  assert.equal(outOfScope.log.some(l => l.startsWith("issue:")), false);
  const noRepo = setup();
  await assert.rejects(noRepo.tasks.start("p", "c", "2", "задача"), (e: WorkspaceError) => e.code === "repository");
  assert.equal(noRepo.control.calls.some(c => c[0] === "create"), false);
});

test("Будильник обновляет ключ только задачам в работе и снимается после их завершения", async () => {
  const { control, log, wakes, tasks, advance } = setup();
  await tasks.start("p", "c", "1", "задача");
  advance(50);
  control.state = "running";
  await tasks.refresh();
  assert.deepEqual(control.calls.filter(c => c[0] === "credential"), [["credential", TASK, "token-2"]]);
  assert.equal(wakes.at(-1), 1_100, "следующее обновление через период");
  control.state = "idle";
  advance(50);
  await tasks.refresh();
  assert.equal(control.calls.filter(c => c[0] === "credential").length, 1, "готовая задача ключ не получает");
  assert.equal(wakes.at(-1), null, "будильник снят");
  assert.equal(log.filter(l => l.startsWith("issue:")).length, 2);
});

test("Потерянная службой задача становится остановленной, а остановка человеком снимает будильник", async () => {
  const first = setup();
  await first.tasks.start("p", "c", "1", "задача");
  first.control.missing = true;
  await first.tasks.refresh();
  assert.equal(first.tasks.list("p")[0].state, "stopped");
  assert.equal(first.wakes.at(-1), null);
  const second = setup();
  await second.tasks.start("p", "c", "1", "задача");
  await second.tasks.abort("p", TASK);
  assert.deepEqual(second.control.calls.at(-1), ["abort", TASK]);
  assert.equal(second.tasks.list("p")[0].state, "stopped");
  assert.equal(second.wakes.at(-1), null);
  await assert.rejects(second.tasks.abort("other", TASK), (e: WorkspaceError) => e.code === "not_found", "чужой проект");
});

test("Сообщение агенту сначала обновляет ключ и снова взводит обновление", async () => {
  const { control, wakes, tasks } = setup();
  await tasks.start("p", "c", "1", "задача");
  control.state = "idle";
  await tasks.refresh();
  assert.equal(wakes.at(-1), null);
  await tasks.message("p", TASK, "Доделай тест");
  const tail = control.calls.slice(-2).map(c => c[0]);
  assert.deepEqual(tail, ["credential", "message"]);
  assert.notEqual(wakes.at(-1), null);
});

test("Без настройки службы поручение отклоняется понятной ошибкой", async () => {
  const kv = memory();
  const tasks = new WorkspaceTasks(kv, { control: null, agent: async () => ({ bindingId: "b" }), human: human([]), wake: async () => {} });
  assert.equal(tasks.available(), false);
  await assert.rejects(tasks.start("p", "c", "1", "задача"), (e: WorkspaceError) => e.code === "unconfigured");
});

test("Клиент контрольного API: сервисный токен, формы запросов и чтение хвоста событий", async () => {
  const requests: { url: string; method: string; auth: string | null; body: string }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET", auth: new Headers(init?.headers).get("Authorization"), body: String(init?.body ?? "") });
    if (url.endsWith("/events")) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({ start(c) {
        c.enqueue(encoder.encode(`id: 1\nevent: workspace.state\ndata: {"seq":1,"type":"workspace.state","data":{"state":"running"}}\n\n: keepalive\n\n`));
        c.enqueue(encoder.encode(`id: 2\nevent: message.part.updated\ndata: {"seq":2,"type":"message.part.updated","data":{"part":{"id":"p1","type":"tool","tool":"read","state":{"status":"completed","input":{"filePath":"/workspace/repo/go.mod"}}}}}\n\n`));
        // Поток не закрывается: чтение заканчивает окно клиента.
      } });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    if (url.includes("/credential") || url.endsWith("/abort") || url.endsWith("/messages")) return new Response(null, { status: 204 });
    return Response.json(remote("running"));
  };
  const client = new WorkspaceClient("https://localhost:9452", "service-token", fetcher, 30);
  await client.credential(TASK, "agent-token");
  assert.deepEqual(JSON.parse(requests[0].body), { agent_credential: "agent-token" });
  assert.equal(requests[0].method, "PUT");
  assert.equal(requests[0].auth, "Bearer service-token");
  const events = await client.events(TASK);
  assert.deepEqual(events.map(e => e.type), ["workspace.state", "message.part.updated"]);
  assert.equal((await client.status(TASK)).state, "running");
  assert.throws(() => new WorkspaceClient("http://localhost:9452", "t"), (e: WorkspaceError) => e.code === "unconfigured");
  const missing = new WorkspaceClient("https://localhost:9452", "t", async () => new Response("", { status: 404 }));
  await assert.rejects(missing.status(TASK), (e: WorkspaceError) => e.code === "not_found");
});

test("События OpenCode сводятся к шагам для человека и ответу агента", () => {
  const progress = workspaceProgress([
    { seq: 1, type: "workspace.state", data: { state: "running" } },
    { seq: 2, type: "message.updated", data: { info: { id: "u1", role: "user" } } },
    { seq: 3, type: "message.part.updated", data: { part: { id: "t0", messageID: "u1", type: "text", text: "Задача человека" } } },
    { seq: 4, type: "message.updated", data: { info: { id: "a1", role: "assistant" } } },
    { seq: 5, type: "message.part.updated", data: { part: { id: "k1", messageID: "a1", type: "tool", tool: "read", state: { status: "completed", input: { filePath: "/workspace/repo/docs/check.md" } } } } },
    { seq: 6, type: "message.part.updated", data: { part: { id: "k2", messageID: "a1", type: "tool", tool: "edit", state: { status: "running", input: { filePath: "/workspace/repo/docs/check.md" } } } } },
    { seq: 7, type: "message.part.updated", data: { part: { id: "k2", messageID: "a1", type: "tool", tool: "edit", state: { status: "completed", input: { filePath: "/workspace/repo/docs/check.md" } } } } },
    { seq: 8, type: "message.part.updated", data: { part: { id: "k3", messageID: "a1", type: "tool", tool: "bash", state: { status: "completed", input: { command: "go test ./..." } } } } },
    { seq: 9, type: "message.part.updated", data: { part: { id: "k4", messageID: "a1", type: "tool", tool: "bash", state: { status: "completed", input: { command: "git push origin HEAD" } } } } },
    { seq: 10, type: "message.part.updated", data: { part: { id: "t1", messageID: "a1", type: "text", text: "Готово: добавил строку." } } },
  ]);
  assert.deepEqual(progress.steps.map(s => [s.kind, s.text, s.status]), [
    ["clone", "Готовлю рабочее место и клонирую репозиторий", "done"],
    ["read", "Читаю docs/check.md", "done"],
    ["edit", "Правлю docs/check.md", "done"],
    ["run", "Выполняю: go test ./...", "done"],
    ["push", "Отправил изменения в свою ветку", "done"],
  ]);
  assert.equal(progress.answer, "Готово: добавил строку.", "текст человека не выдаётся за ответ агента");
  const failed = workspaceProgress([{ seq: 1, type: "workspace.state", data: { state: "failed", reason: "клон не удался" } }]);
  assert.deepEqual(failed.steps.map(s => s.status), ["error", "error"]);
  assert.match(failed.steps[1].text, /клон не удался/);
});

function apiError(status: number, code?: string) { return Object.assign(new Error("Mnemos request failed"), { status, ...(code ? { code } : {}) }); }

test("«Принять»: сохраняет работу, открывает и вливает запрос; исходы переводятся в слова человека", async () => {
  const calls: unknown[][] = [];
  const merge = (outcome: string, extra: object = {}) => setup({
    async openMergeRequest(p, c, r, head, title, body) { calls.push(["open", p, c, r, head, title, body]); return { index: 7, head_sha: "abc123" }; },
    async acceptMergeRequest(p, c, r, index, head) { calls.push(["accept", index, head]); return { index, outcome: outcome as never, ...extra }; },
  });
  const ok = merge("accepted");
  await ok.tasks.start("p", "c", "1", "задача");
  assert.deepEqual(await ok.tasks.accept("p", TASK, "Добавил проверку\nподробности"), { outcome: "accepted", note: "Принято", mergeRequest: 7 });
  assert.deepEqual(ok.control.calls.find(c => c[0] === "publish"), ["publish", TASK, "Добавил проверку"]);
  assert.deepEqual(calls.slice(0, 2), [["open", "p", "c", "1", "agents/binding/" + TASK, "Добавил проверку", "Добавил проверку\nподробности"], ["accept", 7, "abc123"]]);

  const waiting = merge("awaiting_approval", { responsible: [{ principal_id: "u1", display_name: "Анна" }] });
  await waiting.tasks.start("p", "c", "1", "задача");
  assert.deepEqual(await waiting.tasks.accept("p", TASK, "итог"), { outcome: "awaiting_approval", note: "Ждёт согласования у Анна", mergeRequest: 7 });

  const empty = merge("accepted");
  await empty.tasks.start("p", "c", "1", "задача");
  empty.control.noChanges = true;
  assert.equal((await empty.tasks.accept("p", TASK, "итог")).note, "Изменений нет — принимать нечего.");
});

test("«Принять»: коды отказа Mnemos становятся понятными словами", async () => {
  const failing = (code: string) => setup({
    async openMergeRequest() { return { index: 3 }; },
    async acceptMergeRequest() { throw apiError(409, code); },
  });
  const noApprover = failing("git.merge.no_approver");
  await noApprover.tasks.start("p", "c", "1", "задача");
  assert.equal((await noApprover.tasks.accept("p", TASK, "итог")).outcome, "no_approver");
  const stale = failing("git.merge.stale");
  await stale.tasks.start("p", "c", "1", "задача");
  await assert.rejects(stale.tasks.accept("p", TASK, "итог"), /Агент изменил результат после вашего просмотра/);
  const other = failing("something.else");
  await other.tasks.start("p", "c", "1", "задача");
  await assert.rejects(other.tasks.accept("p", TASK, "итог"), /Mnemos request failed/, "незнакомый отказ не выдаётся за «некому согласовать»");
});

test("«Вернуть как было» отменяет принятые изменения и объясняет конфликт", async () => {
  const reverts: number[] = [];
  const ok = setup({ async revertMergeRequest(_p, _c, _r, index) { reverts.push(index); return { index, outcome: "reverted" }; } });
  await ok.tasks.start("p", "c", "1", "задача");
  assert.deepEqual(await ok.tasks.revert("p", TASK, 7), { outcome: "reverted", note: "Возвращено как было.", mergeRequest: 7 });
  assert.deepEqual(reverts, [7]);
  await assert.rejects(ok.tasks.revert("p", TASK, 0), (e: WorkspaceError) => e.code === "invalid");
  await assert.rejects(ok.tasks.revert("other", TASK, 7), (e: WorkspaceError) => e.code === "not_found", "чужой проект");
  const conflict = setup({ async revertMergeRequest() { throw apiError(409, "git.merge.revert_conflict"); } });
  await conflict.tasks.start("p", "c", "1", "задача");
  await assert.rejects(conflict.tasks.revert("p", TASK, 7), /Файл уже изменили после принятия/);
});

test("События после курсора обновляют состояние задачи; потерянная задача становится остановленной", async () => {
  const { control, tasks } = setup();
  await tasks.start("p", "c", "1", "задача");
  control.page = { events: [{ seq: 5, type: "workspace.state", data: { state: "idle" } }], next: 5, state: "idle" };
  const page = await tasks.events("p", TASK, 4, 15_000);
  assert.equal(page.next, 5);
  assert.deepEqual(control.calls.at(-1), ["eventsAfter", TASK, 4, 15_000]);
  assert.equal(tasks.list("p")[0].state, "idle");
  control.missing = true;
  assert.equal((await tasks.events("p", TASK, 5, 0)).state, "stopped");
  assert.equal(tasks.list("p")[0].state, "stopped");
  assert.equal((await tasks.changes("p", TASK)).files[0].path, "a.go");
});

test("Клиент: долгий опрос событий, изменения и сохранение работы по контракту службы", async () => {
  const requests: { url: string; method: string; body: string }[] = [];
  let publishStatus = 200;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
    if (url.includes("/events?")) return Response.json({ events: [{ seq: 3, type: "message.updated", properties: { info: { id: "a1", role: "assistant" } } }, { seq: "x", type: "bad" }], next: 3, state: "running" });
    if (url.endsWith("/changes")) return Response.json({ files: [{ path: "a.go", status: "modified", additions: 2, deletions: 1 }, { path: "b", status: "weird" }], diff: "d", truncated: true, base: "b0", head: "h1" });
    if (url.endsWith("/publish")) return publishStatus === 409 ? Response.json({ error: "no_changes" }, { status: 409 }) : Response.json({ branch: "agents/x", head_sha: "abc", pushed: true });
    return new Response(null, { status: 204 });
  };
  const client = new WorkspaceClient("https://localhost:9452", "t", fetcher);
  const page = await client.eventsAfter(TASK, 2, 99_000);
  assert.match(requests[0].url, /\/events\?after=2&wait=30000$/, "ожидание ограничено 30 с");
  assert.deepEqual(page, { events: [{ seq: 3, type: "message.updated", data: { info: { id: "a1", role: "assistant" } } }], next: 3, state: "running" });
  await assert.rejects(client.eventsAfter(TASK, -1, 0), (e: WorkspaceError) => e.code === "invalid");
  const changes = await client.changes(TASK);
  assert.deepEqual(changes, { files: [{ path: "a.go", status: "modified", additions: 2, deletions: 1 }], diff: "d", truncated: true });
  assert.deepEqual(await client.publish(TASK, "Итог"), { branch: "agents/x", head_sha: "abc" });
  assert.deepEqual(JSON.parse(requests.at(-1)!.body), { message: "Итог" });
  publishStatus = 409;
  await assert.rejects(client.publish(TASK, "Итог"), (e: WorkspaceError) => e.code === "no_changes");
});

test("client calls fetch without its own this, as the Workers runtime requires", async () => {
  // Workers fetch бросает «Illegal invocation», если this — не глобальный объект.
  function strictFetch(this: unknown, _input: RequestInfo | URL, _init?: RequestInit): Promise<Response> {
    if (this !== globalThis && this !== undefined) throw new TypeError("Illegal invocation");
    return Promise.resolve(new Response(JSON.stringify({ task_id: "0123456789abcdef", binding_id: "b", project_id: "p", branch: "agents/x", title: "t", state: "running", cost_usd: 0, created_at: "2026-09-24T00:00:00Z" }), { status: 200 }));
  }
  const client = new WorkspaceClient("https://localhost:9452", "token", strictFetch as typeof fetch);
  assert.equal((await client.status("0123456789abcdef")).state, "running");
});

const REPOS = [
  { project_id: "p", connection_id: "c", repository_id: "1", repository_name: "org/site.git", revision: 1, enabled: true, provider: "gitea" as const, connection_revision: 1 },
  { project_id: "p", connection_id: "c", repository_id: "2", repository_name: "org/api", revision: 1, enabled: true, provider: "gitea" as const, connection_revision: 1 },
  { project_id: "p", connection_id: "c", repository_id: "3", repository_name: "org/old", revision: 1, enabled: false, provider: "gitea" as const, connection_revision: 1 },
  ...[4, 5, 6, 7].map(n => ({ project_id: "p", connection_id: "d", repository_id: String(n), repository_name: `r${n}`, revision: 1, enabled: true, provider: "github" as const, connection_revision: 1 })),
];
const manyRepos = (overrides: Partial<WorkspaceHuman> = {}) => setup({ async listProjectGitRepositories() { return { repositories: REPOS }; }, ...overrides });

test("Задача передаёт репозитории с именами; беседа берёт все включённые репозитории проекта, не больше пяти", async () => {
  const single = setup();
  await single.tasks.start("p", "c", "1", "задача");
  const one = single.control.calls.find(c => c[0] === "create")![1] as Record<string, unknown>;
  assert.deepEqual(one.repositories, [{ connection_id: "c", repository_id: "1", name: "repo" }]);
  assert.equal("agent_name" in one, false, "без имени агента поле не передаётся");
  assert.equal("connection_id" in one, false, "старые одиночные поля вместе с repositories не передаются");

  const chat = manyRepos();
  const { task } = await chat.tasks.startTask("p", "c", "2", "задача", { agentName: "chat", allRepositories: true });
  const many = chat.control.calls.find(c => c[0] === "create")![1] as { repositories: { repository_id: string; name?: string }[]; agent_name?: string };
  assert.equal(many.agent_name, "chat");
  assert.deepEqual(many.repositories.map(r => r.repository_id), ["2", "1", "4", "5", "6"], "указанный первым, выключенный пропущен, всего пять");
  assert.deepEqual(many.repositories.map(r => r.name), ["api", "site", "r4", "r5", "r6"], "имя без пути и без .git");
  assert.equal(task.repository_id, "2");
  assert.equal(task.repository_name, "org/api");
  assert.deepEqual(task.repositories!.map(r => r.dir), ["api", "site", "r4", "r5", "r6"], "папки — из ответа службы");
});

test("«Остановить» прерывает только ответ агента: задача остаётся живой; завершённую прервать нельзя", async () => {
  const { control, tasks } = setup();
  await tasks.start("p", "c", "1", "задача");
  await tasks.interrupt("p", TASK);
  assert.deepEqual(control.calls.at(-1), ["interrupt", TASK]);
  assert.equal(tasks.list("p")[0].state, "idle");
  assert.equal(control.calls.some(c => c[0] === "abort"), false);
  control.interruptError = new WorkspaceError("not_found", "нет");
  await assert.rejects(tasks.interrupt("p", TASK), (e: WorkspaceError) => e.code === "stopped");
  assert.equal(tasks.list("p")[0].state, "stopped", "потерянная службой задача становится остановленной");
  await assert.rejects(tasks.interrupt("p", TASK), (e: WorkspaceError) => e.code === "stopped");
  await assert.rejects(tasks.interrupt("other", TASK), (e: WorkspaceError) => e.code === "not_found", "чужой проект");
});

test("«Что изменилось» по репозиториям: имена для человека и выбор места отсчёта", async () => {
  const { control, tasks } = manyRepos();
  await tasks.startTask("p", "c", "1", "задача", { allRepositories: true });
  control.changesValue = {
    files: [{ path: "site/a.go", status: "modified", additions: 1, deletions: 0 }], diff: "", truncated: false, since: "accepted",
    repositories: [
      { dir: "site", name: "site", connection_id: "c", repository_id: "1", files: [{ path: "a.go", status: "modified", additions: 1, deletions: 0 }], diff: "", truncated: false },
      { dir: "x9", name: "x9", connection_id: "c", repository_id: "2", files: [], diff: "", truncated: false },
    ],
  };
  const changes = await tasks.changes("p", TASK, "start");
  assert.deepEqual(control.calls.at(-1), ["changes", TASK, "start"]);
  assert.deepEqual(changes.repositories!.map(r => r.name), ["site", "api"], "имя из привязки проекта, найденное по папке или по репозиторию");
});

test("«Принять» при нескольких репозиториях: запрос в каждом, где есть изменения; место отсчёта сдвигается; повтор не открывает лишних запросов", async () => {
  const opened: unknown[][] = [], accepted: unknown[][] = [], reverted: unknown[][] = [];
  let next = 10;
  const { control, tasks } = manyRepos({
    async openMergeRequest(_p, c, r, head) { opened.push([c, r, head]); return { index: next++ }; },
    async acceptMergeRequest(_p, c, r, index, head) { accepted.push([c, r, index, head]); return { index, outcome: "accepted" }; },
    async revertMergeRequest(_p, c, r, index) { reverted.push([c, r, index]); return { index, outcome: "reverted" }; },
  });
  await tasks.startTask("p", "c", "1", "задача", { allRepositories: true });
  control.published = { branch: "agents/chat/x", head_sha: "h-site", repositories: [{ dir: "site", head_sha: "h-site", pushed: true }, { dir: "api", pushed: false }, { dir: "r4", head_sha: "h-r4", pushed: true }] };
  const first = await tasks.accept("p", TASK, "Итог");
  assert.deepEqual(first, { outcome: "accepted", note: "Принято", mergeRequest: 10 });
  assert.deepEqual(opened, [["c", "1", "agents/chat/x"], ["d", "4", "agents/chat/x"]], "репозиторий без изменений пропущен");
  assert.deepEqual(accepted, [["c", "1", 10, "h-site"], ["d", "4", 11, "h-r4"]]);
  assert.ok(control.calls.some(c => c[0] === "markAccepted"), "после «Принять» служба запоминает принятое место");

  // Второе «Принять»: новое только в site — второй запрос в r4 не открывается.
  control.published = { branch: "agents/chat/x", head_sha: "h-site2", repositories: [{ dir: "site", head_sha: "h-site2", pushed: true }, { dir: "r4", head_sha: "h-r4", pushed: true }] };
  assert.equal((await tasks.accept("p", TASK, "Ещё")).mergeRequest, 12);
  assert.equal(opened.length, 3);

  assert.deepEqual(await tasks.revert("p", TASK, 12), { outcome: "reverted", note: "Возвращено как было.", mergeRequest: 12 });
  assert.deepEqual(reverted, [["c", "1", 12]], "возвращается только последнее «Принять»");
});

test("«Вернуть как было» отменяет все репозитории одного «Принять»", async () => {
  const reverted: unknown[][] = [];
  let next = 1;
  const { control, tasks } = manyRepos({
    async openMergeRequest() { return { index: next++ }; },
    async acceptMergeRequest(_p, _c, _r, index) { return { index, outcome: "accepted" }; },
    async revertMergeRequest(_p, c, r, index) { reverted.push([c, r, index]); return { index, outcome: "reverted" }; },
  });
  await tasks.startTask("p", "c", "1", "задача", { allRepositories: true });
  control.published = { branch: "b", head_sha: "h1", repositories: [{ dir: "site", head_sha: "h1", pushed: true }, { dir: "api", head_sha: "h2", pushed: true }] };
  const accepted = await tasks.accept("p", TASK, "итог");
  assert.equal((await tasks.revert("p", TASK, accepted.mergeRequest!)).outcome, "reverted");
  assert.deepEqual(reverted, [["c", "1", 1], ["c", "2", 2]]);
  assert.deepEqual(tasks.list("p")[0].merges!.map(m => m.outcome), ["reverted", "reverted"]);
});

test("«Принять» при нескольких репозиториях: согласование и частичный отказ объясняются словами", async () => {
  let n = 0;
  const waiting = manyRepos({
    async openMergeRequest() { return { index: ++n }; },
    async acceptMergeRequest(_p, _c, r, index) { return r === "1" ? { index, outcome: "accepted" } : { index, outcome: "awaiting_approval", responsible: [{ principal_id: "u", display_name: "Анна" }] }; },
  });
  await waiting.tasks.startTask("p", "c", "1", "задача", { allRepositories: true });
  waiting.control.published = { branch: "b", head_sha: "h1", repositories: [{ dir: "site", head_sha: "h1", pushed: true }, { dir: "api", head_sha: "h2", pushed: true }] };
  assert.deepEqual(await waiting.tasks.accept("p", TASK, "итог"), { outcome: "awaiting_approval", note: "Ждёт согласования у Анна", mergeRequest: 1 });

  const partial = manyRepos({
    async openMergeRequest() { return { index: 5 }; },
    async acceptMergeRequest(_p, _c, r, index) { if (r === "2") throw apiError(409, "git.merge.stale"); return { index, outcome: "accepted" }; },
  });
  await partial.tasks.startTask("p", "c", "1", "задача", { allRepositories: true });
  partial.control.published = { branch: "b", head_sha: "h1", repositories: [{ dir: "site", head_sha: "h1", pushed: true }, { dir: "api", head_sha: "h2", pushed: true }] };
  await assert.rejects(partial.tasks.accept("p", TASK, "итог"), /в «site» приняты, в «api» — нет: Агент изменил результат/);
  assert.equal(partial.control.calls.some(c => c[0] === "markAccepted"), false, "непринятое не прячется из «Что изменилось»");
});

test("Клиент: остановка ответа, «принято до этого места», изменения с начала и по репозиториям", async () => {
  const requests: { url: string; method: string; body: string }[] = [];
  let status = 202, conflict = "";
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
    if (url.endsWith("/interrupt")) return new Response(null, { status });
    if (url.endsWith("/accept")) return conflict ? Response.json({ error: conflict }, { status: 409 }) : Response.json({ repositories: [{ dir: "site", accepted: "a1", head: "h1" }, { dir: 7 }] });
    if (url.includes("/changes")) return Response.json({ files: [{ path: "site/a.go", status: "added", additions: 3, deletions: 0 }], diff: "d", truncated: false, base: "", head: "", since: "start",
      repositories: [{ dir: "site", connection_id: "c", repository_id: "1", files: [{ path: "a.go", status: "added", additions: 3, deletions: 0 }], diff: "d", truncated: false, base: "b", head: "h", since: "start" }, { dir: "" }] });
    if (url.endsWith("/publish")) return conflict ? Response.json({ error: conflict }, { status: 409 }) : Response.json({ branch: "agents/chat/x", head_sha: "h1", pushed: true, repositories: [{ dir: "site", head_sha: "h1", pushed: true }, { dir: "api", pushed: false }] });
    if (url.endsWith("/tasks")) return Response.json(remote("starting", { repositories: [{ connection_id: "c", repository_id: "1", dir: "site" }] }), { status: 201 });
    return new Response(null, { status: 204 });
  };
  const client = new WorkspaceClient("https://localhost:9452", "t", fetcher);
  const created = await client.create({ binding_id: "b", agent_credential: "k", project_id: "p", repositories: [{ connection_id: "c", repository_id: "1", name: "site" }], agent_name: "chat", prompt: "x", title: "x" });
  assert.deepEqual(JSON.parse(requests[0].body).repositories, [{ connection_id: "c", repository_id: "1", name: "site" }]);
  assert.equal(JSON.parse(requests[0].body).agent_name, "chat");
  assert.equal(created.repositories?.[0].dir, "site");

  await client.interrupt(TASK);
  assert.equal(requests.at(-1)!.method, "POST");
  status = 409;
  await assert.rejects(client.interrupt(TASK), (e: WorkspaceError) => e.code === "stopped");
  status = 502;
  await assert.rejects(client.interrupt(TASK), /Агент не остановился/);

  assert.deepEqual(await client.accept(TASK), { repositories: [{ dir: "site", accepted: "a1", head: "h1" }] });
  const changes = await client.changes(TASK, "start");
  assert.match(requests.at(-1)!.url, /\/changes\?since=start$/);
  assert.equal(changes.since, "start");
  assert.deepEqual(changes.repositories, [{ dir: "site", name: "site", connection_id: "c", repository_id: "1", files: [{ path: "a.go", status: "added", additions: 3, deletions: 0 }], diff: "d", truncated: false }]);
  await client.changes(TASK);
  assert.match(requests.at(-1)!.url, /\/changes$/, "по умолчанию — с последнего «Принять»");
  await assert.rejects(client.changes(TASK, "вчера" as never), (e: WorkspaceError) => e.code === "invalid");
  assert.deepEqual(await client.publish(TASK, "m"), { branch: "agents/chat/x", head_sha: "h1", repositories: [{ dir: "site", head_sha: "h1", pushed: true }, { dir: "api", pushed: false }] });

  conflict = "no_repository";
  await assert.rejects(client.accept(TASK), (e: WorkspaceError) => e.code === "no_repository");
  await assert.rejects(client.publish(TASK, "m"), (e: WorkspaceError) => e.code === "no_repository");
  conflict = "stopped";
  await assert.rejects(client.accept(TASK), (e: WorkspaceError) => e.code === "stopped");
});

test("Шаги: путь без каталога контейнера, папка репозитория остаётся", () => {
  const progress = workspaceProgress([
    { seq: 1, type: "message.part.updated", data: { part: { id: "k1", type: "tool", tool: "read", state: { status: "completed", input: { filePath: "/workspace/site/docs/a.md" } } } } },
    { seq: 2, type: "message.part.updated", data: { part: { id: "k2", type: "tool", tool: "read", state: { status: "completed", input: { filePath: "/workspace/repo/b.md" } } } } },
    { seq: 3, type: "message.part.updated", data: { part: { id: "k3", type: "tool", tool: "read", state: { status: "completed", input: { filePath: "/workspace/repository/c.md" } } } } },
  ]);
  assert.deepEqual(progress.steps.slice(1).map(s => s.text), ["Читаю site/docs/a.md", "Читаю b.md", "Читаю repository/c.md"]);
});

test("Клиент: файл кладётся PUT-запросом в base64; ответы службы становятся понятными ошибками", async () => {
  const requests: { url: string; method: string; body: string }[] = [];
  let status = 204;
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? "GET", body: String(init?.body ?? "") });
    return new Response(null, { status });
  };
  const client = new WorkspaceClient("https://localhost:9452", "t", fetcher);
  await client.putFile(TASK, ".mnemos/context.md", new TextEncoder().encode("Контекст"));
  assert.equal(requests[0].method, "PUT");
  assert.match(requests[0].url, new RegExp(`/v1/workspace/tasks/${TASK}/files$`));
  const body = JSON.parse(requests[0].body);
  assert.equal(body.path, ".mnemos/context.md");
  assert.equal(new TextDecoder().decode(Uint8Array.from(atob(body.content_base64), c => c.charCodeAt(0))), "Контекст");
  await client.putFile(TASK, ".mnemos/attachments/отчёт (2).pdf", new Uint8Array([0, 255, 7]));
  assert.equal(JSON.parse(requests[1].body).content_base64, "AP8H");

  for (const [code, check] of [[400, (e: WorkspaceError) => e.code === "invalid"], [409, (e: WorkspaceError) => e.code === "not_ready"],
    [502, (e: WorkspaceError) => e.code === "unavailable" && /не записан/.test(e.message)], [404, (e: WorkspaceError) => e.code === "not_found"]] as const) {
    status = code;
    await assert.rejects(client.putFile(TASK, ".mnemos/context.md", new Uint8Array(1)), check, `ответ ${code}`);
  }

  const before = requests.length;
  for (const path of ["repo/a.txt", ".mnemos/attachments/", ".mnemos/attachments/a/b", ".mnemos/attachments/..", ".mnemos/attachments/a..b", ".mnemos/attachments/a\nb", ".mnemos/attachments/.", ".mnemos/attachments/" + "я".repeat(101), "/workspace/.mnemos/context.md"]) {
    await assert.rejects(client.putFile(TASK, path, new Uint8Array(1)), (e: WorkspaceError) => e.code === "invalid", path);
  }
  await assert.rejects(client.putFile(TASK, ".mnemos/context.md", new Uint8Array((10 << 20) + 1)), (e: WorkspaceError) => e.code === "invalid", "больше 10 МиБ");
  assert.equal(requests.length, before, "недопустимое до службы не доходит");
  assert.equal(validWorkspaceFilePath(".mnemos/attachments/" + "я".repeat(100)), true, "200 байт — можно");
});

test("Файл в рабочее место: только своя задача, только живая, base64 разбирается строго", async () => {
  const { control, tasks } = setup();
  await tasks.start("p", "c", "1", "задача");
  await tasks.putFile("p", TASK, ".mnemos/context.md", Buffer.from("Контекст беседы").toString("base64"));
  assert.deepEqual(control.calls.at(-1), ["putFile", TASK, ".mnemos/context.md", "Контекст беседы"]);
  await assert.rejects(tasks.putFile("other", TASK, ".mnemos/context.md", "YQ=="), (e: WorkspaceError) => e.code === "not_found", "чужой проект");
  await assert.rejects(tasks.putFile("p", TASK, ".mnemos/context.md", "не base64"), (e: WorkspaceError) => e.code === "invalid");
  await assert.rejects(tasks.putFile("p", TASK, "../etc/passwd", "YQ=="), (e: WorkspaceError) => e.code === "invalid");
  await assert.rejects(tasks.putFile("p", TASK, ".mnemos/context.md", "A".repeat(Math.ceil((10 << 20) / 3) * 4 + 4)), (e: WorkspaceError) => e.code === "invalid", "больше 10 МиБ");
  await tasks.abort("p", TASK);
  const calls = control.calls.length;
  await assert.rejects(tasks.putFile("p", TASK, ".mnemos/context.md", "YQ=="), (e: WorkspaceError) => e.code === "stopped");
  assert.equal(control.calls.length, calls, "остановленной задаче файл не отправляется");
});

test("Без права «Агент кода» служба отказывает: запуск и сообщение дают понятную ошибку, задача становится остановленной", async () => {
  const refused = new WorkspaceClient("https://localhost:9452", "t", async () => Response.json({ error: "code_agent_disabled" }, { status: 403 }));
  await assert.rejects(refused.create({ binding_id: "b", agent_credential: "k", project_id: "p", repositories: [], prompt: "x", title: "x" }),
    (e: WorkspaceError) => e.code === "disabled" && /включает администратор/.test(e.message));
  await assert.rejects(refused.credential(TASK, "k"), (e: WorkspaceError) => e.code === "disabled");

  const { control, tasks } = setup();
  await tasks.start("p", "c", "1", "задача");
  control.credential = async () => { throw new WorkspaceError("disabled", "Агент кода выключен"); };
  await assert.rejects(tasks.message("p", TASK, "ещё"), (e: WorkspaceError) => e.code === "disabled");
  const task = tasks.list("p")[0];
  assert.equal(task.state, "stopped");
  assert.equal(task.reason, "агент кода выключен администратором");
  assert.equal(control.calls.some(c => c[0] === "message"), false, "сообщение без права не отправляется");
});
