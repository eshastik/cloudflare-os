import { describe, it, expect } from "vitest";
import type { AiChatMessage, AiChatMetadata } from "@gadgets/workshop-shared/api";
import { formatCodeWorkResult } from "@gadgets/workshop-shared/code-work";
import type { CodeWorkEvent } from "../src/code-work-timeline";
import { gadgetLink, runChatCodeWork, type ChatCodeWorkHost, type CodeWorkUser } from "../src/chat-code-work";
import { formatCodeWorkPrompt } from "../src/agent";

const role = (seq: number, id: string): CodeWorkEvent => ({seq, type: "message.updated", data: {info: {id, role: "assistant"}}});
const HEAD1 = "1".repeat(64), HEAD2 = "2".repeat(64);

/** Подключение Mnemos человека: задача гаджета, события хода и сохранение сборки. */
function fakeUser() {
  const calls: unknown[][] = [];
  let pages: {events: CodeWorkEvent[]; state: "running" | "idle" | "stopped" | "failed"}[] = [];
  let saveError: Error | null = null;
  let heads = [HEAD1, HEAD2];
  let codeText: string | undefined;
  const user: Partial<CodeWorkUser> = {
    async listChatProjects() { return [{accountId: 3, projectId: "hr", title: "Кадры"}]; },
    async codeWorkTarget() { throw new Error("гаджету код проекта не нужен"); },
    async codeWorkStart() { throw new Error("гаджет не запускается как работа с кодом"); },
    async codeWorkStartGadget(accountId, project, prompt) { calls.push(["startGadget", accountId, project, prompt]); return {taskId: "g1", state: "starting", scopeExtended: false}; },
    async codeWorkMessage(accountId, project, task, text) { calls.push(["message", accountId, project, task, text]); },
    async codeWorkEvents(_a, _p, _t, after) {
      const page = pages.shift() ?? {events: [], state: "idle" as const};
      return {events: page.events, next: page.events.at(-1)?.seq ?? after, state: page.state};
    },
    async codeWorkAbort() {},
    async codeWorkInterrupt() {},
    async codeWorkChanges() { return {files: [], diff: "", truncated: false}; },
    async codeWorkSaveGadget(accountId, project, task, resource) {
      calls.push(["save", accountId, project, task, resource]);
      if (saveError) throw saveError;
      return {resource: resource ?? "node-7", head: heads.shift()!, title: "Отпуска", collaborative: true, session: true, created: !resource, vendorId: "mnemos", ...(codeText ? {codeText} : {})};
    },
  };
  return {user, calls, setPages: (p: typeof pages) => { pages = p; }, failSave: (e: Error | null) => { saveError = e; }, setCode: (text: string) => { codeText = text; }};
}

function host(user: Partial<CodeWorkUser>, meta: AiChatMetadata, publicBase?: string) {
  let current = structuredClone(meta);
  const emitted: unknown[] = [];
  const value: ChatCodeWorkHost = {
    chatMeta: () => structuredClone(current),
    putChatMeta: m => { current = structuredClone(m); },
    user: () => user as CodeWorkUser,
    emit: (_chat, event) => { emitted.push(event); },
    chatMessages: () => [],
    ...(publicBase ? {publicBase} : {}),
  };
  return {host: value, meta: () => current, emitted};
}

const chat = (): AiChatMetadata => ({id: 1, title: "t", started: new Date(0), lastActive: new Date(0),
  projectContext: {accountId: 3, projectId: "hr", title: "Кадры", projects: [{accountId: 3, projectId: "hr", title: "Кадры", pinnedBy: "user"}], creatorId: "u1", creatorProfileId: "pr"}});
const signal = () => new AbortController().signal;

describe("гаджет через агента кода", () => {
  it("первый ход создаёт узел гаджета, правка — новая версия того же узла; вместо ссылки — карточка", async () => {
    const {user, calls, setPages} = fakeUser();
    const {host: h, meta} = host(user, chat(), "https://os.example/");
    setPages([{events: [role(1, "a")], state: "idle"}]);
    const first = await runChatCodeWork(h, {chatId: 1, toolCallId: "c1", prompt: "Учёт отпусков для отдела, совместный", gadget: true, userId: "u1", profileId: "pr", signal: signal()});
    expect(calls[0]).toEqual(["startGadget", 3, "hr", expect.stringMatching(/Учёт отпусков для отдела, совместный$/)]);
    expect(calls.find(c => c[0] === "save")).toEqual(["save", 3, "hr", "g1", undefined]);
    expect(first.gadget).toEqual({saved: true, accountId: 3, projectId: "hr", resource: "node-7", title: "Отпуска", collaborative: true, created: true,
      link: "https://os.example/gatekeepers/mnemos?account=3&section=projects&project=hr&document=node-7"});
    expect(meta().gadgetWork).toMatchObject({taskId: "g1", foreground: false, gadget: {resource: "node-7", title: "Отпуска", head: HEAD1}});
    expect(meta().codeWork).toBeUndefined();
    const text = formatCodeWorkResult(first);
    // Гаджет открывается карточкой в ленте: агенту беседы адрес не передаётся, чтобы он не вставил ссылку.
    expect(text).not.toContain("gatekeepers/mnemos");
    expect(text).toContain("Гаджет — в карточке выше");
    expect(text).toContain("личной версией");
    expect(text).not.toContain("Что изменилось");

    setPages([{events: [role(2, "b")], state: "idle"}]);
    const second = await runChatCodeWork(h, {chatId: 1, toolCallId: "c2", prompt: "Добавь поле «замещающий»", gadget: true, userId: "u1", profileId: "pr", signal: signal()});
    expect(calls.filter(c => c[0] === "startGadget")).toHaveLength(1);
    expect(calls.find(c => c[0] === "message")!.slice(0, 4)).toEqual(["message", 3, "hr", "g1"]);
    expect(calls.filter(c => c[0] === "save").at(-1)).toEqual(["save", 3, "hr", "g1", "node-7"]);
    expect(second.gadget).toMatchObject({saved: true, resource: "node-7", created: false});
    expect(meta().gadgetWork?.gadget).toEqual({resource: "node-7", title: "Отпуска", head: HEAD2});
    expect(formatCodeWorkResult(second)).toContain("новой версией того же файла");
  });

  it("битая сборка не сохраняется: ход не падает, агент узнаёт причину, прежний узел остаётся", async () => {
    const {user, calls, setPages, failSave} = fakeUser();
    const {host: h, meta} = host(user, chat());
    setPages([{events: [role(1, "a")], state: "idle"}]);
    await runChatCodeWork(h, {chatId: 1, toolCallId: "c1", prompt: "гаджет", gadget: true, userId: "u1", profileId: "pr", signal: signal()});
    failSave(new Error("Сборка гаджета не годится: client.js не совпадает с суммой в gadget.json"));
    setPages([{events: [role(2, "b")], state: "idle"}]);
    const out = await runChatCodeWork(h, {chatId: 1, toolCallId: "c2", prompt: "поправь", gadget: true, userId: "u1", profileId: "pr", signal: signal()});
    expect(out.gadget).toEqual({saved: false, error: "Не удалось сохранить сборку гаджета."});
    expect(meta().gadgetWork?.gadget).toEqual({resource: "node-7", title: "Отпуска", head: HEAD1});
    const text = formatCodeWorkResult(out);
    expect(text).toContain("Гаджет не сохранён");
    expect(text).not.toContain("Открыть гаджет");
    expect(calls.filter(c => c[0] === "save")).toHaveLength(2);
  });

  it("упавшая работа сборку не забирает; без публичного адреса ссылки нет", async () => {
    const {user, calls, setPages} = fakeUser();
    const {host: h} = host(user, chat());
    setPages([{events: [], state: "failed"}]);
    const out = await runChatCodeWork(h, {chatId: 1, toolCallId: "c1", prompt: "гаджет", gadget: true, userId: "u1", profileId: "pr", signal: signal()});
    expect(out.gadget?.saved).toBe(false);
    expect(calls.some(c => c[0] === "save")).toBe(false);
    expect(gadgetLink(undefined, "mnemos", 1, "p", "n")).toBeUndefined();
    expect(gadgetLink("http://os.example", "mnemos", 1, "p", "n")).toBeUndefined();
    expect(gadgetLink("https://os.example", "mnemos/../x", 1, "p q", "n&x")).toBe("https://os.example/gatekeepers/mnemos%2F..%2Fx?account=1&section=projects&project=p+q&document=n%26x");
  });

  it("работа над гаджетом не трогает живую работу с кодом", async () => {
    const {user, setPages} = fakeUser();
    const code = {accountId: 3, projectId: "hr", projectTitle: "Кадры", taskId: "c9", state: "idle" as const, foreground: true, cursor: 5, review: {outcome: "draft" as const}};
    const {host: h, meta} = host(user, {...chat(), codeWork: code});
    setPages([{events: [role(1, "a")], state: "idle"}]);
    await runChatCodeWork(h, {chatId: 1, toolCallId: "c1", prompt: "гаджет", gadget: true, userId: "u1", profileId: "pr", signal: signal()});
    expect(meta().codeWork).toEqual(code);
    expect(meta().gadgetWork?.taskId).toBe("g1");
  });

  it("«поправь» после истечения задачи: новая задача продолжает исходники того же узла и пишет новую версию", async () => {
    const {user, calls, setPages} = fakeUser();
    let tasks = 0;
    const starts: unknown[] = [];
    user.codeWorkStartGadget = async (_a, _p, _prompt, options) => { starts.push(options); return {taskId: `g${++tasks}`, state: "starting", scopeExtended: false, ...(options?.resource ? {sourcesRestored: true} : {})}; };
    const {host: h, meta} = host(user, chat());
    setPages([{events: [role(1, "a")], state: "idle"}]);
    await runChatCodeWork(h, {chatId: 1, toolCallId: "c1", prompt: "Учёт отпусков", gadget: true, userId: "u1", profileId: "pr", signal: signal()});
    expect(meta().gadgetWork?.gadget?.resource).toBe("node-7");
    // Ключ агента не обновлялся — служба остановила задачу.
    h.putChatMeta({...meta(), gadgetWork: {...meta().gadgetWork!, state: "stopped"}});
    const steps: string[] = [];
    h.emit = (_id, event) => { if (event.type === "toolStep") steps.push(event.step.title); };
    setPages([{events: [role(2, "b")], state: "idle"}]);
    const out = await runChatCodeWork(h, {chatId: 1, toolCallId: "c2", prompt: "Добавь поле «замещающий»", gadget: true, userId: "u1", profileId: "pr", signal: signal()});
    expect(starts).toEqual([undefined, {resource: "node-7"}]);
    expect(calls.filter(c => c[0] === "save").at(-1)).toEqual(["save", 3, "hr", "g2", "node-7"]);
    expect(out.gadget).toMatchObject({saved: true, resource: "node-7", created: false});
    expect(meta().gadgetWork).toMatchObject({taskId: "g2", gadget: {resource: "node-7", head: HEAD2}});
    expect(steps).toContain("Продолжил прошлую версию гаджета");
    expect(formatCodeWorkPrompt({projects: [], mode: "auto", gadget: {projectTitle: "Кадры", alive: false, title: "Отпуска"}}))
      .toContain("продолжит сохранённые исходники и запишет новую версию того же файла");

    // Другой гаджет — только по явной просьбе: новая задача без узла и новый узел.
    setPages([{events: [role(3, "c")], state: "idle"}]);
    await runChatCodeWork(h, {chatId: 1, toolCallId: "c3", prompt: "Сделай ещё опросник", gadget: true, newGadget: true, userId: "u1", profileId: "pr", signal: signal()});
    expect(starts.at(-1)).toBeUndefined();
    expect(calls.filter(c => c[0] === "save").at(-1)).toEqual(["save", 3, "hr", "g3", undefined]);
  });

  it("повтор создания после потерянного ответа: квитанция в беседе до вызова, узел один", async () => {
    const {user, setPages} = fakeUser();
    const nodes = new Map<string, string>();
    const saves: unknown[][] = [];
    let lose = true;
    user.codeWorkSaveGadget = async (_a, _p, task, resource, options) => {
      saves.push([task, resource, options]);
      if (resource) return {resource, head: HEAD2, title: "Отпуска", collaborative: true, session: true, created: false};
      const request = options!.request!;
      if (!nodes.has(request)) nodes.set(request, `node-${nodes.size + 1}`);
      if (lose) { lose = false; throw new Error("Network connection lost."); }
      return {resource: nodes.get(request)!, head: HEAD1, title: "Отпуска", collaborative: true, session: true, created: true};
    };
    const {host: h, meta} = host(user, chat());
    setPages([{events: [role(1, "a")], state: "idle"}]);
    const first = await runChatCodeWork(h, {chatId: 1, toolCallId: "c1", prompt: "Учёт отпусков", gadget: true, userId: "u1", profileId: "pr", signal: signal()});
    expect(first.gadget?.saved).toBe(false);
    const request = meta().gadgetWork?.gadgetRequest;
    expect(request).toMatch(/^[0-9a-f-]{36}$/);
    expect(meta().gadgetWork?.gadget).toBeUndefined();
    // Задача успела истечь: новая задача, но квитанция та же.
    h.putChatMeta({...meta(), gadgetWork: {...meta().gadgetWork!, state: "stopped"}});
    setPages([{events: [role(2, "b")], state: "idle"}]);
    const second = await runChatCodeWork(h, {chatId: 1, toolCallId: "c2", prompt: "Учёт отпусков", gadget: true, userId: "u1", profileId: "pr", signal: signal()});
    expect(saves.map(s => (s[2] as {request?: string} | undefined)?.request)).toEqual([request, request]);
    expect(nodes.size).toBe(1);
    expect(second.gadget).toMatchObject({saved: true, resource: "node-1"});
    expect(meta().gadgetWork?.gadget?.resource).toBe("node-1");
    expect(meta().gadgetWork?.gadgetRequest).toBeUndefined();
    // Квитанция записана в беседу раньше, чем ушёл вызов сохранения.
    let seenBeforeCall: string | undefined;
    const {user: u2, setPages: pages2} = fakeUser();
    const {host: h2, meta: meta2} = host(u2, chat());
    u2.codeWorkSaveGadget = async (_a, _p, _t, _r, options) => { seenBeforeCall = meta2().gadgetWork?.gadgetRequest; expect(options?.request).toBe(seenBeforeCall); throw new Error("нет ответа"); };
    pages2([{events: [role(1, "a")], state: "idle"}]);
    await runChatCodeWork(h2, {chatId: 1, toolCallId: "c1", prompt: "гаджет", gadget: true, userId: "u1", profileId: "pr", signal: signal()});
    expect(seenBeforeCall).toBeTruthy();
  });

  it("исходники не сохранились — агент беседы узнаёт, что следующая правка начнётся с шаблона", async () => {
    const {user, setPages} = fakeUser();
    user.codeWorkSaveGadget = async () => ({resource: "node-7", head: HEAD1, title: "Отпуска", collaborative: false, session: false, created: true,
      sourcesKept: false, sourcesNote: "исходники гаджета больше 8 МиБ в архиве"});
    const {host: h} = host(user, chat());
    setPages([{events: [role(1, "a")], state: "idle"}]);
    const out = await runChatCodeWork(h, {chatId: 1, toolCallId: "c1", prompt: "гаджет", gadget: true, userId: "u1", profileId: "pr", signal: signal()});
    expect(out.gadget).toMatchObject({saved: true, sourcesNote: "исходники не сохранены"});
    expect(formatCodeWorkResult(out)).toContain("Следующая правка начнётся с чистого шаблона");
  });

  it("подсказка агенту: когда звать агента кода и что спросить у человека", () => {
    const text = formatCodeWorkPrompt({projects: [], mode: "auto"});
    expect(text).toContain("gadgetWork");
    expect(text).toContain("сложнее одной простой формы");
    expect(text).toMatch(/совместное ли приложение/);
    expect(text).toMatch(/кто участники/);
    expect(formatCodeWorkPrompt({projects: [], mode: "off"})).not.toContain("gadgetWork");
  });
});

const text = (seq: number, id: string, message: string, value: string): CodeWorkEvent => ({seq, type: "message.part.updated", data: {part: {id, messageID: message, type: "text", text: value}}});
const SERVER_LINE = "export class Gadget extends DurableObject { session(caller) { return new Session(this, caller); } }";

describe("результат работы гаджета без исходников", () => {
  it.each(["Содержимое server.js: " + SERVER_LINE, "```js\n" + SERVER_LINE + "\n```", "Короткий пример: export default () => 7;"])("ответ, ошибка сохранения и прежняя сводка не передают исходник: %s", async answer => {
      for (const fails of [false, true]) {
        const {user, setPages, setCode, failSave} = fakeUser();
        setCode(SERVER_LINE);
        const prior = {accountId: 3, projectId: "hr", projectTitle: "Кадры", taskId: "old", state: "stopped" as const,
          foreground: false, cursor: 0, summary: SERVER_LINE};
        const {host: h, meta, emitted} = host(user, {...chat(), gadgetWork: prior});
        if (fails) failSave(new Error("save refused: " + SERVER_LINE));
        setPages([{events: [role(1, "a"), text(2, "t1", "a", answer)], state: "idle"}]);
        const out = await runChatCodeWork(h, {chatId: 1, toolCallId: "c1", prompt: "гаджет", gadget: true, userId: "u1", profileId: "pr", signal: signal()});
        expect(out.answer).toBe("");
        expect(out.gadget?.saved).toBe(!fails);
        expect(JSON.stringify(out)).not.toContain(SERVER_LINE);
        expect(formatCodeWorkResult(out)).not.toContain("export");
        expect(meta().gadgetWork?.summary).toBe("");
        expect(emitted.filter(e => (e as {type: string}).type === "toolOutputDelta")).toEqual([]);
      }
    });
});


const failureMessage = (sequence: number, author: "user" | "agent"): AiChatMessage =>
  ({chatId: 1, sequence, timestamp: new Date(0), author: {type: author, id: author, name: "Анна"}, type: "message", message: "Попробуй снова"} as AiChatMessage);

describe("отказ запуска гаджета", () => {
  it.each([
    "OpenCode не ответил: HTTP 399",
    "сессия OpenCode не создана: HTTP 600",
    "secret-prefix OpenCode не ответил: HTTP 503",
    "задача не передана агенту: HTTP 429 secret-suffix",
    "сессия OpenCode не создана: HTTP 401\nsecret-password",
    "другой этап: HTTP 401",
  ])("неизвестный или дополненный текст причины %s не попадает в беседу", async (reason) => {
    const {user, setPages} = fakeUser();
    const {host: h} = host(user, chat());
    setPages([{events: [{seq: 1, type: "workspace.state", data: {state: "failed", reason}}], state: "failed"}]);
    const out = await runChatCodeWork(h, {chatId: 1, toolCallId: "c1", prompt: "гаджет", gadget: true, userId: "u1", profileId: "pr", signal: signal()});
    expect(out.gadget?.error).toBe("Работа над гаджетом прервалась");
    expect(formatCodeWorkResult(out)).not.toContain(reason);
    expect(formatCodeWorkResult(out)).not.toContain("secret-");
  });
  it.each([
    ["OpenCode не ответил: HTTP 503", "OpenCode не ответил: HTTP 503."],
    ["сессия OpenCode не создана: HTTP 401", "Не удалось создать сессию OpenCode: HTTP 401."],
    ["задача не передана агенту: HTTP 429", "Не удалось передать задачу агенту: HTTP 429."],
  ])("HTTP-причина %s доходит до результата беседы", async (reason, expected) => {
    const {user, setPages} = fakeUser();
    const {host: h} = host(user, chat());
    setPages([{events: [{seq: 1, type: "workspace.state", data: {state: "failed", reason}}], state: "failed"}]);
    const out = await runChatCodeWork(h, {chatId: 1, toolCallId: "c1", prompt: "гаджет", gadget: true, userId: "u1", profileId: "pr", signal: signal()});
    expect(out.gadget?.error).toBe(`Работа над гаджетом прервалась: ${expected}`);
    expect(formatCodeWorkResult(out)).toContain(expected);
  });
  it("причина модели доходит до итога и не предлагает автоматический повтор", async () => {
    const {user, calls, setPages} = fakeUser();
    const {host: h} = host(user, chat());
    setPages([{events: [{seq: 1, type: "workspace.state", data: {state: "failed", reason: "модель OpenCode не найдена"}}], state: "failed"}]);
    const out = await runChatCodeWork(h, {chatId: 1, toolCallId: "c1", prompt: "гаджет", gadget: true, userId: "u1", profileId: "pr", signal: signal()});
    expect(out.gadget).toMatchObject({saved: false, error: expect.stringContaining("Модель для задачи недоступна")});
    expect(formatCodeWorkResult(out)).toContain("Модель для задачи недоступна");
    expect(formatCodeWorkResult(out)).toContain("Не повторяй запуск автоматически");
    expect(calls.filter(c => c[0] === "startGadget")).toHaveLength(1);
    expect(calls.some(c => c[0] === "save")).toBe(false);
  });
  it("после отказа новые аргументы и ответы агента не запускают задачу до нового сообщения человека", async () => {
    const {user, calls, setPages} = fakeUser();
    const {host: h} = host(user, chat());
    const messages = [failureMessage(0, "user")];
    h.chatMessages = (_id, after) => messages.filter(m => m.sequence > after);
    const request = {chatId: 1, toolCallId: "c1", prompt: "гаджет", gadget: true, userId: "u1", profileId: "pr", signal: signal()};
    setPages([{events: [], state: "failed"}]);
    await runChatCodeWork(h, request);
    await expect(runChatCodeWork(h, {...request, toolCallId: "c2", prompt: "другой текст", newGadget: true})).rejects.toThrow("нового сообщения человека");
    messages.push(failureMessage(1, "agent"));
    await expect(runChatCodeWork(h, {...request, toolCallId: "c3"})).rejects.toThrow("нового сообщения человека");
    expect(calls.filter(c => c[0] === "startGadget")).toHaveLength(1);
    messages.push(failureMessage(2, "user"));
    setPages([{events: [role(2, "a")], state: "idle"}]);
    const retried = await runChatCodeWork(h, {...request, toolCallId: "c4"});
    expect(retried.gadget?.saved).toBe(true);
    expect(calls.filter(c => c[0] === "startGadget")).toHaveLength(2);
  });
});
