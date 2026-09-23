import { test } from "node:test";
import assert from "node:assert/strict";
import { inboxDecisions } from "./inbox-count.ts";
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
