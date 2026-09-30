// Документы, прикреплённые в беседе, живут в Mnemos (ADR 0003): браузер кладёт файл прямо в хранилище
// по одноразовой ссылке, беседа хранит только место — узел личной версии человека. Агент читает
// извлечённый Mnemos текст частями, а не получает файл целиком. Картинки идут прежним путём: модели
// они нужны как изображения.

import type {AiChatMetadata, ChatAttachmentProjectSave, ChatDocumentRef, ChatDocumentUploadRequest} from "@gadgets/workshop-shared/api";
import {mnemosProjectForChat} from "./native-mnemos-binding";

/** Протокольный предел прямой загрузки одним PUT; тело читает потоковый импорт ядра. */
export const MAX_CHAT_DOCUMENT_BYTES = 5 * 1024 * 1024 * 1024;

const OFFICE_TYPES: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const TEXT_BY_EXTENSION: Record<string, string> = {
  txt: "text/plain", md: "text/markdown", markdown: "text/markdown", csv: "text/csv", json: "application/json",
};
const DOCUMENT_TYPES = new Set(["application/pdf", ...Object.values(OFFICE_TYPES), ...Object.values(TEXT_BY_EXTENSION)]);

/** Вид, под которым документ ложится в Mnemos; undefined — это не документ (картинка, код и прочее). */
export function chatDocumentContentType(mimeType: string | undefined, name: string | undefined): string | undefined {
  let mime = (mimeType ?? "").split(";", 1)[0].trim().toLowerCase() || "application/octet-stream";
  if (mime.startsWith("image/")) return undefined;
  if (DOCUMENT_TYPES.has(mime)) return mime;
  let extension = /\.([A-Za-z0-9]+)$/.exec(name ?? "")?.[1]?.toLowerCase() ?? "";
  // Браузеры отдают docx пустым типом или zip, md — пустым, csv — типом Excel, json — text/json.
  if (OFFICE_TYPES[extension] && ["application/octet-stream", "application/zip", "application/x-zip-compressed"].includes(mime)) {
    return OFFICE_TYPES[extension];
  }
  if (TEXT_BY_EXTENSION[extension] && (mime === "application/octet-stream" || mime.startsWith("text/") ||
      mime === "application/vnd.ms-excel" || mime.endsWith("json"))) {
    return TEXT_BY_EXTENSION[extension];
  }
  return undefined;
}

/** Проверенное описание документа для билета: вид, размер и сумма. Бросает понятной причиной. */
export function checkedChatDocument(file: ChatDocumentUploadRequest): {name: string; contentType: string; size: number; checksum: string} {
  if (!file || typeof file !== "object" || typeof file.name !== "string" || typeof file.mimeType !== "string") {
    throw new Error("Неверное описание файла.");
  }
  let name = file.name.replace(/[\r\n]/g, " ").trim().slice(0, 255) || "Вложение";
  let contentType = chatDocumentContentType(file.mimeType, name);
  if (!contentType) throw new Error("Этот файл нельзя прикрепить как документ.");
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("Файл пустой.");
  if (file.size > MAX_CHAT_DOCUMENT_BYTES) throw new Error("Прямая загрузка одним PUT ограничена 5 ГиБ.");
  if (typeof file.checksum !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(file.checksum)) throw new Error("Неверная контрольная сумма файла.");
  return {name, contentType, size: file.size, checksum: file.checksum};
}

/**
 * Билет из подключения Mnemos перед выдачей браузеру: адрес — только хранилище установки по https,
 * метод PUT, размер и сумма — заявленные. Возвращает origin хранилища, с которым браузер сверит адрес.
 */
export function checkedChatDocumentTicket(issued: {storageOrigin: string; ticket: {url: string; method: string; content_length: number; checksum_value: string; upload_id: string}},
    file: {size: number; checksum: string}): string {
  let fail = () => new Error("Mnemos выдал неожиданный адрес выгрузки.");
  let storage: URL, url: URL;
  try { storage = new URL(issued.storageOrigin); url = new URL(issued.ticket.url); } catch { throw fail(); }
  if (storage.protocol !== "https:" || url.protocol !== "https:" || url.origin !== storage.origin || url.username || url.password ||
      issued.ticket.method !== "PUT" || issued.ticket.content_length !== file.size || issued.ticket.checksum_value !== file.checksum ||
      typeof issued.ticket.upload_id !== "string" || !issued.ticket.upload_id) {
    throw fail();
  }
  return storage.origin;
}

export type ChatDocumentTarget = {accountId: number | null; projectId: string | null; title: string};

/**
 * Куда ляжет документ: проект беседы; для ещё не созданной беседы — выбранный в ней проект;
 * иначе личное пространство человека (projectId=null, его находит или создаёт подключение Mnemos).
 */
export function chatDocumentTarget(meta: AiChatMetadata | undefined, userId: string,
    hint?: {accountId: number; projectId: string}): ChatDocumentTarget {
  let project = meta ? mnemosProjectForChat(meta, userId) : null;
  if (project) return {accountId: project.accountId, projectId: project.projectId, title: project.title};
  if (!meta && hint && Number.isSafeInteger(hint.accountId) && typeof hint.projectId === "string" &&
      hint.projectId && hint.projectId.length <= 255) {
    // Права на проект проверяет Mnemos сессией человека; здесь только форма.
    return {accountId: hint.accountId, projectId: hint.projectId, title: ""};
  }
  return {accountId: null, projectId: null, title: ""};
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).toHex();
}

/**
 * Квитанция создания узла: для того же файла в той же беседе и том же проекте — одна и та же, поэтому
 * повторное прикрепление не заводит второй файл. Без беседы — случайная.
 */
export async function chatDocumentRequestId(
    chat: {creatorId: string; chatId: number; started: number} | undefined, projectId: string, checksum: string): Promise<string> {
  if (!chat) return "chat-" + crypto.randomUUID().replaceAll("-", "");
  let key = `${chat.creatorId}\0${chat.chatId}\0${chat.started}\0${projectId}\0${checksum}`;
  return "chat-" + (await sha256Hex(new TextEncoder().encode(key))).slice(0, 48);
}

/** Где лежит документ — словами для человека. */
export function chatDocumentPlace(doc: Pick<ChatDocumentRef, "personal" | "projectTitle">): string {
  return doc.personal ? "личное пространство" : `проект «${doc.projectTitle}»`;
}

/** Что агент знает о документе: имя, место и как его читать. Текста здесь нет — агент читает нужное. */
export function chatDocumentNote(doc: ChatDocumentRef): string {
  let size = doc.size >= 1024 * 1024 ? `${(doc.size / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(doc.size / 1024))} КБ`;
  return `\n\n[Прикреплён файл «${doc.name}» (${doc.contentType}, ${size}). Он сохранён в Mnemos: ` +
    `${chatDocumentPlace(doc)}, личной версией человека; project="${doc.projectId}", node="${doc.resource}". ` +
    `Текст файла здесь не вложен: читайте его частями через MNEMOS.readChatFile(project, node, offset) — ` +
    `только то, что нужно для ответа. Если ответ state "preparing" — файл ещё разбирается: подождите и повторите. ` +
    (doc.personal ? `Перенести файл в проект можно через MNEMOS.moveFileToProject(project, node, target) — ` +
      `только если человек об этом просит или согласен.` : "") + `]`;
}

/** Строка агенту для старых сообщений, где документ был копией в проекте (выпуск 446581eb). */
export function legacyProjectNote(save: ChatAttachmentProjectSave | undefined): string {
  if (!save) return "";
  return save.saved
    ? `\n[Файл сохранён в проект «${save.projectTitle}» личной версией под именем «${save.name}».]`
    : `\n[Файл НЕ сохранён в проект «${save.projectTitle}»: ${save.reason}.]`;
}
