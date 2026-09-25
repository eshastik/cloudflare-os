import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

const ago = hours => new Date(Date.now() - hours * 3600e3).toISOString();
const REPOS = [
  { installation_id: "11", id: "101", name: "acme/site", default_branch: "main", private: true, account: "acme", pushed_at: ago(0.05), language: "TypeScript" },
  { installation_id: "11", id: "102", name: "acme/billing", default_branch: "trunk", private: true, account: "acme", pushed_at: ago(26), language: "Go" },
  { installation_id: "12", id: "201", name: "alice/notes", default_branch: "develop", private: false, account: "alice", pushed_at: ago(24 * 9), language: null },
];
const LINK = { link_id: "l1", project_id: "one", source: "app", connection_id: "", installation_id: "11", repository_id: "101", repository_name: "acme/site", branch: "main", folder: "", include: [], exclude: [],
  visibility: "private", state: "ok", message: "", last_synced_sha: "a", last_synced_at: ago(0.03), report: {}, revision: 4, can_manage: true, file_count: 312 };

function github(calls, extra = {}) {
  return {
    async listGitSyncLinks() { return { links: calls.some(([m]) => m === "deleteGitSyncLink") ? [] : [LINK, ...(extra.links ?? [])] }; },
    async listGitHubAccounts() { return { available: true, connectable: true, accounts: [{ installation_id: "11", github_login: "alice", account_login: "acme", account_type: "Organization", repository_selection: "all", linked_at: "", repository_count: -1, manage_url: "https://github.com/x" }] }; },
    async listGitAppRepositories() { return { available: true, repositories: REPOS }; },
    async listGitConnections() { return { connections: [] }; },
    async createProjectFromRepository(input) { calls.push(["createProjectFromRepository", input]); return { project: { id: "p-new", name: input.name }, link: { ...LINK, link_id: "l2", project_id: "p-new", state: "pending", file_count: 0, message: "" } }; },
    async createGitSyncLink(input) { calls.push(["createGitSyncLink", input]); return { ...LINK, link_id: "l3", project_id: input.project_id, state: "pending", message: "" }; },
    async refreshGitSyncLink(id) { calls.push(["refreshGitSyncLink", id]); return { queued: true }; },
    async deleteGitSyncLink(id, revision) { calls.push(["deleteGitSyncLink", id, revision]); return { deleted: true }; },
    ...extra.methods,
  };
}

async function mount(calls, extra) {
  const app = await mountMemoryApp(github(calls, extra), { section: "connections", githubReturn: { result: "updated", reason: "" } });
  const block = () => app.document.querySelector('#root section[aria-label="Синхронизация с GitHub"]');
  const repo = name => block()?.querySelector(`[data-repo="${name}"]`);
  const press = (root, name) => { const b = [...root.querySelectorAll("button")].find(x => x.textContent === name); assert.ok(b, `кнопка «${name}»`); b.click(); };
  await app.until(() => block()?.querySelectorAll("[data-repo]").length === 3, "репозитории строками");
  return { app, block, repo, press };
}

test("GitHub: репозитории списком — имя, аккаунт, приватность, язык, давность; у связанного — проект и состояние", async () => {
  const calls = [];
  const { app, block, repo, press } = await mount(calls);
  try {
    assert.equal(block().querySelector("select"), null, "ни одного выпадающего списка");
    assert.deepEqual([...block().querySelectorAll("[data-repo]")].map(r => r.dataset.repo), ["acme/site", "acme/billing", "alice/notes"], "связанные сверху, дальше по свежести");
    assert.match(repo("acme/billing").textContent, /billing · acme.*приватный · Go · изменён вчера/);
    assert.match(repo("alice/notes").textContent, /публичный/);
    const site = repo("acme/site").textContent;
    assert.ok(site.includes("В проекте «Общий проект»") && site.includes("синхронизирован") && site.includes("312 файлов"), site);
    assert.equal([...repo("acme/site").querySelectorAll("button")].some(b => b.textContent === "Создать проект"), false, "у связанного нет «Создать проект»");

    press(repo("acme/site"), "Обновить сейчас");
    await app.until(() => calls.some(([m]) => m === "refreshGitSyncLink"), "обновление");
    press(repo("acme/site"), "Открыть проект");
    await app.until(() => app.calls.some(([m, s, p]) => m === "openSection" && s === "projects" && p === "one"), "переход в проект");
  } finally { app.dispose(); }
});

test("GitHub: «Отвязать» — с подтверждением в строке", async () => {
  const calls = [];
  const { app, repo, press } = await mount(calls);
  try {
    press(repo("acme/site"), "Отвязать");
    await app.until(() => repo("acme/site").textContent.includes("Файлы останутся в проекте"), "подтверждение на месте");
    assert.equal(calls.some(([m]) => m === "deleteGitSyncLink"), false, "до подтверждения ничего не отвязано");
    press(repo("acme/site"), "Да, отвязать");
    await app.until(() => calls.some(([m]) => m === "deleteGitSyncLink"), "отвязка");
    assert.deepEqual(calls.find(([m]) => m === "deleteGitSyncLink"), ["deleteGitSyncLink", "l1", 4]);
  } finally { app.dispose(); }
});

test("GitHub: «Создать проект» — имя репозитория правится в строке, видимость чипами, после — переход в новый проект", async () => {
  const calls = [];
  const { app, repo, press } = await mount(calls);
  try {
    press(repo("acme/billing"), "Создать проект");
    await app.until(() => repo("acme/billing").querySelector('input[aria-label="Название проекта"]'), "форма в строке");
    const form = repo("acme/billing");
    assert.equal(form.querySelector('input[aria-label="Название проекта"]').value, "billing", "по умолчанию — имя репозитория");
    const chips = [...form.querySelectorAll('[role="radio"]')];
    assert.deepEqual(chips.map(c => c.textContent), ["Только я", "Мой отдел", "Вся организация"]);
    assert.equal(chips[0].getAttribute("aria-checked"), "true", "по умолчанию «Только я»");
    assert.equal(form.querySelector('input[aria-label="Ветка"]'), null, "ветка свёрнута в «Дополнительно»");
    app.type(form.querySelector('input[aria-label="Название проекта"]'), "Биллинг 2");
    chips[1].click();
    await app.until(() => chips[1].getAttribute("aria-checked") === "true", "выбран отдел");
    form.querySelector("button[data-submit]").click();
    await app.until(() => calls.some(([m]) => m === "createProjectFromRepository"), "создание");
    const input = calls.find(([m]) => m === "createProjectFromRepository")[1];
    assert.deepEqual({ name: input.name, visibility: input.visibility, branch: input.branch, folder: input.folder, source: input.source, installation_id: input.installation_id, repository_id: input.repository_id },
      { name: "Биллинг 2", visibility: "department", branch: "trunk", folder: "", source: "app", installation_id: "11", repository_id: "102" }, "ветка — по умолчанию репозитория, не main");
    await app.until(() => app.calls.some(([m, s, p]) => m === "openSection" && s === "projects" && p === "p-new"), "переход в новый проект");
  } finally { app.dispose(); }
});

test("GitHub: «Добавить в проект…» — проект поиском, папка по умолчанию — имя репозитория; «Дополнительно» — ветка и шаблоны чипами", async () => {
  const calls = [];
  const { app, repo, press } = await mount(calls);
  try {
    press(repo("alice/notes"), "Добавить в проект…");
    await app.until(() => repo("alice/notes").querySelector('input[aria-label="Найти проект"]'), "поиск проекта");
    const form = repo("alice/notes");
    const submit = () => form.querySelector("button[data-submit]");
    assert.equal(submit().disabled, true, "без проекта отправить нельзя");
    assert.equal(submit().textContent, "Выберите проект");
    app.type(form.querySelector('input[aria-label="Найти проект"]'), "втор");
    await app.until(() => form.querySelectorAll('[aria-label="Проект"] [role="radio"]').length === 1, "поиск сузил список");
    form.querySelector('[aria-label="Проект"] [role="radio"]').click();
    await app.until(() => submit().textContent === "Добавить в «Второй проект»", "кнопка называет проект");
    assert.equal(form.querySelector('input[aria-label="Папка в проекте"]').placeholder, "notes");

    press(form, "Дополнительно");
    await app.until(() => form.querySelector('input[aria-label="Ветка"]'), "дополнительно раскрыто");
    assert.equal(form.querySelector('input[aria-label="Ветка"]').value, "develop", "ветка по умолчанию из GitHub");
    const skip = form.querySelector('[role="group"][aria-label="Пропускать"]');
    for (const hint of ["tests/**", "*.lock", "node_modules/**", "dist/**"]) assert.ok([...skip.querySelectorAll("button")].some(b => b.textContent === hint), `подсказка ${hint}`);
    press(skip, "tests/**");
    await app.until(() => skip.textContent.includes("Убрать") || skip.querySelector('[aria-label="Убрать tests/**"]'), "шаблон стал чипом");
    const own = form.querySelector('input[aria-label="Брать только: свой шаблон"]');
    app.type(own, "docs/**");
    own.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await app.until(() => form.querySelector('[aria-label="Убрать docs/**"]'), "свой шаблон по Enter");
    assert.ok(form.textContent.includes("Двоичные файлы и файлы больше 1 МБ не переносятся."));

    submit().click();
    await app.until(() => calls.some(([m]) => m === "createGitSyncLink"), "связь заведена");
    const input = calls.find(([m]) => m === "createGitSyncLink")[1];
    assert.deepEqual({ project: input.project_id, folder: input.folder, branch: input.branch, include: input.include, exclude: input.exclude, visibility: input.visibility },
      { project: "two", folder: "notes", branch: "develop", include: ["docs/**"], exclude: ["tests/**"], visibility: undefined }, "видимость чужого проекта не трогается");
  } finally { app.dispose(); }
});

test("GitHub: без права создавать проекты «Создать проект» не показывается, есть только «Добавить в проект…»", async () => {
  const calls = [];
  const { app, block } = await mount(calls, { methods: {
    async whoAmI() { return { subject: { tenant_id: "org", user_id: "bob" }, tenant_name: "Пример", capabilities: [], roles: { can_create_projects: false } }; },
  } });
  try {
    // Кто спрашивает, известно после чтения личности: ждём её и только потом проверяем отсутствие кнопки.
    await app.until(() => app.calls.length >= 0 && block().querySelector("[data-repo]"), "строки");
    await new Promise(resolve => setTimeout(resolve, 300));
    const labels = [...block().querySelectorAll("[data-repo] button")].map(b => b.textContent);
    assert.equal(labels.includes("Создать проект"), false, labels.join(", "));
    assert.ok(labels.includes("Добавить в проект…"));
  } finally { app.dispose(); }
  // Право по правилу «Кто создаёт проекты» — без тенантного полномочия.
  const again = await mount([], { methods: {
    async whoAmI() { return { subject: { tenant_id: "org", user_id: "carol" }, tenant_name: "Пример", capabilities: [], roles: { can_create_projects: true } }; },
  } });
  try {
    await again.app.until(() => [...again.block().querySelectorAll("[data-repo] button")].some(b => b.textContent === "Создать проект"), "право по правилу организации");
  } finally { again.app.dispose(); }
});

test("GitHub: связь в работе показывает ход и перечитывается сама; ошибка — словами", async () => {
  const calls = [];
  const { app, repo } = await mount(calls, { links: [
    { ...LINK, link_id: "l5", repository_id: "102", repository_name: "acme/billing", project_id: "two", state: "syncing", file_count: 40, last_synced_at: "" },
    { ...LINK, link_id: "l6", repository_id: "201", repository_name: "alice/notes", project_id: "two", state: "error", message: "GitHub не отдал архив ветки." },
  ] });
  try {
    assert.ok(repo("acme/billing").textContent.includes("идёт синхронизация · уже 40 файлов"));
    assert.ok(repo("alice/notes").textContent.includes("GitHub не отдал архив ветки."));
  } finally { app.dispose(); }
});
