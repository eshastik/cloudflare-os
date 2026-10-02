// Этапы 3–4 ADR 0027 Mnemos целиком: беседа сайта ↔ тред Telegram и решения кнопками. Telegram,
// модель и ресурс, выполняющий действие, подставные: fetch перехватывается, модель — совместимый с
// OpenAI поток, ресурс действия подменяется в объекте беседы.
import { exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { AiChatAuthorInfo, AuthenticatedApi, Overseer, PublicApi } from "@gadgets/workshop-shared/api";
import { afterEach, expect, it, vi } from "vitest";
import { sealSecret } from "../src/telegram/secret-box";

const KEY = "integration-test-shell-secrets-key-0123456789";
const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ";
const BOT = "123456789";
const SECRET = "t".repeat(43);
const ALICE_TG = 4343;
const ANSWER = "Смета готова: **120 000**.";
const TITLE = "Смета на ремонт";

type Call = { method: string; body: Record<string, unknown> };

afterEach(() => { vi.unstubAllGlobals(); });

async function sha256(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, "0")).join("");
}

function sse(text: string): Response {
  let chunk = (delta: object, finish: string | null, usage?: object) => "data: " + JSON.stringify({
    id: "c1", object: "chat.completion.chunk", created: 1, model: "fake",
    choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}),
  }) + "\n\n";
  return new Response(chunk({ role: "assistant", content: text }, null) +
    chunk({}, "stop", { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }) + "data: [DONE]\n\n",
  { headers: { "content-type": "text/event-stream" } });
}

function stubNetwork() {
  let telegram: Call[] = [];
  let model = { requests: 0, prompts: [] as string[] };
  let gone = new Set<number>();
  let nextThread = 700;
  // Ход, в котором агент ждёт решения: модель отвечает, только когда тест положил действие.
  let gates = new Map<string, Promise<void>>();
  let real = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://api.telegram.org/")) {
      let method = url.slice(url.lastIndexOf("/") + 1);
      let body = JSON.parse(String(init?.body ?? "{}"));
      telegram.push({ method, body });
      let ok = (result: unknown) => Response.json({ ok: true, result });
      if (typeof body.message_thread_id === "number" && gone.has(body.message_thread_id) && method !== "deleteForumTopic") {
        return Response.json({ ok: false, error_code: 400, description: "Bad Request: message thread not found" }, { status: 400 });
      }
      if (method === "sendMessage") return ok({ message_id: 900 + telegram.length, chat: { id: body.chat_id, type: "private" } });
      if (method === "createForumTopic") return ok({ message_thread_id: nextThread++, name: body.name, icon_color: 1 });
      return ok(true);
    }
    if (url.startsWith("https://model.invalid/")) {
      let body = input instanceof Request ? await input.text() : String(init?.body ?? "");
      if (body.includes("Придумай короткое понятное название")) return sse(TITLE);
      model.requests++;
      model.prompts.push(body);
      for (let [marker, gate] of gates) {
        if (body.includes(marker)) { gates.delete(marker); await gate; }
      }
      return sse(ANSWER);
    }
    return real(input, init);
  });
  return { telegram, model, gone, gates };
}

async function connect(): Promise<RpcStub<PublicApi>> {
  const response = await exports.default.fetch(new Request("https://workshop.invalid/api", { headers: { Upgrade: "websocket" } }));
  const socket = response.webSocket!;
  socket.accept();
  return newWebSocketRpcSession<PublicApi>(socket);
}

async function until<T>(check: () => T | undefined | false | Promise<T | undefined | false>, what: string): Promise<T> {
  for (let i = 0; i < 400; i++) {
    let value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("не дождались: " + what);
}

const html = (text: string) => text.replace("**120 000**", "<b>120 000</b>");

async function setup(net: ReturnType<typeof stubNetwork>) {
  const api = await connect();
  const name = "tgs" + crypto.randomUUID().replaceAll("-", "");
  const token = await api.createAccount(name, name, new Uint8Array([1, 2, 3]));
  const session = await api.authenticate(token!) as unknown as RpcStub<AuthenticatedApi>;
  await session.addModel({ type: "agent", id: "fake-model", name: "Подставная модель" } as AiChatAuthorInfo,
    { provider: "ollama", model: "fake", apiUrl: "https://model.invalid", apiToken: "" });
  const route = await runInDurableObject(exports.TelegramPersonalBot.getByName("user:" + name), async (_instance, state) => {
    state.storage.kv.put("bot", {
      owner: name, mnemos: null, bot: { id: BOT, username: "alice_helper_bot", title: "Помощник" },
      threads: { enabled: true, usersCanCreate: true }, checkedAt: Date.now(),
      token: await sealSecret(KEY, "telegram-bot-token", JSON.stringify(["telegram-bot", name, BOT]), TOKEN),
      secretSha256: await sha256(SECRET), pairing: null,
      telegramOwner: { id: ALICE_TG, name: "Алиса", username: null }, connectedAt: Date.now(), createdAt: Date.now(), seen: [],
    });
    return state.id.toString();
  });
  let update = 1;
  const hook = (payload: object) => exports.default.fetch(new Request("https://workshop.invalid/api/telegram/" + route, {
    method: "POST", headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": SECRET },
    body: JSON.stringify({ update_id: update++, ...payload }) }));
  const from = { id: ALICE_TG, is_bot: false, first_name: "Алиса" };
  const chat = { id: ALICE_TG, type: "private" };
  const say = (thread: number, text: string) => hook({ message: { message_id: 100 + update, message_thread_id: thread, is_topic_message: true, from, chat, text } });
  const press = (data: string, message: number, sender = from) =>
    hook({ callback_query: { id: "cb" + update, from: sender, chat_instance: "1", data, message: { message_id: message, date: 1, chat: { id: sender.id, type: "private" } } } });
  const sent = (filter: (call: Call) => boolean = () => true) => net.telegram.filter(call => call.method === "sendMessage" && filter(call));
  const idle = (overseer: RpcStub<Overseer>, chatId: number, agentMessages: number) => until(async () => {
    let meta = (await overseer.listChats()).find(item => item.id === chatId);
    let history = await overseer.getChatHistory(chatId);
    let agent = history.messages.filter(m => m.type === "message" && m.author.type === "agent").length;
    return meta && !meta.activeAgent && agent >= agentMessages;
  }, "конца хода");
  return { api, session, name, hook, say, press, sent, idle };
}

it("беседа сайта переносится в Telegram: тред, краткое содержание, зеркало без дублей, название, архив, удаление", async () => {
  const net = stubNetwork();
  const { session, name, say, sent, idle } = await setup(net);
  const overseer = await session.newGadget();
  const workspaceId = (await overseer.getMetadata()).id;
  const chatId = await overseer.newChat("Посчитай смету на ремонт", "fake-model");
  await idle(overseer, chatId, 1);
  // Пока беседа не перенесена, в Telegram ничего не уходит.
  expect(sent()).toEqual([]);
  expect(await overseer.getTelegramLink(chatId)).toEqual({ status: "available", bot: "alice_helper_bot" });

  // «Продолжить в Telegram»: тред с названием беседы и краткое содержание первым сообщением.
  const linked = await overseer.continueInTelegram(chatId);
  expect(linked).toEqual({ status: "linked", bot: "alice_helper_bot", url: "https://t.me/alice_helper_bot" });
  expect(net.telegram.find(call => call.method === "createForumTopic")?.body).toEqual({ chat_id: ALICE_TG, name: TITLE });
  const summary = sent()[0];
  expect(summary.body).toMatchObject({ chat_id: ALICE_TG, message_thread_id: 700, parse_mode: "HTML" });
  expect(String(summary.body.text)).toContain("Посчитай смету на ремонт");
  expect(String(summary.body.text)).toContain(html(ANSWER));
  // Повторное нажатие второго треда не создаёт.
  expect(await overseer.continueInTelegram(chatId)).toMatchObject({ status: "linked" });
  expect(net.telegram.filter(call => call.method === "createForumTopic")).toHaveLength(1);

  // Сообщение на сайте: в тред — с пометкой «с сайта», затем ответ агента, ровно один раз.
  await overseer.sendChatMessage(chatId, "Добавь плитку", "fake-model");
  await idle(overseer, chatId, 2);
  await until(() => sent().length >= 3, "зеркала хода с сайта");
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(sent().slice(1).map(call => [call.body.message_thread_id, call.body.text])).toEqual([
    [700, `<i>С сайта, ${name}:</i>\nДобавь плитку`],
    [700, html(ANSWER)],
  ]);

  // Сообщение из треда идёт в ту же беседу сайта; ответ — в тред один раз, без зеркала второго.
  expect((await say(700, "А с работой?")).status).toBe(200);
  await idle(overseer, chatId, 3);
  await until(() => sent().length >= 4, "ответа на сообщение из треда");
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(sent().slice(3).map(call => call.body.text)).toEqual([html(ANSWER)]);
  const history = await overseer.getChatHistory(chatId);
  expect(history.messages.some(m => m.type === "message" && m.message === "А с работой?")).toBe(true);
  // Отдельной беседы для треда не появилось: всё в беседе сайта.
  expect((await session.listGadgets()).filter(item => item.channel === "telegram")).toEqual([]);

  // Переименование на сайте → editForumTopic.
  await overseer.setTitle("Ремонт кухни");
  const rename = await until(() => net.telegram.find(call => call.method === "editForumTopic" && call.body.name === "Ремонт кухни"), "переименования треда");
  expect(rename.body).toEqual({ chat_id: ALICE_TG, message_thread_id: 700, name: "Ремонт кухни" });

  // Архив: в тред — «Беседа в архиве»; новое сообщение из треда возвращает беседу.
  await overseer.setArchived(true);
  expect((await session.listGadgets()).find(item => item.id === workspaceId)?.archived).toBe(true);
  await until(() => sent(call => String(call.body.text).startsWith("Беседа в архиве")).length, "сообщения об архиве");
  await say(700, "Вернёмся к смете");
  await idle(overseer, chatId, 4);
  expect((await session.listGadgets()).find(item => item.id === workspaceId)?.archived).toBeFalsy();

  // Удаление беседы на сайте удаляет тред.
  await overseer.deleteSelf();
  const deleted = await until(() => net.telegram.find(call => call.method === "deleteForumTopic"), "удаления треда");
  expect(deleted.body).toEqual({ chat_id: ALICE_TG, message_thread_id: 700 });
});

it("тред удалён в Telegram: связь снимается, «Продолжить в Telegram» создаёт новый тред", async () => {
  const net = stubNetwork();
  const { session, sent, idle } = await setup(net);
  const overseer = await session.newGadget();
  const chatId = await overseer.newChat("Составь план отпуска", "fake-model");
  await idle(overseer, chatId, 1);
  await overseer.continueInTelegram(chatId);
  net.gone.add(700);
  // Следующая отправка в тред узнаёт, что его нет.
  await overseer.sendChatMessage(chatId, "Добавь море", "fake-model");
  await idle(overseer, chatId, 2);
  expect(await until(async () => (await overseer.getTelegramLink(chatId)).status === "available" && "ok", "снятия связи")).toBe("ok");
  // Ответ на ход с сайта без треда в чат не уходит: беседа осталась на сайте.
  expect(sent(call => call.body.message_thread_id === undefined)).toEqual([]);
  expect(await overseer.continueInTelegram(chatId)).toMatchObject({ status: "linked" });
  expect(net.telegram.filter(call => call.method === "createForumTopic").map(call => call.body.name)).toHaveLength(2);
  await overseer.sendChatMessage(chatId, "И горы", "fake-model");
  await idle(overseer, chatId, 3);
  await until(() => sent(call => call.body.message_thread_id === 701 && call.body.text === html(ANSWER)).length, "ответа в новый тред");
});

it("решение кнопкой в треде: подтверждение владельцем, чужой и повтор без действия, решение на сайте обновляет карточку", async () => {
  const net = stubNetwork();
  const { session, say, press, sent, idle } = await setup(net);
  let release!: () => void;
  net.gates.set("Опубликуй отчёт", new Promise<void>(resolve => { release = resolve; }));
  expect((await say(55, "Опубликуй отчёт")).status).toBe(200);

  // Пока модель «думает», агент кладёт в беседу два действия, ждущих решения (как gatekeeper).
  const workspace = exports.OverseerDurableObject.getByName(`telegram:${BOT}:${ALICE_TG}:55`);
  const applied: number[] = [];
  const setupActions = await until(() => runInDurableObject(workspace, async instance => {
    const impl = (instance as unknown as { impl: any }).impl;
    const chat = impl.storage.externalChats.get(`telegram:${BOT}:${ALICE_TG}:55`);
    if (!chat) return false;
    impl.getGatekeeperFacet = () => ({ applyAction: async (action: number) => { applied.push(action); }, rejectAction: async () => {} });
    const ids: number[] = [];
    for (const title of ["Опубликовать «Отчёт за сентябрь»", "Поделиться с отделом продаж"]) {
      const id = impl.storage.nextActionId.get();
      impl.storage.nextActionId.put(id + 1);
      impl.storage.actions.put({ id, gatekeeperId: 77, caller: { from: "agent", chatId: chat.chatId }, action: 500 + id, createdAt: new Date(),
        state: "pending", type: "action", description: { title, description: "Проект «Продажи»", implementsRevert: false, card: { icon: "publish", details: ["Проект «Продажи»"] } } });
      impl.addChatMessages(chat.chatId, { type: "agent", id: "fake-model", name: "Подставная модель" }, [{ type: "action", actionId: id }]);
      ids.push(id);
    }
    return { chatId: chat.chatId as number, ids };
  }), "беседы из треда");
  release();

  // Итог хода: ответ и карточки с кнопками вместо ссылки на сайт.
  const cards = await until(() => { let list = sent(call => !!call.body.reply_markup); return list.length === 2 && list; }, "карточек");
  const buttons = (call: Call) => (call.body.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0].map(b => b.callback_data);
  expect(String(cards[0].body.text)).toContain("Опубликовать «Отчёт за сентябрь»");
  expect(sent(call => String(call.body.text).includes("откройте беседу на сайте"))).toEqual([]);
  const [approve] = buttons(cards[0]);
  const message = 900 + net.telegram.indexOf(cards[0]) + 1;

  // Чужой нажавший — ничего.
  await press(approve, message, { id: 777, is_bot: false, first_name: "Мэллори" });
  await new Promise(resolve => setTimeout(resolve, 150));
  expect(net.telegram.filter(call => call.method === "answerCallbackQuery")).toEqual([]);

  // Владелец подтверждает: действие применено, журнал — как у решения на сайте.
  await press(approve, message);
  const answered = await until(() => net.telegram.find(call => call.method === "answerCallbackQuery"), "ответа на нажатие");
  expect(answered.body).toMatchObject({ text: "Подтверждено" });
  const edit = await until(() => net.telegram.find(call => call.method === "editMessageText" && call.body.message_id === message), "снятия кнопок");
  expect(String(edit.body.text)).toMatch(/Подтверждено<\/b>$/);
  expect(applied).toEqual([500 + setupActions.ids[0]]);
  const overseer = await session.openGadget(workspace.id.toString());
  const log = await overseer.listActions();
  expect(log.find(entry => entry.id === setupActions.ids[0])).toMatchObject({ state: "approved", resolvedBy: expect.objectContaining({ type: "user" }) });

  // Повтор нажатия второго действия не даёт.
  await press(approve, message);
  await until(() => net.telegram.filter(call => call.method === "answerCallbackQuery").length === 2, "ответа на повтор");
  expect(net.telegram.filter(call => call.method === "answerCallbackQuery")[1].body).toMatchObject({ text: "Решение по этому действию уже принято." });
  expect(applied).toHaveLength(1);

  // Второе действие решено на сайте — карточка в Telegram обновляется, её кнопка устарела.
  const second = 900 + net.telegram.indexOf(cards[1]) + 1;
  await overseer.rejectAction(setupActions.ids[1]);
  const siteEdit = await until(() => net.telegram.find(call => call.method === "editMessageText" && call.body.message_id === second), "обновления карточки");
  expect(String(siteEdit.body.text)).toMatch(/Отклонено на сайте<\/b>$/);
  await press(buttons(cards[1])[0], second);
  await until(() => net.telegram.filter(call => call.method === "answerCallbackQuery").length === 3, "ответа на устаревшую карточку");
  expect(applied).toHaveLength(1);
  await idle(overseer, setupActions.chatId, 1);
});

it("правка сообщения сохраняет исходную историю и вложения, отвечает только на изменённый контекст", async () => {
  const net = stubNetwork();
  const {session, idle} = await setup(net);
  const overseer = await session.newGadget();
  const chat = await overseer.newChat("Первый контекст", "fake-model");
  await idle(overseer, chat, 1);
  const bytes = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
  const file = await overseer.uploadChatAttachment({mimeType: "image/png", name: "image.png", content: bytes}, "fake-model");
  await overseer.sendChatMessage(chat, "Исходный запрос", "fake-model", undefined, [file]);
  await idle(overseer, chat, 2);
  const before = await overseer.getChatHistory(chat);
  const target = before.messages.find(m => m.type === "message" && m.message === "Исходный запрос")!;
  await overseer.sendChatMessage(chat, "Будущий запрос, который не должен попасть в правку", "fake-model");
  await idle(overseer, chat, 3);
  await overseer.setChatCodeMode(chat, "off");
  const source = await overseer.getChatHistory(chat);
  const edited = await overseer.editChatMessage(chat, target.sequence, "Изменённый запрос", "fake-model");
  expect(edited).not.toBe(chat);
  expect((await overseer.listChats()).find(c => c.id === edited)?.codeMode).toBe("off");
  expect((await overseer.listChats()).find(c => c.id === edited)).toMatchObject({forkedFrom: {chatId: chat, sequence: target.sequence}});
  await idle(overseer, edited, 2);
  expect(await overseer.getChatHistory(chat)).toEqual(source);
  const history = await overseer.getChatHistory(edited);
  expect(history.messages.filter(m => m.type === "message" && m.author.type === "user").map(m => m.type === "message" && m.message))
    .toEqual(["Первый контекст", "Изменённый запрос"]);
  const message = history.messages.find(m => m.type === "message" && m.message === "Изменённый запрос");
  const attachment = message?.type === "message" ? message.attachments?.[0] : undefined;
  expect(attachment?.id).not.toBe(file.id);
  expect(await overseer.getChatAttachmentContent(edited, attachment!.id)).toEqual(Buffer.from(bytes));
  expect(await overseer.getChatAttachmentContent(chat, file.id)).toEqual(Buffer.from(bytes));
  expect((await overseer.listChats()).find(c => c.id === edited)?.preview).toBeTruthy();
  const prompt = net.model.prompts.at(-1)!;
  expect(prompt).toContain("Первый контекст");
  expect(prompt).toContain("Изменённый запрос");
  expect(prompt).not.toContain("Будущий запрос");
  expect(prompt).not.toContain("Исходный запрос");
});

it("правка последнего запроса заменяет ответ в текущей беседе и переживает повторную правку", async () => {
  const net = stubNetwork();
  const {session, idle} = await setup(net);
  const overseer = await session.newGadget();
  const chat = await overseer.newChat("Контекст первой реплики", "fake-model");
  await idle(overseer, chat, 1);
  await overseer.sendChatMessage(chat, "Последний запрос", "fake-model");
  await idle(overseer, chat, 2);
  const original = await overseer.getChatHistory(chat);
  const target = original.messages.find(m => m.type === "message" && m.message === "Последний запрос")!;
  const count = (await overseer.listChats()).length;
  expect(await overseer.editChatMessage(chat, target.sequence, "Исправленный запрос", "fake-model")).toBe(chat);
  await idle(overseer, chat, 2);
  expect(await overseer.listChats()).toHaveLength(count);
  const edited = await overseer.getChatHistory(chat);
  expect(edited.messages.filter(m => m.type === "message" && m.author.type === "user").map(m => m.type === "message" && m.message))
    .toEqual(["Контекст первой реплики", "Исправленный запрос"]);
  expect(edited.messages.filter(m => m.type === "message" && m.author.type === "agent")).toHaveLength(2);
  expect(net.model.prompts.at(-1)).not.toContain("Последний запрос");
  const revision = edited.messages.find(m => m.type === "message" && m.message === "Исправленный запрос")!;
  expect(await overseer.editChatMessage(chat, revision.sequence, "Повторная правка", "fake-model")).toBe(chat);
  await idle(overseer, chat, 2);
  const again = await overseer.getChatHistory(chat);
  expect(again.messages.filter(m => m.type === "message" && m.author.type === "user").map(m => m.type === "message" && m.message))
    .toEqual(["Контекст первой реплики", "Повторная правка"]);
  expect(await overseer.getChatMessage(chat, target.sequence)).toEqual(target);
  expect(net.model.prompts.at(-1)).not.toContain("Исправленный запрос");
});
