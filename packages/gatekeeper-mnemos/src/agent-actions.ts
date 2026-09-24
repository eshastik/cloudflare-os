/**
 * Действия, которые агент беседы предлагает от имени человека, а выполняются они только после
 * его подтверждения карточкой. Здесь — проверка аргументов, перевод имён в идентификаторы
 * (по тем же спискам, что видит человек на экранах), текст карточки и само выполнение
 * сессией человека: права проверяет сервер, агент не получает ничего сверх прав человека.
 */
import type { ActionCardIcon, ActionOutcome } from "@gadgets/workshop-shared/gatekeeper";
import type { PublicationReview } from "@gadgets/workshop-shared/publication-review";
import { MnemosAPIError, type InvitationRole, type OrgUnit, type OrganizationInvitation, type PrivateDocumentPage, type PrivateParticipantMode, type PrivateParticipantPage, type ProjectBudgetPolicy, type ProjectPage, type DraftState, type PublicationPolicy, type WhoAmI, type WorkJournalPage, type SpendingPeriod, type SpendingSummary } from "./mnemos-api.ts";
import type { ProjectVisibility, ProjectVisibilityResult, ShareRequest } from "./project-sharing.ts";
import type { MailConnectionPage } from "./mail-connections.ts";
import type { CalendarConnectionPage } from "./calendar-connections.ts";
import type { GitConnectionPage } from "./git-connections.ts";
import { EXTRA_AUTO_APPROVABLE, EXTRA_KEYS, EXTRA_LABELS, EXTRA_READ_KEYS, EXTRA_READ_TITLES, checkedExtraAction, checkedExtraRead, executeExtraAction, prepareExtraAction, readExtra, type ExtraActionKind, type ExtraActionRequest, type ExtraActionSession, type ExtraReadKind, type ExtraReadRequest } from "./agent-actions-extra.ts";

/** Методы сессии человека, которыми пользуются действия; MnemosAccountSession им удовлетворяет. */
export interface AgentActionSession {
  whoAmI(): Promise<WhoAmI>;
  listProjects(): Promise<ProjectPage>;
  draftState(project: string): Promise<DraftState>;
  listPrivateDocuments(project: string, cursor?: string): Promise<PrivateDocumentPage>;
  listPrivateDraftParticipants(project: string, node: string, head: string, cursor: string): Promise<PrivateParticipantPage>;
  setPrivateDraftParticipant(project: string, node: string, head: string, participant: string, expected: PrivateParticipantMode, mode: PrivateParticipantMode): Promise<{ participant_id: string; mode: PrivateParticipantMode }>;
  readPublicationPolicy(project: string): Promise<PublicationPolicy>;
  requestPublicationReview(project: string, personalHead: string, sharedHead: string): Promise<{ candidate_id: string }>;
  readPublicationReview(id: string): Promise<PublicationReview>;
  recordReviewDecision(id: string, domain: string, version: number, approved: boolean): Promise<void>;
  withdrawPublicationReview(id: string): Promise<void>;
  publishReview(project: string, id: string): Promise<{ published: boolean; conflicted: boolean }>;
  listShareRequests(mine?: boolean): Promise<{ requests: ShareRequest[] }>;
  decideShareRequest(request: string, approve: boolean): Promise<ShareRequest>;
  setProjectVisibility(project: string, level: ProjectVisibility, canEdit: boolean): Promise<ProjectVisibilityResult>;
  listOrgUnits(): Promise<OrgUnit[]>;
  createOrgUnit(name: string): Promise<OrgUnit>;
  deleteOrgUnit(unit: string): Promise<{ projects_made_private: number; members_removed: number }>;
  setOrgUnitMember(unit: string, principal: string, member: boolean, head: boolean): Promise<void>;
  listInvitations(): Promise<OrganizationInvitation[]>;
  createInvitation(email: string, displayName: string, orgUnit: string, role?: InvitationRole): Promise<OrganizationInvitation>;
  revokeInvitation(id: string): Promise<OrganizationInvitation>;
  readProjectBudget(project: string): Promise<ProjectBudgetPolicy>;
  setProjectBudget(project: string, policy: Omit<ProjectBudgetPolicy, "project_id">): Promise<ProjectBudgetPolicy>;
  listMailConnections(cursor?: string): Promise<MailConnectionPage>;
  listCalendarConnections(cursor?: string): Promise<CalendarConnectionPage>;
  listGitConnections(cursor?: string): Promise<GitConnectionPage>;
  disableMailConnection(id: string, expected: number): Promise<unknown>;
  disableCalendarConnection(id: string, expected: number): Promise<unknown>;
  disableGitConnection(id: string, expected: number): Promise<unknown>;
  listPublicationReviews(cursor: string): Promise<{ reviews: PublicationReview[]; next_cursor: string }>;
  listWorkJournal(project: string, cursor?: string): Promise<WorkJournalPage>;
  readSpending(period: SpendingPeriod, timeZone?: string): Promise<SpendingSummary>;
}

export type ShareMode = "read" | "write" | "none";
export type ConnectionType = "mail" | "calendar" | "git";

/** Что агент может предложить; каждое поле проверяется checkedAgentAction. */
export type AgentActionRequest =
  | { kind: "share_document"; project: string; document: string; person: string; mode: ShareMode }
  | { kind: "request_review"; project: string }
  | { kind: "decide_review"; review: string; approve: boolean }
  | { kind: "withdraw_review"; review: string }
  | { kind: "publish_review"; review: string }
  | { kind: "decide_access_request"; request: string; approve: boolean }
  | { kind: "set_project_visibility"; project: string; level: ProjectVisibility; canEdit: boolean }
  | { kind: "invite_person"; email: string; name: string; department: string; role: InvitationRole }
  | { kind: "revoke_invitation"; invitation: string }
  | { kind: "create_department"; name: string }
  | { kind: "delete_department"; department: string }
  | { kind: "set_department_member"; department: string; person: string; member: boolean; head: boolean }
  | { kind: "set_project_budget"; project: string; limitUsd: number }
  | { kind: "disable_connection"; type: ConnectionType; connection: string }
  | ExtraActionRequest;

export type AgentActionKind = AgentActionRequest["kind"];
type BaseActionKind = Exclude<AgentActionKind, ExtraActionKind>;
const isExtra = (kind: string): kind is ExtraActionKind => Object.hasOwn(EXTRA_KEYS, kind);

/** Подготовленное действие: текст карточки и закреплённые идентификаторы для выполнения. */
export interface PreparedAgentAction {
  kind: AgentActionKind;
  title: string;
  details: string[];
  icon: ActionCardIcon;
  /** Решает только владелец разговора, «Разрешать всегда» недоступно. */
  ownerOnly: boolean;
  resolved: Record<string, string | number | boolean>;
  /** Карточка-переход: кнопка открывает человеку экран приложения; действие ничего не меняет. */
  open?: { section: string; project?: string; label: string };
}

/** Виды, которые человек может разрешить насовсем: они не меняют доступ людей и ничего не удаляют. */
export const AUTO_APPROVABLE_KINDS: ReadonlySet<AgentActionKind> = new Set<AgentActionKind>(["request_review", ...EXTRA_AUTO_APPROVABLE]);
export const ACTION_LABELS: Record<AgentActionKind, string> = {
  share_document: "Поделиться документом", request_review: "Отправить на согласование",
  decide_review: "Решение по согласованию", withdraw_review: "Отозвать согласование",
  publish_review: "Опубликовать согласованное", decide_access_request: "Решение по запросу доступа",
  set_project_visibility: "Видимость проекта", invite_person: "Приглашение сотрудника",
  revoke_invitation: "Отзыв приглашения", create_department: "Создание отдела",
  delete_department: "Удаление отдела", set_department_member: "Состав отдела",
  set_project_budget: "Лимит расходов проекта", disable_connection: "Отключение подключения",
  ...EXTRA_LABELS,
};

const MODE_WORDS: Record<ShareMode, string> = { read: "может читать", write: "может править", none: "доступ закрыт" };
const LEVEL_WORDS: Record<ProjectVisibility, string> = { private: "только участникам", department: "отделу", organization: "всей организации" };
const CONNECTION_WORDS: Record<ConnectionType, string> = { mail: "почты", calendar: "календаря", git: "репозиториев кода" };
const ROLE_WORDS: Record<InvitationRole, string> = { employee: "сотрудник", head: "руководитель отдела", admin: "администратор" };
const LIST_PAGES = 20;

const KEYS: Record<BaseActionKind, string[]> = {
  share_document: ["project", "document", "person", "mode"], request_review: ["project"],
  decide_review: ["review", "approve"], withdraw_review: ["review"], publish_review: ["review"],
  decide_access_request: ["request", "approve"], set_project_visibility: ["project", "level", "canEdit"],
  invite_person: ["email", "name", "department", "role"], revoke_invitation: ["invitation"],
  create_department: ["name"], delete_department: ["department"],
  set_department_member: ["department", "person", "member", "head"],
  set_project_budget: ["project", "limitUsd"], disable_connection: ["type", "connection"],
};

export function text(value: unknown, label: string, empty = false, max = 255): string {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > max || /[\u0000-\u001f]/.test(value)) throw new Error(`Некорректное значение: ${label}.`);
  return value.trim();
}
export function flag(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Некорректное значение: ${label} — true или false.`);
  return value;
}
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new Error(`Некорректное значение: ${label} — одно из ${allowed.join(", ")}.`);
  return value as T;
}

/** Строгая проверка: лишние поля отвергаются, чтобы карточка и выполняемое тело совпадали. */
export function checkedAgentAction(input: unknown): AgentActionRequest {
  if (!input || typeof input !== "object") throw new Error("Не указано действие Mnemos.");
  const value = input as Record<string, unknown>;
  const kind = value.kind as AgentActionKind;
  if (typeof kind !== "string" || !(Object.hasOwn(KEYS, kind) || isExtra(kind))) throw new Error("Неизвестное действие Mnemos.");
  const keys = isExtra(kind) ? EXTRA_KEYS[kind] : KEYS[kind];
  if (Object.keys(value).some(key => key !== "kind" && !keys.includes(key))) throw new Error("Лишние параметры действия.");
  if (isExtra(kind)) return checkedExtraAction(kind, value);
  switch (kind) {
    case "share_document": return { kind, project: text(value.project, "проект"), document: text(value.document, "документ", false, 1024), person: text(value.person, "сотрудник"), mode: oneOf(value.mode, ["read", "write", "none"] as const, "mode") };
    case "request_review": return { kind, project: text(value.project, "проект") };
    case "decide_review": return { kind, review: text(value.review, "согласование"), approve: flag(value.approve, "approve") };
    case "withdraw_review": case "publish_review": return { kind, review: text(value.review, "согласование") };
    case "decide_access_request": return { kind, request: text(value.request, "запрос"), approve: flag(value.approve, "approve") };
    case "set_project_visibility": return { kind, project: text(value.project, "проект"), level: oneOf(value.level, ["private", "department", "organization"] as const, "level"), canEdit: flag(value.canEdit, "canEdit") };
    case "invite_person": {
      const email = text(value.email, "почта");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Некорректное значение: почта.");
      return { kind, email, name: text(value.name, "имя"), department: text(value.department, "отдел", true), role: oneOf(value.role, ["employee", "head", "admin"] as const, "role") };
    }
    case "revoke_invitation": return { kind, invitation: text(value.invitation, "приглашение") };
    case "create_department": return { kind, name: text(value.name, "название отдела") };
    case "delete_department": return { kind, department: text(value.department, "отдел") };
    case "set_department_member": return { kind, department: text(value.department, "отдел"), person: text(value.person, "сотрудник"), member: flag(value.member, "member"), head: flag(value.head, "head") };
    case "set_project_budget": {
      const limit = value.limitUsd;
      if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0 || limit > 1_000_000) throw new Error("Некорректное значение: limitUsd — сумма в долларах от 0 до 1 000 000.");
      return { kind, project: text(value.project, "проект"), limitUsd: Math.round(limit * 100) / 100 };
    }
    case "disable_connection": return { kind, type: oneOf(value.type, ["mail", "calendar", "git"] as const, "type"), connection: text(value.connection, "подключение") };
  }
}

// ---- поиск по именам: те же списки, что видит человек ----

function normalized(value: string): string { return value.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/\s+/g, " ").trim(); }
/** Слово запроса совпадает со словом имени по началу; падежные окончания («Николаю») допускаются. */
function wordMatches(query: string, word: string): boolean {
  if (word.startsWith(query)) return true;
  let common = 0;
  while (common < query.length && common < word.length && query[common] === word[common]) common++;
  return common >= 4 && common >= Math.min(query.length, word.length) - 2;
}
/** Один кандидат по id, точному имени или словам имени; иначе — понятный отказ со списком. */
export function pickOne<T>(items: T[], query: string, id: (item: T) => string, name: (item: T) => string, what: string): T {
  const byId = items.find(item => id(item) === query);
  if (byId) return byId;
  const wanted = normalized(query);
  const exact = items.filter(item => normalized(name(item)) === wanted);
  if (exact.length === 1) return exact[0];
  const words = wanted.split(" ");
  const loose = exact.length > 1 ? exact : items.filter(item => { const parts = normalized(name(item)).split(" "); return words.every(w => parts.some(p => wordMatches(w, p))); });
  if (loose.length === 1) return loose[0];
  const shown = (loose.length ? loose : items).slice(0, 10).map(name).join(", ");
  if (loose.length > 1) throw new Error(`Под «${query}» подходят несколько (${what}): ${shown}. Уточните.`);
  throw new Error(`Не найдено (${what}) «${query}».${shown ? ` Есть: ${shown}.` : ""}`);
}

export async function project(session: AgentActionSession, query: string) {
  const { projects } = await session.listProjects();
  return pickOne(projects, query, p => p.id, p => p.name, "проект");
}
export async function allPages<T>(read: (cursor: string) => Promise<{ items: T[]; next?: string }>): Promise<T[]> {
  const out: T[] = []; let cursor = ""; const seen = new Set<string>();
  for (let page = 0; page < LIST_PAGES; page++) {
    const { items, next } = await read(cursor);
    out.push(...items);
    if (!next || seen.has(next)) break;
    seen.add(next); cursor = next;
  }
  return out;
}
async function personalDocument(session: AgentActionSession, projectId: string, query: string) {
  let head = "";
  const documents = await allPages(async cursor => {
    const page = await session.listPrivateDocuments(projectId, cursor);
    if (!head) head = page.head;
    return { items: page.documents, next: page.next_cursor };
  });
  const found = pickOne(documents, query, d => d.node_id, d => d.name.replace(/\.[^.]+$/, ""), "документ среди ваших личных документов проекта");
  return { document: found, head };
}
async function participants(session: AgentActionSession, projectId: string, node: string, head: string) {
  return allPages(async cursor => {
    const page = await session.listPrivateDraftParticipants(projectId, node, head, cursor);
    return { items: page.participants, next: page.next_cursor };
  });
}
export async function department(session: AgentActionSession, query: string) {
  return pickOne(await session.listOrgUnits(), query, u => u.org_unit_id, u => u.name, "отдел");
}
async function connections(session: AgentActionSession, type: ConnectionType) {
  const read = type === "mail" ? (c: string) => session.listMailConnections(c) : type === "calendar" ? (c: string) => session.listCalendarConnections(c) : (c: string) => session.listGitConnections(c);
  const items = await allPages(async cursor => { const page = await read(cursor); return { items: page.connections as { connection_id: string; enabled: boolean; revision: number; provider: string; name?: string; account_login?: string; calendar_id?: string }[], next: page.next_cursor }; });
  return items.map(item => ({ id: item.connection_id, enabled: item.enabled, revision: item.revision, name: item.name || item.account_login || item.calendar_id || item.provider }));
}
export function money(micros: string | bigint): string {
  const cents = BigInt(micros) / 10000n;
  return `$${cents / 100n}${cents % 100n ? "." + String(cents % 100n).padStart(2, "0") : ""}`;
}
/** Проект действия должен входить в область агента (ADR 0010): иначе сначала proposeConnectProject. */
export function inScope(scope: ReadonlySet<string>, projectId: string, projectName: string) {
  if (!scope.has(projectId)) throw new Error(`Проект «${projectName}» не подключён к агенту. Сначала предложите подключение: proposeConnectProject(requestId, "${projectName}").`);
}
async function reviewOf(session: AgentActionSession, id: string) {
  try { return await session.readPublicationReview(id); }
  catch (error) { if (error instanceof MnemosAPIError && [403, 404].includes(error.status)) throw new Error("Согласование не найдено или недоступно. Посмотрите список: listReviews()."); throw error; }
}
export async function projectName(session: AgentActionSession, id: string) {
  const { projects } = await session.listProjects();
  return projects.find(p => p.id === id)?.name ?? "проект без доступа";
}

/** Проверка и перевод в идентификаторы; ничего не меняет. scope — проекты, подключённые к агенту. */
export async function prepareAgentAction(session: AgentActionSession, scope: ReadonlySet<string>, request: AgentActionRequest): Promise<PreparedAgentAction> {
  const me = await session.whoAmI();
  if (me.subject.agent_principal_id) throw new Error("Действие выполняется только от имени человека.");
  if (isExtra(request.kind)) return { kind: request.kind, ...await prepareExtraAction(session as ExtraActionSession, scope, request as ExtraActionRequest) };
  switch (request.kind) {
    case "share_document": {
      const p = await project(session, request.project); inScope(scope, p.id, p.name);
      const { document, head } = await personalDocument(session, p.id, request.document);
      const people = await participants(session, p.id, document.node_id, head);
      const person = pickOne(people, request.person, x => x.principal_id, x => x.display_name, "сотрудник");
      if (person.principal_id === me.subject.user_id) throw new Error("Это вы сами: делиться документом с собой не нужно.");
      const mode: PrivateParticipantMode = request.mode === "none" ? "" : request.mode;
      if (person.mode === mode) throw new Error(`Доступ уже такой: ${person.display_name} — ${MODE_WORDS[request.mode]} «${document.name}».`);
      const before = person.mode === "" ? "Сейчас доступа к документу нет" : `Сейчас ${MODE_WORDS[person.mode]}`;
      return { kind: request.kind, icon: "share", ownerOnly: true,
        // Имя не склоняется: «с Николай Деревцов» звучит хуже, чем имя после двоеточия.
        title: request.mode === "none" ? `Закрыть доступ к «${document.name}»: ${person.display_name}` : `Поделиться документом «${document.name}»: ${person.display_name} — ${MODE_WORDS[request.mode]}`,
        details: [`Проект «${p.name}»`, before, ...((request.mode === "read" && person.document_only_read) || (request.mode === "write" && person.document_only_write) ? ["Получит доступ только к этому документу, без папки проекта"] : [])],
        resolved: { project: p.id, projectName: p.name, node: document.node_id, name: document.name, person: person.principal_id, personName: person.display_name, expected: person.mode, mode } };
    }
    case "request_review": {
      const p = await project(session, request.project); inScope(scope, p.id, p.name);
      const state = await session.draftState(p.id);
      if (!state.personal_exists) throw new Error(`В проекте «${p.name}» нет личного черновика: отправлять нечего.`);
      let policy: PublicationPolicy | null = null;
      try { policy = await session.readPublicationPolicy(p.id); } catch (error) { if (!(error instanceof MnemosAPIError && error.status === 404)) throw error; }
      if (!policy?.domains.length) throw new Error(`В проекте «${p.name}» согласование не включено: изменения публикуются через publishDraft().`);
      return { kind: request.kind, icon: "review", ownerOnly: false,
        title: `Отправить на согласование изменения проекта «${p.name}»`,
        details: ["Все изменения вашего личного черновика уйдут ответственным", "Опубликовать их можно будет после решения"],
        resolved: { project: p.id, projectName: p.name, personal: state.personal_head, shared: state.shared_head } };
    }
    case "decide_review": {
      const review = await reviewOf(session, request.review);
      const mine = review.domains.filter(d => d.approvers.includes(me.subject.user_id) && !d.decisions.some(x => x.approver_id === me.subject.user_id));
      if (review.stale || review.withdrawn) throw new Error("Согласование устарело или отозвано автором.");
      if (!mine.length) throw new Error("По этому согласованию от вас решение не требуется.");
      const name = await projectName(session, review.project_id);
      const documents = mine.reduce((n, d) => n + d.node_ids.length, 0);
      return { kind: request.kind, icon: "review", ownerOnly: true,
        title: `${request.approve ? "Согласовать" : "Отклонить"} изменения в проекте «${name}»`,
        details: [`Документов на решении: ${documents}`, request.approve ? "После всех согласий автор сможет опубликовать изменения" : "Автор увидит отказ во «Входящих»"],
        resolved: { review: review.candidate_id, projectName: name, approve: request.approve, version: review.decision_version } };
    }
    case "withdraw_review": case "publish_review": {
      const review = await reviewOf(session, request.review);
      if (review.author_id !== me.subject.user_id) throw new Error("Это согласование отправили не вы: отозвать или опубликовать его может только автор.");
      const name = await projectName(session, review.project_id); inScope(scope, review.project_id, name);
      if (request.kind === "publish_review" && (review.stale || !review.ready)) throw new Error("Согласование ещё не собрано или устарело: публиковать рано.");
      return { kind: request.kind, icon: request.kind === "publish_review" ? "publish" : "delete", ownerOnly: true,
        title: request.kind === "publish_review" ? `Опубликовать согласованные изменения проекта «${name}»` : `Отозвать запрос на согласование в проекте «${name}»`,
        details: request.kind === "publish_review" ? ["Изменения увидят все, у кого есть доступ к проекту"] : ["Решения ответственных по нему перестанут действовать"],
        resolved: { review: review.candidate_id, project: review.project_id, projectName: name } };
    }
    case "decide_access_request": {
      const { requests } = await session.listShareRequests(false);
      const found = requests.find(r => r.request_id === request.request && r.status === "pending");
      if (!found) throw new Error("Запрос не найден среди ждущих вашего решения. Посмотрите список: listAccessRequests().");
      const whom = found.level === "department" ? `отделу${found.org_unit_name ? ` «${found.org_unit_name}»` : ""}` : LEVEL_WORDS[found.level];
      return { kind: request.kind, icon: "visibility", ownerOnly: true,
        title: `${request.approve ? "Разрешить" : "Отклонить"}: проект «${found.project_name}» виден ${whom}`,
        details: [`Просит ${found.requested_by_name}`, found.can_edit ? "С правом правки" : "Только чтение"],
        resolved: { request: found.request_id, projectName: found.project_name, approve: request.approve } };
    }
    case "set_project_visibility": {
      const p = await project(session, request.project); inScope(scope, p.id, p.name);
      return { kind: request.kind, icon: "visibility", ownerOnly: true,
        title: `Открыть проект «${p.name}» ${LEVEL_WORDS[request.level]}${request.level === "private" ? "" : request.canEdit ? " — с правкой" : " — только чтение"}`,
        details: ["Если нужно решение руководителя или администратора, уйдёт запрос"],
        resolved: { project: p.id, projectName: p.name, level: request.level, canEdit: request.canEdit } };
    }
    case "invite_person": {
      const unit = request.department ? await department(session, request.department) : null;
      return { kind: request.kind, icon: "invitation", ownerOnly: true,
        title: `Пригласить ${request.name} (${request.email}) в организацию`,
        details: [`Роль: ${ROLE_WORDS[request.role]}${unit ? `, отдел «${unit.name}»` : ", без отдела"}`, "На почту уйдёт письмо с приглашением"],
        resolved: { email: request.email, name: request.name, unit: unit?.org_unit_id ?? "", unitName: unit?.name ?? "", role: request.role } };
    }
    case "revoke_invitation": {
      const open = (await session.listInvitations()).filter(i => i.status === "open");
      const found = pickOne(open, request.invitation, i => i.invitation_id, i => i.email, "открытое приглашение");
      return { kind: request.kind, icon: "delete", ownerOnly: true,
        title: `Отозвать приглашение ${found.display_name || found.email}`, details: [`Почта ${found.email}`, "Ссылка из письма перестанет работать"],
        resolved: { invitation: found.invitation_id, email: found.email } };
    }
    case "create_department":
      return { kind: request.kind, icon: "department", ownerOnly: true, title: `Создать отдел «${request.name}»`, details: ["Сотрудников в него добавляют отдельно"], resolved: { name: request.name } };
    case "delete_department": {
      const unit = await department(session, request.department);
      return { kind: request.kind, icon: "delete", ownerOnly: true, title: `Удалить отдел «${unit.name}»`,
        details: [`Сотрудников в отделе: ${unit.members.length}; они останутся в организации без отдела`, "Проекты отдела станут личными"],
        resolved: { unit: unit.org_unit_id, unitName: unit.name } };
    }
    case "set_department_member": {
      const unit = await department(session, request.department);
      const everyone = new Map<string, { principal_id: string; display_name: string }>();
      for (const u of await session.listOrgUnits()) for (const m of u.members) everyone.set(m.principal_id, m);
      const person = pickOne([...everyone.values()], request.person, m => m.principal_id, m => m.display_name, "сотрудник в отделах");
      return { kind: request.kind, icon: "department", ownerOnly: true,
        title: request.member ? `Добавить ${person.display_name} в отдел «${unit.name}»${request.head ? " руководителем" : ""}` : `Убрать ${person.display_name} из отдела «${unit.name}»`,
        details: ["Состав отдела влияет на доступ к проектам отдела"],
        resolved: { unit: unit.org_unit_id, unitName: unit.name, person: person.principal_id, personName: person.display_name, member: request.member, head: request.member && request.head } };
    }
    case "set_project_budget": {
      const p = await project(session, request.project); inScope(scope, p.id, p.name);
      const current = await session.readProjectBudget(p.id);
      const limit = String(Math.round(request.limitUsd * 100) * 10000);
      return { kind: request.kind, icon: "budget", ownerOnly: true, title: `Лимит расходов проекта «${p.name}»: ${money(limit)}`,
        details: [`Сейчас ${money(current.limit_usd_micros)}`],
        resolved: { project: p.id, projectName: p.name, revision: current.revision, limit } };
    }
    case "disable_connection": {
      const list = (await connections(session, request.type)).filter(c => c.enabled);
      const found = pickOne(list, request.connection, c => c.id, c => c.name, `включённое подключение ${CONNECTION_WORDS[request.type]}`);
      return { kind: request.kind, icon: request.type === "git" ? "code" : request.type, ownerOnly: true,
        title: `Отключить подключение ${CONNECTION_WORDS[request.type]} «${found.name}»`, details: ["Данные из него перестанут поступать в память"],
        resolved: { type: request.type, connection: found.id, name: found.name, revision: found.revision } };
    }
  }
}

/** Ошибка сервера словами для агента: класс MnemosAPIError не переживает RPC между объектами. */
export function agentActionError(error: unknown): Error {
  if (!(error instanceof MnemosAPIError)) return error instanceof Error ? error : new Error(String(error));
  if (error.status === 401) return new Error("Аккаунт Mnemos отключён или срок входа истёк; войдите заново в приложении Mnemos.");
  if (error.status === 403) return new Error("Mnemos отказал: у человека нет права на это действие.");
  if (error.status === 404) return new Error("Не найдено или нет доступа.");
  if (error.status === 409) return new Error("Данные изменились после предложения; предложите действие заново.");
  return new Error(`Mnemos не выполнил действие (код ${error.status}).`);
}

export function str(resolved: PreparedAgentAction["resolved"], key: string): string { const v = resolved[key]; if (typeof v !== "string") throw new Error("Подготовленное действие повреждено."); return v; }

/** Выполнение подтверждённого действия сессией человека; итог — одна фраза для карточки и агента. */
export async function executeAgentAction(session: AgentActionSession, kind: AgentActionKind, r: PreparedAgentAction["resolved"]): Promise<ActionOutcome> {
  if (isExtra(kind)) return executeExtraAction(session as ExtraActionSession, kind, r);
  switch (kind) {
    case "share_document": {
      const project = str(r, "project"), node = str(r, "node");
      const { head } = await session.listPrivateDocuments(project, "");
      const mode = str(r, "mode") as PrivateParticipantMode;
      try { await session.setPrivateDraftParticipant(project, node, head, str(r, "person"), str(r, "expected") as PrivateParticipantMode, mode); }
      catch (error) { if (error instanceof MnemosAPIError && error.status === 409) throw new Error("Доступ к документу изменился после предложения. Попросите агента предложить заново."); throw error; }
      return { summary: mode === "" ? `${str(r, "personName")} больше не видит «${str(r, "name")}»` : `${str(r, "personName")} ${MODE_WORDS[mode]} «${str(r, "name")}»` };
    }
    case "request_review": {
      const project = str(r, "project"), state = await session.draftState(project);
      if (state.personal_head !== str(r, "personal") || state.shared_head !== str(r, "shared")) throw new Error("Черновик изменился после предложения: отправьте на согласование заново.");
      await session.requestPublicationReview(project, state.personal_head, state.shared_head);
      return { summary: `Изменения проекта «${str(r, "projectName")}» отправлены ответственным` };
    }
    case "decide_review": {
      const id = str(r, "review");
      let review = await session.readPublicationReview(id);
      if (review.decision_version !== r.version) throw new Error("Согласование изменилось после предложения: посмотрите его заново.");
      const me = (await session.whoAmI()).subject.user_id;
      const mine = review.domains.filter(d => d.approvers.includes(me) && !d.decisions.some(x => x.approver_id === me));
      for (const domain of mine) {
        await session.recordReviewDecision(id, domain.domain_id, review.decision_version, r.approve === true);
        review = await session.readPublicationReview(id);
      }
      return { summary: `${r.approve ? "Согласовано" : "Отклонено"}: изменения проекта «${str(r, "projectName")}»` };
    }
    case "withdraw_review":
      await session.withdrawPublicationReview(str(r, "review"));
      return { summary: `Запрос на согласование в проекте «${str(r, "projectName")}» отозван` };
    case "publish_review": {
      const result = await session.publishReview(str(r, "project"), str(r, "review"));
      if (result.conflicted) return { summary: "Изменения конфликтуют с опубликованной версией; конфликт сохранён в черновике" };
      return { summary: `Изменения проекта «${str(r, "projectName")}» опубликованы` };
    }
    case "decide_access_request": {
      const out = await session.decideShareRequest(str(r, "request"), r.approve === true);
      return { summary: `${out.status === "approved" ? "Разрешено" : "Отклонено"}: видимость проекта «${str(r, "projectName")}»` };
    }
    case "set_project_visibility": {
      const out = await session.setProjectVisibility(str(r, "project"), str(r, "level") as ProjectVisibility, r.canEdit === true);
      return { summary: out.applied ? `Проект «${str(r, "projectName")}» открыт ${LEVEL_WORDS[out.visibility]}` : `Запрос на видимость проекта «${str(r, "projectName")}» отправлен на решение` };
    }
    case "invite_person": {
      const out = await session.createInvitation(str(r, "email"), str(r, "name"), str(r, "unit"), str(r, "role") as InvitationRole);
      return { summary: `Приглашение для ${out.email} создано${out.email_status === "sent" ? " и отправлено" : "; код — в разделе «Люди»"}` };
    }
    case "revoke_invitation":
      await session.revokeInvitation(str(r, "invitation"));
      return { summary: `Приглашение для ${str(r, "email")} отозвано` };
    case "create_department": {
      const unit = await session.createOrgUnit(str(r, "name"));
      return { summary: `Отдел «${unit.name}» создан` };
    }
    case "delete_department": {
      const out = await session.deleteOrgUnit(str(r, "unit"));
      return { summary: `Отдел «${str(r, "unitName")}» удалён; проектов стало личными: ${out.projects_made_private}` };
    }
    case "set_department_member":
      await session.setOrgUnitMember(str(r, "unit"), str(r, "person"), r.member === true, r.head === true);
      return { summary: r.member ? `${str(r, "personName")} — в отделе «${str(r, "unitName")}»` : `${str(r, "personName")} больше не в отделе «${str(r, "unitName")}»` };
    case "set_project_budget": {
      const project = str(r, "project"), current = await session.readProjectBudget(project);
      if (current.revision !== r.revision) throw new Error("Лимит проекта изменился после предложения: предложите заново.");
      const limit = str(r, "limit");
      const automatic = BigInt(current.automatic_usd_micros) > BigInt(limit) ? limit : current.automatic_usd_micros;
      await session.setProjectBudget(project, { revision: current.revision, owner_id: current.owner_id, limit_usd_micros: limit, automatic_usd_micros: automatic, automatic_team_size: current.automatic_team_size });
      return { summary: `Лимит проекта «${str(r, "projectName")}»: ${money(limit)}` };
    }
    case "disable_connection": {
      const type = str(r, "type") as ConnectionType, id = str(r, "connection"), revision = r.revision as number;
      if (type === "mail") await session.disableMailConnection(id, revision);
      else if (type === "calendar") await session.disableCalendarConnection(id, revision);
      else await session.disableGitConnection(id, revision);
      return { summary: `Подключение «${str(r, "name")}» отключено` };
    }
  }
}

// ---- чтения для агента: то же, что человек видит на экранах; ничего не меняют ----

export type AgentReadRequest =
  | { kind: "document_access"; project: string; document: string }
  | { kind: "reviews" }
  | { kind: "access_requests" }
  | { kind: "departments" }
  | { kind: "invitations" }
  | { kind: "project_budget"; project: string }
  | { kind: "connections"; type: ConnectionType }
  | { kind: "work_journal"; project: string }
  | { kind: "spending"; period: SpendingPeriod }
  | ExtraReadRequest;
const isExtraRead = (kind: string): kind is ExtraReadKind => Object.hasOwn(EXTRA_READ_KEYS, kind);
export const READ_TITLES: Record<AgentReadRequest["kind"], string> = {
  document_access: "кому открыт документ", reviews: "согласования", access_requests: "запросы на доступ",
  departments: "отделы", invitations: "приглашения", project_budget: "лимит проекта",
  connections: "подключения", work_journal: "журнал работ проекта", spending: "расходы",
  ...EXTRA_READ_TITLES,
};

const JOURNAL_LIMIT = 50;

export function checkedAgentRead(input: unknown): AgentReadRequest {
  if (!input || typeof input !== "object") throw new Error("Не указано чтение Mnemos.");
  const v = input as Record<string, unknown>;
  const keys: Record<string, string[]> = { document_access: ["project", "document"], reviews: [], access_requests: [], departments: [], invitations: [], project_budget: ["project"], connections: ["type"], work_journal: ["project"], spending: ["period"] };
  if (typeof v.kind === "string" && isExtraRead(v.kind)) {
    if (Object.keys(v).some(k => k !== "kind" && !EXTRA_READ_KEYS[v.kind as ExtraReadKind].includes(k))) throw new Error("Неизвестное чтение Mnemos.");
    return checkedExtraRead(v.kind, v);
  }
  if (typeof v.kind !== "string" || !Object.hasOwn(keys, v.kind) || Object.keys(v).some(k => k !== "kind" && !keys[v.kind as string].includes(k))) throw new Error("Неизвестное чтение Mnemos.");
  switch (v.kind) {
    case "document_access": return { kind: v.kind, project: text(v.project, "проект"), document: text(v.document, "документ", false, 1024) };
    case "project_budget": case "work_journal": return { kind: v.kind, project: text(v.project, "проект") };
    case "connections": return { kind: v.kind, type: oneOf(v.type, ["mail", "calendar", "git"] as const, "type") };
    case "spending": return { kind: v.kind, period: oneOf(v.period, ["today", "7d", "30d", "all"] as const, "period") };
    default: return { kind: v.kind } as AgentReadRequest;
  }
}

/** Ответ чтения — простые данные: id нужны агенту для следующего вызова, имена — для разговора. */
export async function readForAgent(session: AgentActionSession, request: AgentReadRequest): Promise<unknown> {
  if (isExtraRead(request.kind)) return readExtra(session as ExtraActionSession, request as ExtraReadRequest);
  switch (request.kind) {
    case "document_access": {
      const p = await project(session, request.project);
      const { document, head } = await personalDocument(session, p.id, request.document);
      const people = await participants(session, p.id, document.node_id, head);
      return { project: p.name, document: document.name, people: people.map(x => ({ id: x.principal_id, name: x.display_name, access: x.mode === "" ? (x.can_write ? "write-by-folder" : x.can_read ? "read-by-folder" : "none") : x.mode })) };
    }
    case "reviews": {
      const me = (await session.whoAmI()).subject.user_id;
      const { projects } = await session.listProjects();
      const names = new Map(projects.map(p => [p.id, p.name]));
      const reviews = await allPages(async cursor => { const page = await session.listPublicationReviews(cursor); return { items: page.reviews, next: page.next_cursor }; });
      return reviews.map(r => ({ id: r.candidate_id, project: names.get(r.project_id) ?? "", mine: r.author_id === me,
        waitsForMe: r.domains.some(d => d.approvers.includes(me) && !d.decisions.some(x => x.approver_id === me)),
        ready: r.ready, stale: r.stale, withdrawn: !!r.withdrawn, documents: r.domains.reduce((n, d) => n + d.node_ids.length, 0) }));
    }
    case "access_requests": {
      const waiting = (await session.listShareRequests(false)).requests.filter(r => r.status === "pending");
      const mine = (await session.listShareRequests(true)).requests;
      const row = (r: ShareRequest) => ({ id: r.request_id, project: r.project_name, level: r.level, canEdit: r.can_edit, department: r.org_unit_name ?? "", requestedBy: r.requested_by_name, status: r.status });
      return { waitingForMe: waiting.map(row), mine: mine.map(row) };
    }
    case "departments":
      return (await session.listOrgUnits()).map(u => ({ id: u.org_unit_id, name: u.name, members: u.members.map(m => ({ id: m.principal_id, name: m.display_name, head: m.is_head })) }));
    case "invitations":
      return (await session.listInvitations()).map(i => ({ id: i.invitation_id, email: i.email, name: i.display_name, department: i.org_unit_name ?? "", role: i.role ?? "employee", status: i.status, expiresAt: i.expires_at }));
    case "project_budget": {
      const p = await project(session, request.project), b = await session.readProjectBudget(p.id);
      return { project: p.name, limit: money(b.limit_usd_micros), withoutApproval: money(b.automatic_usd_micros), teamSizeWithoutApproval: b.automatic_team_size };
    }
    case "connections":
      return (await connections(session, request.type)).map(c => ({ id: c.id, name: c.name, enabled: c.enabled }));
    case "work_journal": {
      const p = await project(session, request.project), page = await session.listWorkJournal(p.id, "");
      return { project: p.name, truncated: page.truncated || page.entries.length > JOURNAL_LIMIT, entries: page.entries.slice(0, JOURNAL_LIMIT).map(e => ({ at: e.recorded_at, by: e.actor, summary: e.summary, outcome: e.outcome, changed: e.changed.slice(0, 20) })) };
    }
    case "spending": {
      const s = await session.readSpending(request.period);
      const top = (groups: { name: string; micro_usd: string }[]) => groups.slice(0, 10).map(g => ({ name: g.name, amount: money(g.micro_usd) }));
      return { period: s.period, total: money(s.micro_usd), operations: s.count, projects: top(s.projects), people: top(s.people), models: top(s.models) };
    }
  }
}
