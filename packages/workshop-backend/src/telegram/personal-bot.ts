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
//
// Этап 3: беседа сайта переносится в тред («Продолжить в Telegram»); у такой связи есть номер
// беседы сайта (workspace), и ходы из треда идут в неё. Сообщения человека с сайта, переименование,
// архив и удаление беседы приходят сюда от беседы (siteEvent), ответы агента на ходы с сайта — через
// ту же доставку, что и ответы на ходы из Telegram (ref.site).
//
// Этап 4: действие агента, ждущее решения, приходит в тред карточкой с кнопками. В callback_data —
// тред и номер карточки; всё остальное (беседа, действие, сообщение) берётся из записи карточки
// здесь, а решение принимает беседа после своей проверки (DecideExternalAction).
//
// Этап 5: уведомления Mnemos приходят в служебный тред «Уведомления» (notifications.ts). Ответ
// (reply) на уведомление открывает новую беседу с объектом уведомления.
//
// Этап 6: у документа есть кнопка Mini App. Адрес несёт одноразовый токен экрана (не дольше
// SCREEN_TTL_MS); открыть экран можно только с initData владельца бота, подписанными Telegram
// (web-app-data.ts). Сессии, ограниченной одним документом, в оболочке пока нет, поэтому экран
// Mini App показывает документ и ведёт на сайт, а редактор не открывает.

import { threadsReady, type TelegramBotState, type TelegramChatLink, type TelegramDisconnectResult, type TelegramThreads } from "@gadgets/workshop-shared/telegram-bot";
import type {
  DecideExternalActionInput, DecideExternalActionResult, ExternalDecision, GadgetProgress, GadgetResponse,
  RenameExternalChatInput, SubmitExternalMessageInput, SubmitExternalMessageResult,
} from "@gadgets/workshop-shared/external-message-gateway";
import { DEFAULT_WORKSPACE_TITLE, isDefaultWorkspaceTitle } from "../workspace-title";
import { isNotModified, isParseError, isThreadNotFound, TelegramBotApi, TELEGRAM_TOKEN, type InlineButton } from "./bot-api";
import { markdownToTelegramHtml, telegramChunks, type TelegramChunk } from "./format";
import { DraftLimiter, draftText } from "./progress";
import { openSecret, sameSecret, sealSecret, secretsKeyConfigured, SecretsKeyMissingError, SECRETS_KEY_MISSING, type SealedSecret } from "./secret-box";
import { parseTelegramUpdate, readBoundedBody, type TelegramInput } from "./updates";
import {
  claimNoticeCard, deliverNotifications, loadNotifyState, nextDelay, noticeCardHtml, noticeFor, noticePrompt, settleNoticeCard,
  MnemosNotConnectedError, NOTIFY_KEY_PREFIXES, NOTIFY_KEYS, NOTIFY_MAX_BACKOFF_MS, NOTIFY_THREAD_TITLE, type TelegramMnemos,
} from "./notifications";
import { verifyWebAppData } from "./web-app-data";

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
export const DELETED_ON_SITE_REPLY = "Эта беседа удалена на сайте. Чтобы начать новую, напишите сообщение вне этого треда.";
export const NO_THREAD_REPLY = "Не получилось открыть тред для беседы. Проверьте, что в BotFather у бота включён режим тредов, и повторите.";
export const ARCHIVED_NOTICE = "Беседа в архиве. Напишите сюда, чтобы вернуть её.";
export const SITE_THREAD_TITLE = "Беседа с сайта";
/** Подсказки на нажатие кнопки карточки (всплывают в Telegram). */
export const CARD_APPROVED = "Подтверждено";
export const CARD_REJECTED = "Отклонено";
export const CARD_STALE = "Решение по этому действию уже принято.";
export const CARD_UNKNOWN = "Эта карточка устарела.";
export const CARD_BUSY = "Решение уже принимается.";
export const CARD_FAILED = "Не получилось. Повторите через минуту или решите в беседе на сайте.";
export const CARD_DENIED = "Это действие можно решить только в беседе на сайте.";
export const CARD_ACCESS_CHANGED = "Доступ к материалам этой беседы изменился — откройте беседу на сайте.";
/** Сколько карточка может «решаться»: если решение не вернулось (сбой объекта), она снова решаема. */
export const CARD_DECIDING_MS = 2 * 60 * 1000;
const KEPT_CARDS = 256;
const SEEN_UPDATES = 64;
const KEPT_REPLIES = 128;
/** Как часто экран может перепроверять режим тредов через getMe. */
export const THREADS_CHECK_MS = 60 * 1000;

export const TELEGRAM_WEBHOOK_PREFIX = "/api/telegram/";
/** Страница Mini App во фронтенде и срок одноразового токена экрана. */
export const MINI_APP_PATH = "/telegram-app.html";
export const SCREEN_TTL_MS = 15 * 60 * 1000;
const SCREEN_PREFIX = "screen:";
const SCREENS = "screens";
const KEPT_SCREENS = 256;
/** Пауза перед первой доставкой уведомлений после подключения или пробуждения. */
export const NOTIFY_FIRST_MS = 1000;
export const NOTICE_THREAD_PREFIX = "По уведомлению: ";

/** Документ беседы, который открывает редактор Mini App: рабочее место и номер вывода в нём. */
export type AppDocumentRef = { workspace: string; gadget: number };
/** Что открывает экран Mini App: название и адрес на сайте; document — редактор документа.
 *  Тред — откуда открыт. */
export type ScreenTarget = { title: string; path: string; document?: AppDocumentRef };
type ScreenRecord = { target: ScreenTarget; thread: number | null; expiresAt: number; used: boolean };

/** Сессия Mini App без действий живёт 30 минут и продлевается действиями, но не дольше 8 часов. */
export const APP_SESSION_IDLE_MS = 30 * 60 * 1000;
export const APP_SESSION_MAX_MS = 8 * 60 * 60 * 1000;
/** Продление пишется в хранилище не чаще раза в минуту. */
const APP_SESSION_TOUCH_MS = 60 * 1000;
const APP_SESSION_PREFIX = "appsession:";
const APP_SESSIONS = "appsessions";
const KEPT_APP_SESSIONS = 32;

/** Сессия Mini App: хранится хэш секрета. Действует, пока подключён тот же бот (секрет вебхука),
 *  у того же владельца и того же пользователя Telegram. principal — аккаунт Mnemos при выдаче. */
type AppSessionRecord = {
  owner: string; botSecret: string; telegramUser: number; document: AppDocumentRef; principal: string | null;
  createdAt: number; expiresAt: number;
};

/** Что разрешает действующая сессия Mini App: один документ владельца. */
export type MiniAppSessionGrant = { owner: string; document: AppDocumentRef; principal: string | null;
  /** Предельный срок сессии (выдача + APP_SESSION_MAX_MS): в этот момент сервер закрывает связь. */
  endsAt: number };

/** Ответ экрана Mini App. denied — без подробностей: чужие данные, подделка, не тот бот.
 *  session — сессия редактора этого документа; нет — документ открывается только на сайте. */
export type MiniAppOpenResult =
  | { status: "ok"; title: string; siteUrl: string | null; session?: string }
  | { status: "expired"; siteUrl: string | null }
  | { status: "denied" };

type AppDocument = { name: string; gadget: number | null };

/** Документы хода для кнопок «Открыть»: редактор — у созданных документов, таблиц и презентаций. */
function appDocuments(response: GadgetResponse): AppDocument[] {
  let editable = (response.editable ?? []).filter(e => Number.isSafeInteger(e?.gadgetId) && e.gadgetId >= 0 && typeof e.title === "string");
  let names = (response.documents ?? []).filter(name => typeof name === "string");
  let out: AppDocument[] = editable.map(e => ({ name: e.title, gadget: e.gadgetId }));
  for (let name of names) if (!out.some(d => d.name === name)) out.push({ name, gadget: null });
  return out.slice(0, 5);
}

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
  get<T>(key: string): T | undefined | Promise<T | undefined>;
  put<T>(key: string, value: T): void | Promise<void>;
  delete(key: string): boolean | Promise<boolean>;
  list<T>(options: { prefix: string }): Iterable<[string, T]> | Promise<Iterable<[string, T]>>;
}

/** Ход агента: куда слать черновики и ответ. update — номер обновления Telegram, начавшего ход;
 *  site — ход начат на сайте в связанной беседе (тогда update не используется). */
export type TelegramTurnRef = { route: string; chat: number; thread: number; update: number; site?: string };

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
  /** Беседа сайта, перенесённая в этот тред; нет — беседа создана из треда (по ключу). */
  workspace?: string | null;
  /** Беседу удалили на сайте, а тред в Telegram ещё не удалён: удаление повторяет будильник бота,
   *  сообщения из треда в беседу не идут. */
  deletedOnSite?: boolean;
};

type ReplyState = { sent: number; unthreaded: boolean };

type CardState = "pending" | "deciding" | "approved" | "rejected" | "stale";

/** Карточка решения в треде. Номер n — в callback_data кнопок; беседа и действие — только здесь. */
export type CardRecord = {
  n: number;
  thread: number;
  key: string;
  workspace: string | null;
  action: number;
  /** Сообщение карточки; null — ещё не отправлена. */
  message: number | null;
  html: string;
  state: CardState;
  createdAt: number;
  /** Когда нажали кнопку (state = deciding). */
  decidingAt?: number;
};

/** Событие беседы сайта для её треда. */
export type SiteEvent =
  | { type: "human"; id: string; text: string; author?: string }
  | { type: "rename"; title: string }
  | { type: "archived" }
  | { type: "deleted" }
  | { type: "decided"; action: number; state: "approved" | "rejected" };

/** Что беседа сайта передаёт при переносе в Telegram. */
export type SiteChatInput = {
  /** Ключ прежнего треда беседы, если он был. */
  previousKey: string | null;
  workspace: string;
  title: string;
  summary: string;
  chatPath: string;
};

/** Внешний вход агента беседы (ExternalMessageGateway) от имени владельца бота. */
export interface TelegramAgentGateway {
  submit(input: Omit<SubmitExternalMessageInput, "chatGatewayRpcTarget">, ref: TelegramTurnRef): Promise<SubmitExternalMessageResult>;
  rename(input: RenameExternalChatInput): Promise<boolean>;
  decide(input: DecideExternalActionInput): Promise<DecideExternalActionResult>;
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
  /** Mnemos владельца для уведомлений: сессией человека через его подключение. */
  mnemos: TelegramMnemos;
  /** Будильник доставки уведомлений: время или null — снять. */
  setAlarm(at: number | null): void;
  /** Открытый ключ Telegram для initData Mini App; тесты подают свой. */
  webAppPublicKey?: string;
  /** Аккаунт Mnemos владельца сейчас (для сессии Mini App); null — не подключён. */
  mnemosPrincipal?(owner: string): Promise<string | null>;
}

/** Ошибка для человека: текст показывается на экране как есть. */
export class TelegramSetupError extends Error {
  constructor(message: string) { super(message); this.name = "TelegramSetupError"; }
}

const RECORD = "bot";
const THREAD_PREFIX = "thread:";
const REPLY_PREFIX = "reply:";
const REPLIES = "replies";
const CARD_PREFIX = "card:";
const CARD_FOR_PREFIX = "cardfor:";
const CARDS = "cards";
const CARD_SEQ = "cardseq";
const CARD_DATA = /^d:([1-9][0-9]{0,9}):([1-9][0-9]{0,9}):([ar])$/;

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Текст карточки решения: вопрос, название, подробности и полное описание действия. null —
 *  карточка целиком не помещается в сообщение Telegram: тогда решение только на сайте, кнопки под
 *  обрезанным описанием не ставятся никогда. */
export function cardHtml(decision: ExternalDecision): string | null {
  let title = escapeHtml(decision.title.replace(/\s+/g, " ").trim() || "Действие агента");
  let details = (decision.details ?? []).map(line => escapeHtml(line.replace(/\s+/g, " ").trim())).filter(Boolean);
  let description = typeof decision.description === "string" && decision.description.trim() ? markdownToTelegramHtml(decision.description.trim()) : "";
  let html = [`<b>Нужно ваше решение</b>`, `<b>${title}</b>`, ...details].join("\n") + (description ? "\n\n" + description : "");
  return html.length <= 4096 ? html : null;
}

type Lead = { html: string; plain: string } | null;

function titleLead(title: string | null): Lead {
  return title ? { html: `<b>«${escapeHtml(title)}»</b>\n\n`, plain: `«${title}»\n\n` } : null;
}

function siteLead(author: string | undefined): Lead {
  let name = typeof author === "string" ? author.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  let label = name ? `С сайта, ${name}:` : "С сайта:";
  return { html: `<i>${escapeHtml(label)}</i>\n`, plain: label + "\n" };
}

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
  #tail: Promise<unknown> = Promise.resolve();

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    let result = this.#tail.then(async () => await operation());
    this.#tail = result.catch(() => {});
    return result;
  }

  async state(owner: string): Promise<TelegramBotState> { return await this.#serialize(() => this.#runState(owner)); }

  async connect(owner: string, rawToken: string): Promise<TelegramBotState> { return await this.#serialize(() => this.#runConnect(owner, rawToken)); }

  async renewCode(owner: string): Promise<TelegramBotState> { return await this.#serialize(() => this.#runRenewCode(owner)); }

  async disconnect(owner: string): Promise<TelegramDisconnectResult> { return await this.#serialize(() => this.#runDisconnect(owner)); }

  async webhook(request: Request): Promise<Response> { return await this.#serialize(() => this.#runWebhook(request)); }

  async deliver(ref: TelegramTurnRef, response: GadgetResponse): Promise<void> { return await this.#serialize(() => this.#runDeliver(ref, response)); }

  async pollNotifications(): Promise<number | null> { return await this.#serialize(() => this.#runPollNotifications()); }

  async openMiniApp(secret: unknown, initData: unknown): Promise<MiniAppOpenResult> { return await this.#serialize(() => this.#runOpenMiniApp(secret, initData)); }

  async miniAppSession(secret: unknown): Promise<MiniAppSessionGrant | null> { return await this.#serialize(() => this.#runMiniAppSession(secret)); }

  async endMiniAppSession(secret: unknown): Promise<void> { return await this.#serialize(() => this.#runEndMiniAppSession(secret)); }

  async siteLink(owner: string, key: string | null): Promise<TelegramChatLink> { return await this.#serialize(() => this.#runSiteLink(owner, key)); }

  async linkSiteChat(owner: string, input: SiteChatInput): Promise<{ state: TelegramChatLink; key: string | null }> { return await this.#serialize(() => this.#runLinkSiteChat(owner, input)); }

  async retrySiteDeletions(): Promise<void> { return await this.#serialize(() => this.#runRetrySiteDeletions()); }

  async siteEvent(owner: string, key: string, event: SiteEvent): Promise<void> { return await this.#serialize(() => this.#runSiteEvent(owner, key, event)); }


  constructor(private deps: PersonalBotDeps) {}

  async #record(): Promise<BotRecord | undefined> { return (await this.deps.storage.get<BotRecord>(RECORD)); }

  async #mine(owner: string): Promise<BotRecord | undefined> {
    let record = (await this.#record());
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
  async #runState(owner: string): Promise<TelegramBotState> {
    let record = (await this.#mine(owner));
    if (record && this.deps.now() - (record.checkedAt ?? 0) >= THREADS_CHECK_MS && secretsKeyConfigured(this.deps.secretsKey)) {
      try {
        let identity = await (await this.#api(record)).identity();
        let current = (await this.#mine(owner));
        if (current && current.bot.id === identity.id && current.secretSha256 === record.secretSha256) {
          current.threads = identity.threads;
          current.bot = { id: identity.id, username: identity.username, title: identity.title };
          current.checkedAt = this.deps.now();
          (await this.deps.storage.put(RECORD, current));
        }
      } catch { /* покажем последний известный ответ */ }
    }
    return this.#describe((await this.#mine(owner)));
  }

  async #runConnect(owner: string, rawToken: string): Promise<TelegramBotState> {
    let token = typeof rawToken === "string" ? rawToken.trim() : "";
    if (!TELEGRAM_TOKEN.test(token)) {
      throw new TelegramSetupError("Это не похоже на токен бота. Скопируйте его из BotFather целиком: номер, двоеточие и около 35 символов.");
    }
    if (!secretsKeyConfigured(this.deps.secretsKey)) throw new TelegramSetupError(SECRETS_KEY_MISSING);
    let url = webhookUrl(this.deps.publicBase, this.deps.routeId);
    if (!url) throw new TelegramSetupError("У установки не задан публичный адрес https (PUBLIC_BASE_URL), Telegram некуда присылать сообщения. Обратитесь к администратору установки.");
    let previous = (await this.#mine(owner));

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
    let current = (await this.#mine(owner));
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
    (await this.deps.storage.put(RECORD, record));
    return this.#describe(record);
  }

  async #runRenewCode(owner: string): Promise<TelegramBotState> {
    let record = (await this.#mine(owner));
    if (!record) throw new TelegramSetupError("Бот не подключён. Начните с токена от BotFather.");
    if (record.telegramOwner) return this.#describe(record);
    record.pairing = { code: pairingCode(), expiresAt: this.deps.now() + PAIRING_TTL_MS };
    (await this.deps.storage.put(RECORD, record));
    return this.#describe(record);
  }

  async #runDisconnect(owner: string): Promise<TelegramDisconnectResult> {
    let record = (await this.#mine(owner));
    if (!record) return { webhookRemoved: true };
    // Запись удаляется до сетевых вызовов: даже если Telegram не ответит, вебхук сюда уже не пройдёт.
    // Связи тредов уходят вместе с ботом; беседы на сайте остаются.
    (await this.deps.storage.delete(RECORD));
    for (let prefix of [THREAD_PREFIX, REPLY_PREFIX, CARD_PREFIX, CARD_FOR_PREFIX, SCREEN_PREFIX, APP_SESSION_PREFIX, ...NOTIFY_KEY_PREFIXES]) {
      for (let [key] of [...(await this.deps.storage.list({ prefix }))]) (await this.deps.storage.delete(key));
    }
    for (let key of [REPLIES, CARDS, CARD_SEQ, SCREENS, APP_SESSIONS, ...NOTIFY_KEYS]) (await this.deps.storage.delete(key));
    this.deps.setAlarm(null);
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

  async #runWebhook(request: Request): Promise<Response> {
    let reply = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });
    if (request.method !== "POST") return reply(405);
    let url = webhookUrl(this.deps.publicBase, this.deps.routeId);
    let record = (await this.#record());
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
    let current = (await this.#record());
    if (!current || current.secretSha256 !== record.secretSha256) return reply(200);
    if (current.seen.includes(input.update)) return reply(200);
    current.seen = [...current.seen, input.update].slice(-SEEN_UPDATES);

    let owner = current.telegramOwner;
    if (input.kind === "callback") {
      (await this.deps.storage.put(RECORD, current));
      // Нажатие не владельца бота не отвечается и ничего не делает.
      if (!owner || input.sender.id !== owner.id) return reply(200);
      // Карточка занимается сразу, до ожиданий: второе нажатие застанет её занятой.
      if (input.data?.startsWith("n:")) {
        let notice = (await claimNoticeCard(this.deps.storage, input.data, input.message, this.deps.now(),
          { unknown: CARD_UNKNOWN, busy: CARD_BUSY, stale: CARD_STALE }));
        this.deps.waitUntil(this.#settleNotice(current, input, notice).catch(() => {}));
        return reply(200);
      }
      let claim = (await this.#claimCard(current, input));
      this.deps.waitUntil(this.#settleCard(current, input, claim).catch(() => {}));
      return reply(200);
    }

    if (!owner) {
      let pairing = current.pairing;
      let valid = pairing && pairing.expiresAt > this.deps.now() && input.text === "/start " + pairing.code;
      if (!valid) { (await this.deps.storage.put(RECORD, current)); return reply(200); }
      current.telegramOwner = { id: input.sender.id, name: input.sender.name, username: input.sender.username };
      current.connectedAt = this.deps.now();
      current.pairing = null;
      (await this.deps.storage.put(RECORD, current));
      this.deps.setAlarm(this.deps.now() + NOTIFY_FIRST_MS);
      this.#reply(current, input.sender.id, PAIRED_REPLY);
      return reply(200);
    }

    (await this.deps.storage.put(RECORD, current));
    // Ход — только от владельца бота; остальных бот не слышит.
    if (input.sender.id !== owner.id) return reply(200);

    // Служебные сообщения о треде записываются сразу, до следующего обновления: первое сообщение
    // треда должно застать, как тред назван.
    if (input.topic && input.thread !== null) {
      (await this.#topicEvent(current, input.thread, input.topic));
      return reply(200);
    }
    if (input.topic) return reply(200);

    // Ход агента долгий: Telegram ждёт ответа на вебхук недолго и повторит обновление, поэтому
    // отвечаем сразу, а работу доводим в фоне (повтор отсечёт список увиденных обновлений).
    this.deps.waitUntil(this.#message(current, input).catch(() => {}));
    return reply(200);
  }

  // ---- треды и беседы ----

  async #link(thread: number): Promise<ThreadLink | undefined> {
    return (await this.deps.storage.get<ThreadLink>(THREAD_PREFIX + thread));
  }

  async #putLink(link: ThreadLink): Promise<void> {
    (await this.deps.storage.put(THREAD_PREFIX + link.thread, link));
  }

  #newLink(record: BotRecord, thread: number, naming: ThreadNaming, title: string | null): ThreadLink {
    return {
      thread, key: this.#key(record, thread), naming, title,
      renamed: false, unlinked: false, chatPath: null, createdAt: this.deps.now(),
    };
  }

  async #topicEvent(record: BotRecord, thread: number, topic: NonNullable<Extract<TelegramInput, { kind: "message" }>["topic"]>): Promise<void> {
    let link = (await this.#link(thread)) ?? this.#newLink(record, thread, null, null);
    let userNamed = topic.kind === "edited" || !topic.implicit;
    if (topic.kind === "created" && link.naming === "user") return;
    link.naming = userNamed ? "user" : "client";
    link.title = topic.name;
    (await this.#putLink(link));
    // Название, которое человек дал треду, становится названием беседы (если беседа уже есть).
    if (userNamed && link.chatPath) {
      let owner = record.owner;
      this.deps.waitUntil(this.deps.gateway.rename({
        callerEmail: owner, gadgetKey: link.key, chatKey: link.key, title: topic.name,
        ...(link.workspace ? { workspaceId: link.workspace } : {}),
      }).catch(() => false));
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
    let notice = input.replyTo !== null ? (await noticeFor(this.deps.storage, input.replyTo)) : undefined;
    let notifyThread = (await loadNotifyState(this.deps.storage)).thread;
    if (notice && input.thread !== null && input.thread === notifyThread) {
      // Ответ на уведомление — новая беседа об этом объекте, в своём треде.
      let title = (NOTICE_THREAD_PREFIX + notice.summary.replace(/\s+/g, " ").trim()).slice(0, 128);
      let thread: number;
      try { thread = await api.createTopic(chat, title); }
      catch { await this.#say(record, NO_THREAD_REPLY, input.thread).catch(() => {}); return; }
      link = this.#newLink(record, thread, "bot", title);
      link.renamed = true;
      (await this.#putLink(link));
      await api.send(chat, `Беседа по этому уведомлению — в треде «${title}».`, { thread: input.thread }).catch(() => {});
    } else if (input.thread !== null) {
      notice = undefined;
      link = (await this.#link(input.thread)) ?? this.#newLink(record, input.thread, null, null);
      if (link.deletedOnSite) { await this.#say(record, DELETED_ON_SITE_REPLY, link.thread); return; }
    } else {
      notice = undefined;
      let thread: number;
      try { thread = await api.createTopic(chat, NEW_THREAD_TITLE); }
      catch { await api.send(chat, NO_THREAD_REPLY).catch(() => {}); return; }
      link = this.#newLink(record, thread, "bot", NEW_THREAD_TITLE);
    }
    (await this.#putLink(link));
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
    if (notice) prompt = noticePrompt(notice, prompt, this.deps.publicBase);

    let result: SubmitExternalMessageResult;
    try {
      result = await this.deps.gateway.submit({
        callerEmail: record.owner,
        gadgetKey: link.key,
        chatKey: link.key,
        messageKey: `${record.bot.id}:${input.update}`,
        gadgetTitle: (link.naming === "user" || notice) && link.title ? link.title : DEFAULT_WORKSPACE_TITLE,
        prompt,
        streamProgress: true,
        ...(link.workspace ? { workspaceId: link.workspace } : {}),
      }, ref);
    } catch (error) {
      // Подробности сбоя наружу не уходят: только то, что человеку можно сделать.
      let message = error instanceof Error ? error.message : "";
      await this.#say(record, /agent is running|being prepared|undelivered/i.test(message) ? BUSY_REPLY : FAILED_REPLY, link.thread);
      return;
    }
    if (!result.accepted) {
      // Беседу удалили на сайте, а удаление до бота не дошло: связь треда снимается, пустая беседа
      // не создаётся.
      if (result.deletedOnSite) (await this.deps.storage.delete(THREAD_PREFIX + link.thread));
      await this.#say(record, result.deletedOnSite ? DELETED_ON_SITE_REPLY : result.message, link.thread);
      return;
    }
    let current = (await this.#link(link.thread)) ?? link;
    current.chatPath = result.chatPath;
    (await this.#putLink(current));
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
  async #turnRecord(ref: TelegramTurnRef): Promise<BotRecord | null> {
    let record = (await this.#record());
    if (!record?.telegramOwner || ref.route !== this.deps.routeId || ref.chat !== record.telegramOwner.id) return null;
    return record;
  }

  /** Промежуточное состояние хода → черновик в треде, не чаще лимита Telegram. */
  async progress(ref: TelegramTurnRef, progress: GadgetProgress): Promise<void> {
    let record = (await this.#turnRecord(ref));
    let current = (await this.#link(ref.thread));
    if (!record || current?.unlinked || current?.deletedOnSite) return;
    let text = draftText(progress);
    if (!text.trim() || !this.deps.drafts.allow(this.deps.now())) return;
    try { await (await this.#api(record)).draft(ref.chat, ref.thread, this.#draftId(ref.update), text); }
    catch { /* черновик необязателен: итог придёт сообщением */ }
  }

  /** Итог хода → сообщения в тред: текст, затем карточки решений. Повторный вызов (доставка «хотя
   *  бы один раз») продолжает с первого неотправленного куска. Сбой Telegram бросается: внешний вход
   *  повторит доставку. Ход с сайта (ref.site) идёт только в живой тред, связанный с беседой. */
  async #runDeliver(ref: TelegramTurnRef, response: GadgetResponse): Promise<void> {
    let record = (await this.#turnRecord(ref));
    if (!record) return;
    let site = ref.site !== undefined;
    let existing = (await this.#link(ref.thread));
    // Тред беседы, удалённой на сайте, уходит: ответы в него не шлются.
    if (existing?.deletedOnSite) return;
    if (site && (!existing || existing.key !== this.#key(record, ref.thread) || existing.unlinked)) return;
    let stateKey = REPLY_PREFIX + (site ? "site:" + ref.site : ref.update);
    let state = (await this.deps.storage.get<ReplyState>(stateKey)) ?? { sent: 0, unthreaded: false };
    let link = existing ?? this.#newLink(record, ref.thread, null, null);
    if (response.title && link.naming !== "user" && !isDefaultWorkspaceTitle(response.title)) link.title = response.title;

    let items = this.#replyItems(response, link);
    let api = await this.#api(record);
    for (let index = state.sent; index < items.length; index++) {
      let item = items[index];
      let send = (thread: number | undefined, lead: Lead) => item.kind === "chunk"
        ? this.#sendChunk(api, ref.chat, item.chunk, thread, lead)
        : item.kind === "apps"
          ? this.#sendApps(api, ref.chat, item.documents, link, thread)
          : this.#sendCard(api, record, link, item.decision, thread, lead);
      let threaded = !link.unlinked;
      try {
        await send(threaded ? link.thread : undefined, !threaded && !state.unthreaded ? titleLead(link.title) : null);
      } catch (error) {
        if (!threaded || !isThreadNotFound(error)) { (await this.#putLink(link)); (await this.deps.storage.put(stateKey, state)); throw error; }
        // Тред удалён в Telegram: связь снимается, беседа остаётся. Ответ на ход из Telegram уходит
        // без треда с названием; ответ на ход с сайта остаётся на сайте.
        link.unlinked = true;
        if (site) { (await this.#putLink(link)); (await this.deps.storage.put(stateKey, { ...state, sent: items.length })); return; }
        await send(undefined, state.unthreaded ? null : titleLead(link.title));
      }
      if (link.unlinked) state.unthreaded = true;
      state.sent = index + 1;
      (await this.deps.storage.put(stateKey, state));
    }
    (await this.#rememberReply(stateKey));

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
    (await this.#putLink(link));
  }

  #replyItems(response: GadgetResponse, link: ThreadLink): ({ kind: "chunk"; chunk: TelegramChunk } | { kind: "card"; decision: ExternalDecision } | { kind: "apps"; documents: AppDocument[] })[] {
    let decisions = (response.decisions ?? []).filter(decision => Number.isSafeInteger(decision.action) && decision.action >= 0);
    // Карточка, которая целиком не помещается в сообщение, решается только на сайте.
    let fits = decisions.filter(decision => cardHtml(decision) !== null);
    let needsSite = response.needsDecision || fits.length < decisions.length;
    decisions = fits;
    let text = response.noReply ? (decisions.length ? "" : "Агент закончил ход без ответа.") : response.text;
    let url = this.#siteUrl(link.chatPath);
    let open = (label: string) => url ? `[${label}](${url})` : label;
    if (response.documents?.length) {
      let names = response.documents.map(name => `«${name.replace(/[[\]()]/g, "")}»`).join(", ");
      text += `\n\nВ беседе созданы: ${names}. ${url ? open("Открыть на сайте") + "." : "Они доступны в беседе на сайте."}`;
    }
    // Решения, которые кнопкой не принять (запрос подключения, ввод пароля), — только на сайте.
    if (needsSite) {
      text += `\n\nНужно ваше решение — ${open("откройте беседу на сайте")}.`;
    }
    if (typeof response.waitingFor === "string" && response.waitingFor.trim()) {
      text += `\n\n${response.waitingFor.replace(/[[\]()*_`~]/g, "").trim()} ждёт решения — ${open("на сайте")}.`;
    }
    // Документы беседы открываются в Telegram (Mini App) кнопками отдельным сообщением.
    let apps = url && response.documents?.length ? [{ kind: "apps" as const, documents: appDocuments(response) }] : [];
    return [
      ...(text.trim() ? telegramChunks(text).map(chunk => ({ kind: "chunk" as const, chunk })) : []),
      ...apps,
      ...decisions.map(decision => ({ kind: "card" as const, decision })),
    ];
  }

  #siteUrl(chatPath: string | null): string | null {
    if (!chatPath || !chatPath.startsWith("/workspace/") || !this.deps.publicBase) return null;
    try {
      let base = new URL(this.deps.publicBase);
      return base.protocol === "https:" ? base.origin + chatPath : null;
    } catch { return null; }
  }

  async #sendChunk(api: TelegramBotApi, chat: number, chunk: TelegramChunk, thread: number | undefined, lead: Lead): Promise<void> {
    let options = thread !== undefined ? { thread } : {};
    if (chunk.html !== null) {
      let html = (lead?.html ?? "") + chunk.html;
      if (html.length <= 4096) {
        try { await api.send(chat, html, { ...options, html: true }); return; }
        catch (error) { if (!isParseError(error)) throw error; }
      }
    }
    // Разметку Telegram не разобрал (или её нет): тот же кусок простым текстом.
    await api.send(chat, ((lead?.plain ?? "") + chunk.plain).slice(0, 4096), options);
  }

  /** Кнопки «Открыть» (Mini App) для документов беседы. Без адреса Mini App сообщение не шлётся.
   *  Документ, таблица и презентация открываются в редакторе: экран помнит беседу и вывод. */
  async #sendApps(api: TelegramBotApi, chat: number, documents: AppDocument[], link: ThreadLink, thread: number | undefined): Promise<void> {
    if (!link.chatPath) return;
    let workspace = /^\/workspace\/([0-9a-f]{64})(?:\?|$)/.exec(link.chatPath)?.[1] ?? null;
    let rows: InlineButton[][] = [];
    for (let { name, gadget } of documents) {
      let title = name.replace(/\s+/g, " ").trim().slice(0, 200);
      let document = workspace && gadget !== null ? { workspace, gadget } : undefined;
      let app = title ? await this.#screenUrl({ title, path: link.chatPath, ...(document ? { document } : {}) }, link.thread) : null;
      if (app) rows.push([{ text: `Открыть «${title.slice(0, 40)}»`, webApp: app }]);
    }
    if (!rows.length) return;
    await api.send(chat, "Документы беседы можно открыть здесь, в Telegram:", { ...(thread !== undefined ? { thread } : {}), buttons: rows });
  }

  async #rememberReply(stateKey: string): Promise<void> {
    let replies = [...((await this.deps.storage.get<(number | string)[]>(REPLIES)) ?? []).map(String).filter(key => key !== stateKey), stateKey];
    for (let old of replies.splice(0, Math.max(0, replies.length - KEPT_REPLIES))) {
      (await this.deps.storage.delete(old.startsWith(REPLY_PREFIX) ? old : REPLY_PREFIX + old));
    }
    (await this.deps.storage.put(REPLIES, replies));
  }

  // ---- карточки решений (этап 4) ----

  #key(record: BotRecord, thread: number): string {
    return `${record.bot.id}:${record.telegramOwner!.id}:${thread}`;
  }

  /** Карточка действия в треде. Одно действие — одна карточка: повтор доставки второй не шлёт. */
  async #sendCard(api: TelegramBotApi, record: BotRecord, link: ThreadLink, decision: ExternalDecision, thread: number | undefined, lead: Lead): Promise<void> {
    let indexKey = CARD_FOR_PREFIX + link.key + ":" + decision.action;
    let n = (await this.deps.storage.get<number>(indexKey));
    let card = n !== undefined ? (await this.deps.storage.get<CardRecord>(CARD_PREFIX + n)) : undefined;
    if (card && (card.message !== null || card.state !== "pending")) return;
    let html = cardHtml(decision);
    if (html === null) return;
    if (!card) {
      n = ((await this.deps.storage.get<number>(CARD_SEQ)) ?? 0) + 1;
      (await this.deps.storage.put(CARD_SEQ, n));
      card = {
        n, thread: link.thread, key: link.key, workspace: link.workspace ?? null, action: decision.action,
        message: null, html, state: "pending", createdAt: this.deps.now(),
      };
      (await this.deps.storage.put(CARD_PREFIX + n, card));
      (await this.deps.storage.put(indexKey, n));
      (await this.#rememberCard(n));
    }
    let buttons: InlineButton[][] = [[
      { text: "Подтвердить", data: `d:${card.thread}:${card.n}:a` },
      { text: "Отклонить", data: `d:${card.thread}:${card.n}:r` },
    ]];
    let message = await api.send(record.telegramOwner!.id, (lead?.html ?? "") + card.html, { ...(thread !== undefined ? { thread } : {}), html: true, buttons });
    let current = (await this.deps.storage.get<CardRecord>(CARD_PREFIX + card.n)) ?? card;
    current.message = message;
    (await this.deps.storage.put(CARD_PREFIX + card.n, current));
  }

  async #rememberCard(n: number): Promise<void> {
    let cards = [...((await this.deps.storage.get<number[]>(CARDS)) ?? []), n];
    for (let old of cards.splice(0, Math.max(0, cards.length - KEPT_CARDS))) {
      let record = (await this.deps.storage.get<CardRecord>(CARD_PREFIX + old));
      if (record && (await this.deps.storage.get<number>(CARD_FOR_PREFIX + record.key + ":" + record.action)) === old) {
        (await this.deps.storage.delete(CARD_FOR_PREFIX + record.key + ":" + record.action));
      }
      (await this.deps.storage.delete(CARD_PREFIX + old));
    }
    (await this.deps.storage.put(CARDS, cards));
  }

  /** Проверка нажатия без ожиданий. Из callback_data берутся только тред и номер карточки, и оба
   *  сверяются с записью: карточка этого бота и владельца, то же сообщение, ещё не решена. */
  async #claimCard(record: BotRecord, input: Extract<TelegramInput, { kind: "callback" }>):
      Promise<{ card: CardRecord; decision: "approve" | "reject" } | { answer: string }> {
    let match = CARD_DATA.exec(input.data ?? "");
    if (!match) return { answer: CARD_UNKNOWN };
    let thread = Number(match[1]);
    let card = (await this.deps.storage.get<CardRecord>(CARD_PREFIX + Number(match[2])));
    if (!card || card.thread !== thread || card.message === null || input.message !== card.message ||
        !card.key.startsWith(`${record.bot.id}:${record.telegramOwner!.id}:`)) {
      return { answer: CARD_UNKNOWN };
    }
    let stuck = card.state === "deciding" && this.deps.now() - (card.decidingAt ?? 0) >= CARD_DECIDING_MS;
    if (card.state === "deciding" && !stuck) return { answer: CARD_BUSY };
    if (card.state !== "pending" && !stuck) return { answer: CARD_STALE };
    card.state = "deciding";
    card.decidingAt = this.deps.now();
    (await this.deps.storage.put(CARD_PREFIX + card.n, card));
    return { card, decision: match[3] === "a" ? "approve" : "reject" };
  }

  /** Решение по карточке: беседа проверяет и применяет его, затем кнопки снимаются. */
  async #settleCard(record: BotRecord, input: Extract<TelegramInput, { kind: "callback" }>,
      claim: { card: CardRecord; decision: "approve" | "reject" } | { answer: string }): Promise<void> {
    let api = await this.#api(record);
    if ("answer" in claim) { await api.answerCallback(input.id, claim.answer); return; }
    let { card, decision } = claim;
    let result: DecideExternalActionResult | null;
    try {
      result = await this.deps.gateway.decide({
        callerEmail: record.owner, gadgetKey: card.key, chatKey: card.key, action: card.action, decision,
        ...(card.workspace ? { workspaceId: card.workspace } : {}),
      });
    } catch { result = null; }
    let current = (await this.deps.storage.get<CardRecord>(CARD_PREFIX + card.n)) ?? card;
    if (!result) {
      current.state = "pending";
      (await this.deps.storage.put(CARD_PREFIX + card.n, current));
      await api.answerCallback(input.id, CARD_FAILED);
      return;
    }
    let answer: string, line: string;
    if (result.status === "approved") { current.state = "approved"; answer = CARD_APPROVED; line = "Подтверждено"; }
    else if (result.status === "rejected") { current.state = "rejected"; answer = CARD_REJECTED; line = "Отклонено"; }
    else if (result.status === "stale") {
      current.state = "stale"; answer = CARD_STALE;
      line = result.state === "approved" ? "Уже подтверждено" : result.state === "rejected" ? "Уже отклонено" : "Действие больше не ждёт решения";
    } else if (result.status === "access_changed") {
      current.state = "stale"; answer = CARD_ACCESS_CHANGED; line = CARD_ACCESS_CHANGED;
    } else { current.state = "stale"; answer = CARD_DENIED; line = "Решение — в беседе на сайте"; }
    (await this.deps.storage.put(CARD_PREFIX + card.n, current));
    await api.answerCallback(input.id, answer).catch(() => {});
    await this.#closeCard(api, record, current, line);
  }

  /** Снять кнопки и дописать итог к тексту карточки. */
  async #closeCard(api: TelegramBotApi, record: BotRecord, card: CardRecord, line: string): Promise<void> {
    if (card.message === null) return;
    let chat = record.telegramOwner!.id;
    try { await api.editText(chat, card.message, `${card.html}\n\n<b>${escapeHtml(line)}</b>`, { html: true }); }
    catch (error) {
      if (isNotModified(error)) return;
      await api.removeButtons(chat, card.message).catch(() => {});
    }
  }

  // ---- уведомления (этап 5) ----

  /** Будильник нужен подключённому боту; зовётся при пробуждении объекта. */
  async wantsNotifications(): Promise<boolean> {
    let record = (await this.#record());
    return !!record?.telegramOwner && record.connectedAt !== null;
  }

  /** Один проход доставки уведомлений. Возвращает, когда будить снова; null — бот не подключён. */
  async #runPollNotifications(): Promise<number | null> {
    let record = (await this.#record());
    if (!record?.telegramOwner || record.connectedAt === null) return null;
    let owner = record.owner;
    let chat = record.telegramOwner.id;
    let secret = record.secretSha256;
    let failed = false;
    try {
      await deliverNotifications({
        storage: this.deps.storage, now: () => this.deps.now(), owner, chat, publicBase: this.deps.publicBase,
        api: await this.#api(record), mnemos: this.deps.mnemos,
        screenUrl: async target => this.#screenUrl(target, (await loadNotifyState(this.deps.storage)).thread),
        threadCreated: async thread => {
          // Тред уведомлений назван ботом и не переименовывается по названию беседы.
          let current = (await this.#record());
          if (!current || current.secretSha256 !== secret) return;
          let link = this.#newLink(current, thread, "user", NOTIFY_THREAD_TITLE);
          (await this.#putLink(link));
        },
      });
    } catch (error) {
      if (error instanceof MnemosNotConnectedError) return this.deps.now() + NOTIFY_MAX_BACKOFF_MS;
      failed = true;
    }
    let state = (await loadNotifyState(this.deps.storage));
    state.failures = failed ? state.failures + 1 : 0;
    (await this.deps.storage.put("notify", state));
    return this.deps.now() + nextDelay(state);
  }

  /** Решение по кнопке уведомления — от имени владельца бота, через его Mnemos. */
  async #settleNotice(record: BotRecord, input: Extract<TelegramInput, { kind: "callback" }>,
      claim: Awaited<ReturnType<typeof claimNoticeCard>>): Promise<void> {
    let api = await this.#api(record);
    if ("answer" in claim) { await api.answerCallback(input.id, claim.answer); return; }
    let result = await this.deps.mnemos.decide(record.owner, claim.card.object, claim.card.version, claim.decision).catch(() => null);
    let { answer, line } = (await settleNoticeCard(this.deps.storage, claim.card, result));
    await api.answerCallback(input.id, answer).catch(() => {});
    if (line === null || claim.card.message === null) return;
    let chat = record.telegramOwner!.id;
    try { await api.editText(chat, claim.card.message, noticeCardHtml(claim.card, line), { html: true }); }
    catch (error) {
      if (isNotModified(error)) return;
      await api.removeButtons(chat, claim.card.message).catch(() => {});
    }
  }

  // ---- Mini App (этап 6) ----

  /** Адрес Mini App с новым одноразовым токеном экрана; null — у установки нет адреса https. */
  async #screenUrl(target: ScreenTarget, thread: number | null): Promise<string | null> {
    let base = this.deps.publicBase;
    if (!base || !/^[0-9a-f]{64}$/.test(this.deps.routeId)) return null;
    let origin: string;
    try { let url = new URL(base); if (url.protocol !== "https:") return null; origin = url.origin; } catch { return null; }
    let secret = randomSecret();
    // Хранится только хэш: токен из адреса кнопки не восстановить по хранилищу.
    let key = SCREEN_PREFIX + await sha256(secret);
    (await this.deps.storage.put(key, { target, thread, expiresAt: this.deps.now() + SCREEN_TTL_MS, used: false } satisfies ScreenRecord));
    let screens = [...((await this.deps.storage.get<string[]>(SCREENS)) ?? []), key];
    for (let old of screens.splice(0, Math.max(0, screens.length - KEPT_SCREENS))) (await this.deps.storage.delete(old));
    (await this.deps.storage.put(SCREENS, screens));
    return `${origin}${MINI_APP_PATH}?t=${this.deps.routeId}.${secret}`;
  }

  /** Открыть экран Mini App. Сначала подпись Telegram и владелец бота, потом токен: без верных
   *  initData владельца токен не проверяется вовсе. Токен расходуется до любых ожиданий. */
  async #runOpenMiniApp(secret: unknown, initData: unknown): Promise<MiniAppOpenResult> {
    let record = (await this.#record());
    if (!record?.telegramOwner || record.connectedAt === null || typeof secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
      return { status: "denied" };
    }
    let identity = await verifyWebAppData(initData, record.bot.id, this.deps.now(), this.deps.webAppPublicKey);
    let key = SCREEN_PREFIX + await sha256(secret);
    // Секрет сессии и аккаунт Mnemos готовятся заранее: проверка и расход токена идут без ожиданий.
    let session = randomSecret();
    let sessionKey = APP_SESSION_PREFIX + await sha256(session);
    let principal = identity && this.deps.mnemosPrincipal ? await this.deps.mnemosPrincipal(record.owner).catch(() => null) : null;
    let current = (await this.#record());
    if (!identity || !current?.telegramOwner || current.connectedAt === null || current.secretSha256 !== record.secretSha256 || identity.userId !== current.telegramOwner.id) {
      return { status: "denied" };
    }
    let screen = (await this.deps.storage.get<ScreenRecord>(key));
    if (!screen) return { status: "denied" };
    let site = this.#siteUrlFor(screen.target.path);
    if (screen.used || screen.expiresAt <= this.deps.now()) return { status: "expired", siteUrl: site };
    screen.used = true;
    (await this.deps.storage.put(key, screen));
    let document = screen.target.document;
    if (!document) return { status: "ok", title: screen.target.title, siteUrl: site };
    let now = this.deps.now();
    (await this.deps.storage.put(sessionKey, {
      owner: current.owner, botSecret: current.secretSha256, telegramUser: current.telegramOwner.id, document, principal,
      createdAt: now, expiresAt: now + APP_SESSION_IDLE_MS,
    } satisfies AppSessionRecord));
    let sessions = [...((await this.deps.storage.get<string[]>(APP_SESSIONS)) ?? []), sessionKey];
    for (let old of sessions.splice(0, Math.max(0, sessions.length - KEPT_APP_SESSIONS))) (await this.deps.storage.delete(old));
    (await this.deps.storage.put(APP_SESSIONS, sessions));
    return { status: "ok", title: screen.target.title, siteUrl: site, session: `${this.deps.routeId}.${session}` };
  }

  /** Действующая сессия Mini App и что она разрешает; null — истекла, отозвана или чужая. Каждый
   *  успешный вызов продлевает её (не дольше APP_SESSION_MAX_MS от выдачи). */
  async #runMiniAppSession(secret: unknown): Promise<MiniAppSessionGrant | null> {
    if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
    let key = APP_SESSION_PREFIX + await sha256(secret);
    let session = (await this.deps.storage.get<AppSessionRecord>(key));
    if (!session) return null;
    let record = (await this.#record());
    let now = this.deps.now();
    if (!record?.telegramOwner || record.connectedAt === null || record.secretSha256 !== session.botSecret ||
        record.owner !== session.owner || record.telegramOwner.id !== session.telegramUser ||
        session.expiresAt <= now || now - session.createdAt >= APP_SESSION_MAX_MS) {
      (await this.deps.storage.delete(key));
      return null;
    }
    let next = Math.min(now + APP_SESSION_IDLE_MS, session.createdAt + APP_SESSION_MAX_MS);
    if (next - session.expiresAt >= APP_SESSION_TOUCH_MS) {
      session.expiresAt = next;
      (await this.deps.storage.put(key, session));
    }
    return { owner: session.owner, document: session.document, principal: session.principal, endsAt: session.createdAt + APP_SESSION_MAX_MS };
  }

  /** Удалить сессию Mini App: зовёт сервер Mini App, когда страница закрыта (close() или обрыв
   *  связи), сессия отказала по сроку или сменился аккаунт Mnemos. */
  async #runEndMiniAppSession(secret: unknown): Promise<void> {
    if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return;
    (await this.deps.storage.delete(APP_SESSION_PREFIX + await sha256(secret)));
  }

  #siteUrlFor(path: string): string | null {
    if (!path.startsWith("/workspace/") && !path.startsWith("/gatekeepers/")) return null;
    try {
      let base = new URL(this.deps.publicBase ?? "");
      return base.protocol === "https:" ? base.origin + path : null;
    } catch { return null; }
  }

  // ---- беседа сайта ↔ тред (этап 3) ----

  async #linkByKey(record: BotRecord, key: string): Promise<ThreadLink | null> {
    let prefix = `${record.bot.id}:${record.telegramOwner!.id}:`;
    if (typeof key !== "string" || !key.startsWith(prefix)) return null;
    let thread = Number(key.slice(prefix.length));
    if (!Number.isSafeInteger(thread) || thread <= 0) return null;
    let link = (await this.#link(thread));
    return link && link.key === key ? link : null;
  }

  async #connected(owner: string): Promise<BotRecord | null> {
    let record = (await this.#mine(owner));
    return record?.telegramOwner && record.connectedAt !== null ? record : null;
  }

  #linkState(record: BotRecord, link: ThreadLink | null): TelegramChatLink {
    let bot = record.bot.username;
    return link && !link.unlinked && !link.deletedOnSite ? { status: "linked", bot, url: `https://t.me/${bot}` } : { status: "available", bot };
  }

  /** Можно ли перенести беседу владельца в Telegram и идёт ли она уже в треде (key — её тред). */
  async #runSiteLink(owner: string, key: string | null): Promise<TelegramChatLink> {
    let record = (await this.#connected(owner));
    if (!record) return { status: "unavailable" };
    return this.#linkState(record, key ? (await this.#linkByKey(record, key)) : null);
  }

  /** «Продолжить в Telegram»: живой тред остаётся, иначе бот создаёт новый с названием беседы и
   *  первым сообщением — кратким содержанием. Возвращает ключ треда для беседы. */
  async #runLinkSiteChat(owner: string, input: SiteChatInput): Promise<{ state: TelegramChatLink; key: string | null }> {
    let record = (await this.#connected(owner));
    if (!record) return { state: { status: "unavailable" }, key: null };
    let previous = input.previousKey ? (await this.#linkByKey(record, input.previousKey)) : null;
    if (previous && !previous.unlinked && !previous.deletedOnSite) return { state: this.#linkState(record, previous), key: previous.key };

    let title = (typeof input.title === "string" ? input.title.replace(/[\r\n]+/g, " ").trim() : "").slice(0, 128) || SITE_THREAD_TITLE;
    let api = await this.#api(record);
    let chat = record.telegramOwner!.id;
    let thread = await api.createTopic(chat, title);
    let current = (await this.#connected(owner));
    if (!current || current.bot.id !== record.bot.id) return { state: { status: "unavailable" }, key: null };
    let link = this.#newLink(current, thread, "bot", title);
    link.renamed = !isDefaultWorkspaceTitle(title);
    link.workspace = /^[0-9a-f]{64}$/.test(input.workspace) ? input.workspace : null;
    link.chatPath = typeof input.chatPath === "string" && input.chatPath.startsWith("/workspace/") ? input.chatPath : null;
    (await this.#putLink(link));
    let summary = typeof input.summary === "string" ? input.summary.slice(0, 12000) : "";
    for (let chunk of telegramChunks(summary)) {
      // Тред уже создан: без краткого содержания он всё равно рабочий.
      try { await this.#sendChunk(api, chat, chunk, thread, null); } catch { break; }
    }
    return { state: this.#linkState(current, link), key: link.key };
  }

  /** Удалить тред беседы, удалённой на сайте; сбой Telegram оставляет отметку для повтора. */
  async #deleteThread(api: TelegramBotApi, chat: number, thread: number): Promise<boolean> {
    try { await api.deleteTopic(chat, thread); }
    catch (error) { if (!isThreadNotFound(error)) return false; }
    if ((await this.#link(thread))?.deletedOnSite) (await this.deps.storage.delete(THREAD_PREFIX + thread));
    return true;
  }

  /** Повтор удаления тредов бесед, удалённых на сайте. Зовёт будильник бота. */
  async #runRetrySiteDeletions(): Promise<void> {
    let record = (await this.#record());
    if (!record?.telegramOwner || record.connectedAt === null) return;
    let pending = [...(await this.deps.storage.list<ThreadLink>({ prefix: THREAD_PREFIX }))].filter(([, link]) => link.deletedOnSite);
    if (!pending.length) return;
    let api = await this.#api(record);
    for (let [, link] of pending) await this.#deleteThread(api, record.telegramOwner.id, link.thread);
  }

  /** Событие беседы сайта для её треда. Чужой или устаревший ключ ничего не делает. */
  async #runSiteEvent(owner: string, key: string, event: SiteEvent): Promise<void> {
    let record = (await this.#connected(owner));
    if (!record) return;
    let link = (await this.#linkByKey(record, key));
    if (!link) return;
    let api = await this.#api(record);
    let chat = record.telegramOwner!.id;
    let gone = async (error: unknown) => {
      if (!isThreadNotFound(error)) throw error;
      let current = (await this.#link(link.thread));
      if (current) { current.unlinked = true; (await this.#putLink(current)); }
    };
    switch (event.type) {
      case "human": {
        if (link.unlinked || link.deletedOnSite || typeof event.text !== "string" || !event.text.trim()) return;
        let stateKey = REPLY_PREFIX + "human:" + event.id;
        let state = (await this.deps.storage.get<ReplyState>(stateKey)) ?? { sent: 0, unthreaded: false };
        let chunks = telegramChunks(event.text.slice(0, 16000));
        for (let index = state.sent; index < chunks.length; index++) {
          try { await this.#sendChunk(api, chat, chunks[index], link.thread, index === 0 ? siteLead(event.author) : null); }
          catch (error) { (await this.deps.storage.put(stateKey, state)); (await gone(error)); return; }
          state.sent = index + 1;
          (await this.deps.storage.put(stateKey, state));
        }
        (await this.#rememberReply(stateKey));
        return;
      }
      case "rename": {
        let title = typeof event.title === "string" ? event.title.replace(/[\r\n]+/g, " ").trim().slice(0, 128) : "";
        // Название, которое тред получил от человека (или неизвестно как), не трогаем.
        if (link.unlinked || link.deletedOnSite || !title || title === link.title || (link.naming !== "client" && link.naming !== "bot")) return;
        try { await api.renameTopic(chat, link.thread, title); } catch (error) { (await gone(error)); return; }
        let current = (await this.#link(link.thread)) ?? link;
        current.title = title;
        current.renamed = true;
        (await this.#putLink(current));
        return;
      }
      case "archived": {
        if (link.unlinked || link.deletedOnSite) return;
        try { await api.send(chat, ARCHIVED_NOTICE, { thread: link.thread }); } catch (error) { (await gone(error)); }
        return;
      }
      case "deleted": {
        if (link.unlinked) { (await this.deps.storage.delete(THREAD_PREFIX + link.thread)); return; }
        // Сначала отметка: с этого момента тред не ведёт в беседу, даже если Telegram не ответит.
        // Удаление треда повторяет будильник бота (retrySiteDeletions); сайту удаление подтверждено.
        link.deletedOnSite = true;
        (await this.#putLink(link));
        await this.#deleteThread(api, chat, link.thread);
        return;
      }
      case "decided": {
        let n = (await this.deps.storage.get<number>(CARD_FOR_PREFIX + link.key + ":" + event.action));
        let card = n !== undefined ? (await this.deps.storage.get<CardRecord>(CARD_PREFIX + n)) : undefined;
        // Карточка, решённая в Telegram, закрыта своим нажатием; зависшую «решается» закрывает сайт.
        if (!card || (card.state !== "pending" && card.state !== "deciding")) return;
        card.state = event.state === "approved" ? "approved" : "rejected";
        (await this.deps.storage.put(CARD_PREFIX + card.n, card));
        await this.#closeCard(api, record, card, event.state === "approved" ? "Подтверждено на сайте" : "Отклонено на сайте");
        return;
      }
    }
  }
}

/** Номер объекта бота из адреса вебхука; null — адрес не наш. */
export function telegramWebhookRoute(pathname: string): string | null {
  if (!pathname.startsWith(TELEGRAM_WEBHOOK_PREFIX)) return null;
  let id = pathname.slice(TELEGRAM_WEBHOOK_PREFIX.length);
  return /^[0-9a-f]{64}$/.test(id) ? id : null;
}

export { SecretsKeyMissingError };
