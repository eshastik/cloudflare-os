// Клиент Bot API для личных ботов. Перенесён из gatekeeper-mnemos/src/telegram-api.ts (старый путь
// через поручения удаляется на этапе 7 ADR 0027): тот же ограниченный разбор ответа и та же
// обезличенная ошибка — текст ошибки fetch может содержать адрес с токеном. Из отказа Telegram
// берётся только его описание (description): по нему узнаются «тред удалён» и «разметка не
// разобрана», адреса с токеном в нём нет.

export const TELEGRAM_TOKEN = /^[1-9][0-9]{0,19}:[A-Za-z0-9_-]{30,100}$/;

export type TelegramBotInfo = {
  id: string; username: string; title: string;
  /** Режим тредов из getMe (поля есть только в getMe); нет поля — считаем выключенным. */
  threads: { enabled: boolean; usersCanCreate: boolean };
};

type Method = "getMe" | "setWebhook" | "deleteWebhook" | "sendMessage" | "sendMessageDraft" | "answerCallbackQuery" |
  "createForumTopic" | "editForumTopic" | "deleteForumTopic" | "getFile" | "editMessageText" | "editMessageReplyMarkup";

/** Кнопка под сообщением: надпись и данные нажатия (не длиннее 64 байт, их пришлёт Telegram). */
export type InlineButton = { text: string; data: string };

function keyboard(rows: InlineButton[][]): object {
  for (let row of rows) {
    for (let button of row) {
      if (!button.text.trim() || new TextEncoder().encode(button.data).byteLength > 64 || !button.data) {
        throw new Error("Invalid Telegram button.");
      }
    }
  }
  return { inline_keyboard: rows.map(row => row.map(button => ({ text: button.text, callback_data: button.data }))) };
}

/** Отказ Telegram или сбой связи. description — описание отказа от Telegram, если он ответил. */
export class TelegramApiError extends Error {
  constructor(readonly description: string | null, readonly retryAfter: number | null = null) {
    super("Telegram request failed or its result is unconfirmed.");
    this.name = "TelegramApiError";
  }
}

/** Тред удалён пользователем (события об этом нет, узнаём по отказу отправки). */
export function isThreadNotFound(error: unknown): boolean {
  return error instanceof TelegramApiError && /message thread not found|thread not found|TOPIC_DELETED|TOPIC_ID_INVALID/i.test(error.description ?? "");
}

/** Сообщение уже такое, каким его просят сделать (повтор правки). */
export function isNotModified(error: unknown): boolean {
  return error instanceof TelegramApiError && /message is not modified/i.test(error.description ?? "");
}

/** Telegram не разобрал HTML-разметку сообщения. */
export function isParseError(error: unknown): boolean {
  return error instanceof TelegramApiError && /can't parse entities|unsupported start tag|can't find end tag/i.test(error.description ?? "");
}

export const MAX_MESSAGE = 4096;
export const MAX_TOPIC_NAME = 128;
/** Голосовые больше этого не скачиваем: Bot API отдаёт файлы до 20 МБ, распознавание берёт до 8 МБ. */
export const MAX_VOICE_BYTES = 8_000_000;

async function readBounded(body: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  let reader = body.getReader();
  let chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      let part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new Error();
      chunks.push(part.value);
    }
  } catch { await reader.cancel().catch(() => {}); throw new TelegramApiError(null); }
  finally { reader.releaseLock(); }
  let bytes = new Uint8Array(size);
  let offset = 0;
  for (let chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

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
    let parsed: { ok?: unknown; result?: unknown; description?: unknown; parameters?: { retry_after?: unknown } } | null;
    try {
      let fetcher = this.#fetch;
      let response = await fetcher("https://api.telegram.org/bot" + this.#token + "/" + method, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
        headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      // Отказ Telegram (400, 403, 429) приходит с телом {ok:false, description}: его читаем тоже.
      if (!response.body || response.status >= 500 || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel(); throw new Error();
      }
      let bytes = await readBounded(response.body, 65536);
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    } catch { throw new TelegramApiError(null); }
    if (parsed && parsed.ok === true && Object.hasOwn(parsed, "result")) return parsed.result;
    let description = typeof parsed?.description === "string" ? parsed.description.slice(0, 200) : null;
    let retry = parsed?.parameters?.retry_after;
    throw new TelegramApiError(description, Number.isSafeInteger(retry) ? retry as number : null);
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
    return this.send(chat, text);
  }

  /** Сообщение в личный чат, в тред (thread) или вне тредов; html — текст уже в разметке Telegram. */
  async send(chat: number, text: string, options: { thread?: number; html?: boolean; buttons?: InlineButton[][] } = {}): Promise<number> {
    if (!Number.isSafeInteger(chat) || chat <= 0 || typeof text !== "string" || !text.trim() || text.length > MAX_MESSAGE ||
        (options.thread !== undefined && (!Number.isSafeInteger(options.thread) || options.thread <= 0))) {
      throw new Error("Invalid Telegram reply.");
    }
    let result = await this.#call("sendMessage", {
      chat_id: chat, text, link_preview_options: { is_disabled: true },
      ...(options.thread !== undefined ? { message_thread_id: options.thread } : {}),
      ...(options.html ? { parse_mode: "HTML" } : {}),
      ...(options.buttons ? { reply_markup: keyboard(options.buttons) } : {}),
    }) as { message_id?: unknown; chat?: { id?: unknown; type?: unknown } } | null;
    if (!result || !Number.isSafeInteger(result.message_id) || result.chat?.id !== chat || result.chat.type !== "private") {
      throw new Error("Telegram reply is unconfirmed.");
    }
    return result.message_id as number;
  }

  /** Черновик ответа, который растёт на глазах (Bot API 9.3+). Один draftId — один черновик. */
  async draft(chat: number, thread: number | undefined, draftId: number, text: string): Promise<void> {
    if (!Number.isSafeInteger(chat) || chat <= 0 || !Number.isSafeInteger(draftId) || draftId <= 0 ||
        typeof text !== "string" || !text.trim() || text.length > MAX_MESSAGE) {
      throw new Error("Invalid Telegram draft.");
    }
    await this.#call("sendMessageDraft", {
      chat_id: chat, draft_id: draftId, text,
      ...(thread !== undefined ? { message_thread_id: thread } : {}),
    });
  }

  /** Новый тред в личном чате; возвращает его номер. */
  async createTopic(chat: number, name: string): Promise<number> {
    let title = name.trim().slice(0, MAX_TOPIC_NAME);
    if (!Number.isSafeInteger(chat) || chat <= 0 || !title) throw new Error("Invalid Telegram topic.");
    let result = await this.#call("createForumTopic", { chat_id: chat, name: title }) as { message_thread_id?: unknown } | null;
    if (!result || !Number.isSafeInteger(result.message_thread_id) || (result.message_thread_id as number) <= 0) {
      throw new Error("Telegram topic is unconfirmed.");
    }
    return result.message_thread_id as number;
  }

  async renameTopic(chat: number, thread: number, name: string): Promise<void> {
    let title = name.trim().slice(0, MAX_TOPIC_NAME);
    if (!Number.isSafeInteger(chat) || chat <= 0 || !Number.isSafeInteger(thread) || thread <= 0 || !title) {
      throw new Error("Invalid Telegram topic.");
    }
    await this.#call("editForumTopic", { chat_id: chat, message_thread_id: thread, name: title });
  }

  /** Удалить тред вместе с сообщениями (беседу удалили на сайте). */
  async deleteTopic(chat: number, thread: number): Promise<void> {
    if (!Number.isSafeInteger(chat) || chat <= 0 || !Number.isSafeInteger(thread) || thread <= 0) throw new Error("Invalid Telegram topic.");
    await this.#call("deleteForumTopic", { chat_id: chat, message_thread_id: thread });
  }

  /** Заменить текст сообщения бота; кнопки при этом снимаются (reply_markup не передаётся). */
  async editText(chat: number, message: number, text: string, options: { html?: boolean } = {}): Promise<void> {
    if (!Number.isSafeInteger(chat) || chat <= 0 || !Number.isSafeInteger(message) || message <= 0 ||
        typeof text !== "string" || !text.trim() || text.length > MAX_MESSAGE) {
      throw new Error("Invalid Telegram edit.");
    }
    await this.#call("editMessageText", {
      chat_id: chat, message_id: message, text, link_preview_options: { is_disabled: true },
      ...(options.html ? { parse_mode: "HTML" } : {}),
    });
  }

  /** Снять кнопки с сообщения бота, не меняя текста. */
  async removeButtons(chat: number, message: number): Promise<void> {
    if (!Number.isSafeInteger(chat) || chat <= 0 || !Number.isSafeInteger(message) || message <= 0) throw new Error("Invalid Telegram edit.");
    await this.#call("editMessageReplyMarkup", { chat_id: chat, message_id: message, reply_markup: { inline_keyboard: [] } });
  }

  /** Содержимое файла по file_id (голосовое сообщение), не больше limit байт. */
  async fileBytes(fileId: string, limit: number = MAX_VOICE_BYTES): Promise<Uint8Array> {
    if (typeof fileId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(fileId)) throw new Error("Invalid Telegram file.");
    let file = await this.#call("getFile", { file_id: fileId }) as { file_path?: unknown; file_size?: unknown } | null;
    if (!file || typeof file.file_path !== "string" || !/^[A-Za-z0-9_./-]{1,256}$/.test(file.file_path) || file.file_path.includes("..")) {
      throw new TelegramApiError(null);
    }
    if (Number.isSafeInteger(file.file_size) && (file.file_size as number) > limit) throw new TelegramApiError("file is too big");
    try {
      let response = await this.#fetch("https://api.telegram.org/file/bot" + this.#token + "/" + file.file_path, {
        method: "GET", redirect: "manual", signal: AbortSignal.timeout(30000),
      });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(); }
      return await readBounded(response.body, limit);
    } catch { throw new TelegramApiError(null); }
  }

  /** Убрать «часики» с нажатой кнопки; text — короткая всплывающая подсказка. */
  async answerCallback(id: string, text?: string): Promise<void> {
    if (typeof id !== "string" || !id || id.length > 128) throw new Error("Invalid Telegram callback.");
    await this.#call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text: text.slice(0, 200) } : {}) });
  }
}
