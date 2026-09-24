// Стенд для тестов вкладок приложения «Память»: jsdom + capnweb-сессия с заглушкой методов сессии.
// Заглушка задаёт данные по умолчанию; тест переопределяет нужные методы через overrides.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MessageChannel } from "node:worker_threads";
import { JSDOM, VirtualConsole } from "jsdom";
import { RpcTarget, newMessagePortRpcSession } from "capnweb";

export const REVIEW_MINE = "e".repeat(64);
export const REVIEW_READY = "f".repeat(64);
const HEAD_A = "a".repeat(64), HEAD_B = "b".repeat(64);

export function defaultMethods(calls) {
  const record = (name, ...args) => { calls.push([name, ...args]); };
  return {
    async listTemplateReviewScopes(){return {scopes:[],next_cursor:""};},
    async inboxAlerts(){return {alerts:[],truncated:false};},
    async workspaceAvailable(){return false;},
    async listWorkspaceTasks(){return {tasks:[]};},
    async inboxStatus(){return {total:0,in_queue:0,awaiting_classification:0,awaiting_placement:0,placed_in_tree:0,dead_lettered:0,dead_letters:[],dead_letters_truncated:false};},
    async whoAmI() { return { subject: { tenant_id: "org", user_id: "alice" }, tenant_name: "Пример команды", capabilities:["project.create","principal.manage","platform.metrics.read"] }; },
    async listProjects() { return { projects: [{ id: "one", name: "Общий проект", slug: "shared" }, { id: "two", name: "Второй проект", slug: "second" }] }; },
    async listShareRequests() { return { requests: [] }; },
    async listSharedDocuments() { return []; },
    async markSharedDocumentSeen(...args) { record("markSharedDocumentSeen", ...args); },
    async readProjectSharingSettings() { return { personal_projects_enabled: true, project_create_by: "everyone", share_department_approval: "head", share_organization_by: "head", share_organization_approval: "none", default_visibility: "private" }; },
    async browseProject(id) {
      if (id === "one") return { nodes: [{ node_id: "doc", name: "Заметка команды", is_dir: false }, { node_id: "dir", name: "Папка", is_dir: true }, { node_id: "plan", name: "План", is_dir: false }], truncated: false };
      return { nodes: [{ node_id: "other", name: "Другой документ", is_dir: false }], truncated: false };
    },
    async draftState(id) { return { personal_head: HEAD_A, shared_head: HEAD_B, personal_exists: id === "one" }; },
    async listPrivateDocuments(id) {
      if (id === "one") return { documents: [{ node_id: "plan", name: "План", content_type: "text/plain", conflicted: true }], head: HEAD_A, next_cursor: "" };
      return { documents: [], head: "d".repeat(64), next_cursor: "" };
    },
    async listPublicationReviews() {
      return { reviews: [
        { candidate_id: REVIEW_MINE, project_id: "one", author_id: "bob", personal_head: "c".repeat(64), shared_head: HEAD_B, decision_version: 3, stale: false, ready: false,
          domains: [{ domain_id: "Инженерия", node_ids: ["doc"], approvers: ["alice", "carol"], decisions: [{ approver_id: "carol", approved: true }] }] },
        { candidate_id: REVIEW_READY, project_id: "one", author_id: "alice", personal_head: HEAD_A, shared_head: HEAD_B, decision_version: 1, stale: false, ready: true,
          domains: [{ domain_id: "Дизайн", node_ids: ["plan"], approvers: ["carol"], decisions: [{ approver_id: "carol", approved: true }] }] },
      ], next_cursor: "" };
    },
    async recordReviewDecision(...args) { record("recordReviewDecision", ...args); },
    async publishDraft(...args) { record("publishDraft", ...args); return { personal_head: HEAD_A, shared_head: HEAD_A, published: true, conflicted: false }; },
    async searchProject() { return { hits: [], index_pending: false, degraded: false }; },
    async nodeHistory() { return { events: [] }; },
    async readProjectDocument(project, node) { return { node_id: node, text: "Текст", media_type: "text/plain", truncated: false }; },
    async managedAgentRequest() { return null; },
    async managedTaskRequest() { return null; },
    async listAgentConnections() {
      return { connections: [
        { binding_id: "b-managed", agent_principal_id: "agent-alice", document_grants: [{project_id:"one",node_id:"",mode:"read",resource_class:"filesystem",granted_to:"agent-alice"}], runtime_id: "agenticos", runtime_agent_id: "ra-1", managed_runtime: true, revoked: false },
        { binding_id: "b-external", agent_principal_id: "claude-code-alice", runtime_id: "external", runtime_agent_id: "cc-1", managed_runtime: false, revoked: false },
      ], next_cursor: "" };
    },
    async revokeAgentConnection(id) { record("revokeAgentConnection", id); },
    async recordUIReadiness() {},
    async listCollaborations() {
      return { requests: [
        { request_id: "r-1", project_id: "one", node_id: "doc", source_head: HEAD_B, target_binding_id: "", target_user_id: "alice", target_agent_id: "", requester_user_id: "bob", requester_agent_id: "", purpose: "review_spec", role: "coexecutor", title: "Проверить ТЗ на страницу цен", description: "", criteria: "", created_at: "2026-09-12T10:00:00Z" },
        { request_id: "r-2", project_id: "two", node_id: "other", source_head: HEAD_B, target_binding_id: "", target_user_id: "carol", target_agent_id: "", requester_user_id: "alice", requester_agent_id: "", purpose: "collaborate", role: "coexecutor", title: "Согласовать подрядчика", description: "", criteria: "", created_at: "2026-09-12T10:00:00Z" },
      ], next_cursor: "" };
    },
    async readCollaborationProgress(id) { return { state: id === "r-1" ? "awaiting_result" : "awaiting_result", result_sequence: 0, review_revision: 0 }; },
    async readAgentAbsence(project) { return { project_id: project, local_binding_id: "", managed_binding_id: "", starts_at: "", ends_at: "", revision: 0, enabled: false }; },
    async readTeamBudgetUsage() { throw new Error("no budget"); },
    async readSpending(period) { return { period, all_visible: true, micro_usd: "0", count: 0, estimated_count: 0, kinds: [], operations: [], projects: [], people: [], agents: [], models: [] }; },
    async externalAgentSetup() { return {resource:"https://memory.example/mcp",clientId:"mnemos-cli"}; },
    async readPersonalMemory() { return { revision: 0, project_id: "", node_id: "", head: "" }; },
    async listTelegram() { return { connections: [], unavailable: 0 }; },
    async listImapAccounts() { return { servers: [], accounts: [] }; },
    async listWebDAVAccounts() { return { servers: [], accounts: [] }; },
    async listCalDAVAccounts() { return { servers: [], accounts: [] }; },
    async listMailConnections() { return { connections: [] }; },
    async listCalendarConnections() { return { connections: [] }; },
    async listGitConnections() { return { connections: [] }; },
    async listVisibleDatabaseConnections() { return { databases: [], truncated: false }; },
    async readPublicationPolicy(project) { return { project_id: project, revision: 1, domains: [] }; },
    async listPolicyApprovers() { return { approvers: [], next_cursor: "" }; },
    async prepareManagedAgent(template) { record("prepareManagedAgent", template); return { request_id: "req-1", template_id: template }; },
    async submitManagedAgent(id) { record("submitManagedAgent", id); return { request_id: id, template_id: "t", result: { binding_id: "b-new", agent_principal_id: "agent-new", runtime_id: "agenticos", runtime_agent_id: "ra-2", managed_runtime: true, revoked: false } }; },
    async finishManagedAgentRequest(id) { record("finishManagedAgentRequest", id); },
    async cancelSavedTeamTask(id) { record("cancelSavedTeamTask", id); },
    async readPlatformMetrics() { throw new Error("forbidden"); },
    async uploadUsage() { throw new Error("forbidden"); },
    async readOperationAudit() { throw new Error("forbidden"); },
    async policyAlerts() { throw new Error("forbidden"); },
  };
}

export async function mountMemoryApp(overrides = {}, options = {}) {
  const calls = [];
  let selectedSection = options.section ?? "my-work", selectedProject = options.project ?? "", selectedView = options.view ?? "", selectedDocument = options.document ?? "";
  const methods = { ...defaultMethods(calls), ...overrides };
  // capnweb ищет методы цели на прототипе, а не среди собственных свойств экземпляра.
  class UI extends RpcTarget {}
  Object.assign(UI.prototype, methods);
  class Host extends RpcTarget {
    #ui = new UI();
    get ui() { return this.#ui; }
    async subscribeTheme() { return "light"; }
    async setUnsavedChanges(dirty) { calls.push(["setUnsavedChanges",dirty]); }
    async getSelectedProject() { return selectedProject; }
    async getSelectedView() { return selectedView; }
    async getSelectedDocument() { return selectedDocument; }
    async selectView(view) { calls.push(["selectView",view]); selectedView = view; setTimeout(locationChanged, 0); }
    async getSelectedSection() { return selectedSection; }
    async getPresentationMode() { return options.presentationMode ?? "page"; }
    // Ход загрузки: без options.uploads хост как старый — подписки не знает.
    async subscribeUploads(receiver) { if (!options.uploads) throw new Error("нет подписки"); uploadReceiver = receiver.dup(); calls.push(["subscribeUploads"]); return options.uploads.initial ?? null; }
    async answerUpload(id, choice) { calls.push(["answerUpload", id, choice]); }
    async stopUpload(id) { calls.push(["stopUpload", id]); }
    async retryUpload(id) { calls.push(["retryUpload", id]); }
    async resumeUpload(id) { calls.push(["resumeUpload", id]); }
    async dismissUpload(id) { calls.push(["dismissUpload", id]); }
    async pickInboxFiles(directory, project) { calls.push(project === undefined ? ["pickInboxFiles",directory] : ["pickInboxFiles",directory,project]); return options.pickedFiles ?? []; }
    // Как оболочка: адрес меняется, фрейм не перезагружается и получает сигнал перечитать выбор.
    async openSection(section,project) { calls.push(["openSection",section,project]); setTimeout(() => { selectedSection=section; selectedView=""; if(project!==undefined) selectedProject=project; locationChanged(); },0); }
    async openTemplateProposal(...args) { calls.push(["openTemplateProposal",...args]); }
    async openNativeDocument(project, resource) { calls.push(["openNativeDocument", project, resource]); return options.nativeOpen ?? false; }
    async openSharedDocument(project, owner, resource) { calls.push(["openSharedDocument", project, owner, resource]); if (options.sharedOpenError) throw new Error(options.sharedOpenError); return options.sharedOpen ?? options.nativeOpen ?? false; }
    async openPrompt(prompt,project) { calls.push(["openPrompt",prompt,project]); }
    async openApprovals() { calls.push(["openApprovals"]); }
    async sendMailDraft(id, sha256) { calls.push(["sendMailDraft", id, sha256]); return { state: "accepted" }; }
    async createCalendarDraft(id, sha256) { calls.push(["createCalendarDraft", id, sha256]); return { state: "created", event_id: "ev" }; }
    async downloadFile(...args) { calls.push(["downloadFile",...args]); }
    async downloadText(...args) { calls.push(["downloadText",...args]); return typeof options.downloadText === "function" ? options.downloadText(...args) : options.downloadText ?? "текст"; }
    async downloadReviewText(...args) {calls.push(["downloadReviewText",...args]); return args[3]==="before"?"Исходный текст":"Новая версия";}
    async openGitHubAppPage(url) { calls.push(["openGitHubAppPage", url]); return options.githubOpened ?? true; }
    async takeGitHubReturn() { const value = options.githubReturn ?? null; options.githubReturn = null; return value; }
  }
  let frame, uploadReceiver = null; const ports = [];
  const html = await readFile(new URL("../src/generated/app.txt", import.meta.url), "utf8");
  let dom, document;
  const locationChanged = () => dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: { type: "gatekeeper-location" }, source: dom.window }));
  function mount() {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => { if(error.type !== "css parsing") console.error(error); });
  dom = new JSDOM(html, {
    virtualConsole,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      for (const key of ["ReadableStream", "WritableStream", "TransformStream", "TextEncoder", "TextDecoder", "Request", "Response", "Headers"]) window[key] = globalThis[key];
      // В jsdom нет наблюдателей размера и медиазапросов, которые нужны Kumo; данные через них не идут.
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      window.Element.prototype.scrollIntoView = () => {};
      window.confirm = () => true;
      window.MessageChannel = class extends MessageChannel {
        constructor() { super(); ports.push(this.port1, this.port2); }
      };
      window.postMessage = (message, origin, transferred) => {
        if(message.type === "mnemos-intake-close") { calls.push(["closeIntake"]); return; }
        if(message.type === "mnemos-drag-enter") { calls.push(["dragEnter"]); return; }
        assert.equal(message.type, "handshake"); assert.equal(origin, "*");
        frame = newMessagePortRpcSession(transferred[0], new Host());
      };
    },
  });
  document = dom.window.document;
  }
  mount();
  const text = () => document.querySelector("#root").textContent;
  const tabs = () => [...document.querySelectorAll('[role="tab"]')];
  const tab = name => tabs().find(t => t.textContent.startsWith(name));
  const buttons = () => [...document.querySelectorAll("#root button")];
  const button = name => buttons().find(b => b.textContent === name);
  async function until(predicate, what) {
    const deadline = Date.now() + 15000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error(`UI did not reach expected state: ${what}\n${text().slice(0, 600)}`);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  async function open(name) {
    const names = {"Входящие":"my-work","Проекты":"projects","Материалы":"documents","Мой отдел":"team","Люди и отделы":"people","Правила":"rules","Подключения":"connections","Агенты и расходы":"agents","Журнал и состояние":"journal"};
    assert.ok(names[name], `Неизвестный раздел: ${name}`);
    dispose(); selectedSection=names[name]; selectedProject=""; mount();
    await until(() => document.querySelector("#root h1")?.textContent === name, `раздел ${name}`);
  }
  // React сверяет значение со своим слепком, поэтому ввод ставится нативным сеттером, как это делает браузер.
  function type(input, value) {
    const proto = input.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : input.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(new dom.window.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  }
  /** Переход из меню оболочки: адрес меняется, фрейм остаётся тем же. */
  function go(section, project = "", view = "", document = "") { selectedSection = section; selectedProject = project; selectedView = view; selectedDocument = document; locationChanged(); }
  function dispose() {
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    frame?.[Symbol.dispose](); dom.window.close();
    for (const port of ports.splice(0)) port.close();
  }
  await until(() => options.presentationMode === "panel" ? document.querySelector('[aria-label="Приём данных"]') : document.querySelector("#root h1"), "заголовок раздела");
  /** Оболочка присылает новое состояние загрузки. */
  async function pushUpload(view) { assert.ok(uploadReceiver, "фрейм не подписался на загрузку"); await uploadReceiver.setUploadState(view); }
  return { pushUpload, get dom(){return dom;}, get document(){return document;}, calls, text, tabs, tab, button, buttons, until, open, go, type, dispose, setTheme: mode => frame.setThemeMode(mode) };
}
