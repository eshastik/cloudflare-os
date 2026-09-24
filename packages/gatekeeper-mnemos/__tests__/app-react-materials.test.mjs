import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

const LONG = "Начало договора поставки. " + "Условия оплаты и сроки поставки оборудования ".repeat(20);

function searching(searches) {
  return {
    async searchProject(project, query) {
      searches.push([project, query]);
      if (project === "one") return { hits: [
        { project_id: "one", node_id: "doc", name: "Заметка команды", text: LONG, ordinal: 0 },
        { project_id: "one", node_id: "doc", name: "Заметка команды", text: "второй фрагмент того же документа", ordinal: 1 },
      ], index_pending: false, degraded: false };
      return { hits: [{ project_id: "two", node_id: "other", name: "Другой документ", text: "Короткий фрагмент", ordinal: 0 }], index_pending: false, degraded: false };
    },
    async nodeHistory(project, node) { return { events: [{ recorded_at: node === "other" ? "2026-09-10T10:00:00Z" : "2026-09-12T10:00:00Z" }] }; },
  };
}
const cards = app => [...app.document.querySelectorAll("#root [data-document]")];
const card = (app, name) => cards(app).find(c => c.querySelector("button")?.textContent === name);
const inside = (el, name) => [...el.querySelectorAll("button")].find(b => b.textContent === name);
function submit(app, text) {
  const input = app.document.querySelector('#root input[aria-label="Поиск по материалам"]');
  app.type(input, text);
  // Формы во фрейме-песочнице не отправляются: поиск запускает Enter в поле.
  input.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}

test("«Материалы»: одна строка ищет по всем проектам, результаты — карточки с проектом, фрагментом и временем", async () => {
  const searches = [];
  const app = await mountMemoryApp(searching(searches), { section: "documents" });
  try {
    await app.until(() => card(app, "Заметка команды") && card(app, "Другой документ"), "материалы обоих проектов");
    submit(app, "оплата");
    await app.until(() => app.text().includes("Найдено: 2"), "результаты поиска");
    assert.deepEqual(searches.filter(([, q]) => q === "оплата").map(([p]) => p).toSorted(), ["one", "two"], "поиск идёт по всем доступным проектам");
    assert.equal(cards(app).length, 2, "один документ — одна карточка, даже если найдено несколько фрагментов");
    const first = card(app, "Заметка команды");
    assert.ok(first.textContent.includes("Общий проект"), "проект в карточке");
    assert.ok(first.textContent.includes("Начало договора поставки."), "фрагмент в карточке");
    assert.ok(first.querySelector("p").textContent.endsWith("…") && first.querySelector("p").textContent.length <= 241, "длинный фрагмент обрезан");
    await app.until(() => card(app, "Другой документ")?.querySelector("time")?.getAttribute("datetime") === "2026-09-10T10:00:00Z", "когда изменён");

    // Выбор проекта повторяет тот же запрос только в нём.
    app.type(app.document.querySelector('#root select[aria-label="Проект"]'), "two");
    await app.until(() => cards(app).length === 1 && card(app, "Другой документ"), "поиск в выбранном проекте");
    assert.deepEqual(searches.at(-1), ["two", "оплата"]);
  } finally { app.dispose(); }
});

test("«Материалы»: просмотр справа и переход в беседу с документом и проектом", async () => {
  const app = await mountMemoryApp(searching([]), { section: "documents" });
  try {
    await app.until(() => card(app, "Заметка команды"), "карточка");
    inside(card(app, "Заметка команды"), "Спросить в беседе").click();
    await app.until(() => app.calls.some(c => c[0] === "openPrompt"), "беседа из карточки");
    assert.deepEqual(app.calls.find(c => c[0] === "openPrompt"), ["openPrompt", "Вопрос по документу «Заметка команды»:\n\n", { projectId: "one", title: "Общий проект" }]);

    inside(card(app, "Другой документ"), "Открыть").click();
    const preview = () => app.document.querySelector('#root aside[aria-label="Просмотр документа"]');
    await app.until(() => preview()?.textContent.includes("Текст"), "просмотр справа");
    assert.ok(preview().textContent.includes("Другой документ") && preview().textContent.includes("Второй проект"));
    assert.ok(card(app, "Заметка команды"), "список остаётся рядом с просмотром");
    inside(preview(), "Сделать задачу по документу").click();
    await app.until(() => app.calls.filter(c => c[0] === "openPrompt").length === 2, "задача из просмотра");
    assert.deepEqual(app.calls.filter(c => c[0] === "openPrompt")[1], ["openPrompt", "Задача по документу «Другой документ»:\n\n", { projectId: "two", title: "Второй проект" }]);
    assert.ok(!/[0-9a-f]{16}/.test(app.text()), "на экране нет служебных идентификаторов");

    app.document.querySelector('#root button[aria-label="Закрыть просмотр"]').click();
    await app.until(() => !preview(), "просмотр закрыт");
  } finally { app.dispose(); }
});

test("«Материалы»: пустой раздел приглашает перетащить файлы в беседу или загрузить", async () => {
  const empty = {
    async browseProject() { return { nodes: [], truncated: false }; },
    async listPrivateDocuments() { return { documents: [], head: "a".repeat(64), next_cursor: "" }; },
  };
  const app = await mountMemoryApp(empty, { section: "documents" });
  try {
    await app.until(() => app.document.querySelector("#root [data-empty-materials]"), "пустое состояние");
    assert.ok(app.text().includes("Перетащите файлы в беседу"));
    app.button("Загрузить файлы").click();
    await app.until(() => app.calls.some(c => c[0] === "pickInboxFiles"), "загрузка без проекта");
    assert.deepEqual(app.calls.find(c => c[0] === "pickInboxFiles"), ["pickInboxFiles", false]);
  } finally { app.dispose(); }

  const inProject = await mountMemoryApp(empty, { section: "documents", project: "two" });
  try {
    await inProject.until(() =>inProject.document.querySelector("#root [data-empty-materials]"), "пустой проект");
    assert.ok(inProject.text().includes("В этом проекте пока нет материалов"));
    inProject.button("Загрузить файлы").click();
    await inProject.until(() => inProject.calls.some(c => c[0] === "pickInboxFiles"), "загрузка в выбранный проект");
    assert.deepEqual(inProject.calls.find(c => c[0] === "pickInboxFiles"), ["pickInboxFiles", false, "two"]);
  } finally { inProject.dispose(); }
});
