import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAPI, MnemosAPIError } from "./mnemos-api.ts";
import { decideNotification, prepareNotificationDecision, readNotificationPage, readNotificationSettings, saveNotificationSettings, type NotificationSession } from "./telegram-notifications.ts";
import type { PublicationReview } from "@gadgets/workshop-shared/publication-review";

const REVIEW_ID = "c".repeat(64);
const REVIEW_OBJECT = { type: "publication_review", id: REVIEW_ID, project_id: "p1", domain_id: "d1" };
const SHARE_OBJECT = { type: "share_request", id: "r1", project_id: "p1" };
const TASK_OBJECT = { type: "collaboration", id: "t1", project_id: "p1" };

function review(overrides: Partial<PublicationReview> = {}): PublicationReview {
  return { candidate_id: REVIEW_ID, project_id: "p1", author_id: "bob", personal_head: "a".repeat(64), shared_head: "b".repeat(64), decision_version: 3,
    stale: false, ready: false, domains: [{ domain_id: "d1", node_ids: ["n1", "n2"], approvers: ["alice"], decisions: [] }, { domain_id: "d2", node_ids: ["n3"], approvers: ["carol"], decisions: [] }], ...overrides };
}

function session(overrides: Partial<NotificationSession> = {}) {
  let calls: unknown[][] = [];
  let base: NotificationSession = {
    whoAmI: async () => ({ subject: { tenant_id: "t", user_id: "alice" }, tenant_name: "Орг", capabilities: [] }),
    readNotifications: async () => ({ items: [], next_after: 0, delivered: 0, more: false }),
    acknowledgeNotifications: async sequence => ({ delivered: sequence }),
    readNotificationSettings: async () => ({ kinds: { decision_needed: true, task_result: true, shared_with_me: true, platform_failure: false } }),
    saveNotificationSettings: async kinds => { calls.push(["save", kinds]); return { kinds }; },
    readPublicationReview: async () => review(),
    recordReviewDecision: async (...args) => { calls.push(["review", ...args]); },
    listShareRequests: async () => ({ requests: [{ request_id: "r1", project_id: "p1", project_name: "Отчёты", level: "department", can_edit: false, org_unit_name: "Продажи",
      requested_by: "anna", requested_by_name: "Анна", decider: "head", status: "pending", created_at: "2026-09-24T10:00:00Z" }] }),
    decideShareRequest: async (id, approve) => { calls.push(["share", id, approve]); return { request_id: id, project_id: "p1", project_name: "Отчёты", level: "department", can_edit: false,
      requested_by: "anna", requested_by_name: "Анна", decider: "head", status: approve ? "approved" : "rejected", created_at: "x" }; },
    readCollaborationProgress: async () => ({ state: "awaiting_review", result_sequence: 4, review_revision: 2 }),
    reviewCollaborationResult: async (id, input) => { calls.push(["accept", id, input]); return {} as never; },
    ...overrides,
  };
  return { session: base, calls };
}

test("страница очереди проверяется строго", async () => {
  let { session: s } = session({ readNotifications: async () => ({ items: [{ sequence: 2, kind: "decision_needed", object: REVIEW_OBJECT, summary: "Нужно", created_at: "t" }], next_after: 2, delivered: 0, more: false }) });
  assert.equal((await readNotificationPage(s, null, 20)).items.length, 1);
  for (let bad of [
    { items: [{ sequence: 2, kind: "other", object: REVIEW_OBJECT, summary: "x", created_at: "t" }], next_after: 2, delivered: 0, more: false },
    { items: [{ sequence: 3, kind: "decision_needed", object: REVIEW_OBJECT, summary: "x", created_at: "t" }], next_after: 2, delivered: 0, more: false },
    { items: [{ sequence: 2, kind: "decision_needed", object: { ...REVIEW_OBJECT, owner_id: "x" }, summary: "x", created_at: "t" }], next_after: 2, delivered: 0, more: false },
    { items: [], next_after: -1, delivered: 0, more: false },
  ]) {
    let { session: broken } = session({ readNotifications: async () => bad });
    await assert.rejects(readNotificationPage(broken, null, 20), (e: unknown) => e instanceof MnemosAPIError && e.status === 502);
  }
});

test("согласование: версия при отправке; решение — по всем моим областям с той же версией", async () => {
  let { session: s, calls } = session();
  assert.deepEqual(await prepareNotificationDecision(s, REVIEW_OBJECT), { version: 3, details: ["Документов на согласовании: 2"] });
  assert.deepEqual(await decideNotification(s, REVIEW_OBJECT, 3, "approve"), { status: "approved" });
  assert.deepEqual(calls, [["review", REVIEW_ID, "d1", 3, true]]);
});

test("кнопка решает ровно область из уведомления, а не все области человека", async () => {
  let two = review({ domains: [
    { domain_id: "d1", node_ids: ["n1"], approvers: ["alice"], decisions: [] },
    { domain_id: "d2", node_ids: ["n2", "n3", "n4"], approvers: ["alice"], decisions: [] },
  ] });
  let { session: s, calls } = session({ readPublicationReview: async () => two });
  assert.deepEqual(await prepareNotificationDecision(s, { ...REVIEW_OBJECT, domain_id: "d2" }), { version: 3, details: ["Документов на согласовании: 3"] });
  assert.deepEqual(await decideNotification(s, { ...REVIEW_OBJECT, domain_id: "d2" }, 3, "reject"), { status: "rejected" });
  assert.deepEqual(calls, [["review", REVIEW_ID, "d2", 3, false]]);
  // Область, где человек не согласующий, кнопкой не решается.
  let { session: other, calls: none } = session();
  assert.equal((await decideNotification(other, { ...REVIEW_OBJECT, domain_id: "d2" }, 3, "approve")).status, "stale");
  assert.deepEqual(none, []);
});

test("согласование изменилось после уведомления — кнопкой не решается", async () => {
  let { session: s, calls } = session({ readPublicationReview: async () => review({ decision_version: 4 }) });
  let out = await decideNotification(s, REVIEW_OBJECT, 3, "approve");
  assert.equal(out.status, "stale");
  assert.deepEqual(calls, []);
  let { session: decided } = session({ readPublicationReview: async () => review({ domains: [{ domain_id: "d1", node_ids: ["n1"], approvers: ["alice"], decisions: [{ approver_id: "alice", approved: true }] }] }) });
  assert.equal((await decideNotification(decided, REVIEW_OBJECT, 3, "reject")).status, "stale");
  assert.deepEqual(await prepareNotificationDecision(decided, REVIEW_OBJECT), { version: null, details: [] });
  let { session: withdrawn } = session({ readPublicationReview: async () => review({ withdrawn: true }) });
  assert.equal((await decideNotification(withdrawn, REVIEW_OBJECT, 3, "approve")).status, "stale");
});

test("запрос открыть проект: решение и отказы сервера", async () => {
  let { session: s, calls } = session();
  let ticket = await prepareNotificationDecision(s, SHARE_OBJECT);
  assert.equal(ticket.version, 0);
  assert.deepEqual(ticket.details, ["Кто просит: Анна", "Открыть отделу «Продажи», только чтение"]);
  assert.deepEqual(await decideNotification(s, SHARE_OBJECT, 0, "reject"), { status: "rejected" });
  assert.deepEqual(calls, [["share", "r1", false]]);
  let { session: consent } = session({ decideShareRequest: async () => { throw new MnemosAPIError(409, "project.private_code_consent"); } });
  assert.equal((await decideNotification(consent, SHARE_OBJECT, 0, "approve")).status, "site");
  let { session: decided } = session({ decideShareRequest: async () => { throw new MnemosAPIError(409); } });
  assert.equal((await decideNotification(decided, SHARE_OBJECT, 0, "approve")).status, "stale");
  let { session: failing } = session({ decideShareRequest: async () => { throw new MnemosAPIError(503); } });
  await assert.rejects(decideNotification(failing, SHARE_OBJECT, 0, "approve"));
});

test("приёмка: только «принять» кнопкой, с номером результата из уведомления", async () => {
  let { session: s, calls } = session();
  assert.equal((await prepareNotificationDecision(s, TASK_OBJECT)).version, 4);
  assert.equal((await decideNotification(s, TASK_OBJECT, 4, "reject")).status, "site");
  assert.deepEqual(calls, []);
  assert.deepEqual(await decideNotification(s, TASK_OBJECT, 4, "approve"), { status: "approved" });
  let [, id, input] = calls[0] as [string, string, { expected_revision: number; result_sequence: number; decision: string; comment: string }];
  assert.equal(id, "t1");
  assert.deepEqual({ ...input, review_id: "" }, { review_id: "", expected_revision: 2, result_sequence: 4, decision: "accepted", comment: "" });
  let { session: newer } = session({ readCollaborationProgress: async () => ({ state: "awaiting_review", result_sequence: 5, review_revision: 2 }) });
  assert.equal((await decideNotification(newer, TASK_OBJECT, 4, "approve")).status, "stale");
});

test("неверный объект или решение — отказ до сервера", async () => {
  let { session: s, calls } = session();
  await assert.rejects(decideNotification(s, { type: "document", id: "n1", project_id: "p1" }, 0, "approve"), (e: unknown) => e instanceof MnemosAPIError && e.status === 400);
  await assert.rejects(decideNotification(s, REVIEW_OBJECT, -1, "approve"));
  await assert.rejects(decideNotification(s, REVIEW_OBJECT, 3, "maybe"));
  assert.deepEqual(calls, []);
});

test("настройки: «сбои системы» видны и меняются только у администратора", async () => {
  let { session: s, calls } = session();
  assert.deepEqual(await readNotificationSettings(s), { kinds: { decision_needed: true, task_result: true, shared_with_me: true, platform_failure: false }, platformFailure: false });
  let saved = await saveNotificationSettings(s, { decision_needed: false, task_result: true, shared_with_me: true, platform_failure: true });
  assert.deepEqual(calls[0], ["save", { decision_needed: false, task_result: true, shared_with_me: true, platform_failure: false }]);
  assert.equal(saved.kinds.platform_failure, false);
  let { session: admin, calls: adminCalls } = session({ whoAmI: async () => ({ subject: { tenant_id: "t", user_id: "alice" }, tenant_name: "Орг", capabilities: ["platform.metrics.read"] }) });
  await saveNotificationSettings(admin, { decision_needed: true, task_result: true, shared_with_me: true, platform_failure: true });
  assert.equal((adminCalls[0][1] as Record<string, boolean>).platform_failure, true);
  await assert.rejects(saveNotificationSettings(s, { decision_needed: true }), (e: unknown) => e instanceof MnemosAPIError && e.status === 400);
  await assert.rejects(saveNotificationSettings(s, { decision_needed: true, task_result: true, shared_with_me: true, platform_failure: true, extra: true }));
});

test("клиент Mnemos: адреса и тела запросов очереди", async () => {
  let seen: { url: string; method: string; body?: string }[] = [];
  let api = new MnemosAPI("https://mnemos.example.ru", async () => "token", (async (url: string, init: RequestInit) => {
    seen.push({ url, method: String(init.method), ...(init.body ? { body: String(init.body) } : {}) });
    return Response.json({ ok: true });
  }) as unknown as typeof fetch);
  await api.readNotifications(null, 20);
  await api.readNotifications(7, 100);
  await api.acknowledgeNotifications(7);
  await api.saveNotificationSettings({ decision_needed: true });
  assert.deepEqual(seen, [
    { url: "https://mnemos.example.ru/v1/me/notifications?limit=20", method: "GET" },
    { url: "https://mnemos.example.ru/v1/me/notifications?after=7&limit=100", method: "GET" },
    { url: "https://mnemos.example.ru/v1/me/notifications/delivered", method: "POST", body: '{"sequence":7}' },
    { url: "https://mnemos.example.ru/v1/me/notification-settings", method: "PUT", body: '{"kinds":{"decision_needed":true}}' },
  ]);
  assert.throws(() => api.readNotifications(0, 101));
  assert.throws(() => api.acknowledgeNotifications(-1));
});
