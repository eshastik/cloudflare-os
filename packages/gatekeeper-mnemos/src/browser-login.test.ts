import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserLoginBinding, FINISH_SCRIPT, completeWithShellBrowser, finishScriptHash, handleBrowserLogin } from "./browser-login.ts";
import type { AccountStorage } from "./account-session.ts";

function storage(): AccountStorage {
  const map = new Map<string, unknown>();
  return { get: <T>(key: string) => map.get(key) as T | undefined, put: (key, value) => { map.set(key, value); }, delete: key => { map.delete(key); } };
}

test("browser binding survives controller recreation and each stage is single use", () => {
  const kv = storage(), first = new BrowserLoginBinding(kv);
  const initiation = first.prepare();
  assert.throws(() => first.complete(initiation));
  const browser = first.start(initiation);
  assert.notEqual(browser, initiation);
  assert.throws(() => first.start(initiation));
  const resumed = new BrowserLoginBinding(kv);
  assert.throws(() => resumed.complete("f".repeat(64)));
  resumed.complete(browser);
  assert.throws(() => resumed.complete(browser));
  const next = resumed.prepare(); resumed.cancel();
  assert.throws(() => resumed.start(next));
});

test("HTTP callback requires the browser cookie and rejects ambiguous inputs before RPC", async () => {
  const callback = "https://connector.example/oauth", id = "a".repeat(64), init = "b".repeat(64), browser = "c".repeat(64);
  let starts = 0, completions = 0;
  const port = (accountId: string) => {
    assert.equal(accountId, id);
    return {
      async startBrowserLogin(nonce: string) { starts++; assert.equal(nonce, init); return { url: "https://provider.example/auth?state=state", browserNonce: browser }; },
      async completeBrowserLogin(nonce: string, state: string, code: string) { completions++; assert.deepEqual([nonce, state, code], [browser, "state", "code"]); },
    };
  };
  const start = await handleBrowserLogin(new Request(`${callback}/start/${id}/${init}`), callback, port);
  assert.equal(start.status, 302);
  const cookie = start.headers.get("Set-Cookie")!;
  for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) assert.ok(cookie.includes(flag));
  const stored = cookie.split(";")[0];
  const run = (url: string, cookie?: string, method = "GET") => handleBrowserLogin(new Request(url, { method, headers: cookie ? { Cookie: cookie } : {} }), callback, port);
  assert.equal((await run(`${callback}?state=state&code=code`)).status, 403);
  assert.equal((await run(`${callback}?state=state&code=code`, stored + "; " + stored)).status, 403);
  assert.equal((await run(`${callback}?state=state&state=other&code=code`, stored)).status, 400);
  assert.equal((await run(`${callback}?state=state&code=code&token=forged`, stored)).status, 400);
  assert.equal((await run(`${callback}?state=state&code=code`, stored, "POST")).status, 405);
  assert.equal(completions, 0);
  const done = await run(`${callback}?state=state&code=code`, stored);
  // Завершение — страница, которая закрывает окно входа (или ведёт в Mnemos, если окно открыто без opener);
  // её единственный скрипт разрешён только по хешу.
  assert.equal(done.status, 200); assert.equal(completions, 1); assert.equal(starts, 1);
  const page = await done.text();
  assert.ok(page.includes(`<script>${FINISH_SCRIPT}</script>`) && page.includes('href="/gatekeepers/mnemos"'));
  const hash = "sha256-" + Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(FINISH_SCRIPT))).toString("base64");
  assert.equal(await finishScriptHash(), hash);
  assert.ok(done.headers.get("Content-Security-Policy")!.startsWith(`default-src 'none'; script-src '${hash}';`));
  assert.ok(done.headers.get("Set-Cookie")!.includes("Max-Age=0"));
  assert.equal(done.headers.get("Referrer-Policy"), "no-referrer");
});

test("вход и подключение на той же странице: cookie оболочки уходят на подтверждение браузера, браузер возвращается в оболочку", async () => {
  const callback = "https://os.example/gatekeeper/mnemos/oauth", id = "a".repeat(64), browser = "c".repeat(64);
  const shellLogin = `${"e".repeat(64)}.${"f".repeat(64)}`, shellConnect = `${"1".repeat(64)}.${"2".repeat(32)}.${"3".repeat(64)}`;
  const cookie = `__Host-mnemos-login=${id}.${browser}; __Host-os-login=${shellLogin}; __Host-os-connect=${shellConnect}; other=secret`;
  const returnPath = `/api/login/finish?handle=${"e".repeat(64)}.${"H".repeat(43)}`;
  let seen: unknown;
  const port = (result: { returnPath?: string } | void) => () => ({
    async startBrowserLogin() { return { url: "https://provider.example/auth", browserNonce: browser }; },
    async completeBrowserLogin(_nonce: string, _state: string, _code: string, proof: unknown) { seen = proof; return result; },
  });
  const run = (result: { returnPath?: string } | void) => handleBrowserLogin(new Request(`${callback}?state=s&code=c`, { headers: { Cookie: cookie } }), callback, port(result));
  const done = await run({ returnPath });
  // Подтверждению браузера уходят только cookie оболочки, чужие — нет.
  assert.deepEqual(seen, { login: shellLogin, connect: shellConnect });
  assert.equal(done.status, 303);
  assert.equal(done.headers.get("Location"), `https://os.example${returnPath}`);
  assert.ok(done.headers.getSetCookie().some(value => value.startsWith("__Host-mnemos-login=;")), "cookie входа Mnemos стирается");
  assert.equal(done.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(await done.text(), "");
  // Путь возврата — только путь завершения оболочки; иначе прежняя страница завершения.
  for (const bad of ["https://evil.example/x", "//evil.example/x", "/api/login/finish", "/api/login/finish?handle=a b", "/x?handle=1"]) {
    const page = await run({ returnPath: bad });
    assert.equal(page.status, 200, bad);
    assert.equal(page.headers.get("Location"), null, bad);
  }
});

test("учётные данные записываются только после того, как оболочка подтвердила браузер", async () => {
  const proof = { connect: "x" };
  const shell = (answer: { returnPath: string } | null) => ({ calls: [] as unknown[], async confirmBrowser(p: unknown) { this.calls.push(p); return answer; } });
  const returnPath = `/api/connect/finish?handle=${"1".repeat(64)}.${"2".repeat(32)}.${"H".repeat(43)}`;
  // Пересланная ссылка: браузер не тот — ничего не записывается.
  let finished = 0;
  const refused = shell(null);
  await assert.rejects(completeWithShellBrowser(refused as never, proof, async () => { finished++; }));
  assert.equal(finished, 0);
  assert.deepEqual(refused.calls, [proof]);
  // Тот браузер: запись и возврат в оболочку.
  assert.deepEqual(await completeWithShellBrowser(shell({ returnPath }) as never, proof, async () => { finished++; }), { returnPath });
  assert.equal(finished, 1);
  // Сбой после подтверждения — браузер всё равно возвращается в оболочку, она покажет причину.
  assert.deepEqual(await completeWithShellBrowser(shell({ returnPath }) as never, proof, async () => { throw new Error("IAM"); }), { returnPath });
  // Без обратного вызова оболочки (старое подключение) — как прежде.
  assert.deepEqual(await completeWithShellBrowser(undefined, proof, async () => { finished++; }), {});
  await assert.rejects(completeWithShellBrowser(undefined, proof, async () => { throw new Error("IAM"); }));
});
