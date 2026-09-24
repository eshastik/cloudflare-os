import { test } from "node:test";
import assert from "node:assert/strict";
import { INBOX_FILTER, inboxCounts, inboxDecisions, inboxEntries } from "./inbox-count.ts";
import { managementSections } from "./management-sections.ts";

const review = (extra: Record<string, unknown>) => ({ candidate_id: "c", project_id: "p", author_id: "bob", ready: false, stale: false, domains: [], ...extra }) as never;
const domain = (approvers: string[], decided: string[] = []) => ({ domain_id: "d", node_ids: [], approvers, decisions: decided.map(approver_id => ({ approver_id, approved: true })) });

test("Счётчик «Входящих»: мои несогласованные решения, публикация одобренного и приёмка работы", () => {
  const reviews = [
    review({ domains: [domain(["alice"]), domain(["alice", "bob"], ["alice"])] }),
    review({ stale: true, domains: [domain(["alice"])] }),
    review({ author_id: "alice", ready: true }),
    review({ author_id: "alice", ready: true, stale: true }),
  ];
  const collaborations = [
    { request: { request_id: "1", requester_user_id: "alice" }, progress: { state: "awaiting_review" } },
    { request: { request_id: "2", requester_user_id: "alice" }, progress: { state: "awaiting_result" } },
    { request: { request_id: "3", requester_user_id: "bob" }, progress: { state: "awaiting_review" } },
    { request: { request_id: "4", requester_user_id: "alice" }, progress: null },
  ] as never[];
  assert.equal(inboxDecisions(reviews, collaborations, "alice"), 3);
  assert.equal(inboxDecisions(reviews, collaborations, ""), 0);
});

test("Счётчик попадает только в раздел «Входящие» и только когда он прочитан", () => {
  const identity = { subject: { tenant_id: "t", user_id: "alice" }, capabilities: [] } as never;
  assert.equal(managementSections(identity, 4).find(s => s.id === "my-work")?.count, 4);
  assert.equal("count" in managementSections(identity).find(s => s.id === "my-work")!, false);
  assert.equal(managementSections(identity, 4).filter(s => s.count !== undefined).length, 1);
});

test("Входящие: шаблоны и вопросы приёмной входят в список и в счётчик, отозванное и своё — нет, новое сверху", () => {
  const scope = { scope_id: "s" } as never;
  const proposal = (id: string, user: string, at: string) => ({ proposal: { proposal_id: id, user_id: user, created_at: at } }) as never;
  const alert = (id: string, status: string, at: string) => ({ id, status, raised_at: at, paths: [] }) as never;
  const reviews = [review({ domains: [domain(["alice"])] }), review({ candidate_id: "w", withdrawn: true, domains: [domain(["alice"])] })];
  const templates = [{ scope, review: proposal("p1", "bob", "2026-09-20T00:00:00Z") }, { scope, review: proposal("p2", "alice", "2026-09-21T00:00:00Z") }, { scope, review: { ...proposal("p3", "bob", "2026-09-19T00:00:00Z"), decision: {} } as never }];
  const alerts = [{ project: "a", alert: alert("x", "open", "2026-09-22T00:00:00Z") }, { project: "b", alert: alert("x", "open", "2026-09-22T00:00:00Z") }, { project: "a", alert: alert("y", "decided", "2026-09-23T00:00:00Z") }];
  const entries = inboxEntries({ reviews, collaborations: [], templates, alerts }, "alice");
  assert.deepEqual(entries.map(e => e.key), ["approval/c/d", "intake/x", "template/p1"]);
  assert.equal(inboxDecisions(reviews, [], "alice", { templates, alerts }), 3);
  assert.equal(INBOX_FILTER.intake, "intake");
  assert.equal(INBOX_FILTER.acceptance, "agents");
});

test("Согласования: счётчик — только решения по чужой работе; «Мой отдел» — руководителю и ответственному", () => {
  const reviews = [review({ domains: [domain(["alice"])] }), review({ author_id: "alice", ready: true })];
  const shares = [{ request_id: "r1", status: "pending", requested_by: "bob", created_at: "2026-09-23T00:00:00Z" }, { request_id: "r2", status: "pending", requested_by: "alice" }] as never[];
  const collaborations = [{ request: { request_id: "1", requester_user_id: "alice" }, progress: { state: "awaiting_review" } }] as never[];
  // Решение по чужой публикации и запрос отдела; своя публикация и приёмка своей работы — только во «Входящих».
  assert.deepEqual(inboxCounts(reviews, collaborations, "alice", { shares }), { inbox: 4, approvals: 2 });
  const employee = { subject: { tenant_id: "t", user_id: "alice" }, capabilities: [], roles: { department_head: false, project_responsible: false, can_create_projects: true, responsible_projects: [] } } as never;
  const sections = managementSections(employee, 4, 2);
  assert.equal(sections.find(s => s.id === "approvals")?.count, 2);
  assert.equal(sections.some(s => s.id === "team"), false);
  const head = { subject: { tenant_id: "t", user_id: "alice" }, capabilities: [], roles: { department_head: true, project_responsible: false, can_create_projects: true, responsible_projects: [] } } as never;
  assert.deepEqual(managementSections(head).find(s => s.id === "team"), { id: "team", title: "Мой отдел", group: "manage" });
  const responsible = { subject: { tenant_id: "t", user_id: "alice" }, capabilities: [], roles: { department_head: false, project_responsible: true, can_create_projects: false, responsible_projects: ["p"] } } as never;
  assert.equal(managementSections(responsible).some(s => s.id === "team"), true);
  // Старый сервер без ролей: раздела нет, а не пустой раздел.
  assert.equal(managementSections({ subject: { tenant_id: "t", user_id: "alice" }, capabilities: [] } as never).some(s => s.id === "team"), false);
});
