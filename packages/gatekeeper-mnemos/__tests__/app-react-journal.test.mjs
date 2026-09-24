import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

const METRICS = {
  recorded_at: new Date().toISOString(), shared_publications: 12, human_logins_24h: 9, authenticated_users_24h: 4, workspace_activity: null,
  readiness: { ready: true, reasons: [], checked_at: new Date().toISOString() },
  deployment: { environment: "production", release: "sophai-20260914", source_revision: "abc123", source_modified: false, go_version: "go1.25", schema_version: 24 },
  signals: [
    { key: "dependencies", state: "firing", reason: "check_failed", observed_at: "2026-09-24T10:00:00Z" },
    { key: "external.readiness", state: "ok", reason: "check_passed", observed_at: "2026-09-24T10:00:00Z" },
    { key: "external.login", state: "ok", reason: "check_passed", observed_at: "2026-09-24T10:00:00Z" },
    { key: "external.read", state: "unknown", reason: "observations_stale", observed_at: null },
  ],
  signal_owners: [{ signal_key: "dependencies", owner_id: "", owner_name: "", owner_active: false, revision: 0 }],
};
const EVENTS = [
  { id: "1", tenant_id: "org", actor: "alice", on_behalf_of: "", action: "workspace-activity.record", resource: '["stream","7","true"]', subject: "alice", allowed: true, reason: "accepted", at: "2026-09-24T08:00:00Z", prev_hash: "", hash: "" },
  { id: "2", tenant_id: "org", actor: "bob", on_behalf_of: "", action: "node.create", resource: '["one","doc"]', subject: "", allowed: true, reason: "accepted", at: "2026-09-24T09:00:00Z", prev_hash: "", hash: "" },
  { id: "3", tenant_id: "org", actor: "carol", on_behalf_of: "", action: "rights.grant", resource: "two:filesystem:read", subject: "bob", allowed: true, reason: "accepted", at: "2026-09-24T09:30:00Z", prev_hash: "", hash: "" },
  { id: "4", tenant_id: "org", actor: "alice", on_behalf_of: "", action: "private-workflow.open", resource: '["one","wf","head"]', subject: "alice", allowed: true, reason: "accepted", at: "2026-09-24T09:40:00Z", prev_hash: "", hash: "" },
];

test("«Журнал и состояние»: одна панель состояния словами, без технических строк; подробности — раскрытием", async () => {
  const app = await mountMemoryApp({
    async readPlatformMetrics() { return METRICS; },
    async readOperationAudit() { return { events: EVENTS, checkpoint: { sequence: 4, hash: "h" }, next: 4, truncated: false }; },
    async listPeople() { return { users: [{ userName: "alice", displayName: "Алиса", active: true }, { userName: "bob", displayName: "Борис", active: true }, { userName: "carol", displayName: "Кира", active: true }] }; },
  }, { section: "journal" });
  try {
    const panel = () => app.document.querySelector("#root [data-system-state]");
    await app.until(() => panel(), "панель состояния");
    const details = panel().querySelector('details[aria-label="Подробнее для администратора"]');
    const main = panel().textContent.replace(details.textContent, "");
    assert.match(main, /Хранилище/); assert.match(main, /Сайт и вход/);
    assert.match(main, /Есть проблемы: 1 из 4/);
    assert.match(main, /Сообщите ответственному/, "при проблеме сказано, что делать");
    assert.match(main, /Ответственный не назначен/);
    assert.equal((main.match(/Ответственный/g) ?? []).length, 1, "ответственный — один раз на панель");
    assert.doesNotMatch(main, /production|sophai|release|релиз|dependencies|check_failed|Зависимости API/, "техническое не в основной панели");
    assert.ok(details.textContent.includes("sophai-20260914"), "техническое — под «Подробнее»");
    assert.ok(main.includes("12") && main.includes("Опубликовано материалов"), "числа карточками");

    await app.until(() => app.document.querySelectorAll("#root [data-journal-event]").length === 2, "журнал словами, технические записи скрыты");
    const rows = () => [...app.document.querySelectorAll("#root [data-journal-event]")];
    const journal = () => app.document.querySelector('#root section[aria-label="Журнал действий"]');
    assert.ok(rows()[0].textContent.includes("Кира выдала право читать проект «Второй проект»: Борис"), `новое сверху, законченным предложением: ${rows()[0].textContent}`);
    assert.ok(rows()[1].textContent.includes("Борис создал документ «Заметка команды» в проекте «Общий проект»"), rows()[1].textContent);
    assert.doesNotMatch(journal().textContent, /служебное действие/, "«служебное действие» в обычном виде не показывается");
    const settings = journal().querySelector('details[aria-label="Настройки журнала"]');
    assert.equal(settings.open, false, "переключатель свёрнут");
    const toggle = settings.querySelector('input[aria-label="Показывать служебные"]');
    assert.equal(toggle.checked, false, "и выключен");
    app.type(app.document.querySelector('select[aria-label="Проект журнала"]'), "one");
    await app.until(() => rows().length === 1, "фильтр по проекту");
    rows()[0].querySelector("button").click();
    await app.until(() => rows()[0].textContent.includes("Действие выполнено"), "строка раскрывается на месте");
    app.type(app.document.querySelector('select[aria-label="Проект журнала"]'), "");
    toggle.click();
    await app.until(() => rows().length === 4, "служебные записи показываются по запросу");
    assert.ok(rows().some(r => r.textContent.includes("Алиса: проверка работы системы")), "служебная запись тоже словами");
    assert.doesNotMatch(journal().textContent, /служебное действие/);
    assert.equal(app.document.querySelector('#root details[aria-label="Служебное"]'), null, "подвала «Служебное» нет");
  } finally { app.dispose(); }
});
