import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

const HEAD = "c".repeat(64);
const cards = app => [...app.document.querySelectorAll("#root [data-document]")];
const card = (app, name) => cards(app).find(c => c.querySelector("button")?.textContent === name);
const inside = (el, name) => [...el.querySelectorAll("button")].find(b => b.textContent === name);

// Личное пространство alice (lichnoe-alice) с файлом из беседы, общий проект и проект только для чтения.
function personalSpace(transfers, options = {}) {
  let moved = false;
  return {
    async listProjects() { return { projects: [
      { id: "space", name: "Личное пространство", slug: "lichnoe-alice", created_by: "alice" },
      { id: "one", name: "Общий проект", slug: "shared" },
      { id: "ro", name: "Архив", slug: "archive", can_edit: false },
    ] }; },
    async browseProject() { return { nodes: [], truncated: false }; },
    async listPrivateDocuments(project) {
      if (project !== "space" || moved) return { documents: [], head: HEAD, next_cursor: "" };
      return { documents: [{ node_id: "chat-doc", name: "Отчёт.docx", conflicted: false, content_type: "text/plain" }], head: HEAD, next_cursor: "" };
    },
    async readDraftDocument(project, node) {
      return { exists: true, head: HEAD, node_id: node, conflicted: false, terms: [{ present: true }], content_type: "text/plain" };
    },
    async transferPrivateDocument(project, node, request) {
      transfers.push([project, node, request]);
      if (options.fail) throw new Error("403 forbidden");
      moved = true;
      return { node_id: "new", head: HEAD, project_id: request.target_project_id, name: "Отчёт.docx", source_project_id: project, source_node_id: node, source_head: HEAD, notified: true };
    },
  };
}

test("«Материалы»: файл личного пространства переносится в проект с головой личной версии", async () => {
  const transfers = [];
  const app = await mountMemoryApp(personalSpace(transfers), { section: "documents" });
  try {
    await app.until(() => card(app, "Отчёт.docx"), "файл личного пространства");
    const move = inside(card(app, "Отчёт.docx"), "Переместить в проект…");
    assert.ok(move, "у файла личного пространства есть действие переноса");
    move.click();
    await app.until(() => card(app, "Отчёт.docx")?.querySelector("[data-move-to-project]"), "выбор проекта");
    const options = [...card(app, "Отчёт.docx").querySelectorAll('[role="option"]')].map(o => o.textContent);
    assert.deepEqual(options, ["Общий проект"], "только проекты, которые можно править, и не само пространство");
    assert.equal(app.document.querySelector("#root select"), null, "выбор без выпадающего списка");

    [...card(app, "Отчёт.docx").querySelectorAll('[role="option"]')][0].click();
    await app.until(() => app.text().includes("Файл «Отчёт.docx» перенесён в проект «Общий проект»"), "сообщение о переносе");
    assert.equal(transfers.length, 1);
    const [project, node, request] = transfers[0];
    assert.equal(project, "space");
    assert.equal(node, "chat-doc");
    assert.equal(request.target_project_id, "one");
    assert.equal(request.expected_head, HEAD, "перенос сверяется с головой личной версии");
    assert.match(request.request_id, /^move-[0-9a-f-]{36}$/);
    await app.until(() => !card(app, "Отчёт.docx"), "список обновлён после переноса");
  } finally { app.dispose(); }
});

test("«Материалы»: у файла обычного проекта переноса нет, отказ Mnemos показан причиной", async () => {
  const transfers = [];
  const app = await mountMemoryApp(personalSpace(transfers, { fail: true }), { section: "documents" });
  try {
    await app.until(() => card(app, "Отчёт.docx"), "файл личного пространства");
    inside(card(app, "Отчёт.docx"), "Переместить в проект…").click();
    await app.until(() => card(app, "Отчёт.docx")?.querySelector('[role="option"]'), "выбор проекта");
    card(app, "Отчёт.docx").querySelector('[role="option"]').click();
    await app.until(() => app.text().includes("Файл «Отчёт.docx» не перенесён"), "отказ показан");
    assert.ok(!app.text().includes("перенесён в проект"), "об успехе не сообщается");
  } finally { app.dispose(); }
});

test("«Материалы»: чужое пространство lichnoe-… и обычный проект переноса не дают", async () => {
  const app = await mountMemoryApp({
    async listProjects() { return { projects: [
      { id: "bob-space", name: "Пространство Боба", slug: "lichnoe-bob", created_by: "bob" },
      { id: "one", name: "Общий проект", slug: "shared" },
    ] }; },
  }, { section: "documents" });
  try {
    await app.until(() => cards(app).length > 0, "материалы");
    assert.equal(app.buttons().filter(b => b.textContent === "Переместить в проект…").length, 0);
  } finally { app.dispose(); }
});
