import { isTextLikeAttachmentMimeType } from "@gadgets/workshop-shared/api";
import type { AiModelConfig, AiModelProvider, ChatAttachmentUpload } from "@gadgets/workshop-shared/api";
import { PDF_MIME_TYPE } from "./chat-attachment-pdf";
import { chatDocumentContentType } from "./chat-documents";

export const UNSUPPORTED_ATTACHMENT_MESSAGE =
  "Этот формат не поддерживается: сохраните документ как DOCX, XLSX, PPTX или PDF";

// Старые двоичные форматы Office и соседние: Mnemos их не разбирает, человеку нужен понятный совет.
const LEGACY_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/rtf",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
]);
const LEGACY_EXTENSIONS = new Set(["doc", "xls", "ppt", "rtf", "odt", "ods", "odp", "docm", "xlsm", "pptm"]);

/** Старый или иной формат документа, для которого нужен отказ с советом пересохранить. */
export function isLegacyDocument(mimeType: string, name: string | undefined): boolean {
  let extension = /\.([A-Za-z0-9]+)$/.exec(name ?? "")?.[1]?.toLowerCase() ?? "";
  return LEGACY_MIME_TYPES.has(mimeType) || LEGACY_EXTENSIONS.has(extension);
}

// Bounds attachment storage and the bytes replayed into model requests.
const MAX_CHAT_ATTACHMENT_BYTES = 1024 * 1024;

const IMAGE_SIGNATURES = new Map<string, readonly (number | null)[]>([
  ["image/jpeg", [0xFF, 0xD8, 0xFF]],
  ["image/png", [0x89, 0x50, 0x4E, 0x47]],
  ["image/webp", [
    0x52, 0x49, 0x46, 0x46,
    null, null, null, null,
    0x57, 0x45, 0x42, 0x50,
  ]],
]);

// Magic-number prefixes checked at upload. Like the image signatures, the PDF one ("%PDF-")
// only stops mislabeled uploads at the door; nothing here parses the content.
const CONTENT_SIGNATURES = new Map<string, readonly (number | null)[]>([
  ...IMAGE_SIGNATURES,
  [PDF_MIME_TYPE, [0x25, 0x50, 0x44, 0x46, 0x2D]],
]);

const isTextOrImageMime = (mimeType: string) =>
  isTextLikeAttachmentMimeType(mimeType) || IMAGE_SIGNATURES.has(mimeType);

const isTextImageOrPdfMime = (mimeType: string) =>
  isTextOrImageMime(mimeType) || mimeType === PDF_MIME_TYPE;

// pi-ai encodes only text and image content parts, so text + images are universal. PDFs ride an
// image part and are bridged to a provider's native document input where one exists: Gemini takes
// application/pdf inline data as-is, and Anthropic/OpenAI payloads are rewritten in flight (see
// chat-attachment-pdf.ts). Workers AI and Ollama chat endpoints have no document input at all.
const ATTACHMENT_SUPPORT_BY_PROVIDER = {
  anthropic: isTextImageOrPdfMime,
  openai: isTextImageOrPdfMime,
  google: isTextImageOrPdfMime,
  cloudflare: isTextOrImageMime,
  ollama: isTextOrImageMime,
} satisfies Record<AiModelProvider, (mimeType: string) => boolean>;

function sanitizeChatAttachmentMimeType(mimeType: string | undefined): string {
  if (!mimeType || /[\r\n]/.test(mimeType)) return "application/octet-stream";
  return mimeType.split(";", 1)[0].trim().toLowerCase() || "application/octet-stream";
}

function sanitizeChatAttachmentName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  let result = name.replace(/[\r\n]/g, " ").slice(0, 255).trim();
  return result || undefined;
}

/** Reject an attachment type that the selected provider cannot accept. */
export function assertChatAttachmentSupportedByProvider(
  provider: AiModelProvider | undefined,
  mimeType: string,
  byteLength: number,
): void {
  if (byteLength > MAX_CHAT_ATTACHMENT_BYTES) {
    throw new Error("Вложение больше 1 МиБ.");
  }

  if (!provider) {
    if (isTextOrImageMime(mimeType)) return;
    throw new Error(UNSUPPORTED_ATTACHMENT_MESSAGE);
  }

  if (ATTACHMENT_SUPPORT_BY_PROVIDER[provider](mimeType)) return;

  throw new Error(UNSUPPORTED_ATTACHMENT_MESSAGE);
}

/** Normalize and validate attachment bytes before staging them in chat storage. */
export function validateChatAttachmentUpload(
  attachment: ChatAttachmentUpload,
  provider?: AiModelConfig["provider"],
): ChatAttachmentUpload {
  attachment.name = sanitizeChatAttachmentName(attachment.name);
  attachment.mimeType = sanitizeChatAttachmentMimeType(attachment.mimeType);
  assertChatAttachmentSupportedByProvider(provider, attachment.mimeType, attachment.content.byteLength);

  let signature = CONTENT_SIGNATURES.get(attachment.mimeType);
  if (signature) {
    for (let [index, expected] of signature.entries()) {
      if (expected !== null && attachment.content[index] !== expected) {
        throw new Error("Содержимое файла не совпадает с его типом.");
      }
    }
  }

  return attachment;
}

/**
 * Принять вложение беседы байтами: картинки и небольшие файлы, которые не документы (код, yaml и
 * подобное). При подключённом Mnemos документы (PDF, Office, txt/md/csv/json) сюда не принимаются:
 * браузер кладёт их прямо в Mnemos (beginChatDocumentUpload), и через беседу их байты не идут
 * (ADR 0003). Без Mnemos класть их некуда: текст и PDF идут прежним путём с пределом 1 МиБ, а Office
 * разбирать без Mnemos нечем.
 */
export function prepareChatAttachmentUpload(
  attachment: ChatAttachmentUpload,
  provider?: AiModelConfig["provider"],
  mnemosConnected = true,
): ChatAttachmentUpload {
  attachment.name = sanitizeChatAttachmentName(attachment.name);
  attachment.mimeType = sanitizeChatAttachmentMimeType(attachment.mimeType);
  let document = chatDocumentContentType(attachment.mimeType, attachment.name);
  if (document && mnemosConnected) {
    throw new Error("Документы прикрепляются через Mnemos: обновите страницу и прикрепите файл заново.");
  }
  if (document?.startsWith("application/vnd.openxmlformats-officedocument.")) {
    throw new Error("Документы Word, Excel и PowerPoint читаются через Mnemos: подключите Mnemos или сохраните файл как PDF.");
  }
  if (document) attachment.mimeType = document;
  if (isLegacyDocument(attachment.mimeType, attachment.name)) {
    throw new Error(UNSUPPORTED_ATTACHMENT_MESSAGE);
  }
  return validateChatAttachmentUpload(attachment, provider);
}

/** Whether a MIME type is one of the image encodings Workshop accepts for chat attachments. */
export function isAllowedChatAttachmentImageMimeType(mimeType: string | undefined): boolean {
  return IMAGE_SIGNATURES.has(sanitizeChatAttachmentMimeType(mimeType));
}
