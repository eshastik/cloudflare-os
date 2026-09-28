import { exports } from "cloudflare:workers";
import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { PublicApi } from "@gadgets/workshop-shared/api";
import { describe, expect, it } from "vitest";
import { LOGIN_COOKIE, LOGIN_FINISH_PATH } from "../src/auth/login-return.js";

// Вход на той же странице через настоящий воркер: PendingLogin DO, маршрут /api/login/finish и
// RPC-обмен кода по WebSocket, который несёт cookie браузера и заголовок Origin.

const ORIGIN = "https://workshop.invalid";
const TOKEN = "anna@example.ru:session-secret";
const REJECTED = /устарела или открыта в другом браузере/;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Вход, по которому гейткипер уже отчитался: то, что делают /api/login/start и обратный вызов.
async function deliveredLogin(returnTo = "/gatekeepers/mnemos") {
  const logins = exports.PendingLogin;
  const id = logins.newUniqueId();
  const secret = "5".repeat(64);
  const stub = logins.get(id);
  await stub.begin(await sha256(secret), returnTo);
  const handle = `${id.toString()}.${await stub.deliver(TOKEN)}`;
  return { cookie: `${LOGIN_COOKIE}=${id.toString()}.${secret}`, handle };
}

async function connect(headers: Record<string, string>): Promise<RpcStub<PublicApi>> {
  const response = await exports.default.fetch(new Request(`${ORIGIN}/api`, { headers: { Upgrade: "websocket", ...headers } }));
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  return newWebSocketRpcSession<PublicApi>(socket);
}

function finishRaw(cookie: string | null, handle: string | null): Promise<Response> {
  const query = handle ? `?handle=${encodeURIComponent(handle)}` : "";
  return exports.default.fetch(new Request(`${ORIGIN}${LOGIN_FINISH_PATH}${query}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" }));
}

async function finish({ cookie, handle }: { cookie: string; handle: string }): Promise<string> {
  const response = await finishRaw(cookie, handle);
  expect(response.status).toBe(303);
  const location = response.headers.get("Location")!;
  expect(location).toMatch(/^\/gatekeepers\/mnemos#login=[A-Za-z0-9_-]{43}$/);
  return location.split("#login=")[1];
}

describe("обмен кода входа через воркер", () => {
  it("свой браузер меняет код на ключ один раз; повтор — отказ", async () => {
    const login = await deliveredLogin();
    const { cookie } = login;
    const code = await finish(login);
    using api = await connect({ Cookie: cookie, Origin: ORIGIN });
    expect(await api.completeGatekeeperLogin(code)).toBe(TOKEN);
    await expect(api.completeGatekeeperLogin(code)).rejects.toThrow(REJECTED);
  });

  it("соединение без cookie этого входа (другой браузер) — отказ", async () => {
    const login = await deliveredLogin();
    const { cookie } = login;
    const code = await finish(login);
    using stranger = await connect({ Origin: ORIGIN });
    await expect(stranger.completeGatekeeperLogin(code)).rejects.toThrow(REJECTED);
    // Сам вход при этом не сгорает: свой браузер входит.
    using own = await connect({ Cookie: cookie, Origin: ORIGIN });
    expect(await own.completeGatekeeperLogin(code)).toBe(TOKEN);
  });

  it("соединение с чужой страницы (другой Origin) не меняет код даже с cookie", async () => {
    const login = await deliveredLogin();
    const { cookie } = login;
    const code = await finish(login);
    using foreign = await connect({ Cookie: cookie, Origin: "https://evil.example" });
    await expect(foreign.completeGatekeeperLogin(code)).rejects.toThrow(REJECTED);
    using noOrigin = await connect({ Cookie: cookie });
    await expect(noOrigin.completeGatekeeperLogin(code)).rejects.toThrow(REJECTED);
  });

  it("пересланный адрес гейткипера: браузер жертвы гасит вход, злоумышленник ключа не получает", async () => {
    const { cookie, handle } = await deliveredLogin();   // личность жертвы уже во входе злоумышленника
    const victim = await finishRaw(null, handle);
    expect(victim.headers.get("Location")).toBe("/#login-error=other_tab");
    // Сначала — даже с признаком (которого у злоумышленника нет): вход уже погашен браузером жертвы.
    for (const attempt of [await finishRaw(cookie, handle), await finishRaw(cookie, null)]) {
      expect(attempt.headers.get("Location")).not.toContain("#login=");
    }
  });

  it("/api/login/start без разрешённого гейткипера и с чужим return_to — отказ без cookie", async () => {
    for (const url of [`${ORIGIN}/api/login/start?vendor=mnemos&return_to=%2F`, `${ORIGIN}/api/login/start?vendor=mnemos&return_to=https%3A%2F%2Fevil.example%2F`]) {
      const response = await exports.default.fetch(new Request(url, { redirect: "manual" }));
      expect(response.status, url).toBeGreaterThanOrEqual(400);
      expect(response.headers.get("Set-Cookie"), url).toBeNull();
    }
  });
});
