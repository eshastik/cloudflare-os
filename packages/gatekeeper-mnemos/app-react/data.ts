import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentAbsence, AgentConnectionPage, CollaborationProgress, CollaborationRequest, DraftState, NodePage, PublicationReview, WhoAmI } from "../src/mnemos-api.ts";
import type { ManagedTaskRequest } from "../src/account-session.ts";
import type { Ui } from "./host.ts";
import type { ProjectVisibility } from "../src/project-sharing.ts";
import { readinessFailed, readinessReady } from "./readiness.ts";

export type ProjectNode = NodePage["nodes"][number];
export type AgentConnection = AgentConnectionPage["connections"][number];
export type { ManagedTaskRequest, AgentAbsence, CollaborationRequest, CollaborationProgress };

export interface ProjectData {
  id: string;
  name: string;
  /** Краткое имя: по нему узнаётся личное пространство (lichnoe-…). */
  slug?: string;
  /** Кому виден проект; пусто — сервер без видимости проектов. */
  visibility?: ProjectVisibility;
  /** Видящие проект могут его править. */
  canEdit?: boolean;
  createdBy?: string;
  /** Отдел проекта; пусто — проект вне отделов. */
  orgUnit?: string;
  /** Уровень, который ждёт решения руководителя или администратора. */
  pendingShare?: ProjectVisibility;
  /** Первая страница общей версии проекта. */
  nodes: ProjectNode[];
  truncated: boolean;
  nodesError: boolean;
  /** Документы личной версии: только здесь видно конфликт и документы, которых в общей версии ещё нет. */
  privateDocs: Map<string, { name: string; conflicted: boolean; contentType?: string }>;
  draftState: DraftState | null;
  /** Файлы, черновики и состояние проекта уже прочитаны; до этого пустой список файлов ничего не значит. */
  detailsLoaded?: boolean;
}

export interface CollaborationItem {
  request: CollaborationRequest;
  /** null — состояние сервер не отдал (отказ или ошибка). */
  progress: CollaborationProgress | null;
}

export interface MemoryData {
  identity: WhoAmI | null;
  projects: ProjectData[];
  /** true, пока не прочитаны файлы всех проектов; сам список проектов может прийти раньше. */
  projectsLoading: boolean;
  projectsError: string;
  /** Этот проект прочитать раньше остальных: его сейчас открыл человек. */
  prioritizeProject(project: string): void;
  reloadProjects(): Promise<void>;
  reviews: PublicationReview[];
  reviewsCursor: string;
  reviewsLoading: boolean;
  reviewsError: string;
  reloadReviews(): Promise<void>;
  loadMoreReviews(): Promise<void>;
  /** Загруженные страницы подключений агентов текущего человека. */
  connections: AgentConnection[];
  connectionsError: string;
  connectionsCursor: string;
  connectionsLoading: boolean;
  loadMoreConnections(): Promise<void>;
  reloadConnections(): Promise<void>;
  /** Текущая сохранённая задача управляемому агенту, если есть. */
  task: ManagedTaskRequest | null;
  taskError: string;
  reloadTask(): Promise<void>;
  collaborations: CollaborationItem[];
  collaborationsError: string;
  reloadCollaborations(): Promise<void>;
  /** Замещение по проектам; проект без записи — сервер отказал или не ответил. */
  absences: Map<string, AgentAbsence>;
}

/**
 * Личное пространство человека — его проект с кратким именем lichnoe-<id> или lichnoe-<id>-<хвост>,
 * созданный им самим (то же правило, что isPersonalSpace в src/chat-documents.ts). Имя угадывается,
 * поэтому решает создатель: чужой проект с таким именем пространством не считается.
 */
export function isPersonalSpace(project: Pick<ProjectData, "slug" | "createdBy">, userId: string | undefined): boolean {
  if (!userId || !project.slug || project.createdBy !== userId) return false;
  const base = "lichnoe-" + userId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32);
  return project.slug === base || (project.slug.startsWith(base) && /^-[a-z0-9]{6}$/.test(project.slug.slice(base.length)));
}

export interface DocumentRow {
  privateOnly?: boolean;
  /** Тип содержимого известен только для личных черновиков; у общих документов его даёт чтение. */
  contentType?: string;
  projectId: string;
  projectName: string;
  nodeId: string;
  name: string;
  /** Папка внутри проекта, если её узлы загружены вместе со списком. */
  folder?: string;
  status: { tone: "neutral" | "success" | "warning" | "danger"; label: string };
  /** Файл принят, но не разобран: по содержимому его не найти. Причина — словами сервера. */
  parseFailure?: string;
}

/** Документы проекта: общая версия плюс то, что есть только в личной. Каталоги не показываются. */
export function documentRows(project: ProjectData, reviews: PublicationReview[]): DocumentRow[] {
  const rows: DocumentRow[] = [];
  const seen = new Set<string>();
  const byId = new Map(project.nodes.map(node => [node.node_id, node]));
  const folderOf = (parent: string | undefined) => {
    const names: string[] = [];
    // Предел глубины защищает от петли в неполной странице узлов.
    for (let id = parent, depth = 0; id && depth < 32; depth++) {
      const dir = byId.get(id);
      if (!dir) break;
      names.unshift(dir.name);
      id = dir.parent_id;
    }
    return names.join("/");
  };
  for (const node of project.nodes) {
    if (node.is_dir) continue;
    seen.add(node.node_id);
    const folder = folderOf(node.parent_id);
    rows.push({ projectId: project.id, projectName: project.name, nodeId: node.node_id, name: node.name || UNNAMED_DOCUMENT, ...(folder ? { folder } : {}), ...(node.parse_failure ? { parseFailure: node.parse_failure } : {}), status: documentStatus(project, node.node_id, false, reviews) });
  }
  for (const [nodeId, doc] of project.privateDocs) {
    if (seen.has(nodeId)) continue;
    rows.push({ projectId: project.id, projectName: project.name, nodeId, privateOnly: true, contentType: doc.contentType, name: doc.name || UNNAMED_DOCUMENT, status: documentStatus(project, nodeId, true, reviews) });
  }
  return rows;
}

function documentStatus(project: ProjectData, nodeId: string, privateOnly: boolean, reviews: PublicationReview[]): DocumentRow["status"] {
  for (const review of reviews) {
    if (review.project_id !== project.id || review.stale) continue;
    const domain = review.domains.find(d => d.node_ids.includes(nodeId));
    if (!domain) continue;
    if (domain.decisions.some(d => !d.approved)) return { tone: "danger", label: `Отклонено · ${domain.domain_id}` };
    return { tone: "warning", label: `На согласовании · ${domain.decisions.filter(d => d.approved).length} из ${domain.approvers.length}` };
  }
  const draft = project.privateDocs.get(nodeId);
  if (draft?.conflicted) return { tone: "danger", label: "Конфликт" };
  if (privateOnly) return { tone: "neutral", label: "Черновик" };
  return { tone: "success", label: "Опубликовано" };
}

export interface PendingApproval {
  review: PublicationReview;
  domain: PublicationReview["domains"][number];
  /** Решение текущего человека, если уже записано. */
  mine: boolean | null;
}

/** Направления, где текущий человек назначен согласующим. */
export function myApprovals(reviews: PublicationReview[], userId: string): PendingApproval[] {
  const items: PendingApproval[] = [];
  for (const review of reviews) {
    for (const domain of review.domains) {
      if (!domain.approvers.includes(userId)) continue;
      const decision = domain.decisions.find(d => d.approver_id === userId);
      items.push({ review, domain, mine: decision ? decision.approved : null });
    }
  }
  return items;
}

export function pendingCount(reviews: PublicationReview[], userId: string): number {
  return myApprovals(reviews, userId).filter(item => item.mine === null && !item.review.stale && !item.review.withdrawn).length;
}

/** Имена документов по «проект/узел» из общей и личной версий. */
export function documentNames(projects: ProjectData[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const project of projects) {
    for (const node of project.nodes) names.set(`${project.id}/${node.node_id}`, node.name);
    for (const [nodeId, doc] of project.privateDocs) names.set(`${project.id}/${nodeId}`, doc.name);
  }
  return names;
}

/** Подпись документа, у которого нет имени: идентификатор узла человеку ничего не говорит. */
export const UNNAMED_DOCUMENT = "Документ без названия";

export function publicationNodeName(review: PublicationReview, names: Map<string, string>, node: string): string {
  const name = review.node_names?.[node] || names.get(`${review.project_id}/${node}`);
  if (review.application_node_ids?.includes(node)) return name ? `Приложение «${name}»` : "Приложение";
  return name || UNNAMED_DOCUMENT;
}

/** Имя проекта; идентификатор недоступного проекта не показывается. */
export function projectName(projects: ProjectData[], id: string): string {
  const found = projects.find(p => p.id === id);
  if (found) return found.name;
  return id ? "проект, недоступный вам" : "проект не указан";
}

import { looksLikeId, personName, agentKind, agentNames, agentName, actorName } from "./names.ts";
export { looksLikeId, personName, agentKind, agentNames, agentName, actorName };

export function isAdministrator(identity: WhoAmI | null): boolean {
  return !!identity?.capabilities?.includes("principal.manage");
}

export function agentEnvironment(connection: AgentConnection): string {
  if (connection.managed_runtime === true) return "AgenticOS";
  if (connection.managed_runtime === false) return "внешний клиент";
  return "среда не указана";
}

/** Столько страниц дерева проекта читаем при загрузке раздела: по 1000 узлов, дальше счёт помечается «+». */
export const PROJECT_PAGES = 10;
/**
 * Все узлы проекта по курсору, до PROJECT_PAGES страниц. Сервер не отдаёт общего числа узлов, поэтому
 * иначе счётчик «Файлы» показывал бы размер первой страницы. truncated — прочитано не всё.
 */
export async function browseWholeProject(ui: { browseProject(project: string, cursor: string): Promise<{ nodes: ProjectData["nodes"]; next_cursor?: string; truncated: boolean }> }, project: string, pages = PROJECT_PAGES): Promise<{ nodes: ProjectData["nodes"]; truncated: boolean }> {
  const nodes: ProjectData["nodes"] = [];
  let cursor = "";
  for (let page = 0; page < pages; page++) {
    const result = await ui.browseProject(project, cursor);
    nodes.push(...result.nodes);
    const next = result.next_cursor || "";
    // Усечение без курсора (обрыв по сроку) или повтор курсора: дальше не прочитать, счёт неполон.
    if (!next || next === cursor) return { nodes, truncated: result.truncated || next === cursor && !!next };
    cursor = next;
  }
  return { nodes, truncated: true };
}

/** Обход с ограничением параллельности; first() называет элемент, который взять следующим вне очереди. */
async function forEachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, first: (rest: T[]) => number = () => 0): Promise<void> {
  const rest = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (rest.length) {
      const index = Math.max(0, first(rest));
      await fn(rest.splice(index, 1)[0]);
    }
  });
  await Promise.all(workers);
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
}

const AUDIENCE: Record<string, string> = { private: "виден только автору", department: "виден отделу", organization: "виден всей организации" };

/** Подпись проекта словами: кому виден и сколько файлов. Два проекта с одним именем так различаются. */
export function projectSummary(project: ProjectData): string {
  const files = project.nodes.filter(n => !n.is_dir).length;
  const parts = [project.visibility ? AUDIENCE[project.visibility] : ""];
  if (project.detailsLoaded !== false) parts.push(files ? `${files}${project.truncated ? "+" : ""} ${pluralRu(files, "файл", "файла", "файлов")}` : "файлов пока нет");
  const line = parts.filter(Boolean).join(", ");
  return line ? line[0].toUpperCase() + line.slice(1) : "";
}

/** Загрузка одного значения с честной ошибкой; перезапускается при смене зависимостей. */
export function useLoad<T>(load: () => Promise<T>, failure: string, deps: unknown[]): { value: T | null; error: string; loading: boolean; reload(): Promise<void> } {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const out = await load();
      if (alive.current) setValue(out);
    } catch {
      if (alive.current) { setValue(null); setError(failure); }
    } finally {
      if (alive.current) setLoading(false);
    }
    // Зависимости задаёт вызывающий: сам колбэк создаётся заново на каждую отрисовку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void run(); }, [run]);
  return { value, error, loading, reload: run };
}

export function useMemoryData(ui: Ui): MemoryData {
  const [identity, setIdentity] = useState<WhoAmI | null>(null);
  const [projectEpoch, setProjectEpoch] = useState(0);
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState("");
  const [reviews, setReviews] = useState<PublicationReview[]>([]);
  const [reviewsCursor, setReviewsCursor] = useState("");
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsError, setReviewsError] = useState("");
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [connectionsCursor, setConnectionsCursor] = useState("");
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const connectionPages = useRef(1);
  const [connectionsError, setConnectionsError] = useState("");
  const [task, setTask] = useState<ManagedTaskRequest | null>(null);
  const [taskError, setTaskError] = useState("");
  const [collaborations, setCollaborations] = useState<CollaborationItem[]>([]);
  const [collaborationsError, setCollaborationsError] = useState("");
  const [absences, setAbsences] = useState<Map<string, AgentAbsence>>(new Map());
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  // Проект, открытый человеком, читается первым: иначе его файлы ждали бы очереди из десятков проектов.
  const priority = useRef("");
  const prioritizeProject = useCallback((project: string) => { priority.current = project; }, []);

  const loadReviews = useCallback(async (cursor: string) => {
    setReviewsLoading(true); setReviewsError("");
    try {
      const page = await ui.listPublicationReviews(cursor);
      if (!alive.current) return;
      setReviews(prev => cursor ? [...prev, ...page.reviews] : page.reviews);
      setReviewsCursor(page.next_cursor ?? "");
    } catch {
      if (alive.current) setReviewsError("Не удалось загрузить согласования. Обновите страницу и повторите.");
    } finally {
      if (alive.current) setReviewsLoading(false);
    }
  }, [ui]);

  const loadConnections = useCallback(async (cursor = "") => {
    setConnectionsError(""); setConnectionsLoading(true);
    try {
      let next=cursor; const result: AgentConnection[]=[];
      for(let pageNo=0;pageNo<(cursor ? 1 : connectionPages.current);pageNo++){
        const page=await ui.listAgentConnections(next);result.push(...page.connections);
        if(page.next_cursor && page.next_cursor===next) throw new Error("Повтор курсора подключений");
        next=page.next_cursor || "";if(!next)break;
      }
      if(alive.current){
        setConnections(old=>cursor?[...old,...result.filter(c=>!old.some(o=>o.binding_id===c.binding_id))]:result);
        setConnectionsCursor(next);if(cursor)connectionPages.current++;
      }
    } catch {
      if (alive.current) setConnectionsError("Не удалось загрузить подключения агентов. Проверьте сессию и обновите страницу.");
    } finally { if(alive.current)setConnectionsLoading(false); }
  }, [ui]);

  const loadTask = useCallback(async () => {
    setTaskError("");
    try {
      const current = await ui.managedTaskRequest();
      if (alive.current) setTask(current);
    } catch {
      if (alive.current) { setTask(null); setTaskError("Текущая задача агента не прочитана."); }
    }
  }, [ui]);

  const loadCollaborations = useCallback(async () => {
    setCollaborationsError("");
    try {
      const page = await ui.listCollaborations("");
      const items = await Promise.all(page.requests.map(async request => ({ request, progress: await ui.readCollaborationProgress(request.request_id).catch(() => null) })));
      if (alive.current) setCollaborations(items);
    } catch {
      if (alive.current) { setCollaborations([]); setCollaborationsError("Обращения недоступны. Проверьте текущие права."); }
    }
  }, [ui]);

  useEffect(() => {
    void loadReviews("");
    void loadConnections();
    void loadTask();
    void loadCollaborations();
    (async () => {
      try {
        const [person, page] = await Promise.all([ui.whoAmI(), ui.listProjects()]);
        if (!alive.current) return;
        setIdentity(person);
        const initial: ProjectData[] = page.projects.map(p => ({ id: p.id, name: p.name || "Проект без названия", slug: p.slug, visibility: p.visibility, canEdit: p.can_edit, createdBy: p.created_by, orgUnit: p.org_unit_id || undefined, pendingShare: p.pending_share, nodes: [], truncated: false, nodesError: false, privateDocs: new Map(), draftState: null, detailsLoaded: false }));
        setProjects(initial);
        readinessReady();
        await forEachLimited(initial, 4, async project => {
          const [nodes, privateDocs, draft, absence] = await Promise.allSettled([browseWholeProject(ui, project.id), ui.listPrivateDocuments(project.id, ""), ui.draftState(project.id), ui.readAgentAbsence(project.id)]);
          if (!alive.current) return;
          const patch: Partial<ProjectData> = {};
          if (nodes.status === "fulfilled") { patch.nodes = nodes.value.nodes; patch.truncated = nodes.value.truncated; }
          else patch.nodesError = true;
          if (privateDocs.status === "fulfilled") patch.privateDocs = new Map(privateDocs.value.documents.map(d => [d.node_id, { name: d.name, conflicted: d.conflicted, contentType: d.content_type }]));
          if (draft.status === "fulfilled") patch.draftState = draft.value;
          patch.detailsLoaded = true;
          if (absence.status === "fulfilled") setAbsences(prev => new Map(prev).set(project.id, absence.value));
          setProjects(prev => prev.map(p => p.id === project.id ? { ...p, ...patch } : p));
        }, rest => rest.findIndex(p => p.id === priority.current));
      } catch {
        readinessFailed();
        if (alive.current) setProjectsError("Не удалось загрузить проекты. Проверьте сессию и обновите страницу.");
      } finally {
        if (alive.current) setProjectsLoading(false);
      }
    })();
  }, [ui, loadReviews, loadConnections, loadTask, loadCollaborations, projectEpoch]);

  return {
    identity, projects, projectsLoading, projectsError, prioritizeProject, reloadProjects: async () => { setProjectEpoch(n => n + 1); },
    reviews, reviewsCursor, reviewsLoading, reviewsError,
    reloadReviews: () => loadReviews(""),
    loadMoreReviews: () => loadReviews(reviewsCursor),
    connections, connectionsError, connectionsCursor, connectionsLoading, reloadConnections: () => loadConnections(), loadMoreConnections: () => loadConnections(connectionsCursor),
    task, taskError, reloadTask: loadTask,
    collaborations, collaborationsError, reloadCollaborations: loadCollaborations,
    absences,
  };
}
