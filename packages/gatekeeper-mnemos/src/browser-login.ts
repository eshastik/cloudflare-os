import type { AccountStorage } from "./account-session.ts";

const KEY = "mnemosBrowserLogin";
interface BrowserLogin { nonce: string; phase: "initiation" | "browser"; deadline: number }
export function loginNonce(): string { return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""); }

/** Binds a trusted connector initiation to the browser returning from the provider. */
export class BrowserLoginBinding {
  private storage: AccountStorage;
  constructor(storage: AccountStorage) { this.storage = storage; }
  prepare(): string {
    const nonce = loginNonce();
    this.storage.put<BrowserLogin>(KEY, { nonce, phase: "initiation", deadline: Date.now() + 300000 });
    return nonce;
  }
  check(nonce: string, phase: BrowserLogin["phase"] = "initiation"): void {
    const saved = this.storage.get<BrowserLogin>(KEY);
    if (typeof nonce !== "string" || !/^[a-f0-9]{64}$/.test(nonce) || !saved || saved.phase !== phase || saved.nonce !== nonce || saved.deadline <= Date.now()) throw new Error("Mnemos login rejected");
  }
  #consume(nonce: string, phase: BrowserLogin["phase"]): void { this.check(nonce,phase);this.storage.delete(KEY); }
  start(nonce: string): string {
    this.#consume(nonce, "initiation");
    const browserNonce = loginNonce();
    this.storage.put<BrowserLogin>(KEY, { nonce: browserNonce, phase: "browser", deadline: Date.now() + 300000 });
    return browserNonce;
  }
  complete(nonce: string): void { this.#consume(nonce, "browser"); }
  cancel(): void { this.storage.delete(KEY); }
}

const COOKIE = "__Host-mnemos-login";
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'", "X-Content-Type-Options": "nosniff" };
const clearCookie = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
/** Minimal trusted account port; the HTTP boundary never accepts credentials or identity. */
export interface BrowserLoginAccount {
  loginOrganizations?(nonce: string): Promise<{id:string;name:string}[]>;
  startBrowserLogin(nonce: string, profile?: string): Promise<{ url: string; browserNonce: string }>;
  completeBrowserLogin(nonce: string, state: string, code: string): Promise<void>;
}

/** Only the configured callback origin/path and nonce-bearing initiation route exist. */
export async function handleBrowserLogin(request: Request, callbackUrl: string, account: (id: string) => BrowserLoginAccount): Promise<Response> {
  const reject = (status: number) => new Response("Вход не завершён. Вернитесь в CloudflareOS и повторите подключение.", { status, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
  let callback: URL;
  try { callback = new URL(callbackUrl); } catch { return reject(404); }
  const url = new URL(request.url);
  if (callback.protocol !== "https:" || callback.username || callback.password || callback.hash || callback.search || url.origin !== callback.origin) return reject(404);
  if (request.method !== "GET") return reject(405);
  try {
    const prefix = callback.pathname + "/start/";
    if (url.pathname.startsWith(prefix)) {
      if ([...url.searchParams.keys()].some(k=>k!=="organization") || url.searchParams.getAll("organization").length>1) return reject(400);
      const parts = url.pathname.slice(prefix.length).split("/");
      if (parts.length !== 2 || parts.some(part => !/^[a-f0-9]{64}$/.test(part))) return reject(404);
      const target=account(parts[0]);
      const profile=url.searchParams.get('organization')??undefined;
      if(profile!==undefined&&!/^[a-z][a-z0-9_-]{0,63}$/.test(profile))return reject(400);
      if(profile===undefined && target.loginOrganizations){
        const choices=await target.loginOrganizations(parts[1]);
        if(choices.length===0)return reject(403);
        if(choices.length>1){
          const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
          const links=choices.map(c=>`<li><a href="${escape(url.pathname)}?organization=${encodeURIComponent(c.id)}">${escape(c.name)}</a></li>`).join('');
          return new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Организация Mnemos</title><h1>Выберите организацию</h1><ul>${links}</ul></html>`,{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
        }
      }
      const result = await target.startBrowserLogin(parts[1],profile);
      if (!/^[a-f0-9]{64}$/.test(result.browserNonce)) return reject(403);
      const destination = new URL(result.url);
      if (destination.protocol !== "https:" || destination.username || destination.password) return reject(403);
      return new Response(null, { status: 302, headers: { ...headers, Location: destination.href,
        "Set-Cookie": `${COOKIE}=${parts[0]}.${result.browserNonce}; Path=/; Max-Age=300; HttpOnly; Secure; SameSite=Lax` } });
    }
    if (url.pathname !== callback.pathname) return reject(404);
    const cookies = (request.headers.get("Cookie") ?? "").split(";").map(item => item.trim()).filter(item => item.startsWith(COOKIE + "="));
    if (cookies.length !== 1) return reject(403);
    const binding = cookies[0].slice(COOKIE.length + 1).split(".");
    if (binding.length !== 2 || binding.some(part => !/^[a-f0-9]{64}$/.test(part))) return reject(403);
    if ([...url.searchParams.keys()].some(key => key !== "state" && key !== "code") || url.searchParams.getAll("state").length !== 1 || url.searchParams.getAll("code").length !== 1) return reject(400);
    const state = url.searchParams.get("state")!, code = url.searchParams.get("code")!;
    if (!state || state.length > 512 || !code || code.length > 8192) return reject(400);
    await account(binding[0]).completeBrowserLogin(binding[1], state, code);
    return new Response("Личность подтверждена в Mnemos. Вернитесь в CloudflareOS.", { headers: { ...headers, "Content-Type": "text/plain; charset=utf-8", "Set-Cookie": clearCookie } });
  } catch { return reject(403); }
}
