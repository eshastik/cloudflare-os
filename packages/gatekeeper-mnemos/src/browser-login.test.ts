import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserLoginBinding, FINISH_SCRIPT, finishScriptHash, handleBrowserLogin } from "./browser-login.ts";
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
