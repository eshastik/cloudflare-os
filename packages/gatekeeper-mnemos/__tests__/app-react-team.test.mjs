import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

const HEAD = { subject: { tenant_id: "org", user_id: "alice" }, tenant_name: "Команда", capabilities: [],
  roles: { department_head: true, project_responsible: true, can_create_projects: true, responsible_projects: ["two"] } };
const UNITS = [{ org_unit_id: "sales", name: "Продажи", members: [
  { principal_id: "alice", display_name: "Алиса", is_head: true }, { principal_id: "bob", display_name: "Борис", is_head: false }] }];
const PROJECTS = [{ id: "one", name: "Прайс", slug: "price", org_unit_id: "sales" }, { id: "two", name: "Склад", slug: "stock" }, { id: "three", name: "Чужой", slug: "other", org_unit_id: "hr" }];

test("«Мой отдел»: сотрудники, проекты отдела и ответственного, подтверждение запроса «Поделиться»", async () => {
  let requests = [{ request_id: "r1", project_id: "one", project_name: "Прайс", level: "department", can_edit: false, org_unit_id: "sales", org_unit_name: "Продажи",
    requested_by: "bob", requested_by_name: "Борис", decider: "head", status: "pending", created_at: "2026-09-23T10:00:00Z" }];
  const app = await mountMemoryApp({
    async whoAmI() { return HEAD; },
    async listProjects() { return { projects: PROJECTS }; },
    async listOrgUnits() { return UNITS; },
    async listShareRequests(mine) { return { requests: mine ? [] : requests }; },
    async decideShareRequest(id, approve) { app.calls.push(["decideShareRequest", id, approve]); const done = { ...requests[0], status: approve ? "approved" : "rejected" }; requests = []; return done; },
  }, { section: "team" });
  try {
    await app.until(() => app.text().includes("Борис хочет открыть проект «Прайс» отделу «Продажи»"), "запрос на решение");
    await app.until(() => app.text().includes("Алиса") && app.text().includes("Руководитель"), "сотрудники отдела");
    const text = app.text();
    assert.ok(text.includes("Проекты отдела") && text.includes("Прайс"), "проект отдела");
    assert.ok(text.includes("Вы отвечаете за проекты") && text.includes("Склад"), "проект ответственного");
    assert.ok(!text.includes("Чужой"), "проект другого отдела не показывается");
    assert.ok(!/[a-f0-9]{16}|sales|r1/.test(text.replace(/Продажи/g, "")), "служебные идентификаторы не показываются");
    app.button("Подтвердить").click();
    await app.until(() => app.calls.some(c => c[0] === "decideShareRequest") && app.text().includes("Проект «Прайс» открыт отделу «Продажи»."), "решение записано");
    assert.deepEqual(app.calls.find(c => c[0] === "decideShareRequest"), ["decideShareRequest", "r1", true]);
    await app.until(() => app.text().includes("Запросов «Поделиться» на решение нет."), "список обновлён");
    app.buttons().find(b => b.getAttribute("aria-label") === "Открыть проект «Склад»").click();
    await app.until(() => app.calls.some(c => c[0] === "openSection" && c[1] === "projects" && c[2] === "two"), "переход в проект");
  } finally { app.dispose(); }
});

test("«Мой отдел» у сотрудника без ролей объясняет, когда раздел наполнится", async () => {
  const app = await mountMemoryApp({
    async whoAmI() { return { ...HEAD, roles: { department_head: false, project_responsible: false, can_create_projects: true, responsible_projects: [] } }; },
    async listOrgUnits() { return []; },
  }, { section: "team" });
  try {
    await app.until(() => app.text().includes("Вы не руководите отделом и не отвечаете за проекты."), "пояснение");
  } finally { app.dispose(); }
});
