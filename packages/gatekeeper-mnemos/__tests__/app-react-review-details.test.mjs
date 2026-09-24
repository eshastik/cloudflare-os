import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

const review = {
  candidate_id: "e".repeat(64), project_id: "one", author_id: "bob",
  personal_head: "a".repeat(64), shared_head: "b".repeat(64), decision_version: 7,
  stale: false, ready: false,
  domains: [
    { domain_id: "Юридическая", node_ids: ["doc"], approvers: ["alice"], decisions: [] },
    { domain_id: "Финансовая", node_ids: ["plan"], approvers: ["carol", "dave"], decisions: [{ approver_id: "carol", approved: true }] },
  ],
};

test("согласующий проверяет точную версию и видит решения всех доступных областей", async () => {
  const app = await mountMemoryApp({ async listPublicationReviews() { return { reviews: [review], next_cursor: "" }; } }, { section: "approvals" });
  try {
    // Строка списка открывает подробности предложения в панели справа.
    await app.until(() => app.document.querySelector('#root [data-inbox="approval"]'), "строка согласования");
    app.document.querySelector('#root [data-inbox="approval"] button').click();
    await app.until(() => app.text().includes("dave: ожидает решения"), "матрица областей");
    assert.ok(app.text().includes("carol: одобрено"));
    assert.ok(app.text().includes("Юридическая") && app.text().includes("Финансовая"));
    app.button("Заметка команды").click();
    await app.until(() => app.text().includes("Исходный текст") && app.text().includes("Новая версия"), "две стороны версии");
    assert.deepEqual(app.calls.filter(c => c[0] === "downloadReviewText"), [
      ["downloadReviewText", review.candidate_id, "doc", 7, "before"],
      ["downloadReviewText", review.candidate_id, "doc", 7, "after"],
    ]);
    assert.equal(app.calls.filter(c => c[0] === "recordReviewDecision").length, 0);
    app.button("Согласовать").click();
    await app.until(() => app.calls.some(c => c[0] === "recordReviewDecision"), "решение");
    assert.deepEqual(app.calls.find(c => c[0] === "recordReviewDecision"), ["recordReviewDecision", review.candidate_id, "Юридическая", 7, true]);
  } finally { app.dispose(); }
});

test("отозванное предложение не позволяет записать решение", async () => {
  const app = await mountMemoryApp({ async listPublicationReviews() { return { reviews: [{ ...review, withdrawn: true }], next_cursor: "" }; } }, { section: "approvals" });
  try {
    await app.until(() => app.text().includes("автор отозвал предложение"), "отзыв предложения");
    assert.equal(app.button("Одобрить"), undefined);
    assert.equal(app.button("Отклонить"), undefined);
  } finally { app.dispose(); }
});
