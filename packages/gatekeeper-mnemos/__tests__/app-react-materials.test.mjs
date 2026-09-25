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
const chip = (app, name) => [...app.document.querySelectorAll('#root [role="group"][aria-label="Проект"] button')].find(b => b.textContent.startsWith(name));
const inside = (el, name) => [...el.querySelectorAll("button")].find(b => b.textContent === name);
function submit(app, text) {
  const input = app.document.querySelector('#root input[aria-label="Поиск по материалам"]');
  app.type(input, text);
  // Формы во фрейме-песочнице не отправляются: поиск запускает Enter в поле.
  input.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}

test("«Материалы»: одна строка ищет по всем проектам, результаты — строки с проектом, фрагментом и временем", async () => {
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

    // Выбор проекта — чипом, без выпадающего списка; тот же запрос повторяется только в нём.
    assert.equal(app.document.querySelector("#root select"), null, "выпадающих списков на экране нет");
    chip(app, "Второй проект").click();
    await app.until(() => cards(app).length === 1 && card(app, "Другой документ"), "поиск в выбранном проекте");
    assert.deepEqual(searches.at(-1), ["two", "оплата"]);
    assert.equal(chip(app, "Второй проект").getAttribute("aria-pressed"), "true");
  } finally { app.dispose(); }
});

test("«Материалы»: поиск идёт сам при вводе, «Ищу…» стоит у поля и исчезает с ответом, найденное показывает папку", async () => {
  const searches = [];
  const waiting = [];
  const app = await mountMemoryApp({
    async searchProject(project, query) {
      searches.push([project, query]);
      if (query === "config") await new Promise(resolve => waiting.push(resolve));
      if (project !== "one") return { hits: [], index_pending: false, degraded: false };
      if (query === "config") return { hits: [{ project_id: "one", node_id: "cfg", name: "config.py", path: "/k400_front_back/backend/app/core/config.py", text: "", ordinal: 0 }], index_pending: false, degraded: false };
      return { hits: [], index_pending: false, degraded: false };
    },
  }, { section: "documents" });
  try {
    await app.until(() => card(app, "Заметка команды"), "материалы");
    assert.equal(app.buttons().filter(b => b.textContent === "Найти").length, 0, "кнопки «Найти» нет");
    const input = app.document.querySelector('#root input[aria-label="Поиск по материалам"]');
    app.type(input, "config");
    const indicator = () => app.document.querySelector("#root [data-searching]");
    await app.until(() => indicator() && waiting.length === 2, "индикатор у поля");
    assert.ok(input.closest("label").contains(indicator()), "индикатор внутри поля поиска, а не во весь экран");
    assert.equal(app.buttons().filter(b => b.getAttribute("aria-label") === "Очистить поиск").length, 1, "очистка появилась с текстом");
    waiting.forEach(resolve => resolve());
    await app.until(() => card(app, "config.py") && !indicator(), "ответ пришёл, индикатор исчез");
    assert.ok(card(app, "config.py").textContent.includes("k400_front_back/backend/app/core"), "папка файла видна");
    assert.deepEqual(searches.filter(([, q]) => q === "config").map(([p]) => p).toSorted(), ["one", "two"], "запрос ушёл без нажатия кнопки, по одному разу на проект");

    app.type(input, "нетакогослова");
    await app.until(() => app.document.querySelector("#root [data-nothing-found]"), "пустой результат");
    assert.ok(app.text().includes("Ничего не найдено по «нетакогослова»"));
    app.document.querySelector('#root button[aria-label="Очистить поиск"]').click();
    await app.until(() => !app.document.querySelector('#root section[aria-label="Результаты поиска"]') && card(app, "Заметка команды"), "очистка вернула список");
    assert.equal(app.document.querySelector('#root button[aria-label="Очистить поиск"]'), null, "очистки нет, когда нечего чистить");
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

test("«Материалы»: Markdown в просмотре оформлен, в карточке — без разметки; HTML и опасные ссылки не исполняются", async () => {
  const markdown = [
    "# Текущий статус проекта",
    "",
    "**Дата:** 24 сентября, *черновик*",
    "",
    "## 1) Что сделано",
    "",
    "- приём файлов",
    "- поиск по `сегментам`",
    "",
    "1. первый шаг",
    "2. второй шаг",
    "",
    "<script>window.__markdownRan = true</script><img src=x onerror=\"window.__markdownRan = true\">",
    "",
    "[сайт](https://example.com) и [плохая](javascript:alert(1))",
  ].join("\n");
  const app = await mountMemoryApp({
    async searchProject(project) {
      if (project !== "one") return { hits: [], index_pending: false, degraded: false };
      return { hits: [{ project_id: "one", node_id: "status", name: "Статус.md", text: markdown, ordinal: 0 }], index_pending: false, degraded: false };
    },
    async readProjectDocument(project, node) { return { node_id: node, text: markdown, media_type: "text/markdown", truncated: false }; },
  }, { section: "documents" });
  try {
    await app.until(() => card(app, "Заметка команды"), "материалы");
    submit(app, "статус");
    await app.until(() => card(app, "Статус.md"), "карточка Markdown");
    const fragment = card(app, "Статус.md").querySelector("p").textContent;
    assert.ok(fragment.startsWith("Текущий статус проекта Дата: 24 сентября"), fragment);
    assert.ok(!/[#*`]/.test(fragment), `во фрагменте нет разметки: ${fragment}`);

    inside(card(app, "Статус.md"), "Открыть").click();
    const view = () => app.document.querySelector('#root aside[aria-label="Просмотр документа"] [data-markdown]');
    await app.until(() => view(), "оформленный просмотр");
    const shown = view();
    assert.equal(shown.querySelector("h1").textContent, "Текущий статус проекта");
    assert.equal(shown.querySelector("h2").textContent, "1) Что сделано");
    assert.equal(shown.querySelector("strong").textContent, "Дата:");
    assert.equal(shown.querySelector("em").textContent, "черновик");
    assert.deepEqual([...shown.querySelectorAll("ul > li")].map(li => li.textContent), ["приём файлов", "поиск по сегментам"]);
    assert.deepEqual([...shown.querySelectorAll("ol > li")].map(li => li.textContent), ["первый шаг", "второй шаг"]);
    assert.equal(shown.querySelector("code").textContent, "сегментам");
    assert.ok(!/(^|\s)#|\*\*/.test(shown.textContent), "символы разметки не видны");

    assert.equal(shown.querySelector("script"), null, "скрипт не стал элементом");
    assert.equal(shown.querySelector("img"), null, "HTML не стал элементом");
    assert.ok(shown.textContent.includes("<script>"), "HTML показан как текст");
    assert.equal(app.dom.window.__markdownRan, undefined, "скрипт не исполнился");
    const links = [...shown.querySelectorAll("a")];
    assert.equal(links.length, 1, "ссылка javascript: осталась текстом");
    assert.equal(links[0].getAttribute("href"), "https://example.com");
    assert.equal(links[0].getAttribute("rel"), "noopener noreferrer");
    assert.ok(shown.textContent.includes("плохая"));
  } finally { app.dispose(); }
});

test("«Материалы»: поздний ответ прежнего запроса не перетирает новый; одна буква запрос не отправляет", async () => {
  const searches = [];
  const late = [];
  const app = await mountMemoryApp({
    async searchProject(project, query) {
      searches.push([project, query]);
      if (query === "старый") await new Promise(resolve => late.push(resolve));
      if (project !== "one") return { hits: [], index_pending: false, degraded: false };
      return { hits: [{ project_id: "one", node_id: query === "старый" ? "old" : "new", name: query === "старый" ? "Старый.md" : "Новый.md", text: "", ordinal: 0 }], index_pending: false, degraded: false };
    },
  }, { section: "documents" });
  try {
    await app.until(() => card(app, "Заметка команды"), "материалы");
    const input = app.document.querySelector('#root input[aria-label="Поиск по материалам"]');
    app.type(input, "с");
    await app.until(() => app.document.querySelector("#root [data-too-short]"), "подсказка про длину");
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(searches.length, 0, "одна буква не уходит на сервер");

    app.type(input, "старый");
    await app.until(() => late.length === 2, "прежний запрос ушёл и висит");
    app.type(input, "новый");
    await app.until(() => card(app, "Новый.md") && !app.document.querySelector("#root [data-searching]"), "ответ на новый запрос");
    late.forEach(resolve => resolve());
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(card(app, "Новый.md"), "новый результат на месте");
    assert.equal(card(app, "Старый.md"), undefined, "поздний ответ прежнего запроса отброшен");
  } finally { app.dispose(); }
});
