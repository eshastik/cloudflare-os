// Разбор входящего обновления Telegram для личного бота. Перенесён из
// gatekeeper-mnemos/src/telegram-inbox.ts (readTelegramInput): тот же предел размера и та же
// проверка «личный чат, отправитель — человек». Добавлены нажатия кнопок (callback_query).
// Принадлежность отправителя владельцу бота проверяет вызывающий.

export type TelegramSender = { id: number; name: string; username: string | null };

export type TelegramInput =
  | { kind: "message"; update: number; message: number; sender: TelegramSender; text: string | null }
  | { kind: "callback"; update: number; id: string; sender: TelegramSender };

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
    return { kind: "callback", update: id, id: query.id, sender: from };
  }

  let message = record(update.message);
  let chat = record(message.chat);
  let from = sender(record(message.from));
  if (!positive(message.message_id) || !from || chat.type !== "private" || chat.id !== from.id ||
      message.sender_chat || message.via_bot || message.business_connection_id) return null;
  let text = typeof message.text === "string" && message.text.trim() && new TextEncoder().encode(message.text).byteLength <= 16384
    ? message.text : null;
  return { kind: "message", update: id, message: message.message_id, sender: from, text };
}
