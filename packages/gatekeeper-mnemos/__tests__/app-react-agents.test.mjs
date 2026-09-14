import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

test("«Агенты»: карточки по среде, выдача агента с устойчивой заявкой, отзыв доступа, путь «Подключить своего»", async () => {
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
    async readPersonalMemory() { return { revision: 2, project_id: "one", node_id: "doc", head: "b".repeat(64) }; },
    async readDraftDocument(project, node) { return { head: "b".repeat(64), node_id: node, exists: true, conflicted: false, terms: [{ present: true, negative: false, metadata: { name: "Инструкция агента", parent_id: "", content_type: "text/plain" } }] }; },
    async readAgentAbsence(project) { return { project_id: project, local_binding_id: "b-external", managed_binding_id: "b-managed", starts_at: "2026-09-15T00:00:00Z", ends_at: "2026-09-29T00:00:00Z", revision: 1, enabled: project === "one" }; },
  });
  try {
    await app.open("Агенты");
    const card = id => app.document.querySelector(`#root [data-agent="${id}"]`);
    await app.until(() => card("b-managed") && card("b-external"), "две карточки");
    const managed = card("b-managed"), external = card("b-external");
    assert.ok(managed.textContent.includes("AgenticOS") && managed.textContent.includes("Владелец — вы"), "среда и владелец");
    assert.ok(managed.textContent.includes("ограничены текущими правами владельца"), "права — собственные, в пределах прав владельца");
    assert.ok(managed.querySelector("dd").textContent.includes("узел doc") && !managed.querySelector("dd").textContent.includes("Второй проект"), "показана выданная область, а не все проекты владельца");
    await app.until(() => managed.textContent.includes("Инструкция агента"), "память агента");
    await app.until(() => managed.textContent.includes("@acme_bot"), "канал Telegram");
    assert.ok(managed.textContent.includes("Текущих задач нет"), "задачи");
    await app.until(() => managed.textContent.includes("Замещение") && managed.textContent.includes("замещает"), "замещение");
    const names = el => [...el.querySelectorAll("button")].map(b => b.textContent);
    for (const action of ["Поставить задачу", "Внести корректировку", "Остановить выполнение", "Отозвать доступ"]) assert.ok(names(managed).includes(action), `действие управляемого: ${action}`);
    assert.ok(!names(external).includes("Поставить задачу") && !names(external).includes("Остановить выполнение"), "у внешнего клиента нет запуска и остановки");
    for (const action of ["Отозвать доступ", "Журнал обращений", "Выданные права"]) assert.ok(names(external).includes(action), `возможность подключения: ${action}`);
    assert.ok(external.textContent.includes("не останавливает внешний процесс"), "честный текст об отзыве");

    [...external.querySelectorAll("button")].find(b => b.textContent === "Отозвать доступ").click();
    await app.until(() => [...card("b-external").querySelectorAll("button")].some(b => b.textContent === "Подтвердить отзыв"), "подтверждение отзыва");
    [...card("b-external").querySelectorAll("button")].find(b => b.textContent === "Подтвердить отзыв").click();
    await app.until(() => card("b-external")?.textContent.includes("Доступ отозван"), "отзыв отражён");
    assert.deepEqual(app.calls.filter(([m]) => m === "revokeAgentConnection"), [["revokeAgentConnection", "b-external"]]);

    app.button("Выдать агента").click();
    await app.until(() => app.document.querySelector('#root input[aria-label="ID разрешённого шаблона AgenticOS"]')?.disabled === false, "форма выдачи");
    app.type(app.document.querySelector('#root input[aria-label="ID разрешённого шаблона AgenticOS"]'), "analyst");
    app.button("Подготовить заявку").click();
    await app.until(() => app.button("Выполнить выдачу"), "заявка сохранена");
    app.button("Выполнить выдачу").click();
    await app.until(() => app.text().includes("agent-new"), "агент выдан");
    assert.deepEqual(app.calls.filter(([m]) => m === "prepareManagedAgent"), [["prepareManagedAgent", "analyst"]]);
    assert.deepEqual(app.calls.filter(([m]) => m === "submitManagedAgent"), [["submitManagedAgent", "req-1"]], "повтор идёт по той же заявке");

    app.button("Подключить Codex / Claude Code").click();
    await app.until(() => app.document.querySelector('textarea[aria-label="Команды подключения"]')?.value.includes("codex mcp add"), "команды внешнего клиента");
    const commands=()=>app.document.querySelector('textarea[aria-label="Команды подключения"]').value;
    assert.match(commands(), /https:\/\/memory.example\/mcp/);
    assert.match(commands(), /--oauth-client-id 'mnemos-cli'/);
    [...app.document.querySelectorAll('button')].find(b=>b.textContent==='Claude Code').click();
    await app.until(()=>commands().includes('claude mcp add'), 'выбор Claude Code');
    assert.match(commands(), /--callback-port 19450/);
  } finally { app.dispose(); }
});

test("«Агенты»: пустой список и отказ RPC показаны честно", async () => {
  const app = await mountMemoryApp({ async listAgentConnections() { return { connections: [], next_cursor: "" }; }, async managedAgentRequest() { throw new Error("forbidden"); } });
  try {
    await app.open("Агенты");
    await app.until(() => app.text().includes("Агентов пока нет"), "пустой список");
    app.button("Выдать агента").click();
    await app.until(() => app.text().includes("Сохранённая заявка не прочитана"), "отказ при чтении заявки показан");
  } finally { app.dispose(); }
});


test('«Агенты»: выдача и снятие права относятся к выбранному агенту и проекту', async () => {
 const actions=[];
 const app=await mountMemoryApp({async setAgentProjectRight(...args){actions.push(args);return {};}});
 try {
  await app.open('Агенты');
  await app.until(()=>app.document.querySelector('[data-agent="b-external"]'), 'агент');
  const card=app.document.querySelector('[data-agent="b-external"]');
  [...card.querySelectorAll('button')].find(b=>b.textContent==='Настроить доступ к проекту').click();
  await app.until(()=>card.querySelector('[aria-label="Проект доступа агента"]'), 'права');
  [...card.querySelectorAll('button')].find(b=>b.textContent==='Выдать право').click();
  await app.until(()=>app.text().includes('Право выдано.'),'выдача');
  assert.deepEqual(actions,[['claude-code-alice','one','read',true]]);
  [...card.querySelectorAll('button')].find(b=>b.textContent==='Снять это право').click();
  await app.until(()=>app.text().includes('Выбранное право снято.'),'снятие');
  assert.deepEqual(actions.at(-1),['claude-code-alice','one','read',false]);
 } finally {app.dispose();}
});
