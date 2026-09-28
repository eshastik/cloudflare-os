// Подключение внешнего аккаунта (первое, повторное, расширение доступа) на той же странице и с
// привязкой к браузеру, который его начал.
//
// Прежде адрес гейткипера открывался в новой вкладке, а аккаунт записывался тому, кто получил
// адрес: пересланная ссылка подключала Google получателя к отправителю. Теперь:
//
//   1. POST /api/connect/start — запрос страницы с ключом сеанса в заголовке Authorization.
//      Заводит поток у пользователя, ставит браузеру HttpOnly-cookie «<пользователь>.<поток>.<секрет>»
//      и отдаёт адрес гейткипера. Cookie получает только браузер, в котором открыт сеанс
//      пользователя: запрос с ключом сеанса по ссылке не переслать.
//   2. Гейткипер, прежде чем записать учётные данные, передаёт cookie браузера оболочке
//      (callback.confirmBrowser). Нет cookie этого потока — отказ, гейткипер ничего не пишет.
//      Оболочка отдаёт путь /api/connect/finish?handle=<одноразовый признак>.
//   3. /api/connect/finish выдаёт одноразовый код (срок 90 с), если у браузера есть и признак, и
//      cookie, и возвращает его на исходный адрес: returnTo#connect=<код>.
//   4. Приложение меняет код по RPC completeConnect(code). Обмен идёт в сеансе того же
//      пользователя, и только тогда новый аккаунт записывается.
//
// На сервере лежат только SHA-256 секрета браузера, признака и кода.

import { AUTH_ERROR_CODES, createAuthError } from "@gadgets/workshop-shared/api";
import { SHELL_CONNECT_COOKIE } from "@gadgets/workshop-shared/shell-browser";
import { parseReturnTo, randomCode, randomHex, sha256 } from "./login-return.js";

export const CONNECT_COOKIE = SHELL_CONNECT_COOKIE;
export const CONNECT_START_PATH = "/api/connect/start";
export const CONNECT_FINISH_PATH = "/api/connect/finish";
export const CONNECT_CODE_TTL_MS = 90_000;
/** Сколько человек может провести у провайдера. */
export const CONNECT_FLOW_TTL_MS = 600_000;

export type FlowKind = "connect" | "reconnect" | "resources";
export interface FlowRequest {
  kind: FlowKind;
  vendorId?: string;
  accountId?: number;
  resourceUrlPatterns?: string[];
  returnTo: string;
}
export interface Flow extends Omit<FlowRequest, "accountId"> {
  accountId: number;
  secretHash: string;
  deadline: number;
  handleHash?: string;
  /** Для первого подключения — новый аккаунт от гейткипера, записывается только после обмена кода. */
  result?: { account: unknown; description?: unknown; expiresAt?: Date };
  settled?: boolean;
  codeHash?: string;
  codeDeadline?: number;
}
export type ConnectFailure = "failed" | "other_tab";

export interface FlowKv {
  get<T>(key: string): T | undefined;
  put(key: string, value: unknown): void;
  delete(key: string): unknown;
  list<T>(options: { prefix: string }): Iterable<[string, T]>;
}

const PREFIX = "connectFlow:";
const USER = /^[0-9a-f]{64}$/, FLOW = /^[0-9a-f]{32}$/, SECRET = /^[0-9a-f]{64}$/, TOKEN = /^[A-Za-z0-9_-]{43}$/;
const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/** Потоки подключения одного пользователя; живут в его Durable Object. */
export class ConnectFlows {
  constructor(private kv: FlowKv, private now: () => number) {}

  #read(flowId: string): Flow | undefined {
    if (!FLOW.test(flowId)) return undefined;
    const flow = this.kv.get<Flow>(PREFIX + flowId);
    if (flow && flow.deadline <= this.now()) { this.kv.delete(PREFIX + flowId); return undefined; }
    return flow;
  }

  async begin(request: FlowRequest & { accountId: number }, secretHash: string): Promise<string> {
    for (const [key, flow] of [...this.kv.list<Flow>({ prefix: PREFIX })]) {
      if (flow.deadline <= this.now()) this.kv.delete(key);
    }
    const flowId = randomHex().slice(0, 32);
    this.kv.put(PREFIX + flowId, { ...request, secretHash, deadline: this.now() + CONNECT_FLOW_TTL_MS } satisfies Flow);
    return flowId;
  }

  /** Гейткипер в браузере, завершающем поток: верна ли cookie этого потока. Один раз. */
  async confirm(flowId: string, secret: string, accountId: number): Promise<string | null> {
    const flow = this.#read(flowId);
    if (!flow || flow.handleHash || flow.accountId !== accountId || flow.secretHash !== await sha256(secret)) return null;
    const handle = randomCode();
    this.kv.put(PREFIX + flowId, { ...flow, handleHash: await sha256(handle) });
    return handle;
  }

  /** Результат гейткипера для подтверждённого потока этого аккаунта. false — такого потока нет. */
  async settle(accountId: number, result: Flow["result"]): Promise<boolean> {
    for (const [key, flow] of [...this.kv.list<Flow>({ prefix: PREFIX })]) {
      if (flow.accountId !== accountId || !flow.handleHash || flow.settled || flow.deadline <= this.now()) continue;
      this.kv.put(key, { ...flow, settled: true, ...(flow.kind === "connect" ? { result } : {}) });
      return true;
    }
    return false;
  }

  async abandon(flowId: string, handle: string): Promise<void> {
    const flow = this.#read(flowId);
    if (flow?.handleHash && flow.handleHash === await sha256(handle)) this.kv.delete(PREFIX + flowId);
  }

  async issueCode(flowId: string, secret: string, handle: string)
      : Promise<{ returnTo: string; code?: string; error?: ConnectFailure } | null> {
    const flow = this.#read(flowId);
    if (!flow?.handleHash || flow.secretHash !== await sha256(secret) || flow.handleHash !== await sha256(handle)) return null;
    if (!flow.settled) { this.kv.delete(PREFIX + flowId); return { returnTo: flow.returnTo, error: "failed" }; }
    const code = randomCode();
    this.kv.put(PREFIX + flowId, { ...flow, codeHash: await sha256(code), codeDeadline: Math.min(this.now() + CONNECT_CODE_TTL_MS, flow.deadline) });
    return { returnTo: flow.returnTo, code };
  }

  /** Обмен кода: один раз, до срока, с секретом того же браузера. Поток стирается. */
  async redeem(flowId: string, secret: string, code: string): Promise<Flow | null> {
    const flow = this.#read(flowId);
    if (!flow?.codeHash || flow.codeDeadline === undefined || flow.secretHash !== await sha256(secret)) return null;
    if (flow.codeDeadline <= this.now()) { this.kv.delete(PREFIX + flowId); return null; }
    if (flow.codeHash !== await sha256(code)) return null;
    this.kv.delete(PREFIX + flowId);
    return flow;
  }
}

export interface ConnectUserPort {
  /** Заводит поток и запускает его у гейткипера. url отсутствует — действий в браузере не нужно. */
  start(request: FlowRequest, secretHash: string): Promise<{ flowId?: string; url?: string; error?: string }>;
  confirm(flowId: string, secret: string, accountId: number): Promise<string | null>;
  issueCode(flowId: string, secret: string, handle: string): Promise<{ returnTo: string; code?: string; error?: ConnectFailure } | null>;
  abandon(flowId: string, handle: string): Promise<void>;
  redeem(flowId: string, secret: string, code: string): Promise<{ kind: FlowKind; vendorId?: string; accountId: number } | null>;
}
export interface ConnectPort {
  /** Проверяет ключ сеанса (или вход через Cloudflare Access по запросу) и возвращает id Durable
   * Object пользователя (64 hex). */
  authenticate(token: string | null, request: Request): Promise<string>;
  user(userId: string): ConnectUserPort;
}

function readCookie(header: string | null): { userId: string; flowId: string; secret: string } | null {
  return parseConnectProof((header ?? "").split(";").map(item => item.trim()).filter(item => item.startsWith(CONNECT_COOKIE + "="))
      .map(item => item.slice(CONNECT_COOKIE.length + 1)));
}
function parseConnectProof(values: (string | undefined)[]): { userId: string; flowId: string; secret: string } | null {
  if (values.length !== 1 || !values[0]) return null;
  const [userId, flowId, secret, ...rest] = values[0].split(".");
  if (rest.length || !USER.test(userId ?? "") || !FLOW.test(flowId ?? "") || !SECRET.test(secret ?? "")) return null;
  return { userId, flowId, secret };
}

const json = (status: number, body: unknown, setCookie?: string) => new Response(JSON.stringify(body), { status,
  headers: { ...HEADERS, "Content-Type": "application/json; charset=utf-8", ...(setCookie ? { "Set-Cookie": setCookie } : {}) } });

function parseRequest(body: unknown): FlowRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const returnTo = parseReturnTo(typeof b.returnTo === "string" ? b.returnTo : null);
  if (!returnTo || (b.kind !== "connect" && b.kind !== "reconnect" && b.kind !== "resources")) return null;
  const patterns = b.resourceUrlPatterns;
  if (patterns !== undefined && (!Array.isArray(patterns) || patterns.length > 50
      || patterns.some(p => typeof p !== "string" || p.length === 0 || p.length > 512))) return null;
  const request: FlowRequest = { kind: b.kind, returnTo };
  if (b.kind === "connect") {
    if (typeof b.vendorId !== "string" || !/^[a-z0-9-]{1,64}$/.test(b.vendorId)) return null;
    Object.assign(request, { vendorId: b.vendorId });
  } else {
    if (typeof b.accountId !== "number" || !Number.isSafeInteger(b.accountId) || b.accountId < 0) return null;
    Object.assign(request, { accountId: b.accountId });
  }
  if (patterns !== undefined) request.resourceUrlPatterns = patterns as string[];
  if (b.kind === "resources" && !request.resourceUrlPatterns?.length) return null;
  // Порядок полей как у разбора: kind, vendorId|accountId, resourceUrlPatterns, returnTo.
  const { returnTo: to, ...rest } = request;
  return { ...rest, returnTo: to };
}

export async function handleConnectStart(request: Request, port: ConnectPort): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  const url = new URL(request.url);
  let sameSite = false;
  try { sameSite = new URL(request.headers.get("Origin") ?? "").hostname === url.hostname; } catch { /* нет Origin */ }
  if (!sameSite) return json(403, { error: "Подключение начинается только со страницы этого сайта." });
  const token = /^Bearer (\S{1,1024})$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  let userId: string;
  try {
    userId = await port.authenticate(token ?? null, request);
    if (!USER.test(userId)) throw new Error();
  } catch { return json(401, { error: "Сеанс истёк. Войдите снова." }); }
  let flow: FlowRequest | null;
  try { flow = parseRequest(await request.json()); } catch { flow = null; }
  if (!flow) return json(400, { error: "Некорректный запрос подключения." });
  const secret = randomHex();
  let started: { flowId?: string; url?: string; error?: string };
  try { started = await port.user(userId).start(flow, await sha256(secret)); }
  catch { started = { error: "Не удалось начать подключение." }; }
  if (started.error) return json(400, { error: started.error });
  if (!started.url || !started.flowId) return json(200, { done: true });
  return json(200, { url: started.url },
      `${CONNECT_COOKIE}=${userId}.${started.flowId}.${secret}; Path=/; Max-Age=${CONNECT_FLOW_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Lax`);
}

/** Для callback.confirmBrowser: верна ли cookie браузера для потока этого аккаунта этого пользователя. */
export async function confirmConnectBrowser(proof: string | undefined, ownerUserId: string, accountId: number, port: ConnectPort)
    : Promise<{ returnPath: string } | null> {
  // Поток ищется у владельца подключения: cookie другого пользователя там не найдёт своего потока.
  const binding = parseConnectProof([proof]);
  if (!binding) return null;
  const handle = await port.user(ownerUserId).confirm(binding.flowId, binding.secret, accountId).catch(() => null);
  return handle ? { returnPath: `${CONNECT_FINISH_PATH}?handle=${ownerUserId}.${binding.flowId}.${handle}` } : null;
}

export async function handleConnectFinish(request: Request, port: ConnectPort): Promise<Response> {
  const back = (location: string, setCookie?: string) => new Response(null, { status: 303,
    headers: { ...HEADERS, Location: location, ...(setCookie ? { "Set-Cookie": setCookie } : {}) } });
  if (request.method !== "GET") return json(405, { error: "Method not allowed" });
  const handle = /^([0-9a-f]{64})\.([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/.exec(new URL(request.url).searchParams.get("handle") ?? "");
  if (!handle) return back("/#connect-error=failed");
  const target = port.user(handle[1]);
  const binding = readCookie(request.headers.get("Cookie"));
  // Поток выбирается по признаку; секрет из cookie должен совпасть с секретом ЭТОГО потока. Нет —
  // результат пришёл в чужой браузер или другую вкладку: поток гасится, кода нет никому.
  const result = binding
    ? await target.issueCode(handle[2], binding.secret, handle[3]).catch(() => null) : null;
  if (!result) {
    await target.abandon(handle[2], handle[3]).catch(() => {});
    return back("/#connect-error=other_tab");
  }
  if (!result.code) return back(`${result.returnTo}#connect-error=${result.error ?? "failed"}`);
  return back(`${result.returnTo}#connect=${result.code}`,
      `${CONNECT_COOKIE}=${binding!.userId}.${binding!.flowId}.${binding!.secret}; Path=/; Max-Age=${Math.ceil(CONNECT_CODE_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Lax`);
}

export function connectRejected(): Error { return createAuthError(AUTH_ERROR_CODES.connectCodeRejected); }

/** RPC-обмен кода в сеансе пользователя sessionUserId; cookie — из запроса, открывшего соединение. */
export async function redeemConnectCode(cookieHeader: string | null, sameSite: boolean, sessionUserId: string, code: string, port: ConnectPort)
    : Promise<{ kind: FlowKind; vendorId?: string; accountId: number }> {
  // Обмен идёт у пользователя сеанса: поток другого пользователя там не найдётся.
  const binding = readCookie(cookieHeader);
  if (!sameSite || !binding || typeof code !== "string" || !TOKEN.test(code)) throw connectRejected();
  const result = await port.user(sessionUserId).redeem(binding.flowId, binding.secret, code).catch(() => null);
  if (!result) throw connectRejected();
  return result;
}
