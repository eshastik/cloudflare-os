// Документ, прикреплённый в беседе с проектом Mnemos, кроме беседы ложится файлом в проект:
// личной версией, правами человека, через его подключение. Картинки остаются только в беседе.
// Отказ сохранения не отменяет вложения: человек и агент видят причину.

import type {AiChatMetadata, ChatAttachmentProjectSave} from "@gadgets/workshop-shared/api";
import {mnemosProjectForChat} from "./native-mnemos-binding";
import {officeDocumentKind} from "./chat-attachment-office";

const OFFICE_CONTENT_TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;

const TEXT_BY_EXTENSION: Record<string, string> = {
  txt: "text/plain", md: "text/markdown", markdown: "text/markdown", csv: "text/csv", json: "application/json",
};

/** Вид файла, под которым документ ложится в проект; undefined — такой файл в проект не кладётся. */
export function projectContentType(mimeType: string | undefined, name: string | undefined): string | undefined {
  let mime = (mimeType ?? "").split(";", 1)[0].trim().toLowerCase() || "application/octet-stream";
  if (mime.startsWith("image/")) return undefined;
  if (mime === "application/pdf") return mime;
  let office = officeDocumentKind(mime, name);
  if (office) return OFFICE_CONTENT_TYPES[office];
  if (["text/plain", "text/markdown", "text/csv", "application/json"].includes(mime)) return mime;
  let extension = /\.([A-Za-z0-9]+)$/.exec(name ?? "")?.[1]?.toLowerCase() ?? "";
  // Браузеры отдают md пустым типом, csv — типом Excel, json — text/json и подобным.
  if (TEXT_BY_EXTENSION[extension] && (mime === "application/octet-stream" || mime.startsWith("text/") ||
      mime === "application/vnd.ms-excel" || mime.endsWith("json"))) {
    return TEXT_BY_EXTENSION[extension];
  }
  return undefined;
}

export type ChatAttachmentProjectHost = {
  saveChatAttachmentToProject(accountId: number, project: string, request: string,
      file: {name: string; contentType: string; content: Uint8Array}): Promise<{resource: string; name: string}>;
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).toHex();
}

/** Квитанция сохранения: одна и та же для того же файла в той же беседе и проекте. */
export async function chatAttachmentRequestId(
    chat: {creatorId: string; chatId: number; started: number}, projectId: string, content: Uint8Array): Promise<string> {
  let key = `${chat.creatorId}\0${chat.chatId}\0${chat.started}\0${projectId}\0${await sha256Hex(content)}`;
  return "chat-" + (await sha256Hex(new TextEncoder().encode(key))).slice(0, 48);
}

/** Сохранить документ в проект беседы. undefined — сохранять некуда или нечего (нет проекта, картинка). */
export async function saveChatAttachmentToProject(input: {
  meta: AiChatMetadata | undefined;
  userId: string;
  file: {mimeType: string | undefined; name: string | undefined; content: Uint8Array};
  host: ChatAttachmentProjectHost;
}): Promise<ChatAttachmentProjectSave | undefined> {
  let {meta, userId, file, host} = input;
  if (!meta) return undefined;
  let project = mnemosProjectForChat(meta, userId);
  if (!project) return undefined;
  let contentType = projectContentType(file.mimeType, file.name);
  if (!contentType) return undefined;
  let name = file.name?.trim() || "Вложение";
  try {
    let request = await chatAttachmentRequestId(
        {creatorId: userId, chatId: meta.id, started: new Date(meta.started).valueOf()}, project.projectId, file.content);
    let saved = await host.saveChatAttachmentToProject(project.accountId, project.projectId, request,
        {name, contentType, content: file.content});
    return {saved: true, accountId: project.accountId, projectId: project.projectId, projectTitle: project.title,
      resource: saved.resource, name: saved.name};
  } catch (error) {
    let reason = (error as Error)?.message?.trim() || "причина неизвестна";
    return {saved: false, projectTitle: project.title, reason: reason.slice(0, 300)};
  }
}

/** Строка для агента: куда лёг файл, чтобы он мог на него сослаться. */
export function projectSaveNote(save: ChatAttachmentProjectSave | undefined): string {
  if (!save) return "";
  return save.saved
    ? `\n[Файл сохранён в проект «${save.projectTitle}» личной версией под именем «${save.name}».]`
    : `\n[Файл НЕ сохранён в проект «${save.projectTitle}»: ${save.reason}.]`;
}
