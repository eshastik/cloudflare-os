import { describe, it, expect } from "vitest";
import type { AiChatMetadata } from "@gadgets/workshop-shared/api";
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
      return {resource: resource ?? "node-7", head: heads.shift()!, title: "Отпуска", collaborative: true, session: true, created: !resource, vendorId: "mnemos"};
    },
  };
  return {user, calls, setPages: (p: typeof pages) => { pages = p; }, failSave: (e: Error | null) => { saveError = e; }};
}

function host(user: Partial<CodeWorkUser>, meta: AiChatMetadata, publicBase?: string) {
  let current = structuredClone(meta);
  const value: ChatCodeWorkHost = {
    chatMeta: () => structuredClone(current),
    putChatMeta: m => { current = structuredClone(m); },
    user: () => user as CodeWorkUser,
    emit: () => {},
    chatMessages: () => [],
    ...(publicBase ? {publicBase} : {}),
  };
  return {host: value, meta: () => current};
}

const chat = (): AiChatMetadata => ({id: 1, title: "t", started: new Date(0), lastActive: new Date(0),
  projectContext: {accountId: 3, projectId: "hr", title: "Кадры", projects: [{accountId: 3, projectId: "hr", title: "Кадры", pinnedBy: "user"}], creatorId: "u1", creatorProfileId: "pr"}});
const signal = () => new AbortController().signal;

describe("гаджет через агента кода", () => {
  it("первый ход создаёт узел гаджета, правка — новая версия того же узла; ссылка «Открыть гаджет»", async () => {
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
    expect(text).toContain("[Открыть гаджет](https://os.example/gatekeepers/mnemos?account=3&section=projects&project=hr&document=node-7)");
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
    expect(out.gadget).toEqual({saved: false, error: "Сборка гаджета не годится: client.js не совпадает с суммой в gadget.json"});
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

  it("подсказка агенту: когда звать агента кода и что спросить у человека", () => {
    const text = formatCodeWorkPrompt({projects: [], mode: "auto"});
    expect(text).toContain("gadgetWork");
    expect(text).toContain("сложнее одной простой формы");
    expect(text).toMatch(/совместное ли приложение/);
    expect(text).toMatch(/кто участники/);
    expect(formatCodeWorkPrompt({projects: [], mode: "off"})).not.toContain("gadgetWork");
  });
});
