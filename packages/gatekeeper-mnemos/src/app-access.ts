// Право человека на узел приложения Mnemos (ADR 0028, этап 2). Тот же механизм, что у документа:
// участник узла (приглашение с чтением или правкой), свой черновик проекта (владелец узла или
// участник проекта с правом записи) и общая версия проекта (отдел или организация читают
// опубликованное). Каждый ответ — от Mnemos сессией самого человека; здесь только сведение.

import { APP_ACCESS_DENIED_CODE, APP_CODE_CLOSED, gadgetAccessError } from "@gadgets/workshop-shared/gadget-app";
import { HISTORY_PREPARING } from "./history-preparing.ts";
import { MnemosAPIError, type DraftDocument, type InvitedDocumentPage, type NodeHistoryPage, type OrgUnit, type SharedDocument, type WhoAmI } from "./mnemos-api.ts";

export const APP_MIME = "application/vnd.cloudflareos.app+json";

/** Билет на тело узла приложения — только служебному кадру сервера оболочки (ADR 0028, п. 4):
 *  страница и агент беседы получают отказ. */
export function refuseAppCode<T extends { content_type?: string }>(ticket: T, appCode: boolean): T {
  if (!appCode && ticket.content_type === APP_MIME) throw new Error(APP_CODE_CLOSED);
  return ticket;
}
/** Текст отказа, когда у человека нет доступа к узлу приложения. */
export const APP_ACCESS_DENIED = "Приложение вам недоступно: нет доступа к этому файлу проекта.";

/** Методы сессии Mnemos, из которых сводится право. */
export type AppAccessSession = {
  whoAmI(): Promise<WhoAmI>;
  listInvitedDocuments(project: string, cursor?: string, node?: string): Promise<InvitedDocumentPage>;
  listSharedDocuments(): Promise<SharedDocument[]>;
  openDraft(project: string): Promise<unknown>;
  readDraftDocument(project: string, node: string): Promise<DraftDocument>;
  nodeHistory(project: string, node: string, cursor?: string, limit?: number): Promise<NodeHistoryPage>;
  listOrgUnits(): Promise<OrgUnit[]>;
  listProjects(): Promise<{ projects: { id: string }[] }>;
};

/** project и node — как их назвал Mnemos; из них оболочка строит ключ экземпляра приложения. */
export type AppAccess = { access: "read" | "edit"; principal: string; tenant: string; name: string; project: string; node: string };

const expected = (error: unknown, statuses: number[]) => error instanceof MnemosAPIError && (statuses.includes(error.status) || error.code === HISTORY_PREPARING);

/**
 * Право на узел приложения сейчас. opening — первое открытие: личный черновик открывается (так же, как
 * при открытии документа), а имя и организация читаются. Нет доступа — ошибка APP_ACCESS_DENIED.
 */
export async function appAccess(session: AppAccessSession, project: string, node: string, opening: boolean): Promise<AppAccess> {
  if (typeof project !== "string" || typeof node !== "string" || !project || !node || project.length > 255 || node.length > 255) throw gadgetAccessError(APP_ACCESS_DENIED_CODE, APP_ACCESS_DENIED);
  const identity = await session.whoAmI();
  const principal = identity.subject.user_id;
  const tenant = opening ? identity.subject.tenant_id : "";
  const name = async () => {
    if (!opening) return "";
    try { return (await session.listOrgUnits()).flatMap(u => u.members).find(m => m.principal_id === principal)?.display_name ?? ""; }
    catch { return ""; }
  };
  // Проект из списка проектов человека: ключ экземпляра строится из ответа Mnemos, не из ввода страницы.
  const canonicalProject = async () => opening ? (await session.listProjects()).projects.find(p => p.id === project)?.id ?? null : project;

  // 1. Приглашение к узлу: право — из «Поделились с вами» (правка или чтение).
  const invited = (await session.listInvitedDocuments(project, "", node)).documents;
  if (invited.length) {
    if (invited.length !== 1 || invited[0].content_type !== APP_MIME) throw gadgetAccessError(APP_ACCESS_DENIED_CODE, APP_ACCESS_DENIED);
    const shared = (await session.listSharedDocuments()).find(d => d.project_id === project && d.node_id === node && d.owner_id === invited[0].owner_id);
    if (!shared) throw gadgetAccessError(APP_ACCESS_DENIED_CODE, APP_ACCESS_DENIED);
    return { access: shared.mode === "write" ? "edit" : "read", principal, tenant, name: await name(), project: shared.project_id, node: invited[0].node_id };
  }

  // 2. Свой черновик проекта с этим узлом: владелец или участник проекта с правом записи.
  if (opening) {
    try { await session.openDraft(project); }
    catch (error) { if (!expected(error, [403, 404])) throw error; }
  }
  let draft: DraftDocument | undefined;
  try { draft = await session.readDraftDocument(project, node); }
  catch (error) { if (!expected(error, [403, 404])) throw error; }
  if (draft?.exists && !draft.conflicted && draft.content_type === APP_MIME) {
    const canonical = await canonicalProject();
    if (!canonical) throw gadgetAccessError(APP_ACCESS_DENIED_CODE, APP_ACCESS_DENIED);
    return { access: "edit", principal, tenant, name: await name(), project: canonical, node: draft.node_id };
  }

  // 3. Общая версия проекта (отдел, организация): только чтение опубликованного.
  let history: NodeHistoryPage | undefined;
  try { history = await session.nodeHistory(project, node, "", 1); }
  catch (error) { if (!expected(error, [403, 404])) throw error; }
  const last = history?.events[0];
  if (last?.exists && last.content_type === APP_MIME) {
    const canonical = await canonicalProject();
    if (!canonical) throw gadgetAccessError(APP_ACCESS_DENIED_CODE, APP_ACCESS_DENIED);
    // История узла не называет узел: Mnemos нашёл его ровно по этому опознавателю.
    return { access: "read", principal, tenant, name: await name(), project: canonical, node };
  }
  throw gadgetAccessError(APP_ACCESS_DENIED_CODE, APP_ACCESS_DENIED);
}

/** Справочник для приложения: отделы и люди из них, только имена (как в «Поделиться»). */
export async function appDirectory(session: Pick<AppAccessSession, "listOrgUnits">) {
  const units = await session.listOrgUnits();
  const departments = units.map(u => ({ id: u.org_unit_id, name: u.name, members: u.members.map(m => ({ id: m.principal_id, name: m.display_name })) }));
  const people = new Map<string, { id: string; name: string }>();
  for (const unit of departments) for (const member of unit.members) if (!people.has(member.id)) people.set(member.id, member);
  return { people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name, "ru")), departments };
}
