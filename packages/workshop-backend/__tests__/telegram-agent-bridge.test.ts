// Этап 2 ADR 0027 Mnemos: сообщение из треда Telegram → ход агента беседы → ответ в тред.
// Внешний вход агента подставной: здесь проверяется сторона бота (треды, названия, доставка).
import { describe, expect, it } from "vitest";
import {
  ARCHIVED_NOTICE, BUSY_REPLY, CARD_ACCESS_CHANGED, CARD_APPROVED, CARD_DECIDING_MS, CARD_BUSY, CARD_FAILED, CARD_REJECTED, CARD_STALE, CARD_UNKNOWN, FAILED_REPLY,
  PersonalTelegramBot, UNSUPPORTED_REPLY, VOICE_BUSY_REPLY, VOICE_UNAVAILABLE_REPLY, VoiceUnavailableError,
  type BotRecord, type CardRecord, type TelegramAgentGateway, type TelegramTurnRef, type ThreadLink,
} from "../src/telegram/personal-bot";
import { DraftLimiter, DRAFT_LIMIT, describeStep, draftText } from "../src/telegram/progress";
import { sealSecret } from "../src/telegram/secret-box";
import type {
  DecideExternalActionInput, DecideExternalActionResult, SubmitExternalMessageInput, SubmitExternalMessageResult, RenameExternalChatInput,
} from "@gadgets/workshop-shared/external-message-gateway";

const KEY = "k".repeat(16) + "-secrets-key-for-tests-only-0123";
const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ";
const BOT = "123456789";
const ROUTE = "a".repeat(64);
const OWNER = "alice@example.ru";
const ALICE = 1001, MALLORY = 2002;
const SECRET = "s".repeat(43);

type Call = { method: string; body: Record<string, unknown> };

async function sha256(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, "0")).join("");
}

type Options = {
  submit?: (input: Omit<SubmitExternalMessageInput, "chatGatewayRpcTarget">, ref: TelegramTurnRef) => Promise<SubmitExternalMessageResult>;
  transcribe?: (owner: string, bytes: Uint8Array, mime: string) => Promise<string>;
  decide?: (input: DecideExternalActionInput) => Promise<DecideExternalActionResult>;
};

async function harness(options: Options = {}) {
  let map = new Map<string, unknown>();
  let storage = {
    get: <T>(key: string) => structuredClone(map.get(key)) as T | undefined,
    put: <T>(key: string, value: T) => { map.set(key, structuredClone(value)); },
    delete: (key: string) => map.delete(key),
    list: <T>({ prefix }: { prefix: string }) => [...map.entries()].filter(([key]) => key.startsWith(prefix)) as [string, T][],
  };
  let calls: Call[] = [];
  let tg = {
    goneThreads: new Set<number>(),
    rejectHtml: false,
    // Номера вызовов sendMessage (с 1), на которых Telegram падает 500.
    failSends: new Set<number>(),
    sends: 0,
    nextThread: 500,
  };
  let fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = String(input);
    if (url.includes("/file/bot")) {
      calls.push({ method: "download", body: {} });
      return new Response(new Uint8Array([1, 2, 3]));
    }
    let method = url.slice(url.lastIndexOf("/") + 1);
    let body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ method, body });
    let ok = (result: unknown) => Response.json({ ok: true, result });
    let refuse = (description: string) => Response.json({ ok: false, error_code: 400, description }, { status: 400 });
    let thread = body.message_thread_id as number | undefined;
    if (thread !== undefined && tg.goneThreads.has(thread) && ["sendMessage", "sendMessageDraft", "editForumTopic"].includes(method)) {
      return refuse("Bad Request: message thread not found");
    }
    if (method === "sendMessage") {
      tg.sends++;
      if (tg.failSends.has(tg.sends)) return new Response("{}", { status: 500 });
      if (tg.rejectHtml && body.parse_mode === "HTML") return refuse("Bad Request: can't parse entities: unsupported start tag");
      return ok({ message_id: 100 + tg.sends, chat: { id: body.chat_id, type: "private" } });
    }
    if (["sendMessageDraft", "editForumTopic", "deleteForumTopic", "editMessageText", "editMessageReplyMarkup", "answerCallbackQuery"].includes(method)) return ok(true);
    if (method === "createForumTopic") return ok({ message_thread_id: tg.nextThread++, name: body.name, icon_color: 1 });
    if (method === "getFile") return ok({ file_id: body.file_id, file_path: "voice/file_1.oga", file_size: 3 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  let submits: { input: Omit<SubmitExternalMessageInput, "chatGatewayRpcTarget">; ref: TelegramTurnRef }[] = [];
  let renames: RenameExternalChatInput[] = [];
  let decides: DecideExternalActionInput[] = [];
  let gateway: TelegramAgentGateway = {
    submit: async (input, ref) => {
      submits.push({ input, ref });
      return options.submit ? await options.submit(input, ref) : { accepted: true, chatPath: "/workspace/w1?chat=0" };
    },
    rename: async input => { renames.push(input); return true; },
    decide: async input => {
      decides.push(input);
      return options.decide ? await options.decide(input) : { status: input.decision === "approve" ? "approved" : "rejected" };
    },
  };
  let transcribed: { owner: string; bytes: number[]; mime: string }[] = [];
  let pending: Promise<unknown>[] = [];
  let clock = { now: 1_000_000 };
  let bot = new PersonalTelegramBot({
    storage, secretsKey: KEY, publicBase: "https://mnemos.example.ru", routeId: ROUTE, fetch: fetcher,
    claim: async () => true, release: async () => {}, mnemosOf: async () => null,
    now: () => clock.now, waitUntil: promise => { pending.push(promise); },
    gateway,
    transcribe: async (owner, bytes, mime) => {
      transcribed.push({ owner, bytes: [...bytes], mime });
      return options.transcribe ? await options.transcribe(owner, bytes, mime) : "расшифровка голоса";
    },
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
  let record: BotRecord = {
    owner: OWNER, mnemos: null, bot: { id: BOT, username: "alice_helper_bot", title: "Помощник" },
    threads: { enabled: true, usersCanCreate: true }, checkedAt: clock.now,
    token: await sealSecret(KEY, "telegram-bot-token", JSON.stringify(["telegram-bot", OWNER, BOT]), TOKEN),
    secretSha256: await sha256(SECRET), pairing: null,
    telegramOwner: { id: ALICE, name: "Алиса", username: null }, connectedAt: clock.now, createdAt: clock.now, seen: [],
  };
  map.set("bot", record);
  let settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
  let link = (thread: number) => map.get("thread:" + thread) as ThreadLink | undefined;
  let card = (n: number) => map.get("card:" + n) as CardRecord | undefined;
  return { bot, map, calls, tg, submits, renames, decides, transcribed, clock, settle, link, card };
}

let nextUpdate = 1000;
type Message = Record<string, unknown>;
function inThread(sender: number, thread: number, extra: Message): Message {
  return { update_id: nextUpdate++, message: { message_id: nextUpdate, date: 1, message_thread_id: thread, is_topic_message: true,
    from: { id: sender, is_bot: false, first_name: sender === ALICE ? "Алиса" : "Мэллори" }, chat: { id: sender, type: "private" }, ...extra } };
}
function outside(sender: number, extra: Message): Message {
  return { update_id: nextUpdate++, message: { message_id: nextUpdate, date: 1,
    from: { id: sender, is_bot: false, first_name: "Алиса" }, chat: { id: sender, type: "private" }, ...extra } };
}
const topicCreated = (thread: number, name: string, implicit: boolean) => inThread(ALICE, thread, { forum_topic_created: { name, icon_color: 1, ...(implicit ? { is_name_implicit: true } : {}) } });

function hook(body: unknown): Request {
  return new Request("https://mnemos.example.ru/api/telegram/" + ROUTE, {
    method: "POST", headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": SECRET }, body: JSON.stringify(body) });
}

const methods = (calls: Call[]) => calls.map(call => call.method);
const messages = (calls: Call[]) => calls.filter(call => call.method === "sendMessage").map(call => call.body);

async function send(h: Awaited<ReturnType<typeof harness>>, body: Message) {
  expect((await h.bot.webhook(hook(body))).status).toBe(200);
  await h.settle();
}

describe("тред → беседа", () => {
  it("новый тред от клиента становится новой беседой владельца с ключом (бот, чат, тред)", async () => {
    let h = await harness();
    await send(h, topicCreated(77, "Найди отчёт за", true));
    let message = inThread(ALICE, 77, { text: "Найди отчёт за сентябрь" });
    await send(h, message);
    expect(h.submits).toHaveLength(1);
    let { input, ref } = h.submits[0];
    expect(input).toEqual({
      callerEmail: OWNER, gadgetKey: `${BOT}:${ALICE}:77`, chatKey: `${BOT}:${ALICE}:77`,
      messageKey: `${BOT}:${message.update_id}`, gadgetTitle: "Новая беседа", prompt: "Найди отчёт за сентябрь", streamProgress: true,
    });
    expect(ref).toEqual({ route: ROUTE, chat: ALICE, thread: 77, update: message.update_id });
    expect(h.link(77)).toMatchObject({ naming: "client", chatPath: "/workspace/w1?chat=0", unlinked: false });
    // Черновик хода показан в том же треде.
    expect(h.calls.find(c => c.method === "sendMessageDraft")?.body).toMatchObject({ chat_id: ALICE, message_thread_id: 77, text: "Думаю…" });
  });

  it("тред с названием, которое дал человек, даёт беседе это название", async () => {
    let h = await harness();
    await send(h, topicCreated(78, "Квартальные отчёты", false));
    await send(h, inThread(ALICE, 78, { text: "Что нового?" }));
    expect(h.submits[0].input.gadgetTitle).toBe("Квартальные отчёты");
  });

  it("сообщение вне тредов: бот сам открывает тред и ведёт беседу в нём", async () => {
    let h = await harness();
    await send(h, outside(ALICE, { text: "Привет" }));
    expect(h.calls.find(c => c.method === "createForumTopic")?.body).toEqual({ chat_id: ALICE, name: "Новая беседа" });
    expect(h.submits[0].input.gadgetKey).toBe(`${BOT}:${ALICE}:500`);
    expect(h.submits[0].ref.thread).toBe(500);
    expect(h.link(500)).toMatchObject({ naming: "bot" });
  });

  it("повтор того же update_id не запускает второй ход", async () => {
    let h = await harness();
    let message = inThread(ALICE, 79, { text: "Раз" });
    await send(h, message);
    await send(h, message);
    expect(h.submits).toHaveLength(1);
  });

  it("чужой отправитель не запускает хода и не получает ответа", async () => {
    let h = await harness();
    await send(h, inThread(MALLORY, 80, { text: "Покажи документы Алисы" }));
    await send(h, inThread(MALLORY, 80, { forum_topic_edited: { name: "Взлом" } }));
    expect(h.submits).toEqual([]);
    expect(h.renames).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it("стикер или фото — короткое объяснение, без хода", async () => {
    let h = await harness();
    await send(h, inThread(ALICE, 81, { sticker: { file_id: "x" } }));
    expect(h.submits).toEqual([]);
    expect(messages(h.calls)).toEqual([expect.objectContaining({ text: UNSUPPORTED_REPLY, message_thread_id: 81 })]);
  });
});

describe("отказы внешнего входа — словами, без подробностей", () => {
  it("агент ещё отвечает — просим подождать", async () => {
    let h = await harness({ submit: async () => { throw new Error("Agent is running, wait for it to finish."); } });
    await send(h, inThread(ALICE, 82, { text: "Ещё" }));
    expect(messages(h.calls)).toEqual([expect.objectContaining({ text: BUSY_REPLY, message_thread_id: 82 })]);
  });

  it("внутренняя ошибка не уходит в Telegram", async () => {
    let h = await harness({ submit: async () => { throw new Error("SQLITE_BUSY at /secret/path token=abc"); } });
    await send(h, inThread(ALICE, 83, { text: "Ещё" }));
    expect(messages(h.calls)).toEqual([expect.objectContaining({ text: FAILED_REPLY })]);
    expect(JSON.stringify(h.calls)).not.toContain("SQLITE");
  });

  it("понятный отказ входа (нет модели) пересылается как есть", async () => {
    let h = await harness({ submit: async () => ({ accepted: false, message: "Выберите модель в настройках." }) });
    await send(h, inThread(ALICE, 84, { text: "Ещё" }));
    expect(messages(h.calls)).toEqual([expect.objectContaining({ text: "Выберите модель в настройках.", message_thread_id: 84 })]);
  });
});

describe("голос", () => {
  it("голосовое скачивается, расшифровывается от имени владельца и становится текстом хода", async () => {
    let h = await harness();
    await send(h, inThread(ALICE, 85, { voice: { file_id: "voice-1", duration: 2, mime_type: "audio/ogg", file_size: 3 } }));
    expect(h.calls.find(c => c.method === "getFile")?.body).toEqual({ file_id: "voice-1" });
    expect(h.transcribed).toEqual([{ owner: OWNER, bytes: [1, 2, 3], mime: "audio/ogg" }]);
    expect(h.submits[0].input.prompt).toBe("расшифровка голоса");
  });

  it("распознавание не настроено — «голос пока не поддерживается», хода нет", async () => {
    let h = await harness({ transcribe: async () => { throw new VoiceUnavailableError(); } });
    await send(h, inThread(ALICE, 86, { voice: { file_id: "voice-2", duration: 2, mime_type: "audio/ogg" } }));
    expect(h.submits).toEqual([]);
    expect(messages(h.calls).at(-1)).toMatchObject({ text: VOICE_UNAVAILABLE_REPLY, message_thread_id: 86 });
  });

  it("одно распознавание одновременно: второе голосовое, пока идёт первое, — просьба подождать", async () => {
    let release!: () => void;
    let gate = new Promise<void>(resolve => { release = resolve; });
    let h = await harness({ transcribe: async () => { await gate; return "первое"; } });
    await h.bot.webhook(hook(inThread(ALICE, 87, { voice: { file_id: "voice-3", duration: 2 } })));
    // Первое распознавание ещё идёт.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await h.bot.webhook(hook(inThread(ALICE, 88, { voice: { file_id: "voice-4", duration: 2 } })));
    for (let i = 0; i < 20 && !messages(h.calls).length; i++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(messages(h.calls)).toEqual([expect.objectContaining({ text: VOICE_BUSY_REPLY, message_thread_id: 88 })]);
    release();
    await h.settle();
    expect(h.transcribed).toHaveLength(1);
    expect(h.submits.map(s => s.input.prompt)).toEqual(["первое"]);
  });
});

describe("ответ агента", () => {
  async function started(thread = 90, implicit = true) {
    let h = await harness();
    await send(h, topicCreated(thread, "Сводка по", implicit));
    let message = inThread(ALICE, thread, { text: "Сводка по продажам" });
    await send(h, message);
    h.calls.length = 0;
    return { h, ref: h.submits[0].ref };
  }

  it("Markdown уходит HTML в тот же тред; неявное название треда меняется на название беседы один раз", async () => {
    let { h, ref } = await started();
    await h.bot.deliver(ref, { text: "**Итог:** продажи выросли.", title: "Продажи за сентябрь" });
    expect(messages(h.calls)).toEqual([expect.objectContaining({ chat_id: ALICE, message_thread_id: 90, parse_mode: "HTML", text: "<b>Итог:</b> продажи выросли." })]);
    expect(h.calls.find(c => c.method === "editForumTopic")?.body).toEqual({ chat_id: ALICE, message_thread_id: 90, name: "Продажи за сентябрь" });
    expect(h.link(90)).toMatchObject({ renamed: true, title: "Продажи за сентябрь" });
    // Следующий ответ тред не переименовывает.
    await send(h, inThread(ALICE, 90, { text: "А за август?" }));
    h.calls.length = 0;
    await h.bot.deliver(h.submits[1].ref, { text: "Меньше.", title: "Продажи за сентябрь" });
    expect(methods(h.calls)).toEqual(["sendMessage"]);
  });

  it("название, которое тред получил от человека, не трогаем", async () => {
    let { h, ref } = await started(91, false);
    await h.bot.deliver(ref, { text: "Готово.", title: "Название от модели" });
    expect(methods(h.calls)).toEqual(["sendMessage"]);
  });

  it("служебное название беседы («Новая беседа») тред не переименовывает — дождёмся настоящего", async () => {
    let { h, ref } = await started(92);
    await h.bot.deliver(ref, { text: "Готово.", title: "Новая беседа" });
    await h.bot.deliver({ ...ref, update: ref.update + 1 }, { text: "Ещё." });
    expect(methods(h.calls)).toEqual(["sendMessage", "sendMessage"]);
    expect(h.link(92)?.renamed).toBe(false);
  });

  it("переименование треда в Telegram становится названием беседы и запрещает переименование ботом", async () => {
    let { h, ref } = await started(93);
    await send(h, inThread(ALICE, 93, { forum_topic_edited: { name: "Мои продажи" } }));
    expect(h.renames).toEqual([{ callerEmail: OWNER, gadgetKey: `${BOT}:${ALICE}:93`, chatKey: `${BOT}:${ALICE}:93`, title: "Мои продажи" }]);
    h.calls.length = 0;
    await h.bot.deliver(ref, { text: "Готово.", title: "Продажи за сентябрь" });
    expect(methods(h.calls)).toEqual(["sendMessage"]);
  });

  it("тред удалён: связь снимается, беседа остаётся, ответ уходит в чат с названием первой строкой", async () => {
    let { h, ref } = await started(94);
    h.tg.goneThreads.add(94);
    await h.bot.deliver(ref, { text: "Ответ", title: "Продажи" });
    let sent = messages(h.calls);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ message_thread_id: 94 });
    expect(sent[1].message_thread_id).toBeUndefined();
    expect(sent[1].text).toBe("<b>«Продажи»</b>\n\nОтвет");
    expect(h.link(94)).toMatchObject({ unlinked: true, chatPath: "/workspace/w1?chat=0" });
    // Переименовывать нечего; черновики в удалённый тред не шлются.
    expect(methods(h.calls)).not.toContain("editForumTopic");
    h.calls.length = 0;
    await h.bot.progress(ref, { text: "", step: null });
    expect(h.calls).toEqual([]);
  });

  it("разметку не разобрал Telegram — тот же кусок простым текстом", async () => {
    let { h, ref } = await started(95);
    h.tg.rejectHtml = true;
    await h.bot.deliver(ref, { text: "Смотри `код`" });
    let sent = messages(h.calls);
    expect(sent.map(body => body.parse_mode)).toEqual(["HTML", undefined]);
    expect(sent[1].text).toBe("Смотри `код`");
  });

  it("длинный ответ режется по 4096; сбой посередине дослан повтором без дублей", async () => {
    let { h, ref } = await started(96);
    let long = Array.from({ length: 30 }, (_, i) => `Абзац ${i} ` + "текст ".repeat(60)).join("\n\n");
    h.tg.failSends.add(2);
    await expect(h.bot.deliver(ref, { text: long })).rejects.toThrow();
    let first = messages(h.calls).length;
    expect(first).toBe(2);
    await h.bot.deliver(ref, { text: long });
    let sent = messages(h.calls);
    expect(sent.every(body => String(body.text).length <= 4096)).toBe(true);
    // Первый кусок не повторён: второй вызов начал со второго куска.
    expect(sent[2].text).toBe(sent[1].text);
    let delivered = [sent[0], ...sent.slice(2)].map(body => String(body.text)).join("\n\n");
    expect(delivered.replace(/<[^>]+>/g, "")).toContain("Абзац 29");
    // Повтор доставки после успеха ничего не шлёт.
    h.calls.length = 0;
    await h.bot.deliver(ref, { text: long });
    expect(h.calls).toEqual([]);
  });

  it("нужно подтверждение и созданные документы — ссылкой на беседу на сайте", async () => {
    let { h, ref } = await started(97);
    await h.bot.deliver(ref, { text: "Подготовил публикацию.", needsDecision: true, documents: ["Отчёт"] });
    let text = String(messages(h.calls)[0].text);
    expect(text).toContain("«Отчёт»");
    expect(text).toContain("откройте беседу на сайте (https://mnemos.example.ru/workspace/w1?chat=0)");
  });

  it("ответ чужого чата или чужого объекта бота не доставляется", async () => {
    let { h, ref } = await started(98);
    await h.bot.deliver({ ...ref, chat: MALLORY }, { text: "секрет" });
    await h.bot.deliver({ ...ref, route: "b".repeat(64) }, { text: "секрет" });
    await h.bot.progress({ ...ref, chat: MALLORY }, { text: "секрет", step: null });
    expect(h.calls).toEqual([]);
  });

  it("черновики хода — не чаще 20 за 5 секунд", async () => {
    let { h, ref } = await started(99);
    for (let i = 0; i < 30; i++) await h.bot.progress(ref, { text: "часть " + i, step: null });
    // Один черновик «Думаю…» уже ушёл при отправке хода.
    expect(h.calls.filter(c => c.method === "sendMessageDraft")).toHaveLength(DRAFT_LIMIT - 1);
    h.clock.now += 5_000;
    await h.bot.progress(ref, { text: "дальше", step: null });
    expect(h.calls.filter(c => c.method === "sendMessageDraft")).toHaveLength(DRAFT_LIMIT);
    expect(h.calls.at(-1)?.body).toMatchObject({ message_thread_id: 99, draft_id: ref.update + 1, text: "дальше" });
  });
});

describe("подписи живого хода", () => {
  it("по коду executeCode узнаётся поиск и чтение Mnemos", () => {
    expect(describeStep({ toolName: "executeCode", code: "await env.MNEMOS.search('отчёт', 10)" })).toBe("Ищу в Mnemos…");
    expect(describeStep({ toolName: "executeCode", code: "await env.MNEMOS.readDocument('p', 'd')" })).toBe("Читаю документ…");
    expect(describeStep({ toolName: "webFetch" })).toBe("Открываю страницу…");
    expect(describeStep(null)).toBe("Пишу ответ…");
    expect(draftText({ text: "Растущий ответ", step: null })).toBe("Растущий ответ");
    expect(draftText({ text: "", step: { toolName: "executeCode", code: "env.MNEMOS.search()" } })).toBe("Ищу в Mnemos…");
    expect(draftText({ text: "я".repeat(5000), step: null }).length).toBeLessThanOrEqual(4096);
  });
});

// ---- этап 3: беседа сайта ↔ тред ----

const WORKSPACE = "c".repeat(64);
const siteInput = (previousKey: string | null = null) => ({
  previousKey, workspace: WORKSPACE, title: "Смета на ремонт", summary: "Беседа перенесена с сайта.\n\n**Вы:** посчитай смету",
  chatPath: `/workspace/${WORKSPACE}?chat=3`,
});

describe("беседа сайта → тред", () => {
  it("«Продолжить в Telegram»: тред с названием беседы, первым сообщением — краткое содержание", async () => {
    let h = await harness();
    let result = await h.bot.linkSiteChat(OWNER, siteInput());
    expect(result).toEqual({ state: { status: "linked", bot: "alice_helper_bot", url: "https://t.me/alice_helper_bot" }, key: `${BOT}:${ALICE}:500` });
    expect(h.calls[0]).toEqual({ method: "createForumTopic", body: { chat_id: ALICE, name: "Смета на ремонт" } });
    expect(messages(h.calls)).toEqual([expect.objectContaining({ message_thread_id: 500, parse_mode: "HTML", text: expect.stringContaining("<b>Вы:</b> посчитай смету") })]);
    expect(h.link(500)).toMatchObject({ workspace: WORKSPACE, naming: "bot", title: "Смета на ремонт", chatPath: `/workspace/${WORKSPACE}?chat=3` });
    expect(h.bot.siteLink(OWNER, `${BOT}:${ALICE}:500`)).toMatchObject({ status: "linked" });
    // Повтор, пока тред жив, второго треда не создаёт.
    h.calls.length = 0;
    expect((await h.bot.linkSiteChat(OWNER, siteInput(`${BOT}:${ALICE}:500`))).key).toBe(`${BOT}:${ALICE}:500`);
    expect(h.calls).toEqual([]);
  });

  it("без подключённого бота переносить некуда; чужой ключ — не связь", async () => {
    let h = await harness();
    h.map.set("bot", { ...(h.map.get("bot") as BotRecord), telegramOwner: null, connectedAt: null });
    expect(await h.bot.linkSiteChat(OWNER, siteInput())).toEqual({ state: { status: "unavailable" }, key: null });
    expect(h.bot.siteLink(OWNER, null)).toEqual({ status: "unavailable" });
    let ok = await harness();
    await ok.bot.linkSiteChat(OWNER, siteInput());
    expect(ok.bot.siteLink(OWNER, `999:${ALICE}:500`)).toMatchObject({ status: "available" });
    expect(() => ok.bot.siteLink("mallory@example.ru", `${BOT}:${ALICE}:500`)).toThrow();
  });

  it("сообщение в перенесённом треде идёт в беседу сайта по её номеру", async () => {
    let h = await harness();
    await h.bot.linkSiteChat(OWNER, siteInput());
    await send(h, inThread(ALICE, 500, { text: "Добавь плитку" }));
    expect(h.submits[0].input).toMatchObject({ workspaceId: WORKSPACE, chatKey: `${BOT}:${ALICE}:500`, prompt: "Добавь плитку" });
    await send(h, inThread(ALICE, 500, { forum_topic_edited: { name: "Ремонт кухни" } }));
    expect(h.renames).toEqual([{ callerEmail: OWNER, gadgetKey: `${BOT}:${ALICE}:500`, chatKey: `${BOT}:${ALICE}:500`, title: "Ремонт кухни", workspaceId: WORKSPACE }]);
  });

  it("удалённый в Telegram тред обнаруживается при отправке, и перенос создаёт новый", async () => {
    let h = await harness();
    let { key } = await h.bot.linkSiteChat(OWNER, siteInput());
    h.tg.goneThreads.add(500);
    await h.bot.siteEvent(OWNER, key!, { type: "human", id: "w:3:10", text: "Ещё вопрос" });
    expect(h.link(500)?.unlinked).toBe(true);
    expect(h.bot.siteLink(OWNER, key)).toMatchObject({ status: "available" });
    h.calls.length = 0;
    let again = await h.bot.linkSiteChat(OWNER, siteInput(key));
    expect(again.key).toBe(`${BOT}:${ALICE}:501`);
    expect(methods(h.calls)[0]).toBe("createForumTopic");
  });
});

describe("зеркало сайта в тред", () => {
  async function linked() {
    let h = await harness();
    let { key } = await h.bot.linkSiteChat(OWNER, siteInput());
    h.calls.length = 0;
    let ref: TelegramTurnRef = { route: ROUTE, chat: ALICE, thread: 500, update: 0, site: `${WORKSPACE}:3:12` };
    return { h, key: key!, ref };
  }

  it("сообщение человека — с пометкой «с сайта», повтор того же сообщения второго не шлёт", async () => {
    let { h, key } = await linked();
    await h.bot.siteEvent(OWNER, key, { type: "human", id: "w:3:10", text: "Посчитай **с работой**" });
    await h.bot.siteEvent(OWNER, key, { type: "human", id: "w:3:10", text: "Посчитай **с работой**" });
    expect(messages(h.calls)).toEqual([expect.objectContaining({ message_thread_id: 500, parse_mode: "HTML", text: "<i>С сайта:</i>\nПосчитай <b>с работой</b>" })]);
    // Сообщение соавтора подписано его именем.
    await h.bot.siteEvent(OWNER, key, { type: "human", id: "w:3:11", text: "А сроки?", author: "Боб <Смит>" });
    expect(messages(h.calls).at(-1)).toMatchObject({ text: "<i>С сайта, Боб &lt;Смит&gt;:</i>\nА сроки?" });
  });

  it("ответ агента на ход с сайта уходит в тред один раз, как обычный ответ", async () => {
    let { h, ref } = await linked();
    await h.bot.deliver(ref, { text: "Смета: 120 000 ₽.", title: "Смета на ремонт" });
    await h.bot.deliver(ref, { text: "Смета: 120 000 ₽.", title: "Смета на ремонт" });
    expect(messages(h.calls)).toEqual([expect.objectContaining({ message_thread_id: 500, text: "Смета: 120 000 ₽." })]);
    // Тред назван названием беседы при переносе: переименовывать нечего.
    expect(methods(h.calls)).not.toContain("editForumTopic");
  });

  it("ход с сайта не идёт в тред без связи, в тред другого бота и в удалённый тред", async () => {
    let { h, ref } = await linked();
    await h.bot.deliver({ ...ref, thread: 77 }, { text: "секрет" });
    h.map.set("thread:500", { ...h.link(500)!, key: `999:${ALICE}:500` });
    await h.bot.deliver(ref, { text: "секрет" });
    h.map.set("thread:500", { ...h.link(500)!, key: `${BOT}:${ALICE}:500`, unlinked: true });
    await h.bot.deliver(ref, { text: "секрет" });
    expect(h.calls).toEqual([]);
  });

  it("удалённый тред: ответ на ход с сайта остаётся на сайте, без треда не шлётся", async () => {
    let { h, ref } = await linked();
    h.tg.goneThreads.add(500);
    await h.bot.deliver(ref, { text: "Ответ" });
    expect(messages(h.calls)).toHaveLength(1);
    expect(h.link(500)?.unlinked).toBe(true);
  });

  it("переименование на сайте → editForumTopic; архив → сообщение в тред; удаление → deleteForumTopic", async () => {
    let { h, key } = await linked();
    await h.bot.siteEvent(OWNER, key, { type: "rename", title: "Ремонт кухни" });
    expect(h.calls.at(-1)).toEqual({ method: "editForumTopic", body: { chat_id: ALICE, message_thread_id: 500, name: "Ремонт кухни" } });
    expect(h.link(500)).toMatchObject({ title: "Ремонт кухни", renamed: true });
    await h.bot.siteEvent(OWNER, key, { type: "archived" });
    expect(messages(h.calls).at(-1)).toMatchObject({ message_thread_id: 500, text: ARCHIVED_NOTICE });
    await h.bot.siteEvent(OWNER, key, { type: "deleted" });
    expect(h.calls.at(-1)).toEqual({ method: "deleteForumTopic", body: { chat_id: ALICE, message_thread_id: 500 } });
    expect(h.link(500)).toBeUndefined();
  });

  it("событие с чужим ключом ничего не делает", async () => {
    let { h } = await linked();
    await h.bot.siteEvent(OWNER, `999:${ALICE}:500`, { type: "deleted" });
    await h.bot.siteEvent(OWNER, `${BOT}:${MALLORY}:500`, { type: "rename", title: "Взлом" });
    expect(h.calls).toEqual([]);
    expect(h.link(500)).toBeDefined();
  });
});

// ---- этап 4: карточки решений ----

function press(sender: number, data: string | undefined, message: number | undefined, chat = sender): Message {
  return { update_id: nextUpdate++, callback_query: {
    id: "cb" + nextUpdate, from: { id: sender, is_bot: false, first_name: "Кто-то" }, chat_instance: "1",
    ...(data !== undefined ? { data } : {}),
    message: { ...(message !== undefined ? { message_id: message } : {}), date: 1, chat: { id: chat, type: "private" }, message_thread_id: 90, is_topic_message: true },
  } };
}

describe("карточки решений в треде", () => {
  const decision = { action: 7, title: "Опубликовать «Отчёт за сентябрь»", details: ["Проект «Продажи»", "Увидят все участники"],
    description: "Документ **«Отчёт за сентябрь»** станет виден всему проекту." };

  async function carded(options: Options = {}) {
    let h = await harness(options);
    await send(h, topicCreated(90, "Опубликуй", true));
    await send(h, inThread(ALICE, 90, { text: "Опубликуй отчёт" }));
    let ref = h.submits[0].ref;
    h.calls.length = 0;
    await h.bot.deliver(ref, { text: "Подготовил публикацию.", decisions: [decision] });
    let cardCall = h.calls.find(c => c.method === "sendMessage" && c.body.reply_markup)!;
    let markup = cardCall.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] };
    let [approve, reject] = markup.inline_keyboard[0].map(button => button.callback_data);
    let message = h.card(1)!.message!;
    h.calls.length = 0;
    return { h, ref, approve, reject, message, cardCall };
  }

  it("ход ждёт решения — в тред приходит карточка с кнопками вместо ссылки на сайт", async () => {
    let { h, cardCall, approve, reject } = await carded();
    expect(cardCall.body).toMatchObject({ chat_id: ALICE, message_thread_id: 90, parse_mode: "HTML" });
    expect(cardCall.body.text).toBe("<b>Нужно ваше решение</b>\n<b>Опубликовать «Отчёт за сентябрь»</b>\nПроект «Продажи»\nУвидят все участники\n\n" +
      "Документ <b>«Отчёт за сентябрь»</b> станет виден всему проекту.");
    expect(messages(h.calls).some(body => String(body.text).includes("откройте беседу на сайте"))).toBe(false);
    expect([approve, reject]).toEqual(["d:90:1:a", "d:90:1:r"]);
    expect(new TextEncoder().encode(approve).byteLength).toBeLessThanOrEqual(64);
    expect(h.card(1)).toMatchObject({ key: `${BOT}:${ALICE}:90`, action: 7, state: "pending", workspace: null });
  });

  it("повтор доставки второй карточки не шлёт", async () => {
    let { h, ref } = await carded();
    await h.bot.deliver({ ...ref, update: ref.update + 50 }, { text: "", noReply: true, decisions: [decision] });
    expect(h.calls.filter(c => c.method === "sendMessage")).toEqual([]);
  });

  it("«Подтвердить» владельца: решение через беседу, ответ на нажатие после проверки, кнопки сняты", async () => {
    let { h, approve, message } = await carded();
    await send(h, press(ALICE, approve, message));
    expect(h.decides).toEqual([{ callerEmail: OWNER, gadgetKey: `${BOT}:${ALICE}:90`, chatKey: `${BOT}:${ALICE}:90`, action: 7, decision: "approve" }]);
    expect(methods(h.calls)).toEqual(["answerCallbackQuery", "editMessageText"]);
    expect(h.calls[0].body).toMatchObject({ text: CARD_APPROVED });
    expect(h.calls[1].body).toMatchObject({ chat_id: ALICE, message_id: message, parse_mode: "HTML" });
    expect(String(h.calls[1].body.text)).toMatch(/<b>Подтверждено<\/b>$/);
    expect(h.calls[1].body.reply_markup).toBeUndefined();
    expect(h.card(1)?.state).toBe("approved");
  });

  it("«Отклонить» отклоняет", async () => {
    let { h, reject, message } = await carded();
    await send(h, press(ALICE, reject, message));
    expect(h.decides.map(d => d.decision)).toEqual(["reject"]);
    expect(h.calls[0].body).toMatchObject({ text: CARD_REJECTED });
    expect(String(h.calls[1].body.text)).toMatch(/Отклонено<\/b>$/);
  });

  it("чужой нажавший: ни решения, ни ответа", async () => {
    let { h, approve, message } = await carded();
    await send(h, press(MALLORY, approve, message));
    // Подделка: кнопка «в чате Алисы» от имени другого человека — разбор отбрасывает.
    await send(h, press(MALLORY, approve, message, ALICE));
    expect(h.decides).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(h.card(1)?.state).toBe("pending");
  });

  it("повтор нажатия второго решения не даёт", async () => {
    let { h, approve, reject, message } = await carded();
    await send(h, press(ALICE, approve, message));
    h.calls.length = 0;
    await send(h, press(ALICE, reject, message));
    await send(h, press(ALICE, approve, message));
    expect(h.decides).toHaveLength(1);
    expect(h.calls.map(c => [c.method, c.body.text])).toEqual([["answerCallbackQuery", CARD_STALE], ["answerCallbackQuery", CARD_STALE]]);
  });

  it("нажатие, пока решение применяется, — «уже принимается», без второго решения", async () => {
    let release!: () => void;
    let gate = new Promise<void>(resolve => { release = resolve; });
    let { h, approve, message } = await carded({ decide: async () => { await gate; return { status: "approved" }; } });
    await h.bot.webhook(hook(press(ALICE, approve, message)));
    await h.bot.webhook(hook(press(ALICE, approve, message)));
    for (let i = 0; i < 50 && !h.calls.length; i++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(h.calls).toEqual([expect.objectContaining({ method: "answerCallbackQuery", body: expect.objectContaining({ text: CARD_BUSY }) })]);
    release();
    await h.settle();
    expect(h.decides).toHaveLength(1);
  });

  it("устаревшая карточка: беседа говорит, что решение уже принято, — кнопки сняты, действия нет", async () => {
    let { h, approve, message } = await carded({ decide: async () => ({ status: "stale", state: "rejected" }) });
    await send(h, press(ALICE, approve, message));
    expect(h.calls[0].body).toMatchObject({ text: CARD_STALE });
    expect(String(h.calls[1].body.text)).toMatch(/Уже отклонено<\/b>$/);
    expect(h.card(1)?.state).toBe("stale");
  });

  it("ничего из callback_data не используется без проверки: чужой тред, чужое сообщение, неизвестная карточка", async () => {
    let { h, approve, message } = await carded();
    for (let data of ["d:91:1:a", "d:90:2:a", "d:90:1:x", "d:90:01:a", "approve", "d:90:1:a:extra"]) await send(h, press(ALICE, data, message));
    await send(h, press(ALICE, approve, message + 1));
    await send(h, press(ALICE, approve, undefined));
    await send(h, press(ALICE, undefined, message));
    expect(h.decides).toEqual([]);
    expect(h.calls.every(c => c.method === "answerCallbackQuery" && c.body.text === CARD_UNKNOWN)).toBe(true);
    expect(h.calls).toHaveLength(9);
    expect(h.card(1)?.state).toBe("pending");
  });

  it("сбой решения: карточка снова ждёт, повторное нажатие работает", async () => {
    let failing = true;
    let { h, approve, message } = await carded({ decide: async input => {
      if (failing) throw new Error("gatekeeper down");
      return { status: input.decision === "approve" ? "approved" : "rejected" };
    } });
    await send(h, press(ALICE, approve, message));
    expect(h.calls).toEqual([expect.objectContaining({ method: "answerCallbackQuery", body: expect.objectContaining({ text: CARD_FAILED }) })]);
    expect(h.card(1)?.state).toBe("pending");
    failing = false;
    await send(h, press(ALICE, approve, message));
    expect(h.card(1)?.state).toBe("approved");
  });

  it("решение на сайте обновляет карточку, после этого кнопка ничего не делает", async () => {
    let { h, approve, message } = await carded();
    await h.bot.siteEvent(OWNER, `${BOT}:${ALICE}:90`, { type: "decided", action: 7, state: "approved" });
    expect(h.calls).toEqual([expect.objectContaining({ method: "editMessageText" })]);
    expect(String(h.calls[0].body.text)).toMatch(/Подтверждено на сайте<\/b>$/);
    h.calls.length = 0;
    await send(h, press(ALICE, approve, message));
    expect(h.decides).toEqual([]);
    expect(h.calls[0].body).toMatchObject({ text: CARD_STALE });
  });

  it("карточка в перенесённой беседе несёт номер беседы сайта в решение", async () => {
    let h = await harness();
    let { key } = await h.bot.linkSiteChat(OWNER, siteInput());
    await h.bot.deliver({ route: ROUTE, chat: ALICE, thread: 500, update: 0, site: "s1" }, { text: "Готово", decisions: [decision] });
    let n = h.card(1)!;
    await send(h, press(ALICE, "d:500:1:a", n.message!));
    expect(h.decides[0]).toMatchObject({ chatKey: key, workspaceId: WORKSPACE, action: 7 });
  });
});

describe("карточки: доработки после ревью", () => {
  const long = { action: 9, title: "Разослать письмо", details: ["Всем сотрудникам"], description: "Текст письма. ".repeat(400) };

  async function started() {
    let h = await harness();
    await send(h, topicCreated(90, "Опубликуй", true));
    await send(h, inThread(ALICE, 90, { text: "Опубликуй отчёт" }));
    let ref = h.submits[0].ref;
    h.calls.length = 0;
    return { h, ref };
  }

  it("описание не помещается в сообщение целиком — без кнопок, ссылка на сайт; описание не режется", async () => {
    let { h, ref } = await started();
    await h.bot.deliver(ref, { text: "Готово к рассылке.", decisions: [long] });
    let sent = messages(h.calls);
    expect(sent.every(body => body.reply_markup === undefined)).toBe(true);
    expect(String(sent.at(-1)!.text)).toContain("Нужно ваше решение — откройте беседу на сайте (https://mnemos.example.ru/workspace/w1?chat=0)");
    expect(h.card(1)).toBeUndefined();
  });

  it("ход соавтора: строка «<имя> ждёт решения», без кнопок", async () => {
    let { h, ref } = await started();
    await h.bot.deliver(ref, { text: "Подготовил.", waitingFor: "Боб" });
    let sent = messages(h.calls);
    expect(sent).toHaveLength(1);
    expect(sent[0].reply_markup).toBeUndefined();
    expect(String(sent[0].text)).toContain("Боб ждёт решения — на сайте");
  });

  it("доступ к материалам изменился — действие не применено, карточка говорит об этом", async () => {
    let h = await harness({ decide: async () => ({ status: "access_changed" }) });
    await send(h, topicCreated(90, "Опубликуй", true));
    await send(h, inThread(ALICE, 90, { text: "Опубликуй" }));
    await h.bot.deliver(h.submits[0].ref, { text: "", noReply: true, decisions: [{ action: 7, title: "Т", details: ["д"], description: "о" }] });
    h.calls.length = 0;
    await send(h, press(ALICE, "d:90:1:a", h.card(1)!.message!));
    expect(h.calls[0].body).toMatchObject({ text: CARD_ACCESS_CHANGED });
    expect(String(h.calls[1].body.text)).toContain(CARD_ACCESS_CHANGED);
    expect(h.card(1)?.state).toBe("stale");
  });

  it("зависшее «решается» после срока снова решаемо; решение на сайте закрывает и его", async () => {
    let { h, ref } = await started();
    await h.bot.deliver(ref, { text: "", noReply: true, decisions: [{ action: 7, title: "Т", details: ["д"], description: "о" }] });
    let card = h.card(1)!;
    h.map.set("card:1", { ...card, state: "deciding", decidingAt: h.clock.now });
    h.calls.length = 0;
    await send(h, press(ALICE, "d:90:1:a", card.message!));
    expect(h.decides).toEqual([]);
    h.clock.now += CARD_DECIDING_MS;
    await send(h, press(ALICE, "d:90:1:a", card.message!));
    expect(h.decides).toHaveLength(1);
    h.map.set("card:1", { ...card, state: "deciding", decidingAt: h.clock.now });
    h.calls.length = 0;
    await h.bot.siteEvent(OWNER, `${BOT}:${ALICE}:90`, { type: "decided", action: 7, state: "rejected" });
    expect(h.card(1)?.state).toBe("rejected");
    expect(methods(h.calls)).toEqual(["editMessageText"]);
  });

  it("название с сайта не трогает тред, названный человеком", async () => {
    let h = await harness();
    await send(h, topicCreated(91, "Мои продажи", false));
    await send(h, inThread(ALICE, 91, { text: "Привет" }));
    h.calls.length = 0;
    await h.bot.siteEvent(OWNER, `${BOT}:${ALICE}:91`, { type: "rename", title: "Название с сайта" });
    expect(h.calls).toEqual([]);
    // Тред, названный клиентом по тексту, переименовывается.
    await send(h, topicCreated(92, "Найди отчёт", true));
    await send(h, inThread(ALICE, 92, { text: "Найди отчёт" }));
    h.calls.length = 0;
    await h.bot.siteEvent(OWNER, `${BOT}:${ALICE}:92`, { type: "rename", title: "Название с сайта" });
    expect(methods(h.calls)).toEqual(["editForumTopic"]);
  });
});
