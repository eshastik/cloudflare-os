import { authorizeServiceRequest } from "../auth/service-route";
import type { TelegramPersonalBot, TelegramBotClaim } from "./durable";

/** Служебные пути закрыты внешним прокси и приватным токеном установки. */
export const TELEGRAM_STATE_ROUTE = "/__service/telegram-state";
export const TELEGRAM_ALARM_ROUTE = "/__service/telegram-alarm";

/** Перенос читает состояние через Worker API, включая данные нативного KV. */
export async function handleTelegramStateRoute(
  req: Request, env: Cloudflare.Env,
  bots: DurableObjectNamespace<TelegramPersonalBot>, claims: DurableObjectNamespace<TelegramBotClaim>,
): Promise<Response> {
  const denied = await authorizeServiceRequest(req, env.SHELL_SERVICE_TOKEN);
  if (denied) return denied;
  const json = (status: number, body: unknown) => Response.json(body, {
    status, headers: { "Cache-Control": "no-store" },
  });
  if (req.method !== "POST") return json(405, { error: "method" });
  if (!req.headers.get("Content-Type")?.startsWith("application/json")) return json(415, { error: "content_type" });
  let input: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 4096) return json(413, { error: "body" });
    input = JSON.parse(text);
    if (!input || typeof input !== "object" || Array.isArray(input)) return json(400, { error: "body" });
  } catch { return json(400, { error: "body" }); }
  if (new URL(req.url).pathname === TELEGRAM_ALARM_ROUTE) {
    if (env.SHELL_TELEGRAM_STATE_BACKEND !== "postgres") return json(409, { error: "not_transferred" });
    if (typeof input.actorId !== "string" || !/^[0-9a-f]{64}$/.test(input.actorId)) return json(400, { error: "actor" });
    await bots.get(bots.idFromString(input.actorId)).dispatchPostgresAlarm();
    return json(200, { ok: true });
  }
  if (typeof input.name !== "string" || !input.name || input.name.length > 512 || input.name.includes("\0") || typeof input.retire !== "boolean") {
    return json(400, { error: "actor" });
  }
  if (input.actorType === "telegram-bot") return json(200, await bots.getByName(input.name).migrationSnapshot(input.retire));
  if (input.actorType === "telegram-claim") return json(200, await claims.getByName(input.name).migrationSnapshot(input.retire));
  return json(400, { error: "actor" });
}
