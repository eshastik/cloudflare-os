import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { MnemosAPIError } from "./mnemos-api.ts";

// Node не знает модуль cloudflare:workers; DO и RpcTarget здесь — пустые базовые классы.
const WORKERS_SHIM = "data:text/javascript," + encodeURIComponent(
  "export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}" +
  "export class RpcTarget{}export class RpcStub{}export class WorkerEntrypoint{}");
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers") return { url: WORKERS_SHIM, shortCircuit: true };
    return next(specifier, context);
  },
});
const { MnemosLibrary } = await import("./agent-library.ts");

const TOKEN = "fixture-secret-token";
const PROJECTS = [{ id: "p1", name: "Продажи", slug: "sales" }, { id: "p2", name: "Архив", slug: "archive" }];
const NODES = [
  { node_id: "dir", name: "docs", is_dir: true },
  { node_id: "n1", parent_id: "dir", name: "plan.md", is_dir: false },
  { node_id: "n2", name: "readme.md", is_dir: false },
];
const HEAD_A = "a".repeat(64), HEAD_B = "b".repeat(64), HEAD_S = "c".repeat(64);
const BEFORE = "# План\n\nПервый абзац.\n\n## Сроки\n\nСдать в марте.\n";
const AFTER = "# План\n\nПервый абзац.\n\n## Сроки\n\nСдать в апреле.\n\n## Риски\n\nНет данных.\n";
const STORAGE = "https://objects.example";

async function sha256(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return { hex: Array.from(digest, b => b.toString(16).padStart(2, "0")).join(""), base64: btoa(String.fromCharCode(...digest)) };
}

const AGENT_NAME = "Агент Workshop";

interface Fixture {
  calls: string[]; revoked: boolean; agentRevoked: boolean; denyRead: boolean; projects: { id: string; name: string; slug: string }[];
  emptyProject?: boolean; openHead?: string; personalExists: boolean; personalHead: string; sharedHead: string; draftText: string;
  tenants: Record<string, string>;
}

function fixture(overrides: Partial<Fixture> = {}) {
  const state: Fixture = {
    calls: [], revoked: false, agentRevoked: false, denyRead: false, projects: PROJECTS,
    personalExists: true, personalHead: HEAD_A, sharedHead: HEAD_S, draftText: BEFORE, tenants: {}, ...overrides,
  };
  const reader = {
    async listProjects() { state.calls.push("listProjects"); return { projects: state.projects }; },
    async browseProject(project: string, cursor: string) { state.calls.push(`browse:${project}:${cursor}`); return { nodes: NODES, truncated: false }; },
    async searchProject(project: string, query: string) {
      state.calls.push(`search:${project}:${query}`);
      return { hits: [{ project_id: project, node_id: "n1", name: "plan.md", text: "план", ordinal: 0 }], index_pending: false, degraded: false };
    },
    async nodeHistory(project: string, node: string) {
      state.calls.push(`history:${project}:${node}`);
      if (state.denyRead) throw new MnemosAPIError(403);
      return { events: [{ event_id: "ev1", exists: true }] };
    },
    async readProjectDocument(project: string, node: string) {
      state.calls.push(`read:${project}:${node}`);
      if (state.denyRead) throw new MnemosAPIError(403);
      return { node_id: node, text: "Текст документа", media_type: "text/markdown", truncated: false };
    },
    async draftState(project: string) {
      state.calls.push(`draftState:${project}`);
      if(state.emptyProject)throw new MnemosAPIError(404);
      return { personal_exists: state.personalExists, personal_head: state.personalExists ? state.personalHead : "", shared_head: state.sharedHead };
    },
    async openDraft(project: string) {
      state.calls.push(`openDraft:${project}`);
      state.personalExists = true; state.personalHead = state.openHead ?? state.sharedHead;
      return { head: state.personalHead };
    },
    async readDraftDocument(project: string, node: string) {
      state.calls.push(`draftDoc:${project}:${node}`);
      const exists = NODES.some(n => n.node_id === node && !n.is_dir);
      return { head: state.personalHead, node_id: node, exists, conflicted: false, content_type: exists ? "text/markdown" : undefined,
        terms: exists ? [{ present: true, negative: false, metadata: { name: "plan.md", parent_id: "dir", content_type: "text/markdown" } }] : [] };
    },
    async saveDraftDocument(project: string, node: string, upload: string, expected: string) {
      state.calls.push(`save:${project}:${node}:${upload}:${expected}`);
      if (expected !== state.personalHead) throw new MnemosAPIError(409);
      state.personalHead = HEAD_B; state.draftText = uploads.get(upload) ?? "";
      return { head: HEAD_B };
    },
    [Symbol.dispose]() { state.calls.push("dispose"); },
  };
  const uploads = new Map<string, string>();
  const app = {
    iframeHtml: "<html></html>",
    ui: reader,
    textUploads: { storageOrigin: STORAGE, issuer: {
      async issue(project: string, size: number, checksum: string) {
        state.calls.push(`upload:${project}:${size}`);
        const id = `u${uploads.size + 1}`;
        return { upload_id: id, url: `${STORAGE}/put/${id}`, method: "PUT", checksum_header: "x-amz-checksum-sha256", checksum_value: checksum, content_length: size };
      },
      [Symbol.dispose]() { state.calls.push("dispose:uploads"); },
    } },
    textDownloads: { storageOrigin: STORAGE, issuer: {
      async issue(project: string, node: string, version: string, side: number) {
        state.calls.push(`download:${project}:${node}:${version}:${side}`);
        const bytes = new TextEncoder().encode(state.draftText);
        return { head: version, node_id: node, term_index: side, url: `${STORAGE}/get/${node}`, method: "GET", size_bytes: bytes.length, sha256_hex: (await sha256(bytes)).hex, expires_at: "" };
      },
      [Symbol.dispose]() { state.calls.push("dispose:downloads"); },
    } },
    [Symbol.dispose]() { state.calls.push("dispose:app"); },
  };
  // Путь агента: те же методы, но под агентским credential; вызовы помечены префиксом agent:.
  const agentUi = {
    async createPrivateDocument(project: string, request: {expected_head:string;upload_id:string;name:string;parent_id:string}) {
      state.calls.push(`agent:create:${project}:${request.parent_id}:${request.name}`);
      if(request.expected_head!==state.personalHead) throw new MnemosAPIError(409);
      state.personalHead=HEAD_B; state.draftText=uploads.get(request.upload_id)??"";
      return {node_id:"created-node",head:HEAD_B};
    },
    async draftState(project: string) {
      state.calls.push(`agent:draftState:${project}`);
      return { personal_exists: state.personalExists, personal_head: state.personalExists ? state.personalHead : "", shared_head: state.sharedHead };
    },
    async openDraft(project: string) {
      state.calls.push(`agent:openDraft:${project}`); state.emptyProject=false;
      if(!state.personalExists)state.personalHead=state.openHead??state.sharedHead;
      state.personalExists=true;return {head:state.personalHead};
    },
    async saveDraftDocument(project: string, node: string, upload: string, expected: string) {
      state.calls.push(`agent:save:${project}:${node}:${upload}:${expected}`);
      if (expected !== state.personalHead) throw new MnemosAPIError(409);
      state.personalHead = HEAD_B; state.draftText = uploads.get(upload) ?? "";
      return { head: HEAD_B };
    },
    [Symbol.dispose]() { state.calls.push("dispose:agent"); },
  };
  const agent = {
    connectionName: AGENT_NAME,
    ui: agentUi,
    textUploads: { storageOrigin: STORAGE, issuer: {
      async issue(project: string, size: number, checksum: string) {
        state.calls.push(`agent:upload:${project}:${size}`);
        const id = `u${uploads.size + 1}`;
        return { upload_id: id, url: `${STORAGE}/put/${id}`, method: "PUT", checksum_header: "x-amz-checksum-sha256", checksum_value: checksum, content_length: size };
      },
      [Symbol.dispose]() { state.calls.push("dispose:agent-uploads"); },
    } },
    [Symbol.dispose]() { state.calls.push("dispose:agent-app"); },
  };
  const account = {
    async openManagementSession() {
      state.calls.push("open");
      if (state.revoked) throw new MnemosAPIError(401);
      return reader;
    },
    async startAppUi() {
      state.calls.push("startAppUi");
      if (state.revoked) throw new MnemosAPIError(401);
      return app;
    },
    async workshopAgent() {
      state.calls.push("workshopAgent");
      if (state.revoked || state.agentRevoked) throw new MnemosAPIError(401);
      return { connectionName: AGENT_NAME };
    },
    async startWorkshopAgent() {
      state.calls.push("startWorkshopAgent");
      if (state.revoked || state.agentRevoked) throw new MnemosAPIError(401);
      return agent;
    },
    async connectionIdentity() { return { subject: { tenant_id: "org", user_id: "alice" }, connectionName: JSON.stringify(["org", "alice"]) }; },
  };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    state.calls.push(`fetch:${init?.method ?? "GET"}:${url.pathname}`);
    if (init?.method === "PUT") {
      const body = init.body as Uint8Array;
      uploads.set(url.pathname.split("/").at(-1)!, new TextDecoder().decode(body));
      return new Response(null, { status: 200 });
    }
    return new Response(new TextEncoder().encode(state.draftText), { status: 200 });
  }) as typeof fetch;
  const kv = new Map<string, unknown>();
  const ctx = {
    props: { userObjectId: "owner-object-id" },
    storage: { kv: {
      get: (k: string) => kv.get(k), put: (k: string, v: unknown) => { kv.set(k, v); }, delete: (k: string) => { kv.delete(k); },
      list: (options?: { prefix?: string }) => [...kv.entries()].filter(([k]) => !options?.prefix || k.startsWith(options.prefix)),
    } },
    exports: { UserAccount: { idFromString: (s: string) => s, get: () => account } },
  };
  const library = new MnemosLibrary(ctx as any, { MNEMOS_API_ORIGIN: "https://memory.example" } as any);
  return { library, state, uploads, kv };
}

function authorizer(state: Fixture, deny = false) {
  const seen: { title: string; description: string; excludeObservers?: string[] }[] = [];
  const submitted: { action: number; description: { title: string; description: string; implementsRevert: boolean } }[] = [];
  const stub = {
    seen, submitted,
    async authorizeObservation(description: { title: string; description: string; excludeObservers?: string[] }) {
      state.calls.push("authorize");
      seen.push(description);
      if (deny) throw new Error("Наблюдение отклонено");
    },
    async submitAction(action: number, description: { title: string; description: string; implementsRevert: boolean }) {
      state.calls.push(`submit:${action}`);
      submitted.push({ action, description });
    },
    dup() { return stub; },
    [Symbol.dispose]() {},
  };
  return stub;
}

/** Верификатор наблюдателя: тенант задан фикстурой, чтение публикации — флагом. */
function verifier(tenant: string, canRead = true) {
  return { async sameTenant(id: string) { return id === tenant; }, async canReadPublication() { return canRead; } };
}

const writeCalls = (state: Fixture) => state.calls.filter(c => /^(agent:)?(save|upload|openDraft):/.test(c) || c.startsWith("fetch:PUT"));
/** Вызовы записи под bearer человека: их быть не должно вовсе. */
const humanWriteCalls = (state: Fixture) => state.calls.filter(c => /^(save|upload|openDraft):/.test(c));

test("describe ресурса и типы для агента", async () => {
  const { library } = fixture();
  const description = await library.describe();
  assert.equal(description.url, "mnemos://library");
  assert.equal(description.suggestedBindingName, "MNEMOS");
  assert.equal(description.tsType, "MnemosLibrary");
  const types = await library.getTypeScriptTypes();
  assert.ok(types.length > 0);
  assert.match(types, /interface MnemosLibrary\b/);
  assert.match(types, /saveDraft\(project: string, document: string, content: string\)/);
  // Публикация и отправка на согласование — решения человека; у агента таких методов нет.
  assert.doesNotMatch(types, /publish|review|approv|share/i);
});

test("каталог: authorizeObservation до возврата, записи ограничены boundAgentCatalog", async () => {
  const projects = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: `Проект ${String(i).padStart(2, "0")}`, slug: `s${i}` }));
  const { library, state } = fixture({ projects });
  const auth = authorizer(state);
  const catalog = await library.getAgentCatalog({ limit: 100 }, auth as any);
  assert.ok(catalog);
  assert.equal(catalog.entries.length, 25);
  assert.equal(catalog.truncated, true);
  assert.deepEqual(Object.keys(catalog.entries[0]).toSorted(), ["description", "id", "title"]);
  assert.equal(auth.seen.length, 1);
  assert.equal(auth.seen[0].title, "Каталог Mnemos");
  assert.match(auth.seen[0].description, /25/);
  assert.ok(state.calls.indexOf("authorize") > state.calls.indexOf("listProjects"));
  const small = await library.getAgentCatalog({ limit: 3 }, auth as any);
  assert.equal(small?.entries.length, 3);
});

test("каталог: отказ authorizeObservation → исключение, записи не возвращены", async () => {
  const { library, state } = fixture();
  await assert.rejects(library.getAgentCatalog({ limit: 10 }, authorizer(state, true) as any), /отклонено/);
});

test("listProjects, searchProject, readDocument зовут authorizeObservation до данных; отказ → данных нет", async () => {
  const { library, state } = fixture();
  const auth = authorizer(state);
  const session = await library.startSession(auth as any);
  const projects = await session.listProjects();
  assert.deepEqual(projects, PROJECTS);
  assert.ok(state.calls.indexOf("authorize") < state.calls.indexOf("listProjects"));
  state.calls.length = 0;
  const result = await session.searchProject("p1", "план");
  assert.equal(result.hits[0].document, "n1");
  assert.ok(state.calls.indexOf("authorize") < state.calls.indexOf("search:p1:план"));
  state.calls.length = 0;
  const byPath = await session.readDocument("p1", "docs/plan.md");
  assert.equal(byPath.document, "n1");
  assert.equal(byPath.text, "Текст документа");
  assert.ok(state.calls.indexOf("authorize") < state.calls.indexOf("read:p1:n1"));
  const byId = await session.readDocument("p1", "n2");
  assert.equal(byId.document, "n2");
  assert.equal(auth.seen.length, 4);
  assert.ok(auth.seen.every(d => /Mnemos/.test(d.title)));

  const denied = authorizer(state, true);
  const blocked = await library.startSession(denied as any);
  state.calls.length = 0;
  await assert.rejects(blocked.listProjects(), /отклонено/);
  assert.ok(!state.calls.includes("listProjects"));
  await assert.rejects(blocked.searchProject("p1", "план"), /отклонено/);
  assert.ok(!state.calls.some(c => c.startsWith("search:")));
  await assert.rejects(blocked.readDocument("p1", "docs/plan.md"), /отклонено/);
  assert.ok(!state.calls.some(c => c.startsWith("read:")));
});

test("readDocument без права на проект → ошибка без credential в тексте", async () => {
  const { library, state } = fixture({ denyRead: true });
  const session = await library.startSession(authorizer(state) as any);
  await assert.rejects(session.readDocument("p1", "docs/plan.md"), (error: Error) => {
    assert.ok(!error.message.includes(TOKEN));
    assert.ok(!/bearer|token/i.test(error.message));
    return true;
  });
  assert.ok(!state.calls.some(c => c.startsWith("read:")));
});

test("TD-177: ошибки readDocument до выдачи данных не различают «папка», «не найден», «нет доступа»", async () => {
  const cases: [Partial<Fixture>, string][] = [[{}, "docs"], [{}, "docs/missing.md"], [{ denyRead: true }, "docs/plan.md"]];
  const denied: string[] = [], allowed: string[] = [];
  for (const [overrides, document] of cases) {
    const { library, state } = fixture(overrides);
    const blocked = await library.startSession(authorizer(state, true) as any);
    await assert.rejects(blocked.readDocument("p1", document), (error: Error) => { denied.push(error.message); return true; });
    const open = await library.startSession(authorizer(state) as any);
    await assert.rejects(open.readDocument("p1", document), (error: Error) => { allowed.push(error.message); return true; });
    assert.ok(!state.calls.some(c => c.startsWith("read:")));
  }
  assert.equal(new Set(denied).size, 1, JSON.stringify(denied));
  assert.equal(new Set(allowed).size, 1, JSON.stringify(allowed));
  assert.notEqual(denied[0], allowed[0]);
});

test("отозванный аккаунт: методы сессии бросают, каталог пуст", async () => {
  const { library, state } = fixture({ revoked: true });
  const auth = authorizer(state);
  assert.equal(await library.getAgentCatalog({ limit: 10 }, auth as any), null);
  assert.equal(auth.seen.length, 0);
  const session = await library.startSession(auth as any);
  await assert.rejects(session.listProjects(), /отключён/);
  await assert.rejects(session.searchProject("p1", "план"), /отключён/);
  await assert.rejects(session.readDocument("p1", "docs/plan.md"), /отключён/);
  assert.ok(!state.calls.includes("listProjects"));
});

test("действий нет: getAutoApprovableActions пуст, applyAction/rejectAction неизвестного id отказывают", async () => {
  const { library } = fixture();
  assert.deepEqual(await library.getAutoApprovableActions(), []);
  await assert.rejects(library.applyAction(1), /не найдено/);
  await assert.rejects(library.rejectAction(1), /не найдено/);
});

test("TD-178: наблюдатель того же тенанта принят, чужого — отвергнут; excludeObservers содержит только чужих", async () => {
  const { library, state } = fixture();
  await library.addObserver("same", verifier("org") as any);
  await assert.rejects(library.addObserver("foreign", verifier("other") as any), /организац/);
  await library.addObserver("blind", verifier("org", false) as any);
  const auth = authorizer(state);
  const session = await library.startSession(auth as any);
  await session.listProjects();
  assert.deepEqual(auth.seen.at(-1)?.excludeObservers, []);
  await library.getAgentCatalog({ limit: 10 }, auth as any);
  assert.deepEqual(auth.seen.at(-1)?.excludeObservers, []);
  // Чтение конкретной публикации дополнительно требует права на неё.
  await session.readDocument("p1", "docs/plan.md");
  assert.deepEqual(auth.seen.at(-1)?.excludeObservers, ["blind"]);
});

test("saveDraft saves immediately as the agent, without an approval request",async()=>{
 const {library,state}=fixture();const auth=authorizer(state);const session=await library.startSession(auth as any);
 const result=await session.saveDraft("p1","docs/plan.md",AFTER);
 assert.equal(result.status,"saved");assert.equal(result.document,"n1");assert.equal(result.head,HEAD_B);assert.equal(state.draftText,AFTER);assert.equal(auth.submitted.length,0);
 assert.deepEqual(humanWriteCalls(state),[]);assert.ok(state.calls.some(c=>c.startsWith("agent:save:")));
 await assert.rejects(library.applyAction(result.action),/уже/);session[Symbol.dispose]();
});
test("createDraft returns the new document immediately without publishing or asking for approval",async()=>{
 const {library,state}=fixture();const auth=authorizer(state);const session=await library.startSession(auth as any);
 const result=await session.createDraft("p1","dir","new.md",AFTER);
 assert.equal(result.status,"saved");assert.equal(result.document,"created-node");assert.equal(state.draftText,AFTER);assert.equal(auth.submitted.length,0);
 assert.equal(state.calls.filter(c=>c.startsWith("agent:create:")).length,1);assert.deepEqual(humanWriteCalls(state),[]);session[Symbol.dispose]();
});
test("revoked owner or agent cannot create or save a draft",async()=>{
 for(const flags of [{revoked:true},{agentRevoked:true}])for(const create of [true,false]){
  const {library,state}=fixture(flags);const session=await library.startSession(authorizer(state) as any);
  await assert.rejects(create?session.createDraft("p1","","new.md",AFTER):session.saveDraft("p1","n1",AFTER));
  assert.deepEqual(writeCalls(state),[]);session[Symbol.dispose]();
 }
});
test("new drafts reject invalid folders, duplicate names and excessive content without writing",async()=>{
 const {library,state}=fixture();const session=await library.startSession(authorizer(state) as any);
 for(const [parent,name,text] of [["missing","new.md",AFTER],["","readme.md",AFTER],["","../new.md",AFTER],["","new.md","x".repeat(262145)]])await assert.rejects(session.createDraft("p1",parent,name,text));
 assert.deepEqual(writeCalls(state),[]);session[Symbol.dispose]();
});
test("opening a branch cannot overwrite a publication that raced with the draft write",async()=>{
 for(const create of [false]){
  const {library,state}=fixture({personalExists:false,openHead:HEAD_B});const session=await library.startSession(authorizer(state) as any);
  await assert.rejects(create?session.createDraft("p1","","new.md",AFTER):session.saveDraft("p1","n1",AFTER),/устарел/);
  assert.equal(state.calls.some(c=>c.startsWith("agent:save:")||c.startsWith("agent:create:")),false);session[Symbol.dispose]();
 }
});

test("first document initializes an empty project using the agent credential",async()=>{
 const {library,state}=fixture({emptyProject:true,personalExists:false});const auth=authorizer(state);const session=await library.startSession(auth as any);
 const result=await session.createDraft("p1","","first.md",AFTER);assert.equal(result.status,"saved");assert.equal(result.document,"created-node");assert.ok(state.calls.includes("agent:openDraft:p1"));assert.deepEqual(humanWriteCalls(state),[]);assert.equal(auth.submitted.length,0);session[Symbol.dispose]();
});
