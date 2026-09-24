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
  { id: "e-1", tenant_id: "org", actor: "bob", on_behalf_of: "", action: "document.publish", resource: "projects/one/nodes/doc", subject: "s-1", allowed: true, reason: "allowed", at: "2026-09-24T09:00:00Z", prev_hash: "", hash: "" },
  { id: "e-2", tenant_id: "org", actor: "carol", on_behalf_of: "", action: "principal.grant", resource: "projects/two", subject: "s-2", allowed: false, reason: "denied", at: "2026-09-24T09:30:00Z", prev_hash: "", hash: "" },
];

test("«Журнал и состояние»: одна панель состояния словами, без технических строк; подробности — раскрытием", async () => {
  const app = await mountMemoryApp({
    async readPlatformMetrics() { return METRICS; },
    async readOperationAudit() { return { events: EVENTS, checkpoint: { sequence: 2, hash: "h" }, next: 2, truncated: false }; },
    async listPeople() { return { users: [{ userName: "bob", displayName: "Борис", active: true }, { userName: "carol", displayName: "Кира", active: true }] }; },
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

    await app.until(() => app.document.querySelectorAll("#root [data-journal-event]").length === 2, "журнал словами");
    const rows = () => [...app.document.querySelectorAll("#root [data-journal-event]")];
    assert.ok(rows()[0].textContent.includes("Кира: изменение доступа") && rows()[0].textContent.includes("Отказано"), "новое сверху, словами");
    assert.ok(rows()[1].textContent.includes("Борис: публикация") && rows()[1].textContent.includes("проект «Общий проект»"));
    app.type(app.document.querySelector('select[aria-label="Проект журнала"]'), "one");
    await app.until(() => rows().length === 1, "фильтр по проекту");
    rows()[0].querySelector("button").click();
    await app.until(() => rows()[0].textContent.includes("Действие разрешено и выполнено"), "строка раскрывается на месте");
    assert.equal(app.document.querySelector('#root details[aria-label="Служебное"]'), null, "подвала «Служебное» нет");
  } finally { app.dispose(); }
});
