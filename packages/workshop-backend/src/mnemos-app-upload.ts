// Запись текста приложения в хранилище Mnemos самой оболочкой (ADR 0028 Mnemos, этап 3): копия
// приложения и её обновление. Тело идёт прямо в хранилище по билету Mnemos, через RPC Mnemos не
// проходит; сумма и размер сверяются с билетом, как при выгрузке из браузера.

import { GADGET_APP_LIMITS, parseGadgetAppText } from "@gadgets/workshop-shared/gadget-app";
import type { GatekeeperUploadTicket } from "@gadgets/workshop-shared/gatekeeper";

const failed = () => new Error("Не удалось записать приложение в Mnemos.");

/** Выгрузить текст узла приложения по билету; возвращает upload_id для сохранения версии. */
export async function uploadAppText(storageOrigin: string, text: string,
    issue: (size: number, checksum: string) => Promise<GatekeeperUploadTicket>, fetcher: typeof fetch = fetch): Promise<string> {
  parseGadgetAppText(text);
  let origin: URL;
  try { origin = new URL(storageOrigin); } catch { throw failed(); }
  if (origin.protocol !== "https:" || origin.origin !== storageOrigin) throw failed();
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > GADGET_APP_LIMITS.totalBytes) throw failed();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const checksum = btoa(String.fromCharCode(...digest));
  const ticket = await issue(bytes.byteLength, checksum);
  let url: URL;
  try { url = new URL(ticket.url); } catch { throw failed(); }
  if (url.origin !== storageOrigin || url.username || url.password || url.hash || ticket.method !== "PUT" ||
      ticket.checksum_header !== "x-amz-checksum-sha256" || ticket.checksum_value !== checksum || ticket.content_length !== bytes.byteLength ||
      typeof ticket.upload_id !== "string" || !ticket.upload_id || ticket.upload_id.length > 255) throw failed();
  const response = await fetcher(url.href, { method: "PUT", body: bytes, redirect: "manual", headers: { "x-amz-checksum-sha256": checksum } });
  await response.body?.cancel();
  if (!response.ok) throw failed();
  return ticket.upload_id;
}
