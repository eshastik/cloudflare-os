import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import type { TelegramBotState, TelegramChatLink, TelegramDisconnectResult } from "@gadgets/workshop-shared/telegram-bot";
import type { ChatGatewayRpcTarget, GadgetProgress, GadgetResponse } from "@gadgets/workshop-shared/external-message-gateway";
import type { RpcStub } from "cloudflare:workers";
import { chatVoiceAvailable, transcribeChatVoice, type ChatVoiceConfig } from "../chat-voice";
import { spendingEntry, type ModelSpend } from "../spend-ledger.js";
import { createWorkshopLogger } from "../observability";
import { PersonalTelegramBot, telegramWebhookRoute, TelegramSetupError, VoiceUnavailableError, NOTIFY_FIRST_MS, type MiniAppOpenResult, type MiniAppSessionGrant, type PersonalBotDeps, type SiteChatInput, type SiteEvent, type TelegramTurnRef } from "./personal-bot";
import { DraftLimiter } from "./progress";

const logger = createWorkshopLogger("workshop.telegram");

/** Код ожидаемого отказа настройки: клиент показывает текст ошибки человеку как есть. */
export const TELEGRAM_SETUP_REJECTED = "TELEGRAM_SETUP_REJECTED";

/** Источник внешнего входа для личных ботов: префикс имён бесед Telegram. */
export const TELEGRAM_SOURCE = "telegram";

type Env = Cloudflare.Env & ChatVoiceConfig;

/** Зависимости ядра бота из объекта Durable Object; overrides — только для тестов. */
export function personalBotDeps(ctx: DurableObjectState, env: Env, drafts: DraftLimiter, voice: { busy: boolean }, overrides: Partial<PersonalBotDeps> = {}): PersonalBotDeps {
  let exports = ctx.exports;
  let routeId = ctx.id.toString();
  return {
    storage: ctx.storage.kv,
    secretsKey: env.SHELL_SECRETS_KEY,
    publicBase: env.PUBLIC_BASE_URL,
    routeId,
    fetch: (input, init) => fetch(input, init),
    claim: (botId, owner) => exports.TelegramBotClaim.getByName(botId).claim(owner),
    release: (botId, owner) => exports.TelegramBotClaim.getByName(botId).release(owner),
    mnemosOf: async owner => {
      let snapshot = await exports.AdminSettings.getByName("").directorySnapshot();
      return snapshot.entries.find(entry => entry.id === owner)?.mnemos ?? null;
    },
    now: () => Date.now(),
    waitUntil: promise => ctx.waitUntil(promise),
    gateway: {
      submit: async (input, ref) => {
        let gateway = exports.ExternalMessageGateway({ props: { source: TELEGRAM_SOURCE } });
        // Получатель ответа — точка входа с адресом хода в props: внешний вход хранит её и зовёт
        // «хотя бы один раз», даже после перезапуска объекта беседы.
        let target = exports.TelegramChatTarget({ props: ref }) as unknown as RpcStub<ChatGatewayRpcTarget>;
        return gateway.submitExternalMessage({ ...input, chatGatewayRpcTarget: target });
      },
      rename: input => exports.ExternalMessageGateway({ props: { source: TELEGRAM_SOURCE } }).renameExternalChat(input),
      decide: input => exports.ExternalMessageGateway({ props: { source: TELEGRAM_SOURCE } }).decideExternalAction(input),
    },
    transcribe: async (owner, bytes, mimeType) => {
      if (!chatVoiceAvailable(env)) throw new VoiceUnavailableError();
      let spend: ModelSpend | undefined;
      try { return await transcribeChatVoice(env, bytes, mimeType, fetch, s => { spend = s; }); }
      finally { if (spend) await recordVoiceSpend(exports.UserDurableObject.getByName(owner), spend); }
    },
    drafts,
    voice,
    // Уведомления — через подключение Mnemos владельца в его объекте пользователя, сессией человека.
    mnemos: {
      read: (owner, after, limit) => exports.UserDurableObject.getByName(owner).readMnemosNotifications(after, limit),
      ack: (owner, sequence, principal) => exports.UserDurableObject.getByName(owner).acknowledgeMnemosNotifications(sequence, principal),
      prepare: (owner, object) => exports.UserDurableObject.getByName(owner).prepareMnemosNotificationDecision(object),
      decide: (owner, object, version, decision) => exports.UserDurableObject.getByName(owner).decideMnemosNotification(object, version, decision),
    },
    mnemosPrincipal: owner => exports.UserDurableObject.getByName(owner).mnemosPrincipal(),
    setAlarm: at => {
      ctx.waitUntil((at === null ? ctx.storage.deleteAlarm() : ctx.storage.setAlarm(at)).catch(() => {}));
    },
    ...overrides,
  };
}

/** Распознавание голоса — в учёт владельца, как диктовка на сайте (server.ts). */
async function recordVoiceSpend(user: { recordOwnSpending(entries: ReturnType<typeof spendingEntry>[], accountId: number | null): Promise<"sent" | "unavailable"> }, spend: ModelSpend): Promise<void> {
  let entry = spendingEntry(`voice:${crypto.randomUUID()}`, "service", "voice.transcribe", spend);
  for (let attempt = 0; attempt < 2; attempt++) {
    try { if (await user.recordOwnSpending([entry], null) === "sent") return; } catch { /* повтор ниже */ }
  }
  logger.error("voice spend not recorded", { event: "spend.record.lost", spendEntry: JSON.stringify(entry) });
}

/** Объект личного бота одного пользователя оболочки; имя — «user:<имя пользователя>». Методы RPC
 *  зовут только AuthenticatedApi от имени вошедшего человека, точка входа ответа хода
 *  (TelegramChatTarget) и беседа владельца (siteLink, linkSiteChat, siteEvent — объект выбирается
 *  по имени владельца беседы); по HTTP открыт один вебхук. */
export class TelegramPersonalBot extends DurableObject<Env> {
  #bot: PersonalTelegramBot | undefined;
  #drafts = new DraftLimiter();
  #voice = { busy: false };

  #core(): PersonalTelegramBot {
    return this.#bot ??= new PersonalTelegramBot(personalBotDeps(this.ctx, this.env, this.#drafts, this.#voice));
  }

  // Ошибки настройки уходят человеку словами; остальные — общим отказом без подробностей.
  async #human<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      let message = error instanceof TelegramSetupError ? error.message : "Не получилось изменить подключение Telegram. Обновите страницу и повторите.";
      throw Object.assign(new Error(message), { code: TELEGRAM_SETUP_REJECTED });
    }
  }

  /** Будильник уведомлений у подключённого бота, если его нет (после выпуска или сбоя). */
  async #ensureAlarm(): Promise<void> {
    try {
      if (!await this.#core().wantsNotifications()) return;
      if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + NOTIFY_FIRST_MS);
    } catch { /* следующий вызов попробует снова */ }
  }

  /** Доставка уведомлений Mnemos: по очереди с остальными отправками бота. */
  async alarm(): Promise<void> {
    let next = await (async () => {
      // Треды бесед, удалённых на сайте, которые Telegram не удалил с первого раза.
      try { await this.#core().retrySiteDeletions(); }
      catch (error) { logger.warn("telegram thread deletion not retried", { event: "telegram.site.delete.failed", error }); }
      try { return await this.#core().pollNotifications(); }
      catch (error) {
        logger.warn("telegram notifications not delivered", { event: "telegram.notify.failed", error });
        return Date.now() + 60_000;
      }
    })();
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  /** Экран Mini App: проверка initData и расход одноразового токена. */
  async openMiniApp(secret: string, initData: string): Promise<MiniAppOpenResult> {
    try { return await this.#core().openMiniApp(secret, initData); }
    catch { return { status: "denied" }; }
  }

  /** Сессия редактора Mini App: что она разрешает сейчас; null — отказ. Зовёт только сервер Mini App. */
  async miniAppSession(secret: string): Promise<MiniAppSessionGrant | null> {
    try { return await this.#core().miniAppSession(secret); }
    catch { return null; }
  }

  async endMiniAppSession(secret: string): Promise<void> {
    await this.#core().endMiniAppSession(secret);
  }

  async getState(owner: string): Promise<TelegramBotState> {
    this.ctx.waitUntil(this.#ensureAlarm());
    return this.#human(() => this.#core().state(owner));
  }

  async connectBot(owner: string, token: string): Promise<TelegramBotState> {
    return this.#human(() => this.#core().connect(owner, token));
  }

  async renewCode(owner: string): Promise<TelegramBotState> {
    return this.#human(async () => this.#core().renewCode(owner));
  }

  async disconnectBot(owner: string): Promise<TelegramDisconnectResult> {
    return this.#human(() => this.#core().disconnect(owner));
  }

  /** Итог хода агента для треда. Ответы одного бота уходят по очереди: порядок кусков и учёт
   *  отправленного не перемешиваются. */
  async deliverResponse(ref: TelegramTurnRef, response: GadgetResponse): Promise<void> {
    return (async () => {
      try { await this.#core().deliver(ref, response); }
      catch (error) {
        logger.warn("telegram reply not delivered", { event: "telegram.reply.failed", error });
        // Внешний вход повторит доставку позже; подробности наружу не нужны.
        throw new Error("Telegram reply is not delivered yet.");
      }
    })();
  }

  /** Можно ли продолжить беседу в Telegram и идёт ли она уже в треде. */
  async siteLink(owner: string, key: string | null): Promise<TelegramChatLink> {
    this.ctx.waitUntil(this.#ensureAlarm());
    try { return await this.#core().siteLink(owner, key); }
    catch { return { status: "unavailable" }; }
  }

  /** «Продолжить в Telegram» для беседы сайта. */
  async linkSiteChat(owner: string, input: SiteChatInput): Promise<{ state: TelegramChatLink; key: string | null }> {
    return (async () => {
      try { return await this.#core().linkSiteChat(owner, input); }
      catch (error) {
        logger.warn("telegram thread for site chat not created", { event: "telegram.site.link.failed", error });
        throw new Error("Не получилось создать тред в Telegram. Повторите через минуту.");
      }
    })();
  }

  /** Событие беседы сайта (сообщение человека, название, архив, удаление, решение). По очереди с
   *  ответами: сообщение человека уходит раньше ответа агента на него. */
  async siteEvent(owner: string, key: string, event: SiteEvent): Promise<void> {
    return (async () => {
      try { await this.#core().siteEvent(owner, key, event); }
      catch (error) {
        logger.warn("telegram site event not delivered", { event: "telegram.site.event.failed", operation: event.type, error });
        throw new Error("Telegram site event is not delivered.");
      }
    })();
  }

  async deliverProgress(ref: TelegramTurnRef, progress: GadgetProgress): Promise<void> {
    await this.#core().progress(ref, progress);
  }

  async fetch(request: Request): Promise<Response> {
    this.ctx.waitUntil(this.#ensureAlarm());
    return this.#core().webhook(request);
  }
}

/** Получатель ответа хода, начатого из треда Telegram. Адрес хода (объект бота, чат, тред,
 *  номер обновления) — в props: их задаёт только объект бота при отправке хода. */
@validateRpc()
export class TelegramChatTarget extends WorkerEntrypoint<Env, TelegramTurnRef> {
  #bot() {
    let namespace = this.ctx.exports.TelegramPersonalBot;
    return namespace.get(namespace.idFromString(this.ctx.props.route));
  }

  async onGadgetResponse(response: GadgetResponse): Promise<void> {
    await this.#bot().deliverResponse(this.ctx.props, response);
  }

  async onGadgetProgress(progress: GadgetProgress): Promise<void> {
    await this.#bot().deliverProgress(this.ctx.props, progress);
  }
}

/** Занятость бота по его номеру: один бот — у одного пользователя. */
export class TelegramBotClaim extends DurableObject<Cloudflare.Env> {
  async claim(owner: string): Promise<boolean> {
    let holder = this.ctx.storage.kv.get<string>("owner");
    if (holder && holder !== owner) return false;
    this.ctx.storage.kv.put("owner", owner);
    return true;
  }

  async release(owner: string): Promise<void> {
    if (this.ctx.storage.kv.get<string>("owner") === owner) this.ctx.storage.kv.delete("owner");
  }
}

/** Mini App: POST /api/telegram-app/open {token: "<номер объекта>.<секрет>", initData}. Ответ — JSON
 *  MiniAppOpenResult; любой сбой разбора — denied без подробностей. */
export const TELEGRAM_APP_OPEN_PATH = "/api/telegram-app/open";
const MAX_APP_OPEN_BODY = 8192;

export async function handleTelegramAppOpen(request: Request, namespace: DurableObjectNamespace<TelegramPersonalBot>): Promise<Response> {
  let json = (body: MiniAppOpenResult, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
  if (request.method !== "POST") return json({ status: "denied" }, 405);
  if (!(request.headers.get("Content-Type") ?? "").startsWith("application/json")) return json({ status: "denied" }, 415);
  let text: string;
  try {
    let bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_APP_OPEN_BODY) return json({ status: "denied" }, 413);
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch { return json({ status: "denied" }, 400); }
  let body: { token?: unknown; initData?: unknown };
  try { body = JSON.parse(text); } catch { return json({ status: "denied" }, 400); }
  let match = typeof body?.token === "string" ? /^([0-9a-f]{64})\.([A-Za-z0-9_-]{43})$/.exec(body.token) : null;
  if (!match || typeof body.initData !== "string") return json({ status: "denied" }, 400);
  let id: DurableObjectId;
  try { id = namespace.idFromString(match[1]); } catch { return json({ status: "denied" }); }
  return json(await namespace.get(id).openMiniApp(match[2], body.initData));
}

/** Вебхук личного бота: /api/telegram/<номер объекта>. Чужой или испорченный номер — 404. */
export async function handleTelegramWebhook(request: Request, namespace: DurableObjectNamespace<TelegramPersonalBot>): Promise<Response> {
  let route = telegramWebhookRoute(new URL(request.url).pathname);
  if (!route) return new Response(null, { status: 404 });
  let id: DurableObjectId;
  try { id = namespace.idFromString(route); } catch { return new Response(null, { status: 404 }); }
  return namespace.get(id).fetch(request);
}

export function telegramBotFor(namespace: DurableObjectNamespace<TelegramPersonalBot>, user: string): DurableObjectStub<TelegramPersonalBot> {
  if (!user) throw new Error("Пользователь не известен.");
  return namespace.getByName("user:" + user);
}
