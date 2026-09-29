import { test } from "node:test";
import assert from "node:assert/strict";
import { GADGET_APP_MIME, parseGadgetAppText } from "@gadgets/workshop-shared/gadget-app";
import { GadgetBuildError, saveGadgetBuild, type GadgetSaveAPI } from "./gadget-bridge.ts";
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
  assert.deepEqual(saved, { resource: "node-1", head: NEW_HEAD, title: "Дела команды", collaborative: true, session: true, created: true });
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
