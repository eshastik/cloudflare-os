import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

const REQUEST = { request_id: "0f3c9a2e-5b7d-4e1a-9c3b-2d4e6f8a0b1c", project_id: "one", project_name: "Общий проект", level: "department", can_edit: true, org_unit_id: "u1", org_unit_name: "Продажи",
  requested_by: "anna", requested_by_name: "Анна", decider: "head", status: "pending", created_at: "2026-09-24T10:00:00Z" };
const SETTINGS = { personal_projects_enabled: true, project_create_by: "everyone", share_department_approval: "head", share_organization_by: "head", share_organization_approval: "none", default_visibility: "private" };
/** Текст, который видит человек: «Подробнее» для администратора вырезается. */
const visibleText = element => { const copy = element.cloneNode(true); copy.querySelectorAll("[data-admin-details]").forEach(d => d.remove()); return copy.textContent; };
const cards = app => [...app.document.querySelectorAll("#root [data-inbox]")];

test("«Поделиться»: три уровня словами, «могут править», запрос руководителю виден на странице проекта", async () => {
  let pending = "";
  const app = await mountMemoryApp({
    async listProjects() { return { projects: [{ id: "one", name: "Общий проект", slug: "shared", visibility: "private", can_edit: false, created_by: "alice", ...(pending ? { pending_share: pending } : {}) }, { id: "two", name: "Второй проект", slug: "second" }] }; },
    async setProjectVisibility(project, level, canEdit) {
      app.calls.push(["setProjectVisibility", project, level, canEdit]); pending = level;
      return { project_id: project, visibility: "private", can_edit: false, applied: false, request: { ...REQUEST, project_id: project, level, can_edit: canEdit } };
    },
  }, { section: "projects", project: "one" });
  try {
    await app.until(() => app.button("Поделиться"), "кнопка «Поделиться»");
    await app.until(() => app.text().includes("Только я"), "текущая видимость в шапке");
    app.button("Поделиться").click();
    const panel = () => app.document.querySelector('#root section[aria-label="Поделиться проектом"]');
    await app.until(() => panel(), "панель открыта");
    const options = [...panel().querySelectorAll('input[type="radio"]')].map(i => i.closest("label").textContent);
    assert.deepEqual(options.map(o => o.split("Проект")[0]), ["Только я", "Мой отдел", "Вся организация"], "три уровня словами");
    assert.equal(panel().querySelector('[role="switch"]'), null, "«могут править» не нужно для «Только я»");
    panel().querySelector('input[value="department"]').click();
    await app.until(() => panel().querySelector('[role="switch"]'), "переключатель появился");
    panel().querySelector('[role="switch"]').click();
    [...panel().querySelectorAll("button")].find(b => b.textContent === "Сохранить").click();
    await app.until(() => panel().textContent.includes("Ждёт подтверждения руководителя отдела"), "запрос руководителю");
    assert.deepEqual(app.calls.find(c => c[0] === "setProjectVisibility"), ["setProjectVisibility", "one", "department", true]);
    await app.until(() => app.document.querySelector("#root h2")?.parentElement.textContent.includes("Ждёт подтверждения руководителя"), "состояние в шапке после перечтения");
  } finally { app.dispose(); }
});

test("«Поделиться»: отказ сервера объяснён словами", async () => {
  const app = await mountMemoryApp({ async setProjectVisibility() { throw new Error("forbidden"); } }, { section: "projects", project: "one" });
  try {
    await app.until(() => app.button("Поделиться"), "кнопка");
    app.button("Поделиться").click();
    const panel = () => app.document.querySelector('#root section[aria-label="Поделиться проектом"]');
    await app.until(() => panel(), "панель");
    panel().querySelector('input[value="organization"]').click();
    await app.until(() => ![...panel().querySelectorAll("button")].find(b => b.textContent === "Сохранить").disabled, "есть что сохранять");
    [...panel().querySelectorAll("button")].find(b => b.textContent === "Сохранить").click();
    await app.until(() => panel().textContent.includes("Не получилось поделиться"), "отказ");
  } finally { app.dispose(); }
});

test("«Входящие»: карточка запроса руководителю — «Анна хочет открыть проект…», решение «Разрешить» или «Отклонить» на месте", async () => {
  let decided = false;
  const app = await mountMemoryApp({
    async listShareRequests(mine) { return { requests: mine || decided ? [] : [REQUEST] }; },
    async decideShareRequest(id, approve) { app.calls.push(["decideShareRequest", id, approve]); decided = true; return { ...REQUEST, status: approve ? "approved" : "rejected" }; },
  });
  try {
    await app.until(() => cards(app).some(c => c.dataset.inbox === "share"), "карточка запроса");
    const card = cards(app).find(c => c.dataset.inbox === "share");
    assert.ok(card.textContent.includes("Анна хочет открыть проект «Общий проект» отделу «Продажи»"), card.textContent);
    assert.ok(card.textContent.includes("видящие смогут править"));
    assert.ok(!card.textContent.includes(REQUEST.request_id), "идентификатор запроса не показан");
    const buttons = [...card.querySelectorAll("button")].map(b => b.textContent);
    assert.ok(buttons.includes("Разрешить") && buttons.includes("Отклонить"), "обе кнопки решения на карточке, как в макете");
    card.querySelector("button").click();
    await app.until(() => card.querySelector('aside[aria-label="Подробности"]')?.textContent.includes("сотрудники отдела «Продажи»"), "подробности раскрываются внутри карточки");
    [...card.querySelectorAll("button")].find(b => b.textContent === "Разрешить").click();
    await app.until(() => app.text().includes("Проект «Общий проект» открыт отделу «Продажи»."), "решение подтверждено");
    assert.deepEqual(app.calls.find(c => c[0] === "decideShareRequest"), ["decideShareRequest", REQUEST.request_id, true]);
    await app.until(() => !cards(app).some(c => c.dataset.inbox === "share"), "карточка ушла после решения");
  } finally { app.dispose(); }
});

test("«Входящие»: карточки без таблиц — от кого, проект, одна главная кнопка и «Открыть в беседе»", async () => {
  const app = await mountMemoryApp({
    async readCollaborationProgress() { return { state: "awaiting_review", result_sequence: 1, review_revision: 0 }; },
    async listCollaborations() { return { requests: [{ request_id: "r-9", project_id: "two", node_id: "other", source_head: "b".repeat(64), target_binding_id: "external-5f0c2d9e8a7b", target_user_id: "", target_agent_id: "agent-5f0c2d9e8a7b41c2", requester_user_id: "alice", requester_agent_id: "", purpose: "collaborate", role: "coexecutor", title: "Сверить прайс", description: "", criteria: "", created_at: "2026-09-12T10:00:00Z" }], next_cursor: "" }; },
    async listAgentConnections() { return { connections: [{ binding_id: "external-5f0c2d9e8a7b", agent_principal_id: "agent-5f0c2d9e8a7b41c2", runtime_id: "external", runtime_agent_id: "5f0c2d9e8a7b", managed_runtime: false, revoked: false }], next_cursor: "" }; },
    async listShareRequests(mine) { return { requests: mine ? [{ ...REQUEST, requested_by: "alice", requested_by_name: "Алиса", project_name: "Второй проект", level: "organization", decider: "admin" }] : [] }; },
  });
  try {
    await app.until(() => cards(app).some(c => c.dataset.inbox === "acceptance") && cards(app).some(c => c.dataset.inbox === "approval"), "карточки");
    assert.equal(app.document.querySelector('#root section[aria-label="Ждут вашего решения"] table'), null, "во «Входящих» нет таблиц");
    const acceptance = cards(app).find(c => c.dataset.inbox === "acceptance");
    assert.ok(acceptance.textContent.includes("Принять работу «Сверить прайс»"));
    assert.ok(acceptance.textContent.includes("От: Свой агент (Claude Code или Codex)") && acceptance.textContent.includes("проект «Второй проект»"), acceptance.textContent);
    assert.ok(!acceptance.textContent.includes("agent-5f0c"), "исполнитель по имени, а не по идентификатору");
    assert.deepEqual([...acceptance.querySelectorAll("button")].slice(1).map(b => b.textContent), ["Проверить результат", "Открыть в беседе"], "одна главная кнопка и беседа");
    const approval = cards(app).find(c => c.dataset.inbox === "approval");
    [...approval.querySelectorAll("button")].find(b => b.textContent === "Открыть в беседе").click();
    await app.until(() => app.calls.some(c => c[0] === "openPrompt"), "беседа открыта");
    const prompt = app.calls.find(c => c[0] === "openPrompt");
    assert.match(prompt[1], /Заметка команды/);
    assert.deepEqual(prompt[2], { projectId: "one", title: "Общий проект" });
    const waiting = app.document.querySelector('#root section[aria-label="Жду решения других"]');
    await app.until(() => waiting.textContent.includes("Проект «Второй проект»: ждёт подтверждения администратора"), "мой запрос ждёт решения");
  } finally { app.dispose(); }
});

test("Правила организации — на странице «Правила» администратору; сотруднику раздел закрыт", async () => {
  const saved = [];
  const admin = await mountMemoryApp({ async updateProjectSharingSettings(settings) { saved.push(settings); return settings; } }, { section: "organization" });
  try {
    const rules = () => admin.document.querySelector('#root section[aria-label="Правила проектов"]');
    await admin.until(() => rules()?.querySelector('[role="switch"]'), "правила прочитаны");
    assert.ok(rules().textContent.includes("Личные проекты у сотрудников") && rules().textContent.includes("Поделиться с отделом"));
    rules().querySelector('[role="switch"]').click();
    const save = () => [...rules().querySelectorAll("button")].find(b => b.textContent === "Сохранить правила");
    await admin.until(() => !save().disabled, "есть изменения");
    save().click();
    await admin.until(() => rules().textContent.includes("Правила сохранены."), "сохранено");
    assert.deepEqual(saved, [{ ...SETTINGS, personal_projects_enabled: false }]);
  } finally { admin.dispose(); }
  const viewer = await mountMemoryApp({ async whoAmI() { return { subject: { tenant_id: "org", user_id: "alice" }, tenant_name: "Пример", capabilities: ["platform.metrics.read"] }; } }, { section: "rules" });
  try {
    await viewer.until(() => viewer.text().includes("Этот раздел доступен администратору"), "наблюдателю правила закрыты");
    assert.equal(viewer.document.querySelector('#root section[aria-label="Правила проектов"]'), null);
  } finally { viewer.dispose(); }
});

test("Идентификаторы агентов и задач не видны ни сотруднику, ни администратору", async () => {
  const connections = [
    { binding_id: "workshop-7c1e0b5a9d2f4e3b", agent_principal_id: "agent-7c1e0b5a9d2f4e3b8a6c", runtime_id: "workshop", runtime_agent_id: "7c1e0b5a9d2f", managed_runtime: false, revoked: false, document_grants: [] },
    { binding_id: "external-0a9b8c7d6e5f4a3b", agent_principal_id: "agent-0a9b8c7d6e5f4a3b2c1d", runtime_id: "external", runtime_agent_id: "0a9b8c7d6e5f", managed_runtime: false, revoked: false, document_grants: [] },
    { binding_id: "external-1b2c3d4e5f6a7b8c", agent_principal_id: "agent-1b2c3d4e5f6a7b8c9d0e", runtime_id: "external", runtime_agent_id: "1b2c3d4e5f6a", managed_runtime: false, revoked: false, document_grants: [] },
  ];
  const person = { async whoAmI() { return { subject: { tenant_id: "org", user_id: "alice" }, tenant_name: "Пример", capabilities: [] }; }, async listAgentConnections() { return { connections, next_cursor: "" }; } };
  const app = await mountMemoryApp(person, { section: "agents" });
  try {
    await app.until(() => app.document.querySelectorAll("#root [data-agent]").length === 3, "три агента");
    const titles = [...app.document.querySelectorAll("#root [data-agent] h3")].map(h => h.textContent);
    assert.deepEqual(titles, ["Агент беседы", "Свой агент (Claude Code или Codex)", "Свой агент (Claude Code или Codex) № 2"]);
    assert.equal(app.document.querySelector("#root [data-admin-details]"), null, "сотруднику «Подробнее» нет");
    for (const c of connections) for (const id of [c.binding_id, c.agent_principal_id]) assert.ok(!app.text().includes(id), `не показан ${id}`);
  } finally { app.dispose(); }
  const admin = await mountMemoryApp({ async listAgentConnections() { return { connections, next_cursor: "" }; } }, { section: "agents" });
  try {
    await admin.until(() => admin.document.querySelectorAll("#root [data-agent]").length === 3, "три агента");
    const card = admin.document.querySelector(`#root [data-agent="${connections[0].binding_id}"]`);
    assert.ok(!visibleText(card).includes(connections[0].binding_id), "в карточке идентификатора нет");
    assert.equal(admin.document.querySelector("#root [data-admin-details]"), null, "и администратору «Подробнее» с идентификаторами нет");
    for (const c of connections) for (const id of [c.binding_id, c.agent_principal_id]) assert.ok(!admin.text().includes(id), `не показан ${id}`);
  } finally { admin.dispose(); }
});
