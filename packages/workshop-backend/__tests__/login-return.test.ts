import { describe, expect, it } from "vitest";
import {
  LOGIN_CODE_TTL_MS, LOGIN_COOKIE, LOGIN_FINISH_PATH, PendingLoginState, handleLoginFinish, handleLoginStart,
  parseReturnTo, redeemLoginCode, type LoginPort, type PendingLoginPort,
} from "../src/auth/login-return.js";

// Вход на той же странице: /api/login/start уводит браузер к гейткиперу, гейткипер возвращает его
// на /api/login/finish, тот — на исходный адрес с одноразовым кодом, код меняется на ключ сеанса.

const ORIGIN = "https://os.example";
const TOKEN = "anna@example.ru:session-secret";

function memoryKv() {
  const map = new Map<string, unknown>();
  return {
    get: <T>(key: string) => map.get(key) as T | undefined,
    put: (key: string, value: unknown) => { map.set(key, value); },
    delete: (key: string) => map.delete(key),
    deleteAll: () => map.clear(),
    size: () => map.size,
    values: () => [...map.values()],
  };
}

// Стенд: набор ожидающих входов в памяти, часы подаются тестом; гейткипер — подставной.
function stand(options: { vendorAllowed?: boolean } = {}) {
  let clock = 1_000_000;
  const logins = new Map<string, PendingLoginState>();
  const kvs = new Map<string, ReturnType<typeof memoryKv>>();
  const connects: { vendorId: string; pendingId: string; returnPath: string }[] = [];
  let next = 0;
  const port: LoginPort = {
    create() {
      const id = (++next).toString(16).padStart(64, "0");
      const kv = memoryKv();
      kvs.set(id, kv);
      logins.set(id, new PendingLoginState(kv, () => clock));
      return { id, stub: logins.get(id)! as PendingLoginPort };
    },
    get: id => logins.get(id) ?? null,
    async connect(vendorId, pendingId, returnPath) {
      if (options.vendorAllowed === false) throw new Error(`Sign-in via "${vendorId}" is not enabled on this deployment.`);
      connects.push({ vendorId, pendingId, returnPath });
      return `${ORIGIN}/gatekeeper/${vendorId}/oauth/start/${"a".repeat(64)}/${"b".repeat(64)}`;
    },
  };
  return {
    port, connects, logins, kvs,
    tick(ms: number) { clock += ms; },
    // Гейткипер завершил вход и передал результат через обратный вызов оболочки; одноразовый
    // признак результата гейткипер отдаёт браузеру, прошедшему вход, в адресе возврата.
    handles: new Map<string, string>(),
    async deliver(pendingId: string, token = TOKEN) {
      const handle = `${pendingId}.${await logins.get(pendingId)!.deliver(token)}`;
      this.handles.set(pendingId, handle);
      return handle;
    },
  };
}

const cookieOf = (response: Response) => response.headers.get("Set-Cookie")!.split(";")[0];

async function startLogin(s: ReturnType<typeof stand>, returnTo = "/gatekeepers/mnemos") {
  const response = await handleLoginStart(new Request(`${ORIGIN}/api/login/start?vendor=mnemos&return_to=${encodeURIComponent(returnTo)}`), s.port);
  return { response, cookie: response.status === 302 ? cookieOf(response) : "" };
}

// Возврат браузера от гейткипера. По умолчанию — с признаком результата этого входа.
async function finish(s: ReturnType<typeof stand>, cookie: string, handle: string | null = pendingOf(cookie) ? s.handles.get(pendingOf(cookie))! : null) {
  const query = handle ? `?handle=${encodeURIComponent(handle)}` : "";
  return handleLoginFinish(new Request(`${ORIGIN}${LOGIN_FINISH_PATH}${query}`, { headers: cookie ? { Cookie: cookie } : {} }), s.port);
}
const pendingOf = (cookie: string) => cookie.split("=")[1]?.split(".")[0] ?? "";

const codeOf = (response: Response) => new URL(response.headers.get("Location")!, ORIGIN).hash.replace(/^#login=/, "");

describe("вход на той же странице", () => {
  it("полный цикл: уход к гейткиперу, возврат с кодом, обмен кода на ключ сеанса", async () => {
    const s = stand();
    const { response, cookie } = await startLogin(s, "/gatekeepers/mnemos?tab=1");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${ORIGIN}/gatekeeper/mnemos/oauth/start/${"a".repeat(64)}/${"b".repeat(64)}`);
    const setCookie = response.headers.get("Set-Cookie")!;
    expect(setCookie).toMatch(new RegExp(`^${LOGIN_COOKIE}=[0-9a-f]{64}\\.[0-9a-f]{64}; Path=/; Max-Age=\\d+; HttpOnly; Secure; SameSite=Lax$`));
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    // Гейткиперу сказано вернуть браузер на путь завершения оболочки, а не закрыть окно.
    expect(s.connects).toEqual([{ vendorId: "mnemos", pendingId: cookie.split("=")[1].split(".")[0], returnPath: LOGIN_FINISH_PATH }]);

    await s.deliver(s.connects[0].pendingId);
    const back = await finish(s, cookie);
    expect(back.status).toBe(303);
    const location = back.headers.get("Location")!;
    expect(location).toMatch(/^\/gatekeepers\/mnemos\?tab=1#login=[A-Za-z0-9_-]{43}$/);
    expect(location).not.toContain(TOKEN.split(":")[1]);
    expect(back.headers.get("Referrer-Policy")).toBe("no-referrer");

    expect(await redeemLoginCode(cookie, codeOf(back), s.port)).toBe(TOKEN);
    // Ни ключ сеанса, ни код в открытом виде на сервере не лежат после обмена.
    expect(s.kvs.get(s.connects[0].pendingId)!.size()).toBe(0);
  });

  it("код и секрет браузера хранятся на сервере только хешами", async () => {
    const s = stand();
    const { cookie } = await startLogin(s);
    await s.deliver(s.connects[0].pendingId);
    const code = codeOf(await finish(s, cookie));
    const stored = JSON.stringify(s.kvs.get(s.connects[0].pendingId)!.values());
    expect(stored).not.toContain(code);
    expect(stored).not.toContain(cookie.split(".")[1]);
  });

  it("повторный обмен того же кода — отказ", async () => {
    const s = stand();
    const { cookie } = await startLogin(s);
    await s.deliver(s.connects[0].pendingId);
    const code = codeOf(await finish(s, cookie));
    expect(await redeemLoginCode(cookie, code, s.port)).toBe(TOKEN);
    await expect(redeemLoginCode(cookie, code, s.port)).rejects.toThrow(/устарела или открыта в другом браузере/);
  });

  it("код из другого браузера (без cookie или с чужой cookie) — отказ, а свой браузер потом входит", async () => {
    const s = stand();
    const { cookie } = await startLogin(s);
    await s.deliver(s.connects[0].pendingId);
    const code = codeOf(await finish(s, cookie));
    await expect(redeemLoginCode(null, code, s.port)).rejects.toThrow(/устарела или открыта в другом браузере/);
    await expect(redeemLoginCode("", code, s.port)).rejects.toThrow(/устарела или открыта в другом браузере/);
    const other = await startLogin(s);
    await expect(redeemLoginCode(other.cookie, code, s.port)).rejects.toThrow(/устарела или открыта в другом браузере/);
    // Тот же вход, но секрет браузера подделан.
    const [pending] = cookie.split(".");
    await expect(redeemLoginCode(`${pending}.${"f".repeat(64)}`, code, s.port)).rejects.toThrow(/устарела или открыта в другом браузере/);
    expect(await redeemLoginCode(cookie, code, s.port)).toBe(TOKEN);
  });

  it("неверный код в своём браузере — отказ, верный после этого срабатывает", async () => {
    const s = stand();
    const { cookie } = await startLogin(s);
    await s.deliver(s.connects[0].pendingId);
    const code = codeOf(await finish(s, cookie));
    await expect(redeemLoginCode(cookie, "x".repeat(43), s.port)).rejects.toThrow(/устарела или открыта в другом браузере/);
    expect(await redeemLoginCode(cookie, code, s.port)).toBe(TOKEN);
  });

  it("истёкший код — отказ", async () => {
    const s = stand();
    const { cookie } = await startLogin(s);
    await s.deliver(s.connects[0].pendingId);
    const code = codeOf(await finish(s, cookie));
    s.tick(LOGIN_CODE_TTL_MS);
    await expect(redeemLoginCode(cookie, code, s.port)).rejects.toThrow(/устарела или открыта в другом браузере/);
  });

  it("срок кода — от 60 до 120 секунд", () => {
    expect(LOGIN_CODE_TTL_MS).toBeGreaterThanOrEqual(60_000);
    expect(LOGIN_CODE_TTL_MS).toBeLessThanOrEqual(120_000);
  });

  it("return_to на чужой домен и прочие не-пути — отказ до обращения к гейткиперу", async () => {
    for (const bad of ["https://evil.example/", "//evil.example/x", "/\\evil.example", "\\\\evil.example", "javascript:alert(1)",
      "gatekeepers", "", "/a\nb", "/%0d%0aSet-Cookie:x", "/a#login=x",
      // Точечные сегменты: после нормализации путь начинался бы с «//» — чужой сайт.
      "/.//evil.com/x", "/..//evil.com", "/a/..//evil.com", "/%2e%2e//evil.com", "/%2E//evil.com", "/.%2e//evil.com",
      "/a/./b", "/a/../b", "/a//b", "/a/%2e%2e/b", "/a/.%2E/b", "/%2fevil.com", "/%5cevil.com"]) {
      expect(parseReturnTo(bad), bad).toBeNull();
      const s = stand();
      const { response } = await startLogin(s, bad);
      expect(response.status, bad).toBe(400);
      expect(response.headers.get("Set-Cookie"), bad).toBeNull();
      expect(s.connects, bad).toEqual([]);
    }
    const s = stand();
    expect((await handleLoginStart(new Request(`${ORIGIN}/api/login/start?vendor=mnemos`), s.port)).status).toBe(400);
    expect(parseReturnTo("/")).toBe("/");
    expect(parseReturnTo("/gatekeepers/mnemos?x=1")).toBe("/gatekeepers/mnemos?x=1");
  });

  it("гейткипер, не разрешённый для входа, — отказ без cookie", async () => {
    const s = stand({ vendorAllowed: false });
    const { response } = await startLogin(s);
    expect(response.status).toBe(403);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("неуспешный вход возвращает на исходный адрес с причиной, а не с кодом", async () => {
    const s = stand();
    const { cookie } = await startLogin(s, "/x");
    s.handles.set(s.connects[0].pendingId, `${s.connects[0].pendingId}.${await s.logins.get(s.connects[0].pendingId)!.fail("signups_disabled")}`);
    const back = await finish(s, cookie);
    expect(back.status).toBe(303);
    expect(back.headers.get("Location")).toBe("/x#login-error=signups_disabled");
  });

  it("возврат без cookie браузера — на главную с причиной, кода нет", async () => {
    const s = stand();
    const back = await finish(s, "");
    expect(back.status).toBe(303);
    expect(back.headers.get("Location")).toBe("/#login-error=failed");
  });

  it("пересланный адрес гейткипера: вход жертвы не даёт злоумышленнику ключ", async () => {
    const s = stand();
    // Злоумышленник начал вход у себя (получил cookie), а адрес гейткипера переслал жертве.
    const attacker = await startLogin(s);
    const pendingId = s.connects[0].pendingId;
    // У жертвы уже есть сеанс Mnemos: вход проходит тихо, гейткипер кладёт её личность во вход
    // злоумышленника и возвращает браузер ЖЕРТВЫ с признаком результата.
    const handle = await s.deliver(pendingId, "victim@example.ru:victim-secret");
    const victim = await finish(s, "", handle);
    expect(victim.headers.get("Location")).toBe("/#login-error=other_tab");
    // Браузер жертвы без cookie этого входа гасит вход: злоумышленнику нечего забрать.
    expect(s.kvs.get(pendingId)!.size()).toBe(0);
    const stolen = await finish(s, attacker.cookie, null);
    expect(stolen.headers.get("Location")).not.toContain("#login=");
    const withHandle = await finish(s, attacker.cookie, handle);
    expect(withHandle.headers.get("Location")).not.toContain("#login=");
  });

  it("возврат без признака результата кода не даёт, даже с верной cookie", async () => {
    const s = stand();
    const { cookie } = await startLogin(s, "/x");
    await s.deliver(s.connects[0].pendingId);
    const back = await finish(s, cookie, null);
    expect(back.headers.get("Location")).toBe("/x#login-error=failed");
  });

  it("чужой признак результата с верной cookie — отказ", async () => {
    const s = stand();
    const { cookie } = await startLogin(s);
    const handle = await s.deliver(s.connects[0].pendingId);
    const forged = handle.split(".")[0] + "." + "A".repeat(43);
    expect((await finish(s, cookie, forged)).headers.get("Location")).not.toContain("#login=");
  });

  it("две вкладки: возврат в первую после входа во второй — понятная причина, вторая входит", async () => {
    const s = stand();
    const first = await startLogin(s);
    const second = await startLogin(s);   // cookie первой вкладки перезаписана
    const firstHandle = await s.deliver(s.connects[0].pendingId);
    const back = await finish(s, second.cookie, firstHandle);
    expect(back.headers.get("Location")).toBe("/#login-error=other_tab");
    await s.deliver(s.connects[1].pendingId);
    const ok = await finish(s, second.cookie);
    expect(await redeemLoginCode(second.cookie, codeOf(ok), s.port)).toBe(TOKEN);
    expect(first.cookie).not.toBe(second.cookie);
  });

  it("гейткипер сообщил о сбое входа — возврат на исходный адрес с причиной", async () => {
    const s = stand();
    const { cookie } = await startLogin(s, "/x");
    const back = await handleLoginFinish(new Request(`${ORIGIN}${LOGIN_FINISH_PATH}?error=failed`, { headers: { Cookie: cookie } }), s.port);
    expect(back.headers.get("Location")).toBe("/x#login-error=failed");
    expect(s.kvs.get(s.connects[0].pendingId)!.size()).toBe(0);
  });
});
