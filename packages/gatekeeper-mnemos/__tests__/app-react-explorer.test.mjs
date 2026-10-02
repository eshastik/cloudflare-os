import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

const nodes = [
  { node_id: "dir", name: "Исследования", is_dir: true },
  { node_id: "nested", parent_id: "dir", name: "Договоры", is_dir: true },
  { node_id: "doc", parent_id: "dir", name: "Отчёт.docx", is_dir: false },
  { node_id: "contract", parent_id: "nested", name: "Договор.pdf", is_dir: false },
  { node_id: "root", name: "Описание.md", is_dir: false },
];

test("папка открывает только своих детей, путь возвращает назад, задача передаёт точные материалы", async () => {
  const app = await mountMemoryApp({ async browseProject() { return { nodes, truncated: false }; } }, { section: "documents", project: "one", document: "dir" });
  try {
    await app.until(() => app.document.querySelector('[data-document="doc"]'), "файл выбранной папки");
    assert.equal(app.document.querySelector('[data-document="root"]'), null);
    assert.equal(app.document.querySelector('[data-document="contract"]'), null);
    assert.ok(app.text().includes("Договоры"));
    assert.equal(app.calls.some(([m]) => m === "readProjectDocument"), false, "папка не читается как файл");
    app.document.querySelector('input[aria-label="Выбрать файл Отчёт.docx"]').click();
    const task = app.document.querySelector('textarea[aria-label="Задача Mnemos"]');
    app.buttons().find(button => button.textContent === "Выделить задачи").click();
    await app.until(() => task.value.includes("Извлеки задачи"), "задача выбрана");
    app.buttons().find(button => button.textContent.includes("Продолжить в беседе")).click();
    await app.until(() => app.calls.some(([m]) => m === "openPrompt"), "беседа открывается");
    const prompt = app.calls.find(([m]) => m === "openPrompt");
    assert.ok(!prompt[1].includes("node_id="));
    assert.equal(prompt[2].materials[0].nodeId, "doc");
    assert.ok(prompt[1].includes("Исследования/Отчёт.docx"));
    assert.equal(prompt[2].projectId, "one");
    assert.equal(prompt[2].title, "Общий проект");
    assert.ok(!prompt[1].includes("node_id=contract"));
    [...app.document.querySelectorAll('[aria-label="Путь к папке"] button')].find(button => button.textContent === "Файлы").click();
    await app.until(() => app.document.querySelector('[data-document="root"]'), "корень проекта");
    assert.equal(app.document.querySelector('[data-document="doc"]'), null);
  } finally { app.dispose(); }
});

test("папка из следующей страницы открывается по ссылке", async () => {
  const requests = [];
  const app = await mountMemoryApp({ async browseProject(project, cursor) {
    requests.push(cursor);
    return cursor ? { nodes: nodes.filter(node => node.node_id !== "root"), truncated: false } : { nodes: [nodes.at(-1)], next_cursor: "second", truncated: true };
  } }, { section: "documents", project: "one", document: "nested" });
  try {
    await app.until(() => app.document.querySelector('[data-document="contract"]'), "вложенная папка со второй страницы");
    assert.ok(requests.includes("second"));
    assert.equal(app.document.querySelector('[data-document="root"]'), null);
  } finally { app.dispose(); }
});

test("личный черновик сохраняет папку и доступен на следующей странице", async () => {
  const app = await mountMemoryApp({
    async browseProject() { return { nodes, truncated: false }; },
    async listPrivateDocuments(project, cursor) { return { documents: cursor ? [{ node_id: "draft", parent_id: "dir", name: "Личная заметка.md", content_type: "text/markdown", conflicted: false }] : [], head: "a".repeat(64), next_cursor: cursor ? "" : "private-next" }; },
  }, { section: "documents", project: "one", document: "dir" });
  try {
    await app.until(() => app.buttons().some(button => button.textContent.includes("Загрузить ещё файлы")), "продолжение личных файлов");
    app.buttons().find(button => button.textContent.includes("Загрузить ещё файлы")).click();
    await app.until(() => app.document.querySelector('[data-document="draft"]'), "личный документ в папке");
    [...app.document.querySelectorAll('[aria-label="Путь к папке"] button')].find(button => button.textContent === "Файлы").click();
    await app.until(() => app.document.querySelector('[data-document="root"]'), "корень");
    assert.equal(app.document.querySelector('[data-document="draft"]'), null);
  } finally { app.dispose(); }
});

test("прямая ссылка на личный файл со второй страницы сохраняет исходную папку", async () => {
  const app = await mountMemoryApp({
    async browseProject() { return { nodes, truncated: false }; },
    async listPrivateDocuments(project, cursor) { return { documents: cursor ? [{ node_id: "draft", parent_id: "dir", name: "Личная заметка.pdf", content_type: "application/pdf", conflicted: false }] : [], head: "a".repeat(64), next_cursor: cursor ? "" : "private-next" }; },
    async readDraftText() { return { text: "Личный текст", content_type: "text/plain", head: "a".repeat(64), truncated: false }; },
  }, { section: "documents", project: "one", document: "draft" });
  try {
    await app.until(() => app.document.querySelector('[aria-label="Просмотр документа"]'), "личный файл открыт");
    await app.until(() => app.document.querySelector('[data-document="doc"]'), "родитель личного файла");
    assert.equal(app.document.querySelector('[data-document="root"]'), null);
    app.document.querySelector('button[aria-label="Закрыть просмотр"]').click();
    await app.until(() => app.calls.some(([m]) => m === "openSection"), "возврат в папку");
    assert.ok(app.calls.some(call => call[0] === "openSection" && call[3] === "dir"));
  } finally { app.dispose(); }
});
