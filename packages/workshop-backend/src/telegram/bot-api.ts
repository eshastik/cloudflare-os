// Клиент Bot API для личных ботов. Перенесён из gatekeeper-mnemos/src/telegram-api.ts (старый путь
// через поручения удаляется на этапе 7 ADR 0027): тот же ограниченный разбор ответа и та же
// обезличенная ошибка — текст ошибки fetch может содержать адрес с токеном.

export const TELEGRAM_TOKEN = /^[1-9][0-9]{0,19}:[A-Za-z0-9_-]{30,100}$/;

export type TelegramBotInfo = {
  id: string; username: string; title: string;
  /** Режим тредов из getMe (поля есть только в getMe); нет поля — считаем выключенным. */
  threads: { enabled: boolean; usersCanCreate: boolean };
};

type Method = "getMe" | "setWebhook" | "deleteWebhook" | "sendMessage" | "answerCallbackQuery";

export class TelegramBotApi {
  #token: string;
  #fetch: typeof fetch;

  constructor(token: string, fetcher: typeof fetch = fetch) {
    if (typeof token !== "string" || !TELEGRAM_TOKEN.test(token)) throw new Error("Invalid Telegram bot credential.");
    this.#token = token;
    this.#fetch = fetcher;
  }

  get botId(): string { return this.#token.split(":")[0]; }

  async #call(method: Method, body: object): Promise<unknown> {
    try {
      let fetcher = this.#fetch;
      let response = await fetcher("https://api.telegram.org/bot" + this.#token + "/" + method, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
        headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(); }
      let reader = response.body.getReader();
      let text = "", size = 0;
      let decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
      try {
        for (;;) {
          let { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 65536) throw new Error();
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } catch { await reader.cancel().catch(() => {}); throw new Error(); }
      finally { reader.releaseLock(); }
      let result = JSON.parse(text);
      if (!result || result.ok !== true || !Object.hasOwn(result, "result")) throw new Error();
      return result.result;
    } catch { throw new Error("Telegram request failed or its result is unconfirmed."); }
  }

  /** Проверка токена без изменения доставки: бот должен быть ботом и совпадать с номером в токене. */
  async identity(): Promise<TelegramBotInfo> {
    let result = await this.#call("getMe", {}) as {
      id?: unknown; username?: unknown; is_bot?: unknown; first_name?: unknown;
      has_topics_enabled?: unknown; allows_users_to_create_topics?: unknown;
    } | null;
    if (!result || !Number.isSafeInteger(result.id) || String(result.id) !== this.botId ||
        result.is_bot !== true || typeof result.username !== "string" || !/^[A-Za-z0-9_]{5,32}$/.test(result.username)) {
      throw new Error("Invalid Telegram bot identity.");
    }
    let title = typeof result.first_name === "string" && result.first_name.trim() ? result.first_name.trim().slice(0, 64) : result.username;
    let threads = { enabled: result.has_topics_enabled === true, usersCanCreate: result.allows_users_to_create_topics === true };
    return { id: String(result.id), username: result.username, title, threads };
  }

  /** Свой адрес и секрет у каждого бота. Прежний вебхук бота заменяется: токен дал его владелец. */
  async setWebhook(url: string, secret: string): Promise<void> {
    let endpoint: URL;
    try { endpoint = new URL(url); } catch { throw new Error("Invalid Telegram webhook."); }
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        !["", "443", "80", "88", "8443"].includes(endpoint.port) || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) {
      throw new Error("Invalid Telegram webhook.");
    }
    let result = await this.#call("setWebhook", {
      url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true,
    });
    if (result !== true) throw new Error("Telegram webhook setup is unconfirmed.");
  }

  /** Снять вебхук. Накопленные сообщения выбрасываются: бот больше никому не отвечает. */
  async deleteWebhook(): Promise<void> {
    let result = await this.#call("deleteWebhook", { drop_pending_updates: true });
    if (result !== true) throw new Error("Telegram webhook removal is unconfirmed.");
  }

  /** Простой текст в личный чат. Без повторов: потерянный ответ не значит, что сообщение не ушло. */
  async sendText(chat: number, text: string): Promise<number> {
    if (!Number.isSafeInteger(chat) || chat <= 0 || typeof text !== "string" || !text.trim() || [...text].length > 4096) {
      throw new Error("Invalid Telegram reply.");
    }
    let result = await this.#call("sendMessage", { chat_id: chat, text, link_preview_options: { is_disabled: true } }) as
      { message_id?: unknown; chat?: { id?: unknown; type?: unknown } } | null;
    if (!result || !Number.isSafeInteger(result.message_id) || result.chat?.id !== chat || result.chat.type !== "private") {
      throw new Error("Telegram reply is unconfirmed.");
    }
    return result.message_id as number;
  }

  /** Убрать «часики» с нажатой кнопки. */
  async answerCallback(id: string): Promise<void> {
    if (typeof id !== "string" || !id || id.length > 128) throw new Error("Invalid Telegram callback.");
    await this.#call("answerCallbackQuery", { callback_query_id: id });
  }
}
