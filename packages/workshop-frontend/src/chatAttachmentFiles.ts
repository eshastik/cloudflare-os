// Правила вложений беседы, общие для выбора файла и показа в ленте. Документы (PDF, Office,
// txt/md/csv/json) лежат в Mnemos, а не в беседе (ADR 0003): их байты не идут в общий объём
// сообщения, и предел у них свой — как у приёма Mnemos.

export const MAX_CHAT_ATTACHMENT_BYTES = 1024 * 1024;
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

/**
 * Вид, под которым документ ляжет в Mnemos; undefined — не документ (картинка, код и прочее).
 * Повторяет chatDocumentContentType сервера: расхождение дало бы отказ уже после выбора файла.
 */
export function chatDocumentContentType(mimeType: string | undefined, name: string | undefined): string | undefined {
  const mime = (mimeType ?? "").split(";", 1)[0].trim().toLowerCase() || "application/octet-stream";
  if (mime.startsWith("image/")) return undefined;
  if (DOCUMENT_TYPES.has(mime)) return mime;
  const extension = /\.([A-Za-z0-9]+)$/.exec(name ?? "")?.[1]?.toLowerCase() ?? "";
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

/** Имя для скачивания старых вложений (до 29.09): документ Office хранился в беседе извлечённым текстом. */
export function attachmentDownloadName(name: string | undefined, mimeType: string): string {
  const base = name ?? "attachment";
  return mimeType.startsWith("text/plain") && /\.(docx|xlsx|pptx)$/i.test(base) ? `${base}.txt` : base;
}

/** Где лежит документ — словами для пометки под вложением. */
export function chatDocumentPlaceLabel(doc: { personal: boolean; projectTitle: string }): string {
  return doc.personal ? "Сохранено в личное пространство" : `Сохранено в проект «${doc.projectTitle}» — личная версия`;
}
