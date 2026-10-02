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
    async readDraftDocument() { return {exists:true,head:"a".repeat(64),conflicted:false,terms:[{present:true}]}; },
    async readDraftText() { return { text: "Личный текст", content_type: "text/plain", head: "a".repeat(64), truncated: false }; },
  }, { section: "documents", project: "one", document: "draft" });
  try {
    await app.until(() => app.calls.some(([method]) => method === "previewFile"), "оригинал личного файла открыт");
    await app.until(() => app.document.querySelector('[data-document="doc"]'), "родитель личного файла");
    assert.equal(app.document.querySelector('[data-document="root"]'), null);
    const preview = app.calls.find(([method]) => method === "previewFile");
    assert.equal(preview[2], "draft");
    assert.equal(preview[3], "private:" + "a".repeat(64));
    assert.equal(app.document.querySelector('[aria-label="Просмотр документа"]'), null, "документ не вытесняет агента");
  } finally { app.dispose(); }
});

test("беседы переживают временный отказ, повтор следующей страницы сохраняет уже найденные", async () => {
  let attempts = 0, failNext = true;
  const app = await mountMemoryApp({}, { section: "documents", project: "one", projectChats: async (_project, offset) => {
    attempts++;
    if (attempts === 1 || (offset === 20 && failNext)) throw Error("temporary connection failure");
    return offset === 20 ? {chats:[{workspaceId:"older",chatId:2,title:"Ранняя беседа",at:"2026-09-01"}],next:null,failed:0}
      : {chats:[{workspaceId:"recent",chatId:1,title:"Недавняя беседа",at:"2026-10-02"}],next:20,failed:0};
  }});
  try {
    await app.until(() => app.buttons().some(button => button.textContent === "Беседы"), "вкладка бесед");
    app.buttons().find(button => button.textContent === "Беседы").click();
    await app.until(() => app.text().includes("Недавняя беседа"), "повтор после первого отказа");
    assert.equal(attempts, 2);
    app.buttons().find(button => button.textContent.includes("Посмотреть более ранние")).click();
    await app.until(() => app.buttons().some(button => button.textContent.includes("Повторить загрузку")), "понятный отказ следующей страницы");
    assert.ok(app.text().includes("Недавняя беседа"));
    failNext = false;
    app.buttons().find(button => button.textContent.includes("Повторить загрузку")).click();
    await app.until(() => app.text().includes("Ранняя беседа"), "повтор именно следующей страницы");
    assert.ok(app.text().includes("Недавняя беседа"));
    assert.equal(app.calls.filter(call => call[0] === "listProjectChats").at(-1)[2], 20);
  } finally { app.dispose(); }
});


test("страница проекта показывает беседы справа и открывает точную ветку", async () => {
  const app = await mountMemoryApp({}, { section: "projects", project: "one", projectChats: async () => ({chats:[{workspaceId:"linked",chatId:7,title:"Сводка проекта",at:"2026-10-02"}],next:null,failed:0}) });
  try {
    await app.until(() => app.document.querySelector('[aria-label="Беседы проекта"] button'), "беседы на странице проекта");
    const button = [...app.document.querySelectorAll('[aria-label="Беседы проекта"] button')].find(button => button.textContent.includes("Сводка проекта"));
    button.click();
    await app.until(() => app.calls.some(([method]) => method === "openProjectChat"), "переход к беседе");
    assert.deepEqual(app.calls.find(([method]) => method === "openProjectChat").slice(1), ["linked",7]);
  } finally { app.dispose(); }
});
