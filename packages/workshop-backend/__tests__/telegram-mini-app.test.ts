// Редактор документа в Telegram Mini App (ADR 0027 Mnemos, раздел 6): сессия одного документа у
// объекта бота и точка RPC, отдающая только этот документ.
import { describe, expect, it } from "vitest";
import {
  APP_SESSION_IDLE_MS, APP_SESSION_MAX_MS, PersonalTelegramBot, type BotRecord, type MiniAppSessionGrant, type TelegramTurnRef,
} from "../src/telegram/personal-bot";
import { DraftLimiter } from "../src/telegram/progress";
import { sealSecret } from "../src/telegram/secret-box";
import { webAppCheckString } from "../src/telegram/web-app-data";
import {
  APP_ON_SITE, EDITOR_CHECK_MS, MINI_APP_EDITOR_METHODS, MINI_APP_HOLDER, MiniAppPublicApiImpl, NOT_IN_MNEMOS, SESSION_ENDED, editorGateMethods, miniAppAccent,
  type MiniAppDocumentPort, type MiniAppPorts, type MnemosPort,
} from "../src/telegram/mini-app-api";
import type { NativeMnemosBinding, NativeMnemosState } from "@gadgets/workshop-shared/native-document";
import { APP_CODE_CLOSED, GADGET_APP_MIME } from "@gadgets/workshop-shared/gadget-app";

const KEY = "k".repeat(16) + "-secrets-key-for-tests-only-0123";
const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ";
const BOT = "123456789";
const ROUTE = "a".repeat(64);
const OWNER = "alice@example.ru";
const ALICE = 1001, MALLORY = 2002;
const SECRET = "s".repeat(43);
const WORKSPACE = "c".repeat(64);
const START = 1_800_000_000_000;

async function sha256(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, "0")).join("");
}
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");

async function harness() {
  let pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
  let publicKey = hex(await crypto.subtle.exportKey("raw", pair.publicKey) as ArrayBuffer);
  let map = new Map<string, unknown>();
  let storage = {
    get: <T>(key: string) => structuredClone(map.get(key)) as T | undefined,
    put: <T>(key: string, value: T) => { map.set(key, structuredClone(value)); },
    delete: (key: string) => map.delete(key),
    list: <T>({ prefix }: { prefix: string }) => [...map.entries()].filter(([key]) => key.startsWith(prefix)) as [string, T][],
  };
  let sent: Record<string, unknown>[] = [];
  let fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = String(input), method = url.slice(url.lastIndexOf("/") + 1);
    let body = JSON.parse(String(init?.body ?? "{}"));
    if (method === "sendMessage") { sent.push(body); return Response.json({ ok: true, result: { message_id: 100 + sent.length, chat: { id: body.chat_id, type: "private" } } }); }
    if (method === "createForumTopic") return Response.json({ ok: true, result: { message_thread_id: 90, name: body.name } });
    return Response.json({ ok: true, result: true });
  }) as typeof fetch;
  let clock = { now: START };
  let principal: string | null = "[\"org\",\"alice\"]";
  let bot = new PersonalTelegramBot({
    storage, secretsKey: KEY, publicBase: "https://mnemos.example.ru", routeId: ROUTE, fetch: fetcher,
    claim: async () => true, release: async () => {}, mnemosOf: async () => null,
    now: () => clock.now, waitUntil: () => {},
    gateway: { submit: async () => ({ accepted: true, chatPath: `/workspace/${WORKSPACE}?chat=3` }), rename: async () => true, decide: async () => ({ status: "denied" }) },
    transcribe: async () => "", drafts: new DraftLimiter(), voice: { busy: false },
    mnemos: { read: async () => null, ack: async s => s, prepare: async () => ({ version: null, details: [] }), decide: async () => ({ status: "stale", reason: "" }) },
    setAlarm: () => {}, webAppPublicKey: publicKey, mnemosPrincipal: async () => principal,
  });
  map.set("bot", {
    owner: OWNER, mnemos: null, bot: { id: BOT, username: "alice_bot", title: "Помощник" },
    threads: { enabled: true, usersCanCreate: true }, checkedAt: clock.now,
    token: await sealSecret(KEY, "telegram-bot-token", JSON.stringify(["telegram-bot", OWNER, BOT]), TOKEN),
    secretSha256: await sha256(SECRET), pairing: null,
    telegramOwner: { id: ALICE, name: "Алиса", username: null }, connectedAt: clock.now, createdAt: clock.now, seen: [],
  } satisfies BotRecord);
  let initData = async (user = ALICE) => {
    let params = new URLSearchParams({ auth_date: String(Math.floor(clock.now / 1000)), user: JSON.stringify({ id: user, first_name: "А" }), hash: "0".repeat(64) });
    let check = webAppCheckString(params.toString() + "&signature=x", BOT)!;
    params.set("signature", b64url(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(check.text)))));
    return params.toString();
  };
  // Ход из треда: ответ агента с созданными выводами даёт кнопки «Открыть».
  let ref: TelegramTurnRef = { route: ROUTE, chat: ALICE, thread: 90, update: 1 };
  map.set("thread:90", { thread: 90, key: `${BOT}:${ALICE}:90`, naming: "bot", title: "Беседа", renamed: true, unlinked: false,
    chatPath: `/workspace/${WORKSPACE}?chat=3`, createdAt: clock.now });
  let buttons = () => sent.flatMap(body => ((body.reply_markup as { inline_keyboard?: { text: string; web_app?: { url: string } }[][] } | undefined)?.inline_keyboard ?? []).flat());
  let screen = (index = 0) => new URL(buttons()[index].web_app!.url).searchParams.get("t")!.split(".")[1];
  let setPrincipal = (value: string | null) => { principal = value; };
  return { bot, map, clock, ref, buttons, screen, initData, setPrincipal };
}

async function opened() {
  let h = await harness();
  await h.bot.deliver(h.ref, { text: "Готово.", documents: ["План", "Калькулятор"], editable: [{ gadgetId: 7, title: "План" }] });
  let result = await h.bot.openMiniApp(h.screen(0), await h.initData());
  if (result.status !== "ok" || !result.session) throw new Error("нет сессии");
  let [route, secret] = result.session.split(".");
  return { ...h, route, secret, result };
}

describe("сессия Mini App у объекта бота", () => {
  it("документ беседы открывается с сессией одного вывода; в хранилище только хэш; кнопка одноразовая", async () => {
    let h = await opened();
    expect(h.route).toBe(ROUTE);
    expect(h.buttons().map(b => b.text)).toEqual(["Открыть «План»", "Открыть «Калькулятор»"]);
    expect(JSON.stringify([...h.map.entries()])).not.toContain(h.secret);
    expect(await h.bot.miniAppSession(h.secret)).toEqual({ owner: OWNER, document: { workspace: WORKSPACE, gadget: 7 }, principal: "[\"org\",\"alice\"]", endsAt: START + APP_SESSION_MAX_MS } satisfies MiniAppSessionGrant);
    expect(await h.bot.openMiniApp(h.screen(0), await h.initData())).toMatchObject({ status: "expired" });
  });

  it("приложение (не документ) сессии не получает — только сайт", async () => {
    let h = await harness();
    await h.bot.deliver(h.ref, { text: "Готово.", documents: ["Калькулятор"] });
    let result = await h.bot.openMiniApp(h.screen(0), await h.initData());
    expect(result).toMatchObject({ status: "ok" });
    expect(result).not.toHaveProperty("session");
  });

  it("чужой человек, чужой секрет и испорченная сессия — отказ", async () => {
    let h = await harness();
    await h.bot.deliver(h.ref, { text: "Готово.", documents: ["План"], editable: [{ gadgetId: 7, title: "План" }] });
    expect(await h.bot.openMiniApp(h.screen(0), await h.initData(MALLORY))).toEqual({ status: "denied" });
    expect(await h.bot.miniAppSession("x".repeat(43))).toBeNull();
    expect(await h.bot.miniAppSession("коротко")).toBeNull();
    expect(await h.bot.miniAppSession(undefined)).toBeNull();
  });

  it("30 минут без действий — истекла; действия продлевают, но не дольше 8 часов", async () => {
    let h = await opened();
    h.clock.now += APP_SESSION_IDLE_MS - 1000;
    expect(await h.bot.miniAppSession(h.secret)).not.toBeNull();
    h.clock.now += APP_SESSION_IDLE_MS - 1000;
    expect(await h.bot.miniAppSession(h.secret)).not.toBeNull();
    h.clock.now += APP_SESSION_IDLE_MS;
    expect(await h.bot.miniAppSession(h.secret)).toBeNull();
    // Истёкшая удаляется и не оживает.
    h.clock.now -= APP_SESSION_IDLE_MS;
    expect(await h.bot.miniAppSession(h.secret)).toBeNull();

    let long = await opened();
    for (let spent = 0; spent < APP_SESSION_MAX_MS - 20 * 60_000; spent += 20 * 60_000) {
      long.clock.now += 20 * 60_000;
      expect(await long.bot.miniAppSession(long.secret)).not.toBeNull();
    }
    long.clock.now += 20 * 60_000;
    expect(await long.bot.miniAppSession(long.secret)).toBeNull();
  });

  it("отключение бота, новый токен (новый секрет вебхука), другой владелец Telegram и «Закрыть» отзывают сессию", async () => {
    let a = await opened();
    await a.bot.disconnect(OWNER);
    expect([...a.map.keys()].filter(k => k.startsWith("appsession"))).toEqual([]);
    expect(await a.bot.miniAppSession(a.secret)).toBeNull();

    let b = await opened();
    let record = b.map.get("bot") as BotRecord;
    b.map.set("bot", { ...record, secretSha256: await sha256("t".repeat(43)) });
    expect(await b.bot.miniAppSession(b.secret)).toBeNull();

    let c = await opened();
    let rec = c.map.get("bot") as BotRecord;
    c.map.set("bot", { ...rec, telegramOwner: { id: MALLORY, name: "М", username: null } });
    expect(await c.bot.miniAppSession(c.secret)).toBeNull();

    let d = await opened();
    await d.bot.endMiniAppSession(d.secret);
    expect(await d.bot.miniAppSession(d.secret)).toBeNull();
  });
});

// ---- точка RPC ----

const BINDING: NativeMnemosBinding = { accountId: 5, scope: "p1", resource: "n1", savedRevision: 3, savedHead: "a".repeat(64) };

function fakes(options: { binding?: NativeMnemosBinding | null; project?: boolean; access?: "owner" | "write" | "read"; saveError?: Error; versionType?: string } = {}) {
  let clock = { now: START };
  let grant: MiniAppSessionGrant | null = { owner: OWNER, document: { workspace: WORKSPACE, gadget: 7 }, principal: "P", endsAt: START + APP_SESSION_MAX_MS };
  // Таймеры вручную: run(ms) сдвигает часы и выполняет наступившие.
  let timers: { at: number; run: () => void; off: boolean }[] = [];
  let runTimers = async (ms: number) => {
    let until = clock.now + ms;
    for (;;) {
      let next = timers.filter(t => !t.off && t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      clock.now = Math.max(clock.now, next.at); next.off = true; next.run();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    }
    clock.now = until;
  };
  let principal: string | null = "P";
  let log: string[] = [];
  let aborted: Error[] = [];
  let ended = 0;
  let state: NativeMnemosState = { binding: options.binding === undefined ? BINDING : options.binding, creation: null,
    project: options.project ? { accountId: 5, projectId: "chat-project", title: "Продажи" } : null };
  let editorCalls: string[] = [];
  let editor = Object.fromEntries([...MINI_APP_EDITOR_METHODS, "syncToGoogleDoc", "getGoogleDocInfo"].map(m => [m, async (...args: unknown[]) => { editorCalls.push(m); return { method: m, args }; }]));
  let released: string[] = [];
  let document: MiniAppDocumentPort = {
    info: async () => ({ title: "План", format: "cloudflareos.document", sitePath: `/workspace/${WORKSPACE}?chat=3` }),
    uiBundle: async () => ({ jsCode: "client();" }),
    editor: async () => editor,
    mnemosState: async () => structuredClone(state),
    setMnemosDocument: async binding => { log.push("bind:" + JSON.stringify(binding)); state = { ...state, binding, creation: null }; },
    claimMnemosDocument: async (accountId, scope, name, holder) => { log.push(`claim:${accountId}:${scope}:${name}:${holder}`); return { claim: "cl1", name }; },
    releaseMnemosDocument: async claim => { released.push(claim); },
    recordMnemosDocumentReceipt: async (claim, receipt) => { log.push(`receipt:${claim}:${receipt}`); },
  };
  let mnemos: MnemosPort = {
    accountId: 5, principal: "P", storageOrigin: "https://mnemos.example.ru",
    writes: {
      select: async (scope, resource, format) => {
        log.push(`select:${scope}:${resource}:${format}`);
        return {
          head: async () => "b".repeat(64), access: async () => options.access ?? "owner",
          issue: async (head, size, checksum) => { log.push(`issue:${head}:${size}`); return { upload_id: "u1", url: "https://mnemos.example.ru/put", method: "PUT", checksum_header: "x-amz-checksum-sha256", checksum_value: checksum, content_length: size }; },
          save: async (head, upload) => { if (options.saveError) throw options.saveError; log.push(`save:${head}:${upload}`); return "c".repeat(64); },
        };
      },
      create: async (scope, name, format) => {
        log.push(`create:${scope}:${name}:${format}`);
        return {
          head: async () => "h".repeat(64),
          issue: async (head, size, checksum) => ({ upload_id: "u2", url: "https://mnemos.example.ru/put", method: "PUT", checksum_header: "x", checksum_value: checksum, content_length: size }),
          checkpoint: async () => "receipt-1",
          save: async () => "d".repeat(64),
          document: async () => "new-node",
        };
      },
    },
    downloads: {
      publications: async (scope, resource) => {
        log.push(`publications:${scope}:${resource}`);
        return { publications: [
          { id: "private:" + "e".repeat(64), recordedAt: "2026-09-29T10:00:00Z", actor: "", author: "Алиса", format: "cloudflareos.document" },
          { id: "ev2", recordedAt: "2026-09-28T10:00:00Z", actor: "Агент", onBehalfOf: "alice", format: "cloudflareos.document" },
          { id: "ev3", recordedAt: "2026-09-27T10:00:00Z", actor: "x", format: "cloudflareos.spreadsheet" },
        ], nextCursor: "" };
      },
      select: async (scope, resource, publication) => {
        log.push(`version:${scope}:${resource}:${publication}`);
        return { issue: async () => ({ url: "https://mnemos.example.ru/get", method: "GET", size_bytes: 2, sha256_hex: "0".repeat(64), content_type: options.versionType ?? "application/json" }), validate: async () => {} };
      },
    },
  };
  let opens: string[] = [];
  let ports: MiniAppPorts = {
    session: async (route, secret) => { log.push(`session:${route}`); return secret === SECRET ? grant : null; },
    endSession: async () => { ended++; },
    principal: async () => principal,
    openDocument: async (owner, doc) => { opens.push(`${owner}:${doc.workspace}:${doc.gadget}`); return document; },
    mnemos: async (_owner, accountId) => { log.push(`mnemos:${accountId}`); return mnemos; },
    appearance: async () => ({ preference: { accent: "orange", themeMode: null }, deployment: "" }),
    now: () => clock.now,
    schedule: (ms, run) => { let timer = { at: clock.now + ms, run, off: false }; timers.push(timer); return () => { timer.off = true; }; },
  };
  let api = new MiniAppPublicApiImpl(ports, reason => { aborted.push(reason); });
  let session = `${ROUTE}.${SECRET}`;
  return {
    api, session, log, aborted, opens, editorCalls, released, clock, runTimers, pending: () => timers.filter(t => !t.off).length,
    revoke: () => { grant = null; }, setPrincipal: (value: string | null) => { principal = value; },
    ended: () => ended, state: () => state,
  };
}

type Doc = {
  describe(): Promise<{ title: string; mnemos: { kind: string }; accent: string; storageOrigin: string }>;
  getUiBundle(): Promise<{ jsCode: string } | null>;
  connectEditor(): Promise<Record<string, (...args: unknown[]) => Promise<unknown>>>;
  writer(): Promise<{ head(): Promise<string>; issue(h: string, s: number, c: string): Promise<unknown>; save(h: string, u: string, r: number | null): Promise<string> }>;
  creator(name: string): Promise<{ issue(s: number, c: string): Promise<unknown>; save(u: string, r: number | null): Promise<void>; [Symbol.dispose](): void }>;
  versions(cursor: string): Promise<{ versions: { id: string; author: string; onBehalfOf: string }[] }>;
  version(id: string): Promise<{ issue(): Promise<unknown>; validate(): Promise<void> }>;
};
const open = async (f: ReturnType<typeof fakes>) => await f.api.open(f.session) as unknown as Doc;

describe("точка RPC Mini App: только один документ", () => {
  it("без сессии, с чужой или испорченной сессией — отказ и закрытие связи; документ не открывается", async () => {
    for (let bad of ["", "x", `${ROUTE}.${"z".repeat(43)}`, `${"b".repeat(64)}:${SECRET}`]) {
      let f = fakes();
      await expect(f.api.open(bad)).rejects.toThrow(SESSION_ENDED);
      expect(f.opens).toEqual([]);
    }
    let f = fakes();
    await expect(f.api.open(`${ROUTE}.${"z".repeat(43)}`)).rejects.toThrow(SESSION_ENDED);
    expect(f.aborted).toHaveLength(1);
  });

  it("открывает ровно документ из сессии; второй open на той же связи — отказ", async () => {
    let f = fakes();
    let doc = await open(f);
    expect(f.opens).toEqual([`${OWNER}:${WORKSPACE}:7`]);
    await expect(f.api.open(f.session)).rejects.toThrow(SESSION_ENDED);
    let info = await doc.describe();
    expect(info).toMatchObject({ title: "План", mnemos: { kind: "bound", access: "owner" }, accent: "#ae4b14", storageOrigin: "https://mnemos.example.ru" });
    expect(await doc.getUiBundle()).toEqual({ jsCode: "client();" });
  });

  it("у документа нет методов для других документов, бесед, настроек и агентов", async () => {
    let f = fakes();
    let doc = await open(f) as unknown as Record<string, unknown>;
    let own = Object.getOwnPropertyNames(Object.getPrototypeOf(doc)).filter(n => n !== "constructor").sort();
    expect(own).toEqual(["close", "connectEditor", "creator", "describe", "getUiBundle", "version", "versions", "writer"]);
    for (let name of ["openGadget", "getGadget", "listGadgets", "getChatHistory", "sendChatMessage", "getGatekeeperApp", "getAdminApi", "subscribeConnectedAccounts", "bind", "listBindings", "getBinding", "setAppearance", "select", "scopes", "documents"]) {
      expect(doc[name]).toBeUndefined();
    }
  });

  it("связь с редактором — только методы правки и снимка; выгрузки в Google и прочее недоступны", async () => {
    let f = fakes();
    let doc = await open(f);
    let editor = await doc.connectEditor() as Record<string, unknown>;
    expect(editorGateMethods().sort()).toEqual([...MINI_APP_EDITOR_METHODS].sort());
    expect(editor.syncToGoogleDoc).toBeUndefined();
    expect(editor.getGoogleDocInfo).toBeUndefined();
    expect(editor.call).toBeUndefined();
    await (editor.getDocument as () => Promise<unknown>)();
    expect(f.editorCalls).toEqual(["getDocument"]);
  });

  it("сохранение — в документ привязки, от сохранённой версии; отметка «сохранено» — у того же документа", async () => {
    let f = fakes();
    let doc = await open(f);
    let writer = await doc.writer();
    await writer.issue("a".repeat(64), 10, "sum");
    expect(await writer.save("a".repeat(64), "u1", 9)).toBe("c".repeat(64));
    expect(f.log).toContain("select:p1:n1:cloudflareos.document");
    expect(f.log).toContain(`save:${"a".repeat(64)}:u1`);
    expect(f.state().binding).toEqual({ accountId: 5, scope: "p1", resource: "n1", savedHead: "c".repeat(64), savedRevision: 9 });
  });

  it("Mnemos отказал в записи (доступ отозван) — сохранение отказывает, отметки нет", async () => {
    let f = fakes({ saveError: new Error("Mnemos 403") });
    let doc = await open(f);
    let writer = await doc.writer();
    await expect(writer.save("a".repeat(64), "u1", 9)).rejects.toThrow("Mnemos 403");
    expect(f.state().binding).toEqual(BINDING);
  });

  it("только чтение — записи нет; документ не в Mnemos — нет ни записи, ни версий", async () => {
    let read = fakes({ access: "read" });
    await expect((await open(read)).writer()).rejects.toThrow("только для чтения");
    let none = fakes({ binding: null });
    let doc = await open(none);
    await expect(doc.writer()).rejects.toThrow(NOT_IN_MNEMOS);
    await expect(doc.versions("")).rejects.toThrow(NOT_IN_MNEMOS);
    await expect(doc.version("ev2")).rejects.toThrow(NOT_IN_MNEMOS);
    await expect(doc.creator("План")).rejects.toThrow();
  });

  it("версии — только этого документа и формата; выбранная версия открывается в пределах привязки", async () => {
    let f = fakes();
    let doc = await open(f);
    let page = await doc.versions("");
    expect(page.versions.map(v => [v.id, v.author, v.onBehalfOf])).toEqual([["private:" + "e".repeat(64), "Алиса", ""], ["ev2", "Агент", "alice"]]);
    await (await doc.version("ev2")).issue();
    expect(f.log).toContain("publications:p1:n1");
    expect(f.log).toContain("version:p1:n1:ev2");
  });

  it("служебный кадр сервера умеет выдать тело приложения, но странице Mini App билет на него не отдаётся", async () => {
    let doc = await open(fakes({ versionType: GADGET_APP_MIME }));
    await expect((await doc.version("ev2")).issue()).rejects.toThrow(APP_CODE_CLOSED);
  });

  it("первое сохранение — в проект беседы, выбранный сервером; квитанция до записи; брошенное создание снимает захват", async () => {
    let f = fakes({ binding: null, project: true });
    let doc = await open(f);
    expect((await doc.describe()).mnemos).toEqual({ kind: "project", projectTitle: "Продажи" });
    let creator = await doc.creator("План продаж");
    await creator.issue(10, "sum");
    await creator.save("u2", 4);
    expect(f.log).toContain(`claim:5:chat-project:План продаж:${MINI_APP_HOLDER}`);
    expect(f.log).toContain("create:chat-project:План продаж:cloudflareos.document");
    expect(f.log.indexOf("receipt:cl1:receipt-1")).toBeLessThan(f.log.findIndex(l => l.startsWith("bind:")));
    expect(f.state().binding).toEqual({ accountId: 5, scope: "chat-project", resource: "new-node", savedRevision: 4, savedHead: "d".repeat(64) });

    let g = fakes({ binding: null, project: true });
    let other = await (await open(g)).creator("Черновик");
    other[Symbol.dispose]();
    await Promise.resolve();
    expect(g.released).toEqual(["cl1"]);
  });

  it("отозванная или истёкшая сессия: вызовы отказывают, связь закрывается; редактор перепроверяет не реже 30 секунд", async () => {
    let f = fakes();
    let doc = await open(f);
    let editor = await doc.connectEditor() as Record<string, (...args: unknown[]) => Promise<unknown>>;
    f.revoke();
    // Сразу после проверки редактор ещё работает (правка идёт часто)...
    await editor.applyOperation({});
    // ...а через 30 секунд — отказ.
    f.clock.now += EDITOR_CHECK_MS;
    await expect(editor.applyOperation({})).rejects.toThrow(SESSION_ENDED);
    await expect(doc.describe()).rejects.toThrow(SESSION_ENDED);
    await expect(doc.writer()).rejects.toThrow(SESSION_ENDED);
    expect(f.aborted.length).toBeGreaterThan(0);
  });

  it("только подписка, без вызовов: отключение бота закрывает связь при ближайшей проверке, предельный срок — ровно в срок", async () => {
    let f = fakes();
    let doc = await open(f);
    await (await doc.connectEditor() as Record<string, (...a: unknown[]) => Promise<unknown>>).subscribe({});
    let calls = f.editorCalls.length;
    await f.runTimers(EDITOR_CHECK_MS * 3);
    expect(f.aborted).toEqual([]);
    f.revoke();
    await f.runTimers(EDITOR_CHECK_MS);
    expect(f.aborted).toHaveLength(1);
    expect(f.ended()).toBe(1);
    expect(f.editorCalls.length).toBe(calls);
    expect(f.pending()).toBe(0);

    let g = fakes();
    await open(g);
    await g.runTimers(APP_SESSION_MAX_MS - 1000);
    expect(g.aborted).toEqual([]);
    await g.runTimers(1000);
    expect(g.aborted).toHaveLength(1);
    expect(g.ended()).toBe(1);
  });

  it("«Закрыть» и обрыв связи удаляют сессию у бота и закрывают связь", async () => {
    let f = fakes();
    let doc = await open(f) as unknown as Doc & { close(): Promise<void> };
    await doc.close();
    expect(f.ended()).toBe(1);
    expect(f.aborted).toHaveLength(1);
    await expect(doc.describe()).rejects.toThrow(SESSION_ENDED);
    let g = fakes();
    let other = await open(g) as unknown as { [Symbol.dispose](): void };
    other[Symbol.dispose]();
    expect(g.ended()).toBe(1);
    expect(g.pending()).toBe(0);
  });

  it("смена аккаунта Mnemos отзывает сессию", async () => {
    let f = fakes();
    let doc = await open(f);
    f.setPrincipal("[\"org\",\"bob\"]");
    await expect(doc.describe()).rejects.toThrow(SESSION_ENDED);
    expect(f.ended()).toBe(1);
    await expect(doc.getUiBundle()).rejects.toThrow(SESSION_ENDED);
    let g = fakes();
    let other = await open(g);
    g.setPrincipal(null);
    await expect(other.versions("")).rejects.toThrow(SESSION_ENDED);
  });

  it("акцент — как на сайте: личный выбор, иначе цвет установки, иначе зелёный Mnemos", () => {
    expect(miniAppAccent({ accent: "blue", themeMode: null }, "#123456")).toBe("#176b9a");
    expect(miniAppAccent(null, "#123456")).toBe("#123456");
    expect(miniAppAccent(null, "red; background:url(x)")).toBe("#21664f");
  });
});

// ---- приложение (ADR 0028) ----

describe("точка RPC Mini App: приложение", () => {
  async function appFakes(options: { collaborative?: boolean; saved?: boolean; bound?: boolean } = {}) {
    let grant: MiniAppSessionGrant = { owner: OWNER, document: { workspace: WORKSPACE, gadget: 9 }, principal: "P", endsAt: START + APP_SESSION_MAX_MS };
    let clock = { now: START };
    let calls: string[] = [];
    let binding = options.bound === false ? null : { accountId: 5, scope: "p1", resource: "app1", description: "", collaborative: options.collaborative ?? true, session: true, permissions: [] as [], savedCodeVersion: 2 };
    let workspaceGadget = { add: async (x: string) => { calls.push(`workspace:${x}`); return x; } };
    let liveGadget = { add: async (x: string) => { calls.push(`live:${x}`); return x; } };
    let document = {
      info: async () => ({ title: "Список", format: "cloudflareos.app" as const, sitePath: `/workspace/${WORKSPACE}` }),
      app: async () => ({ binding, saved: options.saved ?? true }),
      uiBundle: async () => ({ jsCode: "workspace();" }),
      editor: async () => workspaceGadget,
      mnemosState: async () => ({ binding: null, creation: null, project: null }),
      setMnemosDocument: async () => {}, claimMnemosDocument: async () => null, releaseMnemosDocument: async () => {}, recordMnemosDocumentReceipt: async () => {},
    } as unknown as MiniAppDocumentPort;
    let mnemos = { accountId: 5, principal: "P", storageOrigin: "https://mnemos.example.ru",
      writes: { appAccess: async () => ({ access: "read", principal: "P", tenant: "", name: "" }) }, downloads: {} } as unknown as MnemosPort;
    let ports: MiniAppPorts = {
      session: async () => grant, endSession: async () => {}, principal: async () => "P",
      openDocument: async () => document, mnemos: async () => mnemos,
      appearance: async () => ({ preference: null, deployment: "" }), now: () => clock.now, schedule: () => () => {},
      openApp: async (owner, accountId, scope, resource, personal) => {
        calls.push(`openApp:${owner}:${accountId}:${scope}:${resource}:${personal ? "свой" : "общий"}`);
        return { describe: async () => { throw new Error("unused"); }, deploy: async () => { throw new Error("unused"); },
          getUiBundle: async () => ({ jsCode: "live();" }), connectToGadget: async () => liveGadget };
      },
    };
    let api = new MiniAppPublicApiImpl(ports, () => {});
    let doc = await api.open(`${ROUTE}.${SECRET}`) as unknown as Doc;
    return { doc, calls, clock, revoke: () => { grant = null as unknown as MiniAppSessionGrant; } };
  }

  it("сохранённое совместное приложение открывает общий экземпляр узла; право — из Mnemos", async () => {
    let f = await appFakes();
    expect(await f.doc.describe()).toMatchObject({ title: "Список", mnemos: { kind: "bound", access: "read" }, storageOrigin: "" });
    expect(await f.doc.getUiBundle()).toEqual({ jsCode: "live();" });
    let gadget = await f.doc.connectEditor();
    expect(await gadget.add("x")).toBe("x");
    expect(f.calls).toEqual([`openApp:${OWNER}:5:p1:app1:общий`, "live:x"]);
  });

  it("личное приложение — свой экземпляр открывшего", async () => {
    let f = await appFakes({ collaborative: false });
    expect(await f.doc.getUiBundle()).toEqual({ jsCode: "live();" });
    expect(f.calls).toEqual([`openApp:${OWNER}:5:p1:app1:свой`]);
  });

  it("несохранённые правки или нет привязки — экран рабочего места", async () => {
    for (let options of [{ saved: false }, { bound: false }]) {
      let f = await appFakes(options);
      expect(await f.doc.getUiBundle()).toEqual({ jsCode: "workspace();" });
      expect(await (await f.doc.connectEditor()).add("y")).toBe("y");
      expect(f.calls).toEqual(["workspace:y"]);
    }
  });

  it("сохранение и версии приложения из Telegram недоступны; отозванная сессия закрывает вызовы", async () => {
    let f = await appFakes();
    await expect(f.doc.writer()).rejects.toThrow(APP_ON_SITE);
    await expect(f.doc.creator("x")).rejects.toThrow(APP_ON_SITE);
    await expect(f.doc.versions("")).rejects.toThrow(APP_ON_SITE);
    let gadget = await f.doc.connectEditor();
    f.revoke(); f.clock.now += EDITOR_CHECK_MS;
    await expect(gadget.add("после")).rejects.toThrow(SESSION_ENDED);
    expect(f.calls).not.toContain("live:после");
  });
});
