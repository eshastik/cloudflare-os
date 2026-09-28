// Сборка фрейма приложения весит 1,25 МБ (около 423 КБ сжатием) и уходила в браузер при каждом
// открытии страницы. Браузер хранит сборки по SHA-256 и присылает хеши; при совпадении сервер отдаёт
// только хеш. Сборку перед вставкой браузер всё равно сверяет с хешем.
import { MAX_KNOWN_FRAME_HASHES, type GatekeeperAppFrame } from "@gadgets/workshop-shared/api";
import type { GatekeeperUiFrame } from "@gadgets/workshop-shared/gatekeeper";

const SHA256_HEX = /^[0-9a-f]{64}$/;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest).toHex();
}

/** Хеши от браузера: не больше MAX_KNOWN_FRAME_HASHES строк вида 64 hex; иначе ошибка вызова. */
export function knownFrameHashes(value: unknown): Set<string> {
  if (value === undefined) return new Set();
  if (!Array.isArray(value) || value.length > MAX_KNOWN_FRAME_HASHES ||
      !value.every(hash => typeof hash === "string" && SHA256_HEX.test(hash))) {
    throw new TypeError("Invalid frame hashes.");
  }
  return new Set(value);
}

/** Добавляет хеш сборки и убирает саму сборку, если у браузера она уже есть. */
export async function frameForBrowser(frame: GatekeeperUiFrame, accountId: number, known: Set<string>)
    : Promise<GatekeeperAppFrame> {
  const iframeHtmlSha256 = await sha256Hex(frame.iframeHtml);
  if (!known.has(iframeHtmlSha256)) return Object.assign(frame, { accountId, iframeHtmlSha256 });
  return Object.assign(frame, { accountId, iframeHtmlSha256, iframeHtml: "", iframeHtmlOmitted: true });
}
