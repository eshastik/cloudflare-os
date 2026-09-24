import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcTarget } from "capnweb";
import { mountMemoryApp } from "./app-react-harness.mjs";

async function until(predicate, what) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`UI did not reach expected state: ${what}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

const REVIEW = "e".repeat(64);

test("прямые разделы Mnemos: материалы, согласования во «Входящих» и тема", async () => {
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
  const methods = Object.fromEntries(Object.getOwnPropertyNames(UI.prototype).filter(key => key !== "constructor").map(key => [key, UI.prototype[key]]));
  const app = await mountMemoryApp(methods);
  const text = app.text;
  const button = name => app.buttons().find(b => b.textContent === name || b.textContent.startsWith(name));
  try {
    assert.equal(app.document.querySelector("#root h1")?.textContent,"Входящие");
    assert.equal(app.document.querySelectorAll('[role="tab"]').length,0,"вторая навигация отсутствует");
    await app.open("Материалы");
    const option = name => [...app.document.querySelectorAll('#root select[aria-label="Проект"] option')].find(o => o.textContent.startsWith(name));
    await until(() => option("Общий проект") && option("Второй проект"), "проекты в выборе");
    await until(() => text().includes("Заметка команды") && text().includes("Другой документ"), "документы обоих проектов");
    const row = name => [...app.document.querySelectorAll("#root [data-document]")].find(r => r.textContent.includes(name));
    await until(() => row("Заметка команды")?.textContent.includes("На согласовании · 1 из 2"), "бейдж «на согласовании»");
    assert.ok(row("План").textContent.includes("Конфликт"), "конфликт из listPrivateDocuments");
    assert.ok(row("Другой документ").textContent.includes("Опубликовано"), "документ без черновика — опубликован");
    assert.ok(row("Новый черновик").textContent.includes("Черновик"), "документ только личной версии — черновик");
    assert.ok(!row("Папка"), "каталоги в списке документов не показываются");
    await until(() => row("Заметка команды").querySelector("time")?.getAttribute("datetime") === "2026-09-12T10:00:00Z", "время из истории документа");
    assert.ok(histories.some(([p, n, c]) => p === "one" && n === "doc" && c === ""));
    assert.equal(option("Общий проект").textContent, "Общий проект · 2");
    assert.equal(option("Все проекты").textContent, "Все проекты · 4");

    const search = app.document.querySelector("#root input[type=search]");
    // React сверяет значение со своим слепком, поэтому ввод ставится нативным сеттером, как это делает браузер.
    Object.getOwnPropertyDescriptor(app.dom.window.HTMLInputElement.prototype, "value").set.call(search, "знание");
    search.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
    search.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await until(() => text().includes("Найденная заметка"), "результат поиска");
    assert.deepEqual(searches.filter(([, q]) => q === "знание").map(([p]) => p).toSorted(), ["one", "two"]);
    assert.ok(text().includes("Фрагмент <b>текста</b>"), "текст результата показан как текст, не как HTML");
    assert.equal(app.document.querySelector("#root b"), null);

    button("Найденная заметка").click();
    await until(() => app.document.querySelector('#root aside[aria-label="Просмотр документа"]')?.textContent.includes("Текст документа"), "просмотр документа");

    await app.open("Входящие");
    await until(() => app.document.querySelector('#root [data-inbox="approval"]'), "строка согласования");
    app.document.querySelector('#root [data-inbox="approval"] button').click();
    await until(() => button("Одобрить") && button("Отклонить"), "кнопки решения");
    assert.ok(text().includes("Инженерия") && text().includes("bob") && text().includes("1 из 2"));
    button("Одобрить").click();
    await until(() => text().includes("Одобрение записано"), "подтверждение одобрения");
    assert.deepEqual(decisions, [[REVIEW, "Инженерия", 3, true]]);

    assert.equal(app.document.documentElement.getAttribute("data-mode"), "light");
    await app.setTheme("dark");
    await until(() => app.document.documentElement.getAttribute("data-mode") === "dark", "тёмная тема через setThemeMode");
  } finally { app.dispose(); }
});
