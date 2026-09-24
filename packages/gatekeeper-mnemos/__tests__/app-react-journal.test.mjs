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
/** Журнал операций как у сервера: страница (after, after+limit], вершина — номер последней записи. */
function auditPages(events) {
  return async (after, limit) => {
    const page = events.filter(e => Number(e.id) > after).slice(0, limit);
    return { events: page, checkpoint: { sequence: events.length, hash: "h" }, next: page.length ? Number(page.at(-1).id) : after, truncated: false };
  };
}
const PEOPLE = { users: [{ userName: "alice", displayName: "Алиса", active: true }, { userName: "bob", displayName: "Борис", active: true }, { userName: "carol", displayName: "Кира", active: true }] };
const ev = (id, action, patch = {}) => ({ id: String(id), tenant_id: "org", actor: "alice", on_behalf_of: "", action, resource: "", subject: "", allowed: true, reason: "accepted", at: "2026-09-24T08:00:00Z", prev_hash: "", hash: "", ...patch });

const EVENTS = [
  { id: "1", tenant_id: "org", actor: "alice", on_behalf_of: "", action: "workspace-activity.record", resource: '["stream","7","true"]', subject: "alice", allowed: true, reason: "accepted", at: "2026-09-24T08:00:00Z", prev_hash: "", hash: "" },
  { id: "2", tenant_id: "org", actor: "bob", on_behalf_of: "", action: "node.create", resource: '["one","doc"]', subject: "", allowed: true, reason: "accepted", at: "2026-09-24T09:00:00Z", prev_hash: "", hash: "" },
  { id: "3", tenant_id: "org", actor: "carol", on_behalf_of: "", action: "rights.grant", resource: "two:filesystem:read", subject: "bob", allowed: true, reason: "accepted", at: "2026-09-24T09:30:00Z", prev_hash: "", hash: "" },
  { id: "4", tenant_id: "org", actor: "alice", on_behalf_of: "", action: "private-workflow.open", resource: '["one","wf","head"]', subject: "alice", allowed: true, reason: "accepted", at: "2026-09-24T09:40:00Z", prev_hash: "", hash: "" },
];

test("«Журнал и состояние»: одна панель состояния словами, без технических строк; подробности — раскрытием", async () => {
  const app = await mountMemoryApp({
    async readPlatformMetrics() { return METRICS; },
    readOperationAuditPage: auditPages(EVENTS),
    async listWorkJournal() { return { entries: [], truncated: false }; },
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

test("журнал действий: отделы и приглашения из аудита организации видны словами сквозь толщу служебных записей", async () => {
  // Как на установке: каждое обращение интерфейса оставляет request.admit, дела людей тонут в них.
  const events = [
    ev(1, "org_unit.create", { resource: "unit-x", at: "2026-09-24T07:00:00Z" }),
    ev(2, "org_invitation.create", { resource: "inv-1", at: "2026-09-24T07:05:00Z" }),
    ev(3, "org_unit.delete", { resource: '["unit-x","Снабжение","projects_made_private=0"]', at: "2026-09-24T07:10:00Z" }),
  ];
  for (let i = 4; i <= 2500; i++) events.push(ev(i, "request.admit", { resource: '["alice",""]', at: "2026-09-24T08:00:00Z" }));
  const app = await mountMemoryApp({
    readOperationAuditPage: auditPages(events),
    async listWorkJournal() { return { entries: [], truncated: false }; },
    async listPeople() { return PEOPLE; },
    async listOrgUnits() { return []; },
    async listInvitations() { return [{ invitation_id: "inv-1", display_name: "Ольга", email: "olga@example.test" }]; },
  }, { section: "journal" });
  try {
    const rows = () => [...app.document.querySelectorAll("#root [data-journal-event]")];
    await app.until(() => rows().length === 3, "три дела администратора");
    const texts = rows().map(r => r.querySelector("button").textContent);
    assert.ok(texts[0].includes("Алиса удалила отдел «Снабжение»"), texts[0]);
    assert.ok(texts[1].includes("Алиса пригласила в организацию: Ольга (olga@example.test)"), texts[1]);
    assert.ok(texts[2].includes("Алиса создала отдел «Снабжение»"), `имя удалённого отдела — из записи об удалении: ${texts[2]}`);
    assert.doesNotMatch(app.text(), /пока не было/);
  } finally { app.dispose(); }
});

test("журнал действий: журнал операций и журналы работ одной лентой по времени, дубль — одной строкой", async () => {
  const events = [
    ev(1, "org_unit.create", { resource: "unit-1", at: "2026-09-24T09:00:00Z" }),
    ev(2, "git.merge_request.merge", { actor: "alice", resource: '["one","g-1","r-1"]', reason: "requested", at: "2026-09-24T10:00:00Z" }),
    ev(3, "git.merge_request.merge", { actor: "alice", resource: '["one","g-1","r-1"]', reason: "result_verified", at: "2026-09-24T10:00:01Z" }),
    ev(4, "org_invitation.create", { resource: "inv-1", at: "2026-09-24T12:00:00Z" }),
  ];
  const journals = {
    one: [{ entry_id: 7, project_id: "one", recorded_at: "2026-09-24T10:00:02Z", recorded_by: "alice", actor: "claude-code-alice", on_behalf_of: "alice", source: "merge_request", summary: "Поправлен расчёт цен", changed: ["a.go"], result: { kind: "code", reference: "запрос на слияние №3" }, outcome: "accepted" }],
    two: [{ entry_id: 1, project_id: "two", recorded_at: "2026-09-24T11:00:00Z", recorded_by: "bob", actor: "bob", source: "manual", summary: "Собрал отчёт для заказчика", changed: [], result: {}, outcome: "accepted" }],
  };
  const app = await mountMemoryApp({
    readOperationAuditPage: auditPages(events),
    async listWorkJournal(project) { return { entries: journals[project] ?? [], truncated: false }; },
    async listPeople() { return PEOPLE; },
    async listOrgUnits() { return [{ org_unit_id: "unit-1", name: "Бухгалтерия" }]; },
    async listInvitations() { return [{ invitation_id: "inv-1", display_name: "Ольга", email: "olga@example.test" }]; },
  }, { section: "journal" });
  try {
    const rows = () => [...app.document.querySelectorAll("#root [data-journal-event]")];
    const texts = () => rows().map(r => r.querySelector("button").textContent);
    await app.until(() => rows().length === 4, `четыре строки: ${texts().join(" | ")}`);
    assert.ok(texts()[0].includes("пригласила в организацию"), texts()[0]);
    assert.ok(texts()[1].includes("Борис записал итог работы в проекте «Второй проект»: Собрал отчёт для заказчика"), texts()[1]);
    assert.ok(texts()[2].includes("сдал работу в проекте «Общий проект», изменения кода приняты: Поправлен расчёт цен"), texts()[2]);
    assert.ok(texts()[3].includes("Алиса создала отдел «Бухгалтерия»"), texts()[3]);
    assert.equal(rows()[2].dataset.journalSource, "work+audit", "итог слияния из журнала операций и запись журнала работ — одна строка");
    assert.equal(texts().filter(t => /изменения кода/.test(t)).length, 1, "дубль не показан второй строкой");
    // Фильтры работают по всем источникам.
    app.type(app.document.querySelector('select[aria-label="Проект журнала"]'), "two");
    await app.until(() => rows().length === 1 && texts()[0].includes("Собрал отчёт"), "фильтр по проекту — журнал работ");
    app.type(app.document.querySelector('select[aria-label="Проект журнала"]'), "");
    app.type(app.document.querySelector('select[aria-label="Кто"]'), "bob");
    await app.until(() => rows().length === 1 && texts()[0].includes("Борис"), "фильтр «кто» — журнал работ");
    app.type(app.document.querySelector('select[aria-label="Кто"]'), "alice");
    await app.until(() => rows().length === 3, "фильтр «кто»: и журнал операций, и работа агента по поручению");
    assert.equal(app.document.querySelector("#root [data-journal-unavailable]"), null, "все источники прочитаны — пометки нет");
  } finally { app.dispose(); }
});

test("журнал действий: «Показать более ранние» догружает из всех источников и держит порядок по времени", async () => {
  const events = [ev(1, "org_unit.create", { resource: "unit-1", at: "2026-09-20T09:00:00Z" })];
  for (let i = 2; i <= 10001; i++) events.push(ev(i, "request.admit", { at: "2026-09-24T09:00:00Z" }));
  events.push(ev(10002, "org_invitation.create", { resource: "inv-1", at: "2026-09-24T12:00:00Z" }));
  const calls = [];
  const app = await mountMemoryApp({
    readOperationAuditPage: auditPages(events),
    async listWorkJournal(project, cursor) {
      calls.push([project, cursor]);
      if (project !== "one") return { entries: [], truncated: false };
      return cursor === "" ? { entries: [{ entry_id: 2, project_id: "one", recorded_at: "2026-09-23T10:00:00Z", recorded_by: "bob", actor: "bob", source: "manual", summary: "Вторая запись", changed: [], result: {}, outcome: "accepted" }], next_cursor: "c1", truncated: true }
        : { entries: [{ entry_id: 1, project_id: "one", recorded_at: "2026-09-21T10:00:00Z", recorded_by: "bob", actor: "bob", source: "manual", summary: "Первая запись", changed: [], result: {}, outcome: "accepted" }], truncated: false };
    },
    async listPeople() { return PEOPLE; },
    async listOrgUnits() { return [{ org_unit_id: "unit-1", name: "Бухгалтерия" }]; },
    async listInvitations() { return []; },
  }, { section: "journal" });
  try {
    const rows = () => [...app.document.querySelectorAll("#root [data-journal-event]")];
    const texts = () => rows().map(r => r.querySelector("button").textContent);
    // Первое чтение журнала операций не дошло до 20 сентября: ниже этой границы лента не показывается.
    await app.until(() => rows().length === 1 && app.buttons().some(b => b.textContent === "Показать более ранние"), `одна строка до догрузки: ${texts().join(" | ")}`);
    assert.ok(texts()[0].includes("пригласила нового сотрудника"), texts()[0]);
    app.button("Показать более ранние").click();
    await app.until(() => rows().length === 4, `после догрузки: ${texts().join(" | ")}`);
    assert.ok(texts()[1].includes("Вторая запись") && texts()[2].includes("Первая запись") && texts()[3].includes("создала отдел"), texts().join(" | "));
    assert.ok(calls.some(([p, c]) => p === "one" && c === "c1"), "журнал работ догружен курсором");
    assert.equal(app.buttons().some(b => b.textContent === "Показать более ранние"), false, "всё прочитано");
  } finally { app.dispose(); }
});

test("журнал действий: недоступный источник не ломает журнал — остальное видно, внизу тихая пометка", async () => {
  const app = await mountMemoryApp({
    async readOperationAuditPage() { throw new Error("forbidden"); },
    async listWorkJournal(project) {
      if (project === "two") throw new Error("forbidden");
      return { entries: [{ entry_id: 1, project_id: "one", recorded_at: "2026-09-24T10:00:00Z", recorded_by: "bob", actor: "bob", source: "manual", summary: "Собрал отчёт", changed: [], result: {}, outcome: "accepted" }], truncated: false };
    },
    async listPeople() { return PEOPLE; },
  }, { section: "journal" });
  try {
    const rows = () => [...app.document.querySelectorAll("#root [data-journal-event]")];
    await app.until(() => rows().length === 1 && app.document.querySelector("#root [data-journal-unavailable]"), "запись журнала работ и пометка");
    const note = app.document.querySelector("#root [data-journal-unavailable]").textContent;
    assert.match(note, /Журнал операций организации не прочитан/);
    assert.match(note, /«Второй проект»/);
    assert.ok(rows()[0].textContent.includes("Борис записал итог работы в проекте «Общий проект»"));
    assert.doesNotMatch(app.text(), /Журнал не прочитан/, "красного отказа нет");
  } finally { app.dispose(); }
});
