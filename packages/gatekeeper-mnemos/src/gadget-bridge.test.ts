import { test } from "node:test";
import assert from "node:assert/strict";
import { GADGET_APP_MIME, gadgetAppSha256, gadgetAppText, parseGadgetAppText } from "@gadgets/workshop-shared/gadget-app";
import { GadgetBuildError, gadgetDocumentFromBuild, checkGadgetEditable, checkGadgetCopyBuild, gadgetReceipts, saveGadgetBuild, validGadgetRequest, type GadgetSaveAPI } from "./gadget-bridge.ts";
import { MnemosAPIError } from "./mnemos-api.ts";
import { WorkspaceClient, WorkspaceError, type WorkspaceGadgetBuild } from "./workspace-tasks.ts";

const STORAGE = "https://storage.example";
const HEAD = "a".repeat(64), NEW_HEAD = "b".repeat(64);
const CLIENT = "(()=>{document.body.textContent='Дела'})();";
const SERVER = "import {DurableObject} from 'cloudflare:workers';export class Gadget extends DurableObject{session(c){return {}}}";

async function hex(text: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...d].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function b64sum(bytes: Uint8Array) { return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))); }

function build(extra: Partial<WorkspaceGadgetBuild["manifest"]> = {}, server = SERVER): WorkspaceGadgetBuild {
  return { manifest: { name: "Дела команды", description: "Общий список", collaborative: true, permissions: ["directory"], ...extra }, modules: { "client.js": CLIENT, "server.js": server } };
}

/** Сессия Mnemos человека: запоминает вызовы, узел гаджета существует после создания. */
function api(existing: { content_type: string } | null = null) {
  const calls: unknown[][] = [];
  const uploads: Uint8Array[] = [];
  const value: GadgetSaveAPI = {
    async openDraft(project) { calls.push(["openDraft", project]); return { head: HEAD } as never; },
    async beginNativeUpload(project, size, checksum) {
      calls.push(["beginNativeUpload", project, size]);
      return { upload_id: "up-1", url: STORAGE + "/bucket/obj?sig=1", method: "PUT", checksum_header: "x-amz-checksum-sha256", checksum_value: checksum, content_length: size };
    },
    async createPrivateDocument(project, request) { calls.push(["createPrivateDocument", project, request]); return { node_id: "node-1", head: NEW_HEAD }; },
    async readDraftDocument(project, node) {
      calls.push(["readDraftDocument", project, node]);
      return { node_id: node, exists: !!existing, conflicted: false, content_type: existing?.content_type ?? "", head: HEAD, terms: [] } as never;
    },
    async saveDraftDocument(project, node, upload, head) { calls.push(["saveDraftDocument", project, node, upload, head]); return { head: NEW_HEAD }; },
  };
  const fetcher = (async (url: URL, init: RequestInit) => {
    calls.push(["PUT", String(url), init.method]);
    const body = init.body as Uint8Array;
    assert.equal((init.headers as Record<string, string>)["x-amz-checksum-sha256"], await b64sum(body));
    uploads.push(body);
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  return { api: value, calls, uploads, fetcher };
}

test("Сборка ложится новым узлом приложения личной версией; session — из кода сервера", async () => {
  const { api: session, calls, uploads, fetcher } = api();
  const saved = await saveGadgetBuild(session, STORAGE, fetcher, "p", build(), undefined, "request-1");
  // Сумма версии — от тех же байтов, что легли в узел: её же отдаёт app-code и сверяет экземпляр.
  assert.deepEqual(saved, { resource: "node-1", head: NEW_HEAD, title: "Дела команды", description: "Общий список", collaborative: true, session: true, created: true, bodySha256: await gadgetAppSha256(new TextDecoder().decode(uploads[0])) });
  assert.equal(saved.bodySha256, [...new Uint8Array(await crypto.subtle.digest("SHA-256", uploads[0]))].map(b => b.toString(16).padStart(2, "0")).join(""));
  const create = calls.find(c => c[0] === "createPrivateDocument")![2] as Record<string, unknown>;
  assert.equal(create.content_type, GADGET_APP_MIME);
  assert.equal(create.expected_head, HEAD);
  assert.equal(create.upload_id, "up-1");
  assert.equal(create.name, "Дела команды");
  assert.equal(calls.some(c => c[0] === "saveDraftDocument"), false);
  const { document } = parseGadgetAppText(new TextDecoder().decode(uploads[0]));
  assert.deepEqual(document.manifest, { title: "Дела команды", description: "Общий список", collaborative: true, session: true, formatVersion: 1, permissions: ["directory"] });
  assert.equal(document.modules["client.js"], CLIENT);
  assert.equal(document.modules["server.js"], SERVER);
});

test("Повторная правка — новая версия того же узла от текущей головы, без нового узла", async () => {
  const { api: session, calls, uploads, fetcher } = api({ content_type: GADGET_APP_MIME });
  const saved = await saveGadgetBuild(session, STORAGE, fetcher, "p", build({ name: "Дела команды 2" }), "node-1");
  assert.equal(saved.created, false);
  assert.equal(saved.resource, "node-1");
  assert.deepEqual(calls.find(c => c[0] === "saveDraftDocument"), ["saveDraftDocument", "p", "node-1", "up-1", HEAD]);
  assert.equal(calls.some(c => c[0] === "createPrivateDocument" || c[0] === "openDraft"), false);
  assert.equal(parseGadgetAppText(new TextDecoder().decode(uploads[0])).document.manifest.title, "Дела команды 2");
});

test("Битая сборка и чужой файл не записываются", async () => {
  const cases: [string, WorkspaceGadgetBuild, string | undefined, { content_type: string } | null][] = [
    ["общий без session()", build({}, "export class Gadget {}"), undefined, null],
    ["неизвестное разрешение", build({ permissions: ["network"] }), undefined, null],
    ["многострочное название", build({ name: "Дела\nкоманды" }), undefined, null],
    ["пустой клиент", { ...build(), modules: { "client.js": " ", "server.js": SERVER } }, undefined, null],
  ];
  for (const [name, value, resource, existing] of cases) {
    const { api: session, calls, fetcher } = api(existing);
    await assert.rejects(saveGadgetBuild(session, STORAGE, fetcher, "p", value, resource), GadgetBuildError, name);
    assert.deepEqual(calls, [], `${name}: ничего не выгружено и не записано`);
  }
  const other = api({ content_type: "application/vnd.cloudflareos.document+json" });
  await assert.rejects(saveGadgetBuild(other.api, STORAGE, other.fetcher, "p", build(), "node-9"), /заменён другим файлом/);
  assert.equal(other.calls.some(c => c[0] === "beginNativeUpload" || c[0] === "saveDraftDocument"), false, "документ не перезаписан гаджетом");
});

test("Адрес выгрузки вне хранилища установки отклоняется до отправки тела", async () => {
  const { api: session, calls, fetcher } = api();
  session.beginNativeUpload = async (_p, size, checksum) => ({ upload_id: "up-1", url: "https://evil.example/x", method: "PUT", checksum_header: "x-amz-checksum-sha256", checksum_value: checksum, content_length: size });
  await assert.rejects(saveGadgetBuild(session, STORAGE, fetcher, "p", build()), /неожиданный адрес/);
  assert.equal(calls.some(c => c[0] === "PUT" || c[0] === "createPrivateDocument"), false);
});

function client(respond: (url: string) => Response) {
  const urls: string[] = [];
  const fetcher = (async (url: string) => { urls.push(url); return respond(url); }) as unknown as typeof fetch;
  return { client: new WorkspaceClient("https://ws.example", "service-token", fetcher), urls };
}

test("Клиент службы: сборка с привязкой агента, суммы сверяются заново, отказы службы — словами", async () => {
  const good = { manifest: { name: "Дела", description: "", collaborative: false, permissions: [] },
    files: { "client.js": { size: new TextEncoder().encode(CLIENT).length, sha256: await hex(CLIENT) }, "server.js": { size: new TextEncoder().encode(SERVER).length, sha256: await hex(SERVER) } },
    modules: { "client.js": CLIENT, "server.js": SERVER } };
  const ok = client(() => Response.json(good));
  const got = await ok.client.gadgetBuild("0123456789abcdef", "bind/1");
  assert.equal(got.modules["server.js"], SERVER);
  assert.equal(ok.urls[0], "https://ws.example/v1/workspace/tasks/0123456789abcdef/gadget?binding_id=bind%2F1");

  const tampered = client(() => Response.json({ ...good, modules: { "client.js": CLIENT.replace("Дела", "Дело"), "server.js": SERVER } }));
  await assert.rejects(tampered.client.gadgetBuild("0123456789abcdef", "b"), (e: WorkspaceError) => e.code === "bad_build");
  const extra = client(() => Response.json({ ...good, modules: { ...good.modules, "extra.js": "x" } }));
  await assert.rejects(extra.client.gadgetBuild("0123456789abcdef", "b"), (e: WorkspaceError) => e.code === "bad_build");

  const bad = client(() => Response.json({ error: "bad_build", message: "client.js не совпадает с суммой" }, { status: 409 }));
  await assert.rejects(bad.client.gadgetBuild("0123456789abcdef", "b"), (e: WorkspaceError) => e.code === "bad_build" && e.message.includes("client.js не совпадает"));
  const none = client(() => Response.json({ error: "no_build", message: "нет dist/client.js — сначала pnpm build" }, { status: 409 }));
  await assert.rejects(none.client.gadgetBuild("0123456789abcdef", "b"), (e: WorkspaceError) => e.code === "no_build" && e.message.includes("pnpm build"));
  const foreign = client(() => new Response("", { status: 404 }));
  await assert.rejects(foreign.client.gadgetBuild("0123456789abcdef", "b"), (e: WorkspaceError) => e.code === "not_found");
});

/** Mnemos с долговечным повтором по request_id: тот же request_id и то же тело — тот же узел. */
function replayingApi(options: { loseFirstAnswer?: boolean } = {}) {
  const base = api({ content_type: GADGET_APP_MIME });
  const created = new Map<string, { node: string; body: string }>();
  let nodes = 0, lose = options.loseFirstAnswer === true;
  base.api.createPrivateDocument = async (project, request) => {
    base.calls.push(["createPrivateDocument", project, request]);
    const body = JSON.stringify(request), known = created.get(request.request_id);
    if (known && known.body !== body) throw new MnemosAPIError(409);
    const node = known?.node ?? `node-${++nodes}`;
    created.set(request.request_id, { node, body });
    if (lose) { lose = false; throw new TypeError("Network connection lost."); }
    return { node_id: node, head: NEW_HEAD };
  };
  return { ...base, nodes: () => nodes };
}

function memoryKv() {
  const map = new Map<string, unknown>();
  return { map, kv: { get: <T>(k: string) => map.get(k) as T | undefined, put: <T>(k: string, v: T) => { map.set(k, structuredClone(v)); }, delete: (k: string) => { map.delete(k); } } };
}

test("Повтор создания после потерянного ответа даёт тот же узел, а не второй", async () => {
  const mnemos = replayingApi({ loseFirstAnswer: true });
  const { kv } = memoryKv();
  const receipts = gadgetReceipts(kv);
  await assert.rejects(saveGadgetBuild(mnemos.api, STORAGE, mnemos.fetcher, "p", build(), undefined, "chat-request-1", receipts), /Network connection lost/);
  assert.equal(mnemos.nodes(), 1, "узел создан, ответ потерян");
  const again = await saveGadgetBuild(mnemos.api, STORAGE, mnemos.fetcher, "p", build(), undefined, "chat-request-1", receipts);
  assert.equal(again.resource, "node-1");
  assert.equal(again.created, true);
  assert.equal(mnemos.nodes(), 1, "второй узел не создан");
  const creates = mnemos.calls.filter(c => c[0] === "createPrivateDocument").map(c => c[2]);
  assert.equal(creates.length, 2);
  assert.deepEqual(creates[1], creates[0], "повтор — то же тело с тем же request_id");
  assert.equal(mnemos.calls.filter(c => c[0] === "openDraft").length, 1, "повтор не открывает черновик заново");
  assert.equal(mnemos.calls.some(c => c[0] === "saveDraftDocument"), false, "та же сборка не пишет лишнюю версию");

  // Сборка изменилась, пока ответ терялся: тот же узел получает её новой версией.
  const third = await saveGadgetBuild(mnemos.api, STORAGE, mnemos.fetcher, "p", build({ name: "Дела команды 2" }), undefined, "chat-request-1", receipts);
  assert.equal(third.resource, "node-1");
  assert.equal(mnemos.nodes(), 1);
  assert.deepEqual(mnemos.calls.filter(c => c[0] === "saveDraftDocument").map(c => c[2]), ["node-1"]);
});

test("Квитанция без узла: отказ 4xx — новый узел со свежим request_id, сбой 5xx — квитанция ждёт", async () => {
  const mnemos = replayingApi();
  const { kv, map } = memoryKv();
  const receipts = gadgetReceipts(kv);
  receipts.put("chat-request-2", { project: "p", sha: "x", body: { request_id: "stale-request", expected_head: HEAD, parent_id: "", name: "Дела", content_type: GADGET_APP_MIME, upload_id: "expired", message: "m" } });
  mnemos.api.createPrivateDocument = (orig => async (project: string, request: Parameters<GadgetSaveAPI["createPrivateDocument"]>[1]) => {
    if (request.request_id === "stale-request") throw new MnemosAPIError(404);
    return orig(project, request);
  })(mnemos.api.createPrivateDocument);
  const saved = await saveGadgetBuild(mnemos.api, STORAGE, mnemos.fetcher, "p", build(), undefined, "chat-request-2", receipts);
  const fresh = mnemos.calls.filter(c => c[0] === "createPrivateDocument").map(c => (c[2] as { request_id: string }).request_id);
  assert.equal(fresh.length, 1);
  assert.notEqual(fresh[0], "stale-request");
  assert.equal(saved.resource, "node-1");
  assert.equal(receipts.get("chat-request-2")?.node, "node-1");

  const down = replayingApi();
  receipts.put("chat-request-3", { project: "p", sha: "x", body: { request_id: "r3", expected_head: HEAD, parent_id: "", name: "Дела", content_type: GADGET_APP_MIME, upload_id: "u", message: "m" } });
  down.api.createPrivateDocument = async () => { throw new MnemosAPIError(503); };
  await assert.rejects(saveGadgetBuild(down.api, STORAGE, down.fetcher, "p", build(), undefined, "chat-request-3", receipts));
  assert.equal(down.calls.some(c => c[0] === "openDraft"), false, "при сбое Mnemos новый узел не создаётся");
  assert.equal(receipts.get("chat-request-3")?.body.request_id, "r3");
  // Квитанция другого проекта не используется.
  const other = replayingApi();
  await saveGadgetBuild(other.api, STORAGE, other.fetcher, "q", build(), undefined, "chat-request-2", receipts);
  assert.equal(other.calls.filter(c => c[0] === "createPrivateDocument").length, 1);
  assert.equal((other.calls.find(c => c[0] === "createPrivateDocument")![2] as { request_id: string }).request_id, "chat-request-2");
  assert.ok([...map.keys()].includes("gadgetCreateIndex"));
});

test("Квитанций хранится не больше ста; ключ квитанции проверяется", () => {
  const { kv, map } = memoryKv();
  const receipts = gadgetReceipts(kv);
  for (let i = 0; i < 105; i++) receipts.put(`request-${String(i).padStart(4, "0")}`, { project: "p", sha: "s", body: {} as never });
  assert.equal([...map.keys()].filter(k => k.startsWith("gadgetCreate:")).length, 100);
  assert.equal(receipts.get("request-0000"), undefined);
  assert.ok(receipts.get("request-0104"));
  for (const bad of ["", "short", "a/b-cdefghij", "x".repeat(101), 5]) assert.equal(validGadgetRequest(bad), false, String(bad));
  assert.equal(validGadgetRequest(crypto.randomUUID()), true);
});

test("Правка сохранённого гаджета: только существующий узел приложения в личной ветке", async () => {
  for (const [name, existing] of [["удалён", null], ["документ", { content_type: "application/vnd.cloudflareos.document+json" }]] as const) {
    const { api: session } = api(existing);
    await assert.rejects(checkGadgetEditable(session, "p", "node-1"), /удалён, в конфликте или заменён/, name);
  }
  const conflicted = api({ content_type: GADGET_APP_MIME });
  conflicted.api.readDraftDocument = async (_p, node) => ({ node_id: node, exists: true, conflicted: true, content_type: GADGET_APP_MIME, head: HEAD, terms: [] }) as never;
  await assert.rejects(checkGadgetEditable(conflicted.api, "p", "node-1"), /в конфликте/);
  const ok = api({ content_type: GADGET_APP_MIME });
  assert.equal((await checkGadgetEditable(ok.api, "p", "node-1")).head, HEAD);
  const sum = "c".repeat(64);
  await checkGadgetCopyBuild(ok.api, "p", "node-1", sum, async head => { assert.equal(head, HEAD); return sum; });
  await assert.rejects(checkGadgetCopyBuild(ok.api, "p", "node-1", sum, async () => "d".repeat(64)), /Версия копии изменилась/);
  let codeReads = 0;
  await assert.rejects(checkGadgetCopyBuild(conflicted.api, "p", "node-1", sum, async () => { codeReads++; return sum; }), /в конфликте/);
  assert.equal(codeReads, 0, "без права правки сумма исходников не читается");
});

test("Отказ Mnemos при сохранении называет этап и код ответа, а не «Mnemos request failed»", async () => {
  const { api: session, fetcher } = api();
  session.openDraft = async () => { throw new MnemosAPIError(401); };
  await assert.rejects(saveGadgetBuild(session, STORAGE, fetcher, "p", build()), (error: Error) =>
    /шаге «открытие личной ветки проекта»/.test(error.message) && /HTTP 401/.test(error.message) && /сохранить ещё раз/.test(error.message));
  const second = api();
  second.api.createPrivateDocument = async () => { throw new MnemosAPIError(503); };
  await assert.rejects(saveGadgetBuild(second.api, STORAGE, second.fetcher, "p", build()), /шаге «создание файла в проекте».*HTTP 503/);
  // Понятные отказы с кодом не переписываются.
  const third = api();
  third.api.openDraft = async () => { throw new MnemosAPIError(429, "request.rate_limit"); };
  await assert.rejects(saveGadgetBuild(third.api, STORAGE, third.fetcher, "p", build()), (error: unknown) => error instanceof MnemosAPIError);
});

test("Прежняя сборка после неудачной правки не выгружается и не создаёт пустую версию", async () => {
  const { api: session, calls, fetcher } = api({ content_type: GADGET_APP_MIME });
  const checksum = await gadgetAppSha256(gadgetAppText(gadgetDocumentFromBuild(build())));
  const kept: unknown[][] = [];
  await assert.rejects(saveGadgetBuild(session, STORAGE, fetcher, "p", build(), "node-1", undefined, undefined, async (node, head) => {
    assert.equal(node, "node-1");
    assert.equal(head, HEAD);
    return checksum;
  }, async (node, sum) => { kept.push([node, sum]); }), /Сборка гаджета не изменилась/);
  assert.deepEqual(kept, [["node-1", checksum]], "исходники сохраняются и без новой версии сборки");
  assert.equal(calls.some(c => c[0] === "beginNativeUpload" || c[0] === "saveDraftDocument" || c[0] === "PUT"), false);
  const saved = await saveGadgetBuild(session, STORAGE, fetcher, "p", build(), "node-1", undefined, undefined, async () => "0".repeat(64));
  assert.equal(saved.head, NEW_HEAD);
  assert.equal(calls.some(c => c[0] === "saveDraftDocument"), true);
});
