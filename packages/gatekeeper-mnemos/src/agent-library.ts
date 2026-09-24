import { DurableObject, RpcTarget, type RpcStub } from "cloudflare:workers";
import {
  boundAgentCatalog,
  type AgentCatalog, type AgentCatalogRequest, type ApprovalQueue, type Gatekeeper,
  type GatekeeperUserVerifier, type ObservationAuthorizer, type ResourceDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import {
  MnemosAPIError, type DocumentContent, type DraftDocument, type DraftDownloadTicket, type DraftHead, type DraftState,
  type PrivateDocumentPage, type PrivateDocumentCreate, type NodeHistoryPage, type NodePage, type ProjectPage, type ProjectSearchPage, type UploadTicket,
  type PublicationPolicy, type PublicationResult, type PublicationReview,
} from "./mnemos-api.ts";
import { changeTrackerTask, decodeTrackerPreview, type Task } from "./tracker-artifact.ts";
import { documentResourceUrl } from "./document-resource.ts";
import { MNEMOS_LIBRARY_TYPES } from "./agent-library-types.ts";
import { checkedAdminOperation, type AdminOperationRequest, type AdminOperation } from "./admin-operations.ts";
import type { MnemosVerifierApi } from "./mnemos.ts";

interface Env { MNEMOS_API_ORIGIN: string }
export interface MnemosLibraryProps { userObjectId: string }

/** Часть человеческой сессии управления, которой пользуется библиотека; токен в ней не виден. */
export interface LibraryReader {
  listProjects(): Promise<ProjectPage>;
  browseProject(projectId: string, cursor: string): Promise<NodePage>;
  searchProject(projectId: string, query: string): Promise<ProjectSearchPage>;
  readProjectDocument(projectId: string, nodeId: string): Promise<DocumentContent>;
  nodeHistory(projectId: string, nodeId: string, cursor: string): Promise<NodeHistoryPage>;
  /** Методы ниже — те же, что у экрана управления; старые сессии их не знают, поэтому вызов защищён. */
  searchAll?(query: string, limit: number): Promise<ProjectSearchPage>;
  readProjectDocumentWindow?(projectId: string, nodeId: string, ordinal: number, radius: number, maxBytes: number): Promise<DocumentContent>;
  readPublicationPolicy?(projectId: string): Promise<PublicationPolicy>;
  readPublicationReview?(id: string): Promise<PublicationReview>;
  checkTrackerAssignee?(project: string, node: string, head: string, principal: string): Promise<void>;
  [Symbol.dispose](): void;
}
/** Те же методы сессии, которыми человек пишет личный черновик из приложения Mnemos. */
export interface DraftWriter extends LibraryReader {
  draftState(projectId: string): Promise<DraftState>;
  openDraft(projectId: string): Promise<DraftHead>;
  readDraftDocument(projectId: string, nodeId: string): Promise<DraftDocument>;
  saveDraftDocument(projectId: string, nodeId: string, uploadId: string, expectedHead: string): Promise<DraftHead>;
}
interface TransferIssuer<Args extends unknown[], Ticket> { issue(...args: Args): Promise<Ticket>; [Symbol.dispose](): void }
/** Что отдаёт UserAccount.startAppUi(): сессия и выдачи подписанных ссылок на хранилище. */
export interface LibraryApp {
  ui: DraftWriter;
  textUploads?: { storageOrigin: string; issuer: TransferIssuer<[string, number, string], UploadTicket> };
  textDownloads?: { storageOrigin: string; issuer: TransferIssuer<[string, string, string, number], DraftDownloadTicket> };
}
/** Запись черновика под агентским credential (S15): только то, что нужно applyAction. */
export interface AgentDraftWriter {
  createPrivateDocument(project: string, request: PrivateDocumentCreate): Promise<{node_id: string; head: string}>;
  draftState(projectId: string): Promise<DraftState>;
  openDraft(projectId: string): Promise<DraftHead>;
  saveDraftDocument(projectId: string, nodeId: string, uploadId: string, expectedHead: string): Promise<DraftHead>;
  /** Запись в общую память от имени агента; старые подключения этих методов не имеют. */
  requestPublicationReview?(projectId: string, personalHead: string, sharedHead: string): Promise<{ candidate_id: string }>;
  publishDraft?(projectId: string, expectedHead: string, sharedHead: string, message: string): Promise<PublicationResult>;
  [Symbol.dispose](): void;
}
/** Что отдаёт UserAccount.startWorkshopAgent(): имя связи, сессия и выдача загрузок под агентским credential. */
export interface LibraryAgent {
  personal?: { list(project: string, cursor: string): Promise<PrivateDocumentPage>; read(project: string, node: string): Promise<DraftDocument>; [Symbol.dispose](): void };
  textDownloads?: LibraryApp["textDownloads"];
  connectionName: string;
  bindingId?: string;
  admin?: { prepare(operation: string, request: AdminOperationRequest): Promise<AdminOperation>; execute(operation: string, request: AdminOperationRequest): Promise<AdminOperation>; [Symbol.dispose](): void };
  ui: AgentDraftWriter;
  textUploads?: { storageOrigin: string; issuer: TransferIssuer<[string, number, string], UploadTicket> };
}
/** Аккаунт владельца в объёме, нужном библиотеке. */
export interface LibraryAccount {
  decideWorkshopAdmin(binding: string, operation: string, phase: "approve" | "reject", request: AdminOperationRequest): Promise<AdminOperation>;
  openManagementSession(): Promise<LibraryReader>;
  startAppUi(): Promise<LibraryApp>;
  workshopAgent(): Promise<{ connectionName: string }>;
  startWorkshopAgent(): Promise<LibraryAgent>;
  connectionIdentity(): Promise<{ subject: { tenant_id: string }; connectionName: string }>;
}

export interface MnemosProject { id: string; name: string; slug: string }
export interface MnemosSearchResult {
  hits: { document: string; name: string; text: string; ordinal: number }[];
  indexPending: boolean; degraded: boolean;
}
export interface MnemosDocument { document: string; name: string; text: string; mediaType: string; truncated: boolean }
/** Окно чтения: фрагмент ordinal и radius соседних фрагментов с каждой стороны. */
export interface MnemosReadWindow { ordinal: number; radius: number; maxBytes?: number }
export interface MnemosSearchAllResult {
  hits: { project: string; projectName: string; document: string; name: string; text: string; ordinal: number }[];
  indexPending: boolean; degraded: boolean;
}
export interface MnemosFolderEntry { id: string; name: string; path: string; kind: "folder" | "document" }
export interface MnemosFolderListing { project: string; folder: string; entries: MnemosFolderEntry[]; truncated: boolean }
export interface MnemosPublication { status: "published" | "awaiting_approval" | "nothing_to_publish" | "conflict"; message: string }
export interface MnemosTracker { document: string; head: string; revision: number; title: string; stages: { id: string; name: string; department: string }[]; tasks: Task[] }
export interface MnemosTrackerChange { document: string; head: string; revision: number; task: string }
export interface MnemosDraftProposal { action: number; document: string; name: string; status: "saved"; head: string }
/** Подтверждение выполняется отдельной карточкой в разговоре. */
export interface MnemosAdminProposal { action: number; summary: string; status: AdminOperation["state"]; result?: Record<string, string> }
interface StoredAdminProposal { binding: string; operation: string; request: AdminOperationRequest; summary: string; state: AdminOperation["state"]; ownerRestricted?: true; submitted?: boolean; result?: Record<string, string> }

type Node = NodePage["nodes"][number];
interface Located { id: string; name: string }
/** Одна публикация; наблюдатель обязан иметь право читать её сам. */
interface Publication { projectId: string; nodeId: string; eventId: string }
interface Installation { tenantId: string; apiOrigin: string }
/** Исходная версия предложения: личная голова, либо опубликованная, если личной ветки ещё нет. */
interface BaseVersion { head: string; personal: boolean }
interface DraftProposal {
  state: "pending" | "applied" | "rejected" | "stale";
  project: string; node: string; name: string; base: BaseVersion;
  /** Текст хранится только до завершения записи. */
  content?: string;
  create?: { parent: string; mediaType: "text/plain" | "text/markdown"; requestId: string };
  resultHead?: string;
  submittedAt: number;
}

const NODE_PAGES_LIMIT = 8;
const CONTENT_LIMIT = 262144;
const TEXT_TYPES = new Set(["text/plain", "text/markdown"]);
const TRACKER_TYPES = new Set(["application/vnd.mnemos.task-tracker+json"]);
/** Сколько строк папки отдаётся за один обзор. */
const FOLDER_ENTRIES_LIMIT = 500;
const UNSUPPORTED = "Эта версия подключения Mnemos не умеет выполнять действие; обновите приложение Mnemos.";
const REVOKED = "Аккаунт Mnemos отключён или срок входа истёк; войдите заново в приложении Mnemos.";
const AGENT_REVOKED = "Агентская связь Workshop с Mnemos отозвана или аккаунт отключён; переподключите аккаунт в приложении Mnemos.";
const UNAVAILABLE = "Документ недоступен: его нет, к нему нет доступа, либо это не текстовый документ.";
const STALE = "Версия устарела: документ изменён во время записи. Прочитайте документ заново и повторите сохранение.";
const NOT_FOUND = "Действие не найдено: у Mnemos нет такого ожидающего действия.";
const PUBLISH_REFUSED = "Mnemos не разрешил агенту публикацию в этом проекте (нет права записи у агента или человека). Черновик сохранён; опубликовать его может человек в приложении Mnemos.";
const TRACKER_STALE = "Трекер изменился после чтения. Прочитайте его заново и повторите изменение.";
/** Причины отказа проверки трекера (tracker-artifact.ts) по-русски; неизвестная — общая фраза. */
const TRACKER_REASONS: Record<string, string> = {
  "Task creation/update intent mismatch": "задача с таким id уже есть (create=true) или её нет (create=false)",
  "Invalid principal or task": "некорректный id задачи или ответственного",
  "Invalid task text": "пустое название или слишком длинный текст",
  "Invalid handoff": "переход между этапами не разрешён или нет ответственного и следующего шага",
  "Missing assignee/next step": "для «в работе» нужны ответственный и следующий шаг",
  "Missing blocker/next step": "для «заблокировано» нужны причина и следующий шаг",
  "Missing result": "для «готово» и «отменено» нужен результат",
  "Stale blocker": "причина блокировки осталась у незаблокированной задачи",
  "Unfinished dependency": "не завершены задачи, от которых зависит эта",
  "Cyclic dependencies": "зависимости образуют цикл",
  "Duplicate dependency": "зависимость указана дважды",
  "Invalid task references": "зависимость ссылается на несуществующую задачу",
  "Invalid task stage/status": "неизвестный этап или статус",
  "Tracker exceeds editor limit": "трекер превысит 256 КиБ",
};

function identifier(value: unknown, what: string, max = 255): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Некорректное значение: ${what}.`);
  return value;
}
function bytes(value: string): number { return new TextEncoder().encode(value).length; }
function clip(value: string, max: number): string { return value.length > max ? value.slice(0, max) + "…" : value; }
function byTitle(left: { title: string; id: string }, right: { title: string; id: string }): number {
  return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}
/** Ошибки Mnemos переписываются без деталей запроса; credential в них и так нет. */
function failure(error: unknown): Error {
  if (!(error instanceof MnemosAPIError)) return error instanceof Error ? error : new Error(String(error));
  if (error.status === 401) return new Error(REVOKED);
  if (error.status === 403 || error.status === 404) return new Error("Нет доступа к проекту или документу Mnemos, либо он не существует.");
  return new Error(`Mnemos недоступен (код ${error.status}).`);
}
/** Ошибка отозванного аккаунта; для остальных ошибок — null (они гасятся без подробностей). */
function revocation(error: unknown): Error | null {
  return error instanceof MnemosAPIError && error.status === 401 ? new Error(REVOKED) : null;
}

async function sha256(data: Uint8Array): Promise<{ hex: string; base64: string }> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data)));
  return { hex: Array.from(digest, b => b.toString(16).padStart(2, "0")).join(""), base64: btoa(String.fromCharCode(...digest)) };
}
/** Подписанная ссылка обязана вести в хранилище установки, иначе тело уйдёт не туда. */
function storageTarget(origin: string, url: string): URL {
  const base = new URL(origin), target = new URL(url);
  if (base.protocol !== "https:" || base.origin !== origin || target.origin !== origin || target.username || target.password || target.hash) {
    throw new Error("Подписанная ссылка хранилища Mnemos ведёт не в хранилище установки.");
  }
  return target;
}
/** Освобождает стабы RPC внутри ответа startAppUi(): у ответа целиком либо у каждого стаба. */
function release(value: unknown, depth = 0): void {
  if (!value || typeof value !== "object") return;
  const disposer = (value as Partial<Disposable>)[Symbol.dispose];
  if (typeof disposer === "function") { try { disposer.call(value); } catch { /* стаб уже освобождён */ } return; }
  if (depth >= 2) return;
  for (const nested of Object.values(value)) release(nested, depth + 1);
}

interface SessionCalls {
  listPersonalDocuments(queue: RpcStub<ApprovalQueue>, project: string, cursor: string): Promise<PrivateDocumentPage>;
  readPersonalDocument(queue: RpcStub<ApprovalQueue>, project: string, node: string): Promise<MnemosDocument>;
  proposeAdmin(queue: RpcStub<ApprovalQueue>, requestId: string, request: AdminOperationRequest): Promise<MnemosAdminProposal>;
  createDraft(queue: RpcStub<ApprovalQueue>, project: string, parent: string, name: string, content: string, mediaType: "text/plain" | "text/markdown"): Promise<MnemosDraftProposal>;
  listProjects(queue: RpcStub<ApprovalQueue>): Promise<MnemosProject[]>;
  searchProject(queue: RpcStub<ApprovalQueue>, project: string, query: string): Promise<MnemosSearchResult>;
  readDocument(queue: RpcStub<ApprovalQueue>, project: string, document: string, window?: MnemosReadWindow): Promise<MnemosDocument>;
  saveDraft(queue: RpcStub<ApprovalQueue>, project: string, document: string, content: string): Promise<MnemosDraftProposal>;
  search(queue: RpcStub<ApprovalQueue>, query: string, limit: number): Promise<MnemosSearchAllResult>;
  browseProject(queue: RpcStub<ApprovalQueue>, project: string, folder: string): Promise<MnemosFolderListing>;
  publishDraft(queue: RpcStub<ApprovalQueue>, project: string, message: string): Promise<MnemosPublication>;
  readTracker(queue: RpcStub<ApprovalQueue>, project: string, document: string): Promise<MnemosTracker>;
  changeTrackerTask(queue: RpcStub<ApprovalQueue>, project: string, document: string, expectedHead: string, task: Task, create: boolean): Promise<MnemosTrackerChange>;
}

/** Сессия агента: чтение — наблюдение, запись личного черновика — сразу по выданным правам. */
export class MnemosLibrarySession extends RpcTarget {
  #calls: SessionCalls;
  #queue: RpcStub<ApprovalQueue>;
  constructor(calls: SessionCalls, queue: RpcStub<ApprovalQueue>) { super(); this.#calls = calls; this.#queue = queue; }
  async listPersonalDocuments(project: string, cursor = "") { return this.#calls.listPersonalDocuments(this.#queue, project, cursor); }
  async readPersonalDocument(project: string, node: string) { return this.#calls.readPersonalDocument(this.#queue, project, node); }
  async listProjects(): Promise<MnemosProject[]> { return this.#calls.listProjects(this.#queue); }
  async proposeConnectProject(requestId: string, project: string) { return this.#calls.proposeAdmin(this.#queue, requestId, {kind: "connect_project", project}); }
  async proposeCreateProject(requestId: string, name: string, slug: string) { return this.#calls.proposeAdmin(this.#queue, requestId, {kind: "create_project", name, slug}); }
  async proposeProjectAccess(requestId: string, person: string, project: string, domain: string, mode: "read" | "write") { return this.#calls.proposeAdmin(this.#queue, requestId, {kind: "grant_project_access", person, project, domain, mode}); }
  async searchProject(project: string, query: string): Promise<MnemosSearchResult> { return this.#calls.searchProject(this.#queue, project, query); }
  async readDocument(project: string, document: string, window?: MnemosReadWindow): Promise<MnemosDocument> { return this.#calls.readDocument(this.#queue, project, document, window); }
  async search(query: string, limit = 20): Promise<MnemosSearchAllResult> { return this.#calls.search(this.#queue, query, limit); }
  async browseProject(project: string, folder = ""): Promise<MnemosFolderListing> { return this.#calls.browseProject(this.#queue, project, folder); }
  async publishDraft(project: string, message = ""): Promise<MnemosPublication> { return this.#calls.publishDraft(this.#queue, project, message); }
  async readTracker(project: string, document: string): Promise<MnemosTracker> { return this.#calls.readTracker(this.#queue, project, document); }
  async changeTrackerTask(project: string, document: string, expectedHead: string, task: Task, create = false): Promise<MnemosTrackerChange> { return this.#calls.changeTrackerTask(this.#queue, project, document, expectedHead, task, create); }
  async createDraft(project: string, parent: string, name: string, content: string, mediaType: "text/plain" | "text/markdown" = "text/markdown") { return this.#calls.createDraft(this.#queue, project, parent, name, content, mediaType); }
  async saveDraft(project: string, document: string, content: string): Promise<MnemosDraftProposal> { return this.#calls.saveDraft(this.#queue, project, document, content); }
  [Symbol.dispose](): void { this.#queue[Symbol.dispose](); }
}

/** Агентский синглтон аккаунта Mnemos (ADR 0024 §1): каталог, чтение публикаций, запись личного черновика по выданным правам. */
export class MnemosLibrary extends DurableObject<Env, MnemosLibraryProps> implements Gatekeeper<MnemosLibrarySession> {
  #account(): LibraryAccount {
    const accounts = this.ctx.exports.UserAccount;
    // Стаб DO отдаёт те же методы, что человеческий iframe; интерфейс сужает их до нужных.
    return accounts.get(accounts.idFromString(this.ctx.props.userObjectId)) as unknown as LibraryAccount;
  }

  async describe(): Promise<ResourceDescription> {
    return {
      url: "mnemos://library",
      title: "Mnemos",
      snippet: "Материалы команды и личные черновики; создание проекта и доступ сотрудника через подтверждение в разговоре.",
      suggestedBindingName: "MNEMOS",
      tsType: "MnemosLibrary",
    };
  }
  async getTypeScriptTypes(): Promise<string> { return MNEMOS_LIBRARY_TYPES; }
  async getAutoApprovableActions() { return []; }

  async startSession(approvalQueue: RpcStub<ApprovalQueue>): Promise<MnemosLibrarySession> {
    // Аргументы RPC освобождаются по возврату; сессия живёт дольше и держит свою копию.
    const queue = approvalQueue.dup();
    try {
      return new MnemosLibrarySession({
        listPersonalDocuments: (q, project, cursor) => this.#listPersonalDocuments(q, project, cursor),
        readPersonalDocument: (q, project, node) => this.#readPersonalDocument(q, project, node),
        proposeAdmin: (q, id, request) => this.#proposeAdmin(q, id, request),
        listProjects: q => this.#listProjects(q),
        searchProject: (q, project, query) => this.#searchProject(q, project, query),
        readDocument: (q, project, document, window) => this.#readDocument(q, project, document, window),
        search: (q, query, limit) => this.#search(q, query, limit),
        browseProject: (q, project, folder) => this.#browse(q, project, folder),
        publishDraft: (q, project, message) => this.#publish(q, project, message),
        readTracker: (q, project, document) => this.#readTracker(q, project, document),
        changeTrackerTask: (q, project, document, expectedHead, task, create) => this.#changeTracker(q, project, document, expectedHead, task, create),
        createDraft: (q, project, parent, name, content, mediaType) => this.#createDraft(q, project, parent, name, content, mediaType),
        saveDraft: (q, project, document, content) => this.#saveDraft(q, project, document, content),
      }, queue);
    } catch (error) { queue[Symbol.dispose](); throw error; }
  }

  async getAgentCatalog(request: AgentCatalogRequest, authorizer: RpcStub<ObservationAuthorizer>): Promise<AgentCatalog | null> {
    let reader: LibraryReader;
    // Отозванный или истёкший аккаунт: каталога нет, а не ошибка при старте гаджета.
    try { reader = await this.#account().openManagementSession(); } catch { return null; }
    try {
      const page = await this.#data(() => reader.listProjects());
      const entries = page.projects
        .map(project => ({ id: project.id, title: project.name, description: `Проект Mnemos, код «${project.slug}».` }))
        .toSorted(byTitle);
      const catalog = boundAgentCatalog(entries, request);
      if (catalog.entries.length > 0) {
        await authorizer.authorizeObservation({
          title: "Каталог Mnemos",
          description: `Перечислено проектов: ${catalog.entries.length}.`,
          excludeObservers: await this.#excludedObservers(),
        });
      }
      return catalog;
    } finally { reader[Symbol.dispose](); }
  }

  async addObserver(id: string, user: Fetcher<GatekeeperUserVerifier>): Promise<void> {
    const verifier = user as Fetcher<MnemosVerifierApi>;
    if (!await this.#sameTenant(verifier)) throw new Error("Наблюдатель из другой организации не может видеть работу с Mnemos.");
    const observers = this.#observers(); observers.set(id, verifier); this.ctx.storage.kv.put("observers", observers);
  }
  async removeObserver(id: string): Promise<void> {
    const observers = this.#observers(); observers.delete(id); this.ctx.storage.kv.put("observers", observers);
  }

  // ---- запись черновика; applyAction также завершает старые уже выданные предложения ----

  async applyAction(action: number): Promise<void> {
    if (this.ctx.storage.kv.get<StoredAdminProposal>(`admin:${action}`)) { await this.#applyAdmin(action); return; }
    const proposal = this.#proposal(action);
    if (proposal.state === "applied") throw new Error("Действие уже выполнено: черновик записан ранее.");
    if (proposal.state === "rejected") throw new Error("Действие отклонено ранее; запись не выполняется.");
    if (proposal.state === "stale") throw new Error(STALE);
    // Запись идёт под агентским credential (S15): актор — агент, on_behalf_of — владелец.
    const app = await this.#agent();
    try {
      const { ui } = app;
      if (!app.textUploads) throw new Error("Хранилище Mnemos не настроено; загрузка текста недоступна.");
      const state = await this.#data(() => ui.draftState(proposal.project));
      const current = state.personal_exists ? { head: state.personal_head, personal: true } : { head: state.shared_head, personal: false };
      if (current.personal !== proposal.base.personal || current.head !== proposal.base.head) {
        this.#settle(action, proposal, "stale");
        throw new Error(STALE);
      }
      let expected = proposal.base.head;
      if (!proposal.base.personal) {
        expected = (await this.#data(() => ui.openDraft(proposal.project))).head;
        if (expected !== proposal.base.head) { this.#settle(action, proposal, "stale"); throw new Error(STALE); }
        // Личная ветка уже открыта: повтор после сбоя загрузки сверяется с её головой, а не с опубликованной.
        proposal.base = { head: expected, personal: true };
        this.ctx.storage.kv.put(this.#key(action), proposal);
      }
      const upload = await this.#putText(app.textUploads, proposal.project, proposal.content ?? "");
      let saved: DraftHead | undefined;
      try {
        if (proposal.create) {
          const result = await ui.createPrivateDocument(proposal.project, {request_id: proposal.create.requestId, expected_head: expected, parent_id: proposal.create.parent, name: proposal.name, content_type: proposal.create.mediaType, upload_id: upload, message: "Новый личный документ агента"});
          proposal.node = result.node_id; saved = result;
        } else saved = await ui.saveDraftDocument(proposal.project, proposal.node, upload, expected);
      }
      catch (error) {
        // 409 — голова ушла между сверкой и записью: предложение устарело, остальное — обычная ошибка API.
        if (!(error instanceof MnemosAPIError && error.status === 409)) throw failure(error);
      }
      if (!saved) { this.#settle(action, proposal, "stale"); throw new Error(STALE); }
      this.#settle(action, proposal, "applied", saved.head);
    } finally { release(app); }
  }
  async rejectAction(action: number): Promise<void> {
    const admin = this.ctx.storage.kv.get<StoredAdminProposal>(`admin:${action}`);
    if (admin) {
      if (!admin.ownerRestricted) throw new Error("Предложение создано старой версией интерфейса. Подготовьте новое действие.");
      const result = await this.#account().decideWorkshopAdmin(admin.binding, admin.operation, "reject", admin.request);
      this.ctx.storage.kv.put(`admin:${action}`, {...admin, state: result.state}); return;
    }
    const proposal = this.#proposal(action);
    if (proposal.state === "applied") throw new Error("Действие уже выполнено; отклонить его нельзя, откатите черновик в приложении Mnemos.");
    this.#settle(action, proposal, "rejected");
  }
  async revertAction(action: number): Promise<{ message: string }> {
    if (this.ctx.storage.kv.get<StoredAdminProposal>(`admin:${action}`)) return {message: "Для отмены административного изменения нужно отдельное подтверждённое действие."};
    const proposal = this.#proposal(action);
    return { message: `Откат делается в приложении Mnemos: восстановите в документе «${proposal.name}» прежнюю версию из истории личного черновика.` };
  }

  #key(action: number): string { return `draft:${action}`; }
  /** Кладёт текст в хранилище по подписанной ссылке агента; возвращает upload_id для записи черновика. */
  async #putText(uploads: NonNullable<LibraryAgent["textUploads"]>, project: string, text: string): Promise<string> {
    const content = new TextEncoder().encode(text);
    const sum = await sha256(content);
    const { storageOrigin, issuer } = uploads;
    const ticket = await this.#data(() => issuer.issue(project, content.length, sum.base64));
    if (ticket.method !== "PUT" || ticket.content_length !== content.length || ticket.checksum_value !== sum.base64) throw new Error("Выдача загрузки Mnemos не совпала с текстом предложения.");
    const response = await fetch(storageTarget(storageOrigin, ticket.url), { method: "PUT", redirect: "manual", signal: AbortSignal.timeout(20000), headers: { [ticket.checksum_header]: sum.base64 }, body: content });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Хранилище Mnemos не приняло текст (код ${response.status}).`);
    return ticket.upload_id;
  }
  async #proposeAdmin(queue: RpcStub<ApprovalQueue>, requestId: string, input: AdminOperationRequest): Promise<MnemosAdminProposal> {
    identifier(requestId, "ключ операции", 128);
    const request = checkedAdminOperation(input);
    await queue.authorizeObservation({title: "Подготовка действия Mnemos", description: "Проверка предложения перед подтверждением человеком.", excludeObservers: await this.#excludedObservers()});
    const agent = await this.#agent();
    try {
      if (!agent.admin || !agent.bindingId) throw new Error("Административные действия агента ещё не подключены.");
      const index = `admin-request:${agent.bindingId}:${requestId}`;
      const previous = this.ctx.storage.kv.get<number>(index);
      if (previous) {
        const saved = this.ctx.storage.kv.get<StoredAdminProposal>(`admin:${previous}`)!;
        if (JSON.stringify(saved.request) !== JSON.stringify(request)) throw new Error("Ключ уже использован для другого действия.");
      }
      const prepared = await agent.admin.prepare(requestId, request);
      const action = this.ctx.storage.kv.get<number>(index) ?? this.#nextAction();
      const saved = this.ctx.storage.kv.get<StoredAdminProposal>(`admin:${action}`);
      if (saved && !saved.ownerRestricted) throw new Error("Предложение создано старой версией интерфейса. Подготовьте новое действие.");
      const proposal: StoredAdminProposal = {binding: agent.bindingId, operation: requestId, request, summary: prepared.summary, state: prepared.state, ownerRestricted: true, ...(saved?.submitted ? {submitted: true} : {}), ...(prepared.result ? {result: prepared.result} : {})};
      this.ctx.storage.kv.put(`admin:${action}`, proposal);
      this.ctx.storage.kv.put(index, action);
      if (prepared.state === "pending" && !proposal.submitted) {
        await queue.submitAction(action, {title: request.kind === "create_project" ? "Создать проект" : request.kind === "connect_project" ? "Подключить проект к агенту Mnemos" : "Изменить доступ сотрудника", description: prepared.summary, implementsRevert: false, awaitDecision: true, ownerApprovalRequired: true});
        this.ctx.storage.kv.put(`admin:${action}`, {...this.ctx.storage.kv.get<StoredAdminProposal>(`admin:${action}`)!, submitted: true});
      }
      return {action, summary: prepared.summary, status: prepared.state, ...(prepared.result ? {result: prepared.result} : {})};
    } finally { release(agent); }
  }
  async #applyAdmin(action: number): Promise<void> {
    const proposal = this.ctx.storage.kv.get<StoredAdminProposal>(`admin:${action}`)!;
    if (!proposal.ownerRestricted) throw new Error("Предложение создано старой версией интерфейса. Подготовьте новое действие.");
    if (proposal.state === "rejected") throw new Error("Действие отклонено.");
    // Этот путь доступен очереди подтверждений, но отсутствует в MnemosLibrarySession.
    await this.#account().decideWorkshopAdmin(proposal.binding, proposal.operation, "approve", proposal.request);
    const agent = await this.#agent();
    try {
      if (!agent.admin || agent.bindingId !== proposal.binding) throw new Error(AGENT_REVOKED);
      const result = await agent.admin.execute(proposal.operation, proposal.request);
      if (result.state !== "applied") throw new Error("Mnemos не подтвердил исполнение действия.");
      this.ctx.storage.kv.put(`admin:${action}`, {...proposal, state: result.state, result: result.result});
    } finally { release(agent); }
  }
  #proposal(action: number): DraftProposal {
    if (!Number.isSafeInteger(action) || action <= 0) throw new Error(NOT_FOUND);
    const proposal = this.ctx.storage.kv.get<DraftProposal>(this.#key(action));
    if (!proposal) throw new Error(NOT_FOUND);
    return proposal;
  }
  #settle(action: number, proposal: DraftProposal, state: DraftProposal["state"], resultHead?: string): void {
    // Текст нужен только до завершения записи: после него запись хранит исход, чтобы повтор отвечал отказом.
    const { content: _content, ...rest } = proposal;
    this.ctx.storage.kv.put(this.#key(action), { ...rest, state, ...(resultHead ? { resultHead } : {}) });
  }
  #nextAction(): number {
    const value = (this.ctx.storage.kv.get<number>("counter:draft") ?? 0) + 1;
    this.ctx.storage.kv.put("counter:draft", value);
    return value;
  }

  async #createDraft(queue: RpcStub<ApprovalQueue>, project: string, parent: string, name: string, content: string, mediaType: "text/plain" | "text/markdown"): Promise<MnemosDraftProposal> {
    identifier(project, "проект");
    if (typeof parent !== "string") throw new Error("Некорректная папка.");
    if (parent) identifier(parent, "папка");
    if (typeof name !== "string" || !name.trim() || name !== name.trim() || /[/\\\0]/.test(name) || bytes(name)>255 || typeof content !== "string" || content.includes("\0") || !TEXT_TYPES.has(mediaType) || bytes(content)>CONTENT_LIMIT) throw new Error("Некорректное имя, формат или текст нового документа (до 256 КиБ).");
    const app = await this.#app();
    try {
      await queue.authorizeObservation({title:"Новый документ Mnemos",description:`Проверка проекта и папки для «${name}».`,excludeObservers:await this.#excludedObservers()});
      const projectInfo = (await this.#data(()=>app.ui.listProjects())).projects.find(p=>p.id===project);
      if (!projectInfo) throw new Error(UNAVAILABLE);
      const nodes = await this.#nodes(app.ui, project);
      if (parent && !nodes.some(n=>n.node_id===parent && n.is_dir)) throw new Error(UNAVAILABLE);
      if (nodes.some(n=>(n.parent_id||"")===parent && n.name===name)) throw new Error("Документ с таким именем уже существует. Используйте saveDraft для изменения.");
      // Opening is idempotent and initializes a new project under the agent's rights.
      // Pin the returned head, not a later read that could include a competing edit.
      const writer=await this.#agent();
      let base: BaseVersion;
      try { base={head:(await writer.ui.openDraft(project)).head,personal:true}; }
      finally { release(writer); }
      const action=this.#nextAction();
      const proposal:DraftProposal={state:"pending",project,node:"",name,base,content,submittedAt:Date.now(),create:{parent,mediaType,requestId:crypto.randomUUID()}};
      this.ctx.storage.kv.put(this.#key(action),proposal);
      await this.applyAction(action);
      const saved=this.#proposal(action);
      return {action,document:saved.node,name,status:"saved",head:saved.resultHead!};
    } finally {release(app);}
  }

  async #saveDraft(queue: RpcStub<ApprovalQueue>, project: string, document: string, content: string): Promise<MnemosDraftProposal> {
    identifier(project, "проект"); identifier(document, "документ", 4096);
    if (typeof content !== "string" || content.includes("\0")) throw new Error("Некорректное значение: содержимое.");
    if (bytes(content) > CONTENT_LIMIT) throw new Error("Текст превышает 256 КиБ.");
    const app = await this.#app();
    try {
      const { ui } = app;
      await queue.authorizeObservation({title:"Черновик Mnemos",description:`Запись личного черновика в проекте ${project}.`,excludeObservers:await this.#excludedObservers()});
      const state = await this.#data(() => ui.draftState(project));
      const base: BaseVersion = state.personal_exists ? { head: state.personal_head, personal: true } : { head: state.shared_head, personal: false };
      const located = await this.#lookup(ui, project, document);
      if (!located) throw new Error(UNAVAILABLE);
      const before = await this.#currentText(app, project, located.id, base);
      if (before === null) throw new Error(UNAVAILABLE);
      await this.#agentName();
      const action = this.#nextAction();
      const proposal: DraftProposal = { state: "pending", project, node: located.id, name: located.name, base, content, submittedAt: Date.now() };
      this.ctx.storage.kv.put(this.#key(action), proposal);
      await this.applyAction(action);
      const saved=this.#proposal(action);
      return {action,document:saved.node,name:located.name,status:"saved",head:saved.resultHead!};
    } finally { release(app); }
  }

  /** Текущий текст документа в исходной версии; null — документа нет, он не текстовый или недоступен. */
  async #currentText(app: LibraryApp, project: string, node: string, base: BaseVersion): Promise<string | null> {
    try {
      if (!base.personal) {
        const published = await app.ui.readProjectDocument(project, node);
        return TEXT_TYPES.has(published.media_type) && !published.truncated ? published.text : null;
      }
      const draft = await app.ui.readDraftDocument(project, node);
      if (!draft.exists || draft.conflicted || !TEXT_TYPES.has(draft.content_type ?? "") || draft.head !== base.head || !app.textDownloads) return null;
      const { storageOrigin, issuer } = app.textDownloads;
      const ticket = await issuer.issue(project, node, draft.head, 0);
      if (ticket.node_id !== node || ticket.method !== "GET" || ticket.size_bytes > CONTENT_LIMIT) return null;
      const response = await fetch(storageTarget(storageOrigin, ticket.url), { redirect: "manual", signal: AbortSignal.timeout(20000) });
      if (!response.ok) { await response.body?.cancel(); return null; }
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.length !== ticket.size_bytes || (await sha256(body)).hex !== ticket.sha256_hex) return null;
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body);
    } catch (error) {
      const fatal = revocation(error);
      if (fatal) throw fatal;
      return null;
    }
  }

  // ---- данные через аккаунт владельца ----

  async #open(): Promise<LibraryReader> {
    // session() аккаунта бросает только при отсутствии или смене credential.
    try { return await this.#account().openManagementSession(); } catch { throw new Error(REVOKED); }
  }
  async #app(): Promise<LibraryApp> {
    try { return await this.#account().startAppUi(); } catch { throw new Error(REVOKED); }
  }
  // Отозванная связь и отключённый аккаунт неразличимы снаружи: аккаунт бросает на оба случая одинаково.
  async #agent(): Promise<LibraryAgent> {
    try { return await this.#account().startWorkshopAgent(); } catch { throw new Error(AGENT_REVOKED); }
  }
  async #agentName(): Promise<string> {
    try { return (await this.#account().workshopAgent()).connectionName; } catch { throw new Error(AGENT_REVOKED); }
  }
  async #data<T>(read: () => Promise<T>): Promise<T> {
    try { return await read(); } catch (error) { throw failure(error); }
  }

  async #authorizePersonal(queue: RpcStub<ApprovalQueue>): Promise<void> {
    await queue.authorizeObservation({ownerOnly: true, title: "Личные материалы Mnemos", description: "Чтение личных материалов владельца в пределах прав агента."});
  }
  async #listPersonalDocuments(queue: RpcStub<ApprovalQueue>, project: string, cursor: string): Promise<PrivateDocumentPage> {
    identifier(project, "проект");
    if (typeof cursor !== "string" || cursor.length > 2048) throw new Error("Некорректный курсор.");
    await this.#authorizePersonal(queue);
    const agent = await this.#agent();
    try {
      if (!agent.personal) throw new Error(UNAVAILABLE);
      return await this.#data(() => agent.personal!.list(project, cursor));
    } finally { release(agent); }
  }
  async #readPersonalDocument(queue: RpcStub<ApprovalQueue>, project: string, node: string): Promise<MnemosDocument> {
    identifier(project, "проект"); identifier(node, "документ");
    await this.#authorizePersonal(queue);
    const agent = await this.#agent();
    try {
      const {draft, text} = await this.#personalText(agent, project, node, TEXT_TYPES, "Личный документ недоступен как текст или содержит конфликт.");
      return {document: node, name: draft.terms[0]?.metadata?.name ?? node, text, mediaType: draft.content_type!, truncated: false};
    } finally { release(agent); }
  }
  /** Текст личной версии под агентским credential; версия сверяется до и после скачивания. */
  async #personalText(agent: LibraryAgent, project: string, node: string, types: Set<string>, refusal: string): Promise<{ draft: DraftDocument; text: string }> {
    if (!agent.personal || !agent.textDownloads) throw new Error(UNAVAILABLE);
    const draft = await this.#data(() => agent.personal!.read(project, node));
    if (!draft.exists || draft.conflicted || !types.has(draft.content_type ?? "")) throw new Error(refusal);
    const {issuer, storageOrigin} = agent.textDownloads;
    const ticket = await this.#data(() => issuer.issue(project, node, draft.head, 0));
    if (ticket.node_id !== node || ticket.head !== draft.head || ticket.term_index !== 0 || ticket.method !== "GET" || ticket.size_bytes < 0 || ticket.size_bytes > CONTENT_LIMIT) throw new Error(UNAVAILABLE);
    const response = await fetch(storageTarget(storageOrigin, ticket.url), {redirect: "manual", signal: AbortSignal.timeout(20000)});
    if (!response.ok) { await response.body?.cancel(); throw new Error(UNAVAILABLE); }
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.length !== ticket.size_bytes || (await sha256(body)).hex !== ticket.sha256_hex) throw new Error(UNAVAILABLE);
    const latest = await this.#data(() => agent.personal!.read(project, node));
    if (!latest.exists || latest.head !== draft.head) throw new Error("Личная версия изменилась. Повторите чтение.");
    return {draft, text: new TextDecoder("utf-8", {fatal: true, ignoreBOM: false}).decode(body)};
  }

  async #listProjects(queue: RpcStub<ApprovalQueue>): Promise<MnemosProject[]> {
    using reader = await this.#open();
    await queue.authorizeObservation({
      title: "Список проектов Mnemos",
      description: "Перечень проектов, доступных владельцу аккаунта.",
      excludeObservers: await this.#excludedObservers(),
    });
    const page = await this.#data(() => reader.listProjects());
    return page.projects.map(project => ({ id: project.id, name: project.name, slug: project.slug }));
  }

  async #searchProject(queue: RpcStub<ApprovalQueue>, project: string, query: string): Promise<MnemosSearchResult> {
    identifier(project, "проект"); identifier(query, "запрос", 4096);
    using reader = await this.#open();
    await queue.authorizeObservation({
      title: "Поиск в Mnemos",
      description: `Проект «${project}», запрос: «${clip(query, 200)}».`,
      excludeObservers: await this.#excludedObservers(),
    });
    const page = await this.#data(() => reader.searchProject(project, query));
    await this.#recordWorkContext(queue, reader, project);
    return {
      hits: page.hits.map(hit => ({ document: hit.node_id, name: hit.name, text: hit.text, ordinal: hit.ordinal })),
      indexPending: page.index_pending, degraded: page.degraded,
    };
  }

  async #readDocument(queue: RpcStub<ApprovalQueue>, project: string, document: string, window?: MnemosReadWindow): Promise<MnemosDocument> {
    identifier(project, "проект"); identifier(document, "документ", 4096);
    if (window !== undefined && (!window || typeof window !== "object" || !Number.isSafeInteger(window.ordinal) || window.ordinal < 0 ||
        !Number.isSafeInteger(window.radius) || window.radius < 1 || window.radius > 50 ||
        (window.maxBytes !== undefined && (!Number.isSafeInteger(window.maxBytes) || window.maxBytes < 1 || window.maxBytes > CONTENT_LIMIT)))) {
      throw new Error("Некорректное окно чтения: ordinal ≥ 0, radius от 1 до 50, maxBytes до 262144.");
    }
    using reader = await this.#open();
    // Поиск узла не бросает: наблюдение записывается и при неудаче, а один текст ошибки после
    // него не выдаёт, существует ли имя в проекте (TD-177).
    const located = await this.#lookup(reader, project, document);
    let publication: Publication | undefined;
    if (located) {
      const history = await this.#quiet(() => reader.nodeHistory(project, located.id, ""));
      const eventId = history?.events.find(event => event.exists !== false)?.event_id;
      publication = eventId ? { projectId: project, nodeId: located.id, eventId } : undefined;
    }
    await queue.authorizeObservation({
      title: "Чтение документа Mnemos",
      description: located
        ? `Проект «${project}», документ «${located.name}» (${located.id})${publication ? `, публикация ${publication.eventId}` : ""}.`
        : `Проект «${project}», запрошен документ «${clip(document, 200)}»; он не найден или недоступен.`,
      excludeObservers: await this.#excludedObservers(publication),
    });
    if (!located || !publication) throw new Error(UNAVAILABLE);
    const content = await this.#quiet(() => {
      if (!window) return reader.readProjectDocument(project, located.id);
      if (!reader.readProjectDocumentWindow) throw new Error(UNSUPPORTED);
      return reader.readProjectDocumentWindow(project, located.id, window.ordinal, window.radius, window.maxBytes ?? CONTENT_LIMIT);
    });
    if (!content) throw new Error(UNAVAILABLE);
    await this.#recordWorkContext(queue, reader, project, located.name !== located.id ? located.name : undefined, publication);
    return { document: content.node_id, name: located.name, text: content.text, mediaType: content.media_type, truncated: content.truncated };
  }

  /** Поиск по всем проектам, которые видит человек. */
  async #search(queue: RpcStub<ApprovalQueue>, query: string, limit: number): Promise<MnemosSearchAllResult> {
    identifier(query, "запрос", 4096);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("Некорректное значение: limit — целое от 1 до 50.");
    using reader = await this.#open();
    if (!reader.searchAll) throw new Error(UNSUPPORTED);
    await queue.authorizeObservation({
      title: "Поиск в Mnemos",
      description: `Все доступные проекты, запрос: «${clip(query, 200)}».`,
      excludeObservers: await this.#excludedObservers(),
    });
    const page = await this.#data(() => reader.searchAll!(query, limit));
    const projects = await this.#quiet(() => reader.listProjects());
    const names = new Map((projects?.projects ?? []).map(project => [project.id, project.name]));
    return {
      hits: page.hits.map(hit => ({ project: hit.project_id, projectName: names.get(hit.project_id) ?? "", document: hit.node_id, name: hit.name, text: hit.text, ordinal: hit.ordinal })),
      indexPending: page.index_pending, degraded: page.degraded,
    };
  }

  /** Обзор одной папки проекта: вложенные папки и документы с путями. */
  async #browse(queue: RpcStub<ApprovalQueue>, project: string, folder: string): Promise<MnemosFolderListing> {
    identifier(project, "проект");
    if (typeof folder !== "string" || folder.length > 4096) throw new Error("Некорректное значение: папка.");
    using reader = await this.#open();
    await queue.authorizeObservation({
      title: "Папки проекта Mnemos",
      description: `Проект «${project}», папка «${clip(folder, 200) || "корень"}».`,
      excludeObservers: await this.#excludedObservers(),
    });
    const listing = await this.#data(() => this.#nodePages(reader, project));
    const nodes = listing.nodes.filter(node => !node.shared_deleted);
    const byId = new Map(nodes.map(node => [node.node_id, node]));
    const path = (node: Node): string => {
      const parts = [node.name];
      let parent = node.parent_id ? byId.get(node.parent_id) : undefined;
      // Глубина ограничена: повреждённое дерево не должно зациклить обзор.
      for (let depth = 0; parent && depth < 64; depth++) { parts.unshift(parent.name); parent = parent.parent_id ? byId.get(parent.parent_id) : undefined; }
      return parts.join("/");
    };
    let parent = "";
    if (folder) {
      const segments = folder.split("/").filter(Boolean);
      let found: Node | undefined;
      let under: string | undefined;
      for (const segment of segments) {
        found = nodes.find(node => node.is_dir && node.name === segment && (node.parent_id || undefined) === under);
        if (!found) break;
        under = found.node_id;
      }
      if (!found && segments.length === 1) found = nodes.find(node => node.is_dir && node.node_id === folder);
      if (!found) throw new Error("Папка не найдена или недоступна. Посмотрите корень проекта: browseProject(project).");
      parent = found.node_id;
    }
    const children = nodes.filter(node => (node.parent_id || "") === parent)
      .toSorted((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name));
    await this.#recordWorkContext(queue, reader, project);
    return {
      project, folder: parent ? path(byId.get(parent)!) : "",
      entries: children.slice(0, FOLDER_ENTRIES_LIMIT).map(node => ({ id: node.node_id, name: node.name, path: path(node), kind: node.is_dir ? "folder" : "document" })),
      truncated: children.length > FOLDER_ENTRIES_LIMIT || !listing.complete,
    };
  }

  /** Публикация личного черновика проекта: без политики согласования — сразу,
   * с политикой — запрос ответственным; решение ответственных агент не обходит. */
  async #publish(queue: RpcStub<ApprovalQueue>, project: string, message: string): Promise<MnemosPublication> {
    identifier(project, "проект");
    if (typeof message !== "string" || message.includes("\0") || bytes(message) > 1024) throw new Error("Некорректное значение: сообщение публикации (до 1 КиБ).");
    using reader = await this.#open();
    if (!reader.readPublicationPolicy || !reader.readPublicationReview) throw new Error(UNSUPPORTED);
    await queue.authorizeObservation({
      title: "Публикация Mnemos",
      description: `Публикация личного черновика в проекте «${project}».`,
      excludeObservers: await this.#excludedObservers(),
    });
    // Запись — под агентским credential: в журнале действие агента от имени человека (ADR 0010).
    const agent = await this.#agent();
    try {
      const writer = agent.ui;
      if (!writer.requestPublicationReview || !writer.publishDraft) throw new Error(UNSUPPORTED);
      const written = async <T>(write: () => Promise<T>): Promise<T> => {
        try { return await write(); }
        catch (error) {
          if (error instanceof MnemosAPIError && error.status === 403) throw new Error(PUBLISH_REFUSED);
          throw failure(error);
        }
      };
      const state = await this.#data(() => writer.draftState(project));
      if (!state.personal_exists) return { status: "nothing_to_publish", message: "В проекте нет личного черновика: публиковать нечего." };
      let policy: PublicationPolicy | null = null;
      try { policy = await reader.readPublicationPolicy(project); }
      catch (error) { if (!(error instanceof MnemosAPIError && error.status === 404)) throw failure(error); }
      if (policy && policy.domains.length > 0) {
        const { candidate_id } = await written(() => writer.requestPublicationReview!(project, state.personal_head, state.shared_head));
        const review = await this.#quiet(() => reader.readPublicationReview!(candidate_id));
        // Изменения не задели ни одного направления политики — согласовывать нечего, публикуем сразу.
        if (!review || review.stale || !review.ready) {
          await this.#recordWorkContext(queue, reader, project);
          return { status: "awaiting_approval", message: "В проекте включено согласование: изменения отправлены ответственным. После их решения публикацию подтвердит человек во «Входящих»." };
        }
      }
      const result = await written(() => writer.publishDraft!(project, state.personal_head, state.shared_head, message.trim() || "Публикация из беседы"));
      await this.#recordWorkContext(queue, reader, project);
      if (result.conflicted) return { status: "conflict", message: "Изменения конфликтуют с опубликованной версией. Конфликт сохранён в черновике; его решает человек в приложении Mnemos." };
      if (!result.published) return { status: "nothing_to_publish", message: "Черновик не отличается от опубликованной версии: публиковать нечего." };
      return { status: "published", message: "Изменения опубликованы: их видят все, у кого есть доступ к проекту." };
    } finally { release(agent); }
  }

  async #readTracker(queue: RpcStub<ApprovalQueue>, project: string, document: string): Promise<MnemosTracker> {
    identifier(project, "проект"); identifier(document, "трекер");
    await this.#authorizePersonal(queue);
    const agent = await this.#agent();
    try {
      const { draft, text } = await this.#personalText(agent, project, document, TRACKER_TYPES, "Трекер недоступен: документа нет, это не трекер или в нём конфликт.");
      let tracker: ReturnType<typeof decodeTrackerPreview>;
      try { tracker = decodeTrackerPreview(text); } catch { throw new Error("Трекер повреждён или записан неизвестной версией формата."); }
      return { document, head: draft.head, ...tracker };
    } finally { release(agent); }
  }

  /** Изменение одной задачи трекера в личном черновике: проверка переходов — та же, что у экрана трекера. */
  async #changeTracker(queue: RpcStub<ApprovalQueue>, project: string, document: string, expectedHead: string, task: Task, create: boolean): Promise<MnemosTrackerChange> {
    identifier(project, "проект"); identifier(document, "трекер");
    if (typeof expectedHead !== "string" || !/^[a-f0-9]{64}$/.test(expectedHead)) throw new Error("Некорректное значение: expectedHead — head из readTracker().");
    if (typeof create !== "boolean" || !task || typeof task !== "object") throw new Error("Некорректная задача трекера.");
    await this.#authorizePersonal(queue);
    const agent = await this.#agent();
    try {
      if (!agent.textUploads) throw new Error("Хранилище Mnemos не настроено; загрузка текста недоступна.");
      const { draft, text } = await this.#personalText(agent, project, document, TRACKER_TYPES, "Трекер недоступен: документа нет, это не трекер или в нём конфликт.");
      if (draft.head !== expectedHead) throw new Error(TRACKER_STALE);
      let content: string;
      try { content = changeTrackerTask(text, structuredClone(task), create); }
      catch (error) {
        const reason = TRACKER_REASONS[error instanceof Error ? error.message : ""];
        throw new Error(`Изменение трекера не прошло проверку${reason ? `: ${reason}` : ""}.`);
      }
      if (task.assignee_id) {
        using reader = await this.#open();
        if (!reader.checkTrackerAssignee) throw new Error(UNSUPPORTED);
        try { await reader.checkTrackerAssignee(project, document, draft.head, task.assignee_id); }
        catch (error) { const fatal = revocation(error); if (fatal) throw fatal; throw new Error("Ответственный недоступен для этого трекера: у него нет доступа к проекту."); }
      }
      const upload = await this.#putText(agent.textUploads, project, content);
      let saved: DraftHead;
      try { saved = await agent.ui.saveDraftDocument(project, document, upload, draft.head); }
      catch (error) {
        if (error instanceof MnemosAPIError && error.status === 409) throw new Error(TRACKER_STALE);
        throw failure(error);
      }
      return { document, head: saved.head, revision: decodeTrackerPreview(content).revision, task: task.id };
    } finally { release(agent); }
  }

  /** Контекст фиксируется после успешного чтения; недоступное имя не подменяется ID. */
  async #recordWorkContext(queue: RpcStub<ApprovalQueue>, reader: LibraryReader, project: string, resourceName?: string, publication?: Publication): Promise<void> {
    const projects = await this.#quiet(() => reader.listProjects());
    const projectName = projects?.projects.find(item => item.id === project)?.name;
    if (!projectName) return;
    await queue.authorizeObservation({
      title: "Материалы Mnemos",
      description: resourceName ? `Проект «${projectName}», документ «${resourceName}».` : `Поиск выполнен в проекте «${projectName}».`,
      workContext: {projectName, ...(resourceName ? {resourceName} : {})},
      excludeObservers: await this.#excludedObservers(publication),
    });
  }

  /** Чтение, отвечающее null на любую неудачу, кроме отозванного аккаунта. */
  async #quiet<T>(read: () => Promise<T>): Promise<T | null> {
    try { return await read(); } catch (error) { const fatal = revocation(error); if (fatal) throw fatal; return null; }
  }
  /** Документ ищется как путь по имени; одиночное значение, не найденное по имени, считается идентификатором. */
  async #lookup(reader: LibraryReader, project: string, document: string): Promise<Located | null> {
    const segments = document.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    const nodes = await this.#quiet(() => this.#nodes(reader, project));
    if (!nodes) return null;
    let parent: string | undefined;
    let found: Node | undefined;
    for (const segment of segments) {
      found = nodes.find(node => !node.shared_deleted && node.name === segment && (node.parent_id || undefined) === parent);
      if (!found) break;
      parent = found.node_id;
    }
    if (found && !found.is_dir) return { id: found.node_id, name: found.name };
    if (found?.is_dir || segments.length > 1) return null;
    const byId = nodes.find(node => node.node_id === document);
    if (byId?.is_dir) return null;
    return { id: document, name: byId?.name ?? document };
  }
  async #nodes(reader: LibraryReader, project: string): Promise<Node[]> {
    return (await this.#nodePages(reader, project)).nodes;
  }
  /** complete=false — дерево длиннее NODE_PAGES_LIMIT страниц, часть узлов не прочитана. */
  async #nodePages(reader: LibraryReader, project: string): Promise<{ nodes: Node[]; complete: boolean }> {
    const nodes: Node[] = [];
    let cursor = "";
    for (let page = 0; page < NODE_PAGES_LIMIT; page++) {
      const listing = await reader.browseProject(project, cursor);
      nodes.push(...listing.nodes);
      if (!listing.next_cursor) return { nodes, complete: true };
      cursor = listing.next_cursor;
    }
    return { nodes, complete: false };
  }

  // ---- наблюдатели ----

  #observers() { return this.ctx.storage.kv.get<Map<string, Fetcher<MnemosVerifierApi>>>("observers") ?? new Map(); }
  async #installation(): Promise<Installation> {
    const cached = this.ctx.storage.kv.get<Installation>("installation");
    if (cached) return cached;
    const identity = await this.#account().connectionIdentity();
    // connectionName несёт адрес установки только для аккаунтов вне основной (organizationAccountName в login-profiles.ts).
    const parts = JSON.parse(identity.connectionName) as string[];
    const installation = { tenantId: identity.subject.tenant_id, apiOrigin: parts.length === 3 ? parts[0] : this.env.MNEMOS_API_ORIGIN };
    this.ctx.storage.kv.put("installation", installation);
    return installation;
  }
  async #sameTenant(verifier: Fetcher<MnemosVerifierApi>): Promise<boolean> {
    const { tenantId } = await this.#installation();
    try { return await verifier.sameTenant(tenantId); } catch { return false; }
  }
  async #canRead(verifier: Fetcher<MnemosVerifierApi>, publication: Publication): Promise<boolean> {
    const { tenantId, apiOrigin } = await this.#installation();
    const resourceUrl = documentResourceUrl(apiOrigin, { projectId: publication.projectId, nodeId: publication.nodeId });
    try { return await verifier.canReadPublication(resourceUrl, publication.eventId, tenantId); } catch { return false; }
  }
  /** Исключаются наблюдатели чужой организации; при чтении публикации — ещё и те, кому она не видна. */
  async #excludedObservers(publication?: Publication): Promise<string[]> {
    const excluded: string[] = [];
    for (const [id, verifier] of this.#observers()) {
      if (!await this.#sameTenant(verifier) || (publication && !await this.#canRead(verifier, publication))) excluded.push(id);
    }
    return excluded;
  }
}
