import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

const SOURCES = {
  async listImapAccounts() { return { servers: [{ id: "yandex", title: "Яндекс", host: "imap.yandex.ru", port: 993 }], accounts: [{ id: "acc-1", server: "yandex", username: "d.sokolov@example.test", mailbox: "INBOX", enabled: true }] }; },
  async listMailConnections() { return { connections: [{ connection_id: "m-1", project_id: "one", provider: "yandex", query_sha256: "", revision: 1, enabled: true }] }; },
  async listCalDAVAccounts() { return { servers: [{ id: "icloud", title: "iCloud", url: "https://caldav.icloud.com" }], accounts: [] }; },
  async listWebDAVAccounts() { return { servers: [{ id: "corp-dav", title: "Диск компании", url: "https://dav.example.test/" }], accounts: [] }; },
  async listGitConnections() { return { connections: [{ connection_id: "g-1", owner_id: "alice", provider: "gitlab", api_base: "https://gitlab.example.test/api/v4", account_id: "7", account_login: "sokolov", name: "GitLab компании", revision: 2, enabled: true }, { connection_id: "g-2", owner_id: "svc", provider: "gitea", api_base: "https://mnemos.example.test/api/v1", account_id: "1", account_login: "mnemos-service", name: "Gitea", revision: 1, enabled: true }] }; },
  async listGitRepositories() { return { repositories: [{ id: "r-9", name: "site", default_branch: "main" }] }; },
  async listVisibleDatabaseConnections() { return { databases: [{ db_id: "db-1", project_id: "two", name: "Аналитика", driver: "postgres", env_var: "MNEMOS_DB_A", registered_by: "alice", registered_at: "", configured: true, last_sweep_at: "", unreachable_since: "2026-09-13T08:00:00Z" }], truncated: false }; },
  async listTelegram() { return { connections: [], unavailable: 0 }; },
};

test("«Подключения»: одна страница строками, состояние словами, без адресов и служебных строк", async () => {
  const app = await mountMemoryApp(SOURCES, { section: "connections" });
  try {
    const row = name => app.document.querySelector(`#root section[aria-label="${name}"]`);
    await app.until(() => row("Почта")?.textContent.includes("d.sokolov@example.test") && row("Базы данных")?.textContent.includes("Аналитика") && row("Код")?.textContent.includes("GitLab компании"), "строки подключений");
    for (const name of ["Почта", "Календарь", "Диск", "Код", "Базы данных", "Telegram"]) assert.ok(row(name), `строка «${name}»`);
    assert.ok(row("Почта").textContent.includes("Письма для проекта «Общий проект»"), "проект назван по имени");
    assert.ok(row("Базы данных").textContent.includes("Требует внимания"), "неработающая база видна словами");
    assert.ok(row("Календарь").textContent.includes("Не подключено"), "пустая строка говорит, что не подключено");
    const text = app.text();
    assert.doesNotMatch(text, /https?:\/\/|api\/v4|MNEMOS_DB_|mnemos-service|imap\.yandex|:993/, "ни адресов, ни технических строк");
    assert.ok(row("Код").textContent.includes("Внутреннее хранилище кода Mnemos"), "внутреннее хранилище названо словами");
    assert.doesNotMatch(text, /Gitea|api\/v1/, "ни названия программы, ни служебной учётной записи");
    assert.equal(app.buttons().some(b => b.textContent === "Назад"), false, "без подэкранов");
  } finally { app.dispose(); }
});

test("«Подключения»: почта подключается прямо в строке; отключение — с подтверждением на месте", async () => {
  const calls = [];
  const app = await mountMemoryApp({ ...SOURCES,
    async connectImapAccount(input) { calls.push(["connectImapAccount", input]); return { id: "acc-2", server: input.server, username: input.username, mailbox: input.mailbox, enabled: true }; },
    async disableGitConnection(id, revision) { calls.push(["disableGitConnection", id, revision]); return { connection: {}, credential_removed: true }; },
  }, { section: "connections" });
  try {
    const row = name => app.document.querySelector(`#root section[aria-label="${name}"]`);
    await app.until(() => row("Почта")?.textContent.includes("d.sokolov"), "почта");
    [...row("Почта").querySelectorAll("button")].find(b => b.textContent === "Подключить").click();
    await app.until(() => row("Почта").querySelector('input[aria-label="Логин"]'), "форма раскрылась в строке");
    assert.deepEqual([...row("Почта").querySelectorAll('select[aria-label="Сервис"] option')].map(o => o.textContent), ["Яндекс"], "сервис назван, без адреса сервера");
    app.type(row("Почта").querySelector('input[aria-label="Логин"]'), "anna@example.test");
    app.type(row("Почта").querySelector('input[aria-label="Пароль приложения"]'), "secret");
    [...row("Почта").querySelectorAll("button")].filter(b => b.textContent === "Подключить").at(-1).click();
    await app.until(() => calls.some(([m]) => m === "connectImapAccount"), "подключение отправлено");
    const input = calls.find(([m]) => m === "connectImapAccount")[1];
    assert.equal(input.server, "yandex"); assert.equal(input.username, "anna@example.test"); assert.equal(input.mailbox, "INBOX"); assert.equal(input.smtp, undefined, "отправка не включена без согласия");

    [...row("Код").querySelectorAll("button")].find(b => b.textContent === "Отключить").click();
    await app.until(() => [...row("Код").querySelectorAll("button")].some(b => b.textContent === "Да, отключить"), "подтверждение на месте");
    [...row("Код").querySelectorAll("button")].find(b => b.textContent === "Да, отключить").click();
    await app.until(() => calls.some(([m]) => m === "disableGitConnection"), "отключение");
    assert.deepEqual(calls.find(([m]) => m === "disableGitConnection"), ["disableGitConnection", "g-1", 2]);
  } finally { app.dispose(); }
});

test("«Подключения»: отказ чтения показан честно", async () => {
  const app = await mountMemoryApp({ ...SOURCES, async listImapAccounts() { throw new Error("forbidden"); } }, { section: "connections" });
  try {
    await app.until(() => app.document.querySelector('#root section[aria-label="Почта"]')?.textContent.includes("Не удалось прочитать"), "отказ по почте");
  } finally { app.dispose(); }
});
