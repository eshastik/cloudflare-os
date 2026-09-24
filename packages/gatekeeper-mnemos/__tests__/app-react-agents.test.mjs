import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

test("«Агенты и расходы»: агенты по именам, без полей для идентификаторов; отзыв доступа; путь «Подключить своего»", async () => {
  let revoked = false;
  const app = await mountMemoryApp({
    async listAgentConnections() {
      return { connections: [
        { binding_id: "b-managed", agent_principal_id: "agent-alice", document_grants: [{project_id:"one",node_id:"doc",mode:"write",resource_class:"filesystem",granted_to:"agent-alice"}], runtime_id: "agenticos", runtime_agent_id: "ra-1", managed_runtime: true, revoked: false },
        { binding_id: "b-external", agent_principal_id: "claude-code-alice", runtime_id: "external", runtime_agent_id: "cc-1", managed_runtime: false, revoked },
      ], next_cursor: "" };
    },
    async revokeAgentConnection(id) { app.calls.push(["revokeAgentConnection", id]); revoked = true; },
    async listTelegram() { return { connections: [{ bot: "bot-1", username: "acme_bot", binding: "b-managed", ready: true, disconnected: false, cleanup_pending: false, channel_registered: true }], unavailable: 0 }; },
  });
  try {
    await app.open("Агенты и расходы");
    const card = id => app.document.querySelector(`#root [data-agent="${id}"]`);
    await app.until(() => card("b-managed") && card("b-external"), "две карточки");
    const managed = card("b-managed"), external = card("b-external");
    assert.ok(managed.textContent.includes("Агент AgenticOS") && external.textContent.includes("Свой агент"), "агенты названы словами");
    await app.until(() => managed.querySelector("dd").textContent.includes("документ «Заметка команды»"), "документ назван по имени");
    await app.until(() => managed.textContent.includes("@acme_bot"), "канал Telegram");
    // Ни одного поля для ввода идентификатора: выдача агента по ID шаблона и «Кто может привлекать» убраны.
    assert.equal(app.document.querySelector('#root input[aria-label*="ID"]'), null);
    assert.ok(!app.buttons().some(b => ["Выдать агента", "Кто может привлекать", "Журнал обращений", "Поставить задачу"].includes(b.textContent)), "технические действия убраны");
    const visible = el => el.textContent.replace([...el.querySelectorAll("[data-admin-details]")].map(d => d.textContent).join(""), "");
    assert.doesNotMatch(visible(managed), /b-managed|agent-alice|ra-1/, "идентификаторы только под «Подробнее»");

    [...external.querySelectorAll("button")].find(b => b.textContent === "Отозвать доступ").click();
    await app.until(() => [...card("b-external").querySelectorAll("button")].some(b => b.textContent === "Подтвердить отзыв"), "подтверждение отзыва");
    [...card("b-external").querySelectorAll("button")].find(b => b.textContent === "Подтвердить отзыв").click();
    await app.until(() => card("b-external")?.textContent.includes("Доступ отозван"), "отзыв отражён");
    assert.deepEqual(app.calls.filter(([m]) => m === "revokeAgentConnection"), [["revokeAgentConnection", "b-external"]]);

    app.button("Подключить Codex или Claude Code").click();
    await app.until(() => app.document.querySelector('textarea[aria-label="Команды подключения"]')?.value.includes("codex mcp add"), "команды внешнего клиента");
    const commands = () => app.document.querySelector('textarea[aria-label="Команды подключения"]').value;
    assert.match(commands(), /--oauth-client-id 'mnemos-cli'/);
    [...app.document.querySelectorAll('button')].find(b => b.textContent === 'Claude Code').click();
    await app.until(() => commands().includes('claude mcp add'), 'выбор Claude Code');
  } finally { app.dispose(); }
});

test("«Агенты и расходы»: пустой список и отказ RPC показаны честно; загрузка не даёт пустой страницы", async () => {
  const waiting = [];
  const release = () => waiting.splice(0).forEach(r => r());
  const app = await mountMemoryApp({ async listAgentConnections() { await new Promise(r => waiting.push(r)); return { connections: [], next_cursor: "" }; } }, { section: "agents" });
  try {
    await app.until(() => app.text().includes("Загрузка агентов"), "пока список читается, видно, что идёт загрузка");
    assert.ok(app.text().includes("Бюджеты проектов") && app.text().includes("Расходы по проектам"), "остальная страница видна сразу");
    release();
    await app.until(() => app.text().includes("Агентов пока нет"), "пустой список");
  } finally { app.dispose(); }
  const failed = await mountMemoryApp({ async listAgentConnections() { throw new Error("forbidden"); } }, { section: "agents" });
  try {
    await failed.until(() => failed.text().includes("Не удалось загрузить подключения агентов"), "отказ показан");
  } finally { failed.dispose(); }
});

test("«Агенты и расходы»: задача без текста не роняет страницу", async () => {
  const app = await mountMemoryApp({ async managedTaskRequest() { return { request_id: "t-1", binding_id: "b-managed", submitted: true }; } }, { section: "agents" });
  try {
    await app.until(() => app.document.querySelector('#root [data-agent="b-managed"]')?.textContent.includes("в работе"), "карточка с задачей");
    assert.ok(!app.text().includes("Раздел не открылся"));
  } finally { app.dispose(); }
});

test("«Агенты и расходы»: выдача и снятие права относятся к выбранному агенту и проекту", async () => {
  const actions = [];
  const app = await mountMemoryApp({ async setAgentProjectRight(...args) { actions.push(args); return {}; } }, { section: "agents" });
  try {
    await app.until(() => app.document.querySelector('[data-agent="b-external"]'), 'агент');
    const card = app.document.querySelector('[data-agent="b-external"]');
    [...card.querySelectorAll('button')].find(b => b.textContent === 'Настроить доступ к проекту').click();
    await app.until(() => card.querySelector('[aria-label="Проект доступа агента"]'), 'права');
    [...card.querySelectorAll('button')].find(b => b.textContent === 'Выдать право').click();
    await app.until(() => app.text().includes('Право выдано.'), 'выдача');
    assert.deepEqual(actions, [['claude-code-alice', 'one', 'read', true]]);
  } finally { app.dispose(); }
});

test("«Агенты и расходы»: бюджет проекта — владелец выбирается по имени; расходы по проектам словами", async () => {
  const saved = [];
  const app = await mountMemoryApp({
    async listPeople() { return { users: [{ userName: "alice", displayName: "Алиса", active: true }, { userName: "u-7f3a", displayName: "Борис Петров", active: true }] }; },
    async readProjectBudget(project) { return { project_id: project, revision: 3, owner_id: "alice", limit_usd_micros: "10000000", automatic_usd_micros: "2000000", automatic_team_size: 2 }; },
    async setProjectBudget(project, policy) { saved.push([project, policy]); return { project_id: project, ...policy, revision: policy.revision + 1 }; },
    async listTeamBudgets(project) { return project === "one" ? { proposals: [{ id: "p-1", user_id: "alice" }], next_cursor: "" } : { proposals: [], next_cursor: "" }; },
    async readTeamBudget(project, id) { return { id, project_id: project, proposal: { members: [] } }; },
    async readTeamBudgetUsage(project, id) { return { project_id: project, proposal_id: id, accounting_basis: "rated_tokens", actual_usd_micros: "1500000", reserved_usd_micros: "500000" }; },
  }, { section: "agents" });
  try {
    await app.until(() => app.text().includes("потрачено 1.5 $"), "расходы проекта");
    assert.ok(app.text().includes("Общий проект"), "расходы названы проектом");
    app.type(app.document.querySelector('select[aria-label="Проект бюджета"]'), "one");
    await app.until(() => app.document.querySelector('select[aria-label="Владелец бюджета"] option[value="u-7f3a"]'), "владелец из списка сотрудников");
    const owner = app.document.querySelector('select[aria-label="Владелец бюджета"]');
    assert.ok([...owner.options].some(o => o.textContent === "Борис Петров"), "владелец назван по имени");
    assert.equal(app.document.querySelector('#root input[aria-label*="Владелец"]'), null, "владелец не вписывается идентификатором");
    app.type(owner, "u-7f3a");
    app.type(app.document.querySelector('input[aria-label="Общий бюджет"]'), "20");
    app.button("Сохранить бюджет").click();
    await app.until(() => app.text().includes("Бюджет сохранён."), "сохранено");
    assert.deepEqual(saved, [["one", { revision: 3, owner_id: "u-7f3a", limit_usd_micros: "20000000", automatic_usd_micros: "2000000", automatic_team_size: 2 }]]);
  } finally { app.dispose(); }
});
