import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

const MAIN = "1".repeat(40), AGENT = "2".repeat(40);
const repo = { project_id: "one", connection_id: "internal-code", repository_id: "1", repository_name: "mnemos/mnemos", revision: 1, enabled: true, provider: "gitea", connection_revision: 1 };
const diff = [
  "diff --git a/docs/check.md b/docs/check.md",
  "index 111..222 100644",
  "--- a/docs/check.md",
  "+++ b/docs/check.md",
  "@@ -1 +1,2 @@",
  "-Старая строка",
  "+Новая строка",
  "+Строка агента",
].join("\n");

function codeMethods(calls) {
  return {
    async listProjectGitRepositories(project) { return { repositories: project === "one" ? [repo] : [] }; },
    async listGitBranches() { return { repository_id: "1", branches: [{ name: "main", sha: MAIN }, { name: "agents/agent-alice/task-7", sha: AGENT }] }; },
    async readGitCommit(p, c, r, ref) { return { repository_id: "1", sha: ref, message: "Внутренний хостинг кода\n\nподробности", committed_at: "2026-09-23T10:00:00Z", parents: [] }; },
    async readGitTree(p, c, r, commit, path) {
      calls.push(["readGitTree", commit, path]);
      if (path === "services") return { repository_id: "1", commit_sha: commit, path, entries: [{ name: "go.mod", path: "services/go.mod", type: "file", size_bytes: 1126, sha: "a".repeat(40) }], truncated: false };
      return { repository_id: "1", commit_sha: commit, path: "", entries: [{ name: "README.md", path: "README.md", type: "file", size_bytes: 80, sha: "b".repeat(40) }, { name: "services", path: "services", type: "dir", size_bytes: 0, sha: "c".repeat(40) }], truncated: false };
    },
    async readGitFile(p, c, r, commit, path) { calls.push(["readGitFile", commit, path]); return { repository_id: "1", commit_sha: commit, path, blob_sha: "d".repeat(40), sha256: "e".repeat(64), size_bytes: 24, content: "module mnemos\n\ngo 1.25\n" }; },
    async compareGitRefs(p, c, r, base, head) {
      calls.push(["compareGitRefs", base, head]);
      return { repository_id: "1", base, head, total_commits: 1, commits: [], commits_truncated: false, files: [{ path: "docs/check.md", status: "modified", additions: 2, deletions: 1 }], files_complete: true, diff, diff_truncated: false };
    },
  };
}

test("Код проекта: дерево, папка, файл с номерами строк и возврат к списку", async () => {
  const calls = [];
  const app = await mountMemoryApp(codeMethods(calls), { section: "projects", project: "one" });
  try {
    await app.until(() => app.document.querySelector('#root section[aria-label="Код"]'), "блок кода у проекта с репозиторием");
    await app.until(() => app.button("services") && app.button("README.md"), "корень репозитория");
    const names = [...app.document.querySelectorAll('section[aria-label="Файлы репозитория"] [data-document], section[aria-label="Файлы репозитория"] button')].map(b => b.textContent);
    assert.ok(names.indexOf("services") < names.indexOf("README.md"), "папки выше файлов");
    assert.ok(app.text().includes("Внутренний хостинг кода ·") && !app.text().includes("1111111"), "последнее сохранение без хеша");
    assert.ok(calls.some(c => c[0] === "readGitTree" && c[1] === MAIN && c[2] === ""), "основная ветка по умолчанию");
    app.button("services").click();
    await app.until(() => app.button("go.mod"), "содержимое папки");
    assert.ok(app.document.querySelector('nav[aria-label="Путь"] [aria-current="location"]').textContent === "services", "путь в хлебных крошках");
    app.button("go.mod").click();
    await app.until(() => app.document.querySelector('[role="region"][aria-label="Файл services/go.mod"] table'), "файл открыт");
    const rows = [...app.document.querySelectorAll('[role="region"] tr')].map(tr => [...tr.children].map(td => td.textContent));
    assert.deepEqual(rows[0], ["1", "module mnemos"]);
    assert.equal(rows.length, 3);
    app.button("К списку файлов").click();
    await app.until(() => app.button("go.mod"), "вернулись в папку");
    app.button("mnemos").click();
    await app.until(() => app.button("README.md"), "корень через хлебные крошки");
  } finally { app.dispose(); }
});

test("Изменения агента сравниваются с основной версией: список файлов и дифф построчно", async () => {
  const calls = [];
  const app = await mountMemoryApp(codeMethods(calls), { section: "projects", project: "one" });
  try {
    await app.until(() => app.document.querySelector('#root section[aria-label="Код"]'), "блок кода");
    const agents = () => app.document.querySelector('#root section[aria-label="Изменения агентов"]');
    await app.until(() => agents()?.textContent.includes("Изменения агента № 1"), "изменения агентов по-человечески");
    const shown = el => { const copy = el.cloneNode(true); copy.querySelectorAll("[data-admin-details]").forEach(d => d.remove()); return copy.textContent; };
    assert.ok(!shown(agents()).includes("agents/"), "имя ветки — только в «Подробнее»");
    app.button("Показать изменения").click();
    await app.until(() => app.document.querySelector('section[aria-label="Изменения по строкам"] pre'), "дифф построен");
    assert.deepEqual(calls.find(c => c[0] === "compareGitRefs"), ["compareGitRefs", "main", "agents/agent-alice/task-7"]);
    const files = app.document.querySelector('#root section[aria-label="Изменённые файлы"]').textContent;
    assert.ok(files.includes("docs/check.md") && files.includes("+2") && files.includes("−1") && files.includes("Изменён"));
    const lines = [...app.document.querySelectorAll('section[aria-label="Изменения по строкам"] pre > div')];
    assert.ok(lines.find(l => l.textContent === "+Новая строка").className.includes("bg-kumo-success-tint"));
    assert.ok(lines.find(l => l.textContent === "-Старая строка").className.includes("bg-kumo-danger-tint"));
    assert.equal(lines.some(l => l.textContent.startsWith("+++") || l.textContent.startsWith("index ")), false, "служебные строки скрыты");
    app.button("К коду проекта").click();
    await app.until(() => agents(), "возврат к репозиторию");
  } finally { app.dispose(); }
});

test("Без привязанного репозитория блока «Код» нет: страница проекта — файлы, кто видит, согласование", async () => {
  const app = await mountMemoryApp(codeMethods([]), { section: "projects", project: "two" });
  try {
    await app.until(() => app.document.querySelector('#root section[aria-label="Кто видит"]'), "блоки проекта");
    assert.equal(app.document.querySelector('#root section[aria-label="Код"]'), null);
    assert.equal(app.tabs().length, 0, "без вкладок");
  } finally { app.dispose(); }
});

test("Описания L0/L1 проекта, папок и файлов показаны там, где их читают", async () => {
  const app = await mountMemoryApp({
    async readProjectOverview(project, node) {
      assert.equal(node, "");
      return { project_id: project, node_id: "", l0: "Материалы команды по запуску продукта.", l1: "Проект собирает заметки, планы и решения по запуску.", pending: false,
        children: [{ node_id: "doc", name: "Заметка команды", is_dir: false, l0: "Короткая заметка о договорённостях." }, { node_id: "dir", name: "Папка", is_dir: true, l0: "Черновики дизайна." }] };
    },
  }, { section: "projects", project: "one" });
  try {
    await app.until(() => app.text().includes("Материалы команды по запуску продукта."), "L0 под названием проекта");
    assert.ok(app.text().includes("Проект собирает заметки, планы и решения по запуску."), "L1 в обзоре");
    const section = name => app.document.querySelector(`#root section[aria-label="${name}"]`);
    await app.until(() => section("Файлы")?.textContent.includes("Короткая заметка о договорённостях."), "описание файла");
    assert.ok(section("Файлы").textContent.includes("Черновики дизайна."), "описание папки");
  } finally { app.dispose(); }
});

test("Описание проекта в работе показано как ожидание, а не как пустота", async () => {
  const app = await mountMemoryApp({ async readProjectOverview(project) { return { project_id: project, node_id: "", pending: true, children: [] }; } }, { section: "projects", project: "two" });
  try {
    await app.until(() => app.text().includes("Описание проекта готовится по его материалам."), "ожидание описания");
  } finally { app.dispose(); }
});
