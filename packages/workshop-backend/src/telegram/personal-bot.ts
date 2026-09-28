// Личный бот Telegram пользователя оболочки (ADR 0027 Mnemos, этапы 1–2).
//
// Бот живёт в workshop-backend, в объекте на пользователя («user:<имя>»). Привязка: бот ↔
// пользователь оболочки (имя объекта) ↔ один Telegram-аккаунт владельца (кто первым прислал
// «/start КОД» с кодом, который видел только вошедший владелец).
//
// Токен хранится зашифрованным ключом развёртывания (secret-box.ts). Секрет вебхука хранится только
// хэшем: проверке вебхука ключ не нужен. Один бот — у одного пользователя: занятость бота держит
// отдельный объект на номер бота (TelegramBotClaim).
//
// Этап 2: сообщение владельца становится ходом агента беседы через внешний вход
// (ExternalMessageGateway) от имени владельца. Один тред личного чата — одна беседа сайта; ключ
// беседы — (бот, чат, тред). Связь треда с беседой (как тред назван, переименован ли, не удалён ли)
// хранится здесь, в объекте бота: это сведения о Telegram, беседе они не нужны, и при отключении
// бота уходят вместе с ним. Саму беседу по ключу находит и ведёт внешний вход.

import { threadsReady, type TelegramBotState, type TelegramDisconnectResult, type TelegramThreads } from "@gadgets/workshop-shared/telegram-bot";
import type { GadgetProgress, GadgetResponse, RenameExternalChatInput, SubmitExternalMessageInput, SubmitExternalMessageResult } from "@gadgets/workshop-shared/external-message-gateway";
import { DEFAULT_WORKSPACE_TITLE, isDefaultWorkspaceTitle } from "../workspace-title";
import { isParseError, isThreadNotFound, TelegramBotApi, TELEGRAM_TOKEN } from "./bot-api";
import { telegramChunks, type TelegramChunk } from "./format";
import { DraftLimiter, draftText } from "./progress";
import { openSecret, sameSecret, sealSecret, secretsKeyConfigured, SecretsKeyMissingError, SECRETS_KEY_MISSING, type SealedSecret } from "./secret-box";
import { parseTelegramUpdate, readBoundedBody, type TelegramInput } from "./updates";

export const TOKEN_PURPOSE = "telegram-bot-token";
export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const PAIRED_REPLY = "Готово, бот подключён. Напишите сообщение — Telegram откроет для него тред, и в нём ответит агент беседы. Каждый тред — отдельная беседа на сайте.";
export const NEW_THREAD_TITLE = "Новая беседа";
export const UNSUPPORTED_REPLY = "Я понимаю текст и голосовые сообщения. Напишите, что нужно сделать.";
export const VOICE_UNAVAILABLE_REPLY = "Голосовые сообщения пока не распознаются: на установке не настроено распознавание речи. Напишите текстом.";
export const VOICE_FAILED_REPLY = "Не получилось распознать голосовое сообщение. Попробуйте ещё раз или напишите текстом.";
export const VOICE_BUSY_REPLY = "Предыдущее голосовое сообщение ещё распознаётся. Дождитесь ответа и отправьте снова.";
export const BUSY_REPLY = "Агент ещё отвечает на прошлое сообщение в этом треде. Дождитесь ответа и напишите снова.";
export const FAILED_REPLY = "Не получилось передать сообщение агенту. Повторите через минуту.";
export const NO_THREAD_REPLY = "Не получилось открыть тред для беседы. Проверьте, что в BotFather у бота включён режим тредов, и повторите.";
const SEEN_UPDATES = 64;
const KEPT_REPLIES = 128;
/** Как часто экран может перепроверять режим тредов через getMe. */
export const THREADS_CHECK_MS = 60 * 1000;

export const TELEGRAM_WEBHOOK_PREFIX = "/api/telegram/";

export type BotRecord = {
  owner: string;
  /** Принципал Mnemos на момент подключения — только для сведения. Права на каждый ход берутся
   *  заново через подключение Mnemos владельца (замечание ревью С6), эта запись для прав не годится. */
  mnemos: { tenant: string; principal: string } | null;
  bot: { id: string; username: string; title: string };
  /** Режим тредов по последнему getMe и время проверки. */
  threads: TelegramThreads;
  checkedAt: number;
  token: SealedSecret;
  secretSha256: string;
  pairing: { code: string; expiresAt: number } | null;
  telegramOwner: { id: number; name: string; username: string | null } | null;
  connectedAt: number | null;
  createdAt: number;
  seen: number[];
};

export interface PersonalBotStorage {
  get<T>(key: string): T | undefined;
  put<T>(key: string, value: T): void;
  delete(key: string): boolean;
  list<T>(options: { prefix: string }): Iterable<[string, T]>;
}

/** Ход агента, начатый сообщением из треда: куда слать черновики и ответ. */
export type TelegramTurnRef = { route: string; chat: number; thread: number; update: number };

/** Как тред получил название. client — клиент Telegram по тексту первого сообщения
 *  (is_name_implicit), bot — бот создал тред сам, user — название дал человек, null — неизвестно
 *  (тред создан до подключения бота). Переименовывать по названию беседы можно только client и bot. */
export type ThreadNaming = "client" | "bot" | "user" | null;

export type ThreadLink = {
  thread: number;
  /** Ключ беседы у внешнего входа: номер бота, чат, тред. */
  key: string;
  naming: ThreadNaming;
  title: string | null;
  renamed: boolean;
  /** Тред удалён в Telegram: беседа на сайте осталась, ответы идут в чат без треда. */
  unlinked: boolean;
  chatPath: string | null;
  createdAt: number;
};

type ReplyState = { sent: number; unthreaded: boolean };

/** Внешний вход агента беседы (ExternalMessageGateway) от имени владельца бота. */
export interface TelegramAgentGateway {
  submit(input: Omit<SubmitExternalMessageInput, "chatGatewayRpcTarget">, ref: TelegramTurnRef): Promise<SubmitExternalMessageResult>;
  rename(input: RenameExternalChatInput): Promise<boolean>;
}

/** Распознавание не настроено на установке: голос не поддерживается. */
export class VoiceUnavailableError extends Error {
  constructor() { super("Voice transcription is not configured."); this.name = "VoiceUnavailableError"; }
}

export interface PersonalBotDeps {
  storage: PersonalBotStorage;
  secretsKey: string | undefined;
  publicBase: string | undefined;
  /** Номер этого объекта: часть адреса вебхука. */
  routeId: string;
  fetch: typeof fetch;
  claim(botId: string, owner: string): Promise<boolean>;
  release(botId: string, owner: string): Promise<void>;
  mnemosOf(owner: string): Promise<{ tenant: string; principal: string } | null>;
  now(): number;
  waitUntil(promise: Promise<unknown>): void;
  gateway: TelegramAgentGateway;
  /** Голос → текст от имени владельца (трата — в его учёт). VoiceUnavailableError — не настроено. */
  transcribe(owner: string, bytes: Uint8Array, mimeType: string): Promise<string>;
  /** Частота черновиков: одна на объект бота, живёт дольше одного вызова. */
  drafts: DraftLimiter;
  /** Одно распознавание голоса одновременно на бота, как диктовка на сайте. */
  voice: { busy: boolean };
}

/** Ошибка для человека: текст показывается на экране как есть. */
export class TelegramSetupError extends Error {
  constructor(message: string) { super(message); this.name = "TelegramSetupError"; }
}

const RECORD = "bot";
const THREAD_PREFIX = "thread:";
const REPLY_PREFIX = "reply:";
const REPLIES = "replies";

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

function randomSecret(): string {
  let bytes = crypto.getRandomValues(new Uint8Array(32));
  let text = "";
  for (let byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function pairingCode(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  let bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map(b => alphabet[b % alphabet.length]).join("");
}

/** Адрес вебхука: только https-источник установки, без пути, логина и параметров. */
export function webhookUrl(publicBase: string | undefined, routeId: string): string | null {
  if (!publicBase || !/^[0-9a-f]{64}$/.test(routeId)) return null;
  let base: URL;
  try { base = new URL(publicBase); } catch { return null; }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) return null;
  return base.origin + TELEGRAM_WEBHOOK_PREFIX + routeId;
}

function tokenContext(owner: string, botId: string): string {
  return JSON.stringify(["telegram-bot", owner, botId]);
}

export class PersonalTelegramBot {
  constructor(private deps: PersonalBotDeps) {}

  #record(): BotRecord | undefined { return this.deps.storage.get<BotRecord>(RECORD); }

  #mine(owner: string): BotRecord | undefined {
    let record = this.#record();
    if (record && record.owner !== owner) throw new Error("Telegram bot belongs to another user.");
    return record;
  }

  #describe(record: BotRecord | undefined): TelegramBotState {
    if (!record) {
      if (!secretsKeyConfigured(this.deps.secretsKey)) return { status: "unavailable", reason: "no_key" };
      if (!webhookUrl(this.deps.publicBase, this.deps.routeId)) return { status: "unavailable", reason: "no_public_address" };
      return { status: "none" };
    }
    let bot = { username: record.bot.username, title: record.bot.title };
    let threads = { enabled: record.threads?.enabled === true, usersCanCreate: record.threads?.usersCanCreate === true };
    if (record.telegramOwner && record.connectedAt !== null) {
      return { status: "connected", bot, threads, owner: { name: record.telegramOwner.name, username: record.telegramOwner.username }, connectedAt: record.connectedAt };
    }
    let pairing = record.pairing ?? { code: "", expiresAt: 0 };
    return { status: "pairing", bot, threads, code: pairing.code, expiresAt: pairing.expiresAt };
  }

  /** Состояние для экрана. Режим тредов перепроверяется getMe не чаще раза в минуту: его могут
   *  выключить в BotFather уже после подключения. Сбой Telegram оставляет прежний ответ. */
  async state(owner: string): Promise<TelegramBotState> {
    let record = this.#mine(owner);
    if (record && this.deps.now() - (record.checkedAt ?? 0) >= THREADS_CHECK_MS && secretsKeyConfigured(this.deps.secretsKey)) {
      try {
        let identity = await (await this.#api(record)).identity();
        let current = this.#mine(owner);
        if (current && current.bot.id === identity.id && current.secretSha256 === record.secretSha256) {
          current.threads = identity.threads;
          current.bot = { id: identity.id, username: identity.username, title: identity.title };
          current.checkedAt = this.deps.now();
          this.deps.storage.put(RECORD, current);
        }
      } catch { /* покажем последний известный ответ */ }
    }
    return this.#describe(this.#mine(owner));
  }

  async connect(owner: string, rawToken: string): Promise<TelegramBotState> {
    let token = typeof rawToken === "string" ? rawToken.trim() : "";
    if (!TELEGRAM_TOKEN.test(token)) {
      throw new TelegramSetupError("Это не похоже на токен бота. Скопируйте его из BotFather целиком: номер, двоеточие и около 35 символов.");
    }
    if (!secretsKeyConfigured(this.deps.secretsKey)) throw new TelegramSetupError(SECRETS_KEY_MISSING);
    let url = webhookUrl(this.deps.publicBase, this.deps.routeId);
    if (!url) throw new TelegramSetupError("У установки не задан публичный адрес https (PUBLIC_BASE_URL), Telegram некуда присылать сообщения. Обратитесь к администратору установки.");
    let previous = this.#mine(owner);

    let api = new TelegramBotApi(token, this.deps.fetch);
    let identity;
    try { identity = await api.identity(); }
    catch { throw new TelegramSetupError("Telegram не принял токен. Проверьте, что он скопирован целиком и бот не удалён в BotFather."); }

    // Каждая беседа — тред личного чата: без режима тредов бот не подключаем и ничего не сохраняем.
    if (!threadsReady(identity.threads)) {
      return { status: "needs_threads", bot: { username: identity.username, title: identity.title }, threads: identity.threads };
    }

    if (!await this.deps.claim(identity.id, owner)) {
      throw new TelegramSetupError("Этот бот уже подключён у другого пользователя. Создайте себе отдельного бота в BotFather.");
    }
    let sameBot = previous?.bot.id === identity.id;
    let secret = randomSecret();
    try {
      await api.setWebhook(url, secret);
    } catch {
      if (!sameBot) await this.deps.release(identity.id, owner).catch(() => {});
      throw new TelegramSetupError("Telegram не принял адрес для сообщений бота. Повторите через минуту.");
    }
    let sealed = await sealSecret(this.deps.secretsKey, TOKEN_PURPOSE, tokenContext(owner, identity.id), token);
    let [secretSha256, mnemos] = await Promise.all([sha256(secret), this.deps.mnemosOf(owner).catch(() => null)]);

    // Прежний бот (другой токен) больше не нужен: снимаем его вебхук и освобождаем.
    if (previous && !sameBot) await this.#teardown(previous);

    let now = this.deps.now();
    let current = this.#mine(owner);
    let keepOwner = current && current.bot.id === identity.id && current.telegramOwner && current.connectedAt !== null;
    let record: BotRecord = {
      owner, mnemos,
      bot: { id: identity.id, username: identity.username, title: identity.title },
      threads: identity.threads, checkedAt: now,
      token: sealed, secretSha256,
      pairing: keepOwner ? null : { code: pairingCode(), expiresAt: now + PAIRING_TTL_MS },
      telegramOwner: keepOwner ? current!.telegramOwner : null,
      connectedAt: keepOwner ? current!.connectedAt : null,
      createdAt: now, seen: [],
    };
    this.deps.storage.put(RECORD, record);
    return this.#describe(record);
  }

  renewCode(owner: string): TelegramBotState {
    let record = this.#mine(owner);
    if (!record) throw new TelegramSetupError("Бот не подключён. Начните с токена от BotFather.");
    if (record.telegramOwner) return this.#describe(record);
    record.pairing = { code: pairingCode(), expiresAt: this.deps.now() + PAIRING_TTL_MS };
    this.deps.storage.put(RECORD, record);
    return this.#describe(record);
  }

  async disconnect(owner: string): Promise<TelegramDisconnectResult> {
    let record = this.#mine(owner);
    if (!record) return { webhookRemoved: true };
    // Запись удаляется до сетевых вызовов: даже если Telegram не ответит, вебхук сюда уже не пройдёт.
    // Связи тредов уходят вместе с ботом; беседы на сайте остаются.
    this.deps.storage.delete(RECORD);
    for (let prefix of [THREAD_PREFIX, REPLY_PREFIX]) {
      for (let [key] of [...this.deps.storage.list({ prefix })]) this.deps.storage.delete(key);
    }
    this.deps.storage.delete(REPLIES);
    return { webhookRemoved: await this.#teardown(record) };
  }

  async #teardown(record: BotRecord): Promise<boolean> {
    let removed = false;
    try {
      let token = await openSecret(this.deps.secretsKey, TOKEN_PURPOSE, tokenContext(record.owner, record.bot.id), record.token);
      await new TelegramBotApi(token, this.deps.fetch).deleteWebhook();
      removed = true;
    } catch { /* без ключа или без ответа Telegram вебхук остаётся, но запись и секрет уже удалены */ }
    await this.deps.release(record.bot.id, record.owner).catch(() => {});
    return removed;
  }

  async #api(record: BotRecord): Promise<TelegramBotApi> {
    let token = await openSecret(this.deps.secretsKey, TOKEN_PURPOSE, tokenContext(record.owner, record.bot.id), record.token);
    return new TelegramBotApi(token, this.deps.fetch);
  }

  #reply(record: BotRecord, chat: number, text: string): void {
    this.deps.waitUntil(this.#api(record).then(api => api.sendText(chat, text)).catch(() => {}));
  }

  async webhook(request: Request): Promise<Response> {
    let reply = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });
    if (request.method !== "POST") return reply(405);
    let url = webhookUrl(this.deps.publicBase, this.deps.routeId);
    let record = this.#record();
    if (!record || !url || new URL(request.url).pathname !== new URL(url).pathname) return reply(404);
    let header = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
    if (!await sameSecret(await sha256(header), record.secretSha256)) return reply(401);
    let body = await readBoundedBody(request);
    if (!body) return reply(413);
    let input = parseTelegramUpdate(body);
    if (input === undefined) return reply(400);
    if (input === null) return reply(200);

    // Дальше без ожиданий: прочитать, проверить и записать одним куском, чтобы параллельный
    // вебхук или отключение не вклинились между проверкой и записью.
    let current = this.#record();
    if (!current || current.secretSha256 !== record.secretSha256) return reply(200);
    if (current.seen.includes(input.update)) return reply(200);
    current.seen = [...current.seen, input.update].slice(-SEEN_UPDATES);

    let owner = current.telegramOwner;
    if (input.kind === "callback") {
      this.deps.storage.put(RECORD, current);
      if (owner && input.sender.id === owner.id) {
        this.deps.waitUntil(this.#api(current).then(api => api.answerCallback(input.id)).catch(() => {}));
      }
      return reply(200);
    }

    if (!owner) {
      let pairing = current.pairing;
      let valid = pairing && pairing.expiresAt > this.deps.now() && input.text === "/start " + pairing.code;
      if (!valid) { this.deps.storage.put(RECORD, current); return reply(200); }
      current.telegramOwner = { id: input.sender.id, name: input.sender.name, username: input.sender.username };
      current.connectedAt = this.deps.now();
      current.pairing = null;
      this.deps.storage.put(RECORD, current);
      this.#reply(current, input.sender.id, PAIRED_REPLY);
      return reply(200);
    }

    this.deps.storage.put(RECORD, current);
    // Ход — только от владельца бота; остальных бот не слышит.
    if (input.sender.id !== owner.id) return reply(200);

    // Служебные сообщения о треде записываются сразу, до следующего обновления: первое сообщение
    // треда должно застать, как тред назван.
    if (input.topic && input.thread !== null) {
      this.#topicEvent(current, input.thread, input.topic);
      return reply(200);
    }
    if (input.topic) return reply(200);

    // Ход агента долгий: Telegram ждёт ответа на вебхук недолго и повторит обновление, поэтому
    // отвечаем сразу, а работу доводим в фоне (повтор отсечёт список увиденных обновлений).
    this.deps.waitUntil(this.#message(current, input).catch(() => {}));
    return reply(200);
  }

  // ---- треды и беседы ----

  #link(thread: number): ThreadLink | undefined {
    return this.deps.storage.get<ThreadLink>(THREAD_PREFIX + thread);
  }

  #putLink(link: ThreadLink): void {
    this.deps.storage.put(THREAD_PREFIX + link.thread, link);
  }

  #newLink(record: BotRecord, thread: number, naming: ThreadNaming, title: string | null): ThreadLink {
    return {
      thread, key: `${record.bot.id}:${record.telegramOwner!.id}:${thread}`, naming, title,
      renamed: false, unlinked: false, chatPath: null, createdAt: this.deps.now(),
    };
  }

  #topicEvent(record: BotRecord, thread: number, topic: NonNullable<Extract<TelegramInput, { kind: "message" }>["topic"]>): void {
    let link = this.#link(thread) ?? this.#newLink(record, thread, null, null);
    let userNamed = topic.kind === "edited" || !topic.implicit;
    if (topic.kind === "created" && link.naming === "user") return;
    link.naming = userNamed ? "user" : "client";
    link.title = topic.name;
    this.#putLink(link);
    // Название, которое человек дал треду, становится названием беседы (если беседа уже есть).
    if (userNamed && link.chatPath) {
      let owner = record.owner;
      this.deps.waitUntil(this.deps.gateway.rename({ callerEmail: owner, gadgetKey: link.key, chatKey: link.key, title: topic.name }).catch(() => false));
    }
  }

  async #say(record: BotRecord, text: string, thread?: number): Promise<void> {
    let chat = record.telegramOwner!.id;
    let api = await this.#api(record);
    try { await api.send(chat, text, thread !== undefined ? { thread } : {}); }
    catch (error) {
      if (thread === undefined || !isThreadNotFound(error)) throw error;
      await api.send(chat, text);
    }
  }

  async #message(record: BotRecord, input: Extract<TelegramInput, { kind: "message" }>): Promise<void> {
    let chat = record.telegramOwner!.id;
    if (!input.text && !input.voice) {
      await this.#say(record, UNSUPPORTED_REPLY, input.thread ?? undefined);
      return;
    }
    if (input.text && /^\/start(\s|$)/.test(input.text)) {
      await this.#say(record, PAIRED_REPLY, input.thread ?? undefined);
      return;
    }
    let api = await this.#api(record);

    // Тред беседы: из сообщения или новый, если сообщение пришло вне тредов (старый клиент).
    let link: ThreadLink;
    if (input.thread !== null) {
      link = this.#link(input.thread) ?? this.#newLink(record, input.thread, null, null);
    } else {
      let thread: number;
      try { thread = await api.createTopic(chat, NEW_THREAD_TITLE); }
      catch { await api.send(chat, NO_THREAD_REPLY).catch(() => {}); return; }
      link = this.#newLink(record, thread, "bot", NEW_THREAD_TITLE);
    }
    this.#putLink(link);
    let ref: TelegramTurnRef = { route: this.deps.routeId, chat, thread: link.thread, update: input.update };

    let prompt = input.text;
    if (!prompt && input.voice) {
      if (this.deps.voice.busy) { await this.#say(record, VOICE_BUSY_REPLY, link.thread); return; }
      this.deps.voice.busy = true;
      this.#draft(api, ref, "Распознаю голосовое сообщение…");
      try {
        let bytes = await api.fileBytes(input.voice.fileId);
        prompt = await this.deps.transcribe(record.owner, bytes, input.voice.mimeType);
      } catch (error) {
        await this.#say(record, error instanceof VoiceUnavailableError ? VOICE_UNAVAILABLE_REPLY : VOICE_FAILED_REPLY, link.thread);
        return;
      } finally { this.deps.voice.busy = false; }
    }
    if (!prompt?.trim()) { await this.#say(record, VOICE_FAILED_REPLY, link.thread); return; }

    let result: SubmitExternalMessageResult;
    try {
      result = await this.deps.gateway.submit({
        callerEmail: record.owner,
        gadgetKey: link.key,
        chatKey: link.key,
        messageKey: `${record.bot.id}:${input.update}`,
        gadgetTitle: link.naming === "user" && link.title ? link.title : DEFAULT_WORKSPACE_TITLE,
        prompt,
        streamProgress: true,
      }, ref);
    } catch (error) {
      // Подробности сбоя наружу не уходят: только то, что человеку можно сделать.
      let message = error instanceof Error ? error.message : "";
      await this.#say(record, /agent is running|being prepared|undelivered/i.test(message) ? BUSY_REPLY : FAILED_REPLY, link.thread);
      return;
    }
    if (!result.accepted) {
      await this.#say(record, result.message, link.thread);
      return;
    }
    let current = this.#link(link.thread) ?? link;
    current.chatPath = result.chatPath;
    this.#putLink(current);
    this.#draft(api, ref, "Думаю…");
  }

  #draftId(update: number): number {
    return (update % 2_147_483_646) + 1;
  }

  #draft(api: TelegramBotApi, ref: TelegramTurnRef, text: string): void {
    if (!this.deps.drafts.allow(this.deps.now())) return;
    this.deps.waitUntil(api.draft(ref.chat, ref.thread, this.#draftId(ref.update), text).catch(() => {}));
  }

  /** Запись бота, если ход относится к нему и к его владельцу; иначе ход чужой или бот отключён. */
  #turnRecord(ref: TelegramTurnRef): BotRecord | null {
    let record = this.#record();
    if (!record?.telegramOwner || ref.route !== this.deps.routeId || ref.chat !== record.telegramOwner.id) return null;
    return record;
  }

  /** Промежуточное состояние хода → черновик в треде, не чаще лимита Telegram. */
  async progress(ref: TelegramTurnRef, progress: GadgetProgress): Promise<void> {
    let record = this.#turnRecord(ref);
    if (!record || this.#link(ref.thread)?.unlinked) return;
    let text = draftText(progress);
    if (!text.trim() || !this.deps.drafts.allow(this.deps.now())) return;
    try { await (await this.#api(record)).draft(ref.chat, ref.thread, this.#draftId(ref.update), text); }
    catch { /* черновик необязателен: итог придёт сообщением */ }
  }

  /** Итог хода → сообщения в тред. Повторный вызов (доставка «хотя бы один раз») продолжает с
   *  первого неотправленного куска. Сбой Telegram бросается: внешний вход повторит доставку. */
  async deliver(ref: TelegramTurnRef, response: GadgetResponse): Promise<void> {
    let record = this.#turnRecord(ref);
    if (!record) return;
    let stateKey = REPLY_PREFIX + ref.update;
    let state = this.deps.storage.get<ReplyState>(stateKey) ?? { sent: 0, unthreaded: false };
    let link = this.#link(ref.thread) ?? this.#newLink(record, ref.thread, null, null);
    if (response.title && link.naming !== "user" && !isDefaultWorkspaceTitle(response.title)) link.title = response.title;

    let chunks = telegramChunks(this.#composeReply(response, link));
    let api = await this.#api(record);
    for (let index = state.sent; index < chunks.length; index++) {
      let threaded = !link.unlinked;
      try {
        await this.#sendChunk(api, ref.chat, chunks[index], threaded ? link.thread : undefined, !threaded && !state.unthreaded ? link.title : null);
      } catch (error) {
        if (!threaded || !isThreadNotFound(error)) { this.#putLink(link); this.deps.storage.put(stateKey, state); throw error; }
        // Тред удалён в Telegram: связь снимается, беседа остаётся; повтор без треда с названием.
        link.unlinked = true;
        await this.#sendChunk(api, ref.chat, chunks[index], undefined, state.unthreaded ? null : link.title);
      }
      if (link.unlinked) state.unthreaded = true;
      state.sent = index + 1;
      this.deps.storage.put(stateKey, state);
    }
    this.#rememberReply(ref.update);

    // Название треда — по названию беседы, если тред назвал не человек.
    if (!link.unlinked && !link.renamed && (link.naming === "client" || link.naming === "bot") &&
        response.title && !isDefaultWorkspaceTitle(response.title)) {
      try {
        await api.renameTopic(ref.chat, link.thread, response.title);
        link.renamed = true;
      } catch (error) {
        if (isThreadNotFound(error)) link.unlinked = true;
      }
    }
    this.#putLink(link);
  }

  #composeReply(response: GadgetResponse, link: ThreadLink): string {
    let text = response.noReply ? "Агент закончил ход без ответа." : response.text;
    let url = this.#siteUrl(link.chatPath);
    let open = (label: string) => url ? `[${label}](${url})` : label;
    if (response.documents?.length) {
      let names = response.documents.map(name => `«${name.replace(/[[\]()]/g, "")}»`).join(", ");
      text += `\n\nВ беседе созданы: ${names}. ${url ? open("Открыть на сайте") + "." : "Они доступны в беседе на сайте."}`;
    }
    if (response.needsDecision) {
      text += `\n\nНужно подтверждение — ${open("откройте беседу на сайте")}.`;
    }
    return text;
  }

  #siteUrl(chatPath: string | null): string | null {
    if (!chatPath || !chatPath.startsWith("/workspace/") || !this.deps.publicBase) return null;
    try {
      let base = new URL(this.deps.publicBase);
      return base.protocol === "https:" ? base.origin + chatPath : null;
    } catch { return null; }
  }

  async #sendChunk(api: TelegramBotApi, chat: number, chunk: TelegramChunk, thread: number | undefined, titleLine: string | null): Promise<void> {
    let options = thread !== undefined ? { thread } : {};
    let plainTitle = titleLine ? `«${titleLine}»\n\n` : "";
    if (chunk.html !== null) {
      let htmlTitle = titleLine ? `<b>«${titleLine.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}»</b>\n\n` : "";
      if ((htmlTitle + chunk.html).length <= 4096) {
        try { await api.send(chat, htmlTitle + chunk.html, { ...options, html: true }); return; }
        catch (error) { if (!isParseError(error)) throw error; }
      }
    }
    // Разметку Telegram не разобрал (или её нет): тот же кусок простым текстом.
    await api.send(chat, (plainTitle + chunk.plain).slice(0, 4096), options);
  }

  #rememberReply(update: number): void {
    let replies = [...(this.deps.storage.get<number[]>(REPLIES) ?? []).filter(id => id !== update), update];
    for (let old of replies.splice(0, Math.max(0, replies.length - KEPT_REPLIES))) this.deps.storage.delete(REPLY_PREFIX + old);
    this.deps.storage.put(REPLIES, replies);
  }
}

/** Номер объекта бота из адреса вебхука; null — адрес не наш. */
export function telegramWebhookRoute(pathname: string): string | null {
  if (!pathname.startsWith(TELEGRAM_WEBHOOK_PREFIX)) return null;
  let id = pathname.slice(TELEGRAM_WEBHOOK_PREFIX.length);
  return /^[0-9a-f]{64}$/.test(id) ? id : null;
}

export { SecretsKeyMissingError };
