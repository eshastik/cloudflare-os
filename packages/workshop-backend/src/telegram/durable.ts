import { DurableObject } from "cloudflare:workers";
import type { TelegramBotState, TelegramDisconnectResult } from "@gadgets/workshop-shared/telegram-bot";
import { PersonalTelegramBot, telegramWebhookRoute, TelegramSetupError } from "./personal-bot";

/** Код ожидаемого отказа настройки: клиент показывает текст ошибки человеку как есть. */
export const TELEGRAM_SETUP_REJECTED = "TELEGRAM_SETUP_REJECTED";

/** Объект личного бота одного пользователя оболочки; имя — «user:<имя пользователя>». Методы RPC
 *  зовёт только AuthenticatedApi от имени вошедшего человека; по HTTP открыт один вебхук. */
export class TelegramPersonalBot extends DurableObject<Cloudflare.Env> {
  #tail: Promise<unknown> = Promise.resolve();

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    let result = this.#tail.then(operation);
    this.#tail = result.catch(() => {});
    return result;
  }

  #core(): PersonalTelegramBot {
    let exports = this.ctx.exports;
    return new PersonalTelegramBot({
      storage: this.ctx.storage.kv,
      secretsKey: this.env.SHELL_SECRETS_KEY,
      publicBase: this.env.PUBLIC_BASE_URL,
      routeId: this.ctx.id.toString(),
      fetch: (input, init) => fetch(input, init),
      claim: (botId, owner) => exports.TelegramBotClaim.getByName(botId).claim(owner),
      release: (botId, owner) => exports.TelegramBotClaim.getByName(botId).release(owner),
      mnemosOf: async owner => {
        let snapshot = await exports.AdminSettings.getByName("").directorySnapshot();
        return snapshot.entries.find(entry => entry.id === owner)?.mnemos ?? null;
      },
      now: () => Date.now(),
      waitUntil: promise => this.ctx.waitUntil(promise),
    });
  }

  // Ошибки настройки уходят человеку словами; остальные — общим отказом без подробностей.
  async #human<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      let message = error instanceof TelegramSetupError ? error.message : "Не получилось изменить подключение Telegram. Обновите страницу и повторите.";
      throw Object.assign(new Error(message), { code: TELEGRAM_SETUP_REJECTED });
    }
  }

  async getState(owner: string): Promise<TelegramBotState> {
    return this.#human(() => this.#core().state(owner));
  }

  async connectBot(owner: string, token: string): Promise<TelegramBotState> {
    return this.#serialize(() => this.#human(() => this.#core().connect(owner, token)));
  }

  async renewCode(owner: string): Promise<TelegramBotState> {
    return this.#serialize(() => this.#human(async () => this.#core().renewCode(owner)));
  }

  async disconnectBot(owner: string): Promise<TelegramDisconnectResult> {
    return this.#serialize(() => this.#human(() => this.#core().disconnect(owner)));
  }

  async fetch(request: Request): Promise<Response> {
    return this.#core().webhook(request);
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
