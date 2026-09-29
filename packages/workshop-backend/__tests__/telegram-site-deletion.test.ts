// Удаление беседы на сайте и её тред Telegram (п. 45): удаление доходит до объекта бота повтором
// до подтверждения, а ход из треда в удалённую беседу не создаёт пустой чат.
import {describe, expect, it, vi} from "vitest";
import {EXTERNAL_CHAT_DELETED, OverseerDurableObject} from "../src/overseer.js";
import {makeMockStorage} from "./mock-storage.js";

vi.mock("capnweb-validate", () => ({validateRpc: () => () => undefined}));
vi.mock("cloudflare:workers", async importOriginal => {
  const workers = await importOriginal<typeof import("cloudflare:workers")>();
  return {...workers, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} }};
});

const ALICE = {type: "user" as const, id: "alice", name: "Алиса"};

function workspace() {
  const events: unknown[][] = [];
  const bot = {down: false};
  const pending: Promise<unknown>[] = [];
  const alarms: (number | null)[] = [];
  const storage = Object.assign(makeMockStorage(), {
    setAlarm: (at: number) => { alarms.push(at); },
    deleteAlarm: () => { alarms.push(null); },
  });
  const user = (name: string) => ({id: {toString: () => "id-" + name}, whoamiIfExists: async () => ({...ALICE, id: name})});
  const ctx = {
    storage, id: {toString: () => "workspace"}, waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    exports: {
      UserDurableObject: {getByName: user},
      TelegramPersonalBot: {getByName: () => ({siteEvent: async (...args: unknown[]) => {
        if (bot.down) throw new Error("Telegram site event is not delivered.");
        events.push(args);
      }})},
    },
  } as unknown as DurableObjectState;
  const object = new OverseerDurableObject(ctx, {} as Cloudflare.Env);
  const impl = object["impl"];
  impl.ownerId = "id-alice";
  impl.storage.chatMeta.put({id: 1, title: "Беседа", started: new Date(), lastActive: new Date(1)});
  impl.storage.externalChats.put({externalChatKey: "telegram:1:4242:90", chatId: 1});
  const settle = async () => { while (pending.length) await Promise.allSettled(pending.splice(0)); };
  const submit = (extra: Record<string, unknown> = {}) => object.receiveExternalMessage({
    callerEmail: "alice", externalChatKey: "telegram:1:4242:90", idempotencyKey: "telegram:1:77", prompt: "Ещё вопрос",
    chatGatewayRpcTarget: {} as never, title: "Беседа", channel: "telegram", ...extra,
  });
  return {object, impl, events, bot, settle, alarms, submit};
}

describe("удаление беседы → тред Telegram", () => {
  it("сбой доставки оставляет удаление и будит беседу; повтор доставляет и убирает запись", async () => {
    const w = workspace();
    w.bot.down = true;
    w.impl.queueTelegramDeletion({chatId: 1, key: "1:4242:90", owner: "alice"});
    await w.settle();
    const record = w.impl.storage.telegramDeletions.get(1);
    expect(record).toMatchObject({key: "1:4242:90", owner: "alice", attempts: 1});
    expect(record!.nextAt).toBeGreaterThan(Date.now());
    expect(w.alarms.at(-1)).toBe(record!.nextAt);
    expect(w.events).toEqual([]);

    // Срок повтора ещё не наступил — будильник запись не трогает.
    w.bot.down = false;
    await w.impl.deliverTelegramDeletions();
    expect(w.events).toEqual([]);

    w.impl.storage.telegramDeletions.put({...record!, nextAt: Date.now() - 1});
    await w.object.alarm();
    expect(w.events).toEqual([["alice", "1:4242:90", {type: "deleted"}]]);
    expect(w.impl.storage.telegramDeletions.get(1)).toBeUndefined();
    expect(w.alarms.at(-1)).toBeNull();
  });

  it("второй сбой удваивает паузу", async () => {
    const w = workspace();
    w.bot.down = true;
    w.impl.queueTelegramDeletion({chatId: 1, key: "1:4242:90", owner: "alice"});
    await w.settle();
    const first = w.impl.storage.telegramDeletions.get(1)!;
    w.impl.storage.telegramDeletions.put({...first, nextAt: 0});
    const before = Date.now();
    await w.impl.deliverTelegramDeletions();
    const second = w.impl.storage.telegramDeletions.get(1)!;
    expect(second.attempts).toBe(2);
    expect(second.nextAt - before).toBeGreaterThanOrEqual(2 * (first.nextAt - before) - 50);
  });
});

describe("ход из треда в удалённую беседу", () => {
  it("чат удалён на сайте: пустой чат не создаётся, вход отвечает «удалена» и просит снять связь", async () => {
    const w = workspace();
    w.impl.storage.chatMeta.delete(1);
    const newChat = vi.spyOn(w.impl, "newChat");
    const sendChat = vi.spyOn(w.impl, "sendChatMessage");
    await expect(w.submit()).resolves.toEqual({accepted: false, message: EXTERNAL_CHAT_DELETED, deletedOnSite: true});
    expect(EXTERNAL_CHAT_DELETED.startsWith("Эта беседа удалена на сайте")).toBe(true);
    expect(newChat).not.toHaveBeenCalled();
    expect(sendChat).not.toHaveBeenCalled();
    // Запись канала остаётся отметкой: повторное сообщение получает тот же ответ.
    await expect(w.submit()).resolves.toMatchObject({deletedOnSite: true});
  });

  it("беседа сайта, перенесённая в тред, без своего чата — тоже «удалена»", async () => {
    const w = workspace();
    const newChat = vi.spyOn(w.impl, "newChat");
    await expect(w.submit({externalChatKey: "telegram:1:4242:91", existingOnly: true})).resolves.toMatchObject({deletedOnSite: true});
    expect(newChat).not.toHaveBeenCalled();
  });

  it("беседа удалена целиком: отметка не даёт треду создать её заново", async () => {
    const w = workspace();
    w.impl.ownerId = undefined;
    w.impl.storage.deletedOnSite.put(true);
    await expect(w.submit()).resolves.toEqual({accepted: false, message: EXTERNAL_CHAT_DELETED, deletedOnSite: true});
    expect(w.impl.storage.ownerId.get()).toBeUndefined();
  });
});
