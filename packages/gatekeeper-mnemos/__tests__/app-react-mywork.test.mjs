import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEW_MINE, REVIEW_READY, mountMemoryApp } from "./app-react-harness.mjs";

test("«Моя работа»: вкладка по умолчанию, четыре блока, решения по типам, действия через RPC", async () => {
  const app = await mountMemoryApp();
  try {
    assert.equal(app.document.querySelector("#root h1").textContent, "Входящие", "раздел по умолчанию");
    const block = name => app.document.querySelector(`#root section[aria-label="${name}"]`);
    await app.until(() => block("Ждут моего решения")?.textContent.includes("Инженерия"), "согласование по направлению");
    app.button("Действия агентов — открыть очередь разрешений").click();
    await app.until(() => app.calls.some(([name]) => name === "openApprovals"), "очередь открыта через хост");
    assert.ok(block("Ждут моего решения").textContent.includes("Публикация"), "тип «публикация» показан отдельно");
    await app.until(() => block("Поручено мне")?.textContent.includes("Проверить ТЗ на страницу цен"), "поручение мне");
    assert.ok(block("Поручено мне").textContent.includes("Общий проект"), "проект поручения");
    assert.ok(block("Поручено мне").textContent.includes("срок не задан"), "срок честно не задан");
    assert.ok(!block("Поручено мне").textContent.includes("Согласовать подрядчика"), "чужое поручение (я отправитель) не в «поручено мне»");
    await app.until(() => block("Мои агенты")?.textContent.includes("agent-alice") && block("Мои агенты").textContent.includes("claude-code-alice"), "оба агента");
    assert.ok(block("Мои агенты").textContent.includes("AgenticOS") && block("Мои агенты").textContent.includes("внешний клиент"));
    await app.until(() => block("Заблокировано")?.textContent.includes("Согласовать подрядчика"), "моё обращение ждёт результата");
    assert.ok(block("Заблокировано").textContent.includes("carol"), "кто может разблокировать");

    const rowOf = name => [...app.document.querySelectorAll("#root [data-decision]")].find(r => r.textContent.includes(name));
    [...rowOf("Инженерия").querySelectorAll("button")].find(b => b.textContent === "Одобрить").click();
    await app.until(() => app.calls.some(([m]) => m === "recordReviewDecision"), "решение записано");
    assert.deepEqual(app.calls.find(([m]) => m === "recordReviewDecision"), ["recordReviewDecision", REVIEW_MINE, "Инженерия", 3, true]);

    [...rowOf("Дизайн").querySelectorAll("button")].find(b => b.textContent === "Опубликовать").click();
    await app.until(() => app.text().includes("Изменения проекта опубликованы"), "публикация подтверждена");
    const publish = app.calls.find(([m]) => m === "publishDraft");
    assert.equal(publish[1], "one"); assert.equal(publish[2], "a".repeat(64)); assert.equal(publish[3], "b".repeat(64));
    assert.ok(!app.calls.some(([m, id]) => m === "publishDraft" && id === REVIEW_READY), "publishDraft получает проект и версии, а не идентификатор кандидата");
  } finally { app.dispose(); }
});

test("«Моя работа»: пустые блоки говорят «ничего не ждёт», отказ RPC показан честно", async () => {
  const app = await mountMemoryApp({
    async listPublicationReviews() { return { reviews: [], next_cursor: "" }; },
    async listCollaborations() { throw new Error("forbidden"); },
    async listAgentConnections() { return { connections: [], next_cursor: "" }; },
  });
  try {
    const block = name => app.document.querySelector(`#root section[aria-label="${name}"]`);
    await app.until(() => block("Мои агенты")?.textContent.includes("Ничего не ждёт"), "пустой блок агентов");
    await app.until(() => block("Ждут моего решения")?.textContent.includes("По документам и заданиям решений пока нет."), "пустой блок решений");
    await app.until(() => block("Поручено мне")?.textContent.includes("Обращения недоступны"), "отказ RPC в блоке поручений");
    await app.until(() => block("Заблокировано")?.textContent.includes("Ничего не ждёт"), "пустой блок заблокированного");
    assert.ok(app.button("Мои загрузки"), "личный раздел «Мои загрузки» достижим отсюда");
  } finally { app.dispose(); }
});
