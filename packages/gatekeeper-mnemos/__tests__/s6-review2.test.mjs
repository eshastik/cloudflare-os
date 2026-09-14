// ВРЕМЕННЫЙ тест ревью S6 (уточнения). Удаляется после ревью.
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
  let frame; const ports = []; const errors = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(window) {
      for (const key of ["ReadableStream", "WritableStream", "TransformStream", "TextEncoder", "TextDecoder", "Request", "Response", "Headers"]) window[key] = globalThis[key];
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      window.Element.prototype.scrollIntoView = () => {};
      window.MessageChannel = class extends MessageChannel { constructor() { super(); ports.push(this.port1, this.port2); } };
      window.postMessage = (message, origin, transferred) => { assert.equal(message.type, "handshake"); frame = newMessagePortRpcSession(transferred[0], new Host()); };
      window.addEventListener("error", e => errors.push(String(e.error?.message || e.message)));
    },
  });
  const { document } = dom.window;
  const h = {
    dom, document, errors, get frame() { return frame; },
    text: () => document.querySelector("#root").textContent,
    tabs: () => [...document.querySelectorAll('[role="tab"]')],
    tab: name => h.tabs().find(t => t.textContent.startsWith(name)),
    button: name => [...document.querySelectorAll("#root button")].find(b => b.textContent === name || b.textContent.startsWith(name)),
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

test("(а) клик по переключателю организации", async () => {
  const log = [];
  const h = await boot(baseUi(log));
  try {
    await until(() => h.tabs().length === 8 && h.text().includes("Пример команды"), "загрузка");
    const orgBtn = [...h.document.querySelectorAll("#root button")].find(b => b.textContent.includes("Пример команды"));
    console.log("до клика: вкладок", h.tabs().length, "| aria-label:", orgBtn.getAttribute("aria-label"), "| aria-haspopup:", orgBtn.getAttribute("aria-haspopup"));
    // как в браузере: pointerdown + click
    orgBtn.dispatchEvent(new h.dom.window.MouseEvent("pointerdown", { bubbles: true }));
    orgBtn.click();
    await sleep(80);
    console.log("после клика: вкладок", h.tabs().length, "| #root пуст:", h.document.querySelector("#root").innerHTML.length === 0, "| ошибки окна:", JSON.stringify(h.errors));
    console.log("меню:", [...h.document.querySelectorAll('[role="menu"], [role="menuitem"], [role="menuitemcheckbox"]')].map(e => e.getAttribute("role") + ":" + e.textContent).join(" | ") || "(нет)");
  } finally { h.close(); }
});

test("(б–ж) остальная приёмка без клика по организации", async () => {
  const log = [];
  const h = await boot(baseUi(log));
  try {
    await until(() => h.tabs().length === 8, "8 вкладок");
    await until(() => h.tab("Согласования").textContent === "Согласования1", "счётчик");
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
    console.log("(б) searchProject при выбранном втором проекте:", JSON.stringify(log.filter(x => x[0] === "search")));
    h.button("Очистить").click(); await sleep(10);
    h.button("Все проекты").click(); await sleep(10);
    h.setSearch("знание");
    await until(() => h.text().includes("Найденная заметка"), "поиск по всем");
    console.log("(б) searchProject по всем:", JSON.stringify(log.filter(x => x[0] === "search")));

    h.tab("Согласования").click();
    await until(() => h.button("Одобрить") && h.button("Отклонить"), "кнопки решения");
    console.log("(в) строка согласования:", h.document.querySelector("#root [data-review]")?.textContent);
    h.button("Одобрить").click();
    await until(() => h.text().includes("Одобрение записано"), "подтверждение");
    assert.deepEqual(log.filter(x => x[0] === "decision"), [["decision", REVIEW, "Инженерия", 3, true]]);

    assert.equal(h.document.querySelector("#legacy").hidden, true, "legacy скрыт до «Ещё»");
    h.tab("Ещё").click();
    await until(() => !h.document.querySelector("#legacy").hidden, "legacy показан");
    assert.equal(h.document.querySelector("#legacy h1")?.textContent, "Корпоративная память");
    await until(() => h.legacyButton("Метрики платформы"), "кнопка раздела");
    h.legacyButton("Метрики платформы").click();
    await until(() => log.includes("readPlatformMetrics"), "раздел зовёт RPC");
    await sleep(30);
    console.log("(г) legacy после клика (300 симв.):", h.document.querySelector("#legacy").textContent.slice(0, 300).replace(/\s+/g, " "));
    h.tab("Документы").click();
    await until(() => h.document.querySelector("#legacy").hidden, "legacy снова скрыт");

    assert.equal(h.document.documentElement.getAttribute("data-mode"), "light");
    await h.frame.setThemeMode("dark");
    await until(() => h.document.documentElement.getAttribute("data-mode") === "dark", "тёмная тема");
    assert.equal(h.document.documentElement.style.colorScheme, "dark");
    await h.frame.setThemeMode("light");
    await until(() => h.document.documentElement.getAttribute("data-mode") === "light", "светлая обратно");

    const latin = new Set();
    for (const name of ["Моя работа", "Проекты", "Документы", "Согласования", "Источники", "Агенты", "Организация"]) {
      h.tab(name).click(); await sleep(20);
      for (const m of h.text().matchAll(/[A-Za-z]{2,}/g)) latin.add(m[0]);
      if (!["Документы", "Согласования"].includes(name)) {
        assert.ok(h.text().includes("Пока нечего показать"), `${name}: пустое состояние`);
        assert.ok(!/lorem|скоро|coming/i.test(h.text()), `${name}: без заглушек`);
      }
    }
    for (const el of h.document.querySelectorAll("#root [aria-label],#root [title],#root [placeholder]")) for (const a of ["aria-label", "title", "placeholder"]) { const v = el.getAttribute(a); if (v) for (const m of v.matchAll(/[A-Za-z]{2,}/g)) latin.add("attr:" + m[0]); }
    console.log("(е) латиница в тексте/атрибутах:", [...latin].join(", ") || "(нет)");
    console.log("вызовы RPC при загрузке:", JSON.stringify(log.filter(x => typeof x === "string").reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {})));
    console.log("ошибки окна:", JSON.stringify(h.errors));
  } finally { h.close(); }
});

test("ПРОБА 4 (уточнение): два клика «Одобрить» в разных задачах цикла событий", async () => {
  const log = [];
  class Slow extends baseUi(log) {
    async recordReviewDecision(...args) { log.push(["decision", ...args]); await sleep(150); }
  }
  const h = await boot(Slow);
  try {
    await until(() => h.tabs().length === 8, "вкладки");
    h.tab("Согласования").click();
    await until(() => h.button("Одобрить"), "кнопка");
    h.button("Одобрить").click();
    await sleep(0);
    const second = h.button("Одобрить");
    console.log("П4 после первого клика и одной задачи: кнопка disabled =", second?.disabled);
    second?.click();
    await sleep(5);
    h.button("Одобрить")?.click();
    await until(() => h.text().includes("Одобрение записано"), "записано");
    console.log("П4 recordReviewDecision вызовов:", log.filter(x => x[0] === "decision").length);
  } finally { h.close(); }
});
