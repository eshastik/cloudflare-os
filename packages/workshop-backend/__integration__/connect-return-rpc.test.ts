import { exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { PublicApi } from "@gadgets/workshop-shared/api";
import { describe, expect, it } from "vitest";
import { CONNECT_COOKIE, CONNECT_FINISH_PATH, ConnectFlows } from "../src/auth/connect-return.js";
import { sha256 } from "../src/auth/login-return.js";

// Подключение аккаунта через настоящий воркер: cookie с /api/connect/start, подтверждение браузера
// обратным вызовом гейткипера, /api/connect/finish и обмен кода в сеансе по WebSocket.

const ORIGIN = "https://workshop.invalid";
const REJECTED = /устарела или открыта в другом браузере/;

async function connect(headers: Record<string, string> = {}): Promise<RpcStub<PublicApi>> {
  const response = await exports.default.fetch(new Request(`${ORIGIN}/api`, { headers: { Upgrade: "websocket", ...headers } }));
  const socket = response.webSocket!;
  socket.accept();
  return newWebSocketRpcSession<PublicApi>(socket);
}

async function newUser() {
  using api = await connect();
  const name = "conn" + crypto.randomUUID().replaceAll("-", "");
  const token = (await api.createAccount(name, name, new Uint8Array([1, 2, 3])))!;
  return { name, token, id: exports.UserDurableObject.idFromName(name).toString(), stub: exports.UserDurableObject.getByName(name) };
}

// Поток переподключения аккаунта 5, будто его начал /api/connect/start в браузере с этой cookie.
async function reconnectFlow(user: Awaited<ReturnType<typeof newUser>>) {
  const secret = "7".repeat(64);
  const flowId = await runInDurableObject(user.stub, async instance => {
    const kv = (instance as unknown as { ctx: DurableObjectState }).ctx.storage.kv;
    return new ConnectFlows(kv, () => Date.now()).begin({ kind: "reconnect", accountId: 5, returnTo: "/gatekeepers" }, await sha256(secret));
  });
  return { cookieValue: `${user.id}.${flowId}.${secret}`, cookie: `${CONNECT_COOKIE}=${user.id}.${flowId}.${secret}` };
}

const callbackOf = (userId: string, accountId = 5) =>
  exports.GatekeeperConnectCallbackImpl({ props: { userId, accountId, vendorId: "google" } });

describe("подключение аккаунта через воркер", () => {
  it("обратный вызов гейткипера подтверждает только браузер с cookie этого потока", async () => {
    const mallory = await newUser();
    const flow = await reconnectFlow(mallory);
    const callback = callbackOf(mallory.id);
    // Пересланная ссылка: у браузера жертвы cookie злоумышленника нет.
    expect(await callback.confirmBrowser({})).toBeNull();
    // Cookie другого пользователя к этому потоку не подходит.
    const alice = await newUser();
    const aliceFlow = await reconnectFlow(alice);
    expect(await callback.confirmBrowser({ connect: aliceFlow.cookieValue })).toBeNull();
    // Подделанный секрет к верному потоку — нет.
    const [user, flowId] = flow.cookieValue.split(".");
    expect(await callback.confirmBrowser({ connect: `${user}.${flowId}.${"f".repeat(64)}` })).toBeNull();
    // Поток другого аккаунта того же пользователя — тоже нет.
    expect(await callbackOf(mallory.id, 6).confirmBrowser({ connect: flow.cookieValue })).toBeNull();
    const confirmed = await callback.confirmBrowser({ connect: flow.cookieValue });
    expect(confirmed?.returnPath).toMatch(new RegExp(`^${CONNECT_FINISH_PATH}\\?handle=${mallory.id}\\.`));
    // Одноразово.
    expect(await callback.confirmBrowser({ connect: flow.cookieValue })).toBeNull();
  });

  it("возврат с кодом и обмен в сеансе того же пользователя; чужой сеанс, чужая страница и повтор — отказ", async () => {
    const owner = await newUser();
    const flow = await reconnectFlow(owner);
    const confirmed = (await callbackOf(owner.id).confirmBrowser({ connect: flow.cookieValue }))!;
    await runInDurableObject(owner.stub, instance => instance.settleConnectFlow(5, undefined));
    const back = await exports.default.fetch(new Request(ORIGIN + confirmed.returnPath, { headers: { Cookie: flow.cookie }, redirect: "manual" }));
    expect(back.status).toBe(303);
    const location = back.headers.get("Location")!;
    expect(location).toMatch(/^\/gatekeepers#connect=[A-Za-z0-9_-]{43}$/);
    const code = location.split("#connect=")[1];

    const other = await newUser();
    using stranger = await connect({ Cookie: flow.cookie, Origin: ORIGIN });
    using strangerSession = await stranger.authenticate(other.token);
    await expect(strangerSession.completeConnect(code)).rejects.toThrow(REJECTED);

    using foreign = await connect({ Cookie: flow.cookie, Origin: "https://evil.example" });
    using foreignSession = await foreign.authenticate(owner.token);
    await expect(foreignSession.completeConnect(code)).rejects.toThrow(REJECTED);

    using noCookie = await connect({ Origin: ORIGIN });
    using noCookieSession = await noCookie.authenticate(owner.token);
    await expect(noCookieSession.completeConnect(code)).rejects.toThrow(REJECTED);

    using own = await connect({ Cookie: flow.cookie, Origin: ORIGIN });
    using session = await own.authenticate(owner.token);
    expect(await session.completeConnect(code)).toEqual({ kind: "reconnect", accountId: 5 });
    await expect(session.completeConnect(code)).rejects.toThrow(REJECTED);
  });

  it("/api/connect/start: без ключа сеанса, с чужой страницы, неизвестный сервис — отказ без cookie", async () => {
    const user = await newUser();
    const post = (token: string, origin: string, body: unknown) => exports.default.fetch(new Request(`${ORIGIN}/api/connect/start`, {
      method: "POST", body: JSON.stringify(body), headers: { Authorization: `Bearer ${token}`, Origin: origin, "Content-Type": "application/json" } }));
    const cases = [
      await post("nobody:secret", ORIGIN, { kind: "connect", vendorId: "google", returnTo: "/" }),
      await post(user.token, "https://evil.example", { kind: "connect", vendorId: "google", returnTo: "/" }),
      await post(user.token, ORIGIN, { kind: "connect", vendorId: "no-such-vendor", returnTo: "/" }),
      await post(user.token, ORIGIN, { kind: "reconnect", accountId: 99, returnTo: "/" }),
    ];
    expect(cases.map(r => r.status)).toEqual([401, 403, 400, 400]);
    for (const r of cases) expect(r.headers.get("Set-Cookie")).toBeNull();
  });
});
