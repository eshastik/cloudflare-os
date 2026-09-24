// Служебный маршрут для скрипта настройки установки: /__service/shell-account.
//
// Скрипт configure-signin.py перед переключением входа спрашивает, есть ли учётная запись,
// к которой он привязывает почту владельца, и есть ли в ней рабочие места. Маршрут закрыт
// дважды: без переменной SHELL_SERVICE_TOKEN его нет вовсе (404), а с ней нужен тот же токен
// в заголовке Authorization. Наружу путь не публикуется: обратный прокси установки отвечает
// на /__service/* сам (deploy/sophai/mnemos.Caddyfile).

import { shellLoginTarget } from "./login-aliases.js";

export const SERVICE_ROUTE = "/__service/shell-account";

interface AccountSummary { exists: boolean; gadgets: number; connectedAccounts: number }

export interface ServiceRouteDeps {
  token: string | undefined;
  aliases: string | undefined;
  summary(name: string): Promise<AccountSummary>;
}

async function sameToken(expected: string, supplied: string): Promise<boolean> {
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(expected), digest(supplied)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

/** ?name=<имя> — сводка учётной записи; ?email=<почта> — куда входит эта почта и сводка той записи. */
export async function handleServiceRoute(req: Request, deps: ServiceRouteDeps): Promise<Response> {
  if (!deps.token || deps.token.length < 32) return new Response("Not found", { status: 404 });
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ") || !(await sameToken(deps.token, header.slice(7)))) return json(401, { error: "unauthorized" });
  if (req.method !== "GET") return json(405, { error: "method" });
  const url = new URL(req.url);
  const name = url.searchParams.get("name");
  const email = url.searchParams.get("email");
  if ((name === null) === (email === null)) return json(400, { error: "name_or_email" });
  const target = email !== null ? shellLoginTarget({ LOGIN_ALIASES: deps.aliases }, email) : { name: name!, aliased: false };
  if (!target.name || target.name.length > 320) return json(400, { error: "name" });
  return json(200, { name: target.name, aliased: target.aliased, ...(await deps.summary(target.name)) });
}
