import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

const MAIN = "1".repeat(40), AGENT = "2".repeat(40);
const repo = { project_id: "one", connection_id: "internal-code", repository_id: "1", repository_name: "mnemos/mnemos", revision: 1, enabled: true, provider: "gitea", connection_revision: 1 };
const BRANCH = "agents/binding/0123456789abcdef";

function taskView(state, extra = {}) {
  return { task_id: "0123456789abcdef", project_id: "one", connection_id: "internal-code", repository_id: "1", repository_name: "mnemos/mnemos", title: "Добавь строку в docs/check.md", prompt: "Добавь строку в docs/check.md", branch: BRANCH, state, reason: "", cost_usd: 0.021, created_at: "2026-09-23T10:00:00Z", finished_at: "", ...extra };
}
const steps = [
  { id: "clone", kind: "clone", text: "Готовлю рабочее место и клонирую репозиторий", status: "done" },
  { id: "k1", kind: "read", text: "Читаю docs/check.md", status: "done" },
  { id: "k2", kind: "push", text: "Отправил изменения в свою ветку", status: "done" },
];

function methods(calls, { available = true, tasks = [] } = {}) {
  const state = { tasks: [...tasks] };
  return {
    async listProjectGitRepositories(project) { return { repositories: project === "one" ? [repo] : [] }; },
    async workspaceAvailable() { return available; },
    async listWorkspaceTasks(project) { calls.push(["listWorkspaceTasks", project]); return { tasks: state.tasks.filter(t => t.project_id === project) }; },
    async startWorkspaceTask(project, connection, repository, prompt) {
      calls.push(["startWorkspaceTask", project, connection, repository, prompt]);
      const task = taskView("starting", { title: prompt.split("\n")[0], prompt });
      state.tasks.unshift(task); return task;
    },
    async readWorkspaceTask(project, id) {
      calls.push(["readWorkspaceTask", project, id]);
      const task = state.tasks.find(t => t.task_id === id);
      return { task: { ...task, state: task.state === "starting" ? "idle" : task.state }, steps: task.state === "stopped" ? [] : steps, answer: task.state === "stopped" ? "" : "Готово: строка добавлена." };
    },
    async abortWorkspaceTask(project, id) { calls.push(["abortWorkspaceTask", project, id]); state.tasks = state.tasks.map(t => t.task_id === id ? { ...t, state: "stopped", reason: "остановлена человеком" } : t); },
    async messageWorkspaceTask(project, id, text) { calls.push(["messageWorkspaceTask", project, id, text]); },
    async listGitBranches() { return { repository_id: "1", branches: [{ name: "main", sha: MAIN }, { name: BRANCH, sha: AGENT }] }; },
    async readGitCommit(p, c, r, ref) { return { repository_id: "1", sha: ref, message: "Коммит", committed_at: "2026-09-23T10:00:00Z", parents: [] }; },
    async readGitTree(p, c, r, commit, path) { return { repository_id: "1", commit_sha: commit, path, entries: [], truncated: false }; },
    async compareGitRefs(p, c, r, base, head) {
      calls.push(["compareGitRefs", base, head]);
      return { repository_id: "1", base, head, total_commits: 1, commits: [], commits_truncated: false, files: [{ path: "docs/check.md", status: "modified", additions: 1, deletions: 0 }], files_complete: true, diff: "diff --git a/docs/check.md b/docs/check.md\n@@ -1 +1,2 @@\n Строка\n+Строка агента", diff_truncated: false };
    },
  };
}
const anyButton = (app, name) => [...app.document.querySelectorAll("button")].find(b => b.textContent === name);

test("Задачи агентов: пустое состояние и поручение через диалог с лентой шагов и ответом", async () => {
  const calls = [];
  const app = await mountMemoryApp(methods(calls), { section: "projects", project: "one" });
  try {
    await app.until(() => app.tab("Задачи агентов"), "вкладка задач"); app.tab("Задачи агентов").click();
    await app.until(() => app.text().includes("Здесь появятся задачи"), "пустое состояние");
    await app.until(() => app.button("Поручить агенту") && !app.button("Поручить агенту").disabled, "кнопка доступна");
    app.button("Поручить агенту").click();
    await app.until(() => app.document.querySelector('textarea[aria-label="Текст задачи"]'), "диалог открыт");
    assert.equal(anyButton(app, "Поручить").disabled, true, "без текста поручить нельзя");
    app.type(app.document.querySelector('textarea[aria-label="Текст задачи"]'), "Добавь строку в docs/check.md\nи отправь ветку");
    await app.until(() => !anyButton(app, "Поручить").disabled, "текст введён");
    anyButton(app, "Поручить").click();
    await app.until(() => app.document.querySelector('ol[aria-label="Шаги агента"]'), "лента шагов");
    assert.deepEqual(calls.find(c => c[0] === "startWorkspaceTask"), ["startWorkspaceTask", "one", "internal-code", "1", "Добавь строку в docs/check.md\nи отправь ветку"]);
    const shown = [...app.document.querySelectorAll('ol[aria-label="Шаги агента"] li')].map(li => li.textContent);
    assert.deepEqual(shown, steps.map(s => s.text));
    assert.ok(app.document.querySelector('[aria-label="Ответ агента"]').textContent.includes("строка добавлена"));
    const row = app.document.querySelector("#root [data-task]");
    assert.ok(row.textContent.includes("Добавь строку в docs/check.md") && row.textContent.includes("Готово") && row.textContent.includes("$0,02"));
  } finally { app.dispose(); }
});

test("Задачу можно остановить, а её изменения показать во вкладке «Код»", async () => {
  const calls = [];
  const app = await mountMemoryApp(methods(calls, { tasks: [taskView("running")] }), { section: "projects", project: "one" });
  try {
    await app.until(() => app.tab("Задачи агентов"), "вкладка задач"); app.tab("Задачи агентов").click();
    await app.until(() => app.button("Остановить"), "задача в работе");
    app.button("Остановить").click();
    await app.until(() => app.text().includes("Остановлена"), "задача остановлена");
    assert.deepEqual(calls.find(c => c[0] === "abortWorkspaceTask"), ["abortWorkspaceTask", "one", "0123456789abcdef"]);
    assert.equal(app.button("Остановить"), undefined, "остановленную задачу не остановить повторно");
    app.button("Показать изменения").click();
    await app.until(() => app.document.querySelector('section[aria-label="Изменения по строкам"] pre'), "сравнение ветки задачи");
    assert.deepEqual(calls.find(c => c[0] === "compareGitRefs"), ["compareGitRefs", "main", BRANCH]);
    assert.equal(app.tab("Код").getAttribute("aria-selected"), "true");
  } finally { app.dispose(); }
});

test("Без настройки рабочих мест кнопка поручения неактивна и объясняет причину", async () => {
  const calls = [];
  const app = await mountMemoryApp(methods(calls, { available: false }), { section: "projects", project: "one" });
  try {
    await app.until(() => app.tab("Задачи агентов"), "вкладка задач"); app.tab("Задачи агентов").click();
    const reason = () => app.button("Поручить агенту")?.closest("[data-reason]")?.getAttribute("title");
    await app.until(reason, "подсказка на кнопке");
    assert.equal(app.button("Поручить агенту").disabled, true);
    assert.match(reason(), /не настроены/);
    app.tab("Код").click();
    await app.until(() => app.tab("Код").getAttribute("aria-selected") === "true" && app.document.querySelector('select[aria-label="Версия кода"]') && reason(), "кнопка во вкладке кода");
    assert.equal(app.button("Поручить агенту").disabled, true);
  } finally { app.dispose(); }
});

test("Вкладка проекта адресуема: view из адреса открывает её, переключение записывает view", async () => {
  const calls = [];
  const code = await mountMemoryApp(methods(calls), { section: "projects", project: "one", view: "code" });
  try {
    await code.until(() => code.tab("Код")?.getAttribute("aria-selected") === "true", "вкладка кода по ссылке");
    code.tab("Задачи агентов").click();
    await code.until(() => code.calls.some(c => c[0] === "selectView" && c[1] === "tasks"), "адрес обновлён");
    code.tab("Участники").click();
    await code.until(() => code.calls.some(c => c[0] === "selectView" && c[1] === "members"), "участники в адресе как members");
  } finally { code.dispose(); }
  const members = await mountMemoryApp(methods([]), { section: "projects", project: "one", view: "members" });
  try {
    await members.until(() => members.tab("Участники")?.getAttribute("aria-selected") === "true", "участники по ссылке");
  } finally { members.dispose(); }
  const unknown = await mountMemoryApp(methods([]), { section: "projects", project: "one", view: "nonsense" });
  try {
    await unknown.until(() => unknown.tab("Обзор")?.getAttribute("aria-selected") === "true", "неизвестная вкладка — обзор");
  } finally { unknown.dispose(); }
});

test("Перетаскивание файлов во фрейм сообщает оболочке, прочее перетаскивание — нет", async () => {
  const app = await mountMemoryApp(methods([]), { section: "projects", project: "one" });
  try {
    const drag = types => { const event = new app.dom.window.Event("dragenter", { bubbles: true }); Object.defineProperty(event, "dataTransfer", { value: { types } }); app.document.querySelector("#root").dispatchEvent(event); };
    drag(["text/plain"]);
    assert.equal(app.calls.some(c => c[0] === "dragEnter"), false, "текст не считается загрузкой файлов");
    drag(["Files"]); drag(["Files"]);
    assert.equal(app.calls.filter(c => c[0] === "dragEnter").length, 1, "повторы в одном жесте сливаются");
  } finally { app.dispose(); }
});
