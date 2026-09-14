// ВРЕМЕННЫЙ тест ревью S6: приёмка живым входом и пять проб. Удаляется после ревью.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MessageChannel } from "node:worker_threads";
import { JSDOM } from "jsdom";
import { RpcTarget, newMessagePortRpcSession } from "capnweb";

async function until(predicate, what, ms = 4000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`UI did not reach expected state: ${what}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const REVIEW = "e".repeat(64);
const html = await readFile(new URL("../src/generated/app.txt", import.meta.url), "utf8");

function baseUi(log) {
  return class UI extends RpcTarget {
    async whoAmI() { log.push("whoAmI"); return { subject: { tenant_id: "org", user_id: "alice" }, tenant_name: "Пример команды" }; }
    async listProjects() { log.push("listProjects"); return { projects: [{ id: "one", name: "Общий проект", slug: "shared" }, { id: "two", name: "Второй проект", slug: "second" }] }; }
    async browseProject(id) {
      log.push("browseProject");
      if (id === "one") return { nodes: [{ node_id: "doc", name: "Заметка команды", is_dir: false }, { node_id: "dir", name: "Папка", is_dir: true }, { node_id: "plan", name: "План", is_dir: false }], truncated: false };
      return { nodes: [{ node_id: "other", name: "Другой документ", is_dir: false }], truncated: false };
    }
    async draftState(id) { return { personal_head: "a".repeat(64), shared_head: "b".repeat(64), personal_exists: id === "one" }; }
    async listPrivateDocuments(id) {
      if (id === "one") return { documents: [{ node_id: "plan", name: "План", content_type: "text/plain", conflicted: true }], head: "a".repeat(64), next_cursor: "" };
      return { documents: [{ node_id: "fresh", name: "Новый черновик", content_type: "text/plain", conflicted: false }], head: "d".repeat(64), next_cursor: "" };
    }
    async listPublicationReviews() {
      log.push("listPublicationReviews");
      return { reviews: [{ candidate_id: REVIEW, project_id: "one", author_id: "bob", personal_head: "c".repeat(64), shared_head: "b".repeat(64), decision_version: 3, stale: false, ready: false,
        domains: [{ domain_id: "Инженерия", node_ids: ["doc"], approvers: ["alice", "carol"], decisions: [{ approver_id: "carol", approved: true }] }] }], next_cursor: "" };
    }
    async recordReviewDecision(...args) { log.push(["decision", ...args]); }
    async searchProject(project, query) {
      log.push(["search", project, query]);
      if (project !== "one") return { hits: [], index_pending: false, degraded: false };
      return { hits: [{ project_id: project, node_id: "doc", name: "Найденная заметка", text: "Фрагмент", ordinal: 0 }], index_pending: false, degraded: false };
    }
    async nodeHistory(project, node) { log.push(["history", project, node]); return { events: [{ event_id: "latest", content_type: "text/plain", recorded_at: "2026-09-12T10:00:00Z", observed: true, exists: true, actor: "bob", on_behalf_of: "" }] }; }
    async readProjectDocument(project, node) { return { node_id: node, text: `Текст ${node}`, media_type: "text/plain", truncated: false }; }
    async readPlatformMetrics() { log.push("readPlatformMetrics"); throw new Error("нет метрик"); }
    async managedAgentRequest() { return null; }
    async managedTaskRequest() { return null; }
    async listAgentConnections() { log.push("listAgentConnections"); return { connections: [], next_cursor: "" }; }
    async recordUIReadiness() {}
  };
}

async function boot(UI, theme = "light") {
  class Host extends RpcTarget {
    #ui = new UI();
    get ui() { return this.#ui; }
    async subscribeTheme() { return theme; }
  }
  let frame; const ports = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(window) {
      for (const key of ["ReadableStream", "WritableStream", "TransformStream", "TextEncoder", "TextDecoder", "Request", "Response", "Headers"]) window[key] = globalThis[key];
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      window.Element.prototype.scrollIntoView = () => {};
      window.MessageChannel = class extends MessageChannel { constructor() { super(); ports.push(this.port1, this.port2); } };
      window.postMessage = (message, origin, transferred) => { assert.equal(message.type, "handshake"); frame = newMessagePortRpcSession(transferred[0], new Host()); };
    },
  });
  const { document } = dom.window;
  const h = {
    dom, document, get frame() { return frame; },
    text: () => document.querySelector("#root").textContent,
    tabs: () => [...document.querySelectorAll('[role="tab"]')],
    tab: name => h.tabs().find(t => t.textContent.startsWith(name)),
    button: name => [...document.querySelectorAll("#root button")].find(b => b.textContent === name || b.textContent.startsWith(name)),
    buttons: name => [...document.querySelectorAll("#root button")].filter(b => b.textContent === name),
    legacyButton: name => [...document.querySelectorAll("#legacy button")].find(b => b.textContent === name),
    row: name => [...document.querySelectorAll("#root [data-document]")].find(r => r.textContent.includes(name)),
    setSearch(value) {
      const search = document.querySelector("#root input[type=search]");
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(search, value);
      search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      search.form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    },
    close() { dom.window.dispatchEvent(new dom.window.Event("pagehide")); frame?.[Symbol.dispose](); dom.window.close(); for (const port of ports) port.close(); },
  };
  return h;
}

test("ПРИЁМКА а–ж", async () => {
  const log = [];
  const h = await boot(baseUi(log));
  try {
    // (а) заголовок, переключатель организации, порядок вкладок
    await until(() => h.document.querySelector("#root h1")?.textContent === "Память", "h1");
    await until(() => h.tabs().length === 8, "8 вкладок");
    assert.deepEqual(h.tabs().map(t => t.textContent.replace(/\d+$/, "")), ["Моя работа", "Проекты", "Документы", "Согласования", "Источники", "Агенты", "Организация", "Ещё"]);
    await until(() => h.text().includes("Пример команды"), "организация");
    assert.equal(h.document.querySelector("#root select"), null);
    const orgBtn = [...h.document.querySelectorAll("#root button")].find(b => b.textContent.includes("Пример команды"));
    assert.ok(orgBtn, "переключатель — кнопка");
    console.log("(а) кнопка организации:", orgBtn.outerHTML.slice(0, 200));
    orgBtn.click();
    await sleep(50);
    console.log("(а) после клика по организации, меню в DOM:", [...h.document.querySelectorAll('[role="menu"],[role="menuitem"],[role="menuitemradio"]')].map(e => e.tagName + ":" + e.textContent).join(" | "));
    await until(() => h.tab("Согласования").textContent === "Согласования1", "счётчик");
    h.document.body.click(); // закрыть меню

    // (б) Документы
    h.tab("Документы").click();
    await until(() => h.button("Общий проект") && h.button("Второй проект"), "проекты слева");
    await until(() => h.row("Заметка команды")?.textContent.includes("На согласовании · 1 из 2"), "статус на согласовании");
    assert.ok(h.row("План").textContent.includes("Конфликт"));
    assert.ok(h.row("Другой документ").textContent.includes("Опубликовано"));
    assert.ok(h.row("Новый черновик").textContent.includes("Черновик"));
    assert.equal(h.button("Общий проект").textContent, "Общий проект2");
    assert.equal(h.button("Второй проект").textContent, "Второй проект2");
    assert.equal(h.button("Все проекты").textContent, "Все проекты4");
    await until(() => h.row("Заметка команды").querySelector("time"), "время");
    console.log("(б) строка:", h.row("Заметка команды").textContent);
    h.button("Второй проект").click();
    await until(() => !h.row("Заметка команды") && h.row("Другой документ"), "фильтр по проекту");
    h.setSearch("знание");
    await until(() => h.text().includes("Найденная заметка") || h.text().includes("ничего не найдено"), "поиск");
    const searches = log.filter(x => x[0] === "search");
    console.log("(б) searchProject при выбранном втором проекте:", JSON.stringify(searches));
    h.button("Очистить").click();
    h.button("Все проекты").click();
    h.setSearch("знание");
    await until(() => h.text().includes("Найденная заметка"), "поиск по всем");
    console.log("(б) searchProject по всем:", JSON.stringify(log.filter(x => x[0] === "search")));

    // (в) Согласования
    h.tab("Согласования").click();
    await until(() => h.button("Одобрить") && h.button("Отклонить"), "кнопки решения");
    console.log("(в) строка согласования:", h.document.querySelector("#root [data-review]")?.textContent);
    h.button("Одобрить").click();
    await until(() => h.text().includes("Одобрение записано"), "подтверждение");
    assert.deepEqual(log.filter(x => x[0] === "decision"), [["decision", REVIEW, "Инженерия", 3, true]]);

    // (г) Ещё
    assert.equal(h.document.querySelector("#legacy").hidden, true, "legacy скрыт до «Ещё»");
    h.tab("Ещё").click();
    await until(() => !h.document.querySelector("#legacy").hidden, "legacy показан");
    assert.equal(h.document.querySelector("#legacy h1")?.textContent, "Корпоративная память");
    await until(() => h.legacyButton("Метрики платформы"), "кнопка раздела");
    h.legacyButton("Метрики платформы").click();
    await until(() => log.includes("readPlatformMetrics"), "раздел зовёт RPC");
    await sleep(30);
    console.log("(г) legacy после клика (300 симв.):", h.document.querySelector("#legacy").textContent.slice(0, 300));
    h.tab("Документы").click();
    await until(() => h.document.querySelector("#legacy").hidden, "legacy снова скрыт");

    // (д) тема
    assert.equal(h.document.documentElement.getAttribute("data-mode"), "light");
    await h.frame.setThemeMode("dark");
    await until(() => h.document.documentElement.getAttribute("data-mode") === "dark", "тёмная тема");
    assert.equal(h.document.documentElement.style.colorScheme, "dark");
    await h.frame.setThemeMode("light");
    await until(() => h.document.documentElement.getAttribute("data-mode") === "light", "светлая обратно");

    // (е) латиница в тексте всех вкладок
    const latin = new Set();
    for (const name of ["Моя работа", "Проекты", "Документы", "Согласования", "Источники", "Агенты", "Организация"]) {
      h.tab(name).click(); await sleep(20);
      for (const m of h.text().matchAll(/[A-Za-z]{2,}/g)) latin.add(m[0]);
      // (ж) пустые вкладки
      if (!["Документы", "Согласования"].includes(name)) {
        assert.ok(h.text().includes("Пока нечего показать"), `${name}: пустое состояние`);
        assert.ok(!/lorem|скоро|coming/i.test(h.text()), `${name}: без заглушек`);
      }
    }
    for (const el of h.document.querySelectorAll("#root [aria-label],#root [title],#root [placeholder]")) for (const a of ["aria-label", "title", "placeholder"]) { const v = el.getAttribute(a); if (v) for (const m of v.matchAll(/[A-Za-z]{2,}/g)) latin.add("attr:" + m[0]); }
    console.log("(е) латиница в тексте/атрибутах:", [...latin].join(", "));
    console.log("вызовы RPC при загрузке:", JSON.stringify(log.filter(x => typeof x === "string").reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {})));
  } finally { h.close(); }
});

test("ПРОБА 1: границы — 0 проектов и 500 проектов с усечением", async () => {
  const log0 = [];
  class Empty extends baseUi(log0) { async listProjects() { return { projects: [] }; } async listPublicationReviews() { return { reviews: [], next_cursor: "" }; } }
  let h = await boot(Empty);
  try {
    await until(() => h.tabs().length === 8, "вкладки");
    await until(() => h.text().includes("Документов пока нет"), "пусто");
    assert.equal(h.button("Все проекты").textContent, "Все проекты0");
    assert.ok(!h.text().includes("Загрузка"), "нет вечной загрузки");
    h.tab("Согласования").click();
    await until(() => h.text().includes("Пока нечего показать"), "пустые согласования");
    console.log("П1 пусто: ок");
  } finally { h.close(); }

  const log = [];
  class Many extends baseUi(log) {
    async listProjects() { return { projects: Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, name: `Проект ${i}`, slug: `p${i}` })) }; }
    async browseProject(id) { log.push("browseProject"); return { nodes: Array.from({ length: 50 }, (_, i) => ({ node_id: `${id}-n${i}`, name: `Документ ${i} проекта ${id}`, is_dir: false })), truncated: true, next_cursor: "more" }; }
    async listPrivateDocuments() { return { documents: [], head: "a".repeat(64), next_cursor: "" }; }
    async listPublicationReviews() { return { reviews: [], next_cursor: "" }; }
    async nodeHistory(project, node) { log.push(["history", project, node]); return { events: [] }; }
  }
  const t0 = Date.now();
  h = await boot(Many);
  try {
    await until(() => h.button("Проект 499"), "все проекты в списке", 15000);
    await until(() => log.filter(x => x === "browseProject").length === 500, "все проекты просмотрены", 30000);
    await sleep(200);
    const dt = Date.now() - t0;
    const rows = h.document.querySelectorAll("#root [data-document]").length;
    console.log(`П1 500 проектов: ${dt} мс до полной загрузки; строк документов в DOM: ${rows}; «Все проекты»: ${h.button("Все проекты").textContent}; «Проект 0»: ${h.button("Проект 0").textContent}; nodeHistory вызовов: ${log.filter(x => x[0] === "history").length}; подпись об усечении: ${h.text().includes("Показана первая страница")}`);
  } finally { h.close(); }
});

test("ПРОБА 2: честность отказа — listPublicationReviews бросает", async () => {
  const log = [];
  class Broken extends baseUi(log) { async listPublicationReviews() { throw new Error("сервер недоступен"); } }
  const h = await boot(Broken);
  try {
    await until(() => h.tabs().length === 8, "вкладки");
    await until(() => h.row("Заметка команды"), "документы");
    await sleep(100);
    console.log("П2 вкладка Согласования:", h.tab("Согласования").textContent, "| статус документа с открытым согласованием при упавшем списке:", h.row("Заметка команды").textContent);
    h.tab("Согласования").click();
    await until(() => h.text().includes("Не удалось загрузить согласования"), "ошибка показана");
    assert.ok(!h.text().includes("Пока нечего показать"), "не выдаёт отказ за пустоту");
    console.log("П2 текст вкладки:", h.text().slice(h.text().indexOf("Предложения"), h.text().indexOf("Предложения") + 200));
  } finally { h.close(); }
});

test("ПРОБА 3: поиск — пустая строка, 2000 символов, отказ одного проекта", async () => {
  const log = [];
  class Flaky extends baseUi(log) {
    async searchProject(project, query) { log.push(["search", project, query.length]); if (project === "two") throw new Error("проект недоступен"); return { hits: [{ project_id: project, node_id: "doc", name: "Найденная заметка", text: "x", ordinal: 0 }], index_pending: true, degraded: false }; }
  }
  const h = await boot(Flaky);
  try {
    await until(() => h.row("Заметка команды"), "документы");
    h.setSearch("   ");
    await sleep(60);
    assert.equal(log.filter(x => x[0] === "search").length, 0, "пустой запрос не зовёт RPC");
    assert.ok(h.row("Заметка команды"), "список на месте");
    const long = "я".repeat(2000);
    h.setSearch(long);
    await until(() => h.text().includes("Найдено: 1"), "результат");
    console.log("П3 вызовы:", JSON.stringify(log.filter(x => x[0] === "search")), "| текст:", h.text().slice(h.text().indexOf("Найдено"), h.text().indexOf("Найдено") + 120));
    assert.ok(h.text().includes("не опрошено проектов: 1"));
    assert.ok(h.text().includes("индекс ещё обновляется"));
  } finally { h.close(); }
});

test("ПРОБА 4: идемпотентность — двойной клик «Одобрить»; отказ RPC при решении", async () => {
  const log = [];
  let fail = false;
  class Slow extends baseUi(log) {
    async recordReviewDecision(...args) { log.push(["decision", ...args]); await sleep(150); if (fail) throw new Error("версия устарела"); }
  }
  const h = await boot(Slow);
  try {
    await until(() => h.tabs().length === 8, "вкладки");
    h.tab("Согласования").click();
    await until(() => h.button("Одобрить"), "кнопка");
    const b = h.button("Одобрить");
    b.click(); b.click();
    await sleep(0);
    h.button("Одобрить")?.click();
    await until(() => h.text().includes("Одобрение записано"), "записано");
    const n = log.filter(x => x[0] === "decision").length;
    console.log("П4 recordReviewDecision вызовов после трёх кликов:", n, "| listPublicationReviews вызовов:", log.filter(x => x === "listPublicationReviews").length);
    assert.equal(n, 1);
    // после перечитывания заглушка вернёт тот же список без решения alice — кнопка снова есть
    await until(() => h.button("Одобрить"), "кнопка после перечитывания");
    fail = true;
    h.button("Отклонить").click();
    await until(() => h.text().includes("Решение не записано"), "ошибка");
    assert.ok(!h.text().includes("Отказ записан"));
    assert.ok(h.button("Одобрить") && !h.button("Одобрить").disabled, "кнопки вернулись");
    console.log("П4 отказ: сообщение показано, кнопки активны");
  } finally { h.close(); }
});

test("ПРОБА 5: гонка — открыть документ A, затем B; поздний ответ A не перекрывает B", async () => {
  const log = [];
  const gates = {};
  class Racy extends baseUi(log) {
    async readProjectDocument(project, node) { await new Promise(r => { gates[node] = r; }); return { node_id: node, text: `Текст ${node}`, media_type: "text/plain", truncated: false }; }
  }
  const h = await boot(Racy);
  try {
    await until(() => h.row("Заметка команды") && h.row("Другой документ"), "документы");
    h.row("Заметка команды").querySelector("button").click();
    await until(() => h.text().includes("Загрузка…"), "загрузка A");
    h.button("К списку").click();
    await until(() => h.row("Другой документ"), "список");
    h.row("Другой документ").querySelector("button").click();
    await until(() => h.text().includes("Другой документ") && h.text().includes("Загрузка…"), "загрузка B");
    gates.doc(); await sleep(30);
    console.log("П5 после позднего ответа A: показан текст A?", h.text().includes("Текст doc"), "| заголовок:", h.text().includes("Другой документ"));
    assert.ok(!h.text().includes("Текст doc"), "поздний ответ A не показан");
    gates.other();
    await until(() => h.text().includes("Текст other"), "текст B");
    console.log("П5 ок");
  } finally { h.close(); }
});
