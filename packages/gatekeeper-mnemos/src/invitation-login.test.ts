import { test } from "node:test";
import assert from "node:assert/strict";
import { LoginFlow, verifiedEmail, type LoginConfig } from "./login-flow.ts";
import { handleBrowserLogin } from "./browser-login.ts";
import type { AccountStorage } from "./account-session.ts";

function storage(): AccountStorage {
  const map = new Map<string, unknown>();
  return { get: <T>(key: string) => map.get(key) as T | undefined, put: (key, value) => { map.set(key, value); }, delete: key => { map.delete(key); } };
}
const config: LoginConfig = { iamOrigin: "https://iam.example", authorizationEndpoint: "https://iam.example/signin/authorize", tokenEndpoint: "https://iam.example/signin/token", clientId: "cloudflare", clientSecret: "provider-secret", iamClientSecret: "s".repeat(40), callbackUrl: "https://os.example/gatekeeper/mnemos/oauth" };
const code = "c".repeat(43);
const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const idToken = (claims: Record<string, unknown>) => `${part({ alg: "RS256" })}.${part(claims)}.signature`;

test("вход по приглашению: код уходит странице входа Mnemos и в обмен IAM, обычный вход — без кода", async () => {
  for (const invitation of [code, undefined]) {
    let sent: Record<string, unknown> | undefined;
    const fetcher: typeof fetch = async (url, init) => {
      if (String(url) === config.iamOrigin + "/v1/session/request") return Response.json({ state: "state", nonce: "nonce", expires_in_ms: 300000 });
      if (String(url) === config.tokenEndpoint) return Response.json({ id_token: idToken({ email: "Anna@Example.RU", email_verified: true }) });
      sent = JSON.parse(String(init?.body));
      return Response.json({ access_token: "mnemos", token_type: "Bearer", expires_in: 60 });
    };
    const flow = new LoginFlow(storage(), config, fetcher);
    const url = new URL(await flow.begin(invitation));
    assert.equal(url.searchParams.get("invitation"), invitation ?? null);
    assert.equal(url.searchParams.get("scope"), "openid email");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const result = await flow.complete("state", "provider-code");
    assert.equal(sent?.invitation, invitation);
    assert.equal(result.email, "anna@example.ru", "почта приводится к нижнему регистру");
  }
  await assert.rejects(new LoginFlow(storage(), config, fetch).begin("короткий"));
});

test("почта не берётся из токена, который IAM отверг, и из токена без подтверждения", async () => {
  const flow = new LoginFlow(storage(), config, async url => {
    if (String(url).endsWith("/v1/session/request")) return Response.json({ state: "state", nonce: "nonce", expires_in_ms: 300000 });
    if (String(url) === config.tokenEndpoint) return Response.json({ id_token: idToken({ email: "anna@example.ru", email_verified: true }) });
    return new Response(null, { status: 403 });
  });
  await flow.begin();
  await assert.rejects(flow.complete("state", "provider-code"));
  assert.equal(verifiedEmail(idToken({ email: "anna@example.ru" })), undefined);
  assert.equal(verifiedEmail(idToken({ email: "anna@example.ru", email_verified: "true" })), undefined);
  assert.equal(verifiedEmail(idToken({ email: "не почта", email_verified: true })), undefined);
  assert.equal(verifiedEmail(idToken({ email: "a".repeat(250) + "@example.ru", email_verified: true })), undefined);
  assert.equal(verifiedEmail("not-a-token"), undefined);
  assert.equal(verifiedEmail(idToken({ email: " Anna@Example.ru ", email_verified: true })), "anna@example.ru");
});

test("ссылка-приглашение ведёт на экран входа оболочки с меткой #invite, код — только в HttpOnly-cookie; после входа код стирается", async () => {
  const account = { invitation: "" as string | undefined, profile: "" as string | undefined,
    async startBrowserLogin(_nonce: string, profile?: string, invitation?: string) { this.profile = profile; this.invitation = invitation; return { url: "https://iam.example/signin/authorize", browserNonce: "b".repeat(64) }; },
    async completeBrowserLogin() {} };
  const invite = await handleBrowserLogin(new Request(`${config.callbackUrl}/invite/${code}?organization=second`), config.callbackUrl, () => account);
  assert.equal(invite.status, 303);
  assert.equal(invite.headers.get("Location"), "https://os.example/gatekeepers/mnemos#invite");
  assert.ok(!invite.headers.get("Location")!.includes(code), "код не попадает в адрес оболочки");
  assert.equal(invite.headers.get("Referrer-Policy"), "no-referrer");
  const cookie = invite.headers.get("Set-Cookie")!;
  assert.match(cookie, /^__Host-mnemos-invite=c{43}\.second; Path=\/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax$/);
  assert.equal((await handleBrowserLogin(new Request(`${config.callbackUrl}/invite/short`), config.callbackUrl, () => account)).status, 404);

  // Вход оболочки через Mnemos открывает окно start/… — оно и подхватывает код приглашения.
  const start = await handleBrowserLogin(new Request(`${config.callbackUrl}/start/${"a".repeat(64)}/${"d".repeat(64)}`, { headers: { Cookie: cookie.split(";")[0] } }), config.callbackUrl, () => account);
  assert.equal(start.status, 302);
  assert.equal(account.invitation, code);
  assert.equal(account.profile, "second");

  const done = await handleBrowserLogin(new Request(`${config.callbackUrl}?state=s&code=c`, { headers: { Cookie: `__Host-mnemos-login=${"a".repeat(64)}.${"b".repeat(64)}; ${cookie.split(";")[0]}` } }), config.callbackUrl, () => account);
  assert.equal(done.status, 200);
  assert.ok(done.headers.getSetCookie().some(value => value.startsWith("__Host-mnemos-invite=;")), "код стирается после входа");
});
