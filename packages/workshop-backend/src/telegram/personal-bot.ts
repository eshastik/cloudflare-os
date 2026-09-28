// Личный бот Telegram пользователя оболочки (ADR 0027 Mnemos, этап 1).
//
// Бот живёт в workshop-backend, в объекте на пользователя («user:<имя>»): на этапе 2 вебхук вызывает
// агента беседы от имени владельца (ExternalMessageGateway / OverseerDurableObject доступны здесь же
// через ctx.exports, без межсервисного моста). Привязка: бот ↔ пользователь оболочки (имя объекта)
// ↔ его принципал Mnemos (из справочника на момент подключения) ↔ один Telegram-аккаунт владельца
// (кто первым прислал «/start КОД» с кодом, который видел только вошедший владелец).
//
// Токен хранится зашифрованным ключом развёртывания (secret-box.ts). Секрет вебхука хранится только
// хэшем: проверке вебхука ключ не нужен. Один бот — у одного пользователя: занятость бота держит
// отдельный объект на номер бота (TelegramBotClaim).

import { threadsReady, type TelegramBotState, type TelegramDisconnectResult, type TelegramThreads } from "@gadgets/workshop-shared/telegram-bot";
import { TelegramBotApi, TELEGRAM_TOKEN } from "./bot-api";
import { openSecret, sameSecret, sealSecret, secretsKeyConfigured, SecretsKeyMissingError, SECRETS_KEY_MISSING, type SealedSecret } from "./secret-box";
import { parseTelegramUpdate, readBoundedBody } from "./updates";

export const TOKEN_PURPOSE = "telegram-bot-token";
export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const STAGE_ONE_REPLY = "Подключено. Скоро здесь будет агент беседы.";
const SEEN_UPDATES = 64;
/** Как часто экран может перепроверять режим тредов через getMe. */
export const THREADS_CHECK_MS = 60 * 1000;

export const TELEGRAM_WEBHOOK_PREFIX = "/api/telegram/";

export type BotRecord = {
  owner: string;
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
}

/** Ошибка для человека: текст показывается на экране как есть. */
export class TelegramSetupError extends Error {
  constructor(message: string) { super(message); this.name = "TelegramSetupError"; }
}

const RECORD = "bot";

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
    this.deps.storage.delete(RECORD);
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
      this.#reply(current, input.sender.id, STAGE_ONE_REPLY);
      return reply(200);
    }

    this.deps.storage.put(RECORD, current);
    if (input.sender.id !== owner.id) return reply(200);
    // Этап 1: агента беседы ещё нет. В старый путь поручений сообщения не уходят.
    this.#reply(current, owner.id, STAGE_ONE_REPLY);
    return reply(200);
  }
}

/** Номер объекта бота из адреса вебхука; null — адрес не наш. */
export function telegramWebhookRoute(pathname: string): string | null {
  if (!pathname.startsWith(TELEGRAM_WEBHOOK_PREFIX)) return null;
  let id = pathname.slice(TELEGRAM_WEBHOOK_PREFIX.length);
  return /^[0-9a-f]{64}$/.test(id) ? id : null;
}

export { SecretsKeyMissingError };
