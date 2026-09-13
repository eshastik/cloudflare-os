import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MessageChannel } from "node:worker_threads";
import { JSDOM } from "jsdom";
import { RpcTarget, newMessagePortRpcSession } from "capnweb";

async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("UI did not reach expected state");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test("built iframe uses MessagePort capability and requires explicit revocation", async () => {
  let revoked = false, writes = 0, reads = 0, searches = 0, failHistory = false, failHistoricalText = false;
  let reviews = 0, approved = false, failReview = false, failComparison = false;
  const comparisonSides = [];
  let policyWrites = 0, policyFailure = false, failTaskStatus = false;
  let policy = { project_id: "one", revision: 0, domains: [] };
  let assigned = false, decisionVersion = 1; const decisions = [];
  let personal = "a".repeat(64), saves = 0, publications = 0, failSave = false, conflict = false;
  const shared = "b".repeat(64);
  let failMetrics = false; let metricReads=0; const uiReadiness=[];
  class UI extends RpcTarget {
    async recordUIReadiness(sample) { uiReadiness.push(sample); }
    async listPlatformSignalOwners(){return {generation:1,owners:[]};}
    async readPlatformMetrics() { metricReads++; if (failMetrics) throw new Error("forbidden"); return { signals:["dependencies","external.readiness","external.login","external.read","external.save"].map(key=>({key,state:key==="external.read"?"firing":"unknown",reason:key==="external.read"?"check_failed":key==="dependencies"?"check_unavailable":"observations_missing",observed_at:key==="external.read"?"2026-09-08T09:00:00Z":null})), ui_readiness_versions:{total_groups:2,truncated:false,groups:[{client_version:"",surface:"cloudflareos.document",outcome:"ready",samples:2,p50_ms:300,p95_ms:400,p99_ms:400,last_observed_at:"2026-09-08T09:00:00Z"},{client_version:"asset:index-current.js",surface:"cloudflareos.document",outcome:"ready",samples:1,p50_ms:100,p95_ms:100,p99_ms:100,last_observed_at:"2026-09-08T09:00:00Z"}]}, deployment:{environment:"test",release:"",source_revision:"a".repeat(40),source_modified:true,go_version:"go1.26.0",schema_version:65}, ui_readiness:[{surface:"cloudflareos.document",outcome:"ready",samples:3,p50_ms:300,p95_ms:400,p99_ms:400,last_observed_at:"2026-09-08T09:00:00Z"},{surface:"mnemos.management",outcome:"ready",samples:2,p50_ms:100,p95_ms:200,p99_ms:200,last_observed_at:"2026-09-08T09:00:00Z"},{surface:"mnemos.management",outcome:"unconfirmed",samples:1,p50_ms:null,p95_ms:null,p99_ms:null,last_observed_at:"2026-09-08T08:00:00Z"}], organization_work:{first_acceptance_at:"2026-09-08T08:00:00Z",first_publication_at:"2026-09-08T08:00:00Z",observed_at:"2026-09-08T09:00:00Z",periods:[1,7,30].map(days=>({days,publications:25,projects:3,has_completed_publication:true,accepted_requests:4,accepted_request_projects:2}))}, activity_windows:{first_observed_at:"2026-09-08T08:00:00Z",observed_at:"2026-09-08T09:00:00Z",windows:[1,7,30].map(days=>({days,reporting_users:2,active_users:1}))}, external:{versions:{groups:[{operation:"read",environment:"local",observer_release:"",observer_version:"",samples:2,successes:1,duration_percentiles_ms:{p50:10,p95:5000,p99:5000}}],total_groups:1,truncated:false},window_start:"2026-09-07T09:00:00Z",observed_at:"2026-09-08T09:00:00Z",operations:[{operation:"read",duration_percentiles_ms:{p50:10,p95:5000,p99:5000},source_status:"ready",samples:2,successes:1,last_observed_at:"2026-09-08T08:55:00Z",last_success:false,last_outcome:"timeout",stale:true,mean_duration_ms:2500},{operation:"save",source_status:"unavailable",samples:0,successes:0,last_observed_at:null,last_success:null,last_outcome:null,stale:true,mean_duration_ms:null}]}, workflow_attempts:[{deployment:{environment:"historical-test",release:"release-old",source_revision:"",source_modified:null,go_version:"",schema_version:108},operation:"save",status:409,outcome:"branch.head_moved",attempts:2,workflows:1,mean_duration_ms:3,first_observed_at:"2026-09-08T08:00:00Z",last_observed_at:"2026-09-08T09:00:00Z"}], workflow:{first_observed_at:"2026-09-08T08:00:00Z",opened:4,saved:3,reviewed:2,published:1,opening_unobserved:1}, review_stages:{decisions:{tracked_candidates:3,historical_candidates:1,responded_candidates:2,returned_candidates:1,fully_approved_candidates:2,first_response:{samples:3,mean_ms:10000,p50_ms:8000,p95_ms:20000,p99_ms:20000},full_approval:{samples:2,mean_ms:25000,p50_ms:20000,p95_ms:30000,p99_ms:30000}},timing:{completed_samples:1,mean_completion_ms:20000,p50_completion_ms:20000,p95_completion_ms:20000,p99_completion_ms:20000,pending_candidates:2,oldest_pending_ms:120000},submitted:4,awaiting_decisions:2,rejected:1,approved:1,published:1,historical_completion_unknown:1}, readiness: {ready:false,reasons:["readiness.core"],checked_at:"2026-09-08T09:00:00Z"}, service: { started_at: "2026-09-08T08:00:00Z", observed_at: "2026-09-08T09:00:00Z", operations: [{ surface: "http", method: "/read", requests: 2, duration_seconds: 0.02, outcomes: { ok: 1, "access.denied": 1 }, buckets: [{upper_seconds: 0.01, count: 2}, {upper_seconds: null, count: 2}] }] }, recorded_at: "2026-09-08T09:00:00Z", shared_publications: 25, human_logins_24h: 7, authenticated_users_24h: 2, workspace_activity: { reporting_users: 2, active_users: 1, sessions: 2, active_seconds: 120, session_seconds: 180 } }; }
    async readPublicationPolicy(project) { assert.equal(project,"one"); return structuredClone(policy); }
    async listPolicyApprovers(project, cursor) { assert.equal(project,"one"); return cursor === "" ? { approvers: [{ principal_id: "reviewer", display_name: "Reviewer name" }], next_cursor: "next" } : { approvers: [{ principal_id: "alice", display_name: "Alice name" }], next_cursor: "" }; }
    async setPublicationPolicy(project, revision, domains) {
      policyWrites++; assert.equal(project,"one"); assert.equal(revision,policy.revision);
      if (policyFailure) throw new Error("stale policy");
      assert.deepEqual(domains, policyWrites === 1 ? [{ domain_id: "Engineering", node_ids: ["doc"], approver_ids: ["reviewer"] }] : [{ domain_id: "Engineering", node_ids: [], approver_ids: ["reviewer"], all_documents: true }]);
      policy = { project_id: project, revision: revision + 1, domains: structuredClone(domains) }; return { revision: policy.revision };
    }
    async openDraft(project) { assert.equal(project, "one"); return { head: personal }; }
    async readDraftDocument(project, node) { assert.equal(project, "one"); assert.equal(node, "doc"); return { head: personal, node_id: node, exists: true, content_type: "text/plain", conflicted: conflict, terms: conflict ? [{ present: true, negative: false }, { present: true, negative: true }] : [{ present: true, negative: false }] }; }
    async draftState(project) { assert.equal(project, "one"); return { personal_head: personal, shared_head: shared, personal_exists: true }; }
    async saveDraftDocument(project, node, upload, expected) {
      assert.deepEqual([project, node, upload, expected], ["one", "doc", "upload", personal]);
      saves++; if (failSave) throw new Error("lost reply");
      personal = "c".repeat(64); return { head: personal };
    }
    async listPublicationReviews(cursor) {
      if (cursor === "f".repeat(64)) return { reviews: [await this.readPublicationReview("e".repeat(64))], next_cursor: "" };
      assert.equal(cursor, "");
      return { reviews: [], next_cursor: "f".repeat(64) };
    }
    async readPublicationReview(id) {
      assert.equal(id, "e".repeat(64));
      if (failReview) throw new Error("revoked");
      return { candidate_id: id, project_id: "one", author_id: "alice", personal_head: personal, shared_head: shared, decision_version: decisionVersion, ready: approved, stale: false,
        domains: [{ domain_id: "Engineering <b>literal</b>", node_ids: ["doc"], approvers: assigned ? ["alice", "reviewer"] : ["reviewer"], decisions: approved ? [{ approver_id: "reviewer", approved: true }] : [] }] };
    }
    async recordReviewDecision(id, domain, version, accepted) {
      assert.deepEqual([id, domain, version], ["e".repeat(64), "Engineering <b>literal</b>", decisionVersion]);
      decisions.push(accepted); approved = accepted; decisionVersion++;
    }
    async requestPublicationReview(project, expected, sharedHead) {
      assert.deepEqual([project, expected, sharedHead], ["one", personal, shared]);
      reviews++; return { candidate_id: "e".repeat(64) };
    }
    async publishDraft(project, expected, sharedHead) {
      assert.deepEqual([project, expected, sharedHead], ["one", personal, shared]);
      publications++; return { personal_head: personal, shared_head: personal, published: true, conflicted: false };
    }
    task = null;
    async managedTaskRequest() { if (!this.task) return null; const request = { ...this.task }; delete request.outcome; return request; }
    async prepareAgentTask(binding, message, criteria) { assert.equal(criteria,"Answer from knowledge"); this.task = { request_id: "task", binding_id: binding, message, criteria, submitted: false }; return this.task; }
    async budgetSavedAgentTask(id,project,estimate,limit) { assert.deepEqual([id,project,estimate,limit],["task","one","0","1000000"]); this.task={...this.task,team_budget:{project_id:project,proposal_id:"approved-proposal",role:"researcher"}}; return this.task; }
    async reviewSavedAgentTask(id,revision,result,decision,comment) { assert.deepEqual([id,revision,result,decision,comment],["task",0,"<script>task-output</script>","accepted","Matches criteria"]); this.task={...this.task,review:{revision:1,decision,comment,reviewer_id:"alice",reviewed_at:"2026-09-09T00:00:00Z"}}; return this.task; }
    async submitSavedAgentTask(id) { assert.equal(id, "task"); this.task = { ...this.task, submitted: true, outcome: { request_id: id, state: "completed", result: { content: "<script>task-output</script>" } } }; return this.task; }
    async refreshSavedAgentTask(id) { assert.equal(id, "task"); if (failTaskStatus) throw new Error("revoked"); return this.task; }
    async finishSavedAgentTask(id) { assert.equal(id, "task"); this.task = null; }
    managed = null;
    async managedAgentRequest() { return this.managed; }
    async prepareManagedAgent(template) { this.managed = { request_id: "a".repeat(43), template_id: template }; return this.managed; }
    async submitManagedAgent(id) {
      assert.equal(id, this.managed.request_id);
      this.managed = { ...this.managed, result: { binding_id: "managed", agent_principal_id: "managed-agent" } };
      return this.managed;
    }
    async finishManagedAgentRequest(id) { assert.equal(id, this.managed.request_id); this.managed = null; }
    async whoAmI() { return { subject: { tenant_id: "org", user_id: "alice" }, tenant_name: "Example team" }; }
    async listProjects() { return { projects: [{ id: "one", name: "Shared project", slug: "shared" }] }; }
    async browseProject(id, cursor) { assert.equal(id, "one"); assert.equal(cursor, ""); return { nodes: [{ node_id: "doc", name: "Team note", is_dir: false }], truncated: false }; }
    async searchProject(project, query) {
      assert.equal(project, "one"); searches++;
      if (query === "failure") throw new Error("fixture search failure");
      assert.equal(query, "knowledge");
      return { hits: [{ project_id: "one", node_id: "doc", name: "Found note", text: "Result <img src=x onerror=evil()>", ordinal: 0 }], index_pending: true, degraded: false };
    }
    async nodeHistory(project, node, cursor) {
      assert.deepEqual([project, node], ["one", "doc"]);
      if (failHistory) throw new Error("access revoked");
      if (cursor === "older") return { events: [{ event_id: "initial", content_type: "text/plain", recorded_at: "2026-09-01T12:00:00Z", observed: true, exists: true, actor: "", on_behalf_of: "" }] };
      assert.equal(cursor, "");
      return { events: [{ event_id: "deleted", recorded_at: "2026-09-07T12:00:00Z", observed: false, exists: false, actor: "agent <b>literal</b>", on_behalf_of: "alice" }], next_cursor: "older" };
    }
    async readProjectDocument(project, id) { assert.equal(project, "one"); return this.readDocument(id); }
    async readDocument(id) { assert.equal(id, "doc"); return { node_id: "doc", text: publications ? "Published edit" : "Shared knowledge <b>plain text</b>", media_type: "text/plain", truncated: true }; }
    async listAgentConnections() {
      reads++;
      return { connections: [{ binding_id: "binding", agent_principal_id: "agent<script>", runtime_id: "custom-runtime", managed_runtime: true, runtime_agent_id: "laptop", revoked }] };
    }
    async revokeAgentConnection(id) { assert.equal(id, "binding"); writes++; revoked = true; }
  }
  class Host extends RpcTarget {
    #ui = new UI();
    get ui() { return this.#ui; }
    async downloadReviewText(review, node, version, side) {
      assert.deepEqual([review, node, version], ["e".repeat(64), "doc", 1]); comparisonSides.push(side);
      if (failComparison && side === "after") throw new Error("revoked during transfer");
      return side === "before" ? "Old <b>literal</b> text" : null;
    }
    async downloadText(project, node, head, side) {
      if (head === "publication:initial") {
        assert.deepEqual([project, node, side], ["one", "doc", 0]);
        if (failHistoricalText) throw new Error("rights revoked during download");
        return "Historical <b>literal</b> text";
      }
      assert.deepEqual([project,node,head,side], ["one","doc",personal,conflict ? 1 : 0]); return "Personal draft";
    }
    async uploadText(project, text) { assert.equal(project, "one"); assert.equal(text, "Edited draft"); return "upload"; }
    async subscribeTheme() { return "dark"; }
  }
  let peer; const ports = [];
  const html = await readFile(new URL("../src/generated/app.txt", import.meta.url), "utf8");
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      for (const key of ["ReadableStream", "WritableStream", "TransformStream", "TextEncoder", "TextDecoder", "Request", "Response", "Headers"]) window[key] = globalThis[key];
      window.confirm = () => true;
      window.MessageChannel = class extends MessageChannel {
        constructor() { super(); ports.push(this.port1, this.port2); }
      };
      window.postMessage = (message, origin, transferred) => {
        assert.equal(message.type, "handshake"); assert.equal(origin, "*");
        peer = newMessagePortRpcSession(transferred[0], new Host());
      };
    },
  });
  const button = text => [...dom.window.document.querySelectorAll("button")].find(b => b.textContent === text);
  try {
    await until(() => button("Отозвать доступ")).catch(error => { error.message += ": " + dom.window.document.body.textContent.slice(0,400) + " reads=" + reads; throw error; });
    await until(()=>uiReadiness.some(s=>s.outcome==="ready"));
    assert.equal(uiReadiness[0].outcome,"pending");
    button("Метрики платформы").click();
    await until(() => dom.window.document.body.textContent.includes("Завершённые публикации: 25"));
    assert.ok(dom.window.document.body.textContent.includes("Вошедшие пользователи за 24 часа: 2"));
    assert.ok(dom.window.document.body.textContent.includes("Успешные входы за 24 часа: 7"));
    assert.ok(dom.window.document.body.textContent.includes("Активность команды за 24 часа: 1 пользователей · 2 рабочих сессий · 2.0 мин активности"));
    assert.ok(dom.window.document.body.textContent.includes("среднее 10.0 мс; p50 по корзинам — не более 10 мс; p95 по корзинам — не более 10 мс; p99 по корзинам — не более 10 мс"));
    assert.ok(dom.window.document.body.textContent.includes("access.denied: 1"));
    assert.ok(dom.window.document.body.textContent.includes("Причины недоступности: readiness.core"));
    assert.ok(dom.window.document.body.textContent.includes("Согласования: 4 кандидатов"));
    assert.ok(dom.window.document.body.textContent.includes("Внешние проверки по версиям наблюдателя: 1 групп"));
    assert.ok(dom.window.document.body.textContent.includes("окружение local; релиз наблюдателя неизвестен; код неизвестен: 1 из 2 успешно."));
    assert.ok(dom.window.document.body.textContent.includes("Готовность по версиям коллектора: 2 групп"));
    assert.ok(dom.window.document.body.textContent.includes("коллектор неизвестен; ready: 2"));
    assert.ok(dom.window.document.body.textContent.includes("коллектор asset:index-current.js; ready: 1"));
    assert.ok(dom.window.document.body.textContent.includes("окружение — test, релиз — не указан, схема — 65"));
    assert.ok(dom.window.document.body.textContent.includes("сборка с незакоммиченными изменениями"));
    assert.ok(dom.window.document.body.textContent.includes("1 из 2 кандидатов, получивших ответ (50.0%)"));
    assert.ok(dom.window.document.body.textContent.includes("До первого ответа назначенного согласующего: 3 замеров; среднее 10.0 с"));
    assert.ok(dom.window.document.body.textContent.includes("среднее 20.0 с, p50 20.0 с"));
    assert.ok(dom.window.document.body.textContent.includes("Самый старый отправлен 120.0 с назад"));
    assert.ok(dom.window.document.body.textContent.includes("Подтверждённые публикации согласованных кандидатов: 1"));
    assert.ok(dom.window.document.body.textContent.includes("Дошли от открытия до публикации: 25.0%"));
    assert.ok(dom.window.document.body.textContent.includes("Сценарии без наблюдавшегося начала: 1"));
    assert.ok(dom.window.document.body.textContent.includes("Сохранение: 2 попыток в 1 сценариях; отказ, HTTP 409, branch.head_moved"));
    assert.ok(dom.window.document.body.textContent.includes("Чтение: 1 из 2 успешно (50.0%); ошибок — 1"));
    assert.ok(dom.window.document.body.textContent.includes("Данные устарели или ещё не поступали."));
    assert.ok(dom.window.document.body.textContent.includes("Сохранение: наблюдения недоступны (unavailable)"));
    assert.ok(dom.window.document.body.textContent.includes("За 7 дн.: активных людей — 1; телеметрия от 2."));
    assert.ok(dom.window.document.body.textContent.includes("История наблюдений короче 30 дн."));
    assert.ok(dom.window.document.body.textContent.includes("За 7 дн.: 25 публикаций в 3 проектах; есть подтверждённый результат."));
    assert.ok(dom.window.document.body.textContent.includes("p50 — 10.0 мс; p95 — 5000.0 мс; p99 — 5000.0 мс"));
    assert.ok(dom.window.document.body.textContent.includes("Панель Mnemos: готово — 2 за 24 часа."));
    assert.ok(dom.window.document.body.textContent.includes("Docs: готово — 3 за 24 часа."));
    assert.ok(!dom.window.document.body.textContent.includes("Панель Mnemos: готово — 3"));
    assert.ok(dom.window.document.body.textContent.includes("Панель Mnemos: результат не подтверждён — 1 за 24 часа."));
    assert.ok(dom.window.document.body.textContent.includes("За 7 дн.: впервые принятых поручений — 4, проектов — 2."));
    assert.ok(dom.window.document.body.textContent.includes("Контекст попыток: окружение historical-test; релиз release-old;"));
    assert.ok(dom.window.document.body.textContent.includes("Внешнее чтение: Тревога — последняя проверка неуспешна."));
    assert.ok(dom.window.document.body.textContent.includes("Внешнее сохранение: Неизвестно — наблюдений нет."));
    const readsBeforeOwners=metricReads;
    button("Ответственные за сигналы").click();
    await until(()=>button("Закрыть ответственных"));
    button("Закрыть ответственных").click();
    await until(()=>metricReads===readsBeforeOwners+1 && dom.window.document.body.textContent.includes("Сигналы состояния платформы"));
    failMetrics = true;
    button("Метрики платформы").click();
    await until(() => dom.window.document.body.textContent.includes("Метрики недоступны"));
    assert.ok(!dom.window.document.body.textContent.includes("Завершённые публикации: 25"));
    assert.ok(!dom.window.document.body.textContent.includes("Сигналы состояния платформы"));
    assert.ok(!dom.window.document.body.textContent.includes("впервые принятых поручений — 4"));
    assert.ok(!dom.window.document.body.textContent.includes("access.denied: 1"));
    assert.ok(!dom.window.document.body.textContent.includes("Причины недоступности:"));
    assert.ok(!dom.window.document.body.textContent.includes("Согласования: 4 кандидатов"));
    assert.ok(!dom.window.document.body.textContent.includes("asset:index-current.js"));
    assert.ok(!dom.window.document.body.textContent.includes("окружение — test"));
    assert.ok(!dom.window.document.body.textContent.includes("50.0%"));
    assert.ok(!dom.window.document.body.textContent.includes("среднее 20.0 с"));
    assert.ok(!dom.window.document.body.textContent.includes("Дошли от открытия до публикации:"));
    assert.ok(!dom.window.document.body.textContent.includes("branch.head_moved"));
    assert.ok(!dom.window.document.body.textContent.includes("Внешние проверки за последние"));
    assert.ok(!dom.window.document.body.textContent.includes("За 7 дн.: активных людей"));
    assert.ok(!dom.window.document.body.textContent.includes("Результаты этой организации:"));
    assert.ok(!dom.window.document.body.textContent.includes("p50 — 10.0 мс"));
    assert.ok(!dom.window.document.body.textContent.includes("Панель Mnemos: готово"));
    assert.equal(writes, 0);
    const template = dom.window.document.querySelector("input[maxlength='255']");
    template.value = "writer"; template.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    button("Подготовить заявку").click();
    await until(() => button("Выполнить / повторить выдачу") && !button("Выполнить / повторить выдачу").disabled);
    button("Выполнить / повторить выдачу").click();
    await until(() => button("Новая заявка") && !button("Новая заявка").disabled);
    assert.ok(dom.window.document.body.textContent.includes("Агент подготовлен"));
    button("Новая заявка").click();
    await until(() => button("Подготовить заявку") && !button("Подготовить заявку").disabled);
    const agentSelect = dom.window.document.querySelector("select"); agentSelect.value = "binding"; agentSelect.dispatchEvent(new dom.window.Event("change"));
    const taskArea = dom.window.document.querySelector("textarea"); taskArea.value = "Read knowledge"; taskArea.dispatchEvent(new dom.window.Event("input"));
    const criteriaArea=dom.window.document.querySelector('[aria-label="Критерии приёмки задачи"]');criteriaArea.value="Answer from knowledge";criteriaArea.dispatchEvent(new dom.window.Event("input"));
    button("Сохранить задачу").click(); await until(() => button("Сохранить бюджет задачи") && !button("Сохранить бюджет задачи").disabled);
    assert.equal(button("Запустить задачу"),undefined);
    const budgetProject=dom.window.document.querySelector("select");budgetProject.value="one";budgetProject.dispatchEvent(new dom.window.Event("change"));
    const budgetLimit=dom.window.document.querySelector('[aria-label="Предел задачи, USD"]');budgetLimit.value="1";budgetLimit.dispatchEvent(new dom.window.Event("input"));
    button("Сохранить бюджет задачи").click();await until(()=>button("Запустить задачу")&&!button("Запустить задачу").disabled);
    button("Запустить задачу").click(); await until(() => button("Принять результат") && !button("Принять результат").disabled);
    assert.equal(button("Новая задача"),undefined);
    const reviewComment=dom.window.document.querySelector('[aria-label="Комментарий приёмки"]');reviewComment.value="Matches criteria";reviewComment.dispatchEvent(new dom.window.Event("input"));
    button("Принять результат").click();await until(()=>button("Новая задача")&&!button("Новая задача").disabled);
    assert.ok(dom.window.document.body.textContent.includes("<script>task-output</script>"));
    assert.equal(dom.window.document.querySelector("pre script"), null);
    failTaskStatus = true;
    button("Проверить состояние задачи").click();
    await until(() => button("Повторить ту же заявку") && !button("Повторить ту же заявку").disabled);
    assert.ok(!dom.window.document.body.textContent.includes("<script>task-output</script>"));
    failTaskStatus = false;
    button("Проверить состояние задачи").click();
    await until(() => button("Новая задача") && !button("Новая задача").disabled);
    button("Новая задача").click(); await until(() => button("Сохранить задачу") && !button("Сохранить задачу").disabled);
    assert.ok(dom.window.document.body.textContent.includes("Example team · alice"));
    assert.ok(dom.window.document.body.textContent.includes("Shared project"));
    button("Согласования").click();
    await until(() => button("Следующая страница согласований"));
    assert.ok(dom.window.document.body.textContent.includes("На этой странице нет доступных предложений"));
    button("Следующая страница согласований").click();
    await until(() => button("Открыть согласование"));
    assert.ok(dom.window.document.body.textContent.includes("Отправлено вами"));
    button("Открыть согласование").click();
    await until(() => button("Обновить открытое согласование"));
    assert.ok(dom.window.document.body.textContent.includes("reviewer: Ожидается решение"));
    button("Сравнить документ doc").click();
    await until(() => dom.window.document.body.textContent.includes("Документ будет удалён"));
    assert.deepEqual(comparisonSides, ["before", "after"]);
    assert.ok(dom.window.document.body.textContent.includes("Old <b>literal</b> text"));
    assert.equal(dom.window.document.querySelector("pre b"), null);
    failComparison = true;
    button("Сравнить документ doc").click();
    await until(() => dom.window.document.body.textContent.includes("Не удалось загрузить сравнение"));
    assert.equal(dom.window.document.querySelector("pre"), null);
    assert.ok(!dom.window.document.body.textContent.includes("Документ будет удалён"));
    failComparison = false;
    assert.equal(button("Согласовать направление"), undefined);
    assigned = true;
    button("Обновить открытое согласование").click();
    await until(() => button("Согласовать направление"));
    assert.equal(button("Согласовать направление").disabled, true);
    button("Сравнить документ doc").click();
    await until(() => button("Согласовать направление")?.disabled === false);
    const accept = button("Согласовать направление"); accept.click(); accept.click();
    assert.deepEqual(decisions, []); const confirmation=button("Подтвердить решение"); confirmation.click(); confirmation.click();
    await until(() => dom.window.document.body.textContent.includes("Согласие записано"));
    assert.deepEqual(decisions, [true]);
    assert.equal(button("Согласовать направление").disabled, true);
    button("Отклонить направление").click();
    assert.deepEqual(decisions, [true]); button("Подтвердить решение").click();
    await until(() => dom.window.document.body.textContent.includes("Отказ записан"));
    assert.deepEqual(decisions, [true, false]);


    failReview = true;
    button("Обновить открытое согласование").click();
    await until(() => dom.window.document.body.textContent.includes("Согласование недоступно"));
    assert.equal(button("Открыть согласование"), undefined);
    assert.ok(!dom.window.document.body.textContent.includes("reviewer: Ожидается решение"));
    failReview = false;
    button("К документам").click();

    assert.equal(dom.window.document.querySelectorAll("script").length, 1);
    button("Shared project").click(); await until(() => button("Team note"));
    button("Настроить согласования").click();
    await until(() => button("Добавить направление"));
    button("Добавить направление").click();
    const direction = dom.window.document.querySelector('[aria-label="Название направления 1"]');
    direction.value = "Engineering"; direction.dispatchEvent(new dom.window.Event("input"));
    const choose = text => [...dom.window.document.querySelectorAll("label")].find(label => label.textContent === text).querySelector("input").click();
    choose("Team note"); choose("Reviewer name");
    button("Загрузить ещё людей").click();
    await until(() => dom.window.document.body.textContent.includes("Alice name"));
    const savePolicy = button("Сохранить настройки согласования"); savePolicy.click(); savePolicy.click();
    await until(() => dom.window.document.body.textContent.includes("Настройки согласования сохранены"));
    assert.equal(policyWrites,1);
    choose("Все документы проекта, включая новые");
    button("Сохранить настройки согласования").click();
    await until(() => policyWrites === 2 && dom.window.document.body.textContent.includes("Настройки согласования сохранены"));
    assert.equal(policy.domains[0].all_documents, true); assert.deepEqual(policy.domains[0].node_ids, []);
    policyFailure = true;
    button("Сохранить настройки согласования").click();
    await until(() => dom.window.document.body.textContent.includes("Сохранение не подтверждено: права или версия могли измениться"));
    assert.equal(policyWrites,3); assert.equal(button("Сохранить настройки согласования"),undefined);
    assert.equal(dom.window.document.querySelector('[aria-label="Название направления 1"]').value,"Engineering");
    button("Перечитать настройки").click();
    await until(() => button("Сохранить настройки согласования"));
    button("Закрыть настройки").click(); policyFailure = false;

    const search = query => {
      const input = dom.window.document.querySelector('input[type="search"]');
      input.value = query; input.dispatchEvent(new dom.window.Event("input"));
      button("Найти").click();
    };
    assert.equal(button("Найти").type, "button", "sandbox forbids native form submission");
    search("knowledge"); await until(() => button("Found note"));
    assert.equal(searches, 1);
    assert.ok(dom.window.document.body.textContent.includes("ещё индексируется"));
    assert.ok(dom.window.document.body.textContent.includes("Result <img"));
    assert.equal(dom.window.document.querySelector("img"), null);
    button("Found note").click(); await until(() => dom.window.document.querySelector("pre"));
    search("failure"); await until(() => dom.window.document.body.textContent.includes("Не удалось выполнить поиск"));
    assert.equal(button("Found note"), undefined);
    assert.equal(dom.window.document.querySelector("pre"), null);
    button("Team note").click(); await until(() => dom.window.document.querySelector("pre"));
    assert.equal(dom.window.document.querySelector("pre").textContent, "Shared knowledge <b>plain text</b>");
    assert.equal(dom.window.document.querySelector("pre b"), null);
    assert.ok(dom.window.document.body.textContent.includes("Показана часть текста документа"));
    button("История: Team note").click();
    await until(() => button("Следующая страница истории"));
    assert.ok(dom.window.document.body.textContent.includes("Документ удалён из общей версии"));
    assert.ok(dom.window.document.body.textContent.includes("От имени: alice"));
    assert.equal(dom.window.document.querySelector("section b"), null);
    button("Выбрать для сравнения").click();
    button("Следующая страница истории").click();
    await until(() => dom.window.document.body.textContent.includes("Состояние на момент подключения истории"));
    assert.ok(!dom.window.document.body.textContent.includes("agent <b>literal</b>"));
    button("Сравнить с выбранной").click();
    await until(() => dom.window.document.querySelector('section[aria-label="Сравнение опубликованных версий"]'));
    const compared = dom.window.document.querySelector('section[aria-label="Сравнение опубликованных версий"]');
    assert.ok(compared.textContent.includes("Документ отсутствует"));
    assert.ok(compared.textContent.includes("Содержимое версий отличается"));
    assert.equal(compared.querySelector("pre").textContent, "Historical <b>literal</b> text");
    assert.equal(compared.querySelector("b"), null);
    // Transfer succeeds, but the final rights check fails: neither side remains.
    failHistory = true;
    button("Сравнить с выбранной").click();
    await until(() => dom.window.document.body.textContent.includes("Не удалось сравнить версии"));
    assert.equal(dom.window.document.querySelector('section[aria-label="Сравнение опубликованных версий"]'), null);
    assert.equal(dom.window.document.querySelector("pre"), null);
    failHistory = false;
    button("История: Team note").click(); await until(() => button("Следующая страница истории"));
    button("Следующая страница истории").click(); await until(() => button("Открыть эту версию"));
    button("Открыть эту версию").click();
    await until(() => dom.window.document.querySelector('pre[aria-label="Текст опубликованной версии"]'));
    assert.equal(dom.window.document.querySelector('pre[aria-label="Текст опубликованной версии"]').textContent, "Historical <b>literal</b> text");
    assert.equal(dom.window.document.querySelector("section b"), null);
    failHistoricalText = true;
    button("Открыть эту версию").click();
    await until(() => dom.window.document.body.textContent.includes("Не удалось открыть версию"));
    assert.equal(dom.window.document.querySelector("section pre"), null);
    button("История: Team note").click(); await until(() => button("Обновить историю"));
    failHistory = true;
    button("Обновить историю").click();
    await until(() => dom.window.document.body.textContent.includes("История недоступна"));
    assert.equal(dom.window.document.querySelector('section[aria-label="История публикаций"]'), null);
    assert.equal(dom.window.document.querySelector("pre"), null);
    failHistory = false;
    button("Team note").click(); await until(() => dom.window.document.querySelector("pre"));
    button("Редактировать личный черновик").click();
    await until(() => dom.window.document.querySelector('textarea[aria-label="Текст личного черновика"]'));
    let area = dom.window.document.querySelector('textarea[aria-label="Текст личного черновика"]');
    assert.equal(area.value, "Personal draft");
    area.value = "Edited draft"; area.dispatchEvent(new dom.window.Event("input"));
    button("Опубликовать изменения проекта…").click();
    assert.equal(publications, 0);
    assert.ok(dom.window.document.body.textContent.includes("Сначала сохраните"));
    const save = button("Сохранить черновик"); save.click(); save.click();
    await until(() => dom.window.document.body.textContent.includes("Черновик сохранён"));
    assert.equal(saves, 1); assert.equal(publications, 0);
    const review = button("Отправить изменения на согласование"); review.click(); review.click();
    assert.equal(reviews,0); const send=button("Подтвердить отправку на согласование"); send.click(); send.click();
    await until(() => dom.window.document.body.textContent.includes("Изменения отправлены на согласование"));
    assert.equal(reviews, 1); assert.equal(publications, 0);
    assert.ok(dom.window.document.body.textContent.includes("reviewer: Ожидается решение"));
    assert.equal(dom.window.document.querySelector("h4 b"), null);
    button("Опубликовать изменения проекта…").click();
    await until(() => dom.window.document.body.textContent.includes("Для публикации нужны актуальные решения"));
    assert.equal(button("Подтвердить публикацию проекта"), undefined);
    approved = true;
    button("Обновить статус согласования").click();
    await until(() => dom.window.document.body.textContent.includes("Все согласующие приняли эту версию"));
    failReview = true;
    button("Обновить статус согласования").click();
    await until(() => dom.window.document.body.textContent.includes("Не удалось обновить согласование"));
    assert.ok(!dom.window.document.body.textContent.includes("Все согласующие приняли эту версию"));
    failReview = false;

    button("Опубликовать изменения проекта…").click();
    await until(() => button("Подтвердить публикацию проекта"));
    assert.equal(publications, 0);
    const publish = button("Подтвердить публикацию проекта"); publish.click(); publish.click();
    await until(() => dom.window.document.body.textContent.includes("Изменения проекта опубликованы"));
    assert.equal(publications, 1);
    button("Закрыть редактор").click();
    await until(() => button("Редактировать личный черновик"));
    assert.equal(dom.window.document.querySelector("pre").textContent, "Published edit");
    failSave = true;
    button("Редактировать личный черновик").click();
    await until(() => dom.window.document.querySelector('textarea[aria-label="Текст личного черновика"]'));
    area = dom.window.document.querySelector('textarea[aria-label="Текст личного черновика"]');
    area.value = "Edited draft"; area.dispatchEvent(new dom.window.Event("input"));
    button("Сохранить черновик").click();
    await until(() => dom.window.document.body.textContent.includes("Сохранение не подтверждено"));
    assert.equal(dom.window.document.querySelector('textarea[aria-label="Текст личного черновика"]').value, "Edited draft");
    assert.equal(button("Сохранить черновик"), undefined); assert.equal(saves, 2);
    button("Закрыть редактор").click();
    await until(() => button("Редактировать личный черновик"));
    conflict = true;
    button("Редактировать личный черновик").click();
    await until(() => button("Открыть сторону 2 (основание слияния)"));
    assert.equal(dom.window.document.querySelector('textarea[aria-label="Текст личного черновика"]'), null);
    button("Открыть сторону 2 (основание слияния)").click();
    await until(() => dom.window.document.querySelector('textarea[aria-label="Текст личного черновика"]'));
    assert.equal(dom.window.document.querySelector('textarea[aria-label="Текст личного черновика"]').value, "Personal draft");
    button("Закрыть редактор").click();
    await until(() => button("Редактировать личный черновик"));
    button("Отозвать доступ").click(); assert.equal(writes, 0);
    const confirm = button("Подтвердить отзыв"); confirm.click(); confirm.click();
    await until(() => dom.window.document.body.textContent.includes("Доступ отозван"));
    assert.equal(writes, 1); assert.equal(reads, 2);
    assert.equal(dom.window.document.documentElement.style.colorScheme, "dark");
    assert.equal(button("Отозвать доступ"), undefined);
  } finally {
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    peer?.[Symbol.dispose](); dom.window.close();
    for (const port of ports) port.close();
  }
});
