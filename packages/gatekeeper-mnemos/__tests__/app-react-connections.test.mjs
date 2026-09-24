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
    // У подключённого источника кнопка — «Настроить»; у пустого — «Подключить».
    assert.ok([...row("Календарь").querySelectorAll("button")].some(b => b.textContent === "Подключить"), "пустой источник подключается");
    [...row("Почта").querySelectorAll("button")].find(b => b.textContent === "Настроить").click();
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

test("«Подключения»: свои аккаунты GitHub — подключить ещё, изменить доступ, отключить один; репозитории по аккаунтам", async () => {
  const calls = [];
  const accounts = [
    { installation_id: "11", github_login: "alice", account_login: "alice", account_type: "User", repository_selection: "all", linked_at: "", repository_count: 1, manage_url: "https://github.com/settings/installations/11" },
    { installation_id: "12", github_login: "alice-work", account_login: "acme", account_type: "Organization", repository_selection: "selected", linked_at: "", repository_count: 2, manage_url: "https://github.com/apps/mnemos/installations/new" },
  ];
  const app = await mountMemoryApp({ ...SOURCES,
    async listGitSyncLinks() { return { links: [] }; },
    async listGitHubAccounts() { return { available: true, connectable: true, accounts: accounts.filter(a => !calls.some(([m, id]) => m === "disconnectGitHubAccount" && id === a.installation_id)) }; },
    async listGitAppRepositories() { return { available: true, repositories: [
      { installation_id: "12", id: "201", name: "acme/api", default_branch: "main", private: true },
      { installation_id: "11", id: "101", name: "alice/site", default_branch: "main", private: true },
      { installation_id: "12", id: "202", name: "acme/web", default_branch: "main", private: true },
    ] }; },
    async startGitHubConnect() { calls.push(["startGitHubConnect"]); return { url: "https://github.com/apps/mnemos/installations/new?state=s1" }; },
    async disconnectGitHubAccount(id) { calls.push(["disconnectGitHubAccount", id]); return { disconnected: true }; },
  }, { section: "connections", githubReturn: { result: "connected", reason: "" } });
  try {
    const row = () => app.document.querySelector('#root section[aria-label="Код"]');
    const block = () => row()?.querySelector('[aria-label="Ваши аккаунты GitHub"]');
    await app.until(() => block()?.textContent.includes("acme"), "строка «Код» раскрылась после возврата с GitHub");
    assert.ok(row().textContent.includes("GitHub подключён"), "итог возврата словами");
    const lines = [...block().querySelectorAll("[data-github-account]")].map(l => l.textContent);
    assert.equal(lines.length, 2, "строка на каждый аккаунт");
    assert.ok(lines[0].includes("alice") && lines[0].includes("все репозитории"));
    assert.ok(lines[1].includes("организация") && lines[1].includes("2 выбранных репозитория") && lines[1].includes("через alice-work"));
    assert.doesNotMatch(block().textContent, /https?:\/\/|installation|\b1[12]\b/, "без адресов и номеров установок");
    assert.ok(block().textContent.includes("выйдите из GitHub"), "подсказка про другой аккаунт");

    const inBlock = name => [...block().querySelectorAll("button")].filter(b => b.textContent === name);
    inBlock("Подключить ещё аккаунт GitHub")[0].click();
    await app.until(() => app.calls.some(([m]) => m === "openGitHubAppPage"), "GitHub открыт хостом");
    assert.deepEqual(app.calls.find(([m]) => m === "openGitHubAppPage"), ["openGitHubAppPage", "https://github.com/apps/mnemos/installations/new?state=s1"]);
    inBlock("Изменить доступ")[1].click();
    await app.until(() => app.calls.filter(([m]) => m === "openGitHubAppPage").length === 2, "настройки установки");
    assert.equal(app.calls.filter(([m]) => m === "openGitHubAppPage")[1][1], "https://github.com/apps/mnemos/installations/new");

    inBlock("Отключить")[1].click();
    await app.until(() => inBlock("Да, отключить").length === 1, "подтверждение на месте");
    inBlock("Да, отключить")[0].click();
    await app.until(() => block()?.querySelectorAll("[data-github-account]").length === 1, "отключён один аккаунт");
    assert.deepEqual(calls.find(([m]) => m === "disconnectGitHubAccount"), ["disconnectGitHubAccount", "12"]);
    assert.ok(block().textContent.includes("alice"), "второй аккаунт остался");

    [...row().querySelectorAll("button")].find(b => b.textContent === "Связать репозиторий с проектом").click();
    await app.until(() => row().querySelectorAll('select[aria-label="Репозиторий GitHub"] optgroup').length === 2, "репозитории по аккаунтам");
    const groups = [...row().querySelectorAll('select[aria-label="Репозиторий GitHub"] optgroup')].map(g => `${g.label}: ${[...g.querySelectorAll("option")].map(o => o.textContent).join(", ")}`);
    assert.deepEqual(groups, ["acme: acme/api, acme/web", "alice: alice/site"]);
  } finally { app.dispose(); }
});

test("«Подключения»: без секрета клиента кнопки нет, объяснено словами; ошибка возврата понятна", async () => {
  const app = await mountMemoryApp({ ...SOURCES,
    async listGitSyncLinks() { return { links: [] }; },
    async listGitHubAccounts() { return { available: true, connectable: false, accounts: [] }; },
  }, { section: "connections", githubReturn: { result: "failed", reason: "state" } });
  try {
    const row = () => app.document.querySelector('#root section[aria-label="Код"]');
    await app.until(() => row()?.textContent.includes("не настроено до конца"), "объяснение без кнопки");
    assert.ok(row().textContent.includes("Ссылка подключения устарела"), "причина отказа словами");
    assert.equal([...row().querySelectorAll("button")].some(b => /Подключить.*GitHub/.test(b.textContent)), false);
  } finally { app.dispose(); }
});

test("«Подключения»: отказ чтения показан честно", async () => {
  const app = await mountMemoryApp({ ...SOURCES, async listImapAccounts() { throw new Error("forbidden"); } }, { section: "connections" });
  try {
    await app.until(() => app.document.querySelector('#root section[aria-label="Почта"]')?.textContent.includes("Не удалось прочитать"), "отказ по почте");
  } finally { app.dispose(); }
});
