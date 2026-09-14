import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

test("«Проекты»: список, страница проекта с участниками, материалами, работой, правилами и источниками; редактор правил", async () => {
  const app = await mountMemoryApp({
    async readPublicationPolicy(project) {
      if (project !== "one") return { project_id: project, revision: 1, domains: [] };
      return { project_id: "one", revision: 4, domains: [{ domain_id: "Дизайн", node_ids: ["dir"], approver_ids: ["carol"] }, { domain_id: "Разработка", all_documents: true, node_ids: [], approver_ids: ["alice", "dave"] }] };
    },
    async listPolicyApprovers(project) { return { approvers: project === "one" ? [{ principal_id: "carol", display_name: "Кэрол" }, { principal_id: "alice", display_name: "Алиса" }, { principal_id: "dave", display_name: "" }] : [], next_cursor: "" }; },
    async listMailConnections() { return { connections: [{ connection_id: "m-1", project_id: "one", provider: "yandex", query_sha256: "", revision: 1, enabled: true }] }; },
    async listVisibleDatabaseConnections() { return { databases: [{ db_id: "db-1", project_id: "one", name: "Аналитика", driver: "postgres", env_var: "", registered_by: "alice", registered_at: "", configured: true, last_sweep_at: "2026-09-12T09:10:00Z", unreachable_since: "" }], truncated: false }; },
  });
  try {
    await app.open("Проекты");
    await app.until(() => app.button("Общий проект") && app.button("Второй проект"), "список проектов");
    assert.ok(app.button("Создать проект"), "проект можно создать прямо во вкладке");
    app.button("Общий проект").click();
    const section = name => app.document.querySelector(`#root section[aria-label="${name}"]`);
    await app.until(() => section("Участники и направления")?.textContent.includes("Кэрол"), "участники из политики");
    assert.ok(section("Участники и направления").textContent.includes("Согласует направление Дизайн"), "роль по направлению");
    assert.ok(section("Участники и направления").textContent.includes("dave"), "согласующий без имени показан по идентификатору");
    await app.until(() => section("Материалы")?.textContent.includes("Заметка команды"), "материалы проекта");
    assert.ok(section("Материалы").textContent.includes("На согласовании · 1 из 2"), "статус документа");
    await app.until(() => section("Текущая работа")?.textContent.includes("Проверить ТЗ на страницу цен"), "текущая работа проекта");
    assert.ok(section("Текущая работа").textContent.includes("alice"), "кто ведёт");
    await app.until(() => section("Агенты проекта")?.textContent.includes("agent-alice"), "агенты");
    await app.until(() => section("Правила согласования")?.textContent.includes("Папка"), "правило по папке");
    assert.ok(section("Правила согласования").textContent.includes("Все документы проекта"), "правило на весь проект");
    await app.until(() => section("Источники проекта")?.textContent.includes("Аналитика") && section("Источники проекта").textContent.includes("yandex"), "источники проекта");

    app.button("Настроить согласования").click();
    await app.until(() => app.button("Сохранить настройки согласования"), "редактор правил открыт внутри вкладки");
    assert.ok(app.text().includes("Направление 1"));
    app.button("К вкладке").click();
    await app.until(() => section("Правила согласования"), "возврат на страницу проекта");

    app.button("Все документы проекта").click();
    await app.until(() => app.tab("Документы").getAttribute("aria-selected") === "true", "переход к документам");
    // Кнопка проекта в «Документах» несёт счётчик документов, поэтому ищется по началу текста.
    await app.until(() => app.buttons().find(b => b.textContent.startsWith("Общий проект"))?.getAttribute("aria-current") === "true", "выбран тот же проект");
  } finally { app.dispose(); }
});

test("«Проекты»: пустая политика и отказ сервера показаны честно", async () => {
  const app = await mountMemoryApp({
    async readPublicationPolicy(project) { if (project === "two") throw new Error("forbidden"); return { project_id: project, revision: 1, domains: [] }; },
    async listCollaborations() { return { requests: [], next_cursor: "" }; },
  });
  try {
    await app.open("Проекты");
    await app.until(() => app.button("Общий проект"), "список проектов");
    const section = name => app.document.querySelector(`#root section[aria-label="${name}"]`);
    await app.until(() => section("Правила согласования")?.textContent.includes("Правил согласования нет"), "пустые правила");
    assert.ok(section("Текущая работа").textContent.includes("Текущей работы нет"), "пустая работа");
    app.button("Второй проект").click();
    await app.until(() => section("Правила согласования")?.textContent.includes("нет права или сервер отказал"), "отказ показан");
  } finally { app.dispose(); }
});
