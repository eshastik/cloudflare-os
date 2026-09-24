import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAPIError } from "./mnemos-api.ts";
import { agentActionError, checkedAgentAction, checkedAgentRead, executeAgentAction, pickOne, prepareAgentAction, readForAgent, type AgentActionRequest } from "./agent-actions.ts";

const HEAD = "a".repeat(64), SHARED = "c".repeat(64);
const PROJECTS = [{ id: "p1", name: "Продажи", slug: "sales" }, { id: "p2", name: "Архив", slug: "archive" }];

/** Сессия человека с ответами сервера; calls — всё, что меняет состояние. */
function session(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  let reviewVersion = 3, budgetRevision = 7;
  const s = {
    calls,
    async whoAmI() { return { subject: { tenant_id: "org", user_id: "alice" }, tenant_name: "Орг" }; },
    async listProjects() { return { projects: PROJECTS }; },
    async draftState() { return { personal_exists: true, personal_head: HEAD, shared_head: SHARED }; },
    async readPublicationReview(id: string) {
      if (id !== "rev-1" && id !== "rev-mine") throw new MnemosAPIError(404);
      return { candidate_id: id, project_id: "p1", author_id: id === "rev-mine" ? "alice" : "bob", personal_head: HEAD, shared_head: SHARED, decision_version: reviewVersion,
        stale: false, ready: id === "rev-mine", domains: [
          { domain_id: "finance", node_ids: ["n1", "n2"], approvers: ["alice"], decisions: [] },
          { domain_id: "legal", node_ids: ["n3"], approvers: ["carol"], decisions: [] },
        ] };
    },
    async recordReviewDecision(id: string, domain: string, version: number, approved: boolean) { calls.push(`decide:${id}:${domain}:${version}:${approved}`); reviewVersion++; },
    async withdrawPublicationReview(id: string) { calls.push(`withdraw:${id}`); },
    async publishReview(project: string, id: string) { calls.push(`publish:${project}:${id}`); return { published: true, conflicted: false }; },
    async listShareRequests(mine = false) {
      return { requests: mine ? [] : [{ request_id: "sr-1", project_id: "p9", project_name: "Бюджет", level: "organization", can_edit: false, requested_by: "bob", requested_by_name: "Борис Орлов", decider: "admin", status: "pending", created_at: "" }] };
    },
    async decideShareRequest(id: string, approve: boolean) { calls.push(`share-request:${id}:${approve}`); return { request_id: id, status: approve ? "approved" : "rejected" }; },
    async setProjectVisibility(project: string, level: string, canEdit: boolean) { calls.push(`visibility:${project}:${level}:${canEdit}`); return { project_id: project, visibility: level, can_edit: canEdit, applied: level !== "organization" }; },
    async listOrgUnits() { return [
      { org_unit_id: "ou-sales", name: "Отдел продаж", members: [{ principal_id: "u-nik", display_name: "Николай Деревцов", is_head: false }] },
      { org_unit_id: "ou-law", name: "Юристы", members: [{ principal_id: "u-ira", display_name: "Ирина Ким", is_head: true }] },
    ]; },
    async createOrgUnit(name: string) { calls.push(`create-unit:${name}`); return { org_unit_id: "ou-new", name, members: [] }; },
    async deleteOrgUnit(id: string) { calls.push(`delete-unit:${id}`); return { projects_made_private: 2, members_removed: 1 }; },
    async setOrgUnitMember(unit: string, who: string, member: boolean, head: boolean) { calls.push(`member:${unit}:${who}:${member}:${head}`); },
    async listInvitations() { return [
      { invitation_id: "inv-1", email: "petr@example.ru", display_name: "Пётр", status: "open", expires_at: "2026-10-01" },
      { invitation_id: "inv-2", email: "old@example.ru", display_name: "Старый", status: "revoked", expires_at: "" },
    ]; },
    async createInvitation(email: string, name: string, unit: string, role: string) { calls.push(`invite:${email}:${name}:${unit}:${role}`); return { invitation_id: "inv-3", email, email_status: "sent" }; },
    async revokeInvitation(id: string) { calls.push(`revoke-invite:${id}`); return { invitation_id: id }; },
    async readProjectBudget(project: string) { return { project_id: project, revision: budgetRevision, owner_id: "alice", limit_usd_micros: "50000000", automatic_usd_micros: "20000000", automatic_team_size: 3 }; },
    async setProjectBudget(project: string, policy: Record<string, unknown>) { calls.push(`budget:${project}:${JSON.stringify(policy)}`); budgetRevision++; return policy; },
    async listMailConnections() { return { connections: [{ connection_id: "mc-1", project_id: "p1", provider: "Почта продаж", query_sha256: "", revision: 4, enabled: true }] }; },
    async listCalendarConnections() { return { connections: [] }; },
    async listGitConnections() { return { connections: [{ connection_id: "gc-1", name: "GitHub компании", account_login: "acme", provider: "github", revision: 2, enabled: true }] }; },
    async disableMailConnection(id: string, revision: number) { calls.push(`disable-mail:${id}:${revision}`); },
    async disableCalendarConnection() { throw new Error("не ожидался"); },
    async disableGitConnection(id: string, revision: number) { calls.push(`disable-git:${id}:${revision}`); },
    async listPublicationReviews() { return { reviews: [await s.readPublicationReview("rev-1"), await s.readPublicationReview("rev-mine")], next_cursor: "" }; },
    async listWorkJournal() { return { entries: [{ entry_id: 1, project_id: "p1", recorded_at: "2026-09-24", recorded_by: "alice", actor: "Агент Workshop", source: "publication", summary: "Опубликован план", changed: ["План"], result: {}, outcome: "accepted" }], truncated: false }; },
    async readSpending(period: string) { return { period, all_visible: false, micro_usd: "1234567", count: 5, estimated_count: 0, kinds: [], operations: [], projects: [{ key: "p1", name: "Продажи", micro_usd: "1000000", count: 3, estimated_count: 0 }], people: [], agents: [], models: [] }; },
    ...overrides,
  };
  return s as typeof s & Record<string, any>;
}
const SCOPE = new Set(["p1"]);
async function run(s: ReturnType<typeof session>, request: AgentActionRequest, scope = SCOPE) {
  const prepared = await prepareAgentAction(s as any, scope, checkedAgentAction(request));
  return { prepared, outcome: await executeAgentAction(s as any, prepared.kind, prepared.resolved) };
}

test("аргументы: неизвестное действие, лишние поля и неверные значения отвергаются до обращения к серверу", () => {
  assert.throws(() => checkedAgentAction({ kind: "grant_everything" }), /Неизвестное действие/);
  assert.throws(() => checkedAgentAction({ kind: "create_department", name: "Отдел", url: "https://x" }), /Лишние параметры/);
  assert.throws(() => checkedAgentAction({ kind: "invite_person", email: "не почта", name: "Пётр", department: "", role: "employee" }), /почта/);
  assert.throws(() => checkedAgentAction({ kind: "invite_person", email: "p@x.ru", name: "Пётр", department: "", role: "owner" }), /role/);
  assert.throws(() => checkedAgentAction({ kind: "set_project_budget", project: "p1", limitUsd: -1 }), /limitUsd/);
  assert.throws(() => checkedAgentAction({ kind: "decide_review", review: "rev-1", approve: "да" }), /approve/);
  assert.throws(() => checkedAgentAction({ kind: "disable_connection", type: "telegram", connection: "x" }), /type/);
  assert.throws(() => checkedAgentRead({ kind: "spending", period: "year" }), /period/);
  assert.deepEqual(checkedAgentAction({ kind: "set_project_budget", project: " p1 ", limitUsd: 12.345 }), { kind: "set_project_budget", project: "p1", limitUsd: 12.35 });
});

test("поиск по имени: id, точное имя, падеж, неоднозначность и отсутствие", () => {
  const people = [{ id: "1", name: "Николай Деревцов" }, { id: "2", name: "Ольга Деревцова" }, { id: "3", name: "Семён Ёлкин" }];
  const pick = (q: string) => pickOne(people, q, p => p.id, p => p.name, "сотрудник").id;
  assert.equal(pick("2"), "2");
  assert.equal(pick("николай деревцов"), "1");
  assert.equal(pick("Николаю Деревцову"), "1");
  assert.equal(pick("семен елкин"), "3");
  assert.throws(() => pick("Деревцов"), /несколько/);
  assert.throws(() => pick("Пётр"), /Не найдено[\s\S]*Есть: Николай Деревцов/);
});

test("решение по согласованию: только по своим направлениям, с проверкой версии", async () => {
  const s = session();
  const { prepared, outcome } = await run(s, { kind: "decide_review", review: "rev-1", approve: true });
  assert.equal(prepared.title, "Согласовать изменения в проекте «Продажи»");
  assert.deepEqual(prepared.details, ["Документов на решении: 2", "После всех согласий автор сможет опубликовать изменения"]);
  assert.equal(prepared.ownerOnly, true);
  assert.deepEqual(s.calls, ["decide:rev-1:finance:3:true"], "чужое направление legal не трогается");
  assert.equal(outcome.summary, "Согласовано: изменения проекта «Продажи»");
  // Версия ушла вперёд между предложением и подтверждением — решение не записывается.
  const moved = session();
  const stale = await prepareAgentAction(moved as any, SCOPE, { kind: "decide_review", review: "rev-1", approve: false });
  await moved.recordReviewDecision("rev-1", "other", 3, true); moved.calls.length = 0;
  await assert.rejects(executeAgentAction(moved as any, stale.kind, stale.resolved), /изменилось/);
  assert.deepEqual(moved.calls, []);
  const outsider = session({ async whoAmI() { return { subject: { tenant_id: "org", user_id: "zoe" }, tenant_name: "" }; } });
  await assert.rejects(prepareAgentAction(outsider as any, SCOPE, { kind: "decide_review", review: "rev-1", approve: true }), /не требуется/);
  await assert.rejects(prepareAgentAction(session() as any, SCOPE, { kind: "decide_review", review: "missing", approve: true }), /не найдено/);
});

test("отзыв и публикация согласованного — только автором и в области агента", async () => {
  const s = session();
  assert.equal((await run(s, { kind: "publish_review", review: "rev-mine" })).outcome.summary, "Изменения проекта «Продажи» опубликованы");
  assert.equal((await run(s, { kind: "withdraw_review", review: "rev-mine" })).prepared.icon, "delete");
  assert.deepEqual(s.calls, ["publish:p1:rev-mine", "withdraw:rev-mine"]);
  await assert.rejects(prepareAgentAction(session() as any, SCOPE, { kind: "withdraw_review", review: "rev-1" }), /только автор/);
  await assert.rejects(prepareAgentAction(session() as any, new Set(), { kind: "publish_review", review: "rev-mine" }), /не подключён к агенту/);
});

test("запрос на видимость, видимость проекта, приглашения и отделы", async () => {
  const s = session();
  const request = await run(s, { kind: "decide_access_request", request: "sr-1", approve: true });
  assert.equal(request.prepared.title, "Разрешить: проект «Бюджет» виден всей организации");
  assert.deepEqual(request.prepared.details, ["Просит Борис Орлов", "Только чтение"]);
  assert.equal(request.outcome.summary, "Разрешено: видимость проекта «Бюджет»");
  await assert.rejects(prepareAgentAction(s as any, SCOPE, { kind: "decide_access_request", request: "sr-x", approve: true }), /не найден/);

  const visibility = await run(s, { kind: "set_project_visibility", project: "Продажи", level: "organization", canEdit: false });
  assert.equal(visibility.prepared.title, "Открыть проект «Продажи» всей организации — только чтение");
  assert.equal(visibility.outcome.summary, "Запрос на видимость проекта «Продажи» отправлен на решение");
  await assert.rejects(prepareAgentAction(s as any, SCOPE, { kind: "set_project_visibility", project: "Архив", level: "department", canEdit: true }), /не подключён/);

  const invite = await run(s, { kind: "invite_person", email: "ivan@example.ru", name: "Иван Петров", department: "продаж", role: "employee" });
  assert.equal(invite.prepared.title, "Пригласить Иван Петров (ivan@example.ru) в организацию");
  assert.deepEqual(invite.prepared.details, ["Роль: сотрудник, отдел «Отдел продаж»", "На почту уйдёт письмо с приглашением"]);
  assert.equal(invite.outcome.summary, "Приглашение для ivan@example.ru создано и отправлено");
  assert.equal((await run(s, { kind: "revoke_invitation", invitation: "petr@example.ru" })).outcome.summary, "Приглашение для petr@example.ru отозвано");
  await assert.rejects(prepareAgentAction(s as any, SCOPE, { kind: "revoke_invitation", invitation: "old@example.ru" }), /Не найдено/);

  assert.equal((await run(s, { kind: "create_department", name: "Маркетинг" })).outcome.summary, "Отдел «Маркетинг» создан");
  const removal = await run(s, { kind: "delete_department", department: "Юристы" });
  assert.deepEqual(removal.prepared.details, ["Сотрудников в отделе: 1; они останутся в организации без отдела", "Проекты отдела станут личными"]);
  const move = await run(s, { kind: "set_department_member", department: "Юристы", person: "Николай Деревцов", member: true, head: false });
  assert.equal(move.prepared.title, "Добавить Николай Деревцов в отдел «Юристы»");
  assert.deepEqual(s.calls, ["share-request:sr-1:true", "visibility:p1:organization:false", "invite:ivan@example.ru:Иван Петров:ou-sales:employee",
    "revoke-invite:inv-1", "create-unit:Маркетинг", "delete-unit:ou-law", "member:ou-law:u-nik:true:false"]);
});

test("лимит проекта и отключение подключений: версия сверяется, порог без согласования не выше лимита", async () => {
  const s = session();
  const budget = await run(s, { kind: "set_project_budget", project: "p1", limitUsd: 10 });
  assert.equal(budget.prepared.title, "Лимит расходов проекта «Продажи»: $10");
  assert.deepEqual(budget.prepared.details, ["Сейчас $50"]);
  assert.deepEqual(JSON.parse(s.calls[0].slice("budget:p1:".length)), { revision: 7, owner_id: "alice", limit_usd_micros: "10000000", automatic_usd_micros: "10000000", automatic_team_size: 3 });
  const stale = await prepareAgentAction(s as any, SCOPE, { kind: "set_project_budget", project: "p1", limitUsd: 100 });
  await s.setProjectBudget("p1", {}); s.calls.length = 0;
  await assert.rejects(executeAgentAction(s as any, stale.kind, stale.resolved), /изменился/);
  assert.deepEqual(s.calls, []);

  const mail = await run(s, { kind: "disable_connection", type: "mail", connection: "Почта продаж" });
  assert.equal(mail.prepared.icon, "mail");
  const git = await run(s, { kind: "disable_connection", type: "git", connection: "GitHub компании" });
  assert.equal(git.prepared.title, "Отключить подключение репозиториев кода «GitHub компании»");
  assert.deepEqual(s.calls, ["disable-mail:mc-1:4", "disable-git:gc-1:2"]);
  await assert.rejects(prepareAgentAction(s as any, SCOPE, { kind: "disable_connection", type: "calendar", connection: "любой" }), /Не найдено/);
});

test("агентская сессия не может готовить действие: только от имени человека", async () => {
  const s = session({ async whoAmI() { return { subject: { tenant_id: "org", user_id: "alice", agent_principal_id: "agent-1" }, tenant_name: "" }; } });
  await assert.rejects(prepareAgentAction(s as any, SCOPE, { kind: "create_department", name: "Отдел" }), /только от имени человека/);
});

test("сведения: согласования, запросы, отделы, приглашения, лимит, подключения, журнал, расходы", async () => {
  const s = session();
  const reviews = await readForAgent(s as any, { kind: "reviews" }) as any[];
  assert.deepEqual(reviews.map(r => [r.id, r.mine, r.waitsForMe, r.documents]), [["rev-1", false, true, 3], ["rev-mine", true, true, 3]]);
  assert.equal(((await readForAgent(s as any, { kind: "access_requests" })) as any).waitingForMe[0].requestedBy, "Борис Орлов");
  assert.equal(((await readForAgent(s as any, { kind: "departments" })) as any[])[1].members[0].head, true);
  assert.equal(((await readForAgent(s as any, { kind: "invitations" })) as any[]).length, 2);
  assert.deepEqual(await readForAgent(s as any, { kind: "project_budget", project: "Продажи" }), { project: "Продажи", limit: "$50", withoutApproval: "$20", teamSizeWithoutApproval: 3 });
  assert.deepEqual(await readForAgent(s as any, { kind: "connections", type: "git" }), [{ id: "gc-1", name: "GitHub компании", enabled: true }]);
  assert.equal(((await readForAgent(s as any, { kind: "work_journal", project: "p1" })) as any).entries[0].summary, "Опубликован план");
  assert.deepEqual(((await readForAgent(s as any, { kind: "spending", period: "7d" })) as any).total, "$1.23");
  assert.deepEqual(s.calls, [], "чтения ничего не меняют");
});

test("ошибки сервера переводятся в понятные агенту слова, без подробностей запроса", () => {
  assert.match(agentActionError(new MnemosAPIError(403)).message, /нет права/);
  assert.match(agentActionError(new MnemosAPIError(401)).message, /войдите заново/);
  assert.match(agentActionError(new MnemosAPIError(409)).message, /изменились/);
  assert.match(agentActionError(new MnemosAPIError(500)).message, /код 500/);
  assert.equal(agentActionError(new Error("Не найдено (сотрудник)")).message, "Не найдено (сотрудник)");
});
