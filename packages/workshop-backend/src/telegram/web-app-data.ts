// Проверка initData Telegram Mini App без токена бота (ADR 0027, раздел 6). Способ «для третьих
// сторон» из https://core.telegram.org/bots/webapps#validating-data-for-third-party-use: подпись
// Ed25519 в поле signature (base64url) над строкой
//   "<bot_id>:WebAppData\n" + все поля, кроме hash и signature, по алфавиту, "key=value" через \n.
// Открытый ключ — ключ Telegram (рабочая среда); тесты подают свой.

export const TELEGRAM_WEBAPP_PUBLIC_KEY = "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d";
/** Сколько после открытия Mini App её данные годятся для входа. */
export const WEBAPP_DATA_MAX_AGE_MS = 15 * 60 * 1000;
/** Допуск на расхождение часов: auth_date чуть впереди наших часов — не подделка. */
const CLOCK_SKEW_MS = 60 * 1000;
export const MAX_INIT_DATA = 4096;

export type WebAppIdentity = { userId: number; authDate: number };

function base64UrlBytes(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(text)) return null;
  let normal = text.replace(/=+$/, "").replaceAll("-", "+").replaceAll("_", "/");
  try {
    let binary = atob(normal + "=".repeat((4 - normal.length % 4) % 4));
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  } catch { return null; }
}

function hexBytes(hex: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g)!.map(pair => parseInt(pair, 16)));
}

/** Строка для подписи. Повтор ключа — отказ: иначе неясно, какое значение подписано. */
export function webAppCheckString(initData: string, botId: string): { text: string; fields: Map<string, string>; signature: string } | null {
  let params: URLSearchParams;
  try { params = new URLSearchParams(initData); } catch { return null; }
  let fields = new Map<string, string>();
  for (let [key, value] of params) {
    if (fields.has(key)) return null;
    fields.set(key, value);
  }
  let signature = fields.get("signature");
  if (!signature) return null;
  let lines = [...fields.entries()].filter(([key]) => key !== "hash" && key !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, value]) => `${key}=${value}`);
  return { text: `${botId}:WebAppData\n${lines.join("\n")}`, fields, signature };
}

/** Проверить initData. null — подпись не сходится, данные устарели или не по форме. */
export async function verifyWebAppData(initData: unknown, botId: string, now: number, publicKeyHex: string = TELEGRAM_WEBAPP_PUBLIC_KEY): Promise<WebAppIdentity | null> {
  if (typeof initData !== "string" || !initData || initData.length > MAX_INIT_DATA || !/^[1-9][0-9]{0,19}$/.test(botId)) return null;
  let check = webAppCheckString(initData, botId);
  if (!check) return null;
  let signature = base64UrlBytes(check.signature);
  let publicKey = hexBytes(publicKeyHex);
  if (!signature || signature.byteLength !== 64 || !publicKey || publicKey.byteLength !== 32) return null;
  let valid = false;
  try {
    let key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, ["verify"]);
    valid = await crypto.subtle.verify({ name: "Ed25519" }, key, signature, new TextEncoder().encode(check.text));
  } catch { return null; }
  if (!valid) return null;

  let authText = check.fields.get("auth_date") ?? "";
  if (!/^[1-9][0-9]{0,11}$/.test(authText)) return null;
  let authDate = Number(authText) * 1000;
  if (now - authDate > WEBAPP_DATA_MAX_AGE_MS || authDate - now > CLOCK_SKEW_MS) return null;

  let user: unknown;
  try { user = JSON.parse(check.fields.get("user") ?? ""); } catch { return null; }
  let id = (user as { id?: unknown } | null)?.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
  return { userId: id, authDate };
}
