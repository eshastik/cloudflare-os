// Точка RPC Telegram Mini App на настоящем сервере: только WebSocket со своей страницы, без сессии
// Mini App ничего не открывается, сессия сайта (токен входа) её не заменяет.
import { exports } from "cloudflare:workers";
import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { PublicApi } from "@gadgets/workshop-shared/api";
import type { MiniAppPublicApi } from "@gadgets/workshop-shared/telegram-mini-app";
import { expect, it } from "vitest";

const RPC = "https://workshop.invalid/api/telegram-app/rpc";

it("не WebSocket — 426; чужой или пустой источник — 403", async () => {
  expect((await exports.default.fetch(new Request(RPC))).status).toBe(426);
  expect((await exports.default.fetch(new Request(RPC, { headers: { Upgrade: "websocket" } }))).status).toBe(403);
  expect((await exports.default.fetch(new Request(RPC, { headers: { Upgrade: "websocket", Origin: "https://evil.example" } }))).status).toBe(403);
});

it("неизвестная сессия и токен входа сайта — отказ", async () => {
  const site = await exports.default.fetch(new Request("https://workshop.invalid/api", { headers: { Upgrade: "websocket" } }));
  site.webSocket!.accept();
  using siteApi = newWebSocketRpcSession<PublicApi>(site.webSocket!);
  const name = "ma" + crypto.randomUUID().replaceAll("-", "");
  const token = (await siteApi.createAccount(name, name, new Uint8Array([1, 2, 3])))!;

  const attempt = async (session: string) => {
    const response = await exports.default.fetch(new Request(RPC, { headers: { Upgrade: "websocket", Origin: "https://workshop.invalid" } }));
    expect(response.status).toBe(101);
    response.webSocket!.accept();
    using api = newWebSocketRpcSession<MiniAppPublicApi>(response.webSocket!) as RpcStub<MiniAppPublicApi>;
    return await Promise.resolve(api.open(session)).then(() => "открыто", (error: Error) => error.message);
  };
  expect(await attempt(token)).toContain("Сессия Mini App закончилась");
  const route = exports.TelegramPersonalBot.idFromName("user:" + name).toString();
  expect(await attempt(`${route}.${"x".repeat(43)}`)).toContain("Сессия Mini App закончилась");
});
