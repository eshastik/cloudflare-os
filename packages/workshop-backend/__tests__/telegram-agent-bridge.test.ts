// Этап 2 ADR 0027 Mnemos: сообщение из треда Telegram → ход агента беседы → ответ в тред.
// Внешний вход агента подставной: здесь проверяется сторона бота (треды, названия, доставка).
import { describe, expect, it } from "vitest";
import {
  BUSY_REPLY, FAILED_REPLY, PersonalTelegramBot, UNSUPPORTED_REPLY, VOICE_BUSY_REPLY, VOICE_UNAVAILABLE_REPLY, VoiceUnavailableError,
  type BotRecord, type TelegramAgentGateway, type TelegramTurnRef, type ThreadLink,
} from "../src/telegram/personal-bot";
import { DraftLimiter, DRAFT_LIMIT, describeStep, draftText } from "../src/telegram/progress";
import { sealSecret } from "../src/telegram/secret-box";
import type { SubmitExternalMessageInput, SubmitExternalMessageResult, RenameExternalChatInput } from "@gadgets/workshop-shared/external-message-gateway";

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
    if (method === "sendMessageDraft" || method === "editForumTopic") return ok(true);
    if (method === "createForumTopic") return ok({ message_thread_id: 500, name: body.name, icon_color: 1 });
    if (method === "getFile") return ok({ file_id: body.file_id, file_path: "voice/file_1.oga", file_size: 3 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  let submits: { input: Omit<SubmitExternalMessageInput, "chatGatewayRpcTarget">; ref: TelegramTurnRef }[] = [];
  let renames: RenameExternalChatInput[] = [];
  let gateway: TelegramAgentGateway = {
    submit: async (input, ref) => {
      submits.push({ input, ref });
      return options.submit ? await options.submit(input, ref) : { accepted: true, chatPath: "/workspace/w1?chat=0" };
    },
    rename: async input => { renames.push(input); return true; },
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
  return { bot, map, calls, tg, submits, renames, transcribed, clock, settle, link };
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
