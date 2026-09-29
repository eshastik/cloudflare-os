// Разбор входящего обновления Telegram для личного бота. Перенесён из
// gatekeeper-mnemos/src/telegram-inbox.ts (readTelegramInput): тот же предел размера и та же
// проверка «личный чат, отправитель — человек». Добавлены нажатия кнопок (callback_query).
// Принадлежность отправителя владельцу бота проверяет вызывающий.

export type TelegramSender = { id: number; name: string; username: string | null };

/** Служебное сообщение о треде: создан клиентом (implicit — название дал сам клиент по тексту) или переименован. */
export type TelegramTopicEvent = { kind: "created"; name: string; implicit: boolean } | { kind: "edited"; name: string };

export type TelegramVoice = { fileId: string; size: number | null; mimeType: string };

export type TelegramInput =
  | {
      kind: "message"; update: number; message: number; sender: TelegramSender; text: string | null;
      /** Тред личного чата (Bot API 9.3+); null — сообщение вне тредов. */
      thread: number | null;
      voice: TelegramVoice | null;
      topic: TelegramTopicEvent | null;
      /** Ответ на реплику (reply): номер той реплики; null — не ответ. */
      replyTo: number | null;
    }
  | {
      kind: "callback"; update: number; id: string; sender: TelegramSender;
      /** callback_data кнопки как есть: разбирает и проверяет вызывающий. */
      data: string | null;
      /** Сообщение с кнопкой и его тред; null — Telegram не прислал (сообщение слишком старое). */
      message: number | null;
      thread: number | null;
    };

export const MAX_UPDATE_BYTES = 65536;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function sender(from: Record<string, unknown>): TelegramSender | null {
  if (!positive(from.id) || from.is_bot !== false) return null;
  let first = typeof from.first_name === "string" ? from.first_name : "";
  let last = typeof from.last_name === "string" ? from.last_name : "";
  let username = typeof from.username === "string" && /^[A-Za-z0-9_]{4,32}$/.test(from.username) ? from.username : null;
  let name = [first, last].filter(Boolean).join(" ").trim().slice(0, 128) || (username ? "@" + username : String(from.id));
  return { id: from.id, name, username };
}

/** Тело запроса целиком, не больше предела. null — тело не читается или слишком большое. */
export async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return null;
  let reader = request.body.getReader();
  let chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      let part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_UPDATE_BYTES) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(part.value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  } finally { reader.releaseLock(); }
  let bytes = new Uint8Array(size);
  let offset = 0;
  for (let chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** undefined — тело не JSON-обновление (ошибка запроса); null — обновление, которое бот молча отбрасывает. */
export function parseTelegramUpdate(bytes: Uint8Array): TelegramInput | null | undefined {
  let update: Record<string, unknown>;
  try { update = record(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes))); }
  catch { return undefined; }
  if (!Number.isSafeInteger(update.update_id) || (update.update_id as number) < 0) return undefined;
  let id = update.update_id as number;

  if (update.callback_query !== undefined) {
    let query = record(update.callback_query);
    let from = sender(record(query.from));
    let chat = record(record(query.message).chat);
    // Кнопка из группы или из встроенного режима — не личный разговор с владельцем.
    if (!from || typeof query.id !== "string" || !query.id || query.id.length > 128 ||
        chat.type !== "private" || chat.id !== from.id) return null;
    let source = record(query.message);
    let data = typeof query.data === "string" && query.data.length <= 64 ? query.data : null;
    let message = positive(source.message_id) ? source.message_id : null;
    let thread = positive(source.message_thread_id) ? source.message_thread_id : null;
    return { kind: "callback", update: id, id: query.id, sender: from, data, message, thread };
  }

  let message = record(update.message);
  let chat = record(message.chat);
  let from = sender(record(message.from));
  if (!positive(message.message_id) || !from || chat.type !== "private" || chat.id !== from.id ||
      message.sender_chat || message.via_bot || message.business_connection_id) return null;
  let text = typeof message.text === "string" && message.text.trim() && new TextEncoder().encode(message.text).byteLength <= 16384
    ? message.text : null;

  let topic: TelegramTopicEvent | null = null;
  let created = record(message.forum_topic_created);
  let edited = record(message.forum_topic_edited);
  if (typeof created.name === "string" && created.name.trim()) {
    topic = { kind: "created", name: created.name.trim().slice(0, 128), implicit: created.is_name_implicit === true };
  } else if (typeof edited.name === "string" && edited.name.trim()) {
    topic = { kind: "edited", name: edited.name.trim().slice(0, 128) };
  }
  // Тред — только у сообщений в треде (is_topic_message): в обычном чате message_thread_id бывает
  // и у ответа на реплику. Служебное сообщение о треде всегда лежит в самом треде.
  let thread = positive(message.message_thread_id) && (message.is_topic_message === true || topic)
    ? message.message_thread_id : null;

  let voiceRecord = record(message.voice);
  let voice: TelegramVoice | null = typeof voiceRecord.file_id === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(voiceRecord.file_id)
    ? { fileId: voiceRecord.file_id, size: positive(voiceRecord.file_size) ? voiceRecord.file_size : null,
        mimeType: typeof voiceRecord.mime_type === "string" ? voiceRecord.mime_type.slice(0, 64) : "audio/ogg" }
    : null;
  let reply = record(message.reply_to_message);
  // В треде Telegram ставит reply_to_message и на служебное сообщение о создании треда: такой
  // «ответ» ничем не отличается от обычного сообщения. Вызывающий сверяет номер со своими репликами.
  let replyTo = positive(reply.message_id) && !reply.forum_topic_created ? reply.message_id : null;
  return { kind: "message", update: id, message: message.message_id, sender: from, text, thread, voice, topic, replyTo };
}
