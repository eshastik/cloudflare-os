// Документ, прикреплённый в беседе, — файлом в проект беседы (личной версией, правами человека).
//
// Путь тот же, что у остальных созданий документа: выгрузка в хранилище по выданному адресу и
// createPrivateDocument. Тело запроса к Mnemos записывается в квитанцию ДО вызова: повтор той же
// загрузки (та же квитанция) посылает то же тело с тем же request_id, и Mnemos отдаёт уже
// созданный узел. Разное тело при том же request_id Mnemos отвергает, поэтому тело не пересобирается.
import type { AccountStorage, MnemosAccountSession } from "./account-session.ts";
import { MnemosAPIError, type PrivateDocumentCreate } from "./mnemos-api.ts";

export type ChatAttachmentSaveAPI = Pick<MnemosAccountSession, "openDraft" | "beginImportUpload" | "createPrivateDocument" | "listPrivateDocuments">;

export const CHAT_ATTACHMENT_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/markdown", "text/csv", "application/json",
]);
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_NAME_PAGES = 5;

interface Receipt { project: string; body: PrivateDocumentCreate; node?: string }
const RECEIPT = "chatAttachment:", RECEIPTS = "chatAttachmentIndex", MAX_RECEIPTS = 200;

export interface ChatAttachmentReceipts { get(key: string): Receipt | undefined; put(key: string, value: Receipt): void }

/** Квитанции в хранилище подключения; хранятся последние MAX_RECEIPTS. */
export function chatAttachmentReceipts(kv: Pick<AccountStorage, "get" | "put" | "delete">): ChatAttachmentReceipts {
  return {
    get: key => kv.get<Receipt>(RECEIPT + key),
    put: (key, value) => {
      kv.put(RECEIPT + key, value);
      const keys = [key, ...(kv.get<string[]>(RECEIPTS) ?? []).filter(k => k !== key)];
      for (const old of keys.slice(MAX_RECEIPTS)) kv.delete(RECEIPT + old);
      kv.put(RECEIPTS, keys.slice(0, MAX_RECEIPTS));
    },
  };
}

export function validChatAttachmentRequest(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{16,100}$/.test(value);
}

/** Имя файла для проекта: без разделителей пути и управляющих знаков, не длиннее 200 байт. */
export function projectFileName(name: string): string {
  let result = "", size = 0;
  for (const char of name.replace(/[/\\\x00-\x1f\x7f]/g, "_").trim()) {
    const length = new TextEncoder().encode(char).length;
    if (size + length > 200) break;
    result += char; size += length;
  }
  return result || "Вложение";
}

/** Свободное имя: «Отчёт.docx», занято — «Отчёт (2).docx», «Отчёт (3).docx» и дальше. */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

async function takenNames(api: ChatAttachmentSaveAPI, project: string): Promise<Set<string>> {
  const names = new Set<string>();
  let cursor = "";
  for (let page = 0; page < MAX_NAME_PAGES; page++) {
    const result = await api.listPrivateDocuments(project, cursor);
    for (const doc of result.documents) names.add(doc.name);
    if (!result.next_cursor) break;
    cursor = result.next_cursor;
  }
  return names;
}

function describeFailure(error: unknown): Error {
  if (!(error instanceof MnemosAPIError)) return error instanceof Error ? error : new Error(String(error));
  const why = error.status === 403 ? "нет права записи в этот проект"
    : error.status === 401 ? "вход в Mnemos устарел — войдите заново"
    : error.status === 413 ? "файл больше, чем принимает Mnemos"
    : error.status >= 500 ? "Mnemos не ответил"
    : `Mnemos отказал (HTTP ${error.status})`;
  return new Error(why);
}

async function upload(api: ChatAttachmentSaveAPI, storageOrigin: string, fetcher: typeof fetch, project: string, bytes: Uint8Array): Promise<string> {
  const checksum = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))));
  const ticket = await api.beginImportUpload(project, bytes.length, checksum);
  const url = new URL(ticket.url), origin = new URL(storageOrigin);
  if (origin.protocol !== "https:" || origin.origin !== storageOrigin || url.origin !== origin.origin || url.username || url.password || url.hash ||
      ticket.method !== "PUT" || ticket.content_length !== bytes.length || ticket.checksum_header.toLowerCase() !== "x-amz-checksum-sha256" || ticket.checksum_value !== checksum) {
    throw new Error("хранилище Mnemos выдало неожиданный адрес выгрузки");
  }
  const response = await fetcher(url, { method: "PUT", redirect: "manual", signal: AbortSignal.timeout(60_000), headers: { [ticket.checksum_header]: checksum }, body: bytes });
  await response.body?.cancel();
  if (!response.ok) throw new Error("хранилище Mnemos не приняло файл");
  return ticket.upload_id;
}

/** Сохранить вложение беседы файлом в проект. Ошибка — с понятной человеку причиной. */
export async function saveChatAttachment(api: ChatAttachmentSaveAPI, storageOrigin: string, fetcher: typeof fetch, receipts: ChatAttachmentReceipts,
    project: string, request: string, file: { name: string; contentType: string; content: Uint8Array }): Promise<{ resource: string; name: string; created: boolean }> {
  if (typeof project !== "string" || !project || project.length > 255 || !validChatAttachmentRequest(request) ||
      !file || typeof file.name !== "string" || !CHAT_ATTACHMENT_CONTENT_TYPES.has(file.contentType) ||
      !(file.content instanceof Uint8Array) || file.content.length === 0 || file.content.length > MAX_BYTES) {
    throw new Error("файл этого вида в проект не сохраняется");
  }
  try {
    let fresh = request;
    const known = receipts.get(request);
    if (known && known.project === project) {
      if (known.node) return { resource: known.node, name: known.body.name, created: false };
      try {
        const replay = await api.createPrivateDocument(project, known.body);
        receipts.put(request, { ...known, node: replay.node_id });
        return { resource: replay.node_id, name: known.body.name, created: false };
      } catch (error) {
        // 4xx: прежний вызов не дошёл до Mnemos или его тело уже не принять — узла нет, создаётся
        // новый со свежим request_id. Сбой сети и 5xx — не ответ: квитанция остаётся для повтора.
        if (!(error instanceof MnemosAPIError) || error.status >= 500) throw error;
        fresh = `${request}-${crypto.randomUUID()}`.slice(0, 200);
      }
    }
    const { head } = await api.openDraft(project);
    const name = freeName(projectFileName(file.name), await takenNames(api, project));
    const uploadId = await upload(api, storageOrigin, fetcher, project, file.content);
    const body: PrivateDocumentCreate = { request_id: fresh, expected_head: head, parent_id: "", name,
      content_type: file.contentType, upload_id: uploadId, message: "Файл из беседы" };
    receipts.put(request, { project, body });
    const created = await api.createPrivateDocument(project, body);
    receipts.put(request, { project, body, node: created.node_id });
    return { resource: created.node_id, name, created: true };
  } catch (error) {
    throw describeFailure(error);
  }
}
