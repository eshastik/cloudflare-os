import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MessageChannel } from "node:worker_threads";
import { JSDOM } from "jsdom";
import { RpcTarget, newMessagePortRpcSession } from "capnweb";

async function until(predicate, what) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`UI did not reach expected state: ${what}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

const REVIEW = "e".repeat(64);

test("оболочка «Память»: каркас, документы, согласования, «Ещё» и тема", async () => {
  const searches = [], decisions = [], histories = [];
  class UI extends RpcTarget {
    async whoAmI() { return { subject: { tenant_id: "org", user_id: "alice" }, tenant_name: "Пример команды" }; }
    async listProjects() { return { projects: [{ id: "one", name: "Общий проект", slug: "shared" }, { id: "two", name: "Второй проект", slug: "second" }] }; }
    async browseProject(id, cursor) {
      assert.equal(cursor, "");
      if (id === "one") return { nodes: [{ node_id: "doc", name: "Заметка команды", is_dir: false }, { node_id: "dir", name: "Папка", is_dir: true }, { node_id: "plan", name: "План", is_dir: false }], truncated: false };
      return { nodes: [{ node_id: "other", name: "Другой документ", is_dir: false }], truncated: false };
    }
    async draftState(id) { return { personal_head: "a".repeat(64), shared_head: "b".repeat(64), personal_exists: id === "one" }; }
    async listPrivateDocuments(id, cursor) {
      assert.equal(cursor, "");
      if (id === "one") return { documents: [{ node_id: "plan", name: "План", content_type: "text/plain", conflicted: true }], head: "a".repeat(64), next_cursor: "" };
      return { documents: [{ node_id: "fresh", name: "Новый черновик", content_type: "text/plain", conflicted: false }], head: "d".repeat(64), next_cursor: "" };
    }
    async listPublicationReviews(cursor) {
      assert.equal(cursor, "");
      return { reviews: [{ candidate_id: REVIEW, project_id: "one", author_id: "bob", personal_head: "c".repeat(64), shared_head: "b".repeat(64), decision_version: 3, stale: false, ready: false,
        domains: [{ domain_id: "Инженерия", node_ids: ["doc"], approvers: ["alice", "carol"], decisions: [{ approver_id: "carol", approved: true }] }] }], next_cursor: "" };
    }
    async recordReviewDecision(id, domain, version, approved) { decisions.push([id, domain, version, approved]); }
    async searchProject(project, query) {
      searches.push([project, query]);
      if (project !== "one") return { hits: [], index_pending: false, degraded: false };
      return { hits: [{ project_id: project, node_id: "doc", name: "Найденная заметка", text: "Фрагмент <b>текста</b>", ordinal: 0 }], index_pending: false, degraded: false };
    }
    async nodeHistory(project, node, cursor) {
      histories.push([project, node, cursor]);
      return { events: [{ event_id: "latest", content_type: "text/plain", recorded_at: "2026-09-12T10:00:00Z", observed: true, exists: true, actor: "bob", on_behalf_of: "" }] };
    }
    async readProjectDocument(project, node) { assert.deepEqual([project, node], ["one", "doc"]); return { node_id: node, text: "Текст документа", media_type: "text/plain", truncated: false }; }
    async managedAgentRequest() { return null; }
    async managedTaskRequest() { return null; }
    async listAgentConnections() { return { connections: [], next_cursor: "" }; }
    async recordUIReadiness() {}
  }
  class Host extends RpcTarget {
    #ui = new UI();
    get ui() { return this.#ui; }
    async subscribeTheme() { return "light"; }
  }
  let frame; const ports = [];
  const html = await readFile(new URL("../src/generated/app.txt", import.meta.url), "utf8");
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      for (const key of ["ReadableStream", "WritableStream", "TransformStream", "TextEncoder", "TextDecoder", "Request", "Response", "Headers"]) window[key] = globalThis[key];
      // В jsdom нет наблюдателей размера и медиазапросов, которые нужны Kumo; данные через них не идут.
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      window.Element.prototype.scrollIntoView = () => {};
      window.MessageChannel = class extends MessageChannel {
        constructor() { super(); ports.push(this.port1, this.port2); }
      };
      window.postMessage = (message, origin, transferred) => {
        assert.equal(message.type, "handshake"); assert.equal(origin, "*");
        frame = newMessagePortRpcSession(transferred[0], new Host());
      };
    },
  });
  const { document } = dom.window;
  const text = () => document.querySelector("#root").textContent;
  const tabs = () => [...document.querySelectorAll('[role="tab"]')];
  const tab = name => tabs().find(t => t.textContent.startsWith(name));
  const button = name => [...document.querySelectorAll("#root button")].find(b => b.textContent === name || b.textContent.startsWith(name));
  const legacyButton = name => [...document.querySelectorAll("#legacy button")].find(b => b.textContent === name);
  try {
    await until(() => document.querySelector("h1")?.textContent === "Память", "заголовок «Память»");
    await until(() => tabs().length === 8, "восемь вкладок");
    assert.deepEqual(tabs().map(t => t.textContent.replace(/\d+$/, "")), ["Моя работа", "Проекты", "Документы", "Согласования", "Источники", "Агенты", "Организация", "Ещё"]);
    await until(() => text().includes("Пример команды"), "название организации в шапке");
    assert.equal(document.querySelector("#root select"), null, "переключатель организации — кнопка, не select");
    await until(() => tab("Согласования").textContent === "Согласования1", "счётчик согласований на вкладке");

    tab("Документы").click();
    await until(() => button("Общий проект") && button("Второй проект"), "проекты слева");
    await until(() => text().includes("Заметка команды") && text().includes("Другой документ"), "документы обоих проектов");
    const row = name => [...document.querySelectorAll("#root [data-document]")].find(r => r.textContent.includes(name));
    await until(() => row("Заметка команды")?.textContent.includes("На согласовании · 1 из 2"), "бейдж «на согласовании»");
    assert.ok(row("План").textContent.includes("Конфликт"), "конфликт из listPrivateDocuments");
    assert.ok(row("Другой документ").textContent.includes("Опубликовано"), "документ без черновика — опубликован");
    assert.ok(row("Новый черновик").textContent.includes("Черновик"), "документ только личной версии — черновик");
    assert.ok(!row("Папка"), "каталоги в списке документов не показываются");
    await until(() => row("Заметка команды").querySelector("time")?.getAttribute("datetime") === "2026-09-12T10:00:00Z", "время из истории документа");
    assert.ok(histories.some(([p, n, c]) => p === "one" && n === "doc" && c === ""));
    assert.equal(button("Общий проект").textContent, "Общий проект2");
    assert.equal(button("Все проекты").textContent, "Все проекты4");

    const search = document.querySelector("#root input[type=search]");
    // React сверяет значение со своим слепком, поэтому ввод ставится нативным сеттером, как это делает браузер.
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(search, "знание");
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    search.form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await until(() => text().includes("Найденная заметка"), "результат поиска");
    assert.deepEqual(searches.filter(([, q]) => q === "знание").map(([p]) => p).toSorted(), ["one", "two"]);
    assert.ok(text().includes("Фрагмент <b>текста</b>"), "текст результата показан как текст, не как HTML");
    assert.equal(document.querySelector("#root b"), null);

    button("Найденная заметка").click();
    await until(() => text().includes("Содержимое документа") && text().includes("Текст документа"), "просмотр документа");

    tab("Согласования").click();
    await until(() => button("Одобрить") && button("Отклонить"), "кнопки решения");
    assert.ok(text().includes("Инженерия") && text().includes("bob") && text().includes("1 из 2"));
    button("Одобрить").click();
    await until(() => text().includes("Одобрение записано"), "подтверждение одобрения");
    assert.deepEqual(decisions, [[REVIEW, "Инженерия", 3, true]]);

    tab("Ещё").click();
    await until(() => !document.querySelector("#legacy").hidden, "контейнер прежних разделов показан");
    assert.equal(document.querySelector("#legacy h1")?.textContent, "Корпоративная память");
    await until(() => legacyButton("Метрики платформы"), "кнопка прежнего раздела");

    assert.equal(document.documentElement.getAttribute("data-mode"), "light");
    await frame.setThemeMode("dark");
    await until(() => document.documentElement.getAttribute("data-mode") === "dark", "тёмная тема через setThemeMode");
  } finally {
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    frame?.[Symbol.dispose](); dom.window.close();
    for (const port of ports) port.close();
  }
});
