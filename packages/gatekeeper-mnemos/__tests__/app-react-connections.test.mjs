import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

const SOURCES = {
  async listImapAccounts() { return { servers: [{ id: "yandex", title: "Яндекс", host: "imap.yandex.ru", port: 993 }], accounts: [{ id: "acc-1", server: "yandex", username: "d.sokolov@example.test", mailbox: "INBOX", enabled: true }] }; },
  async listMailConnections() { return { connections: [{ connection_id: "m-1", project_id: "one", provider: "yandex", query_sha256: "", revision: 1, enabled: true }] }; },
  async listCalDAVAccounts() { return { servers: [{ id: "icloud", title: "iCloud", url: "https://caldav.icloud.com" }], accounts: [] }; },
  async listWebDAVAccounts() { return { servers: [{ id: "corp-dav", title: "Диск компании", url: "https://dav.example.test/" }], accounts: [] }; },
  async listGitConnections() { return { connections: [{ connection_id: "g-1", owner_id: "alice", provider: "gitlab", api_base: "https://gitlab.example.test/api/v4", account_id: "7", account_login: "sokolov", name: "GitLab компании", revision: 2, enabled: true }, { connection_id: "g-2", owner_id: "svc", provider: "gitea", api_base: "https://mnemos.example.test/api/v1", account_id: "1", account_login: "mnemos-service", name: "Gitea", revision: 1, enabled: true }] }; },
  async listGitRepositories() { return { repositories: [{ id: "9", name: "team/site", default_branch: "main" }] }; },
  async listRepositoryOverview() { return { records: [{ project_id: "one", connection_id: "internal-code", repository_id: "7", repository_name: "projects/mnemos", source: "internal", provider: "gitea", source_name: "Внутреннее хранилище Mnemos", branch: "", private: false, agents: true, files: false, revision: 1, can_manage: true }], internal: { available: true, connection_id: "internal-code", revision: 1, can_disable: true }, app_configured: true, admin: true }; },
  async listGitHubAccounts() { return { available: true, connectable: true, accounts: [] }; },
  async listGitAppRepositories() { return { available: true, repositories: [] }; },
  async listGitBranches() { return { branches: [{ name: "main", sha: "a".repeat(40) }] }; },
  async listVisibleDatabaseConnections() { return { databases: [{ db_id: "db-1", project_id: "two", name: "Аналитика", driver: "postgres", env_var: "MNEMOS_DB_A", registered_by: "alice", registered_at: "", configured: true, last_sweep_at: "", unreachable_since: "2026-09-13T08:00:00Z" }], truncated: false }; },
  async listTelegram() { return { connections: [], unavailable: 0 }; },
};

test("«Подключения»: одна страница строками, состояние словами, без адресов и служебных строк; код — строкой «Репозитории»", async () => {
  const app = await mountMemoryApp(SOURCES, { section: "connections" });
  try {
    const row = name => app.document.querySelector(`#root section[aria-label="${name}"]`);
    await app.until(() => row("Почта")?.textContent.includes("d.sokolov@example.test") && row("Базы данных")?.textContent.includes("Аналитика") && row("Репозитории")?.textContent.includes("Источников"), "строки подключений");
    for (const name of ["Почта", "Календарь", "Диск", "Репозитории", "Базы данных", "Telegram"]) assert.ok(row(name), `строка «${name}»`);
    assert.equal(row("Код"), null, "прежней строки «Код» с формой «Где хранится код» нет");
    // Единый счёт: ключ GitLab и внутреннее хранилище — два источника, один репозиторий в проекте.
    assert.ok(row("Репозитории").textContent.includes("Источников: 2 · репозиториев в проектах: 1"), row("Репозитории").textContent);
    assert.ok(row("Почта").textContent.includes("Письма для проекта «Общий проект»"), "проект назван по имени");
    assert.ok(row("Базы данных").textContent.includes("Требует внимания"), "неработающая база видна словами");
    assert.ok(row("Календарь").textContent.includes("Не подключено"), "пустая строка говорит, что не подключено");
    const text = app.text();
    assert.doesNotMatch(text, /https?:\/\/|api\/v4|MNEMOS_DB_|mnemos-service|imap\.yandex|:993/, "ни адресов, ни технических строк");
    assert.doesNotMatch(text, /Gitea|api\/v1|Где хранится код|Открыть проекту репозиторий/, "ни названия программы, ни прежних форм");
    assert.equal(app.buttons().some(b => b.textContent === "Назад"), false, "без подэкранов");
    [...row("Репозитории").querySelectorAll("button")].find(b => b.textContent === "Открыть").click();
    await app.until(() => app.document.querySelector("#root h1")?.textContent === "Репозитории", "строка раскрылась в полноценную страницу");
  } finally { app.dispose(); }
});

test("«Подключения»: почта подключается прямо в строке", async () => {
  const calls = [];
  const app = await mountMemoryApp({ ...SOURCES,
    async connectImapAccount(input) { calls.push(["connectImapAccount", input]); return { id: "acc-2", server: input.server, username: input.username, mailbox: input.mailbox, enabled: true }; },
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
  } finally { app.dispose(); }
});

test("«Репозитории»: свои аккаунты GitHub — подключить ещё, изменить доступ, обновить доступ, отключить один; репозитории строками", async () => {
  const calls = [];
  const accounts = [
    { installation_id: "11", github_login: "alice", account_login: "alice", account_type: "User", repository_selection: "all", linked_at: "", repository_count: 1, manage_url: "https://github.com/settings/installations/11" },
    { installation_id: "12", github_login: "alice-work", account_login: "acme", account_type: "Organization", repository_selection: "selected", linked_at: "", repository_count: 2, manage_url: "https://github.com/organizations/acme/settings/installations/12" },
  ];
  const app = await mountMemoryApp({ ...SOURCES,
    async listGitHubAccounts() { return { available: true, connectable: true, accounts: accounts.filter(a => !calls.some(([m, id]) => m === "disconnectGitHubAccount" && id === a.installation_id)) }; },
    async listGitAppRepositories() { return { available: true, repositories: [
      { installation_id: "12", id: "201", name: "acme/api", default_branch: "main", private: true },
      { installation_id: "11", id: "101", name: "alice/site", default_branch: "main", private: true },
      { installation_id: "12", id: "202", name: "acme/web", default_branch: "main", private: true },
    ] }; },
    async startGitHubConnect() { calls.push(["startGitHubConnect"]); return { url: "https://github.com/login/oauth/authorize?client_id=Iv1.abc&prompt=select_account&state=s1" }; },
    async disconnectGitHubAccount(id) { calls.push(["disconnectGitHubAccount", id]); return { disconnected: true }; },
  }, { section: "connections", githubReturn: { result: "connected", reason: "" } });
  try {
    // Возврат с GitHub приходит на «Подключения» и открывает раздел «Репозитории».
    const page = () => app.document.querySelector("#root");
    const block = () => page().querySelector('[aria-label="Ваши аккаунты GitHub"]');
    await app.until(() => block()?.textContent.includes("acme"), "раздел «Репозитории» открылся после возврата с GitHub");
    assert.equal(page().querySelector("h1").textContent, "Репозитории");
    assert.ok(page().textContent.includes("GitHub подключён"), "итог возврата словами");
    const lines = [...block().querySelectorAll("[data-github-account]")].map(l => l.textContent);
    assert.equal(lines.length, 2, "строка на каждый аккаунт");
    // Число — репозитории, которые GitHub открыл самому человеку, а не вся установка.
    assert.ok(lines[0].includes("alice") && lines[0].includes("1 доступный вам репозиторий"));
    assert.ok(lines[1].includes("организация") && lines[1].includes("2 доступных вам репозитория") && lines[1].includes("через alice-work"));
    assert.doesNotMatch(block().textContent, /https?:\/\/|installation|\b1[12]\b/, "без адресов и номеров установок");
    assert.ok(block().textContent.includes("под каким аккаунтом войти"), "подсказка про выбор аккаунта");

    const inBlock = name => [...block().querySelectorAll("button")].filter(b => b.textContent === name);
    // Нажатие — по готовности кнопки, а не сразу после события: пока идёт прошлое действие, кнопки
    // заблокированы, и на медленной машине нажатие в этот промежуток терялось.
    const press = async (name, index = 0) => {
      await app.until(() => inBlock(name)[index] && !inBlock(name)[index].disabled, `кнопка «${name}» доступна`);
      inBlock(name)[index].click();
    };
    await press("Подключить ещё аккаунт GitHub");
    await app.until(() => app.calls.some(([m]) => m === "openGitHubAppPage"), "GitHub открыт хостом");
    assert.deepEqual(app.calls.find(([m]) => m === "openGitHubAppPage"), ["openGitHubAppPage", "https://github.com/login/oauth/authorize?client_id=Iv1.abc&prompt=select_account&state=s1"]);
    await press("Изменить доступ", 1);
    await app.until(() => app.calls.filter(([m]) => m === "openGitHubAppPage").length === 2, "настройки установки");
    assert.equal(app.calls.filter(([m]) => m === "openGitHubAppPage")[1][1], "https://github.com/organizations/acme/settings/installations/12");
    // «Обновить доступ» — вход в GitHub заново: набор репозиториев человека берётся его ключом.
    assert.equal(inBlock("Обновить доступ").length, 2, "у каждого аккаунта");
    await press("Обновить доступ", 1);
    await app.until(() => calls.filter(([m]) => m === "startGitHubConnect").length === 2, "обновление доступа — новый вход");
    await app.until(() => app.calls.filter(([m]) => m === "openGitHubAppPage").length === 3, "вход открыт");

    await press("Отключить", 1);
    await press("Да, отключить");
    await app.until(() => block()?.querySelectorAll("[data-github-account]").length === 1, "отключён один аккаунт");
    assert.deepEqual(calls.find(([m]) => m === "disconnectGitHubAccount"), ["disconnectGitHubAccount", "12"]);
    assert.ok(block().textContent.includes("alice"), "второй аккаунт остался");

    await app.until(() => page().querySelectorAll("[data-repo]").length >= 4, "репозитории строками");
    const repos = [...page().querySelectorAll("[data-repo]")].map(r => r.dataset.repo).sort();
    assert.deepEqual(repos, ["acme/api", "acme/web", "alice/site", "projects/mnemos", "team/site"], "GitHub, ключ GitLab и внутреннее хранилище — одним списком");
    assert.ok(page().querySelector('[data-repo="acme/api"]').textContent.includes("api · acme"), "имя и аккаунт в строке");
  } finally { app.dispose(); }
});

test("«Репозитории»: без секрета клиента кнопки нет, объяснено словами; ошибка возврата понятна", async () => {
  const app = await mountMemoryApp({ ...SOURCES,
    async listGitHubAccounts() { return { available: true, connectable: false, accounts: [] }; },
  }, { section: "connections", githubReturn: { result: "failed", reason: "state" } });
  try {
    const page = () => app.document.querySelector("#root");
    await app.until(() => page().textContent.includes("не настроено до конца"), "объяснение без кнопки");
    assert.ok(page().textContent.includes("Ссылка подключения устарела"), "причина отказа словами");
    assert.equal([...page().querySelectorAll('[data-source="github"] button')].some(b => /Подключить.*GitHub/.test(b.textContent)), false);
  } finally { app.dispose(); }
});

test("«Подключения»: отказ чтения показан честно", async () => {
  const app = await mountMemoryApp({ ...SOURCES, async listImapAccounts() { throw new Error("forbidden"); } }, { section: "connections" });
  try {
    await app.until(() => app.document.querySelector('#root section[aria-label="Почта"]')?.textContent.includes("Не удалось прочитать"), "отказ по почте");
  } finally { app.dispose(); }
});

test("«Репозитории»: итоги возврата с GitHub для установки без кнопки и запроса в организацию", async () => {
  for (const [reason, words] of [["installed", "Приложение Mnemos установлено в GitHub"], ["requested", "отправлен администратору организации"], ["none", "дождитесь одобрения"]]) {
    const app = await mountMemoryApp(SOURCES, { section: "connections", githubReturn: { result: "failed", reason } });
    try {
      const page = () => app.document.querySelector("#root");
      await app.until(() => page().textContent.includes(words), `итог «${reason}» словами`);
      await app.until(() => [...page().querySelectorAll('[data-source="github"] button')].some(b => b.textContent === "Подключить GitHub"), "кнопка подключения на месте");
      assert.doesNotMatch(page().textContent, /https?:\/\//, "без адресов");
    } finally { app.dispose(); }
  }
});
