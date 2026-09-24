import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { MnemosAPIError } from "./mnemos-api.ts";
import type { AdminOperation, AdminOperationRequest } from "./admin-operations.ts";

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
  /** Политика публикации проекта; null — сервер отвечает 404. */
  policy?: { domains: unknown[] } | null; reviewReady?: boolean; denyPublish?: boolean;
}

function fixture(overrides: Partial<Fixture> = {}) {
  const operations = new Map<string, AdminOperation>();
  const admin = {
    async prepare(id: string, request: AdminOperationRequest) {
      const old = operations.get(id);
      if (old) { assert.deepEqual(old.request, request); return structuredClone(old); }
      const result: AdminOperation = {request_id: id, request, summary: "Создать проект «Продажи».", state: "pending"}; operations.set(id, result); return structuredClone(result);
    },
    async execute(id: string, request: AdminOperationRequest) {
      const old = operations.get(id)!; assert.deepEqual(old.request, request);
      if (state.revoked || state.agentRevoked || old.state === "rejected" || old.state === "pending") throw new MnemosAPIError(403);
      if (old.state !== "applied") { old.state = "applied"; old.result = {project_id: "created-project"}; state.calls.push("admin:execute"); }
      return structuredClone(old);
    },
    [Symbol.dispose]() {},
  };
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
    async readProjectDocumentWindow(project: string, node: string, ordinal: number, radius: number, maxBytes: number) {
      state.calls.push(`window:${project}:${node}:${ordinal}:${radius}:${maxBytes}`);
      return { node_id: node, text: "Фрагмент", media_type: "text/markdown", truncated: true };
    },
    async searchAll(query: string, limit: number) {
      state.calls.push(`searchAll:${query}:${limit}`);
      return { hits: [{ project_id: "p2", node_id: "n2", name: "readme.md", text: "архив", ordinal: 3 }], index_pending: false, degraded: false };
    },
    async readPublicationPolicy(project: string) {
      state.calls.push(`policy:${project}`);
      if (!state.policy) throw new MnemosAPIError(404);
      return { project_id: project, revision: 1, domains: state.policy.domains };
    },
    async requestPublicationReview(project: string, personal: string, shared: string) {
      state.calls.push(`review:${project}:${personal}:${shared}`); return { candidate_id: "d".repeat(64) };
    },
    async readPublicationReview(id: string) { state.calls.push(`readReview:${id}`); return { candidate_id: id, ready: !!state.reviewReady, stale: false }; },
    async publishDraft(project: string, head: string, shared: string, message: string) {
      state.calls.push(`publish:${project}:${head}:${shared}:${message}`);
      return { personal_head: head, shared_head: HEAD_B, published: true, conflicted: false };
    },
    async checkTrackerAssignee(project: string, node: string, head: string, principal: string) {
      state.calls.push(`assignee:${project}:${node}:${head}:${principal}`);
      if (principal !== "bob") throw new MnemosAPIError(403);
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
      if (node === "tracker") return { head: state.personalHead, node_id: node, exists: true, conflicted: false, content_type: "application/vnd.mnemos.task-tracker+json", terms: [] };
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
    async requestPublicationReview(project: string, personal: string, shared: string) {
      state.calls.push(`agent:review:${project}:${personal}:${shared}`); return { candidate_id: "d".repeat(64) };
    },
    async publishDraft(project: string, head: string, shared: string, message: string) {
      state.calls.push(`agent:publish:${project}:${head}:${shared}:${message}`);
      if (state.denyPublish) throw new MnemosAPIError(403);
      return { personal_head: head, shared_head: HEAD_B, published: true, conflicted: false };
    },
    [Symbol.dispose]() { state.calls.push("dispose:agent"); },
  };
  const agent = {
    personal: {
      async list(project: string, cursor: string) { state.calls.push(`agent:personal-list:${project}:${cursor}`); if(state.denyRead)throw new MnemosAPIError(403);return {head: HEAD_A, documents: [{node_id:"n1", name:"plan.md", content_type:"text/markdown"}], next_cursor:"next"}; },
      async read(project: string, node: string) { state.calls.push(`agent:personal-read:${project}:${node}`); if(state.denyRead || state.agentRevoked)throw new MnemosAPIError(403);return reader.readDraftDocument(project,node); },
      [Symbol.dispose]() {},
    },
    textDownloads: app.textDownloads,
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
      return {...agent, bindingId: "owned-binding", admin};
    },
    async decideWorkshopAdmin(binding: string, id: string, phase: "approve" | "reject", request: AdminOperationRequest) {
      assert.equal(binding, "owned-binding"); const old = operations.get(id)!; assert.deepEqual(old.request, request);
      if (state.revoked || state.agentRevoked || (old.state === "rejected" && phase === "approve") || (old.state === "applied" && phase === "reject")) throw new MnemosAPIError(403);
      if (old.state !== "applied") old.state = phase === "approve" ? "approved" : "rejected";
      state.calls.push(`human:${phase}`); return structuredClone(old);
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
  return { library, state, uploads, kv, admin, account };
}

function authorizer(state: Fixture, deny = false) {
  const seen: { title: string; description: string; excludeObservers?: string[]; workContext?: {projectName:string;resourceName?:string} }[] = [];
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
  // Решение владельца 23.09: без согласования агент публикует сам; согласовывать и делиться — решения людей.
  assert.match(types, /publishDraft\(project: string, message\?: string\)/);
  assert.doesNotMatch(types, /\b(?:review\w*|approve\w*|share\w*)\s*\(/i);
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
  assert.equal(auth.seen.length, 7);
  assert.deepEqual(auth.seen.flatMap(d=>d.workContext?[d.workContext]:[]), [
    {projectName:"Продажи"},
    {projectName:"Продажи",resourceName:"plan.md"},
    {projectName:"Продажи",resourceName:"readme.md"},
  ]);
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
  const auth = authorizer(state);
  const session = await library.startSession(auth as any);
  await assert.rejects(session.readDocument("p1", "docs/plan.md"), (error: Error) => {
    assert.ok(!error.message.includes(TOKEN));
    assert.ok(!/bearer|token/i.test(error.message));
    return true;
  });
  assert.ok(!state.calls.some(c => c.startsWith("read:")));
  assert.ok(auth.seen.every(item => !item.workContext));
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

test("административное предложение ждёт ручного подтверждения и не выполняется из сессии", async () => {
  const {library, state} = fixture(); const auth = authorizer(state); const session = await library.startSession(auth as any);
  const pending = await session.proposeCreateProject("request-one", "Продажи", "sales");
  assert.equal(pending.status, "pending"); assert.equal(auth.submitted.length, 1);
  const samePending = await session.proposeCreateProject("request-one", "Продажи", "sales"); assert.equal(samePending.action, pending.action); assert.equal(auth.submitted.length, 1);
  assert.equal("applyAction" in session, false); assert.equal("decideWorkshopAdmin" in session, false);
  assert.equal(state.calls.includes("admin:execute"), false);
  assert.equal("actionKind" in auth.submitted[0].description, false);
  assert.equal("autoApprovable" in auth.submitted[0].description, false);
  assert.equal((auth.submitted[0].description as {ownerApprovalRequired?: boolean}).ownerApprovalRequired, true);
  await library.applyAction(pending.action); await library.applyAction(pending.action);
  assert.equal(state.calls.filter(c => c === "admin:execute").length, 1);
  assert.ok(state.calls.indexOf("human:approve") < state.calls.indexOf("admin:execute"));
  const repeated = await session.proposeCreateProject("request-one", "Продажи", "sales");
  assert.equal(repeated.action, pending.action); assert.equal(repeated.status, "applied"); assert.equal(repeated.result?.project_id, "created-project");
});

test("отказ и повтор отказа запрещают исполнение; подмена ключа не меняет предложение", async () => {
  const {library, state} = fixture(); const session = await library.startSession(authorizer(state) as any);
  const proposal = await session.proposeCreateProject("request-two", "Продажи", "sales");
  await assert.rejects(session.proposeCreateProject("request-two", "Другое", "other"), /другого/);
  await library.rejectAction(proposal.action); await library.rejectAction(proposal.action);
  await assert.rejects(library.applyAction(proposal.action), /отклонено/);
  assert.equal(state.calls.includes("admin:execute"), false);
});

test("потеря ответа исполнения восстанавливается без повторного создания", async () => {
  const {library, state, admin} = fixture(); const session = await library.startSession(authorizer(state) as any);
  const proposal = await session.proposeCreateProject("request-three", "Продажи", "sales");
  const execute = admin.execute; let lost = false;
  admin.execute = async (...args) => { const result = await execute(...args); if (!lost) {lost = true; throw new Error("Потерян ответ");} return result; };
  await assert.rejects(library.applyAction(proposal.action), /Потерян/); await library.applyAction(proposal.action);
  assert.equal(state.calls.filter(c => c === "admin:execute").length, 1);
});

test("отзыв перед подтверждением не даёт выполнить административную запись", async () => {
  for (const property of ["revoked", "agentRevoked"] as const) {
    const {library, state} = fixture(); const session = await library.startSession(authorizer(state) as any);
    const proposal = await session.proposeCreateProject("request-four", "Продажи", "sales"); state[property] = true;
    await assert.rejects(library.applyAction(proposal.action)); assert.equal(state.calls.includes("admin:execute"), false);
  }
});

test("старое административное предложение без ограничения владельца не исполняется и не отклоняется", async () => {
  const {library, state, kv} = fixture(); const session = await library.startSession(authorizer(state) as any);
  const proposal = await session.proposeCreateProject("legacy-request", "Продажи", "sales");
  const saved = kv.get(`admin:${proposal.action}`) as {ownerRestricted?: true}; delete saved.ownerRestricted;
  await assert.rejects(library.applyAction(proposal.action), /старой версией/);
  await assert.rejects(library.rejectAction(proposal.action), /старой версией/);
  assert.equal(state.calls.some(c => c === "human:approve" || c === "human:reject" || c === "admin:execute"), false);
});


test("личный каталог и текст читаются агентом без опубликованной версии", async () => {
  const {library, state} = fixture(); const q = authorizer(state); const session = await library.startSession(q as never);
  const page = await session.listPersonalDocuments("p1", "cursor"); assert.equal(page.next_cursor, "next");
  const doc = await session.readPersonalDocument("p1", "n1"); assert.equal(doc.text, BEFORE);
  assert(state.calls.includes("agent:personal-list:p1:cursor")); assert(state.calls.includes("agent:personal-read:p1:n1"));
  assert(!state.calls.includes("open")); assert(!state.calls.includes("startAppUi")); assert(!state.calls.some(c => c.startsWith("read:")));
});

test("отказ scope личного чтения не вызывает human fallback", async () => {
  const {library, state} = fixture({denyRead:true}); const session = await library.startSession(authorizer(state) as never);
  await assert.rejects(session.listPersonalDocuments("p1")); await assert.rejects(session.readPersonalDocument("p1","n1"));
  assert(!state.calls.includes("open")); assert(!state.calls.some(c => c.startsWith("fetch:")));
});

test("наблюдение личных данных отклоняется до обращения к агенту", async () => {
  const {library, state} = fixture(); const session = await library.startSession(authorizer(state,true) as never);
  await assert.rejects(session.readPersonalDocument("p1","n1"), /Наблюдение/); assert(!state.calls.includes("startWorkshopAgent"));
});


test("подключение проекта остаётся owner-only предложением и повторяется одной карточкой", async () => {
  const {library,state,admin} = fixture(); const q=authorizer(state); const session=await library.startSession(q as never);
  const proposal=await session.proposeConnectProject("connect-intake","Проект приёмной");
  assert.equal(proposal.status,"pending"); assert.equal(q.submitted.length,1);
  assert.equal(q.submitted[0].description.title,"Подключить проект к агенту Mnemos");
  assert.equal((q.submitted[0].description as {ownerApprovalRequired?:boolean}).ownerApprovalRequired,true);
  await assert.rejects(admin.execute("connect-intake",{kind:"connect_project",project:"Проект приёмной"}));
  await session.proposeConnectProject("connect-intake","Проект приёмной"); assert.equal(q.submitted.length,1);
  await assert.rejects(session.proposeConnectProject("connect-intake","Другой проект"));
  await library.applyAction(proposal.action); assert(state.calls.includes("human:approve")); assert(state.calls.includes("admin:execute"));
});

const TRACKER = JSON.stringify({ format: "mnemos.task-tracker", format_version: 1, revision: 1, title: "План", stages: [{ id: "s1", name: "Работа", department: "" }], transitions: [],
  tasks: [{ id: "t1", title: "Сделать отчёт", description: "", stage_id: "s1", status: "todo", assignee_id: "", dependencies: [], next_step: "", blocker: "", result: "" }] });

test("search: все проекты с именами, наблюдение до данных, предел числа совпадений", async () => {
  const { library, state } = fixture();
  const auth = authorizer(state);
  const session = await library.startSession(auth as any);
  const result = await session.search("архив", 5);
  assert.deepEqual(result.hits, [{ project: "p2", projectName: "Архив", document: "n2", name: "readme.md", text: "архив", ordinal: 3 }]);
  assert.ok(state.calls.indexOf("authorize") < state.calls.indexOf("searchAll:архив:5"));
  await assert.rejects(session.search("архив", 500), /limit/);
  await assert.rejects(session.search("", 5), /запрос/);
});

test("readDocument: окно по фрагментам уходит на сервер, неверное окно отвергается до запросов", async () => {
  const { library, state } = fixture();
  const session = await library.startSession(authorizer(state) as any);
  const part = await session.readDocument("p1", "docs/plan.md", { ordinal: 4, radius: 2 });
  assert.equal(part.text, "Фрагмент");
  assert.equal(part.truncated, true);
  assert.ok(state.calls.includes("window:p1:n1:4:2:262144"));
  assert.ok(!state.calls.includes("read:p1:n1"));
  state.calls.length = 0;
  await assert.rejects(session.readDocument("p1", "docs/plan.md", { ordinal: -1, radius: 2 }), /окно/);
  await assert.rejects(session.readDocument("p1", "docs/plan.md", { ordinal: 0, radius: 99 }), /окно/);
  assert.deepEqual(state.calls, []);
});

test("browseProject: корень и папка по пути, пути документов, неизвестная папка — отказ", async () => {
  const { library, state } = fixture();
  const session = await library.startSession(authorizer(state) as any);
  const root = await session.browseProject("p1");
  assert.deepEqual(root.entries, [{ id: "dir", name: "docs", path: "docs", kind: "folder" }, { id: "n2", name: "readme.md", path: "readme.md", kind: "document" }]);
  assert.equal(root.truncated, false);
  const docs = await session.browseProject("p1", "docs");
  assert.equal(docs.folder, "docs");
  assert.deepEqual(docs.entries, [{ id: "n1", name: "plan.md", path: "docs/plan.md", kind: "document" }]);
  await assert.rejects(session.browseProject("p1", "нет/такой"), /Папка не найдена/);
});

test("publishDraft: запись под агентским credential; без политики — сразу, с политикой — запрос ответственным", async () => {
  const humanPublish = (state: Fixture) => state.calls.filter(c => /^(publish|review|draftState):/.test(c));
  const plain = fixture({ policy: null });
  const session = await plain.library.startSession(authorizer(plain.state) as any);
  const published = await session.publishDraft("p1", "Отчёт за март");
  assert.equal(published.status, "published");
  assert.ok(plain.state.calls.includes(`agent:publish:p1:${HEAD_A}:${HEAD_S}:Отчёт за март`));
  assert.deepEqual(humanPublish(plain.state), [], "публикация не идёт под bearer человека");
  assert.ok(!plain.state.calls.some(c => c.startsWith("agent:review:")));
  assert.ok(plain.state.calls.indexOf("authorize") < plain.state.calls.indexOf("agent:draftState:p1"));

  const guarded = fixture({ policy: { domains: [{ domain_id: "finance" }] } });
  const reviewed = await (await guarded.library.startSession(authorizer(guarded.state) as any)).publishDraft("p1");
  assert.equal(reviewed.status, "awaiting_approval");
  assert.ok(guarded.state.calls.includes(`agent:review:p1:${HEAD_A}:${HEAD_S}`));
  assert.ok(!guarded.state.calls.some(c => c.startsWith("agent:publish:")), "согласование не обходится");
  assert.deepEqual(humanPublish(guarded.state), []);

  // Изменения не задели направлений политики: согласовывать нечего, публикуется сразу.
  const untouched = fixture({ policy: { domains: [{ domain_id: "finance" }] }, reviewReady: true });
  assert.equal((await (await untouched.library.startSession(authorizer(untouched.state) as any)).publishDraft("p1")).status, "published");

  const empty = fixture({ personalExists: false });
  assert.equal((await (await empty.library.startSession(authorizer(empty.state) as any)).publishDraft("p1")).status, "nothing_to_publish");
  assert.ok(!empty.state.calls.some(c => c.startsWith("agent:publish:")));

  // Сервер отказал агенту: честный отказ, без повтора под сессией человека.
  const denied = fixture({ policy: null, denyPublish: true });
  await assert.rejects((await denied.library.startSession(authorizer(denied.state) as any)).publishDraft("p1"), /не разрешил агенту публикацию/);
  assert.deepEqual(humanPublish(denied.state), []);
});

test("трекер: чтение, изменение задачи с проверкой правил и версии под агентским credential", async () => {
  const { library, state, uploads } = fixture({ draftText: TRACKER });
  const session = await library.startSession(authorizer(state) as any);
  const tracker = await session.readTracker("p1", "tracker");
  assert.equal(tracker.head, HEAD_A);
  assert.equal(tracker.tasks[0].id, "t1");
  const task = { ...tracker.tasks[0], status: "in_progress" };
  await assert.rejects(session.changeTrackerTask("p1", "tracker", tracker.head, task), /ответственный и следующий шаг/);
  await assert.rejects(session.changeTrackerTask("p1", "tracker", tracker.head, { ...task, assignee_id: "eve", next_step: "Собрать данные" }), /Ответственный недоступен/);
  await assert.rejects(session.changeTrackerTask("p1", "tracker", HEAD_S, { ...task, assignee_id: "bob", next_step: "Собрать данные" }), /Трекер изменился/);
  assert.equal(humanWriteCalls(state).length, 0);
  const changed = await session.changeTrackerTask("p1", "tracker", tracker.head, { ...task, assignee_id: "bob", next_step: "Собрать данные" });
  assert.deepEqual(changed, { document: "tracker", head: HEAD_B, revision: 2, task: "t1" });
  assert.ok(state.calls.some(c => c.startsWith(`agent:save:p1:tracker:`) && c.endsWith(HEAD_A)));
  const saved = JSON.parse([...uploads.values()].at(-1)!);
  assert.equal(saved.tasks[0].status, "in_progress");
  assert.equal(saved.tasks[0].assignee_id, "bob");
  assert.equal(saved.transitions.length, 0, "прочие поля трекера сохраняются");
  await assert.rejects(session.readTracker("p1", "n1"), /не трекер/);
});
