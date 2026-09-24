import { describe, it, expect } from "vitest";
import type { AiChatMetadata, AiChatStreamEvent } from "@gadgets/workshop-shared/api";
import type { AgentStep, ChangedFile } from "@gadgets/workshop-shared/code-work";
import { formatCodeWorkResult, validateChatProjects, chatProjects } from "@gadgets/workshop-shared/code-work";
import { CodeWorkTimeline, relativePath, shortCommand, type CodeWorkEvent } from "../src/code-work-timeline";
import { runCodeWorkTurn, type CodeWorkBackend } from "../src/code-work";
import {
  acceptChatCodeChanges, codeWorkForeground, leaveCodeWork, readChatCodeChanges, revertChatCodeChanges, runChatCodeWork, setChatProjects,
  type ChatCodeWorkHost, type CodeWorkUser,
} from "../src/chat-code-work";

const part = (seq: number, p: Record<string, unknown>): CodeWorkEvent => ({ seq, type: "message.part.updated", data: { part: p } });
const role = (seq: number, id: string, r: string): CodeWorkEvent => ({ seq, type: "message.updated", data: { info: { id, role: r } } });

describe("шаги рабочего места для человека", () => {
  it("инструменты становятся глаголами, технические слова — только в подробностях", () => {
    const t = new CodeWorkTimeline(0);
    const { steps } = t.apply([
      role(1, "a1", "assistant"),
      part(2, { id: "x1", messageID: "a1", type: "tool", tool: "read", callID: "c1", state: { status: "completed", input: { filePath: "/workspace/repo/go.mod" }, output: "module x" } }),
      part(3, { id: "x2", messageID: "a1", type: "tool", tool: "edit", callID: "c2", state: { status: "completed", input: { filePath: "/workspace/repo/a.go", oldString: "a", newString: "b\nc" } } }),
      part(4, { id: "x3", messageID: "a1", type: "tool", tool: "bash", callID: "c3", state: { status: "error", input: { command: "go test ./...", description: "Запустить тесты" }, error: "FAIL" } }),
      part(5, { id: "x4", messageID: "a1", type: "tool", tool: "mnemos_mnemos_search", callID: "c4", state: { status: "completed", input: { query: "регламент" } } }),
      part(6, { id: "x5", messageID: "a1", type: "tool", tool: "todowrite", callID: "c5", state: { status: "completed", input: {} } }),
    ]);
    expect(steps.map(s => [s.kind, s.title, s.status])).toEqual([
      ["file", "Прочитал файл go.mod", "done"],
      ["edit", "Изменил файл a.go +2 −1", "done"],
      ["run", "Команда завершилась с ошибкой go test ./...", "error"],
      ["memory", "Поискал в памяти «регламент»", "done"],
    ]);
    expect(steps[2].detail).toBe("# Запустить тесты\ngo test ./...");
    expect(steps[2].output).toBe("FAIL");
    expect(steps.every(s => !/bash|grep|mnemos_/.test(s.title))).toBe(true);
  });

  it("шаг команды показывает саму команду коротко, полный текст и вывод — в подробностях", () => {
    expect(shortCommand("  git status  ")).toBe("git status");
    expect(shortCommand("cd /workspace/repo\nnpm test")).toBe("cd /workspace/repo …");
    expect(shortCommand("x".repeat(200))).toHaveLength(80);
    expect(shortCommand("")).toBe("");
    const t = new CodeWorkTimeline(0);
    const long = `rg -n "reasoning" packages/workshop-backend/src --glob '*.ts' | head -50 && echo done && echo more`;
    const { steps } = t.apply([
      role(1, "a1", "assistant"),
      part(2, { id: "b1", messageID: "a1", type: "tool", tool: "bash", callID: "k1", state: { status: "running", input: { command: "ls -la" } } }),
      part(3, { id: "b2", messageID: "a1", type: "tool", tool: "bash", callID: "k2", state: { status: "completed", input: { command: long, description: "Найти размышления" }, output: "agent.ts:1" } }),
      part(4, { id: "b3", messageID: "a1", type: "tool", tool: "bash", callID: "k3", state: { status: "completed", input: { command: "", description: "Проверить окружение" } } }),
    ]);
    expect(steps[0].title).toBe("Выполняю команду ls -la");
    expect(steps[1].title).toBe(`Выполнил команду ${long.slice(0, 79)}…`);
    expect(steps[1].detail).toBe(`# Найти размышления\n${long}`);
    expect(steps[1].output).toBe("agent.ts:1");
    expect(steps[2].title).toBe("Выполнил команду: Проверить окружение");
  });

  it("идентификаторы узлов и баз не попадают в строку шага", () => {
    const t = new CodeWorkTimeline(0);
    const node = "3fa85f6457174562b3fc2c963f66afa6";
    const { steps } = t.apply([
      role(1, "a1", "assistant"),
      part(2, { id: "m1", messageID: "a1", type: "tool", tool: "mnemos_mnemos_read", callID: "r1", state: { status: "completed", input: { node_id: node } } }),
      part(3, { id: "m2", messageID: "a1", type: "tool", tool: "mnemos_mnemos_read", callID: "r2", state: { status: "completed", input: { path: "Договоры/2026.docx" } } }),
      part(4, { id: "m3", messageID: "a1", type: "tool", tool: "mnemos_mnemos_query", callID: "r3", state: { status: "completed", input: { db_id: "db_0123456789abcdef0123", sql: "select 1" } } }),
    ]);
    expect(steps.map(s => s.title)).toEqual(["Открыл документ", "Открыл документ Договоры/2026.docx", "Запросил базу"]);
    expect(steps[0].detail).toBe(node);
    expect(steps.every(s => !s.title.includes(node))).toBe(true);
  });

  it("шаг обновляется по мере работы, повторные события и текст человека не учитываются", () => {
    const t = new CodeWorkTimeline(1);
    const running = t.apply([
      { seq: 1, type: "workspace.state", data: { state: "failed" } },
      role(2, "u1", "user"),
      part(3, { id: "t0", messageID: "u1", type: "text", text: "Задача человека" }),
      role(4, "a1", "assistant"),
      part(5, { id: "k", messageID: "a1", type: "tool", tool: "read", callID: "c", state: { status: "running", input: { filePath: "x" } } }),
      part(6, { id: "t1", messageID: "a1", type: "text", text: "Гото" }),
    ]);
    expect(running.steps.map(s => s.title)).toEqual(["Читаю файл x"]);
    expect(running.textDelta).toBe("Гото");
    const done = t.apply([
      part(5, { id: "k", messageID: "a1", type: "tool", tool: "read", callID: "c", state: { status: "error", input: { filePath: "x" } } }),
      part(7, { id: "k", messageID: "a1", type: "tool", tool: "read", callID: "c", state: { status: "completed", input: { filePath: "x" } } }),
      part(8, { id: "t1", messageID: "a1", type: "text", text: "Готово" }),
    ]);
    expect(done.steps.map(s => s.status)).toEqual(["done"]);
    expect(done.textDelta).toBe("во");
    expect(t.steps()).toHaveLength(1);
    expect(t.answer()).toBe("Готово");
    expect(t.cursor).toBe(8);
  });
});

class FakeBackend implements CodeWorkBackend {
  calls: unknown[][] = [];
  pages: {events: CodeWorkEvent[]; state: "starting" | "running" | "idle" | "stopped" | "failed"}[] = [];
  files: ChangedFile[] = [{path: "a.go", status: "modified", additions: 1, deletions: 0}];
  scopeExtended = false;
  async start(project: string, _target: unknown, prompt: string) { this.calls.push(["start", project, prompt]); return {taskId: "t1", state: "starting" as const, scopeExtended: this.scopeExtended}; }
  async message(project: string, task: string, text: string) { this.calls.push(["message", project, task, text]); }
  async events(_p: string, _t: string, after: number) {
    this.calls.push(["events", after]);
    const page = this.pages.shift() ?? {events: [], state: "idle" as const};
    return {events: page.events, next: page.events.at(-1)?.seq ?? after, state: page.state};
  }
  async abort(project: string, task: string) { this.calls.push(["abort", project, task]); }
  interruptFails = false;
  async interrupt(project: string, task: string) { this.calls.push(["interrupt", project, task]); if (this.interruptFails) throw new Error("Агент сейчас не работает"); }
  async changes() { return {files: this.files, diff: "", truncated: false}; }
}
const TARGET = {connectionId: "c", repositoryId: "1", repositoryName: "org/repo"};

describe("ход работы с кодом", () => {
  it("новый ход запускает задачу, читает события до «свободен» и возвращает итог", async () => {
    const backend = new FakeBackend();
    backend.scopeExtended = true;
    backend.pages = [
      {events: [], state: "running"},
      {events: [role(1, "a1", "assistant"), part(2, {id: "k", messageID: "a1", type: "tool", tool: "read", callID: "c", state: {status: "completed", input: {filePath: "x"}}}), part(3, {id: "t", messageID: "a1", type: "text", text: "Сделал"})], state: "idle"},
    ];
    const streamed: AgentStep[] = [];
    const {output, cursor} = await runCodeWorkTurn({backend, projectId: "p", projectTitle: "Продажи", target: TARGET, cursor: 0, prompt: "задача",
      signal: new AbortController().signal, onStep: s => streamed.push(s), clock: () => 0});
    expect(backend.calls[0]).toEqual(["start", "p", "задача"]);
    expect(output.state).toBe("idle");
    expect(output.answer).toBe("Сделал");
    expect(output.steps.map(s => s.title)).toEqual(["Подключил проект «Продажи»", "Прочитал файл x"]);
    expect(streamed.map(s => s.title)).toEqual(output.steps.map(s => s.title));
    expect(output.changedFiles).toHaveLength(1);
    expect(cursor).toBe(3);
    expect(formatCodeWorkResult(output)).toContain("Не обещай, что изменения уже сохранены");
  });

  it("продолжение отправляет сообщение и читает только новые события", async () => {
    const backend = new FakeBackend();
    backend.pages = [{events: [role(10, "a2", "assistant")], state: "idle"}];
    await runCodeWorkTurn({backend, projectId: "p", projectTitle: "P", taskId: "t1", cursor: 9, prompt: "ещё", signal: new AbortController().signal, onStep: () => {}});
    expect(backend.calls[0]).toEqual(["message", "p", "t1", "ещё"]);
    expect(backend.calls[1]).toEqual(["events", 9]);
  });

  it("«свободен» до начала работы не заканчивает ход сразу; остановка прерывает только ответ, работа остаётся", async () => {
    const backend = new FakeBackend();
    backend.pages = [{events: [], state: "idle"}, {events: [], state: "idle"}, {events: [role(1, "a", "assistant")], state: "idle"}];
    const {output} = await runCodeWorkTurn({backend, projectId: "p", projectTitle: "P", taskId: "t1", cursor: 0, prompt: "x", signal: new AbortController().signal, onStep: () => {}, idleWithoutWorkPolls: 5});
    expect(backend.calls.filter(c => c[0] === "events")).toHaveLength(3);
    expect(output.state).toBe("idle");

    const stop = new AbortController();
    const stopped = new FakeBackend();
    stopped.pages = [{events: [], state: "running"}];
    const run = runCodeWorkTurn({backend: stopped, projectId: "p", projectTitle: "P", taskId: "t1", cursor: 0, prompt: "x", signal: stop.signal, onStep: () => stop.abort()});
    stopped.pages.push({events: [part(1, {id: "k", type: "tool", tool: "read", callID: "c", state: {status: "running", input: {}}})], state: "running"});
    stopped.pages.shift();
    const result = await run;
    expect(result.output.state).toBe("idle");
    expect(result.output.interrupted).toBe(true);
    expect(result.output.steps.at(-1)?.title).toBe("Остановлено по вашей просьбе");
    expect(stopped.calls.some(c => c[0] === "interrupt")).toBe(true);
    expect(stopped.calls.some(c => c[0] === "abort")).toBe(false);
    expect(formatCodeWorkResult(result.output)).toContain("Человек остановил ответ агента кода");
  });

  it("если прервать ответ нельзя, работа с кодом закрывается", async () => {
    const stop = new AbortController();
    const backend = new FakeBackend();
    backend.interruptFails = true;
    backend.pages = [{events: [part(1, {id: "k", type: "tool", tool: "read", callID: "c", state: {status: "running", input: {}}})], state: "running"}];
    const {output} = await runCodeWorkTurn({backend, projectId: "p", projectTitle: "P", taskId: "t1", cursor: 0, prompt: "x", signal: stop.signal, onStep: () => stop.abort()});
    expect(output.state).toBe("stopped");
    expect(backend.calls.map(c => c[0])).toEqual(expect.arrayContaining(["interrupt", "abort"]));
  });

  it("«Остановить» не ждёт конца долгого опроса событий", async () => {
    const stop = new AbortController();
    const calls: unknown[][] = [];
    const backend: CodeWorkBackend = {
      async start() { throw new Error("не нужен"); },
      async message(p, t, text) { calls.push(["message", text]); },
      // Долгий опрос не заканчивается сам; опрос без ожидания отвечает сразу.
      events: (_p, _t, after, waitMs) => waitMs > 0 ? new Promise(() => {}) : Promise.resolve({events: [], next: after, state: "idle"}),
      async abort() { calls.push(["abort"]); },
      async interrupt() { calls.push(["interrupt"]); },
      async changes() { return {files: [], diff: "", truncated: false}; },
    };
    const run = runCodeWorkTurn({backend, projectId: "p", projectTitle: "P", taskId: "t1", cursor: 0, prompt: "x", signal: stop.signal, onStep: () => {}, waitMs: 15_000});
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(calls).toEqual([["message", "x"]]);
    stop.abort();
    const {output} = await run;
    expect(output.state).toBe("idle");
    expect(calls).toEqual([["message", "x"], ["interrupt"]]);
  });
});

function fakeHost(meta: AiChatMetadata, user: Partial<CodeWorkUser>) {
  const events: AiChatStreamEvent[] = [];
  let current = structuredClone(meta);
  const host: ChatCodeWorkHost = {
    chatMeta: () => structuredClone(current),
    putChatMeta: m => { current = structuredClone(m); },
    user: () => user as CodeWorkUser,
    emit: (_id, e) => events.push(e),
  };
  return {host, events, meta: () => current};
}
const baseMeta = (extra: Partial<AiChatMetadata> = {}): AiChatMetadata => ({id: 1, title: "t", started: new Date(0), lastActive: new Date(0), ...extra});

describe("работа с кодом в беседе", () => {
  it("набор проектов проверяется, старое одиночное поле читается как проект человека", () => {
    expect(chatProjects({accountId: 1, projectId: "p", title: "Продажи"})).toEqual([{accountId: 1, projectId: "p", title: "Продажи", pinnedBy: "user"}]);
    expect(() => validateChatProjects([{accountId: 1, projectId: "p", title: "a", pinnedBy: "user"}, {accountId: 1, projectId: "p", title: "b", pinnedBy: "user"}])).toThrow("Проект указан дважды");
    expect(() => validateChatProjects([{accountId: 1, projectId: "p", title: "a", pinnedBy: "admin"}])).toThrow();
    const {host, meta} = fakeHost(baseMeta({projectContext: {accountId: 1, projectId: "p", title: "P", creatorId: "u1", creatorProfileId: "pr"}}), {});
    expect(() => setChatProjects(host, 1, "u2", "pr2", [])).toThrow("тот, кто начал беседу");
    setChatProjects(host, 1, "u1", "pr", [{accountId: 1, projectId: "s", title: "Склад", pinnedBy: "user"}]);
    expect(meta().projectContext).toMatchObject({projectId: "s", title: "Склад", creatorId: "u1"});
  });

  it("агент сам подключает проект по названию и переходит к коду; сообщение человека потом идёт в ту же сессию", async () => {
    const backend = new FakeBackend();
    backend.pages = [{events: [role(1, "a", "assistant")], state: "idle"}];
    const user: Partial<CodeWorkUser> = {
      async listChatProjects() { return [{accountId: 3, projectId: "sales", title: "Продажи", hasCode: true}]; },
      async codeWorkTarget() { return {title: "Продажи", code: TARGET}; },
      codeWorkStart: (_a, p, t, prompt) => backend.start(p, t, prompt),
      codeWorkMessage: (_a, p, t, text) => backend.message(p, t, text),
      codeWorkEvents: (_a, p, t, after, wait) => backend.events(p, t, after),
      codeWorkAbort: (_a, p, t) => backend.abort(p, t),
      codeWorkInterrupt: (_a, p, t) => backend.interrupt(p, t),
      codeWorkChanges: () => backend.changes(),
    };
    const {host, events, meta} = fakeHost(baseMeta(), user);
    const signal = new AbortController().signal;
    const output = await runChatCodeWork(host, {chatId: 1, toolCallId: "call", prompt: "почини", projectId: "продажи", userId: "u1", profileId: "pr", signal});
    expect(output.steps[0].title).toBe("Подключил проект «Продажи»");
    expect(chatProjects(meta().projectContext)).toEqual([{accountId: 3, projectId: "sales", title: "Продажи", pinnedBy: "agent", hasCode: true}]);
    expect(events.some(e => e.type === "toolStep" && e.toolCallId === "call")).toBe(true);
    expect(meta().codeWork).toMatchObject({taskId: "t1", state: "idle", foreground: true, cursor: 1, review: {outcome: "draft"}});
    expect(codeWorkForeground(meta())).toBe(true);

    backend.pages = [{events: [role(2, "a2", "assistant")], state: "idle"}];
    await runChatCodeWork(host, {chatId: 1, toolCallId: "call2", prompt: "а почему так?", continueOnly: true, userId: "u1", profileId: "pr", signal});
    expect(backend.calls.find(c => c[0] === "message")).toEqual(["message", "sales", "t1", "а почему так?"]);
    leaveCodeWork(host, 1);
    expect(codeWorkForeground(meta())).toBe(false);
  });

  it("без кода у проекта — понятный отказ; вопрос к завершённой работе — ответ по истории", async () => {
    const {host} = fakeHost(baseMeta({projectContext: {accountId: 1, projectId: "p", title: "P", projects: [{accountId: 1, projectId: "p", title: "P", pinnedBy: "user"}], creatorId: "u1", creatorProfileId: "pr"}}),
      {async codeWorkTarget() { return {title: "P"}; }});
    const signal = new AbortController().signal;
    await expect(runChatCodeWork(host, {chatId: 1, toolCallId: "c", prompt: "x", userId: "u1", profileId: "pr", signal})).rejects.toThrow("нет подключённого кода");
    await expect(runChatCodeWork(host, {chatId: 1, toolCallId: "c", prompt: "x", continueOnly: true, userId: "u1", profileId: "pr", signal})).rejects.toThrow("уже завершена");
  });

  it("«Принять» и «Вернуть как было»: только создатель беседы; итог записывается в беседу", async () => {
    const calls: unknown[][] = [];
    const work = {accountId: 1, projectId: "p", projectTitle: "P", taskId: "t1", state: "idle" as const, foreground: false, cursor: 3, summary: "Итог", review: {outcome: "draft" as const}};
    const {host, meta} = fakeHost(baseMeta({codeWork: work, projectContext: {accountId: 1, projectId: "p", title: "P", creatorId: "u1", creatorProfileId: "pr"}}), {
      async codeWorkAccept(...args) { calls.push(["accept", ...args]); return {outcome: "accepted", note: "Принято", mergeRequest: 7}; },
      async codeWorkRevert(...args) { calls.push(["revert", ...args]); return {outcome: "reverted", note: "Возвращено как было.", mergeRequest: 7}; },
    });
    await expect(acceptChatCodeChanges(host, 1, "u2")).rejects.toThrow("тот, кто начал беседу");
    await expect(revertChatCodeChanges(host, 1, "u1")).rejects.toThrow("только принятые");
    expect(await acceptChatCodeChanges(host, 1, "u1")).toEqual({outcome: "accepted", note: "Принято"});
    expect(calls[0]).toEqual(["accept", 1, "p", "t1", "Итог"]);
    expect(meta().codeWork?.review).toEqual({outcome: "accepted", note: "Принято", mergeRequest: 7});
    expect((await revertChatCodeChanges(host, 1, "u1")).outcome).toBe("reverted");
    expect(calls[1]).toEqual(["revert", 1, "p", "t1", 7]);
    expect(meta().codeWork?.review?.outcome).toBe("reverted");
  });

  it("«Что изменилось» группируется по репозиториям, только когда их несколько", async () => {
    const files = [{path: "a.go", status: "modified" as const, additions: 1, deletions: 0}];
    const repos = [
      {dir: "site", name: "site", files, diff: "diff --git a/a.go b/a.go", truncated: false},
      {dir: "api", name: "0123456789abcdef0123", files, diff: "", truncated: false},
    ];
    let value: Awaited<ReturnType<CodeWorkUser["codeWorkChanges"]>> = {files, diff: "", truncated: false, repositories: repos};
    const work = {accountId: 1, projectId: "p", projectTitle: "P", taskId: "t1", state: "idle" as const, foreground: false, cursor: 3, review: {outcome: "draft" as const}};
    const {host} = fakeHost(baseMeta({codeWork: work, projectContext: {accountId: 1, projectId: "p", title: "P", creatorId: "u1", creatorProfileId: "pr"}}), {
      async codeWorkChanges() { return value; },
    });
    const grouped = await readChatCodeChanges(host, 1);
    expect(grouped?.repositories?.map(r => r.name)).toEqual(["site", "api"]);
    expect(grouped?.repositories?.[0]).toEqual({name: "site", files, diff: "diff --git a/a.go b/a.go", truncated: false});
    value = {files, diff: "", truncated: false, repositories: [repos[0]]};
    expect((await readChatCodeChanges(host, 1))?.repositories).toBeUndefined();
  });

  it("путь в шаге — без каталога рабочего места; папка репозитория остаётся", () => {
    expect(relativePath("/workspace/repo/a.go")).toBe("a.go");
    expect(relativePath("/workspace/site/src/a.go")).toBe("site/src/a.go");
    expect(relativePath("/workspace/repository/a.go")).toBe("repository/a.go");
    expect(relativePath("a.go")).toBe("a.go");
  });
});
