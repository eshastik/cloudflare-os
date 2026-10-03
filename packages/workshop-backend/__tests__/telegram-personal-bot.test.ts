import { describe, expect, it } from "vitest";
import { PersonalTelegramBot, PAIRED_REPLY, PAIRING_TTL_MS, TelegramSetupError, telegramWebhookRoute, webhookUrl, type BotRecord, type TelegramAgentGateway } from "../src/telegram/personal-bot";
import { DraftLimiter } from "../src/telegram/progress";
import { openSecret, sealSecret, sameSecret, SECRETS_KEY_MISSING } from "../src/telegram/secret-box";
import { parseTelegramUpdate } from "../src/telegram/updates";

const KEY = "k".repeat(16) + "-secrets-key-for-tests-only-0123";
const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ";
const ROUTE = "a".repeat(64);
const OWNER = "alice@example.ru";
const ALICE = 1001, MALLORY = 2002;

type Call = { method: string; body: Record<string, unknown> };

type Flags = { topics: boolean; usersCreate: boolean };
function telegram(options: { failSetWebhook?: boolean; failDelete?: boolean; flags?: Flags } = {}) {
  let calls: Call[] = [];
  let flags = options.flags ?? { topics: true, usersCreate: true };
  let fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = String(input);
    let method = url.slice(url.lastIndexOf("/") + 1);
    let body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ method, body });
    let ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { headers: { "content-type": "application/json" } });
    if (method === "getMe") return ok({ id: 123456789, is_bot: true, username: "alice_helper_bot", first_name: "Помощник Алисы",
      // Как у настоящего getMe: ложные необязательные поля Telegram не присылает вовсе.
      ...(flags.topics ? { has_topics_enabled: true } : {}), ...(flags.usersCreate ? { allows_users_to_create_topics: true } : {}) });
    if (method === "setWebhook") return options.failSetWebhook ? new Response("{}", { status: 500 }) : ok(true);
    if (method === "deleteWebhook") return options.failDelete ? new Response("{}", { status: 500 }) : ok(true);
    if (method === "sendMessage") return ok({ message_id: 7, chat: { id: body.chat_id, type: "private" } });
    if (method === "sendMessageDraft" || method === "editForumTopic") return ok(true);
    if (method === "createForumTopic") return ok({ message_thread_id: 500, name: body.name, icon_color: 1 });
    if (method === "answerCallbackQuery") return ok(true);
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { calls, fetcher, flags };
}

function harness(options: { key?: string | undefined; publicBase?: string; failSetWebhook?: boolean; failDelete?: boolean; claims?: Map<string, string>; flags?: Flags } = {}) {
  let map = new Map<string, unknown>();
  let storage = {
    get: <T>(key: string) => structuredClone(map.get(key)) as T | undefined,
    put: <T>(key: string, value: T) => { map.set(key, structuredClone(value)); },
    delete: (key: string) => map.delete(key),
    list: <T>({ prefix }: { prefix: string }) => [...map.entries()].filter(([key]) => key.startsWith(prefix)) as [string, T][],
  };
  let tg = telegram(options);
  let claims = options.claims ?? new Map<string, string>();
  let pending: Promise<unknown>[] = [];
  let clock = { now: 1_000_000 };
  let bot = new PersonalTelegramBot({
    storage,
    secretsKey: "key" in options ? options.key : KEY,
    publicBase: options.publicBase ?? "https://mnemos.example.ru",
    routeId: ROUTE,
    fetch: tg.fetcher,
    claim: async (id, owner) => { let holder = claims.get(id); if (holder && holder !== owner) return false; claims.set(id, owner); return true; },
    release: async (id, owner) => { if (claims.get(id) === owner) claims.delete(id); },
    mnemosOf: async () => ({ tenant: "mnemos", principal: "p-alice" }),
    now: () => clock.now,
    waitUntil: promise => { pending.push(promise); },
    gateway: { submit: async () => ({ accepted: true, chatPath: "/workspace/w1?chat=0" }), rename: async () => true } satisfies TelegramAgentGateway,
    transcribe: async () => "текст",
    drafts: new DraftLimiter(),
    voice: { busy: false },
    mnemos: {
      read: async () => ({ principal: "p", page: { items: [], next_after: 0, delivered: 0, more: false } }),
      ack: async sequence => sequence,
      prepare: async () => ({ version: null, details: [] }),
      decide: async () => ({ status: "stale", reason: "нет" }),
    },
    setAlarm: () => {},
  });
  let settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
  return { bot, map, calls: tg.calls, flags: tg.flags, claims, clock, settle };
}

function secretOf(calls: Call[]): string {
  let set = calls.filter(c => c.method === "setWebhook").at(-1);
  return String(set?.body.secret_token);
}

let nextUpdate = 1;
function update(body: Record<string, unknown>): Record<string, unknown> {
  return { update_id: nextUpdate++, ...body };
}
function privateText(sender: number, text: string) {
  return update({ message: { message_id: nextUpdate, date: 1, text, from: { id: sender, is_bot: false, first_name: sender === ALICE ? "Алиса" : "Мэллори" }, chat: { id: sender, type: "private" } } });
}

function hook(body: unknown, secret: string | null, path = "/api/telegram/" + ROUTE): Request {
  let headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["X-Telegram-Bot-Api-Secret-Token"] = secret;
  return new Request("https://mnemos.example.ru" + path, { method: "POST", headers, body: JSON.stringify(body) });
}

async function paired() {
  let h = harness();
  let state = await h.bot.connect(OWNER, TOKEN);
  if (state.status !== "pairing") throw new Error("ожидалось ожидание кода");
  let secret = secretOf(h.calls);
  expect((await h.bot.webhook(hook(privateText(ALICE, "/start " + state.code), secret))).status).toBe(200);
  await h.settle();
  return { ...h, secret };
}

const sent = (calls: Call[]) => calls.filter(c => c.method === "sendMessage");

describe("подключение личного бота", () => {
  it("проверяет токен, ставит вебхук со своим секретом и ждёт /start КОД", async () => {
    let h = harness();
    expect(await h.bot.state(OWNER)).toEqual({ status: "none" });
    let state = await h.bot.connect(OWNER, "  " + TOKEN + "\n");
    expect(state).toMatchObject({ status: "pairing", bot: { username: "alice_helper_bot", title: "Помощник Алисы" } });
    if (state.status !== "pairing") return;
    expect(state.code).toMatch(/^[a-z0-9]{12}$/);
    expect(state.expiresAt).toBe(1_000_000 + PAIRING_TTL_MS);
    let set = h.calls.find(c => c.method === "setWebhook")!;
    expect(set.body.url).toBe("https://mnemos.example.ru/api/telegram/" + ROUTE);
    expect(String(set.body.secret_token)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(set.body.allowed_updates).toEqual(["message", "callback_query"]);
    expect(h.claims.get("123456789")).toBe(OWNER);
  });

  it("не хранит токен и секрет вебхука открытым текстом", async () => {
    let h = harness();
    await h.bot.connect(OWNER, TOKEN);
    let stored = JSON.stringify([...h.map.entries()]);
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain(TOKEN.split(":")[1]);
    expect(stored).not.toContain(secretOf(h.calls));
    let record = h.map.get("bot") as BotRecord;
    expect(await openSecret(KEY, "telegram-bot-token", JSON.stringify(["telegram-bot", OWNER, "123456789"]), record.token)).toBe(TOKEN);
  });

  it("без ключа шифрования отказывает понятной ошибкой и не зовёт Telegram", async () => {
    for (let key of [undefined, "", "short-key"]) {
      let h = harness({ key });
      expect(await h.bot.state(OWNER)).toEqual({ status: "unavailable", reason: "no_key" });
      await expect(h.bot.connect(OWNER, TOKEN)).rejects.toThrow(SECRETS_KEY_MISSING);
      expect(h.calls).toEqual([]);
      expect(h.map.size).toBe(0);
    }
  });

  it("без публичного https-адреса не подключает", async () => {
    let h = harness({ publicBase: "http://mnemos.example.ru" });
    expect(await h.bot.state(OWNER)).toEqual({ status: "unavailable", reason: "no_public_address" });
    await expect(h.bot.connect(OWNER, TOKEN)).rejects.toBeInstanceOf(TelegramSetupError);
    expect(h.calls).toEqual([]);
  });

  it("отвергает строку, не похожую на токен, до обращения к Telegram", async () => {
    let h = harness();
    await expect(h.bot.connect(OWNER, "123:short")).rejects.toThrow("не похоже на токен");
    expect(h.calls).toEqual([]);
  });

  it("чужой бот (занят другим пользователем) не подключается и вебхук не трогается", async () => {
    let claims = new Map([["123456789", "bob@example.ru"]]);
    let h = harness({ claims });
    await expect(h.bot.connect(OWNER, TOKEN)).rejects.toThrow("уже подключён у другого пользователя");
    expect(h.calls.map(c => c.method)).toEqual(["getMe"]);
    expect(claims.get("123456789")).toBe("bob@example.ru");
  });

  it("если Telegram не принял вебхук, бот освобождается и запись не появляется", async () => {
    let h = harness({ failSetWebhook: true });
    await expect(h.bot.connect(OWNER, TOKEN)).rejects.toThrow("не принял адрес");
    expect(h.claims.size).toBe(0);
    expect(h.map.size).toBe(0);
  });

  it("запись другого пользователя недоступна по чужому имени", async () => {
    let h = harness();
    await h.bot.connect(OWNER, TOKEN);
    await expect(h.bot.state("mallory@example.ru")).rejects.toThrow();
    await expect(h.bot.disconnect("mallory@example.ru")).rejects.toThrow();
    expect(h.map.has("bot")).toBe(true);
  });
});

describe("режим тредов", () => {
  for (let flags of [{ topics: false, usersCreate: true }, { topics: true, usersCreate: false }, { topics: false, usersCreate: false }]) {
    it(`без тредов (${JSON.stringify(flags)}) бот не подключается, ничего не сохранено и вебхук не ставится`, async () => {
      let h = harness({ flags });
      let state = await h.bot.connect(OWNER, TOKEN);
      expect(state).toEqual({ status: "needs_threads", bot: { username: "alice_helper_bot", title: "Помощник Алисы" },
        threads: { enabled: flags.topics, usersCanCreate: flags.usersCreate } });
      expect(h.calls.map(c => c.method)).toEqual(["getMe"]);
      expect(h.map.size).toBe(0);
      expect(h.claims.size).toBe(0);
      // Включили в BotFather — «Проверить снова» с тем же токеном подключает.
      h.flags.topics = true; h.flags.usersCreate = true;
      expect((await h.bot.connect(OWNER, TOKEN)).status).toBe("pairing");
    });
  }

  it("подключённый бот показывает треды; выключение в BotFather видно при следующей проверке", async () => {
    let h = await paired();
    expect(await h.bot.state(OWNER)).toMatchObject({ status: "connected", threads: { enabled: true, usersCanCreate: true } });
    h.flags.topics = false;
    h.calls.length = 0;
    // В пределах минуты Telegram не спрашиваем.
    expect(await h.bot.state(OWNER)).toMatchObject({ threads: { enabled: true } });
    expect(h.calls).toEqual([]);
    h.clock.now += 60_000;
    expect(await h.bot.state(OWNER)).toMatchObject({ status: "connected", threads: { enabled: false, usersCanCreate: true } });
    expect(h.calls.map(c => c.method)).toEqual(["getMe"]);
  });
});

describe("привязка Telegram-аккаунта владельца", () => {
  it("первый верный /start КОД привязывает отправителя, бот отвечает", async () => {
    let h = await paired();
    let state = await h.bot.state(OWNER);
    expect(state).toMatchObject({ status: "connected", owner: { name: "Алиса", username: null }, connectedAt: 1_000_000 });
    expect(sent(h.calls)).toEqual([{ method: "sendMessage", body: expect.objectContaining({ chat_id: ALICE, text: PAIRED_REPLY }) }]);
  });

  it("неверный или устаревший код не привязывает никого", async () => {
    let h = harness();
    let state = await h.bot.connect(OWNER, TOKEN);
    if (state.status !== "pairing") throw new Error();
    let secret = secretOf(h.calls);
    await h.bot.webhook(hook(privateText(MALLORY, "/start wrongcode123"), secret));
    await h.bot.webhook(hook(privateText(MALLORY, "/start"), secret));
    expect((await h.bot.state(OWNER)).status).toBe("pairing");
    h.clock.now += PAIRING_TTL_MS;
    await h.bot.webhook(hook(privateText(MALLORY, "/start " + state.code), secret));
    await h.settle();
    expect((await h.bot.state(OWNER)).status).toBe("pairing");
    expect(sent(h.calls)).toEqual([]);
    // Новый код работает.
    let renewed = await h.bot.renewCode(OWNER);
    if (renewed.status !== "pairing") throw new Error();
    expect(renewed.code).not.toBe(state.code);
    await h.bot.webhook(hook(privateText(ALICE, "/start " + renewed.code), secret));
    expect((await h.bot.state(OWNER)).status).toBe("connected");
  });

  it("код из группы не привязывает", async () => {
    let h = harness();
    let state = await h.bot.connect(OWNER, TOKEN);
    if (state.status !== "pairing") throw new Error();
    let group = update({ message: { message_id: 5, text: "/start " + state.code, from: { id: ALICE, is_bot: false, first_name: "Алиса" }, chat: { id: -100500, type: "group" } } });
    expect((await h.bot.webhook(hook(group, secretOf(h.calls)))).status).toBe(200);
    expect((await h.bot.state(OWNER)).status).toBe("pairing");
  });
});

describe("вебхук", () => {
  it("неверный или отсутствующий secret_token — 401, сообщение не обрабатывается", async () => {
    let h = await paired();
    let before = sent(h.calls).length;
    expect((await h.bot.webhook(hook(privateText(ALICE, "привет"), "x".repeat(43)))).status).toBe(401);
    expect((await h.bot.webhook(hook(privateText(ALICE, "привет"), null))).status).toBe(401);
    expect((await h.bot.webhook(hook(privateText(ALICE, "привет"), h.secret + "x"))).status).toBe(401);
    await h.settle();
    expect(sent(h.calls).length).toBe(before);
  });

  it("чужой отправитель отброшен молча; сообщение владельца уходит агенту беседы", async () => {
    let h = await paired();
    h.calls.length = 0;
    expect((await h.bot.webhook(hook(privateText(MALLORY, "привет"), h.secret))).status).toBe(200);
    await h.settle();
    expect(h.calls).toEqual([]);
    expect((await h.bot.webhook(hook(privateText(ALICE, "привет"), h.secret))).status).toBe(200);
    await h.settle();
    // Сообщение вне тредов: бот открывает тред и показывает черновик хода; ответа этапа 1 больше нет.
    expect(h.calls.map(c => c.method)).toEqual(["createForumTopic", "sendMessageDraft"]);
    expect(sent(h.calls)).toEqual([]);
  });

  it("чужой /start с новым кодом не перехватывает уже привязанного бота", async () => {
    let h = await paired();
    await h.bot.webhook(hook(privateText(MALLORY, "/start anything12345"), h.secret));
    expect(await h.bot.state(OWNER)).toMatchObject({ status: "connected", owner: { name: "Алиса" } });
  });

  it("сообщения из групп и от ботов отбрасываются", async () => {
    let h = await paired();
    h.calls.length = 0;
    let group = update({ message: { message_id: 9, text: "привет", from: { id: ALICE, is_bot: false, first_name: "Алиса" }, chat: { id: -1001, type: "supergroup" } } });
    let fromBot = update({ message: { message_id: 9, text: "привет", from: { id: ALICE, is_bot: true, first_name: "Алиса" }, chat: { id: ALICE, type: "private" } } });
    for (let body of [group, fromBot]) expect((await h.bot.webhook(hook(body, h.secret))).status).toBe(200);
    await h.settle();
    expect(h.calls).toEqual([]);
  });

  it("нажатие кнопки чужим аккаунтом отброшено, владельцем — подтверждено Telegram", async () => {
    let h = await paired();
    h.calls.length = 0;
    let press = (sender: number) => update({ callback_query: { id: "cb" + sender, from: { id: sender, is_bot: false, first_name: "x" }, message: { message_id: 3, chat: { id: sender, type: "private" } }, data: "x" } });
    await h.bot.webhook(hook(press(MALLORY), h.secret));
    await h.settle();
    expect(h.calls).toEqual([]);
    await h.bot.webhook(hook(press(ALICE), h.secret));
    await h.settle();
    expect(h.calls.map(c => c.method)).toEqual(["answerCallbackQuery"]);
  });

  it("повтор того же update_id не даёт второго ответа", async () => {
    let h = await paired();
    h.calls.length = 0;
    let body = privateText(ALICE, "привет");
    await h.bot.webhook(hook(body, h.secret));
    await h.bot.webhook(hook(body, h.secret));
    await h.settle();
    expect(h.calls.filter(c => c.method === "createForumTopic").length).toBe(1);
  });

  it("чужой путь и неподключённый объект — 404, не POST — 405, мусор — 400", async () => {
    let h = await paired();
    expect((await h.bot.webhook(hook(privateText(ALICE, "x"), h.secret, "/api/telegram/" + "b".repeat(64)))).status).toBe(404);
    expect((await h.bot.webhook(new Request("https://mnemos.example.ru/api/telegram/" + ROUTE))).status).toBe(405);
    let junk = new Request("https://mnemos.example.ru/api/telegram/" + ROUTE, { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": h.secret }, body: "not json" });
    expect((await h.bot.webhook(junk)).status).toBe(400);
    let fresh = harness();
    expect((await fresh.bot.webhook(hook(privateText(ALICE, "x"), "x".repeat(43)))).status).toBe(404);
  });
});

describe("отключение", () => {
  it("снимает вебхук, стирает запись и освобождает бота", async () => {
    let h = await paired();
    h.calls.length = 0;
    expect(await h.bot.disconnect(OWNER)).toEqual({ webhookRemoved: true });
    expect(h.calls.map(c => c.method)).toEqual(["deleteWebhook"]);
    expect(h.map.size).toBe(0);
    expect(h.claims.size).toBe(0);
    expect(await h.bot.state(OWNER)).toEqual({ status: "none" });
    expect((await h.bot.webhook(hook(privateText(ALICE, "привет"), h.secret))).status).toBe(404);
  });

  it("если Telegram не ответил, запись всё равно стёрта, а человек узнаёт, что вебхук не снят", async () => {
    let h = harness({ failDelete: true });
    await h.bot.connect(OWNER, TOKEN);
    expect(await h.bot.disconnect(OWNER)).toEqual({ webhookRemoved: false });
    expect(h.map.size).toBe(0);
  });

  it("смена бота снимает вебхук прежнего", async () => {
    let h = await paired();
    let record = h.map.get("bot") as BotRecord;
    // Прежний бот — другой номер; подменяем номер в записи и шифртекст под него.
    record.bot.id = "987654321";
    record.token = await sealSecret(KEY, "telegram-bot-token", JSON.stringify(["telegram-bot", OWNER, "987654321"]), "987654321:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ");
    h.map.set("bot", record);
    h.claims.set("987654321", OWNER);
    h.calls.length = 0;
    let state = await h.bot.connect(OWNER, TOKEN);
    expect(state.status).toBe("pairing");
    expect(h.calls.map(c => c.method)).toEqual(["getMe", "setWebhook", "deleteWebhook"]);
    expect(h.claims.has("987654321")).toBe(false);
  });
});

describe("шифрование и сравнение секретов", () => {
  it("другой ключ или другая запись не расшифровывают токен", async () => {
    let sealed = await sealSecret(KEY, "telegram-bot-token", "ctx-a", TOKEN);
    await expect(openSecret(KEY.replace("k", "q"), "telegram-bot-token", "ctx-a", sealed)).rejects.toThrow("не расшифровывается");
    await expect(openSecret(KEY, "telegram-bot-token", "ctx-b", sealed)).rejects.toThrow("не расшифровывается");
    await expect(openSecret(KEY, "other-purpose", "ctx-a", sealed)).rejects.toThrow("не расшифровывается");
    await expect(openSecret(undefined, "telegram-bot-token", "ctx-a", sealed)).rejects.toThrow(SECRETS_KEY_MISSING);
    expect(await openSecret(KEY, "telegram-bot-token", "ctx-a", sealed)).toBe(TOKEN);
  });

  it("каждое шифрование даёт новый вектор", async () => {
    let a = await sealSecret(KEY, "p", "c", TOKEN), b = await sealSecret(KEY, "p", "c", TOKEN);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it("sameSecret различает строки, в том числе разной длины", async () => {
    expect(await sameSecret("abc", "abc")).toBe(true);
    expect(await sameSecret("abc", "abd")).toBe(false);
    expect(await sameSecret("abc", "abcd")).toBe(false);
    expect(await sameSecret("", "a")).toBe(false);
  });
});

describe("разбор адресов и обновлений", () => {
  it("адрес вебхука — только https-источник установки", () => {
    expect(webhookUrl("https://m.example.ru/some/path", ROUTE)).toBe("https://m.example.ru/api/telegram/" + ROUTE);
    expect(webhookUrl("http://m.example.ru", ROUTE)).toBeNull();
    expect(webhookUrl("https://user:pw@m.example.ru", ROUTE)).toBeNull();
    expect(webhookUrl(undefined, ROUTE)).toBeNull();
    expect(webhookUrl("https://m.example.ru", "zz")).toBeNull();
    expect(telegramWebhookRoute("/api/telegram/" + ROUTE)).toBe(ROUTE);
    expect(telegramWebhookRoute("/api/telegram/" + ROUTE + "/x")).toBeNull();
    expect(telegramWebhookRoute("/api/telegram/../" + ROUTE)).toBeNull();
  });

  it("кнопка из чужого чата — не личный разговор", () => {
    let bytes = new TextEncoder().encode(JSON.stringify({ update_id: 1, callback_query: { id: "q", from: { id: 5, is_bot: false }, message: { chat: { id: 6, type: "private" } } } }));
    expect(parseTelegramUpdate(bytes)).toBeNull();
  });
});
