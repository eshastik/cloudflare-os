/**
 * Остальные действия человека для агента беседы: правила организации, согласования, права и
 * компетенции, решения во «Входящих», внешние агенты, подключения и синхронизация с GitHub.
 * Устроены так же, как в agent-actions.ts: проверка аргументов, имена вместо идентификаторов,
 * карточка подтверждения, выполнение сессией человека.
 */
import type { AgentConnectionPage, CollaborationProgress, CollaborationRequest, GitAppRepositoryPage, GitHubAccountPage, GitSyncLink, GitSyncLinkCreate, GitSyncVisibility, OrganizationRole, OrganizationRolePage, PolicyApproverPage, PrincipalMembership, ProjectBudgetPolicy, PublicationPolicy, TeamBudgetDecide, TeamBudgetDecision, TeamBudgetProposal, TeamBudgetSummary, CollaborationReviewCreate, CollaborationReview, PolicyDomain } from "./mnemos-api.ts";
import type { GitConnectionPage, GitRepositoryPage } from "./git-connections.ts";
import type { MailConnectionPage, MailGrantDecision, MailGrantState } from "./mail-connections.ts";
import type { CalendarConnectionPage, CalendarGrantDecision, CalendarGrantState } from "./calendar-connections.ts";
import type { ProjectSharingSettings } from "./project-sharing.ts";
import type { AdminPerson, AdminRight, AdminRights } from "./admin-people.ts";
import type { IntakeAlerts, IntakeDecision } from "./intake.ts";
import type { TemplateDecisionInput, TemplatePromotionPage, TemplateScopePage } from "./work-templates.ts";
import type { ImapAccountInfo } from "./imap-types.ts";
import type { CalDAVAccountInfo } from "./caldav-types.ts";
import type { WebDAVAccountInfo } from "./webdav-accounts.ts";
import type { DatabaseConnection } from "./database-connections.ts";
import type { ActionOutcome } from "@gadgets/workshop-shared/gatekeeper";
import { intakePlacement } from "./intake.ts";
import { agentNames } from "../app-react/names.ts";
import { CODE_AGENT_CAPABILITY } from "./workspace-tasks.ts";

/** Группа «Администраторы организации»: агент кода у её участников включён всегда. */
const ADMINS_GROUP = "system:organization-admins";
import { allPages, flag, inScope, money, oneOf, pickOne, project, projectName, str, text, type AgentActionSession, type PreparedAgentAction } from "./agent-actions.ts";

/** Методы человека сверх AgentActionSession: сессия управления и источники самого аккаунта (ящики, календари, диск, Telegram). */
export interface ExtraActionSession extends AgentActionSession {
  readProjectSharingSettings(): Promise<ProjectSharingSettings>;
  updateProjectSharingSettings(settings: ProjectSharingSettings): Promise<ProjectSharingSettings>;
  listPolicyApprovers(project: string, cursor: string): Promise<PolicyApproverPage>;
  setPublicationPolicy(project: string, revision: number, domains: PolicyDomain[]): Promise<{ revision: number }>;
  listPeople(): Promise<{ users: AdminPerson[] }>;
  listPersonRights(principal: string): Promise<AdminRights>;
  removePersonRight(right: AdminRight): Promise<{ outcome: string }>;
  removePerson(principal: string): Promise<{ outcome: string; agents_disabled: number; invitations_removed: number; rights_removed: number }>;
  grantPersonRight(right: AdminRight): Promise<unknown>;
  listOrganizationRoles(cursor?: string): Promise<OrganizationRolePage>;
  createOrganizationRole(input: { id: string; kind: "group" | "functional_role"; name: string; expected_generation: number }): Promise<OrganizationRole>;
  readPrincipalMembership(container: string, member: string): Promise<PrincipalMembership>;
  setPrincipalMembership(container: string, member: string, decision: { expected_generation: number; expected_enabled: boolean; enabled: boolean }): Promise<PrincipalMembership>;
  listCollaborations(cursor?: string): Promise<{ requests: CollaborationRequest[]; next_cursor?: string }>;
  readCollaborationProgress(id: string): Promise<CollaborationProgress>;
  reviewCollaborationResult(id: string, review: CollaborationReviewCreate): Promise<CollaborationReview>;
  listTemplateReviewScopes(cursor?: string): Promise<TemplateScopePage>;
  listTemplateProposals(scope: string, cursor?: string): Promise<TemplatePromotionPage>;
  saveTemplateDecision(id: string, input: TemplateDecisionInput): Promise<unknown>;
  executeSavedTemplateDecision(id: string): Promise<{ receipt?: unknown }>;
  inboxAlerts(decided?: boolean, projectId?: string): Promise<IntakeAlerts>;
  decideInboxAlert(id: string, decision: IntakeDecision): Promise<unknown>;
  listTeamBudgets(project: string, cursor?: string): Promise<{ proposals: TeamBudgetSummary[]; next_cursor?: string }>;
  readTeamBudget(project: string, id: string): Promise<TeamBudgetProposal>;
  decideTeamBudget(project: string, id: string, input: TeamBudgetDecide): Promise<TeamBudgetDecision>;
  readProjectBudget(project: string): Promise<ProjectBudgetPolicy>;
  listAgentConnections(cursor?: string): Promise<AgentConnectionPage>;
  revokeAgentConnection(binding: string): Promise<void>;
  setAgentProjectRight(principal: string, project: string, mode: "read" | "write", enabled: boolean): Promise<unknown>;
  readMailGrantState(id: string, principal: string): Promise<MailGrantState>;
  readCalendarGrantState(id: string, principal: string): Promise<CalendarGrantState>;
  setMailReadGrant(id: string, decision: MailGrantDecision): Promise<unknown>;
  setCalendarReadGrant(id: string, decision: CalendarGrantDecision): Promise<unknown>;
  listMailConnections(cursor?: string): Promise<MailConnectionPage>;
  listCalendarConnections(cursor?: string): Promise<CalendarConnectionPage>;
  listGitConnections(cursor?: string): Promise<GitConnectionPage>;
  listGitRepositories(connection: string, page?: number): Promise<GitRepositoryPage>;
  listGitAppRepositories(): Promise<GitAppRepositoryPage>;
  listGitHubAccounts(): Promise<GitHubAccountPage>;
  disconnectGitHubAccount(installation: string): Promise<unknown>;
  listGitSyncLinks(): Promise<{ links: GitSyncLink[] }>;
  createGitSyncLink(input: GitSyncLinkCreate): Promise<GitSyncLink>;
  refreshGitSyncLink(link: string): Promise<unknown>;
  deleteGitSyncLink(link: string, expectedRevision: number): Promise<unknown>;
  listVisibleDatabaseConnections(): Promise<{ databases: DatabaseConnection[] }>;
  removeDatabaseConnection(project: string, name: string): Promise<unknown>;
  // Источники самого аккаунта: хранятся в объекте аккаунта, а не на сервере Mnemos.
  listImapAccounts(): Promise<{ accounts: ImapAccountInfo[] }>;
  removeImapAccount(id: string): Promise<unknown>;
  listCalDAVAccounts(): Promise<{ accounts: CalDAVAccountInfo[] }>;
  removeCalDAVAccount(id: string): Promise<unknown>;
  listWebDAVAccounts(): Promise<{ accounts: WebDAVAccountInfo[] }>;
  removeWebDAVAccount(id: string): Promise<unknown>;
  listTelegram(): Promise<{ connections: { bot: string; username: string; disconnected: boolean }[] }>;
  disconnectTelegram(bot: string): Promise<unknown>;
}

export type SourceType = "imap" | "caldav" | "webdav" | "telegram" | "database" | "github" | "sync";
export type ScreenTarget = "mail" | "calendar" | "drive" | "github" | "git" | "database" | "telegram" | "upload";
type RulesPatch = Partial<ProjectSharingSettings>;

export type ExtraActionRequest =
  | { kind: "update_org_rules"; rules: RulesPatch }
  | { kind: "set_review_domain"; project: string; domain: string; approvers: string[] }
  | { kind: "remove_review_domain"; project: string; domain: string }
  | { kind: "revoke_person_right"; person: string; project: string; mode: "read" | "write" | "all" }
  | { kind: "set_person_code_agent"; person: string; enabled: boolean }
  | { kind: "remove_person"; person: string }
  | { kind: "create_competency"; name: string }
  | { kind: "set_competency_member"; competency: string; person: string; member: boolean }
  | { kind: "decide_acceptance"; request: string; accept: boolean; comment: string }
  | { kind: "decide_template"; proposal: string; approve: boolean; comment: string }
  | { kind: "decide_intake"; alert: string; approve: boolean; project: string; domain: string; note: string }
  | { kind: "decide_team_budget"; project: string; proposal: string; approve: boolean; comment: string }
  | { kind: "revoke_agent"; agent: string }
  | { kind: "set_agent_project_right"; agent: string; project: string; mode: "read" | "write"; enabled: boolean }
  | { kind: "set_agent_source_access"; type: "mail" | "calendar"; connection: string; agent: string; enabled: boolean }
  | { kind: "disconnect_source"; type: SourceType; connection: string }
  | { kind: "create_sync_link"; project: string; repository: string; branch: string; folder: string; visibility: GitSyncVisibility }
  | { kind: "refresh_sync_link"; link: string }
  | { kind: "open_screen"; target: ScreenTarget; project: string };

export type ExtraActionKind = ExtraActionRequest["kind"];

export const EXTRA_KEYS: Record<ExtraActionKind, string[]> = {
  update_org_rules: ["rules"], set_review_domain: ["project", "domain", "approvers"], remove_review_domain: ["project", "domain"],
  revoke_person_right: ["person", "project", "mode"], set_person_code_agent: ["person", "enabled"], remove_person: ["person"], create_competency: ["name"], set_competency_member: ["competency", "person", "member"],
  decide_acceptance: ["request", "accept", "comment"], decide_template: ["proposal", "approve", "comment"],
  decide_intake: ["alert", "approve", "project", "domain", "note"], decide_team_budget: ["project", "proposal", "approve", "comment"],
  revoke_agent: ["agent"], set_agent_project_right: ["agent", "project", "mode", "enabled"],
  set_agent_source_access: ["type", "connection", "agent", "enabled"], disconnect_source: ["type", "connection"],
  create_sync_link: ["project", "repository", "branch", "folder", "visibility"], refresh_sync_link: ["link"], open_screen: ["target", "project"],
};
export const EXTRA_LABELS: Record<ExtraActionKind, string> = {
  update_org_rules: "Правила организации", set_review_domain: "Согласующие проекта", remove_review_domain: "Направление согласования",
  revoke_person_right: "Отзыв права сотрудника", set_person_code_agent: "Агент кода сотрудника", remove_person: "Удаление сотрудника из организации", create_competency: "Новая компетенция", set_competency_member: "Состав компетенции",
  decide_acceptance: "Приёмка работы", decide_template: "Решение по шаблону", decide_intake: "Решение приёмной",
  decide_team_budget: "Командный бюджет", revoke_agent: "Отзыв агента", set_agent_project_right: "Право агента на проект",
  set_agent_source_access: "Доступ агента к почте или календарю", disconnect_source: "Отключение подключения",
  create_sync_link: "Синхронизация с GitHub", refresh_sync_link: "Обновить синхронизацию", open_screen: "Открыть экран",
};
/** Карточки-переходы и «Обновить сейчас» ничего не меняют в доступе: их можно разрешить насовсем. */
export const EXTRA_AUTO_APPROVABLE: ExtraActionKind[] = ["refresh_sync_link", "open_screen"];

const RULE_WORDS: Record<keyof ProjectSharingSettings, [string, Record<string, string>]> = {
  personal_projects_enabled: ["Личные проекты", { true: "разрешены", false: "запрещены" }],
  project_create_by: ["Создавать проекты могут", { everyone: "все", heads: "руководители", admins: "администраторы" }],
  share_department_approval: ["Открыть проект отделу", { head: "с решением руководителя", none: "без решения" }],
  share_organization_by: ["Открыть проект всей организации просит", { head: "руководитель", admin: "администратор" }],
  share_organization_approval: ["Открыть проект всей организации", { none: "без решения", admin: "с решением администратора" }],
  default_visibility: ["Новые проекты видны", { private: "только участникам", department: "отделу", organization: "всей организации" }],
};
const SOURCE_WORDS: Record<SourceType, string> = { imap: "почтового ящика", caldav: "календаря", webdav: "диска", telegram: "Telegram", database: "базы данных", github: "аккаунта GitHub", sync: "синхронизации с GitHub" };
const SCREENS: Record<ScreenTarget, { title: string; detail: string; section: string; label: string }> = {
  mail: { title: "Подключить почту", detail: "Нужен пароль приложения от ящика: его вводит человек сам", section: "connections", label: "Открыть «Подключения»" },
  calendar: { title: "Подключить календарь", detail: "Нужен пароль приложения от календаря: его вводит человек сам", section: "connections", label: "Открыть «Подключения»" },
  drive: { title: "Подключить диск", detail: "Нужен пароль приложения от диска: его вводит человек сам", section: "connections", label: "Открыть «Подключения»" },
  github: { title: "Подключить GitHub", detail: "Вход на GitHub и выбор репозиториев делает человек — кнопка «Подключить GitHub»", section: "connections", label: "Открыть «Подключения»" },
  git: { title: "Подключить репозитории по ключу доступа", detail: "Ключ доступа GitHub или GitLab вводит человек сам", section: "connections", label: "Открыть «Подключения»" },
  database: { title: "Подключить базу данных", detail: "Адрес и пароль базы задаёт администратор сервера", section: "connections", label: "Открыть «Подключения»" },
  telegram: { title: "Подключить Telegram", detail: "Ключ бота вводит человек сам, затем подтверждает бота", section: "connections", label: "Открыть «Подключения»" },
  upload: { title: "Загрузить файлы", detail: "Файлы выбирает человек: кнопка «Загрузить файлы» на странице проекта", section: "projects", label: "Открыть проект" },
};

function names(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error(`Некорректное значение: ${label} — список до 20 имён.`);
  return value.map(item => text(item, label));
}

export function checkedExtraAction(kind: ExtraActionKind, value: Record<string, unknown>): ExtraActionRequest {
  switch (kind) {
    case "update_org_rules": {
      const rules = value.rules;
      if (!rules || typeof rules !== "object" || Array.isArray(rules)) throw new Error("Некорректное значение: rules — объект с изменяемыми правилами.");
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(rules)) {
        if (!Object.hasOwn(RULE_WORDS, key)) throw new Error(`Неизвестное правило: ${key}.`);
        if (key === "personal_projects_enabled") out[key] = flag(item, key);
        else out[key] = oneOf(item, Object.keys(RULE_WORDS[key as keyof ProjectSharingSettings][1]), key);
      }
      if (!Object.keys(out).length) throw new Error("Не указано ни одного правила.");
      return { kind, rules: out as RulesPatch };
    }
    case "set_review_domain": {
      const approvers = names(value.approvers, "согласующие");
      if (!approvers.length) throw new Error("Нужен хотя бы один согласующий.");
      return { kind, project: text(value.project, "проект"), domain: text(value.domain, "направление"), approvers };
    }
    case "remove_review_domain": return { kind, project: text(value.project, "проект"), domain: text(value.domain, "направление") };
    case "revoke_person_right": return { kind, person: text(value.person, "сотрудник"), project: text(value.project, "проект"), mode: oneOf(value.mode, ["read", "write", "all"] as const, "mode") };
    case "set_person_code_agent": return { kind, person: text(value.person, "сотрудник"), enabled: flag(value.enabled, "enabled") };
    case "remove_person": return { kind, person: text(value.person, "сотрудник") };
    case "create_competency": return { kind, name: text(value.name, "название компетенции") };
    case "set_competency_member": return { kind, competency: text(value.competency, "компетенция"), person: text(value.person, "сотрудник"), member: flag(value.member, "member") };
    case "decide_acceptance": return { kind, request: text(value.request, "поручение"), accept: flag(value.accept, "accept"), comment: text(value.comment, "комментарий", true, 4000) };
    case "decide_template": return { kind, proposal: text(value.proposal, "предложение шаблона"), approve: flag(value.approve, "approve"), comment: text(value.comment, "комментарий", true, 4000) };
    case "decide_intake": return { kind, alert: text(value.alert, "вопрос приёмной"), approve: flag(value.approve, "approve"), project: text(value.project, "проект", true), domain: text(value.domain, "область", true), note: text(value.note, "примечание", true, 1000) };
    case "decide_team_budget": return { kind, project: text(value.project, "проект"), proposal: text(value.proposal, "заявка"), approve: flag(value.approve, "approve"), comment: text(value.comment, "комментарий", true, 1000) };
    case "revoke_agent": return { kind, agent: text(value.agent, "агент") };
    case "set_agent_project_right": return { kind, agent: text(value.agent, "агент"), project: text(value.project, "проект"), mode: oneOf(value.mode, ["read", "write"] as const, "mode"), enabled: flag(value.enabled, "enabled") };
    case "set_agent_source_access": return { kind, type: oneOf(value.type, ["mail", "calendar"] as const, "type"), connection: text(value.connection, "подключение"), agent: text(value.agent, "агент"), enabled: flag(value.enabled, "enabled") };
    case "disconnect_source": return { kind, type: oneOf(value.type, ["imap", "caldav", "webdav", "telegram", "database", "github", "sync"] as const, "type"), connection: text(value.connection, "подключение") };
    case "create_sync_link": {
      const folder = text(value.folder, "папка", true, 1024).replace(/^\/+|\/+$/g, "");
      if (/(^|\/)\.\.(\/|$)/.test(folder)) throw new Error("Некорректное значение: папка.");
      return { kind, project: text(value.project, "проект"), repository: text(value.repository, "репозиторий"), branch: text(value.branch, "ветка", true), folder, visibility: oneOf(value.visibility, ["private", "department", "organization"] as const, "visibility") };
    }
    case "refresh_sync_link": return { kind, link: text(value.link, "синхронизация") };
    case "open_screen": return { kind, target: oneOf(value.target, Object.keys(SCREENS) as ScreenTarget[], "target"), project: text(value.project, "проект", true) };
  }
}

// ---- поиск ----

async function person(session: ExtraActionSession, query: string) {
  const { users } = await session.listPeople();
  return pickOne(users.filter(u => u.active !== false), query, u => u.userName, u => u.displayName || u.userName, "сотрудник");
}
async function agents(session: ExtraActionSession) {
  const connections = await allPages(async cursor => { const page = await session.listAgentConnections(cursor); return { items: page.connections, next: page.next_cursor }; });
  const titles = agentNames(connections);
  return connections.filter(c => !c.revoked).map(c => ({ ...c, name: titles.get(c.binding_id) ?? "Агент" }));
}
async function agent(session: ExtraActionSession, query: string) {
  return pickOne(await agents(session), query, a => a.binding_id, a => a.name, "действующий агент");
}
async function competencies(session: ExtraActionSession) {
  let generation = 0;
  const roles = await allPages(async cursor => { const page = await session.listOrganizationRoles(cursor); generation = page.generation; return { items: page.roles, next: page.next_cursor }; });
  return { generation, roles: roles.filter(r => r.active) };
}
async function policyOf(session: ExtraActionSession, projectId: string): Promise<PublicationPolicy> {
  try { return await session.readPublicationPolicy(projectId); }
  catch { return { project_id: projectId, revision: 0, domains: [] }; }
}
async function projectConnection(session: ExtraActionSession, type: "mail" | "calendar", query: string) {
  const read = type === "mail" ? (c: string) => session.listMailConnections(c) : (c: string) => session.listCalendarConnections(c);
  const items = await allPages(async cursor => { const page = await read(cursor); return { items: page.connections as { connection_id: string; provider: string; calendar_id?: string; enabled: boolean }[], next: page.next_cursor }; });
  return pickOne(items.filter(i => i.enabled), query, i => i.connection_id, i => i.calendar_id || i.provider, type === "mail" ? "подключение почты" : "подключение календаря");
}
/** Всё, что можно отключить сверх почты, календаря и кода проекта; revision — версия для сверки. */
export async function sources(session: ExtraActionSession, type: SourceType): Promise<{ id: string; name: string; enabled: boolean; revision?: number; project?: string }[]> {
  switch (type) {
    case "imap": return (await session.listImapAccounts()).accounts.map(a => ({ id: a.id, name: `${a.username} — ${a.mailbox}`, enabled: a.enabled }));
    case "caldav": return (await session.listCalDAVAccounts()).accounts.map(a => ({ id: a.id, name: a.username, enabled: a.enabled }));
    case "webdav": return (await session.listWebDAVAccounts()).accounts.map(a => ({ id: a.id, name: a.username, enabled: a.enabled }));
    case "telegram": return (await session.listTelegram()).connections.map(c => ({ id: c.bot, name: `@${c.username}`, enabled: !c.disconnected }));
    case "database": return (await session.listVisibleDatabaseConnections()).databases.map(d => ({ id: `${d.project_id}/${d.name}`, name: d.name, enabled: true, project: d.project_id }));
    case "github": return (await session.listGitHubAccounts()).accounts.map(a => ({ id: a.installation_id, name: a.account_login, enabled: true }));
    case "sync": return (await session.listGitSyncLinks()).links.filter(l => l.can_manage && l.state !== "disabled").map(l => ({ id: l.link_id, name: l.repository_name, enabled: true, revision: l.revision, project: l.project_id }));
  }
}

type Card = Omit<PreparedAgentAction, "kind">;
const card = (icon: PreparedAgentAction["icon"], title: string, details: string[], resolved: PreparedAgentAction["resolved"], extra: Partial<Card> = {}): Card => ({ icon, title, details, resolved, ownerOnly: true, ...extra });

export async function prepareExtraAction(session: ExtraActionSession, scope: ReadonlySet<string>, request: ExtraActionRequest): Promise<Card> {
  switch (request.kind) {
    case "update_org_rules": {
      const current = await session.readProjectSharingSettings();
      const changes = Object.entries(request.rules).filter(([key, value]) => current[key as keyof ProjectSharingSettings] !== value);
      if (!changes.length) throw new Error("Правила уже такие.");
      const words = changes.map(([key, value]) => { const [label, values] = RULE_WORDS[key as keyof ProjectSharingSettings]; return `${label}: ${values[String(value)]}`; });
      return card("visibility", "Изменить правила организации о проектах", words.slice(0, 3), { rules: JSON.stringify(Object.fromEntries(changes)) });
    }
    case "set_review_domain": {
      const p = await project(session, request.project); inScope(scope, p.id, p.name);
      const candidates = await allPages(async cursor => { const page = await session.listPolicyApprovers(p.id, cursor); return { items: page.approvers, next: page.next_cursor }; });
      const chosen = request.approvers.map(q => pickOne(candidates, q, a => a.principal_id, a => a.display_name, "согласующий"));
      const policy = await policyOf(session, p.id);
      const exists = policy.domains.some(d => d.domain_id === request.domain);
      return card("review", `${exists ? "Изменить" : "Добавить"} согласование «${request.domain}» в проекте «${p.name}»`,
        [`Согласуют: ${chosen.map(a => a.display_name).join(", ")}`, "Все документы проекта, включая новые"],
        { project: p.id, projectName: p.name, domain: request.domain, approvers: JSON.stringify([...new Set(chosen.map(a => a.principal_id))]), revision: policy.revision });
    }
    case "remove_review_domain": {
      const p = await project(session, request.project); inScope(scope, p.id, p.name);
      const policy = await policyOf(session, p.id);
      const domain = pickOne(policy.domains, request.domain, d => d.domain_id, d => d.domain_id, "направление согласования");
      if (policy.domains.length === 1) throw new Error("Это единственное направление: без него политика согласования не сохраняется. Изменить согласующих можно через setReviewDomain.");
      return card("delete", `Убрать согласование «${domain.domain_id}» в проекте «${p.name}»`, ["Изменения по этому направлению больше не будут ждать решения"],
        { project: p.id, projectName: p.name, domain: domain.domain_id, revision: policy.revision });
    }
    case "revoke_person_right": {
      const who = await person(session, request.person);
      const p = await project(session, request.project);
      const rights = (await session.listPersonRights(who.userName)).rights.filter(r => r.kind === "anchor" && r.project_id === p.id && (request.mode === "all" || r.mode === request.mode));
      if (!rights.length) throw new Error(`У ${who.displayName} нет такого права на проект «${p.name}».`);
      return card("access", `Отозвать доступ ${who.displayName} к проекту «${p.name}»`, [`Назначений: ${rights.length}`, "Доступ через отдел и видимость проекта не меняется"],
        { person: who.userName, personName: who.displayName, projectName: p.name, rights: JSON.stringify(rights) });
    }
    case "set_person_code_agent": {
      const who = await person(session, request.person);
      const admin = await session.readPrincipalMembership(ADMINS_GROUP, who.userName).then(m => m.enabled, () => false);
      if (admin) throw new Error(`${who.displayName} — администратор: у администраторов агент кода включён всегда.`);
      const own = (await session.listPersonRights(who.userName)).rights.some(r => r.kind === "capability" && r.capability === CODE_AGENT_CAPABILITY);
      if (own === request.enabled) throw new Error(`Агент кода у ${who.displayName} уже ${request.enabled ? "включён" : "выключен"}.`);
      return card("code", `${request.enabled ? "Включить" : "Выключить"} агента кода для ${who.displayName}`,
        [request.enabled ? "Беседы сотрудника смогут поручать работу с кодом проектов" : "Работа с кодом сотрудника остановится, новые задачи не запустятся"],
        { person: who.userName, personName: who.displayName, enabled: request.enabled });
    }
    case "remove_person": {
      const who = await person(session, request.person);
      if (who.userName === (await session.whoAmI()).subject.user_id) throw new Error("Себя из организации удалить нельзя.");
      return card("delete", `Удалить ${who.displayName || "сотрудника"} из организации`,
        ["Вход, ключи и агенты сотрудника отключатся, приглашения к документам и доступ к проектам снимутся", "Учётная запись и авторство сохранятся; вернуть можно в «Люди и отделы»"],
        { person: who.userName, personName: who.displayName || "Сотрудник" });
    }
    case "create_competency": {
      const { generation, roles } = await competencies(session);
      if (roles.some(r => r.name.toLocaleLowerCase("ru") === request.name.toLocaleLowerCase("ru"))) throw new Error("Такая компетенция уже есть.");
      return card("person", `Создать компетенцию «${request.name}»`, ["Людей в неё добавляют отдельно"], { name: request.name, generation, id: crypto.randomUUID() });
    }
    case "set_competency_member": {
      const { roles } = await competencies(session);
      const role = pickOne(roles, request.competency, r => r.id, r => r.name, "компетенция");
      const who = await person(session, request.person);
      const state = await session.readPrincipalMembership(role.id, who.userName);
      if (state.enabled === request.member) throw new Error(`${who.displayName} ${request.member ? "уже" : "и так не"} в «${role.name}».`);
      return card("person", request.member ? `Добавить ${who.displayName} в «${role.name}»` : `Убрать ${who.displayName} из «${role.name}»`,
        [role.id === "system:organization-admins" ? "Это права администратора организации" : "Компетенция влияет на задачи и права по ней"],
        { role: role.id, roleName: role.name, person: who.userName, personName: who.displayName, member: request.member, generation: state.generation, enabled: state.enabled });
    }
    case "decide_acceptance": {
      const me = (await session.whoAmI()).subject.user_id;
      const requests = await allPages(async cursor => { const page = await session.listCollaborations(cursor); return { items: page.requests, next: page.next_cursor }; });
      const found = requests.find(r => r.request_id === request.request && r.requester_user_id === me);
      if (!found) throw new Error("Поручение не найдено среди ваших. Посмотрите список: listAcceptances().");
      const progress = await session.readCollaborationProgress(found.request_id);
      if (progress.state !== "awaiting_review") throw new Error("Результата на приёмке нет.");
      if (!request.accept && !request.comment) throw new Error("Чтобы вернуть на доработку, нужен комментарий: что доработать.");
      return card("review", `${request.accept ? "Принять" : "Вернуть на доработку"} работу «${found.title}»`, [request.comment ? `Комментарий: ${request.comment.slice(0, 200)}` : "Без комментария"],
        { request: found.request_id, title: found.title, accept: request.accept, comment: request.comment, revision: progress.review_revision, sequence: progress.result_sequence, reviewId: crypto.randomUUID() });
    }
    case "decide_template": {
      if (!request.comment) throw new Error("Для решения по шаблону нужен комментарий.");
      const scopes = await allPages(async cursor => { const page = await session.listTemplateReviewScopes(cursor); return { items: page.scopes, next: page.next_cursor }; });
      for (const s of scopes) {
        const proposals = await allPages(async cursor => { const page = await session.listTemplateProposals(s.scope_id, cursor); return { items: page.proposals, next: page.next_cursor }; });
        const found = proposals.find(p => p.proposal.proposal_id === request.proposal && !p.decision);
        if (found) return card("review", `${request.approve ? "Одобрить" : "Отклонить"} шаблон «${found.proposal.template_key}» для «${s.name}»`, [`Комментарий: ${request.comment.slice(0, 200)}`],
          { proposal: request.proposal, key: found.proposal.template_key, scopeName: s.name, approve: request.approve, comment: request.comment, scopeRevision: s.revision, requestId: crypto.randomUUID() });
      }
      throw new Error("Предложение шаблона не найдено среди ждущих решения. Посмотрите список: listTemplateProposals().");
    }
    case "decide_intake": {
      const p = request.project ? await project(session, request.project) : null;
      const { alerts } = await session.inboxAlerts(false, p?.id);
      const alert = alerts.find(a => a.id === request.alert && a.status === "open") ?? alerts.find(a => a.id === request.alert);
      if (!alert) throw new Error("Вопрос приёмной не найден. Посмотрите список: listIntakeQuestions().");
      const file = alert.paths[0] ?? "";
      if (!request.approve) return card("delete", `Отклонить размещение «${file}»`, [request.note ? `Примечание: ${request.note.slice(0, 200)}` : "Файл не попадёт в проекты"], { alert: alert.id, approve: false, note: request.note, file, project: "", projectName: "" });
      const slug = p?.slug ?? alert.proposed_project_slug ?? "";
      const target = p ?? (await session.listProjects()).projects.find(x => x.slug === slug);
      if (!target) throw new Error("Укажите существующий проект для размещения (project).");
      const domain = request.domain || alert.suggested_domain || "";
      let place: string;
      try { place = intakePlacement(target.slug, domain, file); } catch { throw new Error("Укажите предметную область (domain) для размещения файла."); }
      return card("publish", `Разместить «${file}» в проекте «${target.name}»`, [`Область: ${domain}`],
        { alert: alert.id, approve: true, place, note: request.note, file, project: p ? p.id : "" , projectName: target.name });
    }
    case "decide_team_budget": {
      const p = await project(session, request.project);
      const policy = await session.readProjectBudget(p.id);
      const proposal = await session.readTeamBudget(p.id, request.proposal);
      if (proposal.state !== "awaiting_approval") throw new Error("Эта заявка на расход уже решена.");
      return card("budget", `${request.approve ? "Разрешить" : "Отклонить"} расход до ${money(proposal.proposal.limit_usd_micros)} на «${proposal.proposal.task.slice(0, 80)}»`,
        [`Проект «${p.name}», оценка ${money(proposal.proposal.estimate_usd_micros)}, агентов: ${proposal.proposal.members.length}`],
        { project: p.id, projectName: p.name, proposal: proposal.id, approve: request.approve, comment: request.comment || (request.approve ? "Разрешено." : "Отклонено."), revision: proposal.decision?.revision ?? 0, policy: policy.revision, decisionId: crypto.randomUUID() });
    }
    case "revoke_agent": {
      const found = await agent(session, request.agent);
      if (found.runtime_id === "workshop") throw new Error("Агента беседы отзывает человек сам в разделе «Агенты и расходы».");
      return card("delete", `Отозвать доступ агента «${found.name}»`, ["Агент больше не сможет читать и менять данные Mnemos"], { binding: found.binding_id, name: found.name });
    }
    case "set_agent_project_right": {
      const found = await agent(session, request.agent);
      const p = await project(session, request.project);
      return card("access", `${request.enabled ? "Выдать" : "Снять"} агенту «${found.name}» право ${request.mode === "write" ? "менять" : "читать"} проект «${p.name}»`,
        ["Агент действует в пределах прав человека, который его подключил"], { principal: found.agent_principal_id, name: found.name, project: p.id, projectName: p.name, mode: request.mode, enabled: request.enabled });
    }
    case "set_agent_source_access": {
      const found = await agent(session, request.agent);
      const connection = await projectConnection(session, request.type, request.connection);
      const state = request.type === "mail" ? await session.readMailGrantState(connection.connection_id, found.agent_principal_id) : await session.readCalendarGrantState(connection.connection_id, found.agent_principal_id);
      if (state.enabled === request.enabled) throw new Error("Доступ уже такой.");
      const what = request.type === "mail" ? "письма" : "календарь";
      return card(request.type, `${request.enabled ? "Разрешить" : "Запретить"} агенту «${found.name}» читать ${what} «${connection.calendar_id || connection.provider}»`,
        [request.enabled ? "Агент сможет искать и читать это подключение" : "Агент перестанет видеть это подключение"],
        { type: request.type, connection: connection.connection_id, principal: found.agent_principal_id, name: found.name, enabled: request.enabled, connectionRevision: state.connection_revision, revision: state.revision });
    }
    case "disconnect_source": {
      const found = pickOne((await sources(session, request.type)).filter(s => s.enabled), request.connection, s => s.id, s => s.name, `подключение ${SOURCE_WORDS[request.type]}`);
      return card(request.type === "github" || request.type === "sync" ? "code" : request.type === "imap" ? "mail" : request.type === "caldav" ? "calendar" : "connection",
        `Отключить подключение ${SOURCE_WORDS[request.type]} «${found.name}»`, [request.type === "github" ? "Его синхронизации остановятся, файлы останутся в проектах" : "Данные из него перестанут поступать"],
        { type: request.type, connection: found.id, name: found.name, revision: found.revision ?? 0, project: found.project ?? "" });
    }
    case "create_sync_link": {
      const p = await project(session, request.project); inScope(scope, p.id, p.name);
      const app = await session.listGitAppRepositories().catch(() => ({ available: false, repositories: [] }));
      const repos: { id: string; name: string; branch: string; source: "app" | "connection"; installation?: string; connection?: string }[] =
        app.repositories.map(r => ({ id: r.id, name: r.name, branch: r.default_branch, source: "app", installation: r.installation_id }));
      const connections = await allPages(async cursor => { const page = await session.listGitConnections(cursor); return { items: page.connections, next: page.next_cursor }; });
      for (const c of connections.filter(c => c.enabled)) {
        const page = await session.listGitRepositories(c.connection_id, 1).catch(() => ({ repositories: [] }));
        repos.push(...page.repositories.map(r => ({ id: r.id, name: r.name, branch: r.default_branch, source: "connection" as const, connection: c.connection_id })));
      }
      if (!repos.length) throw new Error("Нет доступных репозиториев: сначала человек подключает GitHub — предложите openScreen(\"github\").");
      const repo = pickOne(repos, request.repository, r => r.id, r => r.name, "репозиторий");
      const branch = request.branch || repo.branch;
      return card("code", `Связать репозиторий «${repo.name}» с проектом «${p.name}»`,
        [`Ветка ${branch}${request.folder ? `, папка ${request.folder}` : ""}`, `Файлы кода увидят: ${{ private: "только участники", department: "отдел", organization: "вся организация" }[request.visibility]}`],
        { project: p.id, projectName: p.name, source: repo.source, installation: repo.installation ?? "", connection: repo.connection ?? "", repository: repo.id, repositoryName: repo.name, branch, folder: request.folder, visibility: request.visibility });
    }
    case "refresh_sync_link": {
      const found = pickOne((await sources(session, "sync")), request.link, s => s.id, s => s.name, "синхронизация с GitHub");
      return card("code", `Обновить сейчас «${found.name}»`, ["Изменения из GitHub придут в проект в ближайшие минуты"], { link: found.id, name: found.name }, { ownerOnly: false });
    }
    case "open_screen": {
      const screen = SCREENS[request.target];
      const p = request.target === "upload" ? await project(session, request.project || "") : null;
      return card(request.target === "upload" ? "publish" : "connection", p ? `${screen.title} в проект «${p.name}»` : screen.title, [screen.detail],
        { target: request.target, project: p?.id ?? "" }, { ownerOnly: false, open: { section: screen.section, ...(p ? { project: p.id } : {}), label: screen.label } });
    }
  }
}

export async function executeExtraAction(session: ExtraActionSession, kind: ExtraActionKind, r: PreparedAgentAction["resolved"]): Promise<ActionOutcome> {
  switch (kind) {
    case "update_org_rules": {
      const current = await session.readProjectSharingSettings();
      await session.updateProjectSharingSettings({ ...current, ...JSON.parse(str(r, "rules")) });
      return { summary: "Правила организации о проектах изменены" };
    }
    case "set_review_domain": {
      const project = str(r, "project"), policy = await policyOf(session, project);
      if (policy.revision !== r.revision) throw new Error("Политика согласования изменилась после предложения: предложите заново.");
      const domain: PolicyDomain = { domain_id: str(r, "domain"), all_documents: true, node_ids: [], approver_ids: JSON.parse(str(r, "approvers")) };
      const domains = policy.domains.some(d => d.domain_id === domain.domain_id) ? policy.domains.map(d => d.domain_id === domain.domain_id ? domain : d) : [...policy.domains, domain];
      await session.setPublicationPolicy(project, policy.revision, domains);
      return { summary: `Согласование «${domain.domain_id}» в проекте «${str(r, "projectName")}» настроено` };
    }
    case "remove_review_domain": {
      const project = str(r, "project"), policy = await policyOf(session, project);
      if (policy.revision !== r.revision) throw new Error("Политика согласования изменилась после предложения: предложите заново.");
      await session.setPublicationPolicy(project, policy.revision, policy.domains.filter(d => d.domain_id !== str(r, "domain")));
      return { summary: `Согласование «${str(r, "domain")}» убрано из проекта «${str(r, "projectName")}»` };
    }
    case "revoke_person_right": {
      for (const right of JSON.parse(str(r, "rights")) as AdminRight[]) await session.removePersonRight(right);
      return { summary: `${str(r, "personName")} больше не имеет назначенного доступа к «${str(r, "projectName")}»` };
    }
    case "set_person_code_agent": {
      const right: AdminRight = { kind: "capability", principal_id: str(r, "person"), capability: CODE_AGENT_CAPABILITY };
      if (r.enabled === true) await session.grantPersonRight(right); else await session.removePersonRight(right);
      return { summary: `Агент кода у ${str(r, "personName")} ${r.enabled ? "включён" : "выключен"}` };
    }
    case "remove_person": {
      const out = await session.removePerson(str(r, "person"));
      return { summary: out.outcome === "already_removed" ? `${str(r, "personName")} уже удалён(а) из организации` : `${str(r, "personName")} удалён(а) из организации` };
    }
    case "create_competency": {
      const role = await session.createOrganizationRole({ id: str(r, "id"), kind: "functional_role", name: str(r, "name"), expected_generation: r.generation as number });
      return { summary: `Компетенция «${role.name}» создана` };
    }
    case "set_competency_member":
      await session.setPrincipalMembership(str(r, "role"), str(r, "person"), { expected_generation: r.generation as number, expected_enabled: r.enabled === true, enabled: r.member === true });
      return { summary: r.member ? `${str(r, "personName")} — в «${str(r, "roleName")}»` : `${str(r, "personName")} больше не в «${str(r, "roleName")}»` };
    case "decide_acceptance":
      await session.reviewCollaborationResult(str(r, "request"), { review_id: str(r, "reviewId"), expected_revision: r.revision as number, result_sequence: r.sequence as number, decision: r.accept ? "accepted" : "changes_requested", comment: str(r, "comment") });
      return { summary: r.accept ? `Работа «${str(r, "title")}» принята` : `Работа «${str(r, "title")}» возвращена на доработку` };
    case "decide_template": {
      await session.saveTemplateDecision(str(r, "proposal"), { request_id: str(r, "requestId"), approved: r.approve === true, scope_revision: r.scopeRevision as number, comment: str(r, "comment") });
      const result = await session.executeSavedTemplateDecision(str(r, "proposal"));
      if (!result.receipt) throw new Error("Mnemos не подтвердил решение по шаблону.");
      return { summary: `Шаблон «${str(r, "key")}» ${r.approve ? "одобрен" : "отклонён"}` };
    }
    case "decide_intake": {
      const project = str(r, "project");
      await session.decideInboxAlert(str(r, "alert"), r.approve ? { approve: true, place: str(r, "place"), ...(str(r, "note") ? { note: str(r, "note") } : {}), ...(project ? { intake_project_id: project } : {}) } : { approve: false, note: str(r, "note") });
      return { summary: r.approve ? `«${str(r, "file")}» будет размещён в проекте «${str(r, "projectName")}»` : `Размещение «${str(r, "file")}» отклонено` };
    }
    case "decide_team_budget":
      await session.decideTeamBudget(str(r, "project"), str(r, "proposal"), { decision_id: str(r, "decisionId"), expected_revision: r.revision as number, policy_revision: r.policy as number, decision: r.approve ? "approved" : "rejected", comment: str(r, "comment") });
      return { summary: `Расход ${r.approve ? "разрешён" : "отклонён"} (проект «${str(r, "projectName")}»)` };
    case "revoke_agent":
      await session.revokeAgentConnection(str(r, "binding"));
      return { summary: `Доступ агента «${str(r, "name")}» отозван` };
    case "set_agent_project_right":
      await session.setAgentProjectRight(str(r, "principal"), str(r, "project"), str(r, "mode") as "read" | "write", r.enabled === true);
      return { summary: `Право агента «${str(r, "name")}» на проект «${str(r, "projectName")}» ${r.enabled ? "выдано" : "снято"}` };
    case "set_agent_source_access": {
      const decision = { principal_id: str(r, "principal"), connection_revision: r.connectionRevision as number, expected_revision: r.revision as number, enabled: r.enabled === true };
      if (str(r, "type") === "mail") await session.setMailReadGrant(str(r, "connection"), decision); else await session.setCalendarReadGrant(str(r, "connection"), decision);
      return { summary: `Агенту «${str(r, "name")}» ${r.enabled ? "разрешено" : "запрещено"} читать ${str(r, "type") === "mail" ? "письма" : "календарь"}` };
    }
    case "disconnect_source": {
      const id = str(r, "connection");
      switch (str(r, "type") as SourceType) {
        case "imap": await session.removeImapAccount(id); break;
        case "caldav": await session.removeCalDAVAccount(id); break;
        case "webdav": await session.removeWebDAVAccount(id); break;
        case "telegram": await session.disconnectTelegram(id); break;
        case "database": await session.removeDatabaseConnection(str(r, "project"), str(r, "name")); break;
        case "github": await session.disconnectGitHubAccount(id); break;
        case "sync": await session.deleteGitSyncLink(id, r.revision as number); break;
      }
      return { summary: `Подключение «${str(r, "name")}» отключено` };
    }
    case "create_sync_link": {
      const source = str(r, "source") as "app" | "connection";
      await session.createGitSyncLink({ project_id: str(r, "project"), source, ...(source === "app" ? { installation_id: str(r, "installation") } : { connection_id: str(r, "connection") }),
        repository_id: str(r, "repository"), repository_name: str(r, "repositoryName"), branch: str(r, "branch"), folder: str(r, "folder"), include: [], exclude: [], visibility: str(r, "visibility") as GitSyncVisibility });
      return { summary: `«${str(r, "repositoryName")}» связан с проектом «${str(r, "projectName")}»; файлы придут после первой синхронизации` };
    }
    case "refresh_sync_link":
      await session.refreshGitSyncLink(str(r, "link"));
      return { summary: `«${str(r, "name")}» обновится в ближайшие минуты` };
    case "open_screen":
      return { summary: "Экран открыт" };
  }
}

// ---- чтения ----

export type ExtraReadKind = "org_rules" | "review_policy" | "person_rights" | "competencies" | "acceptances" | "template_proposals" | "intake_questions" | "team_budgets" | "agents" | "sources";
export type ExtraReadRequest =
  | { kind: "org_rules" } | { kind: "competencies" } | { kind: "acceptances" } | { kind: "template_proposals" } | { kind: "agents" }
  | { kind: "review_policy"; project: string } | { kind: "team_budgets"; project: string } | { kind: "intake_questions"; project: string }
  | { kind: "person_rights"; person: string } | { kind: "sources"; type: SourceType };
export const EXTRA_READ_KEYS: Record<ExtraReadKind, string[]> = {
  org_rules: [], competencies: [], acceptances: [], template_proposals: [], agents: [], review_policy: ["project"], team_budgets: ["project"],
  intake_questions: ["project"], person_rights: ["person"], sources: ["type"],
};
export const EXTRA_READ_TITLES: Record<ExtraReadKind, string> = {
  org_rules: "правила организации", review_policy: "согласование проекта", person_rights: "права сотрудника", competencies: "компетенции",
  acceptances: "приёмка работ", template_proposals: "предложения шаблонов", intake_questions: "вопросы приёмной", team_budgets: "командные бюджеты",
  agents: "агенты", sources: "подключения",
};

export function checkedExtraRead(kind: ExtraReadKind, v: Record<string, unknown>): ExtraReadRequest {
  switch (kind) {
    case "review_policy": case "team_budgets": return { kind, project: text(v.project, "проект") };
    case "intake_questions": return { kind, project: text(v.project, "проект", true) };
    case "person_rights": return { kind, person: text(v.person, "сотрудник") };
    case "sources": return { kind, type: oneOf(v.type, ["imap", "caldav", "webdav", "telegram", "database", "github", "sync"] as const, "type") };
    default: return { kind } as ExtraReadRequest;
  }
}

export async function readExtra(session: ExtraActionSession, request: ExtraReadRequest): Promise<unknown> {
  switch (request.kind) {
    case "org_rules": {
      const rules = await session.readProjectSharingSettings();
      return Object.fromEntries(Object.entries(rules).map(([key, value]) => [key, { value, words: RULE_WORDS[key as keyof ProjectSharingSettings] ? `${RULE_WORDS[key as keyof ProjectSharingSettings][0]}: ${RULE_WORDS[key as keyof ProjectSharingSettings][1][String(value)]}` : "" }]));
    }
    case "review_policy": {
      const p = await project(session, request.project), policy = await policyOf(session, p.id);
      const approvers = await allPages(async cursor => { const page = await session.listPolicyApprovers(p.id, cursor); return { items: page.approvers, next: page.next_cursor }; });
      const nameOf = new Map(approvers.map(a => [a.principal_id, a.display_name]));
      return { project: p.name, domains: policy.domains.map(d => ({ name: d.domain_id, allDocuments: !!d.all_documents, documents: d.node_ids.length, approvers: d.approver_ids.map(id => nameOf.get(id) ?? "коллега") })), candidates: approvers.map(a => a.display_name) };
    }
    case "person_rights": {
      const who = await person(session, request.person);
      const { projects } = await session.listProjects();
      const names = new Map(projects.map(p => [p.id, p.name]));
      const rights = await session.listPersonRights(who.userName);
      return { person: who.displayName, rights: rights.rights.filter(x => x.kind === "anchor").map(x => ({ project: names.get(x.project_id ?? "") ?? "проект без доступа", mode: x.mode, kind: x.class })) };
    }
    case "competencies": return (await competencies(session)).roles.map(r => ({ id: r.id, name: r.name }));
    case "acceptances": {
      const me = (await session.whoAmI()).subject.user_id;
      const requests = await allPages(async cursor => { const page = await session.listCollaborations(cursor); return { items: page.requests, next: page.next_cursor }; });
      const out = [];
      for (const r of requests.filter(r => r.requester_user_id === me).slice(0, 50)) {
        const progress = await session.readCollaborationProgress(r.request_id).catch(() => null);
        out.push({ id: r.request_id, title: r.title, project: await projectName(session, r.project_id), state: progress?.state ?? "unknown" });
      }
      return out;
    }
    case "template_proposals": {
      const scopes = await allPages(async cursor => { const page = await session.listTemplateReviewScopes(cursor); return { items: page.scopes, next: page.next_cursor }; });
      const out = [];
      for (const s of scopes.slice(0, 20)) {
        const page = await session.listTemplateProposals(s.scope_id, "");
        out.push(...page.proposals.filter(p => !p.decision).map(p => ({ id: p.proposal.proposal_id, template: p.proposal.template_key, scope: s.name, message: p.proposal.message })));
      }
      return out;
    }
    case "intake_questions": {
      const p = request.project ? await project(session, request.project) : null;
      const { alerts, truncated } = await session.inboxAlerts(false, p?.id);
      return { truncated, questions: alerts.slice(0, 50).map(a => ({ id: a.id, file: a.paths[0] ?? "", reason: a.reason, suggestedProject: a.suggested_project_name ?? a.proposed_project_slug ?? "", suggestedDomain: a.suggested_domain ?? "", status: a.status })) };
    }
    case "team_budgets": {
      const p = await project(session, request.project);
      const page = await session.listTeamBudgets(p.id, "");
      return page.proposals.map(b => ({ id: b.id, state: b.state, estimate: money(b.estimate_usd_micros), limit: money(b.limit_usd_micros), members: b.member_count }));
    }
    case "agents": return (await agents(session)).map(a => ({ id: a.binding_id, name: a.name }));
    case "sources": return (await sources(session, request.type)).map(s => ({ id: s.id, name: s.name, enabled: s.enabled }));
  }
}
