// Вход через гейткипер на той же странице.
//
// На телефоне всплывающих окон нет: окно входа открывается вкладкой, исходная вкладка уходит в фон,
// система её усыпляет, WebSocket рвётся — и ключ сеанса, которого ждала исходная вкладка, доставить
// некуда. Поэтому вход идёт переходами в одной вкладке:
//
//   1. GET /api/login/start?vendor=…&return_to=/путь — заводит ожидающий вход, ставит браузеру
//      HttpOnly-cookie «<id входа>.<секрет>» и уводит к гейткиперу.
//   2. Гейткипер в браузере, вернувшемся от провайдера, ДО записи личности передаёт оболочке cookie
//      этого браузера (callback.confirmBrowser). Нет cookie этого входа — отказ, личность не
//      записывается. Иначе оболочка отдаёт путь /api/login/finish?handle=<одноразовый признак>,
//      гейткипер завершает вход (ключ сеанса ложится в ожидающий вход) и возвращает туда браузер.
//   3. GET /api/login/finish выдаёт одноразовый код (срок 90 с), только если у браузера есть И
//      признак результата, И cookie этого же входа, и возвращает его на return_to#login=<код>.
//      Ключ сеанса в адрес не попадает никогда.
//
// Зачем подтверждение браузера. Злоумышленник может начать вход у себя (получить cookie) и переслать
// адрес гейткипера жертве: у жертвы с открытым сеансом Mnemos вход пройдёт тихо. В браузере жертвы
// cookie злоумышленника нет — гейткипер получает отказ и личность жертвы никуда не кладёт. Признак
// результата вдобавок гасит вход, если вернулся не в тот браузер (например, другая вкладка).
//   4. Приложение меняет код на ключ по RPC completeGatekeeperLogin(code). Обмен требует ту же
//      cookie: код, унесённый в другой браузер, не срабатывает.
//
// На сервере лежат только SHA-256 кода и секрета браузера.

import { AUTH_ERROR_CODES, createAuthError } from "@gadgets/workshop-shared/api";

export const LOGIN_COOKIE = "__Host-os-login";
export const LOGIN_START_PATH = "/api/login/start";
export const LOGIN_FINISH_PATH = "/api/login/finish";
/** Срок одноразового кода после возврата от гейткипера. */
export const LOGIN_CODE_TTL_MS = 90_000;
/** Срок всего входа: сколько человек может провести на странице гейткипера. */
export const LOGIN_ATTEMPT_TTL_MS = 600_000;

export type LoginFailure = "no_email" | "signups_disabled" | "failed" | "expired" | "other_tab";

const HEX64 = /^[0-9a-f]{64}$/;
const CODE = /^[A-Za-z0-9_-]{43}$/;
const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export interface LoginKv {
  get<T>(key: string): T | undefined;
  put(key: string, value: unknown): void;
  delete(key: string): unknown;
  deleteAll?(): unknown;
}

interface Stored {
  secretHash: string;
  returnTo: string;
  deadline: number;
  token?: string;
  error?: LoginFailure;
  handleHash?: string;
  codeHash?: string;
  codeDeadline?: number;
}
const KEY = "login";

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export function randomHex(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, "0")).join("");
}
export function randomCode(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Состояние одного входа; живёт в Durable Object PendingLogin, часы подаются снаружи. */
export class PendingLoginState {
  constructor(private kv: LoginKv, private now: () => number) {}

  #read(): Stored | undefined {
    const stored = this.kv.get<Stored>(KEY);
    if (stored && stored.deadline <= this.now()) { this.#wipe(); return undefined; }
    return stored;
  }
  #wipe() { if (this.kv.deleteAll) this.kv.deleteAll(); else this.kv.delete(KEY); }

  /** Возвращает срок, после которого вход можно стереть. */
  async begin(secretHash: string, returnTo: string): Promise<number> {
    if (this.kv.get(KEY)) throw new Error("Login already started");
    const deadline = this.now() + LOGIN_ATTEMPT_TTL_MS;
    this.kv.put(KEY, { secretHash, returnTo, deadline } satisfies Stored);
    return deadline;
  }
  /** Гейткипер в браузере, завершающем вход, до записи личности: верна ли cookie этого входа.
   * Возвращает секрет признака результата для адреса возврата. Один раз. */
  async confirm(secret: string): Promise<string | null> {
    const stored = this.#read();
    if (!stored || stored.handleHash || stored.secretHash !== await sha256(secret)) return null;
    const handle = randomCode();
    this.kv.put(KEY, { ...stored, handleHash: await sha256(handle) });
    return handle;
  }
  /** Результат гейткипера; принимается только после подтверждения браузера. */
  async deliver(token: string): Promise<void> { this.#settle({ token, error: undefined }); }
  async fail(reason: LoginFailure): Promise<void> { this.#settle({ token: undefined, error: reason }); }
  #settle(result: Pick<Stored, "token" | "error">): void {
    const stored = this.#read();
    if (!stored?.handleHash || stored.token || stored.error) throw new Error("Login is not confirmed");
    this.kv.put(KEY, { ...stored, ...result });
  }
  /** Браузер вернулся с признаком результата, но без cookie этого входа: вход гасится. */
  async abandon(handle: string): Promise<void> {
    const stored = this.#read();
    if (stored?.handleHash && stored.handleHash === await sha256(handle)) this.#wipe();
  }
  /** Браузер вернулся от гейткипера: выдать одноразовый код (прежний код при этом гаснет).
   * Нужны оба: секрет из cookie браузера, начавшего вход, и признак результата из адреса. */
  // Отказы возвращаются как null, а не исключением: исключение из Durable Object платформа
  // пишет в журнал как необработанное, а отказ здесь — штатный исход.
  async issueCode(secret: string, handle: string): Promise<{ returnTo: string; code?: string; codeDeadline?: number; error?: LoginFailure } | null> {
    const stored = this.#read();
    if (!stored?.handleHash || stored.secretHash !== await sha256(secret)
        || stored.handleHash !== await sha256(handle)) return null;
    if (!stored.token) return { returnTo: stored.returnTo, error: stored.error ?? "failed" };
    const code = randomCode();
    const codeDeadline = Math.min(this.now() + LOGIN_CODE_TTL_MS, stored.deadline);
    this.kv.put(KEY, { ...stored, codeHash: await sha256(code), codeDeadline });
    return { returnTo: stored.returnTo, code, codeDeadline };
  }
  /** Обмен кода на ключ сеанса: только с секретом того же браузера, один раз и до срока. */
  async redeem(secret: string, code: string): Promise<string | null> {
    const stored = this.#read();
    if (!stored?.token || !stored.codeHash || stored.codeDeadline === undefined
        || stored.secretHash !== await sha256(secret)) return null;
    if (stored.codeDeadline <= this.now()) { this.#wipe(); return null; }
    if (stored.codeHash !== await sha256(code)) return null;
    this.#wipe();
    return stored.token;
  }
}

export type PendingLoginPort = Pick<PendingLoginState, "begin" | "confirm" | "issueCode" | "redeem" | "abandon">;

export interface LoginPort {
  create(): { id: string; stub: PendingLoginPort };
  get(id: string): PendingLoginPort | null;
  /** Запускает вход у гейткипера; бросает, если гейткипер не разрешён для входа. */
  connect(vendorId: string, pendingId: string): Promise<string>;
}

/** Только путь этого же сайта. Разрешён лишь набор символов пути; в пути запрещены пустые сегменты
 * («//»), сегменты «.» и «..» и кодировки точки, косой черты, обратной косой черты и управляющих
 * символов. Без точечных сегментов браузер путь не нормализует, поэтому «/.//evil.com»,
 * превращающийся в «//evil.com» (чужой сайт), сюда не проходит. */
export function parseReturnTo(raw: string | null): string | null {
  if (!raw || raw.length > 2048 || !/^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/?%]*$/.test(raw)) return null;
  const path = raw.split("?")[0];
  if (path.includes("//")) return null;
  if (path.split("/").some(segment => segment === "." || segment === "..")) return null;
  if (/%(0[0-9a-f]|1[0-9a-f]|7f|5c|2f|2e)/i.test(raw)) return null;
  return raw;
}

function readCookie(header: string | null): { pendingId: string; secret: string } | null {
  const values = (header ?? "").split(";").map(item => item.trim()).filter(item => item.startsWith(LOGIN_COOKIE + "="));
  if (values.length !== 1) return null;
  const parts = values[0].slice(LOGIN_COOKIE.length + 1).split(".");
  if (parts.length !== 2 || !parts.every(part => HEX64.test(part))) return null;
  return { pendingId: parts[0], secret: parts[1] };
}

const cookie = (value: string, maxAgeS: number) =>
  `${LOGIN_COOKIE}=${value}; Path=/; Max-Age=${maxAgeS}; HttpOnly; Secure; SameSite=Lax`;

function plain(status: number, text: string): Response {
  return new Response(text, { status, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

export async function handleLoginStart(request: Request, port: LoginPort): Promise<Response> {
  if (request.method !== "GET") return plain(405, "Method not allowed");
  const url = new URL(request.url);
  const vendorId = url.searchParams.get("vendor");
  const returnTo = parseReturnTo(url.searchParams.get("return_to"));
  if (!vendorId || !/^[a-z0-9-]{1,64}$/.test(vendorId) || !returnTo) return plain(400, "Некорректный адрес входа.");
  const { id, stub } = port.create();
  const secret = randomHex();
  await stub.begin(await sha256(secret), returnTo);
  let destination: string;
  try { destination = await port.connect(vendorId, id); }
  catch { return plain(403, "Вход через этот сервис на установке не включён."); }
  return new Response(null, { status: 302, headers: { ...HEADERS, Location: destination,
    "Set-Cookie": cookie(`${id}.${secret}`, LOGIN_ATTEMPT_TTL_MS / 1000) } });
}

const HANDLE = /^([0-9a-f]{64})\.([A-Za-z0-9_-]{43})$/;

export async function handleLoginFinish(request: Request, port: LoginPort): Promise<Response> {
  const back = (location: string, setCookie?: string) => new Response(null, { status: 303,
    headers: { ...HEADERS, Location: location, ...(setCookie ? { "Set-Cookie": setCookie } : {}) } });
  if (request.method !== "GET") return plain(405, "Method not allowed");
  const url = new URL(request.url);
  const binding = readCookie(request.headers.get("Cookie"));
  const rawHandle = url.searchParams.get("handle");
  if (rawHandle === null) return back("/#login-error=failed");
  const handle = HANDLE.exec(rawHandle);
  const target = handle && port.get(handle[1]);
  if (!handle || !target) return back("/#login-error=expired");
  // Вход выбирается по признаку результата, а секрет из cookie должен совпасть с секретом ЭТОГО
  // входа. Нет совпадения — результат пришёл в браузер, который вход не начинал (пересланный адрес
  // гейткипера или вход, начатый в другой вкладке): вход гасится, код не выдаётся никому.
  let result: Awaited<ReturnType<PendingLoginPort["issueCode"]>> = null;
  if (binding) {
    try { result = await target.issueCode(binding.secret, handle[2]); }
    catch { result = null; }
  }
  if (!result) {
    await target.abandon(handle[2]).catch(() => {});
    return back("/#login-error=other_tab");
  }
  if (!result.code) return back(`${result.returnTo}#login-error=${result.error ?? "failed"}`);
  // Cookie нужна ещё только для обмена кода: её срок сокращается до срока кода.
  return back(`${result.returnTo}#login=${result.code}`,
      cookie(`${binding!.pendingId}.${binding!.secret}`, Math.ceil(LOGIN_CODE_TTL_MS / 1000)));
}

/** Для callback.confirmBrowser: верна ли cookie браузера для этого входа. */
export async function confirmLoginBrowser(proof: string | undefined, pendingId: string, port: LoginPort)
    : Promise<{ returnPath: string } | null> {
  // Вход берётся из обратного вызова, а не из cookie: секрет из cookie другого входа к нему не подойдёт.
  const binding = readCookie(proof === undefined ? null : `${LOGIN_COOKIE}=${proof}`);
  const stub = binding ? port.get(pendingId) : null;
  const handle = stub ? await stub.confirm(binding!.secret).catch(() => null) : null;
  return handle ? { returnPath: `${LOGIN_FINISH_PATH}?handle=${pendingId}.${handle}` } : null;
}

/** RPC-обмен кода на ключ сеанса; cookie берётся из запроса, открывшего соединение. */
export async function redeemLoginCode(cookieHeader: string | null, code: string, port: LoginPort): Promise<string> {
  const binding = readCookie(cookieHeader);
  const stub = binding && CODE.test(code) ? port.get(binding.pendingId) : null;
  const token = stub ? await stub.redeem(binding!.secret, code).catch(() => null) : null;
  if (!token) throw loginRejected();
  return token;
}

export function loginRejected(): Error { return createAuthError(AUTH_ERROR_CODES.loginCodeRejected); }
