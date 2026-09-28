import { describe, expect, it } from "vitest";
import {
  CONNECT_CODE_TTL_MS, CONNECT_COOKIE, CONNECT_FINISH_PATH, ConnectFlows, confirmConnectBrowser, handleConnectFinish,
  handleConnectStart, redeemConnectCode, type ConnectPort, type ConnectUserPort, type FlowRequest,
} from "../src/auth/connect-return.js";

// Подключение внешнего аккаунта на той же странице и с привязкой к браузеру:
//   POST /api/connect/start (с ключом сеанса) ставит cookie и отдаёт адрес гейткипера;
//   гейткипер ДО записи учётных данных спрашивает оболочку confirmBrowser(cookie браузера);
//   гейткипер возвращает браузер на /api/connect/finish?handle=…; тот выдаёт одноразовый код;
//   приложение того же пользователя меняет код, и только тогда аккаунт записывается.

const ORIGIN = "https://os.example";
const ALICE = "a".repeat(64), MALLORY = "b".repeat(64);
const TOKENS: Record<string, string> = { "alice:s1": ALICE, "mallory:s2": MALLORY };

function memoryKv() {
  const map = new Map<string, unknown>();
  return {
    get: <T>(key: string) => map.get(key) as T | undefined,
    put: (key: string, value: unknown) => { map.set(key, value); },
    delete: (key: string) => map.delete(key),
    list: <T>({ prefix }: { prefix: string }) => [...map.entries()].filter(([k]) => k.startsWith(prefix)) as [string, T][],
    size: () => map.size, values: () => [...map.values()],
  };
}

// Стенд: у каждого пользователя свои потоки подключения и свои записанные аккаунты; гейткипер
// подставной. Часы подаются тестом.
function stand() {
  let clock = 1_000_000;
  const kvs = new Map<string, ReturnType<typeof memoryKv>>();
  const written = new Map<string, { accountId: number; vendorId: string; who: string }[]>();
  const vendorCalls: { userId: string; request: FlowRequest }[] = [];
  const flows = (userId: string) => {
    if (!kvs.has(userId)) kvs.set(userId, memoryKv());
    return new ConnectFlows(kvs.get(userId)!, () => clock);
  };
  let nextAccount = 1;
  const user = (userId: string): ConnectUserPort => ({
    async start(request, secretHash) {
      vendorCalls.push({ userId, request });
      const accountId = request.kind === "connect" ? nextAccount++ : request.accountId!;
      const flowId = await flows(userId).begin({ ...request, accountId }, secretHash);
      return { flowId, url: `${ORIGIN}/gatekeeper/${request.vendorId ?? "google"}/start/${accountId}` };
    },
    confirm: (flowId, secret, accountId) => flows(userId).confirm(flowId, secret, accountId),
    issueCode: (flowId, secret, handle) => flows(userId).issueCode(flowId, secret, handle),
    abandon: (flowId, handle) => flows(userId).abandon(flowId, handle),
    async redeem(flowId, secret, code) {
      const flow = await flows(userId).redeem(flowId, secret, code);
      if (flow?.kind === "connect") {
        const list = written.get(userId) ?? [];
        list.push({ accountId: flow.accountId, vendorId: flow.vendorId!, who: String(flow.result?.account) });
        written.set(userId, list);
      }
      return flow ? { kind: flow.kind, vendorId: flow.vendorId, accountId: flow.accountId } : null;
    },
  });
  const port: ConnectPort = {
    async authenticate(token) { const id = token ? TOKENS[token] : undefined; if (!id) throw new Error("invalid session token"); return id; },
    user,
  };
  return {
    port, flows, written, vendorCalls, kvs,
    tick(ms: number) { clock += ms; },
    // Гейткипер завершил вход у провайдера в каком-то браузере (cookie — cookie этого браузера):
    // спрашивает оболочку, тот ли это браузер, и только тогда кладёт учётные данные.
    async gatekeeperCompletes(owner: string, accountId: number, cookie: string, who: string) {
      const confirmed = await confirmConnectBrowser(cookie.split("=")[1], owner, accountId, port);
      if (!confirmed) return null;
      await flows(owner).settle(accountId, { account: who });
      return confirmed.returnPath;
    },
  };
}

type Stand = ReturnType<typeof stand>;
const cookieOf = (response: Response) => response.headers.get("Set-Cookie")!.split(";")[0];

async function start(s: Stand, token: string, body: Record<string, unknown>, origin = ORIGIN) {
  const response = await handleConnectStart(new Request(`${ORIGIN}/api/connect/start`, {
    method: "POST", body: JSON.stringify({ returnTo: "/gatekeepers", ...body }),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Origin: origin },
  }), s.port);
  return { response, cookie: response.status === 200 ? cookieOf(response) : "", body: response.status === 200 ? await response.json() as { url: string } : null };
}

async function finish(s: Stand, cookie: string, returnPath: string) {
  return handleConnectFinish(new Request(ORIGIN + returnPath, { headers: cookie ? { Cookie: cookie } : {} }), s.port);
}

const REJECTED = /устарела или открыта в другом браузере/;
const codeOf = (response: Response) => new URL(response.headers.get("Location")!, ORIGIN).hash.replace(/^#connect=/, "");
const accountOf = (url: string) => Number(url.split("/").at(-1));

describe("подключение аккаунта на той же странице", () => {
  it("полный цикл: старт с ключом сеанса, подтверждение браузера, возврат с кодом, обмен — аккаунт записан", async () => {
    const s = stand();
    const { response, cookie, body } = await start(s, "alice:s1", { kind: "connect", vendorId: "google", resourceUrlPatterns: ["gmail://*"], returnTo: "/gatekeepers?x=1" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toMatch(new RegExp(`^${CONNECT_COOKIE}=${ALICE}\\.[0-9a-f]{32}\\.[0-9a-f]{64}; Path=/; Max-Age=\\d+; HttpOnly; Secure; SameSite=Lax$`));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(s.vendorCalls[0]).toEqual({ userId: ALICE, request: { kind: "connect", vendorId: "google", resourceUrlPatterns: ["gmail://*"], returnTo: "/gatekeepers?x=1" } });
    const returnPath = await s.gatekeeperCompletes(ALICE, accountOf(body!.url), cookie, "alice-google");
    expect(returnPath).toMatch(new RegExp(`^${CONNECT_FINISH_PATH.replaceAll("/", "\\/")}\\?handle=${ALICE}\\.[0-9a-f]{32}\\.[A-Za-z0-9_-]{43}$`));
    const back = await finish(s, cookie, returnPath!);
    expect(back.status).toBe(303);
    expect(back.headers.get("Location")).toMatch(/^\/gatekeepers\?x=1#connect=[A-Za-z0-9_-]{43}$/);
    expect(s.written.get(ALICE)).toBeUndefined();   // до обмена кода аккаунт не записан
    expect(await redeemConnectCode(cookie, true, ALICE, codeOf(back), s.port)).toEqual({ kind: "connect", vendorId: "google", accountId: 1 });
    expect(s.written.get(ALICE)).toEqual([{ accountId: 1, vendorId: "google", who: "alice-google" }]);
    expect(s.kvs.get(ALICE)!.size()).toBe(0);
  });

  it("пересланная ссылка подключения: аккаунт жертвы не подключается к отправителю", async () => {
    const s = stand();
    // Злоумышленник начал подключение у себя и переслал адрес гейткипера жертве.
    const mallory = await start(s, "mallory:s2", { kind: "connect", vendorId: "google" });
    const accountId = accountOf(mallory.body!.url);
    // Жертва входит в Google в СВОЁМ браузере: там нет cookie злоумышленника. Гейткипер спрашивает
    // оболочку до записи учётных данных и получает отказ.
    expect(await s.gatekeeperCompletes(MALLORY, accountId, "", "victim-google")).toBeNull();
    // Даже если у жертвы идёт своё подключение: её cookie — не того пользователя.
    const victimOwn = await start(s, "alice:s1", { kind: "connect", vendorId: "google" });
    expect(await s.gatekeeperCompletes(MALLORY, accountId, victimOwn.cookie, "victim-google")).toBeNull();
    // Подделанный секрет к верному потоку тоже не проходит.
    const [, value] = mallory.cookie.split("=");
    const [user, flow] = value.split(".");
    expect(await s.gatekeeperCompletes(MALLORY, accountId, `x=${user}.${flow}.${"f".repeat(64)}`, "victim-google")).toBeNull();
    // У злоумышленника нет ни признака, ни результата: кода нет, аккаунт не записан.
    const back = await finish(s, mallory.cookie, `${CONNECT_FINISH_PATH}`);
    expect(back.headers.get("Location")).not.toContain("#connect=");
    expect(s.written.get(MALLORY)).toBeUndefined();
  });

  it("код меняет только тот же пользователь: чужой сеанс с той же cookie — отказ", async () => {
    const s = stand();
    const { cookie, body } = await start(s, "mallory:s2", { kind: "connect", vendorId: "google" });
    const returnPath = await s.gatekeeperCompletes(MALLORY, accountOf(body!.url), cookie, "mallory-google");
    const code = codeOf(await finish(s, cookie, returnPath!));
    await expect(redeemConnectCode(cookie, true, ALICE, code, s.port)).rejects.toThrow(REJECTED);
    expect(s.written.get(ALICE)).toBeUndefined();
    expect(await redeemConnectCode(cookie, true, MALLORY, code, s.port)).toMatchObject({ kind: "connect" });
  });

  it("повтор кода, чужая страница, неверный и истёкший код — отказ", async () => {
    const s = stand();
    const { cookie, body } = await start(s, "alice:s1", { kind: "connect", vendorId: "google" });
    const returnPath = await s.gatekeeperCompletes(ALICE, accountOf(body!.url), cookie, "g");
    const code = codeOf(await finish(s, cookie, returnPath!));
    await expect(redeemConnectCode(cookie, false, ALICE, code, s.port)).rejects.toThrow(REJECTED);
    await expect(redeemConnectCode(null, true, ALICE, code, s.port)).rejects.toThrow(REJECTED);
    await expect(redeemConnectCode(cookie, true, ALICE, "x".repeat(43), s.port)).rejects.toThrow(REJECTED);
    expect(await redeemConnectCode(cookie, true, ALICE, code, s.port)).toMatchObject({ kind: "connect" });
    await expect(redeemConnectCode(cookie, true, ALICE, code, s.port)).rejects.toThrow(REJECTED);

    const late = await start(s, "alice:s1", { kind: "connect", vendorId: "google" });
    const lateReturn = await s.gatekeeperCompletes(ALICE, accountOf(late.body!.url), late.cookie, "g");
    const lateCode = codeOf(await finish(s, late.cookie, lateReturn!));
    s.tick(CONNECT_CODE_TTL_MS);
    await expect(redeemConnectCode(late.cookie, true, ALICE, lateCode, s.port)).rejects.toThrow(REJECTED);
  });

  it("возврат гейткипера в браузер без cookie этого подключения гасит поток", async () => {
    const s = stand();
    const { cookie, body } = await start(s, "alice:s1", { kind: "connect", vendorId: "google" });
    const returnPath = await s.gatekeeperCompletes(ALICE, accountOf(body!.url), cookie, "g");
    const stranger = await finish(s, "", returnPath!);
    expect(stranger.headers.get("Location")).toBe("/#connect-error=other_tab");
    expect(s.kvs.get(ALICE)!.size()).toBe(0);
    expect((await finish(s, cookie, returnPath!)).headers.get("Location")).not.toContain("#connect=");
  });

  it("результат гейткипера без подтверждения браузера не принимается", async () => {
    const s = stand();
    const { body } = await start(s, "alice:s1", { kind: "connect", vendorId: "google" });
    expect(await s.flows(ALICE).settle(accountOf(body!.url), { account: "stolen" })).toBe(false);
    expect(JSON.stringify(s.kvs.get(ALICE)!.values())).not.toContain("stolen");
  });

  it("подтверждение браузера одноразовое", async () => {
    const s = stand();
    const { cookie, body } = await start(s, "alice:s1", { kind: "connect", vendorId: "google" });
    expect(await s.gatekeeperCompletes(ALICE, accountOf(body!.url), cookie, "g")).not.toBeNull();
    expect(await s.gatekeeperCompletes(ALICE, accountOf(body!.url), cookie, "g2")).toBeNull();
  });

  it("гейткипер подтвердил браузер, но вход у провайдера сорвался — возврат с причиной", async () => {
    const s = stand();
    const { cookie, body } = await start(s, "alice:s1", { kind: "connect", vendorId: "google", returnTo: "/x" });
    const confirmed = await confirmConnectBrowser(cookie.split("=")[1], ALICE, accountOf(body!.url), s.port);
    const back = await finish(s, cookie, confirmed!.returnPath);
    expect(back.headers.get("Location")).toBe("/x#connect-error=failed");
  });

  it("переподключение и расширение доступа тоже требуют браузер, начавший поток", async () => {
    for (const kind of ["reconnect", "resources"] as const) {
      const s = stand();
      const mallory = await start(s, "mallory:s2", { kind, accountId: 7, resourceUrlPatterns: kind === "resources" ? ["gmail://*"] : undefined });
      expect(mallory.response.status, kind).toBe(200);
      expect(await s.gatekeeperCompletes(MALLORY, 7, "", "victim"), kind).toBeNull();
      // Поток на другой аккаунт того же пользователя тоже не подходит.
      expect(await s.gatekeeperCompletes(MALLORY, 8, mallory.cookie, "x"), kind).toBeNull();
      const own = await s.gatekeeperCompletes(MALLORY, 7, mallory.cookie, "mallory");
      expect(own, kind).not.toBeNull();
      const code = codeOf(await finish(s, mallory.cookie, own!));
      expect(await redeemConnectCode(mallory.cookie, true, MALLORY, code, s.port), kind).toEqual({ kind, vendorId: undefined, accountId: 7 });
    }
  });

  it("старт: без ключа сеанса, с чужой страницы, не POST, чужой returnTo — отказ без cookie", async () => {
    const s = stand();
    for (const [token, body, origin] of [
      ["nobody:x", { kind: "connect", vendorId: "google" }, ORIGIN],
      ["alice:s1", { kind: "connect", vendorId: "google" }, "https://evil.example"],
      ["alice:s1", { kind: "connect", vendorId: "google", returnTo: "//evil.example/x" }, ORIGIN],
      ["alice:s1", { kind: "connect", vendorId: "google", returnTo: "/.//evil.example" }, ORIGIN],
      ["alice:s1", { kind: "connect" }, ORIGIN],
      ["alice:s1", { kind: "reconnect" }, ORIGIN],
      ["alice:s1", { kind: "other", vendorId: "google" }, ORIGIN],
    ] as const) {
      const { response } = await start(s, token, body as Record<string, unknown>, origin);
      expect(response.status, JSON.stringify(body) + origin).toBeGreaterThanOrEqual(400);
      expect(response.headers.get("Set-Cookie")).toBeNull();
    }
    const get = await handleConnectStart(new Request(`${ORIGIN}/api/connect/start`), s.port);
    expect(get.status).toBe(405);
    expect(s.vendorCalls).toEqual([]);
  });

  it("код и секреты хранятся только хешами", async () => {
    const s = stand();
    const { cookie, body } = await start(s, "alice:s1", { kind: "connect", vendorId: "google" });
    const returnPath = await s.gatekeeperCompletes(ALICE, accountOf(body!.url), cookie, "g");
    const code = codeOf(await finish(s, cookie, returnPath!));
    const stored = JSON.stringify(s.kvs.get(ALICE)!.values());
    for (const secret of [code, cookie.split(".")[2], returnPath!.split(".")[2]]) expect(stored).not.toContain(secret);
  });
});
