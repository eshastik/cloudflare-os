import { test } from "node:test";
import assert from "node:assert/strict";
import { checkedAgentAction, checkedAgentRead, executeAgentAction, prepareAgentAction, readForAgent, type AgentActionRequest } from "./agent-actions.ts";

const PROJECTS = [{ id: "p1", name: "Продажи", slug: "sales" }, { id: "p2", name: "Архив", slug: "archive" }];
const SCOPE = new Set(["p1"]);

/** Сессия человека с ответами сервера и источниками аккаунта; calls — всё, что меняет состояние. */
function session() {
  const calls: string[] = [];
  let policyRevision = 4, roleGeneration = 9, membershipGeneration = 2;
  const rules = { personal_projects_enabled: true, project_create_by: "everyone", share_department_approval: "head", share_organization_by: "admin", share_organization_approval: "admin", default_visibility: "private" };
  const domains = [{ domain_id: "Юристы", all_documents: true, node_ids: [], approver_ids: ["u-ira"] }, { domain_id: "Финансы", all_documents: false, node_ids: ["n1"], approver_ids: ["u-nik"] }];
  const s = {
    calls,
    async whoAmI() { return { subject: { tenant_id: "org", user_id: "alice" }, tenant_name: "Орг" }; },
    async listProjects() { return { projects: PROJECTS }; },
    async readProjectSharingSettings() { return { ...rules }; },
    async updateProjectSharingSettings(value: unknown) { calls.push(`rules:${JSON.stringify(value)}`); return value; },
    async listPolicyApprovers() { return { approvers: [{ principal_id: "u-nik", display_name: "Николай Деревцов" }, { principal_id: "u-ira", display_name: "Ирина Ким" }], next_cursor: "" }; },
    async readPublicationPolicy(project: string) { return { project_id: project, revision: policyRevision, domains: structuredClone(domains) }; },
    async setPublicationPolicy(project: string, revision: number, value: unknown) { calls.push(`policy:${project}:${revision}:${JSON.stringify(value)}`); policyRevision++; return { revision: policyRevision }; },
    async listPeople() { return { users: [{ userName: "u-nik", externalId: "", displayName: "Николай Деревцов" }, { userName: "u-old", externalId: "", displayName: "Бывший", active: false }] }; },
    async listPersonRights(principal: string) { return { principal_id: principal, exists: true, deactivated: false, rights: [
      { kind: "anchor", principal_id: principal, project_id: "p1", class: "filesystem", mode: "read" },
      { kind: "anchor", principal_id: principal, project_id: "p1", class: "filesystem", mode: "write" },
      { kind: "anchor", principal_id: principal, project_id: "p2", class: "filesystem", mode: "read" },
    ] }; },
    async removePersonRight(right: { project_id: string; mode: string }) { calls.push(`remove-right:${right.project_id}:${right.mode}`); return { outcome: "removed" }; },
    async removePerson(principal: string) { calls.push(`remove-person:${principal}`); return { outcome: "removed", agents_disabled: 1, invitations_removed: 0, rights_removed: 2 }; },
    async listOrganizationRoles() { return { roles: [{ id: "role-law", kind: "functional_role", name: "Юрист", active: true }, { id: "system:organization-admins", kind: "group", name: "Администраторы", active: true }], next_cursor: "", generation: roleGeneration }; },
    async createOrganizationRole(input: { name: string; expected_generation: number; kind: string }) { calls.push(`role:${input.name}:${input.kind}:${input.expected_generation}`); return { id: "new", kind: input.kind, name: input.name, active: true }; },
    async readPrincipalMembership(container: string, member: string) { return { container_id: container, member_id: member, enabled: false, generation: membershipGeneration }; },
    async setPrincipalMembership(container: string, member: string, decision: unknown) { calls.push(`membership:${container}:${member}:${JSON.stringify(decision)}`); return {}; },
    async listCollaborations() { return { requests: [
      { request_id: "col-1", title: "Проверить договор", project_id: "p1", requester_user_id: "alice" },
      { request_id: "col-2", title: "Чужое", project_id: "p1", requester_user_id: "bob" },
    ] }; },
    async readCollaborationProgress() { return { state: "awaiting_review", result_sequence: 3, review_revision: 1 }; },
    async reviewCollaborationResult(id: string, review: { expected_revision: number; result_sequence: number; decision: string; comment: string }) { calls.push(`acceptance:${id}:${review.expected_revision}:${review.result_sequence}:${review.decision}:${review.comment}`); return {}; },
    async listTemplateReviewScopes() { return { scopes: [{ scope_id: "sc-1", revision: 5, name: "Отдел продаж" }] }; },
    async listTemplateProposals() { return { proposals: [{ proposal: { proposal_id: "tp-1", template_key: "Коммерческое предложение", message: "Обновил" } }, { proposal: { proposal_id: "tp-2", template_key: "Старое" }, decision: { approved: true } }] }; },
    async saveTemplateDecision(id: string, input: { approved: boolean; scope_revision: number; comment: string }) { calls.push(`template-save:${id}:${input.approved}:${input.scope_revision}:${input.comment}`); return {}; },
    async executeSavedTemplateDecision(id: string) { calls.push(`template-execute:${id}`); return { receipt: {} }; },
    async inboxAlerts(_decided: boolean, project?: string) { return { truncated: false, alerts: [{ id: "al-1", status: "open", paths: ["договор.pdf"], proposed_project_slug: "sales", suggested_domain: "юристы", reason: "низкая уверенность", project }] }; },
    async decideInboxAlert(id: string, decision: unknown) { calls.push(`intake:${id}:${JSON.stringify(decision)}`); return {}; },
    async readProjectBudget(project: string) { return { project_id: project, revision: 6, owner_id: "alice", limit_usd_micros: "100000000", automatic_usd_micros: "0", automatic_team_size: 1 }; },
    async listTeamBudgets() { return { proposals: [{ id: "tb-1", state: "awaiting_approval", estimate_usd_micros: "5000000", limit_usd_micros: "8000000", member_count: 2 }] }; },
    async readTeamBudget(_project: string, id: string) { return { id, state: "awaiting_approval", proposal: { task: "Разбор архива", limit_usd_micros: "8000000", estimate_usd_micros: "5000000", members: [{}, {}] } }; },
    async decideTeamBudget(project: string, id: string, input: { expected_revision: number; policy_revision: number; decision: string }) { calls.push(`team-budget:${project}:${id}:${input.expected_revision}:${input.policy_revision}:${input.decision}`); return {}; },
    async listAgentConnections() { return { connections: [
      { binding_id: "b-chat", agent_principal_id: "a-chat", runtime_id: "workshop", runtime_agent_id: "", revoked: false },
      { binding_id: "b-ext", agent_principal_id: "a-ext", runtime_id: "external", runtime_agent_id: "", managed_runtime: false, revoked: false },
    ] }; },
    async revokeAgentConnection(binding: string) { calls.push(`revoke-agent:${binding}`); },
    async setAgentProjectRight(principal: string, project: string, mode: string, enabled: boolean) { calls.push(`agent-right:${principal}:${project}:${mode}:${enabled}`); return {}; },
    async listMailConnections() { return { connections: [{ connection_id: "mc-1", provider: "Почта продаж", enabled: true, revision: 3 }] }; },
    async listCalendarConnections() { return { connections: [] }; },
    async readMailGrantState(id: string, principal: string) { return { connection_id: id, principal_id: principal, connection_revision: 3, connection_enabled: true, revision: 7, enabled: false }; },
    async readCalendarGrantState() { throw new Error("не ожидался"); },
    async setMailReadGrant(id: string, decision: unknown) { calls.push(`mail-grant:${id}:${JSON.stringify(decision)}`); return {}; },
    async setCalendarReadGrant() { throw new Error("не ожидался"); },
    async listGitConnections() { return { connections: [{ connection_id: "gc-1", name: "Ключ GitLab", enabled: true, revision: 1 }] }; },
    async listGitRepositories() { return { repositories: [{ id: "r-9", name: "acme/wiki", default_branch: "master" }] }; },
    async listGitAppRepositories() { return { available: true, repositories: [{ installation_id: "in-1", id: "r-1", name: "acme/site", default_branch: "main", private: true }] }; },
    async listGitHubAccounts() { return { available: true, connectable: true, accounts: [{ installation_id: "in-1", account_login: "acme" }] }; },
    async disconnectGitHubAccount(id: string) { calls.push(`github-off:${id}`); return {}; },
    async listGitSyncLinks() { return { links: [{ link_id: "sl-1", project_id: "p1", repository_name: "acme/site", state: "ok", revision: 4, can_manage: true }] }; },
    async createGitSyncLink(input: unknown) { calls.push(`sync-create:${JSON.stringify(input)}`); return {}; },
    async refreshGitSyncLink(id: string) { calls.push(`sync-refresh:${id}`); return {}; },
    async deleteGitSyncLink(id: string, revision: number) { calls.push(`sync-delete:${id}:${revision}`); return {}; },
    async listVisibleDatabaseConnections() { return { databases: [{ project_id: "p1", name: "crm" }] }; },
    async removeDatabaseConnection(project: string, name: string) { calls.push(`db-off:${project}:${name}`); return {}; },
    async listImapAccounts() { return { accounts: [{ id: "im-1", username: "sales@acme.ru", mailbox: "INBOX", enabled: true }] }; },
    async removeImapAccount(id: string) { calls.push(`imap-off:${id}`); },
    async listCalDAVAccounts() { return { accounts: [{ id: "cd-1", username: "alice", enabled: true }] }; },
    async removeCalDAVAccount(id: string) { calls.push(`caldav-off:${id}`); },
    async listWebDAVAccounts() { return { accounts: [{ id: "wd-1", username: "disk-alice", enabled: true }] }; },
    async removeWebDAVAccount(id: string) { calls.push(`webdav-off:${id}`); },
    async listTelegram() { return { connections: [{ bot: "123", username: "acme_bot", disconnected: false }] }; },
    async disconnectTelegram(bot: string) { calls.push(`telegram-off:${bot}`); },
  };
  return s;
}

async function run(s: ReturnType<typeof session>, request: Record<string, unknown>, scope = SCOPE) {
  const before = s.calls.length;
  const prepared = await prepareAgentAction(s as any, scope, checkedAgentAction(request) as AgentActionRequest);
  assert.equal(s.calls.length, before, "подготовка ничего не меняет");
  const outcome = await executeAgentAction(s as any, prepared.kind, prepared.resolved);
  return { prepared, outcome };
}

test("правила организации: меняются только названные, карточка словами, неизвестное правило — отказ", async () => {
  const s = session();
  const { prepared, outcome } = await run(s, { kind: "update_org_rules", rules: { default_visibility: "department", personal_projects_enabled: true } });
  assert.equal(prepared.title, "Изменить правила организации о проектах");
  assert.deepEqual(prepared.details, ["Новые проекты видны: отделу"], "не изменившееся правило в карточку не попадает");
  assert.equal(prepared.ownerOnly, true);
  assert.equal(JSON.parse(s.calls[0].slice(6)).default_visibility, "department");
  assert.equal(JSON.parse(s.calls[0].slice(6)).project_create_by, "everyone", "остальные правила сохраняются");
  assert.equal(outcome.summary, "Правила организации о проектах изменены");
  assert.throws(() => checkedAgentAction({ kind: "update_org_rules", rules: { anyone_is_admin: true } }), /Неизвестное правило/);
  assert.throws(() => checkedAgentAction({ kind: "update_org_rules", rules: { default_visibility: "world" } }), /default_visibility/);
  await assert.rejects(prepareAgentAction(s as any, SCOPE, { kind: "update_org_rules", rules: { default_visibility: "private" } }), /уже такие/);
});

test("согласование проекта: направление добавляется и заменяется целиком, последнее не удаляется", async () => {
  const s = session();
  const added = await run(s, { kind: "set_review_domain", project: "Продажи", domain: "Маркетинг", approvers: ["Николай Деревцов", "Ирина"] });
  assert.equal(added.prepared.title, "Добавить согласование «Маркетинг» в проекте «Продажи»");
  assert.deepEqual(added.prepared.details, ["Согласуют: Николай Деревцов, Ирина Ким", "Все документы проекта, включая новые"]);
  const body = JSON.parse(s.calls[0].split(":").slice(3).join(":"));
  assert.equal(body.length, 3); assert.deepEqual(body[2], { domain_id: "Маркетинг", all_documents: true, node_ids: [], approver_ids: ["u-nik", "u-ira"] });
  assert.ok(s.calls[0].startsWith("policy:p1:4:"));
  s.calls.length = 0;
  const removed = await run(s, { kind: "remove_review_domain", project: "p1", domain: "Финансы" });
  assert.equal(removed.prepared.icon, "delete");
  assert.deepEqual(JSON.parse(s.calls[0].split(":").slice(3).join(":")).map((d: { domain_id: string }) => d.domain_id), ["Юристы"]);
  // Политика изменилась между предложением и подтверждением — запись не идёт.
  const stale = await prepareAgentAction(s as any, SCOPE, { kind: "set_review_domain", project: "p1", domain: "Юристы", approvers: ["u-nik"] });
  await s.setPublicationPolicy("p1", 0, []); s.calls.length = 0;
  await assert.rejects(executeAgentAction(s as any, stale.kind, stale.resolved), /изменилась/);
  assert.deepEqual(s.calls, []);
  await assert.rejects(prepareAgentAction(s as any, new Set(), { kind: "set_review_domain", project: "p1", domain: "X", approvers: ["u-nik"] }), /не подключён/);
  assert.throws(() => checkedAgentAction({ kind: "set_review_domain", project: "p1", domain: "X", approvers: [] }), /хотя бы один/);
});

test("отзыв права сотрудника: только назначенные права на этот проект; неактивный сотрудник не находится", async () => {
  const s = session();
  const { prepared, outcome } = await run(s, { kind: "revoke_person_right", person: "Николая Деревцова", project: "Продажи", mode: "write" });
  assert.equal(prepared.title, "Отозвать доступ Николай Деревцов к проекту «Продажи»");
  assert.deepEqual(s.calls, ["remove-right:p1:write"]);
  assert.match(outcome.summary, /Николай Деревцов/);
  const all = session();
  await run(all, { kind: "revoke_person_right", person: "u-nik", project: "p1", mode: "all" });
  assert.deepEqual(all.calls, ["remove-right:p1:read", "remove-right:p1:write"]);
  await assert.rejects(prepareAgentAction(session() as any, SCOPE, { kind: "revoke_person_right", person: "Бывший", project: "p1", mode: "all" }), /Не найдено/);
});

test("компетенции: создание с версией каталога, состав — со сверкой версии членства", async () => {
  const s = session();
  assert.equal((await run(s, { kind: "create_competency", name: "Аналитик" })).outcome.summary, "Компетенция «Аналитик» создана");
  assert.deepEqual(s.calls, ["role:Аналитик:functional_role:9"]);
  await assert.rejects(prepareAgentAction(session() as any, SCOPE, { kind: "create_competency", name: "юрист" }), /уже есть/);
  const m = session();
  const admin = await run(m, { kind: "set_competency_member", competency: "Администраторы", person: "Николай Деревцов", member: true });
  assert.deepEqual(admin.prepared.details, ["Это права администратора организации"]);
  assert.deepEqual(m.calls, [`membership:system:organization-admins:u-nik:${JSON.stringify({ expected_generation: 2, expected_enabled: false, enabled: true })}`]);
  await assert.rejects(prepareAgentAction(session() as any, SCOPE, { kind: "set_competency_member", competency: "Юрист", person: "u-nik", member: false }), /и так не/);
});

test("решения во «Входящих»: приёмка, шаблон, приёмная, командный бюджет", async () => {
  const s = session();
  const accept = await run(s, { kind: "decide_acceptance", request: "col-1", accept: false, comment: "Добавьте сроки" });
  assert.equal(accept.prepared.title, "Вернуть на доработку работу «Проверить договор»");
  await assert.rejects(prepareAgentAction(session() as any, SCOPE, { kind: "decide_acceptance", request: "col-2", accept: true, comment: "" }), /не найдено/);
  await assert.rejects(prepareAgentAction(session() as any, SCOPE, { kind: "decide_acceptance", request: "col-1", accept: false, comment: "" }), /нужен комментарий/);

  const template = await run(s, { kind: "decide_template", proposal: "tp-1", approve: true, comment: "Годится" });
  assert.equal(template.prepared.title, "Одобрить шаблон «Коммерческое предложение» для «Отдел продаж»");
  await assert.rejects(prepareAgentAction(session() as any, SCOPE, { kind: "decide_template", proposal: "tp-2", approve: true, comment: "x" }), /не найдено/);

  const intake = await run(s, { kind: "decide_intake", alert: "al-1", approve: true, project: "", domain: "", note: "" });
  assert.equal(intake.prepared.title, "Разместить «договор.pdf» в проекте «Продажи»");
  const intakeReject = await run(s, { kind: "decide_intake", alert: "al-1", approve: false, project: "", domain: "", note: "Не наш файл" });
  assert.equal(intakeReject.outcome.summary, "Размещение «договор.pdf» отклонено");

  const budget = await run(s, { kind: "decide_team_budget", project: "Продажи", proposal: "tb-1", approve: true, comment: "" });
  assert.equal(budget.prepared.title, "Разрешить расход до $8 на «Разбор архива»");
  assert.equal(budget.prepared.icon, "budget");
  assert.deepEqual(s.calls, [
    "acceptance:col-1:1:3:changes_requested:Добавьте сроки",
    "template-save:tp-1:true:5:Годится", "template-execute:tp-1",
    `intake:al-1:${JSON.stringify({ approve: true, place: "sales/юристы/договор.pdf" })}`,
    `intake:al-1:${JSON.stringify({ approve: false, note: "Не наш файл" })}`,
    "team-budget:p1:tb-1:0:6:approved",
  ]);
});

test("внешние агенты: отзыв (кроме агента беседы), право на проект, доступ к почте", async () => {
  const s = session();
  const revoke = await run(s, { kind: "revoke_agent", agent: "Свой агент" });
  assert.equal(revoke.prepared.title, "Отозвать доступ агента «Свой агент (Claude Code или Codex)»");
  await assert.rejects(prepareAgentAction(session() as any, SCOPE, { kind: "revoke_agent", agent: "Агент беседы" }), /отзывает человек сам/);
  await run(s, { kind: "set_agent_project_right", agent: "b-ext", project: "Архив", mode: "read", enabled: true });
  const mail = await run(s, { kind: "set_agent_source_access", type: "mail", connection: "Почта продаж", agent: "b-ext", enabled: true });
  assert.equal(mail.prepared.icon, "mail");
  assert.deepEqual(s.calls, ["revoke-agent:b-ext", "agent-right:a-ext:p2:read:true",
    `mail-grant:mc-1:${JSON.stringify({ principal_id: "a-ext", connection_revision: 3, expected_revision: 7, enabled: true })}`]);
  await assert.rejects(prepareAgentAction(session() as any, SCOPE, { kind: "set_agent_source_access", type: "mail", connection: "mc-1", agent: "b-ext", enabled: false }), /уже такой/);
});

test("отключение: личный ящик, календарь, диск, Telegram, база, GitHub и синхронизация", async () => {
  const s = session();
  const cases: [string, string, string][] = [
    ["imap", "sales@acme.ru — INBOX", "imap-off:im-1"], ["caldav", "alice", "caldav-off:cd-1"], ["webdav", "disk-alice", "webdav-off:wd-1"],
    ["telegram", "@acme_bot", "telegram-off:123"], ["database", "crm", "db-off:p1:crm"], ["github", "acme", "github-off:in-1"], ["sync", "acme/site", "sync-delete:sl-1:4"],
  ];
  for (const [type, name, call] of cases) {
    s.calls.length = 0;
    const { prepared } = await run(s, { kind: "disconnect_source", type, connection: name });
    assert.equal(prepared.ownerOnly, true, type);
    assert.deepEqual(s.calls, [call], type);
  }
  assert.throws(() => checkedAgentAction({ kind: "disconnect_source", type: "slack", connection: "x" }), /type/);
});

test("синхронизация с GitHub: связать репозиторий приложения или ключа, «Обновить сейчас»", async () => {
  const s = session();
  const link = await run(s, { kind: "create_sync_link", project: "Продажи", repository: "acme/site", branch: "", folder: "/docs/", visibility: "department" });
  assert.equal(link.prepared.title, "Связать репозиторий «acme/site» с проектом «Продажи»");
  assert.deepEqual(link.prepared.details, ["Ветка main, папка docs", "Файлы кода увидят: отдел"]);
  assert.deepEqual(JSON.parse(s.calls[0].slice(12)), { project_id: "p1", source: "app", installation_id: "in-1", repository_id: "r-1", repository_name: "acme/site", branch: "main", folder: "docs", include: [], exclude: [], visibility: "department" });
  s.calls.length = 0;
  await run(s, { kind: "create_sync_link", project: "p1", repository: "acme/wiki", branch: "", folder: "", visibility: "private" });
  assert.equal(JSON.parse(s.calls[0].slice(12)).connection_id, "gc-1");
  s.calls.length = 0;
  const refresh = await run(s, { kind: "refresh_sync_link", link: "acme/site" });
  assert.equal(refresh.prepared.ownerOnly, false, "«Обновить сейчас» можно разрешить насовсем");
  assert.deepEqual(s.calls, ["sync-refresh:sl-1"]);
  assert.throws(() => checkedAgentAction({ kind: "create_sync_link", project: "p1", repository: "x", branch: "", folder: "../etc", visibility: "private" }), /папка/);
  await assert.rejects(prepareAgentAction(session() as any, new Set(), { kind: "create_sync_link", project: "p1", repository: "acme/site", branch: "", folder: "", visibility: "private" }), /не подключён/);
});

test("карточки-переходы: подключение с паролем и загрузка файлов открывают экран человека", async () => {
  const s = session();
  const github = await run(s, { kind: "open_screen", target: "github", project: "" });
  assert.equal(github.prepared.title, "Подключить GitHub");
  assert.deepEqual(github.prepared.open, { section: "connections", label: "Открыть «Подключения»" });
  assert.match(github.prepared.details[0], /«Подключить GitHub»/);
  const upload = await run(s, { kind: "open_screen", target: "upload", project: "Продажи" });
  assert.equal(upload.prepared.title, "Загрузить файлы в проект «Продажи»");
  assert.deepEqual(upload.prepared.open, { section: "projects", project: "p1", label: "Открыть проект" });
  assert.equal(upload.outcome.summary, "Экран открыт");
  assert.deepEqual(s.calls, [], "переход ничего не меняет");
  assert.throws(() => checkedAgentAction({ kind: "open_screen", target: "settings", project: "" }), /target/);
});

test("сведения: правила, согласование, права, компетенции, приёмка, шаблоны, приёмная, бюджеты, агенты, подключения", async () => {
  const s = session();
  const read = (request: Record<string, unknown>) => readForAgent(s as any, checkedAgentRead(request)) as Promise<any>;
  assert.equal((await read({ kind: "org_rules" })).default_visibility.words, "Новые проекты видны: только участникам");
  assert.deepEqual((await read({ kind: "review_policy", project: "Продажи" })).domains[0], { name: "Юристы", allDocuments: true, documents: 0, approvers: ["Ирина Ким"] });
  assert.deepEqual((await read({ kind: "person_rights", person: "Николай Деревцов" })).rights.map((r: any) => `${r.project}:${r.mode}`), ["Продажи:read", "Продажи:write", "Архив:read"]);
  assert.deepEqual((await read({ kind: "competencies" })).map((r: any) => r.name), ["Юрист", "Администраторы"]);
  assert.deepEqual(await read({ kind: "acceptances" }), [{ id: "col-1", title: "Проверить договор", project: "Продажи", state: "awaiting_review" }]);
  assert.deepEqual((await read({ kind: "template_proposals" })).map((p: any) => p.id), ["tp-1"]);
  assert.equal((await read({ kind: "intake_questions", project: "" })).questions[0].file, "договор.pdf");
  assert.deepEqual(await read({ kind: "team_budgets", project: "p1" }), [{ id: "tb-1", state: "awaiting_approval", estimate: "$5", limit: "$8", members: 2 }]);
  assert.deepEqual((await read({ kind: "agents" })).map((a: any) => a.name), ["Агент беседы", "Свой агент (Claude Code или Codex)"]);
  assert.deepEqual(await read({ kind: "sources", type: "telegram" }), [{ id: "123", name: "@acme_bot", enabled: true }]);
  assert.throws(() => checkedAgentRead({ kind: "sources", type: "fax" }), /type/);
  assert.deepEqual(s.calls, [], "чтения ничего не меняют");
});

test("агент кода сотрудника: включение и выключение полномочием через карточку; у администратора не меняется", async () => {
  const s = Object.assign(session(), {
    async grantPersonRight(right: { principal_id: string; capability?: string }) { s.calls.push(`grant-right:${right.principal_id}:${right.capability}`); return {}; },
  });
  const on = await run(s, { kind: "set_person_code_agent", person: "Николай Деревцов", enabled: true });
  assert.equal(on.prepared.title, "Включить агента кода для Николай Деревцов");
  assert.equal(on.prepared.ownerOnly, true, "меняет права человека — только с подтверждением владельца беседы");
  assert.deepEqual(s.calls, ["grant-right:u-nik:code.agent.use"]);
  assert.equal(on.outcome.summary, "Агент кода у Николай Деревцов включён");
  // Уже выключен — предлагать нечего.
  await assert.rejects(prepareAgentAction(s as any, SCOPE, { kind: "set_person_code_agent", person: "u-nik", enabled: false }), /уже выключен/);
  const held = Object.assign(session(), {
    async listPersonRights(principal: string) { return { principal_id: principal, exists: true, deactivated: false, rights: [{ kind: "capability", principal_id: principal, capability: "code.agent.use" }] }; },
    async removePersonRight(right: { principal_id: string; kind: string; capability?: string }) { held.calls.push(`remove-right:${right.principal_id}:${right.kind}:${right.capability}`); return { outcome: "removed" }; },
  });
  const off = await run(held, { kind: "set_person_code_agent", person: "u-nik", enabled: false });
  assert.equal(off.prepared.title, "Выключить агента кода для Николай Деревцов");
  assert.deepEqual(held.calls, ["remove-right:u-nik:capability:code.agent.use"], "снимается полномочие, а не право на проект");
  const admin = Object.assign(session(), {
    async readPrincipalMembership(container: string, member: string) { return { container_id: container, member_id: member, enabled: true, generation: 1 }; },
  });
  await assert.rejects(prepareAgentAction(admin as any, SCOPE, { kind: "set_person_code_agent", person: "u-nik", enabled: false }), /у администраторов агент кода включён всегда/);
  assert.throws(() => checkedAgentAction({ kind: "set_person_code_agent", person: "u-nik", enabled: "да" }), /enabled/);
});

test("удаление сотрудника: карточка подтверждения, выполнение одним вызовом; себя и бывшего не удаляет", async () => {
  const s = session();
  const { prepared, outcome } = await run(s, { kind: "remove_person", person: "Николай Деревцов" });
  assert.equal(prepared.title, "Удалить Николай Деревцов из организации");
  assert.equal(prepared.icon, "delete");
  assert.equal(prepared.ownerOnly, true);
  assert.deepEqual(s.calls, ["remove-person:u-nik"]);
  assert.equal(outcome.summary, "Николай Деревцов удалён(а) из организации");
  await assert.rejects(prepareAgentAction(session() as any, SCOPE, { kind: "remove_person", person: "Бывший" }), /Не найдено/);
  const self = { ...session(), async listPeople() { return { users: [{ userName: "alice", externalId: "", displayName: "Алиса" }] }; } };
  await assert.rejects(prepareAgentAction(self as any, SCOPE, { kind: "remove_person", person: "Алиса" }), /Себя/);
  assert.throws(() => checkedAgentAction({ kind: "remove_person", person: "" }), /сотрудник/);
});
