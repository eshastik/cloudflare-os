// Документ, прикреплённый в беседе, живёт в Mnemos, а не в беседе (ADR 0003: данные не ходят через
// сервисы). Браузер кладёт байты в хранилище по одноразовой ссылке, отсюда выдаётся только билет и
// создаётся узел — личная версия правами человека: в проекте беседы или в его личном пространстве.
// Агент читает извлечённый Mnemos текст частями; перенос в проект делает сам Mnemos.
import type { AccountStorage, MnemosAccountSession } from "./account-session.ts";
import { MnemosAPIError, type PrivateDocumentCreate, type UploadTicket } from "./mnemos-api.ts";
import type { ChatDocumentFile, ChatDocumentPlace, ChatDocumentText } from "@gadgets/workshop-shared/gatekeeper";
export type { ChatDocumentFile, ChatDocumentPlace, ChatDocumentText };

export type ChatDocumentAPI = Pick<MnemosAccountSession,
  "openDraft" | "beginProjectUpload" | "createPrivateDocument" | "listPrivateDocuments" | "listProjects" | "createProject" |
  "setProjectVisibility" | "readDraftText" | "readDraftDocument" | "transferPrivateDocument">;

export const CHAT_DOCUMENT_CONTENT_TYPES = new Set([
  "application/pdf", "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/markdown", "text/csv", "application/json",
]);
/** Предел S3 для прямой загрузки одним PUT. */
export const MAX_CHAT_DOCUMENT_BYTES = 5 * 1024 * 1024 * 1024;
export const PERSONAL_SPACE_NAME = "Личное пространство";
const MAX_NAME_PAGES = 5;
const TEXT_PART_BYTES = 48 * 1024;

/** Основа служебного краткого имени личного пространства. Имя угадывается, поэтому своё пространство
 *  узнаётся не по имени, а по создателю; занятое чужим проектом имя получает случайный хвост. */
export function personalSpaceSlug(user: string): string {
  const tail = user.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32);
  if (!tail) throw new Error("не удалось определить пользователя Mnemos");
  return `lichnoe-${tail}`;
}

/** Пространство этого человека: краткое имя из основы (с хвостом или без) и создатель — он сам. */
export function isPersonalSpace(project: { slug: string; created_by?: string }, user: string): boolean {
  const base = personalSpaceSlug(user);
  return project.created_by === user && (project.slug === base || /^-[a-z0-9]{6}$/.test(project.slug.slice(base.length)) && project.slug.startsWith(base));
}

const CLOSED_REFUSAL = "в организации отключены личные проекты — личное пространство открылось бы отделу, поэтому файл не сохранён. Подключите к беседе проект";

/**
 * Личное пространство человека — его закрытый проект. Нет — создаётся. Пространство, которое не
 * удалось закрыть (правило организации открыло его отделу), не используется: файл туда не кладётся.
 */
export async function personalSpace(api: ChatDocumentAPI, user: string): Promise<ChatDocumentPlace> {
  const base = personalSpaceSlug(user);
  const find = async () => (await api.listProjects()).projects.filter(p => isPersonalSpace(p, user))
    .sort((a, b) => a.slug.length - b.slug.length || a.slug.localeCompare(b.slug))[0];
  let found = await find();
  let created = false;
  if (!found) {
    let lastError: unknown;
    for (const slug of [base, `${base}-${randomTail()}`, `${base}-${randomTail()}`]) {
      try {
        found = (await api.createProject(PERSONAL_SPACE_NAME, slug)).project;
        created = true;
        break;
      } catch (error) {
        lastError = error;
        if (error instanceof MnemosAPIError && error.code === "project.personal_disabled") throw describeFailure(error);
        // Имя заняли: своя вкладка в тот же миг или чужой проект с угаданным именем.
        found = await find();
        if (found) break;
        if (!(error instanceof MnemosAPIError && error.status === 409)) throw describeFailure(error, "не удалось создать личное пространство");
      }
    }
    if (!found) throw describeFailure(lastError, "не удалось создать личное пространство");
  }
  if (found.visibility !== "private") {
    if (!created) throw new Error("личное пространство открыто другим людям — файл не сохранён. Закройте его сами или подключите к беседе проект");
    const closed = await api.setProjectVisibility(found.id, "private", false).catch(() => null);
    if (!closed || closed.visibility !== "private") throw new Error(CLOSED_REFUSAL);
  }
  return { project: found.id, projectTitle: found.name || PERSONAL_SPACE_NAME, personal: true };
}

function randomTail(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

export function validChatDocumentFile(file: unknown): file is ChatDocumentFile {
  const f = file as ChatDocumentFile;
  return !!f && typeof f === "object" && typeof f.name === "string" && f.name.length <= 1024 &&
    CHAT_DOCUMENT_CONTENT_TYPES.has(f.contentType) && Number.isSafeInteger(f.size) && f.size > 0 &&
    f.size <= MAX_CHAT_DOCUMENT_BYTES && typeof f.checksum === "string" && /^[A-Za-z0-9+/]{43}=$/.test(f.checksum);
}

/** Билет выгрузки для браузера: адрес только из хранилища установки, размер и сумма — те, что заявлены. */
export async function beginChatDocument(api: ChatDocumentAPI, storageOrigin: string, project: string, file: ChatDocumentFile): Promise<UploadTicket> {
  if (!validChatDocumentFile(file)) throw new Error("файл этого вида в Mnemos из беседы не кладётся");
  let ticket: UploadTicket;
  try { ticket = await api.beginProjectUpload(project, file.size, file.checksum, "draft"); }
  catch (error) { throw describeFailure(error); }
  const url = new URL(ticket.url), origin = new URL(storageOrigin);
  if (origin.protocol !== "https:" || origin.origin !== storageOrigin || url.origin !== origin.origin || url.username || url.password || url.hash ||
      ticket.method !== "PUT" || ticket.content_length !== file.size || ticket.checksum_header.toLowerCase() !== "x-amz-checksum-sha256" ||
      ticket.checksum_value !== file.checksum || typeof ticket.upload_id !== "string" || !ticket.upload_id) {
    throw new Error("хранилище Mnemos выдало неожиданный адрес выгрузки");
  }
  return { upload_id: ticket.upload_id, url: ticket.url, method: ticket.method, checksum_header: ticket.checksum_header,
    checksum_value: ticket.checksum_value, content_length: ticket.content_length };
}

interface Receipt { project: string; body: PrivateDocumentCreate; node?: string }
const RECEIPT = "chatAttachment:", RECEIPTS = "chatAttachmentIndex", MAX_RECEIPTS = 200;

export interface ChatDocumentReceipts { get(key: string): Receipt | undefined; put(key: string, value: Receipt): void }

/** Квитанции в хранилище подключения; хранятся последние MAX_RECEIPTS. */
export function chatDocumentReceipts(kv: Pick<AccountStorage, "get" | "put" | "delete">): ChatDocumentReceipts {
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

export function validChatDocumentRequest(value: unknown): value is string {
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

async function takenNames(api: ChatDocumentAPI, project: string): Promise<Set<string>> {
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

function describeFailure(error: unknown, fallback?: string): Error {
  if (!(error instanceof MnemosAPIError)) return error instanceof Error ? error : new Error(String(error));
  const why = error.code === "project.personal_disabled" ? "в организации отключены личные проекты — подключите к беседе проект"
    : error.status === 403 ? "нет права записи в этот проект"
    : error.status === 401 ? "вход в Mnemos устарел — войдите заново"
    : error.status === 413 || error.code === "upload.too_large" ? "размер файла превышает предел загрузки этой установки Mnemos"
    : error.status === 404 ? "файл не найден в Mnemos"
    : error.status === 409 ? "файл изменился — обновите и повторите"
    : error.status >= 500 ? "Mnemos не ответил"
    : fallback ?? `Mnemos отказал (HTTP ${error.status})`;
  return new Error(why);
}

/**
 * Создать узел из уже выгруженного браузером файла. Тело запроса к Mnemos записывается в квитанцию
 * ДО вызова: повтор с той же квитанцией посылает то же тело с тем же request_id, и Mnemos отдаёт уже
 * созданный узел. Разное тело при том же request_id Mnemos отвергает, поэтому тело не пересобирается.
 */
export async function finishChatDocument(api: ChatDocumentAPI, receipts: ChatDocumentReceipts, project: string, request: string,
    uploadId: string, file: { name: string; contentType: string }): Promise<{ resource: string; name: string; created: boolean }> {
  if (typeof project !== "string" || !project || project.length > 255 || !validChatDocumentRequest(request) ||
      typeof uploadId !== "string" || !uploadId || uploadId.length > 255 ||
      !file || typeof file.name !== "string" || !CHAT_DOCUMENT_CONTENT_TYPES.has(file.contentType)) {
    throw new Error("файл этого вида в Mnemos из беседы не кладётся");
  }
  try {
    let fresh = request;
    const known = receipts.get(request);
    if (known && known.project === project) {
      if (known.node) {
        let current;
        try { current = await api.readDraftDocument(project, known.node); }
        catch (error) {
          if (!(error instanceof MnemosAPIError && error.status === 404)) throw error;
        }
        if (current?.exists) return { resource: known.node, name: known.body.name, created: false };
        if (known.body.upload_id === uploadId) throw new Error("файл удалён или перенесён — прикрепите его заново");
      }
      if (!known.node && known.body.upload_id === uploadId) {
        try {
          const replay = await api.createPrivateDocument(project, known.body);
          receipts.put(request, { ...known, node: replay.node_id });
          return { resource: replay.node_id, name: known.body.name, created: false };
        } catch (error) {
          // 4xx: прежний вызов не дошёл до Mnemos или его тело уже не принять — узла нет, создаётся
          // новый со свежим request_id. Сбой сети и 5xx — не ответ: квитанция остаётся для повтора.
          if (!(error instanceof MnemosAPIError) || error.status >= 500) throw error;
        }
      }
      fresh = `${request}-${crypto.randomUUID()}`.slice(0, 200);
    }
    const { head } = await api.openDraft(project);
    const name = freeName(projectFileName(file.name), await takenNames(api, project));
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

/** Часть извлечённого текста. Разбор ещё идёт — не ошибка, а состояние: агент ждёт и повторяет. */
export async function readChatDocumentText(api: ChatDocumentAPI, project: string, node: string, offset = 0, archivePath?: (string | {nameBase64: string})[]): Promise<ChatDocumentText> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("смещение должно быть целым неотрицательным числом");
  try {
    const part = await api.readDraftText(project, node, offset, TEXT_PART_BYTES, archivePath);
    return { state: "ready", name: part.name, contentType: part.content_type, text: part.text, offset: part.offset,
      nextOffset: part.next_offset, totalBytes: part.total_bytes, done: !part.truncated, noText: part.no_text === true,
      ...(part.failure ? { failure: part.failure } : {}) };
  } catch (error) {
    if (error instanceof MnemosAPIError && (error.status === 429 || error.code === "content.preparing" || error.code === "content.index_pending")) {
      return { state: "preparing", message: "файл ещё разбирается — подождите несколько секунд и повторите" };
    }
    throw describeFailure(error);
  }
}

export interface ChatDocumentMove { project: string; resource: string; name: string; notified: boolean }

/** Перенос своей личной версии в другой проект средствами Mnemos (он же ставит уведомление). */
export async function moveChatDocument(api: Pick<ChatDocumentAPI, "readDraftDocument" | "transferPrivateDocument">, project: string, node: string, target: string, request: string): Promise<ChatDocumentMove> {
  if (typeof target !== "string" || !target || target.length > 255) throw new Error("не выбран проект");
  if (target === project) throw new Error("файл уже в этом проекте");
  if (typeof request !== "string" || !/^[A-Za-z0-9:_-]{16,200}$/.test(request)) throw new Error("неверная заявка переноса");
  try {
    const current = await api.readDraftDocument(project, node);
    if (!current.exists) throw new MnemosAPIError(404);
    if (current.conflicted) throw new Error("у файла неразрешённый конфликт версий — сначала разрешите его");
    const moved = await api.transferPrivateDocument(project, node, { request_id: request, target_project_id: target, expected_head: current.head });
    return { project: moved.project_id, resource: moved.node_id, name: moved.name, notified: moved.notified };
  } catch (error) {
    throw describeFailure(error);
  }
}
