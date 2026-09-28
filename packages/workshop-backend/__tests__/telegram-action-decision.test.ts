// Этап 4 ADR 0027 Mnemos: серверный вход решения по действию (кнопка в треде Telegram). Беседа
// проверяет, кто решает, чья это беседа и ждёт ли действие решения; дальше — тот же путь, что у
// кнопки на сайте, с тем же журналом.
import {describe, expect, it, vi} from "vitest";
import type {ActionRecord} from "../src/overseer.js";
import {OverseerDurableObject, externalDecision, extrasForTelegramOwner} from "../src/overseer.js";
import {makeMockStorage} from "./mock-storage.js";

vi.mock("capnweb-validate", () => ({validateRpc: () => () => undefined}));
vi.mock("cloudflare:workers", async importOriginal => {
  const workers = await importOriginal<typeof import("cloudflare:workers")>();
  return {...workers, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} }};
});

const ALICE = {type: "user" as const, id: "alice", name: "Алиса"};
const description = {title: "Опубликовать отчёт", description: "Опубликовать «Отчёт».", implementsRevert: false};

function workspace() {
  const events: unknown[][] = [];
  const pending: Promise<unknown>[] = [];
  const user = (name: string) => ({
    id: {toString: () => "id-" + name},
    whoamiIfExists: async () => (name === "alice" ? ALICE : {type: "user", id: name, name}),
  });
  const ctx = {
    storage: makeMockStorage(), id: {toString: () => "workspace"}, waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    exports: {
      UserDurableObject: {getByName: user},
      TelegramPersonalBot: {getByName: () => ({siteEvent: async (...args: unknown[]) => { events.push(args); }})},
    },
  } as unknown as DurableObjectState;
  const object = new OverseerDurableObject(ctx, {} as Cloudflare.Env);
  const impl = object["impl"];
  impl.ownerId = "id-alice";
  for (const id of [1, 2]) impl.storage.chatMeta.put({id, title: "Беседа", started: new Date(), lastActive: new Date(id)});
  impl.storage.externalChats.put({externalChatKey: "telegram:1:4242:90", chatId: 1});
  impl.storage.telegramLinks.put({chatId: 1, key: "1:4242:90", owner: "alice"});
  const put = (id: number, extra: Partial<ActionRecord & {type: "action"}> = {}) => impl.storage.actions.put({
    id, gatekeeperId: 3, caller: {from: "agent", chatId: 1}, action: 40 + id, createdAt: new Date(), state: "pending", type: "action",
    description, ...extra,
  } as ActionRecord);
  const apply = vi.fn(async () => {});
  const reject = vi.fn(async () => {});
  vi.spyOn(impl, "getGatekeeperFacet").mockReturnValue({applyAction: apply, rejectAction: reject} as unknown as ReturnType<typeof impl.getGatekeeperFacet>);
  vi.spyOn(impl, "drainAutoApprovals").mockResolvedValue();
  const observer = vi.spyOn(impl, "ensureObserver").mockResolvedValue(undefined as never);
  const settle = async () => { while (pending.length) await Promise.allSettled(pending.splice(0)); };
  return {object, impl, put, apply, reject, events, settle, observer};
}

describe("решение кнопкой в Telegram", () => {
  it("владелец подтверждает: действие применено, в журнале — его профиль, как при решении на сайте", async () => {
    const w = workspace();
    w.put(5);
    await expect(w.object.decideExternalAction("alice", "telegram:1:4242:90", 5, "approve")).resolves.toEqual({status: "approved"});
    expect(w.apply).toHaveBeenCalledWith(45);
    const record = w.impl.storage.actions.get(5) as ActionRecord & {type: "action"};
    expect(record).toMatchObject({state: "approved", resolvedBy: ALICE, autoApproved: false});
    await w.settle();
    expect(w.events).toEqual([["alice", "1:4242:90", {type: "decided", action: 5, state: "approved"}]]);
  });

  it("владелец отклоняет", async () => {
    const w = workspace();
    w.put(6);
    await expect(w.object.decideExternalAction("alice", "telegram:1:4242:90", 6, "reject")).resolves.toEqual({status: "rejected"});
    expect(w.reject).toHaveBeenCalledWith(46);
    expect(w.apply).not.toHaveBeenCalled();
    expect(w.impl.storage.actions.get(6)).toMatchObject({state: "rejected", resolvedBy: ALICE});
  });

  it("не владелец беседы — отказ без действия", async () => {
    const w = workspace();
    w.put(5);
    await expect(w.object.decideExternalAction("mallory", "telegram:1:4242:90", 5, "approve")).resolves.toEqual({status: "denied"});
    expect(w.apply).not.toHaveBeenCalled();
    expect(w.impl.storage.actions.get(5)?.state).toBe("pending");
  });

  it("тред не связан с беседой — отказ; действие другого чата — карточка устарела", async () => {
    const w = workspace();
    w.put(5);
    w.put(7, {caller: {from: "agent", chatId: 2}});
    await expect(w.object.decideExternalAction("alice", "telegram:1:4242:91", 5, "approve")).resolves.toEqual({status: "denied"});
    await expect(w.object.decideExternalAction("alice", "telegram:1:4242:90", 7, "approve")).resolves.toEqual({status: "stale", state: "missing"});
    await expect(w.object.decideExternalAction("alice", "telegram:1:4242:90", 99, "approve")).resolves.toEqual({status: "stale", state: "missing"});
    expect(w.apply).not.toHaveBeenCalled();
  });

  it("действие уже решено — устарело, второго применения нет", async () => {
    const w = workspace();
    w.put(5);
    await w.object.decideExternalAction("alice", "telegram:1:4242:90", 5, "approve");
    await expect(w.object.decideExternalAction("alice", "telegram:1:4242:90", 5, "approve")).resolves.toEqual({status: "stale", state: "approved"});
    await expect(w.object.decideExternalAction("alice", "telegram:1:4242:90", 5, "reject")).resolves.toEqual({status: "stale", state: "approved"});
    expect(w.apply).toHaveBeenCalledOnce();
    expect(w.reject).not.toHaveBeenCalled();
  });

  it("два решения одновременно — применяется одно", async () => {
    const w = workspace();
    w.put(5);
    const results = await Promise.allSettled([
      w.object.decideExternalAction("alice", "telegram:1:4242:90", 5, "approve"),
      w.object.decideExternalAction("alice", "telegram:1:4242:90", 5, "approve"),
    ]);
    expect(w.apply).toHaveBeenCalledOnce();
    expect(results.filter(r => r.status === "fulfilled" && (r.value as {status: string}).status === "approved")).toHaveLength(1);
  });

  it("неверные входные данные — отказ", async () => {
    const w = workspace();
    w.put(5);
    for (const [action, decision] of [[-1, "approve"], [1.5, "approve"], [5, "maybe"]] as const) {
      await expect(w.object.decideExternalAction("alice", "telegram:1:4242:90", action, decision as "approve")).resolves.toEqual({status: "denied"});
    }
    expect(w.apply).not.toHaveBeenCalled();
  });

  it("решение на сайте тем же путём обновляет карточку в треде", async () => {
    const w = workspace();
    w.put(8);
    const user = {id: {toString: () => "id-alice"}} as never;
    await w.impl.decideAction(8, "reject", {profile: async () => ALICE, user, isOwner: true});
    await w.settle();
    expect(w.events).toEqual([["alice", "1:4242:90", {type: "decided", action: 8, state: "rejected"}]]);
  });

  it("доступ к источникам беседы отозван — действие не применено, ход не возобновлён", async () => {
    const w = workspace();
    w.put(5, {description: {...description, awaitDecision: true}});
    w.observer.mockRejectedValue(new Error("source revoked"));
    await expect(w.object.decideExternalAction("alice", "telegram:1:4242:90", 5, "approve")).resolves.toEqual({status: "access_changed"});
    expect(w.observer).toHaveBeenCalledWith("alice", expect.anything(), "build");
    expect(w.apply).not.toHaveBeenCalled();
    expect(w.impl.storage.actions.get(5)?.state).toBe("pending");
  });
});

describe("что уходит карточкой в Telegram", () => {
  const record = (desc: object) => ({id: 3, gatekeeperId: 1, caller: {from: "agent", chatId: 1}, action: 1, createdAt: new Date(),
    state: "pending", type: "action", description: {...description, ...desc}}) as ActionRecord & {type: "action"};

  it("кнопкой решается только действие с полной карточкой; описание — целиком", () => {
    expect(externalDecision(record({}))).toBeNull();
    expect(externalDecision(record({card: {icon: "publish", details: []}}))).toBeNull();
    expect(externalDecision(record({card: {icon: "connection", details: ["Почта"], open: {section: "connections", label: "Открыть"}}}))).toBeNull();
    const text = "Длинное описание. ".repeat(100);
    expect(externalDecision(record({description: text, card: {icon: "publish", details: ["Проект «Продажи»"]}}))).toEqual({
      action: 3, title: "Опубликовать отчёт", details: ["Проект «Продажи»"], description: text,
    });
  });

  it("ход соавтора: без карточек, строка с его именем; ход владельца — как есть", () => {
    const extras = {decisions: [{action: 3, title: "Т", details: ["д"], description: "о"}], documents: ["План"]};
    expect(extrasForTelegramOwner(extras, {type: "user", id: "bob", name: "Боб"}, "alice")).toEqual({documents: ["План"], waitingFor: "Боб"});
    expect(extrasForTelegramOwner(extras, ALICE, "alice")).toBe(extras);
    expect(extrasForTelegramOwner({documents: ["План"]}, {type: "user", id: "bob", name: "Боб"}, "alice")).toEqual({documents: ["План"]});
  });
});
