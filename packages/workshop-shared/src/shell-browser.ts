// Привязка входа и подключения аккаунта к браузеру, который их начал.
//
// Оболочка при старте входа или подключения ставит браузеру HttpOnly-cookie. Гейткипер живёт на том
// же сайте и видит её в запросе, которым провайдер возвращает браузер. ДО записи учётных данных
// гейткипер передаёт cookie оболочке через callback.confirmBrowser(): так пересланная кому-то
// ссылка гейткипера не подключит аккаунт получателя к отправителю — в браузере получателя cookie
// отправителя нет. Оболочка отвечает путём, куда вернуть браузер после завершения.

import type { GatekeeperConnectCallback } from "./gatekeeper.js";

export const SHELL_LOGIN_COOKIE = "__Host-os-login";
export const SHELL_CONNECT_COOKIE = "__Host-os-connect";

/** Значения cookie оболочки из запроса браузера; чужие cookie сюда не попадают. */
export type ShellBrowserProof = { login?: string; connect?: string };

function readCookie(header: string | null, name: string): string | undefined {
  const values = (header ?? "").split(";").map(item => item.trim()).filter(item => item.startsWith(name + "="));
  if (values.length !== 1) return undefined;
  const value = values[0].slice(name.length + 1);
  return /^[0-9A-Za-z._-]{1,256}$/.test(value) ? value : undefined;
}

export function shellBrowserProof(request: Request): ShellBrowserProof {
  const cookie = request.headers.get("Cookie");
  const login = readCookie(cookie, SHELL_LOGIN_COOKIE), connect = readCookie(cookie, SHELL_CONNECT_COOKIE);
  return { ...(login ? { login } : {}), ...(connect ? { connect } : {}) };
}

/** Спрашивает оболочку, тот ли это браузер. null — не тот (или оболочка не ответила): учётные
 * данные записывать нельзя. Иначе — путь этого же сайта, куда вернуть браузер после завершения. */
export async function confirmShellBrowser(
    callback: Fetcher<GatekeeperConnectCallback> | undefined, proof: ShellBrowserProof | undefined)
    : Promise<{ returnPath: string } | null> {
  if (!callback) return null;
  try {
    const result = await callback.confirmBrowser(proof ?? {});
    return result && isShellReturnPath(result.returnPath) ? { returnPath: result.returnPath } : null;
  } catch {
    return null;
  }
}

/** Путь возврата от оболочки: только путь этого же сайта с признаком результата. */
export function isShellReturnPath(value: unknown): value is string {
  return typeof value === "string" && /^\/api\/(login|connect)\/finish\?handle=[0-9A-Za-z._-]{1,300}$/.test(value);
}

/** Ответ гейткипера после завершения: браузер уходит обратно в оболочку в той же вкладке. */
export function shellReturnResponse(returnPath: string): Response {
  if (!isShellReturnPath(returnPath)) throw new Error("Invalid shell return path");
  return new Response(null, { status: 303, headers: {
    Location: returnPath, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  } });
}
