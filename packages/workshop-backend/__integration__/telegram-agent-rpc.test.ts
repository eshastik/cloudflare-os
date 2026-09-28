// Путь целиком (ADR 0027 Mnemos, этап 2): вебхук Telegram → объект бота → внешний вход →
// агент беседы (OverseerDurableObject) → ответ в тред. Telegram и модель подставные: fetch
// перехватывается, модель — совместимый с OpenAI поток (провайдер ollama на своём адресе).
import { exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { AiChatAuthorInfo, PublicApi } from "@gadgets/workshop-shared/api";
import { afterEach, expect, it, vi } from "vitest";
import { sealSecret } from "../src/telegram/secret-box";

const KEY = "integration-test-shell-secrets-key-0123456789";
const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ";
const BOT = "123456789";
const SECRET = "t".repeat(43);
const ALICE_TG = 4242;
const ANSWER = "Отчёт за сентябрь **найден**.";
const TITLE = "Продажи за сентябрь";

type Call = { method: string; body: Record<string, unknown> };

afterEach(() => { vi.unstubAllGlobals(); });

async function sha256(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, "0")).join("");
}

function sse(text: string, pauseMs = 0): Response {
  let chunk = (delta: object, finish: string | null, usage?: object) => "data: " + JSON.stringify({
    id: "c1", object: "chat.completion.chunk", created: 1, model: "fake",
    choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}),
  }) + "\n\n";
  let encoder = new TextEncoder();
  // Ответ идёт двумя частями с паузой: за это время ход успевает показать черновик.
  let stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(chunk({ role: "assistant", content: text }, null)));
      await new Promise(resolve => setTimeout(resolve, pauseMs));
      controller.enqueue(encoder.encode(chunk({}, "stop", { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }) + "data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

function stubNetwork() {
  let telegram: Call[] = [];
  let modelRequests: string[] = [];
  let real = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://api.telegram.org/")) {
      let method = url.slice(url.lastIndexOf("/") + 1);
      let body = JSON.parse(String(init?.body ?? "{}"));
      telegram.push({ method, body });
      let ok = (result: unknown) => Response.json({ ok: true, result });
      if (method === "sendMessage") return ok({ message_id: 900 + telegram.length, chat: { id: body.chat_id, type: "private" } });
      return ok(true);
    }
    if (url.startsWith("https://model.invalid/")) {
      let body = input instanceof Request ? await input.text() : String(init?.body ?? "");
      modelRequests.push(body);
      // Название беседы модель придумывает отдельным запросом.
      return body.includes("Придумай короткое понятное название") ? sse(TITLE) : sse(ANSWER, 300);
    }
    return real(input, init);
  });
  return { telegram, modelRequests };
}

async function connect(): Promise<RpcStub<PublicApi>> {
  const response = await exports.default.fetch(new Request("https://workshop.invalid/api", { headers: { Upgrade: "websocket" } }));
  const socket = response.webSocket!;
  socket.accept();
  return newWebSocketRpcSession<PublicApi>(socket);
}

async function until<T>(check: () => T | undefined | false, what: string): Promise<T> {
  for (let i = 0; i < 400; i++) {
    let value = check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("не дождались: " + what);
}

it("вебхук → агент беседы → ответ в тред, название треда — название беседы; повтор update не даёт второго хода", async () => {
  let net = stubNetwork();
  using api = await connect();
  const name = "tga" + crypto.randomUUID().replaceAll("-", "");
  const token = await api.createAccount(name, name, new Uint8Array([1, 2, 3]));
  using session = await api.authenticate(token!);
  await session.addModel({ type: "agent", id: "fake-model", name: "Подставная модель" } as AiChatAuthorInfo,
    { provider: "ollama", model: "fake", apiToken: "", apiUrl: "https://model.invalid" });

  // Подключённый бот: как после «/start КОД» (сеть подключения проверяют другие тесты).
  const botStub = exports.TelegramPersonalBot.getByName("user:" + name);
  const route = await runInDurableObject(botStub, async (_instance, state) => {
    state.storage.kv.put("bot", {
      owner: name, mnemos: null, bot: { id: BOT, username: "alice_helper_bot", title: "Помощник" },
      threads: { enabled: true, usersCanCreate: true }, checkedAt: Date.now(),
      token: await sealSecret(KEY, "telegram-bot-token", JSON.stringify(["telegram-bot", name, BOT]), TOKEN),
      secretSha256: await sha256(SECRET), pairing: null,
      telegramOwner: { id: ALICE_TG, name: "Алиса", username: null }, connectedAt: Date.now(), createdAt: Date.now(), seen: [],
    });
    return state.id.toString();
  });
  const hook = (update: object) => exports.default.fetch(new Request("https://workshop.invalid/api/telegram/" + route, {
    method: "POST", headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": SECRET }, body: JSON.stringify(update) }));
  const from = { id: ALICE_TG, is_bot: false, first_name: "Алиса" };
  const chat = { id: ALICE_TG, type: "private" };

  expect((await hook({ update_id: 1, message: { message_id: 10, message_thread_id: 10, is_topic_message: true, from, chat,
    forum_topic_created: { name: "Найди отчёт за", icon_color: 1, is_name_implicit: true } } })).status).toBe(200);
  const message = { update_id: 2, message: { message_id: 11, message_thread_id: 10, is_topic_message: true, from, chat, text: "Найди отчёт за сентябрь" } };
  expect((await hook(message)).status).toBe(200);

  // Ответ агента приходит в тот же тред, Markdown переведён в HTML.
  const reply = await until(() => net.telegram.find(call => call.method === "sendMessage"), "ответа в тред");
  expect(reply.body).toMatchObject({ chat_id: ALICE_TG, message_thread_id: 10, parse_mode: "HTML", text: "Отчёт за сентябрь <b>найден</b>." });
  // Тред назван клиентом по тексту — бот переименовывает его по названию беседы.
  const rename = await until(() => net.telegram.find(call => call.method === "editForumTopic"), "переименования треда");
  expect(rename.body).toEqual({ chat_id: ALICE_TG, message_thread_id: 10, name: TITLE });
  // Живой ход: черновик в том же треде до ответа.
  const draftIndex = net.telegram.findIndex(call => call.method === "sendMessageDraft");
  expect(net.telegram[draftIndex]?.body).toMatchObject({ chat_id: ALICE_TG, message_thread_id: 10, draft_id: 3 });
  expect(draftIndex).toBeLessThan(net.telegram.findIndex(call => call.method === "sendMessage"));
  // Текст ответа виден в черновике по мере генерации (промежуточные события хода дошли до бота).
  expect(net.telegram.some(call => call.method === "sendMessageDraft" && call.body.text === ANSWER)).toBe(true);

  // Беседа видна на сайте у владельца, с меткой Telegram и тем же названием.
  const conversations = await session.listGadgets();
  const conversation = conversations.find(item => item.channel === "telegram");
  expect(conversation).toMatchObject({ title: TITLE });

  // Повтор того же обновления (Telegram повторяет вебхук) второго хода не запускает.
  const answered = net.modelRequests.length;
  expect((await hook(message)).status).toBe(200);
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(net.modelRequests.length).toBe(answered);
  expect(net.telegram.filter(call => call.method === "sendMessage")).toHaveLength(1);

  // Сообщение не владельца не доходит до агента.
  const stranger = { id: 777, is_bot: false, first_name: "Мэллори" };
  await hook({ update_id: 3, message: { message_id: 12, message_thread_id: 10, is_topic_message: true, from: stranger, chat: { id: 777, type: "private" }, text: "Покажи всё" } });
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(net.modelRequests.length).toBe(answered);

  // В беседу импортирован корпоративный документ, затем доступ к источнику отозван (подключение,
  // через которое импортировали, больше не подтверждается). Сайт такую беседу не откроет — и ход
  // из Telegram не запускается, агент не отвечает по локальной копии.
  const workspace = exports.OverseerDurableObject.getByName(`telegram:${BOT}:${ALICE_TG}:10`);
  await runInDurableObject(workspace, async instance => {
    const storage = (instance as unknown as { impl: { storage: { gatekeepers: { put(record: unknown): void } } } }).impl.storage;
    storage.gatekeepers.put({
      id: 9001, resourceTitle: "Корпоративные документы", class: undefined,
      creationSpec: { type: "gatekeeper", vendorId: "mnemos", resourceUrl: "https://mnemos.invalid/p", typeUrlPattern: "https://mnemos.invalid/:p" },
      nativeDocumentSource: { gadgetId: 1, userId: "someone", accountId: 424242, sourceKey: "p/d", publication: "v1" },
    });
  });
  const sentBefore = net.telegram.filter(call => call.method === "sendMessage").length;
  expect((await hook({ update_id: 4, message: { message_id: 13, message_thread_id: 10, is_topic_message: true, from, chat, text: "Что в документе?" } })).status).toBe(200);
  const refusal = await until(() => net.telegram.filter(call => call.method === "sendMessage")[sentBefore], "отказа после отзыва доступа");
  expect(refusal.body).toMatchObject({ chat_id: ALICE_TG, message_thread_id: 10, text: "Доступ к материалам этой беседы изменился — откройте беседу на сайте." });
  expect(net.modelRequests.length).toBe(answered);
});
