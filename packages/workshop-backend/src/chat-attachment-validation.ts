import { isTextLikeAttachmentMimeType } from "@gadgets/workshop-shared/api";
import type { AiModelConfig, AiModelProvider, ChatAttachmentUpload } from "@gadgets/workshop-shared/api";
import { PDF_MIME_TYPE } from "./chat-attachment-pdf";
import {
  MAX_OFFICE_ATTACHMENT_BYTES,
  UNSUPPORTED_ATTACHMENT_MESSAGE,
  extractOfficeText,
  isLegacyDocument,
  officeAttachmentText,
  officeDocumentKind,
} from "./chat-attachment-office";

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
 * Принять вложение беседы: документ Office превращается в текстовое вложение с исходным именем,
 * остальное проверяется как есть. Предел 1 МиБ относится к тексту после извлечения.
 */
export async function prepareChatAttachmentUpload(
  attachment: ChatAttachmentUpload,
  provider?: AiModelConfig["provider"],
): Promise<ChatAttachmentUpload> {
  attachment.name = sanitizeChatAttachmentName(attachment.name);
  attachment.mimeType = sanitizeChatAttachmentMimeType(attachment.mimeType);

  // Windows отдаёт CSV с типом Excel; по расширению это текст.
  if (attachment.mimeType === "application/vnd.ms-excel" && /\.csv$/i.test(attachment.name ?? "")) {
    attachment.mimeType = "text/csv";
  }

  let kind = officeDocumentKind(attachment.mimeType, attachment.name);
  if (kind) {
    if (attachment.content.byteLength > MAX_OFFICE_ATTACHMENT_BYTES) {
      throw new Error("Документ больше 15 МиБ.");
    }
    let zip = [0x50, 0x4b, 0x03, 0x04];
    if (zip.some((byte, index) => attachment.content[index] !== byte)) {
      throw new Error("Содержимое файла не совпадает с его типом.");
    }
    let text = await extractOfficeText(attachment.content, kind);
    attachment = {
      ...attachment,
      mimeType: "text/plain; charset=utf-8",
      content: new TextEncoder().encode(
        officeAttachmentText(attachment.name, text, MAX_CHAT_ATTACHMENT_BYTES)),
    };
  } else if (isLegacyDocument(attachment.mimeType, attachment.name)) {
    throw new Error(UNSUPPORTED_ATTACHMENT_MESSAGE);
  }
  return validateChatAttachmentUpload(attachment, provider);
}

/** Whether a MIME type is one of the image encodings Workshop accepts for chat attachments. */
export function isAllowedChatAttachmentImageMimeType(mimeType: string | undefined): boolean {
  return IMAGE_SIGNATURES.has(sanitizeChatAttachmentMimeType(mimeType));
}
