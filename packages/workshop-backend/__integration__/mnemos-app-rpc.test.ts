// Экземпляр приложения узла Mnemos (ADR 0028, этап 2) на настоящем Durable Object с facet'ом: два
// человека видят одно состояние, сервер гаджета знает вызывающего, узлы и свои экземпляры не видят друг
// друга, у сервера нет сети, общий экземпляр — только опубликованные версии и только через session(),
// справочник — пересечение с видимым запустившему, отзыв доступа закрывает связь, код узла в рабочее
// место не попадает (ADR 0028, п. 4), смена версии сохраняет данные, журнал пишет открытия и смены кода.
import { exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { newWebSocketRpcSession, RpcTarget, type RpcStub } from "capnweb";
import type { PublicApi, WorkpieceSummary } from "@gadgets/workshop-shared/api";
import { APP_CODE_CLOSED, gadgetAppSha256, gadgetAppText, type GadgetAppDocument } from "@gadgets/workshop-shared/gadget-app";
import * as Y from "yjs";
import { expect, it } from "vitest";
import { APP_ACCESS_CLOSED, APP_CHECK_MS, APP_PREVIEW_EDIT_ONLY, openMnemosAppConnection, type AppObjectPort, type MnemosAppPorts } from "../src/mnemos-app-api";
import { APP_ALREADY_RUNNING, APP_PUBLISHED_ONLY, mnemosAppObjectName, type AppAuditEntry } from "../src/mnemos-app";

const SERVER = `
import { DurableObject, RpcTarget } from "cloudflare:workers";
class Session extends RpcTarget {
  constructor(app, caller) { super(); this.app = app; this.caller = caller; }
  async add(text) { return this.app.add(this.caller, text); }
  async list() { return this.app.list(); }
  async whoami() { return { principal: this.caller.principal, name: this.caller.name, access: this.caller.access, directory: !!this.caller.directory }; }
  async people() { return this.caller.directory ? this.caller.directory.people : null; }
  async starts() { return this.app.starts(); }
  async network() { try { await fetch("https://example.com/"); return "open"; } catch { return "blocked"; } }
  async version() { return VERSION; }
}
const VERSION = "__VERSION__";
export class Gadget extends DurableObject {
  constructor(ctx, env) { super(ctx, env); ctx.storage.kv.put("starts", (ctx.storage.kv.get("starts") ?? 0) + 1); }
  session(caller) { return new Session(this, caller); }
  add(caller, text) { const items = this.ctx.storage.kv.get("items") ?? []; items.push({ by: caller.principal, text }); this.ctx.storage.kv.put("items", items); return items.length; }
  list() { return this.ctx.storage.kv.get("items") ?? []; }
  starts() { return this.ctx.storage.kv.get("starts"); }
  version() { return VERSION; }
}`;
const LEGACY_SERVER = `
import { DurableObject } from "cloudflare:workers";
export class Gadget extends DurableObject { async ping() { return "pong"; } }`;

const doc = (version: string, options: { server?: string; permissions?: "directory"[]; collaborative?: boolean; session?: boolean } = {}): GadgetAppDocument => ({
  manifest: { title: "Общий список", description: "", collaborative: options.collaborative ?? true, session: options.session ?? true, formatVersion: 1, permissions: options.permissions ?? ["directory"] },
  modules: { "client.js": `document.body.textContent = ${JSON.stringify(version)}`, "server.js": options.server ?? SERVER.replace("__VERSION__", version) },
});

type Session = {
  add(text: string): Promise<number>; list(): Promise<{ by: string; text: string }[]>;
  whoami(): Promise<{ principal: string; name: string; access: string; directory: boolean }>; people(): Promise<{ id: string; name: string }[] | null>;
  starts(): Promise<number>; network(): Promise<string>; version(): Promise<string>;
};
const INSTALLATION = "https://mnemos.example";
type Directory = Awaited<ReturnType<MnemosAppPorts["directory"]>>;
const EVERYONE: Directory = { people: [{ id: "anna", name: "Анна" }, { id: "boris", name: "Борис" }], departments: [] };

/** Связь человека с узлом: Mnemos подделан (право, версии, справочник), объект узла — настоящий. */
async function connectAs(principal: string, node: string, texts: Map<string, string>, options: { access?: "read" | "edit"; personal?: boolean; directory?: Directory; textError?: Error; preview?: boolean; reads?: string[] } = {}) {
  const clock = { now: Date.now() };
  let access: "read" | "edit" | "none" = options.access ?? "edit";
  const aborted: string[] = [];
  const ports: MnemosAppPorts = {
    access: async () => { if (access === "none") throw new Error("403"); return { access, principal, tenant: "org-1", name: principal === "anna" ? "Анна" : "Борис", project: "project-1", node, installation: INSTALLATION }; },
    version: async version => { const text = texts.get(version); if (!text) throw new Error("404"); return { sha256: await gadgetAppSha256(text), contentType: "application/vnd.cloudflareos.app+json" }; },
    text: async version => { options.reads?.push(version); if (options.textError) throw options.textError; const text = texts.get(version); if (!text) throw new Error("404"); return { text, sha256: await gadgetAppSha256(text), contentType: "application/vnd.cloudflareos.app+json" }; },
    latestPublished: async () => [...texts.keys()].filter(v => !v.startsWith("private:")).at(-1) ?? null,
    publishedHead: async () => { const id = [...texts.keys()].filter(v => !v.startsWith("private:")).at(-1); return id ? { id, recordedAt: "2026-09-29T10:00:00Z", actor: principal } : null; },
    node: () => { throw new Error("не нужен"); },
    createApp: async () => { throw new Error("не нужен"); },
    saveApp: async () => { throw new Error("не нужен"); },
    forkSources: async () => {},
    directory: async () => options.directory ?? EVERYONE,
    object: name => exports.MnemosAppDurableObject.getByName(name) as unknown as AppObjectPort,
    profileName: async () => principal,
    now: () => clock.now,
    schedule: () => () => {},
    abort: reason => { aborted.push(reason.message); },
    release: () => {},
  };
  const connection = await openMnemosAppConnection(ports, options.personal ?? false, options.preview ?? false);
  return { connection, aborted, revoke: () => { access = "none"; }, later: () => { clock.now += APP_CHECK_MS; } };
}
const refused = (promise: Promise<unknown>) => promise.then(() => "принято", (error: Error) => error.message);

it("два человека видят одно состояние; сервер знает вызывающего; сети нет", async () => {
  const node = "node-" + crypto.randomUUID();
  const texts = new Map([["event-1", gadgetAppText(doc("v1"))]]);
  const anna = await connectAs("anna", node, texts);
  await anna.connection.deploy("event-1");
  const boris = await connectAs("boris", node, texts, { access: "read" });
  const a = await anna.connection.connectToGadget() as Session;
  const b = await boris.connection.connectToGadget() as Session;
  expect(await a.add("купить хлеб")).toBe(1);
  expect(await b.add("позвонить")).toBe(2);
  expect(await a.list()).toEqual([{ by: "anna", text: "купить хлеб" }, { by: "boris", text: "позвонить" }]);
  expect(await b.list()).toEqual(await a.list());
  expect(await a.whoami()).toEqual({ principal: "anna", name: "Анна", access: "edit", directory: true });
  expect(await b.whoami()).toEqual({ principal: "boris", name: "Борис", access: "read", directory: true });
  expect(await a.network()).toBe("blocked");
  expect((await anna.connection.getUiBundle())?.jsCode).toContain("v1");
});

it("участник с черновиком не запускает личную версию в общем экземпляре; объект сам отказывает личной версии", async () => {
  const node = "node-" + crypto.randomUUID();
  const texts = new Map([["event-1", gadgetAppText(doc("v1"))], ["private:mine", gadgetAppText(doc("v-mine"))]]);
  const writer = await connectAs("boris", node, texts, { access: "edit" });
  await writer.connection.deploy("event-1");
  expect(await refused(writer.connection.deploy("private:mine"))).toBe(APP_PUBLISHED_ONLY);
  const object = exports.MnemosAppDurableObject.getByName(mnemosAppObjectName(INSTALLATION, "org-1", "project-1", node)) as unknown as AppObjectPort;
  const text = texts.get("private:mine")!;
  expect(await refused(object.deploy("private:mine", await gadgetAppSha256(text), text, "boris", { kind: "shared", onlyIfEmpty: false, directoryScope: null }))).toBe(APP_PUBLISHED_ONLY);
  expect(await (await writer.connection.connectToGadget() as Session).version()).toBe("v1");
});

it("справочник общего экземпляра — пересечение видимого открывшему (администратор) и запустившему", async () => {
  const node = "node-" + crypto.randomUUID();
  const texts = new Map([["event-1", gadgetAppText(doc("v1"))]]);
  const author = await connectAs("anna", node, texts, { directory: { people: [{ id: "anna", name: "Анна" }, { id: "boris", name: "Борис" }], departments: [{ id: "sales", name: "Продажи", members: [{ id: "anna", name: "Анна" }] }] } });
  await author.connection.deploy("event-1");
  const admin = await connectAs("boris", node, texts, { access: "read", directory: {
    people: [{ id: "anna", name: "Анна" }, { id: "boris", name: "Борис" }, { id: "ceo", name: "Директор" }],
    departments: [{ id: "sales", name: "Продажи", members: [{ id: "anna", name: "Анна" }, { id: "ceo", name: "Директор" }] }, { id: "board", name: "Правление", members: [{ id: "ceo", name: "Директор" }] }],
  } });
  const session = await admin.connection.connectToGadget() as Session;
  expect((await session.people())?.map(p => p.id)).toEqual(["anna", "boris"]);
});

it("общий экземпляр без session() не открывается: объект Gadget странице не отдаётся", async () => {
  const node = "node-" + crypto.randomUUID();
  // Манифест обещает session, код его не объявил: вызов отказывает, обходного пути к объекту Gadget нет.
  const texts = new Map([["event-1", gadgetAppText(doc("v1", { server: LEGACY_SERVER, permissions: [] }))]]);
  const anna = await connectAs("anna", node, texts);
  await anna.connection.deploy("event-1");
  expect(await refused(anna.connection.connectToGadget())).not.toBe("принято");
});

it("свой экземпляр у каждого: данные не общие; гаджет без session() в своём экземпляре работает", async () => {
  const node = "node-" + crypto.randomUUID();
  const texts = new Map([["private:v1", gadgetAppText(doc("v1", { collaborative: false }))]]);
  const anna = await connectAs("anna", node, texts, { personal: true });
  // Соавтор с правом правки: у каждого свой экземпляр. Получатель без правки открывает свою копию (этап 3).
  const boris = await connectAs("boris", node, texts, { personal: true, access: "edit" });
  await anna.connection.deploy("private:v1");
  await boris.connection.deploy("private:v1");
  await (await anna.connection.connectToGadget() as Session).add("анины");
  expect(await (await boris.connection.connectToGadget() as Session).list()).toEqual([]);
  const legacy = new Map([["private:v1", gadgetAppText(doc("v1", { collaborative: false, session: false, server: LEGACY_SERVER, permissions: [] }))]]);
  const solo = await connectAs("anna", "node-" + crypto.randomUUID(), legacy, { personal: true });
  await solo.connection.deploy("private:v1");
  expect(await (await solo.connection.connectToGadget() as { ping(): Promise<string> }).ping()).toBe("pong");
});

it("узлы не видят друг друга", async () => {
  const texts = new Map([["event-1", gadgetAppText(doc("v1"))]]);
  const first = await connectAs("anna", "node-" + crypto.randomUUID(), texts);
  const second = await connectAs("anna", "node-" + crypto.randomUUID(), texts);
  await first.connection.deploy("event-1");
  await second.connection.deploy("event-1");
  await (await first.connection.connectToGadget() as Session).add("только в первом");
  expect(await (await second.connection.connectToGadget() as Session).list()).toEqual([]);
});

it("отзыв доступа во время работы закрывает связь, у остальных работа продолжается", async () => {
  const node = "node-" + crypto.randomUUID();
  const texts = new Map([["event-1", gadgetAppText(doc("v1"))]]);
  const anna = await connectAs("anna", node, texts);
  await anna.connection.deploy("event-1");
  const boris = await connectAs("boris", node, texts, { access: "read" });
  const b = await boris.connection.connectToGadget() as Session;
  await b.add("до отзыва");
  boris.revoke(); boris.later();
  await expect(b.add("после отзыва")).rejects.toThrow(APP_ACCESS_CLOSED);
  expect(boris.aborted).toEqual([APP_ACCESS_CLOSED]);
  const a = await anna.connection.connectToGadget() as Session;
  expect((await a.list()).map(item => item.text)).toEqual(["до отзыва"]);
});

it("первый запуск без права правки — одним шагом в объекте: второй такой запуск отказывает", async () => {
  const object = exports.MnemosAppDurableObject.getByName(mnemosAppObjectName(INSTALLATION, "org-1", "project-1", "node-" + crypto.randomUUID())) as unknown as AppObjectPort;
  const text = gadgetAppText(doc("v1"));
  const sha = await gadgetAppSha256(text);
  const both = await Promise.all([1, 2].map(() => refused(object.deploy("event-1", sha, text, "boris", { kind: "shared", onlyIfEmpty: true, directoryScope: null }))));
  expect(both.sort()).toEqual([APP_ALREADY_RUNNING, "принято"].sort());
});

it("новая версия перезапускает экземпляр и сохраняет данные; журнал пишет открытия и смены кода", async () => {
  const node = "node-" + crypto.randomUUID();
  const texts = new Map([["event-1", gadgetAppText(doc("v1"))], ["event-2", gadgetAppText(doc("v2"))]]);
  const anna = await connectAs("anna", node, texts);
  await anna.connection.deploy("event-1");
  const before = await anna.connection.connectToGadget() as Session;
  await before.add("остаётся");
  await anna.connection.deploy("event-2");
  const after = await anna.connection.connectToGadget() as Session;
  expect(await after.version()).toBe("v2");
  expect((await after.list()).map(item => item.text)).toEqual(["остаётся"]);
  expect(await after.starts()).toBe(2);
  const audit = await (exports.MnemosAppDurableObject.getByName(mnemosAppObjectName(INSTALLATION, "org-1", "project-1", node)) as unknown as { audit(limit: number): Promise<AppAuditEntry[]> }).audit(10);
  expect(audit.map(entry => `${entry.action}:${entry.principal}:${entry.version}`)).toEqual([
    "open:anna:event-2", "deploy:anna:event-2", "open:anna:event-1", "deploy:anna:event-1",
  ]);
});

it("код узла в рабочее место не попадает: гаджет беседы отдаёт свой код для «Сохранить в проект», после привязки код закрыт", async () => {
  const node = "node-" + crypto.randomUUID();
  const texts = new Map([["event-1", gadgetAppText(doc("v1"))]]);
  const anna = await connectAs("anna", node, texts);
  await anna.connection.deploy("event-1");
  const live = await anna.connection.connectToGadget() as Session;
  await live.add("живое");

  const response = await exports.default.fetch(new Request("https://workshop.invalid/api", { headers: { Upgrade: "websocket" } }));
  response.webSocket!.accept();
  const api = newWebSocketRpcSession<PublicApi>(response.webSocket!) as RpcStub<PublicApi>;
  const name = "app" + crypto.randomUUID().replaceAll("-", "");
  const session = await api.authenticate((await api.createAccount(name, name, new Uint8Array([1, 2, 3])))!);
  const overseer = await session.newGadget();
  const gadget = await overseer.createGadget("Приложение");
  expect((await gadget.getMnemosApp()).notExportable).toMatch(/client\.js/);
  // Код гаджета беседы пишется в рабочее место, как его пишет беседа.
  const code = new Y.Doc();
  const files = code.getMap<Y.Text>(String(await gadget.getId()));
  for (const [file, text] of Object.entries(doc("v1").modules)) files.set(file, new Y.Text(text));
  await overseer.updateCode(Y.encodeStateAsUpdateV2(code));
  code.destroy();
  expect((await gadget.getMnemosApp()).notExportable).toBeNull();
  expect((await gadget.exportAppModules()).modules).toEqual(doc("v1").modules);
  // После привязки к узлу код закрыт: выгрузки нет (обратной записи кода узла, restoreAppModules, больше нет).
  await gadget.setMnemosApp({ accountId: 1, scope: "project-1", resource: node, description: "", collaborative: true, session: true, permissions: [], savedVersion: "event-1" });
  // exportAppModules отказывает той же причиной (#appBlocker), её и видит шапка.
  expect((await gadget.getMnemosApp()).notExportable).toBe(APP_CODE_CLOSED);
  // Список гаджетов не отдаёт странице filesRoot гаджета-узла: вкладки «Код» и синхронизации его файлов нет.
  const summaries = new Map<number, WorkpieceSummary>();
  let ready!: () => void;
  const listed = new Promise<void>(resolve => { ready = resolve; });
  class Subscriber extends RpcTarget { entry(summary: WorkpieceSummary) { summaries.set(summary.id, summary); } removed() {} ready() { ready(); } }
  using subscription = await overseer.subscribeToWorkpieces(new Subscriber() as never);
  await listed;
  const id = await gadget.getId();
  expect(summaries.get(id)).toMatchObject({ id, title: "Приложение" });
  expect(summaries.get(id)?.filesRoot).toBeUndefined();
  void subscription;
  // Код в рабочем месте вычищен при привязке; подписка с нуля не проигрывает историю, где он был.
  const secret = 'ctx.storage.kv.put("starts"';
  const updates: Uint8Array[] = [];
  let synced!: () => void;
  const caughtUp = new Promise<void>(resolve => { synced = resolve; });
  class CodeSub extends RpcTarget { update(up: { update: Uint8Array }) { updates.push(up.update); } ready() { synced(); } }
  using codeSubscription = await overseer.subscribeToCode(new CodeSub() as never, 0);
  await caughtUp;
  void codeSubscription;
  const replayed = new Y.Doc();
  for (const update of updates) Y.applyUpdateV2(replayed, update);
  expect([...replayed.getMap(String(id)).keys()]).toEqual([]);
  expect(updates.some(update => new TextDecoder().decode(update).includes(secret))).toBe(false);
  replayed.destroy();
  // Записать код гаджету-узла снова нельзя, шаблон из него не делается.
  const again = new Y.Doc();
  again.getMap<Y.Text>(String(id)).set("server.js", new Y.Text("export class Gadget {}"));
  // Проверка — внутри объекта: отказ через Cap'n Web из объекта рабочего места стенд считает необработанным.
  const workspace = exports.OverseerDurableObject.get(exports.OverseerDurableObject.idFromString((await overseer.getMetadata()).id));
  await runInDurableObject(workspace, async instance => {
    const impl = (instance as unknown as { impl: { updateTouchesClosedCode(u: Uint8Array): boolean; purgeClosedCode(): number | null } }).impl;
    expect(impl.updateTouchesClosedCode(Y.encodeStateAsUpdateV2(again))).toBe(true);
    // Правка другого гаджета не задета; повторная чистка ничего не пишет.
    const other = new Y.Doc(); other.getMap<Y.Text>("999").set("client.js", new Y.Text("ui()"));
    expect(impl.updateTouchesClosedCode(Y.encodeStateAsUpdateV2(other))).toBe(false);
    other.destroy();
    expect(impl.purgeClosedCode()).toBeNull();
  });
  again.destroy();

  // Старое рабочее место: код узла уже лежит в гаджете, привязка записана раньше чистки. Первая же
  // подписка вычищает его и не проигрывает историю.
  const legacy = await overseer.createGadget("Старое приложение");
  const legacyId = await legacy.getId();
  const legacyCode = new Y.Doc();
  for (const [file, text] of Object.entries(doc("v1").modules)) legacyCode.getMap<Y.Text>(String(legacyId)).set(file, new Y.Text(text));
  await overseer.updateCode(Y.encodeStateAsUpdateV2(legacyCode));
  legacyCode.destroy();
  await runInDurableObject(workspace, async instance => {
    const impl = (instance as unknown as { impl: { storage: { gadgets: { get(id: number): Record<string, unknown>; put(r: unknown): void } } } }).impl;
    const record = impl.storage.gadgets.get(legacyId);
    impl.storage.gadgets.put({ ...record, mnemosApps: { someone: { accountId: 1, scope: "project-1", resource: node, description: "", collaborative: true, session: true, permissions: [] } } });
  });
  const legacyUpdates: Uint8Array[] = [];
  let legacySynced!: () => void;
  const legacyCaughtUp = new Promise<void>(resolve => { legacySynced = resolve; });
  class LegacySub extends RpcTarget { update(up: { update: Uint8Array }) { legacyUpdates.push(up.update); } ready() { legacySynced(); } }
  using legacySubscription = await overseer.subscribeToCode(new LegacySub() as never, 0);
  await legacyCaughtUp;
  void legacySubscription;
  const legacyReplay = new Y.Doc();
  for (const update of legacyUpdates) Y.applyUpdateV2(legacyReplay, update);
  expect([...legacyReplay.getMap(String(legacyId)).keys()]).toEqual([]);
  expect(legacyUpdates.some(update => new TextDecoder().decode(update).includes(secret))).toBe(false);
  legacyReplay.destroy();
  // Общий экземпляр узла это не трогает.
  expect(await live.list()).toEqual([{ by: "anna", text: "живое" }]);
  expect(await live.starts()).toBe(1);
});

it("объект узла сам сверяет сумму кода и отказывает несовместному приложению", async () => {
  const object = exports.MnemosAppDurableObject.getByName(mnemosAppObjectName(INSTALLATION, "org-1", "project-1", "node-" + crypto.randomUUID())) as unknown as AppObjectPort;
  const text = gadgetAppText(doc("v1"));
  const shared = { kind: "shared" as const, onlyIfEmpty: false, directoryScope: null };
  expect(await refused(object.deploy("event-1", "0".repeat(64), text, "anna", shared))).toMatch(/не совпадает/);
  const solo = gadgetAppText(doc("v1", { collaborative: false }));
  expect(await refused(object.deploy("event-1", await gadgetAppSha256(solo), solo, "anna", shared))).toMatch(/не совместное/);
  expect(await object.state()).toEqual({ deployed: null });
});

it("служебный путь кода не настроен или отказал: человек видит причину, а не «версия повреждена»", async () => {
  const node = "node-" + crypto.randomUUID();
  const texts = new Map([["event-1", gadgetAppText(doc("v1"))]]);
  const missing = await connectAs("anna", node, texts, { textError: new Error("Запуск гаджетов не настроен: нет ключа оболочки.") });
  expect(await refused(missing.connection.deploy("event-1"))).toBe("Запуск гаджетов не настроен: нет ключа оболочки.");
  expect(await refused(missing.connection.manifest("event-1"))).toBe("Запуск гаджетов не настроен: нет ключа оболочки.");
  const denied = await connectAs("anna", node, texts, { textError: new Error("Приложение вам недоступно: нет доступа к этой версии файла.") });
  expect(await refused(denied.connection.deploy("event-1"))).toBe("Приложение вам недоступно: нет доступа к этой версии файла.");
  // Прочие сбои (сеть, повреждение) — прежним общим текстом без подробностей.
  const other = await connectAs("anna", node, texts, { textError: new Error("Mnemos request failed") });
  expect(await refused(other.connection.deploy("event-1"))).toBe("Версия приложения недоступна или повреждена.");
});

it("предпросмотр личной версии: отдельный экземпляр со своей базой, общий не трогается; версия — private: правами человека; читателю нельзя", async () => {
  const node = "node-" + crypto.randomUUID();
  const head = "f".repeat(64);
  const texts = new Map([["event-1", gadgetAppText(doc("v1"))], [`private:${head}`, gadgetAppText(doc("v2-личная"))]]);
  const anna = await connectAs("anna", node, texts);
  await anna.connection.deploy("event-1");
  await (await anna.connection.connectToGadget() as Session).add("общее");

  const reads: string[] = [];
  const preview = await connectAs("anna", node, texts, { preview: true, reads });
  await preview.connection.deploy(`private:${head}`);
  expect(reads).toContain(`private:${head}`);
  const screen = await preview.connection.connectToGadget() as Session;
  expect(await screen.version()).toBe("v2-личная");
  expect(await screen.list()).toEqual([]);
  await screen.add("проба");
  // Общий экземпляр — прежняя версия и прежние данные.
  const shared = await anna.connection.connectToGadget() as Session;
  expect(await shared.version()).toBe("v1");
  expect((await shared.list()).map(i => i.text)).toEqual(["общее"]);
  expect((await preview.connection.describe()).deployed?.version).toBe(`private:${head}`);
  expect((await anna.connection.describe()).deployed?.version).toBe("event-1");

  // Читатель: предпросмотр не открывается вовсе.
  expect(await refused(connectAs("boris", node, texts, { access: "read", preview: true }))).toBe(APP_PREVIEW_EDIT_ONLY);
  // Своё приложение в предпросмотр не идёт.
  const solo = new Map([["event-1", gadgetAppText(doc("v1", { collaborative: false }))]]);
  const soloPreview = await connectAs("anna", "node-" + crypto.randomUUID(), solo, { preview: true });
  expect(await refused(soloPreview.connection.deploy("event-1"))).toMatch(/предпросмотр ему не нужен/);
});
