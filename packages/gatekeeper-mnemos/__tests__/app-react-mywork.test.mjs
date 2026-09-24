import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEW_MINE, REVIEW_READY, defaultMethods, mountMemoryApp } from "./app-react-harness.mjs";
import { inboxDecisions } from "../src/inbox-count.ts";

const SCOPE = { scope_id: "team", revision: 3, name: "Финансовая группа", level: "group", parent_id: "", reader_group_id: "", enabled: true, approvers: ["alice"] };
const PROPOSAL = { proposal_id: "q", request_id: "rq", template_id: "template", template_key: "budget", template_revision: 2, target_scope_id: "team", target_scope_revision: 3, scope_path: [{ scope_id: "team" }], user_id: "author", message: "Уточнить расчёт бюджета", created_at: "2026-09-20T10:00:00Z" };
const ALERT = { id: "al-1", blob_sha256_hex: "a".repeat(64), pipeline_version: 1, database: "", project: "", stage: "classify", reason: "low_confidence", detail: "Модель не уверена в области", candidates: [], paths: ["Счёт.pdf"], status: "open", placement: "", decided_by: "", note: "", raised_at: "2026-09-22T10:00:00Z", decided_at: "", suggested_domain: "финансовый" };

/** Входящие с решениями всех видов: согласование, публикация, приёмка, шаблон, вопрос приёмной. */
function mixed() {
  return {
    async listTemplateReviewScopes() { return { scopes: [SCOPE], next_cursor: "" }; },
    async listTemplateProposals() { return { proposals: [{ proposal: PROPOSAL }, { proposal: { ...PROPOSAL, proposal_id: "own", user_id: "alice", message: "Своё предложение" } }], next_cursor: "" }; },
    async inboxAlerts(decided, project) { return { alerts: !decided && project === "two" ? [ALERT] : [], truncated: false }; },
    async readCollaborationProgress(id) { return { state: id === "r-2" ? "awaiting_review" : "awaiting_result", result_sequence: 1, review_revision: 0 }; },
  };
}
const rowsOf = app => [...app.document.querySelectorAll("#root [data-inbox]")];

test("«Входящие»: все виды решений одним плоским списком по времени, число — в подзаголовке", async () => {
  const app = await mountMemoryApp(mixed());
  try {
    assert.equal(app.document.querySelector("#root h1").textContent, "Входящие", "раздел по умолчанию");
    await app.until(() => rowsOf(app).length === 5, "пять решений");
    // Предложения публикации без времени — первыми; дальше новое сверху: приёмная (22.09), шаблон (20.09), приёмка (12.09).
    assert.deepEqual(rowsOf(app).map(r => r.dataset.inbox), ["approval", "publish", "intake", "template", "acceptance"]);
    assert.ok(rowsOf(app)[2].textContent.includes("Счёт.pdf") && rowsOf(app)[2].textContent.includes("Второй проект"), "вопрос приёмной с проектом");
    assert.ok(!app.text().includes("Своё предложение"), "собственное предложение шаблона не ждёт моего решения");
    assert.equal(app.document.querySelector('#root [aria-label="Что показать"]'), null, "фильтров над списком нет");
    assert.ok(app.document.querySelector("#root header p").textContent.includes("5 вещей ждут вашего решения"), "подзаголовок с числом");
    assert.equal(app.tabs().length, 0, "без вкладок");

    const rowWith = name => rowsOf(app).find(r => r.textContent.includes(name));
    [...rowWith("Инженерия").querySelectorAll("button")].find(b => b.textContent === "Согласовать").click();
    await app.until(() => app.calls.some(([m]) => m === "recordReviewDecision"), "решение записано из строки");
    assert.deepEqual(app.calls.find(([m]) => m === "recordReviewDecision"), ["recordReviewDecision", REVIEW_MINE, "Инженерия", 3, true]);

    [...rowsOf(app).find(r => r.dataset.inbox === "publish").querySelectorAll("button")].find(b => b.textContent === "Опубликовать").click();
    await app.until(() => app.text().includes("Изменения проекта опубликованы"), "публикация подтверждена");
    const publish = app.calls.find(([m]) => m === "publishDraft");
    assert.equal(publish[1], "one"); assert.equal(publish[2], "a".repeat(64)); assert.equal(publish[3], "b".repeat(64));
    assert.ok(!app.calls.some(([m, id]) => m === "publishDraft" && id === REVIEW_READY), "публикация идёт по проекту и версиям, а не по кандидату");
  } finally { app.dispose(); }
});

test("«Входящие»: число строк совпадает с общим подсчётом счётчика навигации", async () => {
  const methods = mixed();
  const app = await mountMemoryApp(methods);
  try {
    await app.until(() => rowsOf(app).length === 5, "список");
    const base = defaultMethods([]);
    const reviews = (await base.listPublicationReviews()).reviews;
    const requests = (await base.listCollaborations()).requests;
    const collaborations = await Promise.all(requests.map(async request => ({ request, progress: await methods.readCollaborationProgress(request.request_id) })));
    const templates = (await methods.listTemplateProposals()).proposals.map(review => ({ scope: SCOPE, review }));
    const alerts = (await methods.inboxAlerts(false, "two")).alerts.map(alert => ({ project: "two", alert }));
    assert.equal(inboxDecisions(reviews, collaborations, "alice", { templates, alerts }), rowsOf(app).length);
  } finally { app.dispose(); }
});

test("«Входящие»: выбор строки открывает подробности, решение из панели идёт тем же методом", async () => {
  const app = await mountMemoryApp({ ...mixed(),
    async listCollaborationMessages() { return { messages: [{ sequence: 1, user_id: "carol", agent_id: "", kind: "result", body: "Готовый лендинг", created_at: "2026-09-12T11:00:00Z" }] }; },
    async reviewCollaborationResult(...args) { app.calls.push(["reviewCollaborationResult", ...args]); },
  });
  try {
    await app.until(() => rowsOf(app).length === 5, "список");
    const panel = () => app.document.querySelector('#root aside[aria-label="Подробности"]');
    rowsOf(app).find(r => r.dataset.inbox === "approval").querySelector("button").click();
    await app.until(() => panel()?.textContent.includes("carol: одобрено"), "подробности согласования");
    [...panel().querySelectorAll("button")].find(b => b.textContent === "Отклонить").click();
    await app.until(() => app.calls.some(([m]) => m === "recordReviewDecision"), "отказ записан");
    assert.deepEqual(app.calls.find(([m]) => m === "recordReviewDecision"), ["recordReviewDecision", REVIEW_MINE, "Инженерия", 3, false]);

    [...rowsOf(app).find(r => r.dataset.inbox === "acceptance").querySelectorAll("button")].find(b => b.textContent === "Проверить результат").click();
    await app.until(() => panel()?.textContent.includes("Готовый лендинг"), "результат виден прямо во «Входящих», без формы обращения");
    [...panel().querySelectorAll("button")].find(b => b.textContent === "Принять").click();
    await app.until(() => app.calls.some(([m]) => m === "reviewCollaborationResult"), "приёмка записана");
    const [, id, review] = app.calls.find(([m]) => m === "reviewCollaborationResult");
    assert.equal(id, "r-2"); assert.equal(review.decision, "accepted"); assert.equal(review.result_sequence, 1); assert.equal(review.expected_revision, 0);
    [...panel().querySelectorAll("button")].find(b => b.textContent === "Закрыть").click();
    await app.until(() => !panel(), "панель закрыта");
  } finally { app.dispose(); }
});

test("«Входящие»: пустое состояние говорит, что появится; отказ источника показан", async () => {
  const app = await mountMemoryApp({
    async listPublicationReviews() { return { reviews: [], next_cursor: "" }; },
    async listCollaborations() { throw new Error("forbidden"); },
    async listTemplateReviewScopes() { throw new Error("forbidden"); },
  });
  try {
    await app.until(() => app.text().includes("Сейчас ничего не ждёт вашего решения"), "пустое состояние");
    assert.ok(app.text().includes("вопросы по загруженным материалам"));
    await app.until(() => app.text().includes("Согласования шаблонов не прочитаны"), "отказ источника шаблонов виден");
    const block = name => app.document.querySelector(`#root section[aria-label="${name}"]`);
    await app.until(() => block("Поручено мне")?.textContent.includes("Обращения недоступны"), "отказ в поручениях");
    assert.equal(block("Жду решения других"), null, "пустой блок ожиданий не показывается");
    for (const gone of ["Мои загрузки", "Поручить", "Разрешения агентов"]) assert.equal(app.button(gone), undefined, `в шапке «Входящих» нет «${gone}»`);
    assert.ok(!app.text().includes("Аудио"), "карточки «Аудио» нет");
  } finally { app.dispose(); }
});

test("«Входящие»: поручено мне и ожидание чужих решений — под списком", async () => {
  const app = await mountMemoryApp();
  try {
    const block = name => app.document.querySelector(`#root section[aria-label="${name}"]`);
    await app.until(() => block("Поручено мне")?.textContent.includes("Проверить ТЗ на страницу цен"), "поручение мне");
    assert.ok(block("Поручено мне").textContent.includes("Общий проект") && block("Поручено мне").textContent.includes("срок не задан"));
    assert.ok(!block("Поручено мне").textContent.includes("Согласовать подрядчика"), "своё обращение не в «поручено мне»");
    await app.until(() => block("Жду решения других")?.textContent.includes("Согласовать подрядчика"), "моё обращение ждёт результата");
    assert.ok(block("Жду решения других").textContent.includes("carol"), "кто может разблокировать");
    [...block("Поручено мне").querySelectorAll("button")].find(b => b.textContent === "Открыть в беседе").click();
    await app.until(() => app.calls.some(([name]) => name === "openPrompt"), "поручение открывается в беседе");
    assert.equal(app.calls.find(([name]) => name === "openPrompt")[2].projectId, "one");
    assert.equal(app.document.querySelector('#root input[aria-label*="идентификатор"]'), null, "формы обращения с идентификаторами нет");
  } finally { app.dispose(); }
});

test("«Входящие»: просьбы агентов — письмо согласуется и уходит одной кнопкой, расход разрешает владелец бюджета", async () => {
  const decisions = [];
  const app = await mountMemoryApp({
    async listMailConnections() { return { connections: [{ connection_id: "m-1", project_id: "one", provider: "yandex", query_sha256: "", revision: 1, enabled: true }] }; },
    async listMailDrafts() { return { drafts: [{ id: "d-1", agent_id: "agent-alice", state: "pending", subject: "Счёт за сентябрь" }] }; },
    async readMailDraft(id) { return { id, connection_id: "m-1", agent_id: "agent-alice", sha256: "s".repeat(64), state: "pending", content: { to: ["client@example.test"], subject: "Счёт за сентябрь", body: "Добрый день! Высылаю счёт." } }; },
    async decideMailDraft(id, sha, approved) { decisions.push(["mail", id, approved]); return {}; },
    async readProjectBudget(project) { return { project_id: project, revision: 2, owner_id: project === "one" ? "alice" : "bob", limit_usd_micros: "10000000", automatic_usd_micros: "0", automatic_team_size: 1 }; },
    async listTeamBudgets(project) { return { proposals: project === "one" ? [{ id: "p-1", state: "awaiting_approval" }] : [] }; },
    async readTeamBudget(project, id) { return { id, project_id: project, user_id: "bob", agent_id: "agent-alice", automatic: false, created_at: "", state: "awaiting_approval", proposal: { policy_revision: 2, task: "Собрать отчёт по продажам", criteria: "таблица", estimate_usd_micros: "1000000", limit_usd_micros: "3000000", members: [{ binding_id: "b-managed", role: "analyst" }] } }; },
    async decideTeamBudget(project, id, input) { decisions.push(["budget", project, id, input.decision, input.policy_revision]); return {}; },
  });
  try {
    const card = kind => app.document.querySelector(`#root [data-agent-request="${kind}"]`);
    await app.until(() => card("mail") && card("budget"), "просьбы агентов");
    assert.ok(card("mail").textContent.includes("Счёт за сентябрь") && card("mail").textContent.includes("client@example.test"));
    assert.ok(card("budget").textContent.includes("до 3 $") && card("budget").textContent.includes("Общий проект"));
    [...card("mail").querySelectorAll("button")].find(b => b.textContent === "Согласовать и отправить").click();
    await app.until(() => app.calls.some(c => c[0] === "sendMailDraft"), "письмо отправлено через оболочку");
    assert.deepEqual(decisions[0], ["mail", "d-1", true]);
    [...card("budget").querySelectorAll("button")].find(b => b.textContent === "Разрешить").click();
    await app.until(() => decisions.some(d => d[0] === "budget"), "расход разрешён");
    assert.deepEqual(decisions.find(d => d[0] === "budget"), ["budget", "one", "p-1", "approved", 2]);
  } finally { app.dispose(); }
});

const SHARED = { project_id: "one", project_name: "Общий проект", node_id: "HEN4HKQ24UIOKVLJYW7SAQWKTP", owner_id: "user-FGTK3l4q5INoE4X1", owner_name: "Николай Деревцов", granted_by_name: "Николай Деревцов",
  name: "Дорожная карта перевода команды", content_type: "application/vnd.cloudflareos.document+json", head: "c".repeat(64), mode: "write", granted_at: "2026-09-23T10:00:00Z", seen: false };

test("«Входящие»: «поделился с вами документом» с кнопкой «Открыть»; открытие снимает отметку, прочитанное из списка уходит", async () => {
  let seen = false;
  const app = await mountMemoryApp({ ...mixed(), async listSharedDocuments() { return [{ ...SHARED, seen }]; }, async markSharedDocumentSeen() { seen = true; } }, { nativeOpen: true });
  try {
    await app.until(() => rowsOf(app).some(r => r.dataset.inbox === "document"), "запись о документе");
    const row = rowsOf(app).find(r => r.dataset.inbox === "document");
    assert.ok(row.textContent.includes("Николай Деревцов поделился с вами документом «Дорожная карта перевода команды» — можно править"), row.textContent);
    assert.ok(row.textContent.includes("Общий проект"), "проект по имени");
    for (const id of [SHARED.node_id, SHARED.owner_id, "c".repeat(64)]) assert.ok(!app.text().includes(id), "без технических опознавателей");
    [...row.querySelectorAll("button")].find(b => b.textContent === "Открыть").click();
    await app.until(() => app.calls.some(([m]) => m === "openNativeDocument"), "документ открыт");
    assert.deepEqual(app.calls.find(([m]) => m === "openNativeDocument"), ["openNativeDocument", "one", SHARED.node_id]);
    await app.until(() => !rowsOf(app).some(r => r.dataset.inbox === "document"), "прочитанное ушло из «Входящих»");
  } finally { app.dispose(); }
});

test("«Входящие»: право чтения подписано «можно читать»; ссылка из письма открывает документ сама", async () => {
  const app = await mountMemoryApp({ async listSharedDocuments() { return [{ ...SHARED, mode: "read" }]; } }, { nativeOpen: true, document: SHARED.node_id, project: "one" });
  try {
    await app.until(() => app.calls.some(([m]) => m === "openNativeDocument"), "документ из ссылки открыт");
    assert.deepEqual(app.calls.find(([m]) => m === "openNativeDocument"), ["openNativeDocument", "one", SHARED.node_id]);
    await app.until(() => app.calls.some(([m, p, o, n]) => m === "markSharedDocumentSeen" && p === "one" && o === SHARED.owner_id && n === SHARED.node_id), "открытие отмечено");
  } finally { app.dispose(); }
});

test("счётчик «Входящих» считает неоткрытые документы, которыми поделились", () => {
  const extra = { documents: [SHARED, { ...SHARED, node_id: "other", seen: true }] };
  assert.equal(inboxDecisions([], [], "alice", extra), 1);
  assert.equal(inboxDecisions([], [], "alice", { documents: [] }), 0);
});
