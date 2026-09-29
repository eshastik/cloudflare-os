// Правила вложений беседы, общие для выбора файла и показа в ленте. Документы Office сервер
// превращает в извлечённый текст, поэтому их предел свой и в общий объём они идут текстом.

export const MAX_CHAT_ATTACHMENT_BYTES = 1024 * 1024;
export const MAX_OFFICE_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const OFFICE_EXTENSION = /\.(docx|xlsx|pptx)$/i;

/** Документ Office (docx, xlsx, pptx): по MIME, а при пустом или общем типе — по расширению. */
export function isOfficeAttachment(name: string | undefined, mimeType: string | undefined): boolean {
  const type = (mimeType ?? "").toLowerCase();
  if (type.startsWith("application/vnd.openxmlformats-officedocument.")) return true;
  if (type && type !== "application/octet-stream" && type !== "application/zip" && type !== "application/x-zip-compressed") return false;
  return OFFICE_EXTENSION.test(name ?? "");
}

/** Сколько вложение займёт в общем объёме сообщения: у документа Office — не больше его текста. */
export function attachmentBudgetBytes(size: number, name: string | undefined, mimeType: string | undefined): number {
  return isOfficeAttachment(name, mimeType) ? Math.min(size, MAX_CHAT_ATTACHMENT_BYTES) : size;
}

/** Имя для скачивания: у документа Office в беседе хранится извлечённый текст, а не сам файл. */
export function attachmentDownloadName(name: string | undefined, mimeType: string): string {
  const base = name ?? "attachment";
  return mimeType.startsWith("text/plain") && OFFICE_EXTENSION.test(base) ? `${base}.txt` : base;
}
