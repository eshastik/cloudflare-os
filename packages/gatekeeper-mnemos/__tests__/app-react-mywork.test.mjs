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
const tabOf = (app, name) => [...app.document.querySelectorAll('#root [aria-label="Что показать"] button')].find(t => t.textContent.startsWith(name));

test("«Входящие»: все виды решений в одном списке по времени, фильтры с числами", async () => {
  const app = await mountMemoryApp(mixed());
  try {
    assert.equal(app.document.querySelector("#root h1").textContent, "Входящие", "раздел по умолчанию");
    await app.until(() => rowsOf(app).length === 5, "пять решений");
    // Предложения публикации без времени — первыми; дальше новое сверху: приёмная (22.09), шаблон (20.09), приёмка (12.09).
    assert.deepEqual(rowsOf(app).map(r => r.dataset.inbox), ["approval", "publish", "intake", "template", "acceptance"]);
    assert.ok(rowsOf(app)[2].textContent.includes("Счёт.pdf") && rowsOf(app)[2].textContent.includes("Второй проект"), "вопрос приёмной с проектом");
    assert.ok(!app.text().includes("Своё предложение"), "собственное предложение шаблона не ждёт моего решения");
    assert.equal(tabOf(app, "Все").textContent, "Все5");
    assert.equal(tabOf(app, "Согласования").textContent, "Согласования3");
    assert.equal(tabOf(app, "Работа агентов").textContent, "Работа агентов1");
    assert.equal(tabOf(app, "Приём данных").textContent, "Приём данных1");
    assert.equal(tabOf(app, "Доступ"), undefined, "пустой фильтр скрыт");

    tabOf(app, "Приём данных").click();
    await app.until(() => rowsOf(app).length === 1 && rowsOf(app)[0].dataset.inbox === "intake", "фильтр приёмной");
    tabOf(app, "Все").click();
    await app.until(() => rowsOf(app).length === 5, "снова все");

    const rowWith = name => rowsOf(app).find(r => r.textContent.includes(name));
    [...rowWith("Инженерия").querySelectorAll("button")].find(b => b.textContent === "Одобрить").click();
    await app.until(() => app.calls.some(([m]) => m === "recordReviewDecision"), "решение записано из строки");
    assert.deepEqual(app.calls.find(([m]) => m === "recordReviewDecision"), ["recordReviewDecision", REVIEW_MINE, "Инженерия", 3, true]);

    [...rowWith("Дизайн").querySelectorAll("button")].find(b => b.textContent === "Опубликовать").click();
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
  const app = await mountMemoryApp(mixed());
  try {
    await app.until(() => rowsOf(app).length === 5, "список");
    const panel = () => app.document.querySelector('#root aside[aria-label="Подробности"]');
    rowsOf(app).find(r => r.dataset.inbox === "approval").querySelector("button").click();
    await app.until(() => panel()?.textContent.includes("carol: одобрено"), "подробности согласования");
    [...panel().querySelectorAll("button")].find(b => b.textContent === "Отклонить").click();
    await app.until(() => app.calls.some(([m]) => m === "recordReviewDecision"), "отказ записан");
    assert.deepEqual(app.calls.find(([m]) => m === "recordReviewDecision"), ["recordReviewDecision", REVIEW_MINE, "Инженерия", 3, false]);

    rowsOf(app).find(r => r.dataset.inbox === "acceptance").querySelector("button").click();
    await app.until(() => panel()?.textContent.includes("Открыть обращение"), "подробности приёмки");
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
    assert.ok(block("Жду решения других").textContent.includes("Чужих решений вы не ждёте"));
    assert.ok(app.button("Мои загрузки"), "«Мои загрузки» достижимы");
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
    app.button("Разрешения агентов").click();
    await app.until(() => app.calls.some(([name]) => name === "openApprovals"), "очередь разрешений открыта через хост");
  } finally { app.dispose(); }
});
