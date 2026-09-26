import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

// Раздел «Репозитории» (решение владельца 25.09.2026): репозиторий в проекте — одна запись с «Файлами в
// проекте» и «Агентами кода»; ни одного выпадающего списка, ни одного «Применить».

const ago = hours => new Date(Date.now() - hours * 3600e3).toISOString();
const CONSENT = "Код приватного репозитория увидят все, кому открыт проект. Подтвердите это.";
const APP_PERMISSIONS = "У приложения Mnemos в GitHub нет права записи: агенты кода через него не работают. Владелец приложения добавляет в настройках GitHub App права Contents и Pull requests — «Read and write», владелец аккаунта GitHub подтверждает их. Либо подключите ключ доступа GitHub в «Дополнительно».";
const APP_REPOS = [
  { installation_id: "11", id: "101", name: "acme/site", default_branch: "main", private: true, account: "acme", pushed_at: ago(0.05), language: "TypeScript" },
  { installation_id: "11", id: "102", name: "acme/billing", default_branch: "trunk", private: true, account: "acme", pushed_at: ago(26), language: "Go" },
  { installation_id: "11", id: "103", name: "acme/notes", default_branch: "develop", private: false, account: "acme", pushed_at: ago(24 * 9), language: null },
];
const SKIPPED = [...Array(9)].map((_, i) => ({ path: `assets/img-${i}.png`, reason: "binary" })).concat([...Array(3)].map((_, i) => ({ path: `data/dump-${i}.sql`, reason: "large" })));
const SITE = { project_id: "one", connection_id: "github-app-11", repository_id: "101", repository_name: "acme/site", source: "github_app", provider: "github", installation_id: "11", source_name: "acme",
  branch: "main", private: true, agents: true, files: true, revision: 4, can_manage: true,
  link: { link_id: "l1", project_id: "one", source: "app", connection_id: "", installation_id: "11", repository_id: "101", repository_name: "acme/site", branch: "main", folder: "", include: [], exclude: [],
    visibility: "private", state: "ok", message: "", last_synced_sha: "a".repeat(40), last_synced_at: ago(0.05), report: {}, revision: 2, can_manage: true, file_count: 312, paused: false, access_revoked: false, remove_requested: false, skipped: SKIPPED } };
const INTERNAL = { project_id: "two", connection_id: "internal-code", repository_id: "7", repository_name: "projects/mnemos", source: "internal", provider: "gitea", source_name: "Внутреннее хранилище Mnemos", branch: "", private: false, agents: true, files: false, revision: 1, can_manage: true };

function methods(calls, over = {}) {
  let records = over.records ?? [SITE, INTERNAL];
  return {
    async listRepositoryOverview() { return { records, internal: { available: true, connection_id: "internal-code", revision: 3, can_disable: over.admin ?? false }, app_configured: true, admin: over.admin ?? false }; },
    async listGitHubAccounts() { return { available: true, connectable: true, accounts: [{ installation_id: "11", github_login: "alice", account_login: "acme", account_type: "Organization", repository_selection: "all", linked_at: "", repository_count: 3, manage_url: "https://github.com/x", access_stale: false }] }; },
    async listGitAppRepositories() { return { available: true, repositories: APP_REPOS }; },
    async listGitConnections() { return { connections: [{ connection_id: "github-app-11", owner_id: "alice", provider: "github", api_base: "https://api.github.com", account_id: "11", account_login: "acme", name: "GitHub · acme", revision: 1, enabled: true, installation_id: "11" }] }; },
    async listGitRepositories() { return { repositories: [] }; },
    async listGitBranches(project) { return { branches: project === "one" ? [{ name: "main", sha: "a".repeat(40) }, { name: "agents/agent-a/one", sha: "b".repeat(40) }, { name: "agents/agent-a/two", sha: "c".repeat(40) }] : [{ name: "main", sha: "a".repeat(40) }] }; },
    async setRepositoryCapabilities(project, connection, repository, change) {
      calls.push(["setRepositoryCapabilities", project, connection, repository, change]);
      if (over.capabilityError && !change.consent) throw new Error(over.capabilityError);
      const rec = records.find(r => r.project_id === project && r.repository_id === repository);
      const next = { ...rec, ...("files" in change ? { files: change.files, link: rec.link && { ...rec.link, paused: !change.files } } : {}), ...("agents" in change ? { agents: change.agents, revision: rec.revision + 1 } : {}) };
      records = records.map(r => r === rec ? next : r);
      return next;
    },
    async addRepository(input) { calls.push(["addRepository", input]); if (over.addError) throw new Error(over.addError); return { project: input.project_id ? undefined : { id: "p-new", name: input.name }, record: { ...SITE, project_id: input.project_id || "p-new", repository_id: input.repository_id, repository_name: input.repository_name, agents: input.agents, files: input.files } }; },
    async detachRepository(...args) { calls.push(["detachRepository", ...args]); records = records.filter(r => r.repository_id !== args[2]); return { detached: true }; },
    async resolveRevokedRepository(...args) { calls.push(["resolveRevokedRepository", ...args]); return { accepted: true }; },
    async refreshGitSyncLink(id) { calls.push(["refreshGitSyncLink", id]); return { queued: true }; },
    async disableInternalCodeHosting(expected) { calls.push(["disableInternalCodeHosting", expected]); return { disabled: true }; },
    async saveGitRegistrationIntent(setup) { calls.push(["saveGitRegistrationIntent", setup]); return { id: "intent-1" }; },
    async executeGitRegistrationIntent(id, token) { calls.push(["executeGitRegistrationIntent", id, token]); return {}; },
    ...(over.methods ?? {}),
  };
}

async function mount(calls, over = {}, count = 4) {
  const app = await mountMemoryApp(methods(calls, over), { section: "connections", view: "repositories" });
  const page = () => app.document.querySelector("#root");
  const repo = name => page().querySelector(`[data-repo="${name}"]`);
  const press = (root, name) => { const b = [...root.querySelectorAll("button")].find(x => x.textContent === name); assert.ok(b, `кнопка «${name}»`); b.click(); };
  await app.until(() => page().querySelectorAll("[data-repo]").length === count, "репозитории строками");
  return { app, page, repo, press };
}

test("«Репозитории»: единый счёт, источники компактно, репозитории одним списком — без выпадающих списков", async () => {
  const calls = [];
  const { app, page, repo } = await mount(calls);
  try {
    assert.equal(page().querySelector("h1").textContent, "Репозитории");
    assert.equal(page().querySelectorAll("select").length, 0, "ни одного <select> в разделе");
    await app.until(() => page().querySelector("[data-ledger]")?.textContent.includes("Источников: 2"), "единый счёт");
    assert.match(page().querySelector("[data-ledger]").textContent, /Источников: 2.*репозиториев в проектах: 2/);
    assert.ok(page().querySelector('[data-source="internal"]').textContent.includes("ресурс организации"), "внутреннее хранилище — ресурс организации");
    assert.equal([...page().querySelectorAll('[data-source="internal"] button')].some(b => b.textContent === "Отключить"), false, "сотрудник не отключает хранилище организации");
    assert.deepEqual([...page().querySelectorAll("[data-repo]")].map(r => r.dataset.repo), ["acme/site", "projects/mnemos", "acme/billing", "acme/notes"], "связанные сверху, дальше по свежести");
    assert.match(repo("acme/billing").textContent, /billing · acme.*GitHub · приватный · Go · изменён вчера/);
    const site = repo("acme/site").textContent;
    assert.ok(site.includes("Проект «Общий проект»"), site);
    assert.ok(site.includes("синхронизировано") && site.includes("312 файлов") && site.includes("пропущено 12 (двоичные 9, >1 МБ 3)"), site);
    await app.until(() => repo("acme/site").textContent.includes("2 ветки ждут «Принять»"), "ветки агентов ждут «Принять»");
    const internal = repo("projects/mnemos").textContent;
    assert.ok(internal.includes("внутреннее хранилище Mnemos") && internal.includes("переносятся только из GitHub"), internal);
    // Пропущенные файлы раскрываются путями.
    [...repo("acme/site").querySelectorAll("button")].find(b => b.textContent.startsWith("пропущено 12")).click();
    await app.until(() => repo("acme/site").querySelector('[aria-label="Пропущенные файлы"]'), "список пропусков");
    assert.equal(repo("acme/site").querySelectorAll('[aria-label="Пропущенные файлы"] li').length, 12);
    assert.ok(repo("acme/site").textContent.includes("assets/img-0.png") && repo("acme/site").textContent.includes("больше 1 МБ"));
    assert.equal(app.buttons().some(b => /Применить|Сохранить/.test(b.textContent)), false, "без «Применить»: всё сохраняется сразу");
  } finally { app.dispose(); }
});

test("«Репозитории»: переключатели сохраняются сразу; при приватном коде в проекте отдела — подтверждение текстом", async () => {
  const calls = [];
  const { app, repo } = await mount(calls, { capabilityError: CONSENT });
  try {
    const site = () => repo("acme/site");
    const toggle = name => site().querySelector(`[role="switch"][aria-label="${name}"]`);
    assert.equal(toggle("Файлы в проекте").getAttribute("aria-checked"), "true");
    toggle("Файлы в проекте").click();
    await app.until(() => site().textContent.includes("Понимаю, включить"), "подтверждение на месте");
    assert.equal(toggle("Файлы в проекте").getAttribute("aria-checked"), "true", "отказ сервера вернул переключатель");
    assert.ok(site().textContent.includes("Код приватного репозитория «acme/site» увидят все, кому открыт проект «Общий проект»"));
    [...site().querySelectorAll("button")].find(b => b.textContent === "Понимаю, включить").click();
    // Переключатель гаснет оптимистично, до ответа сервера; дожидаемся самого запроса, а не побочного эффекта.
    await app.until(() => calls.filter(([m]) => m === "setRepositoryCapabilities").length === 2, "запрос с подтверждением ушёл");
    await app.until(() => toggle("Файлы в проекте").getAttribute("aria-checked") === "false", "сохранено сразу");
    const sent = calls.filter(([m]) => m === "setRepositoryCapabilities").map(c => c[4]);
    assert.deepEqual(sent, [{ expected_revision: 4, files: false }, { expected_revision: 4, files: false, consent: true }]);
    // Подпись приходит с ответом сервера, позже оптимистичного переключателя: ждать её, а не проверять сразу.
    await app.until(() => site().textContent.includes("312 файлов остались в проекте"), "файлы остались, не обновляются");
  } finally { app.dispose(); }
});

test("«Репозитории»: агентам через приложение GitHub нужны права записи — сказано, что добавить", async () => {
  const calls = [];
  const { app, repo } = await mount(calls, { capabilityError: APP_PERMISSIONS, records: [{ ...SITE, agents: false }, INTERNAL] });
  try {
    repo("acme/site").querySelector('[role="switch"][aria-label="Агенты кода"]').click();
    await app.until(() => repo("acme/site").textContent.includes("Contents и Pull requests"), "понятный отказ");
    assert.equal(repo("acme/site").querySelector('[role="switch"][aria-label="Агенты кода"]').getAttribute("aria-checked"), "false");
  } finally { app.dispose(); }
});

test("«Репозитории»: «Создать проект» из приватного — отдел только с подтверждением, «Вся организация» — только администратору", async () => {
  const calls = [];
  const { app, repo, press } = await mount(calls);
  try {
    press(repo("acme/billing"), "Создать проект");
    await app.until(() => repo("acme/billing").querySelector('input[aria-label="Название проекта"]'), "форма в строке");
    const form = repo("acme/billing");
    assert.equal(form.querySelectorAll("select").length, 0, "без выпадающих списков");
    const chips = [...form.querySelectorAll('[aria-labelledby] [role="radio"]')];
    assert.deepEqual(chips.map(c => c.textContent), ["Только я", "Мой отдел", "Вся организация"]);
    assert.equal(chips[2].disabled, true, "«Вся организация» для приватного кода — только администратор");
    assert.ok(form.textContent.includes("Приватный код всей организации открывает только администратор."));
    const toggle = name => form.querySelector(`[role="switch"][aria-label="${name}"]`);
    assert.equal(toggle("Файлы в проекте").getAttribute("aria-checked"), "true", "файлы — по умолчанию");
    assert.equal(toggle("Агенты кода").getAttribute("aria-checked"), "false");
    toggle("Агенты кода").click();
    chips[1].click();
    const submit = () => form.querySelector("button[data-submit]");
    await app.until(() => form.textContent.includes("увидят все сотрудники отдела"), "подтверждение текстом");
    assert.equal(submit().disabled, true, "без подтверждения не создать");
    form.querySelector('input[type="checkbox"]').click();
    await app.until(() => !submit().disabled, "подтверждено");
    submit().click();
    await app.until(() => calls.some(([m]) => m === "addRepository"), "создание");
    const input = calls.find(([m]) => m === "addRepository")[1];
    assert.deepEqual({ name: input.name, visibility: input.visibility, files: input.files, agents: input.agents, consent: input.consent, source: input.source, installation_id: input.installation_id, repository_id: input.repository_id, branch: input.branch },
      { name: "billing", visibility: "department", files: true, agents: true, consent: true, source: "app", installation_id: "11", repository_id: "102", branch: "trunk" });
    await app.until(() => app.calls.some(([m, s, p]) => m === "openSection" && s === "projects" && p === "p-new"), "переход в новый проект");
  } finally { app.dispose(); }
});

test("«Репозитории»: «Добавить в проект…» — проект поиском; публичный репозиторий не спрашивает подтверждения", async () => {
  const calls = [];
  const { app, repo, press } = await mount(calls);
  try {
    press(repo("acme/notes"), "Добавить в проект…");
    await app.until(() => repo("acme/notes").querySelector('input[aria-label="Найти проект"]'), "поиск проекта");
    const form = repo("acme/notes");
    app.type(form.querySelector('input[aria-label="Найти проект"]'), "втор");
    await app.until(() => form.querySelectorAll('[aria-label="Проект"] [role="radio"]').length === 1, "поиск сузил список");
    form.querySelector('[aria-label="Проект"] [role="radio"]').click();
    await app.until(() => form.querySelector("button[data-submit]").textContent === "Добавить в «Второй проект»", "кнопка называет проект");
    assert.equal(form.querySelector('input[type="checkbox"]'), null, "публичный код — без подтверждения");
    form.querySelector("button[data-submit]").click();
    await app.until(() => calls.some(([m]) => m === "addRepository"), "добавление");
    const input = calls.find(([m]) => m === "addRepository")[1];
    assert.deepEqual({ project: input.project_id, folder: input.folder, files: input.files, agents: input.agents, visibility: input.visibility }, { project: "two", folder: "notes", files: true, agents: false, visibility: undefined });
  } finally { app.dispose(); }
});

test("«Репозитории»: доступ отозван в GitHub — «Оставить копию» или «Убрать файлы из проекта»", async () => {
  const calls = [];
  const revoked = { ...SITE, link: { ...SITE.link, access_revoked: true, state: "blocked", message: "отозван" } };
  const { app, repo, press, page } = await mount(calls, { records: [revoked, INTERNAL] });
  try {
    const site = () => repo("acme/site");
    assert.ok(site().textContent.includes("Доступ отозван в GitHub."), site().textContent);
    await app.until(() => page().querySelector("[data-ledger]")?.textContent.includes("требуют внимания: 1"), "счёт внимания");
    press(site(), "Убрать файлы из проекта");
    await app.until(() => site().textContent.includes("изменённые останутся"), "подтверждение на месте");
    assert.equal(calls.some(([m]) => m === "resolveRevokedRepository"), false);
    press(site(), "Да, убрать");
    await app.until(() => calls.some(([m]) => m === "resolveRevokedRepository"), "решение отправлено");
    assert.deepEqual(calls.find(([m]) => m === "resolveRevokedRepository"), ["resolveRevokedRepository", "l1", true]);
  } finally { app.dispose(); }
});

test("«Репозитории»: «Отвязать» — с подтверждением; «Обновить сейчас» — сразу", async () => {
  const calls = [];
  const { app, repo, press } = await mount(calls);
  try {
    press(repo("acme/site"), "Обновить сейчас");
    await app.until(() => calls.some(([m]) => m === "refreshGitSyncLink"), "обновление");
    press(repo("acme/site"), "Отвязать");
    await app.until(() => repo("acme/site").textContent.includes("Файлы останутся в проекте"), "подтверждение на месте");
    assert.equal(calls.some(([m]) => m === "detachRepository"), false, "до подтверждения ничего не отвязано");
    press(repo("acme/site"), "Да, отвязать");
    await app.until(() => calls.some(([m]) => m === "detachRepository"), "отвязка");
    assert.deepEqual(calls.find(([m]) => m === "detachRepository"), ["detachRepository", "one", "github-app-11", "101", 4]);
  } finally { app.dispose(); }
});

test("«Репозитории»: администратор отключает внутреннее хранилище с предупреждением; ключ GitLab — в «Дополнительно»", async () => {
  const calls = [];
  const { app, page, press } = await mount(calls, { admin: true });
  try {
    const internal = () => page().querySelector('[data-source="internal"]');
    press(internal(), "Отключить");
    await app.until(() => internal().textContent.includes("выключится для всей организации"), "предупреждение");
    press(internal(), "Да, отключить");
    await app.until(() => calls.some(([m]) => m === "disableInternalCodeHosting"), "отключение");
    assert.deepEqual(calls.find(([m]) => m === "disableInternalCodeHosting"), ["disableInternalCodeHosting", 3]);

    const sources = page().querySelector('[aria-label="Источники"]');
    press(sources, "Дополнительно");
    await app.until(() => sources.querySelector('[aria-label="Подключить GitLab или свой сервер"]'), "форма ключа");
    const form = sources.querySelector('[aria-label="Подключить GitLab или свой сервер"]');
    assert.equal(form.querySelectorAll("select").length, 0, "служба выбирается чипами");
    press(form, "Свой сервер GitLab");
    await app.until(() => form.querySelector('input[aria-label="Адрес сервера GitLab"]'), "адрес своего сервера");
    app.type(form.querySelector('input[aria-label="Адрес сервера GitLab"]'), "https://git.company.ru/");
    app.type(form.querySelector('input[aria-label="Название подключения"]'), "Код компании");
    app.type(form.querySelector('input[aria-label="Ключ доступа"]'), "glpat-secret");
    press(form, "Подключить");
    await app.until(() => calls.some(([m]) => m === "executeGitRegistrationIntent"), "ключ отправлен");
    assert.deepEqual(calls.find(([m]) => m === "saveGitRegistrationIntent")[1], { provider: "gitlab", api_base: "https://git.company.ru/api/v4", name: "Код компании" });
  } finally { app.dispose(); }
});

test("Страница проекта: «Репозиторий: … · Файлы: … · Агенты кода: …» тем же языком", async () => {
  const app = await mountMemoryApp({ ...methods([]), async listProjectRepositories(project) { return { records: project === "one" ? [SITE] : [] }; } }, { section: "projects", project: "one" });
  try {
    await app.until(() => app.document.querySelector("[data-project-repository]"), "строка репозитория на странице проекта");
    const line = app.document.querySelector("[data-project-repository]").textContent;
    assert.match(line, /Репозиторий: acme\/site.*Файлы: синхронизировано .*312 файлов.*Агенты кода: включены/);
  } finally { app.dispose(); }
});

test("Люди: до удаления — честный текст; «Передать…» — у бывшего сотрудника, связи продолжают работать", async () => {
  const calls = [];
  const app = await mountMemoryApp({
    async listPeople() { return { users: [{ userName: "bob", displayName: "Боб", active: true }, { userName: "carol", displayName: "Кэрол", active: true }, { userName: "dan", displayName: "Дэн", active: false }] }; },
    async readGitOwnership(person) { calls.push(["readGitOwnership", person]); return calls.some(([m]) => m === "transferGitOwnership") ? { connections: [], links: [] } : { connections: [{ connection_id: "github-app-11", provider: "github", name: "GitHub · acme", account_login: "acme", installation_id: "11" }], links: [SITE] }; },
    async transferGitOwnership(person, to) { calls.push(["transferGitOwnership", person, to]); return { connections: 1, links: 1, installations: 1 }; },
  }, { section: "people" });
  try {
    const root = () => app.document.querySelector("#root");
    await app.until(() => app.buttons().some(b => b.getAttribute("aria-label") === "Открыть карточку: Боб"), "люди");
    app.buttons().find(b => b.getAttribute("aria-label") === "Открыть карточку: Боб").click();
    await app.until(() => app.button("Удалить из организации"), "карточка");
    app.button("Удалить из организации").click();
    const before = () => root().querySelector('[aria-label="Подтверждение удаления: Боб"] [aria-label="Источники кода сотрудника"]');
    await app.until(() => before()?.textContent.includes("После удаления администратор передаст его источники"), "честный текст до удаления");
    assert.equal([...before().querySelectorAll("button")].some(b => b.textContent === "Передать…"), false, "до удаления передавать нечего: сервер передаёт только от ушедшего");
    // Бывший сотрудник: блок «Передать…».
    const former = () => root().querySelector('[aria-label="Бывшие сотрудники"]');
    await app.until(() => former()?.querySelector('[aria-label="Источники кода сотрудника"]'), "источники бывшего сотрудника");
    const block = () => former().querySelector('[aria-label="Источники кода сотрудника"]');
    assert.ok(block().textContent.includes("GitHub · acme — через приложение") && block().textContent.includes("acme/site → проект «Общий проект»"), block().textContent);
    [...block().querySelectorAll("button")].find(b => b.textContent === "Передать…").click();
    await app.until(() => block().querySelector('[aria-label="Новый владелец"]'), "выбор человека");
    assert.equal(block().querySelectorAll("select").length, 0, "человек выбирается строкой, не списком");
    assert.equal([...block().querySelectorAll('[role="radio"]')].some(b => b.textContent.includes("Дэн")), false, "бывшему сотруднику не передают");
    [...block().querySelectorAll('[role="radio"]')].find(b => b.textContent.includes("Кэрол")).click();
    await app.until(() => [...block().querySelectorAll("button")].some(b => b.textContent === "Передать: Кэрол"), "кнопка называет человека");
    [...block().querySelectorAll("button")].find(b => b.textContent === "Передать: Кэрол").click();
    await app.until(() => calls.some(([m]) => m === "transferGitOwnership"), "передача");
    assert.deepEqual(calls.find(([m]) => m === "transferGitOwnership"), ["transferGitOwnership", "dan", "carol"]);
  } finally { app.dispose(); }
});

test("Страница проекта без кода: «Подключить внутреннее хранилище кода» из уже загруженных файлов", async () => {
  const calls = [];
  let connected = false;
  const REFUSAL = "Файлы проекта нельзя положить в хранилище кода: 3 файлов ещё обрабатываются после загрузки — повторите через несколько минут.";
  const app = await mountMemoryApp({ ...methods(calls),
    async listProjectRepositories() { return { records: connected ? [{ ...INTERNAL, project_id: "one", repository_name: "projects/shared" }] : [] }; },
    async connectCodeFromFiles(project) {
      calls.push(["connectCodeFromFiles", project]);
      if (calls.filter(([m]) => m === "connectCodeFromFiles").length === 1) return { repository: null, reason: REFUSAL };
      connected = true;
      return { repository: { connection_id: "internal-code", repository_id: "88", repository_name: "projects/shared", commit_sha: "e".repeat(40), files: 2, commits: 1, skipped_count: 1, skipped: [{ path: "node_modules/x.js", reason: "path" }] } };
    },
  }, { section: "projects", project: "one" });
  try {
    const block = () => app.document.querySelector("[data-connect-code]");
    await app.until(() => block(), "предложение подключить код видно без вопроса агенту");
    assert.ok(block().textContent.includes("В проекте 2 файла") && block().textContent.includes("первая версия — из текущих файлов"), block().textContent);
    assert.equal(block().querySelectorAll("select").length, 0, "без выпадающих списков");
    const press = () => [...block().querySelectorAll("button")].find(b => b.textContent === "Подключить внутреннее хранилище кода").click();
    press();
    await app.until(() => block()?.textContent.includes("ещё обрабатываются"), "отказ с понятной причиной");
    await app.until(() => [...block().querySelectorAll("button")].some(b => b.textContent === "Подключить внутреннее хранилище кода" && !b.disabled), "кнопка снова доступна");
    press();
    await app.until(() => app.document.querySelector("[data-code-connected]"), "итог подключения");
    assert.deepEqual(calls.filter(([m]) => m === "connectCodeFromFiles"), [["connectCodeFromFiles", "one"], ["connectCodeFromFiles", "one"]]);
    const done = app.document.querySelector("[data-code-connected]").textContent;
    assert.ok(done.includes("2 файла в репозитории projects/shared") && done.includes("Агенты кода включены") && done.includes("Не перенесено 1 (служебные папки 1)"), done);
    await app.until(() => app.document.querySelector("[data-project-repository]")?.textContent.includes("Агенты кода: включены"), "то же состояние, что у подключённых репозиториев");
    assert.equal(block(), null, "предложение ушло");
  } finally { app.dispose(); }
});

test("«Репозитории»: доступ того, кто держит агентов, отозван в GitHub — строка говорит об этом, а не молчит", async () => {
  const calls = [];
  const { app, repo, page } = await mount(calls, { records: [{ ...SITE, agents_access_revoked: true }, INTERNAL] });
  try {
    await app.until(() => repo("acme/site").textContent.includes("доступ отозван в GitHub — агенты не работают"), "агенты с отозванным доступом");
    await app.until(() => page().querySelector("[data-ledger]")?.textContent.includes("требуют внимания: 1"), "в счёте внимания");
  } finally { app.dispose(); }
});

test("«Поделиться»: в проекте приватный код — понятный вопрос и повтор с подтверждением", async () => {
  const calls = [];
  const CONSENT_TEXT = "Код приватного репозитория увидят все, кому открыт проект. Подтвердите это.";
  const app = await mountMemoryApp({
    async setProjectVisibility(project, level, canEdit, consent) {
      calls.push([project, level, canEdit, consent]);
      if (!consent) throw new Error(CONSENT_TEXT);
      return { project_id: project, visibility: level, can_edit: canEdit, applied: true };
    },
  }, { section: "projects", project: "one" });
  try {
    await app.until(() => app.button("Поделиться"), "кнопка");
    app.button("Поделиться").click();
    const panel = () => app.document.querySelector('#root section[aria-label="Поделиться проектом"]');
    await app.until(() => panel(), "панель");
    panel().querySelector('input[value="department"]').click();
    await app.until(() => ![...panel().querySelectorAll("button")].find(b => b.textContent === "Сохранить").disabled, "есть что сохранять");
    [...panel().querySelectorAll("button")].find(b => b.textContent === "Сохранить").click();
    await app.until(() => panel().querySelector("[data-private-code-consent]"), "вопрос о приватном коде");
    assert.ok(panel().textContent.includes("Код приватного репозитория увидят все сотрудники отдела"), panel().textContent);
    assert.equal(panel().textContent.includes("Не получилось поделиться"), false, "не общий отказ");
    [...panel().querySelectorAll("button")].find(b => b.textContent === "Понимаю, открыть").click();
    await app.until(() => panel().textContent.includes("Готово: проект открыт"), "открыт с подтверждением");
    assert.deepEqual(calls, [["one", "department", false, false], ["one", "department", false, true]]);
  } finally { app.dispose(); }
});

test("«Поделиться»: приватный код всей организации — только администратор, сказано словами", async () => {
  const app = await mountMemoryApp({ async setProjectVisibility() { throw new Error("Приватный код открывает всей организации только администратор."); } }, { section: "projects", project: "one" });
  try {
    await app.until(() => app.button("Поделиться"), "кнопка");
    app.button("Поделиться").click();
    const panel = () => app.document.querySelector('#root section[aria-label="Поделиться проектом"]');
    await app.until(() => panel(), "панель");
    panel().querySelector('input[value="organization"]').click();
    await app.until(() => ![...panel().querySelectorAll("button")].find(b => b.textContent === "Сохранить").disabled, "есть что сохранять");
    [...panel().querySelectorAll("button")].find(b => b.textContent === "Сохранить").click();
    await app.until(() => panel().textContent.includes("всей организации его открывает только администратор"), "отказ словами");
  } finally { app.dispose(); }
});

test("«Репозитории»: репозиторий по ключу без ответа о приватности считается приватным — в проект отдела только с подтверждением", async () => {
  const calls = [];
  const { app, repo, press } = await mount(calls, { methods: {
    async listGitConnections() { return { connections: [{ connection_id: "key-1", owner_id: "alice", provider: "gitlab", api_base: "https://gitlab.example/api/v4", account_id: "5", account_login: "team", name: "GitLab компании", revision: 1, enabled: true }] }; },
    async listGitRepositories() { return { repositories: [{ id: "900", name: "team/secret", default_branch: "main" }, { id: "901", name: "team/open", default_branch: "main", public: true }] }; },
    async listProjects() { return { projects: [{ id: "one", name: "Общий проект", slug: "shared", visibility: "department" }, { id: "two", name: "Второй проект", slug: "second", visibility: "department" }] }; },
  } }, 6);
  try {
    assert.match(repo("team/secret").textContent, /приватный/);
    assert.match(repo("team/open").textContent, /публичный/);
    press(repo("team/secret"), "Добавить в проект…");
    await app.until(() => repo("team/secret").querySelector('[aria-label="Проект"] [role="radio"]'), "проекты");
    const form = repo("team/secret");
    [...form.querySelectorAll('[aria-label="Проект"] [role="radio"]')].find(b => b.textContent.includes("Второй проект")).click();
    await app.until(() => form.querySelector('input[type="checkbox"]'), "подтверждение для приватного кода");
    assert.equal(form.querySelector("button[data-submit]").disabled, true, "без подтверждения не добавить");
    form.querySelector('input[type="checkbox"]').click();
    await app.until(() => !form.querySelector("button[data-submit]").disabled, "подтверждено");
    form.querySelector("button[data-submit]").click();
    await app.until(() => calls.some(([m]) => m === "addRepository"), "добавление");
    const input = calls.find(([m]) => m === "addRepository")[1];
    assert.deepEqual({ source: input.source, connection_id: input.connection_id, consent: input.consent }, { source: "connection", connection_id: "key-1", consent: true });
  } finally { app.dispose(); }
});

test("«Репозитории»: сервер знает о приватности больше строки — его «подтвердите» включает вопрос, повтор с подтверждением", async () => {
  const calls = [];
  const { app, repo, press } = await mount(calls, { addError: CONSENT });
  try {
    press(repo("acme/notes"), "Добавить в проект…");
    await app.until(() => repo("acme/notes").querySelector('[aria-label="Проект"] [role="radio"]'), "проекты");
    const form = repo("acme/notes");
    form.querySelector('[aria-label="Проект"] [role="radio"]').click();
    await app.until(() => !form.querySelector("button[data-submit]").disabled, "проект выбран");
    assert.equal(form.querySelector('input[type="checkbox"]'), null, "публичный по строке — без вопроса");
    form.querySelector("button[data-submit]").click();
    await app.until(() => form.querySelector('input[type="checkbox"]'), "вопрос после ответа сервера");
    assert.equal(form.textContent.includes(CONSENT), false, "не ошибка, а вопрос");
    form.querySelector('input[type="checkbox"]').click();
    await app.until(() => !form.querySelector("button[data-submit]").disabled, "подтверждено");
    form.querySelector("button[data-submit]").click();
    await app.until(() => calls.filter(([m]) => m === "addRepository").length === 2, "повтор");
    assert.deepEqual(calls.filter(([m]) => m === "addRepository").map(c => c[1].consent), [undefined, true]);
  } finally { app.dispose(); }
});

test("Страница проекта: репозиторий только с «Файлами» виден кодом и строкой тем же языком", async () => {
  const app = await mountMemoryApp({ ...methods([]),
    async listProjectRepositories(project) { return { records: project === "one" ? [{ ...SITE, agents: false }] : [] }; },
    async listProjectGitRepositories(project) { return { repositories: project === "one" ? [{ project_id: "one", connection_id: "github-app-11", repository_id: "101", repository_name: "acme/site", revision: 4, enabled: false, files: true, provider: "github", connection_revision: 1 }] : [] }; },
    async listGitTree() { return { entries: [] }; },
  }, { section: "projects", project: "one" });
  try {
    await app.until(() => app.document.querySelector("[data-project-repository]"), "строка репозитория");
    assert.match(app.document.querySelector("[data-project-repository]").textContent, /Репозиторий: acme\/site.*Файлы: синхронизировано.*Агенты кода: выключены/);
    await app.until(() => app.document.querySelector('#root section[aria-label="Код"]'), "раздел «Код» для репозитория с файлами");
  } finally { app.dispose(); }
});

test("«Входящие»: одобрение запроса на отдел, когда в проекте появился приватный код, — вопрос и «Понимаю, разрешить»", async () => {
  const REQUEST = { request_id: "0f3c9a2e-5b7d-4e1a-9c3b-2d4e6f8a0b1c", project_id: "one", project_name: "Общий проект", level: "department", can_edit: false, org_unit_id: "u1", org_unit_name: "Продажи",
    requested_by: "anna", requested_by_name: "Анна", decider: "head", status: "pending", created_at: "2026-09-24T10:00:00Z" };
  const calls = [];
  let decided = false;
  const app = await mountMemoryApp({
    async listShareRequests(mine) { return { requests: mine || decided ? [] : [REQUEST] }; },
    async decideShareRequest(id, approve, consent) {
      calls.push([id, approve, consent]);
      if (!consent) throw new Error("Код приватного репозитория увидят все, кому открыт проект. Подтвердите это.");
      decided = true;
      return { ...REQUEST, status: "approved" };
    },
  });
  try {
    const card = () => [...app.document.querySelectorAll("#root [data-inbox]")].find(c => c.dataset.inbox === "share");
    await app.until(() => card(), "карточка запроса");
    card().querySelector("button").click();
    await app.until(() => [...card().querySelectorAll("button")].some(b => b.textContent === "Разрешить"), "кнопка решения");
    [...card().querySelectorAll("button")].find(b => b.textContent === "Разрешить").click();
    const alert = () => app.document.querySelector("#root [data-private-code-approval]");
    await app.until(() => alert(), "вопрос о приватном коде");
    assert.ok(alert().textContent.includes("увидят все сотрудники отдела"), alert().textContent);
    assert.equal(app.text().includes("Решение не записано"), false, "не общий отказ");
    [...alert().querySelectorAll("button")].find(b => b.textContent === "Понимаю, разрешить").click();
    await app.until(() => app.text().includes("Проект «Общий проект» открыт"), "одобрено с подтверждением");
    assert.deepEqual(calls, [[REQUEST.request_id, true, false], [REQUEST.request_id, true, true]]);
  } finally { app.dispose(); }
});
