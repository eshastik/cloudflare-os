import { HUMAN_SESSION_MS } from "./human-session.ts";
import type { AccountStorage } from "./account-session.ts";

/** Operator configuration. Never construct this from callback query parameters. */
export interface LoginConfig {
  iamOrigin: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  iamClientSecret: string;
  callbackUrl: string;
}
interface PendingLogin { generation: string; phase: "starting" | "waiting" | "consuming" | "finished"; deadline: number; state?: string; verifier?: string; invitation?: string }
/** Код одноразовой ссылки-приглашения: 32 случайных байта в base64url. */
export const INVITATION_CODE = /^[A-Za-z0-9_-]{43}$/;
const KEY = "mnemosLogin";
const failure = () => new Error("Mnemos login failed");
function https(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) throw failure();
  return url;
}
function base64url(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/;
/** Подтверждённая почта из полезной нагрузки ID-токена или undefined. */
export function verifiedEmail(idToken: string): string | undefined {
  try {
    const part = idToken.split(".")[1] ?? "";
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(atob(part.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0)));
    const claims = JSON.parse(text);
    if (claims?.email_verified !== true || typeof claims.email !== "string") return undefined;
    const email = claims.email.trim().toLowerCase();
    return email.length <= 254 && EMAIL.test(email) ? email : undefined;
  } catch { return undefined; }
}
function formComponent(value: string): string { return new URLSearchParams({ v: value }).toString().slice(2); }

/** Internal DO controller. The owning account retains its trusted Workshop callback
 * separately; no method of this controller is forwarded to the app's ui capability. */
export class LoginFlow {
  #storage: AccountStorage;
  #config: Readonly<LoginConfig>;
  #fetch: typeof fetch;
  constructor(storage: AccountStorage, config: LoginConfig, fetcher: typeof fetch = fetch) {
    if (https(config.iamOrigin).origin !== config.iamOrigin) throw failure();
    https(config.authorizationEndpoint); https(config.tokenEndpoint); https(config.callbackUrl);
    if (!config.clientId || !config.clientSecret || config.iamClientSecret.length < 32) throw failure();
    this.#storage = storage; this.#config = Object.freeze({ ...config }); this.#fetch = fetcher.bind(globalThis);
  }
  #check(generation: string, phase: PendingLogin["phase"]): PendingLogin {
    const pending = this.#storage.get<PendingLogin>(KEY);
    if (!pending || pending.generation !== generation || pending.phase !== phase || pending.deadline <= Date.now()) throw failure();
    return pending;
  }
  async #json(url: string, init: RequestInit): Promise<any> {
    try {
      const response = await this.#fetch(url, { ...init, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw failure(); }
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 131072) throw failure(); chunks.push(value); }
      } finally { await reader.cancel(); reader.releaseLock(); }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    } catch { throw failure(); }
  }
  /** invitation — код ссылки-приглашения; при первом входе он заводит человека в организации. */
  async begin(invitation?: string): Promise<string> {
    if (invitation !== undefined && !INVITATION_CODE.test(invitation)) throw failure();
    const old = this.#storage.get<PendingLogin>(KEY);
    if (old && old.phase !== "finished" && old.deadline > Date.now()) throw failure();
    const generation = crypto.randomUUID(); const started = Date.now();
    this.#storage.put(KEY, { generation, phase: "starting", deadline: started + 300000 });
    try {
      const issued = await this.#json(this.#config.iamOrigin + "/v1/session/request", { method: "POST" });
      this.#check(generation, "starting");
      if (typeof issued.state !== "string" || !issued.state || issued.state.length > 512 || typeof issued.nonce !== "string" || !issued.nonce || issued.nonce.length > 512 || !Number.isInteger(issued.expires_in_ms) || issued.expires_in_ms <= 0 || issued.expires_in_ms > 300000) throw failure();
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      this.#check(generation, "starting");
      const pending: PendingLogin = { generation, phase: "waiting", deadline: started + issued.expires_in_ms, state: issued.state, verifier, ...(invitation ? { invitation } : {}) };
      if (pending.deadline <= Date.now()) throw failure();
      this.#storage.put(KEY, pending);
      const url = new URL(this.#config.authorizationEndpoint);
      // Провайдер входа — сам Mnemos: код приглашения нужен его странице входа, чтобы показать,
      // кто и куда приглашает, и подставить почту из приглашения.
      url.search = new URLSearchParams({ response_type: "code", client_id: this.#config.clientId, redirect_uri: this.#config.callbackUrl, scope: "openid email", state: issued.state, nonce: issued.nonce, code_challenge: challenge, code_challenge_method: "S256", ...(invitation ? { invitation } : {}) }).toString();
      return url.href;
    } catch { this.#finish(generation); throw failure(); }
  }
  /** email — подтверждённая почта из ID-токена; есть, только если провайдер её выдал. */
  async complete(state: string, code: string): Promise<{ token: string; expiresAt: number; email?: string }> {
    const pending = this.#storage.get<PendingLogin>(KEY);
    if (!pending || typeof state !== "string" || state !== pending.state || typeof code !== "string" || !code || code.length > 8192) throw failure();
    this.#check(pending.generation, "waiting");
    this.#storage.put(KEY, { ...pending, phase: "consuming" });
    try {
      const provider = await this.#json(this.#config.tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(formComponent(this.#config.clientId) + ":" + formComponent(this.#config.clientSecret)) }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: this.#config.callbackUrl, code_verifier: pending.verifier! }).toString() });
      this.#check(pending.generation, "consuming");
      if (typeof provider.id_token !== "string" || !provider.id_token || provider.id_token.length > 65536) throw failure();
      const started = Date.now();
      const credential = await this.#json(this.#config.iamOrigin + "/v1/session/credential", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + this.#config.iamClientSecret }, body: JSON.stringify({ state: pending.state, id_token: provider.id_token, ...(pending.invitation ? { invitation: pending.invitation } : {}) }) });
      this.#check(pending.generation, "consuming");
      if (typeof credential.access_token !== "string" || !credential.access_token || /\s/.test(credential.access_token) || credential.token_type !== "Bearer" || !Number.isInteger(credential.expires_in) || credential.expires_in <= 0 || credential.expires_in > HUMAN_SESSION_MS / 1000) throw failure();
      // Почту читаем только после того, как IAM принял этот же токен (подпись, издатель, nonce):
      // сам мост подпись не проверяет, а токен получен им напрямую с адреса выдачи по TLS.
      const email = verifiedEmail(provider.id_token);
      return { token: credential.access_token, expiresAt: started + credential.expires_in * 1000, ...(email ? { email } : {}) };
    } finally { this.#finish(pending.generation); }
  }
  #finish(generation: string): void {
    if (this.#storage.get<PendingLogin>(KEY)?.generation === generation) this.#storage.put(KEY, { generation, phase: "finished", deadline: 0 });
  }
  static cancelStored(storage: AccountStorage): void { storage.put(KEY, { generation: crypto.randomUUID(), phase: "finished", deadline: 0 }); }
  cancel(): void { LoginFlow.cancelStored(this.#storage); }
}
