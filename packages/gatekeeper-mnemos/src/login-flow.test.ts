import { test } from "node:test";
import assert from "node:assert/strict";
import { LoginFlow, type LoginConfig } from "./login-flow.ts";
import type { AccountStorage } from "./account-session.ts";
function storage(): AccountStorage {
  const map = new Map<string, unknown>();
  return { get: <T>(key: string) => map.get(key) as T | undefined, put: (key, value) => { map.set(key, value); }, delete: key => { map.delete(key); } };
}
const config: LoginConfig = { iamOrigin: "https://iam.example", authorizationEndpoint: "https://provider.example/auth", tokenEndpoint: "https://provider.example/token", clientId: "cloudflare", clientSecret: "provider-secret", iamClientSecret: "s".repeat(40), callbackUrl: "https://gatekeeper.example/account/callback" };

test("persisted login carries PKCE and server secrets never enter the browser URL", async () => {
  const kv = storage(); let challenge = "", calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++; assert.equal(init?.redirect, "manual");
    switch (String(url)) {
      case config.iamOrigin + "/v1/session/request": return Response.json({ state: "state", nonce: "nonce", expires_in_ms: 300000 });
      case config.tokenEndpoint: {
        const form = new URLSearchParams(String(init?.body));
        const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(form.get("code_verifier")!)));
        const actual = Buffer.from(hash).toString("base64url"); assert.equal(actual, challenge);
        assert.equal(form.get("code"), "code"); assert.equal(form.get("redirect_uri"), config.callbackUrl);
        assert.equal(new Headers(init?.headers).get("Authorization"), "Basic " + btoa("cloudflare:provider-secret"));
        return Response.json({ id_token: "provider-proof" });
      }
      case config.iamOrigin + "/v1/session/credential":
        assert.deepEqual(JSON.parse(String(init?.body)), { state: "state", id_token: "provider-proof" });
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer " + config.iamClientSecret);
        return Response.json({ access_token: "human-token", token_type: "Bearer", expires_in: 900 });
      default: throw new Error("unexpected destination");
    }
  };
  const start = new LoginFlow(kv, config, fetcher);
  const url = new URL(await start.begin()); challenge = url.searchParams.get("code_challenge")!;
  assert.equal(url.searchParams.get("nonce"), "nonce"); assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(!url.href.includes(config.clientSecret) && !url.href.includes(config.iamClientSecret));
  const resumed = new LoginFlow(kv, config, fetcher);
  await assert.rejects(resumed.complete("wrong-state", "code"));
  const result = await resumed.complete("state", "code"); assert.equal(result.token, "human-token");
  await assert.rejects(resumed.complete("state", "code")); assert.equal(calls, 3);
});

test("cancel during code exchange suppresses the result and concurrent replay never exchanges twice", async () => {
  const kv = storage(); let finish!: (response: Response) => void, exchanges = 0;
  const flow = new LoginFlow(kv, config, async (url) => {
    if (String(url).endsWith("/request")) return Response.json({ state: "state", nonce: "nonce", expires_in_ms: 300000 });
    exchanges++; return new Promise(resolve => { finish = resolve; });
  });
  await flow.begin();
  const first = flow.complete("state", "code");
  await assert.rejects(flow.complete("state", "code"));
  flow.cancel(); finish(Response.json({ id_token: "private-proof" }));
  await assert.rejects(first); assert.equal(exchanges, 1);
});

test("cancel during start cannot resurrect a callback and insecure configuration is rejected", async () => {
  let finish!: (response: Response) => void;
  const flow = new LoginFlow(storage(), config, async () => new Promise(resolve => { finish = resolve; }));
  const started = flow.begin(); flow.cancel();
  finish(Response.json({ state: "state", nonce: "nonce", expires_in_ms: 300000 }));
  await assert.rejects(started); await assert.rejects(flow.complete("state", "code"));
  for (const patch of [{ tokenEndpoint: "http://provider.example/token" }, { callbackUrl: "https://user:pass@gatekeeper.example/callback" }, { iamOrigin: "https://iam.example/prefix" }]) assert.throws(() => new LoginFlow(storage(), { ...config, ...patch }));
});

test("login rejects redirects without forwarding provider or IAM secrets", async () => {
  for (const status of [301, 302, 307, 308]) {
    let calls = 0;
    const flow = new LoginFlow(storage(), config, async (_url, init) => {
      calls++;
      assert.equal(init?.redirect, "manual");
      return new Response(null, { status, headers: { Location: "https://foreign.example" } });
    });
    await assert.rejects(flow.begin(), /Mnemos login failed/);
    assert.equal(calls, 1);
  }
});
