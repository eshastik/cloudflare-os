// Стенд для тестов вкладок приложения «Память»: jsdom + capnweb-сессия с заглушкой методов сессии.
// Заглушка задаёт данные по умолчанию; тест переопределяет нужные методы через overrides.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MessageChannel } from "node:worker_threads";
import { JSDOM } from "jsdom";
import { RpcTarget, newMessagePortRpcSession } from "capnweb";

export const REVIEW_MINE = "e".repeat(64);
export const REVIEW_READY = "f".repeat(64);
const HEAD_A = "a".repeat(64), HEAD_B = "b".repeat(64);

export function defaultMethods(calls) {
  const record = (name, ...args) => { calls.push([name, ...args]); };
  return {
    async whoAmI() { return { subject: { tenant_id: "org", user_id: "alice" }, tenant_name: "Пример команды", capabilities:["project.create","principal.manage","platform.metrics.read"] }; },
    async listProjects() { return { projects: [{ id: "one", name: "Общий проект", slug: "shared" }, { id: "two", name: "Второй проект", slug: "second" }] }; },
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

export async function mountMemoryApp(overrides = {}) {
  const calls = [];
  const methods = { ...defaultMethods(calls), ...overrides };
  // capnweb ищет методы цели на прототипе, а не среди собственных свойств экземпляра.
  class UI extends RpcTarget {}
  Object.assign(UI.prototype, methods);
  class Host extends RpcTarget {
    #ui = new UI();
    get ui() { return this.#ui; }
    async subscribeTheme() { return "light"; }
    async getSelectedProject() { return ""; }
    async openApprovals() { calls.push(["openApprovals"]); }
    async downloadText() { return "текст"; }
  }
  let frame; const ports = [];
  const html = await readFile(new URL("../src/generated/app.txt", import.meta.url), "utf8");
  const dom = new JSDOM(html, {
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
        assert.equal(message.type, "handshake"); assert.equal(origin, "*");
        frame = newMessagePortRpcSession(transferred[0], new Host());
      };
    },
  });
  const { document } = dom.window;
  const text = () => document.querySelector("#root").textContent;
  const tabs = () => [...document.querySelectorAll('[role="tab"]')];
  const tab = name => tabs().find(t => t.textContent.startsWith(name));
  const buttons = () => [...document.querySelectorAll("#root button")];
  const button = name => buttons().find(b => b.textContent === name);
  async function until(predicate, what) {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error(`UI did not reach expected state: ${what}\n${text().slice(0, 600)}`);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  async function open(name) {
    await until(() => tab(name), `вкладка «${name}»`);
    tab(name).click();
  }
  // React сверяет значение со своим слепком, поэтому ввод ставится нативным сеттером, как это делает браузер.
  function type(input, value) {
    const proto = input.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : input.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(new dom.window.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  }
  function dispose() {
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    frame?.[Symbol.dispose](); dom.window.close();
    for (const port of ports) port.close();
  }
  await until(() => document.querySelector("h1")?.textContent === "Память", "заголовок «Память»");
  return { dom, document, calls, text, tabs, tab, button, buttons, until, open, type, dispose };
}
