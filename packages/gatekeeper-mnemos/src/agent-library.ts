import { DurableObject, RpcTarget, type RpcStub } from "cloudflare:workers";
import {
  boundAgentCatalog,
  type AgentCatalog, type AgentCatalogRequest, type ApprovalQueue, type Gatekeeper,
  type GatekeeperUserVerifier, type ObservationAuthorizer, type ResourceDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import {
  MnemosAPIError, type DocumentContent, type DraftDocument, type DraftDownloadTicket, type DraftHead, type DraftState,
  type PrivateDocumentCreate, type NodeHistoryPage, type NodePage, type ProjectPage, type ProjectSearchPage, type UploadTicket,
} from "./mnemos-api.ts";
import { documentResourceUrl } from "./document-resource.ts";
import { MNEMOS_LIBRARY_TYPES } from "./agent-library-types.ts";
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
  [Symbol.dispose](): void;
}
/** Что отдаёт UserAccount.startWorkshopAgent(): имя связи, сессия и выдача загрузок под агентским credential. */
export interface LibraryAgent {
  connectionName: string;
  ui: AgentDraftWriter;
  textUploads?: { storageOrigin: string; issuer: TransferIssuer<[string, number, string], UploadTicket> };
}
/** Аккаунт владельца в объёме, нужном библиотеке. */
export interface LibraryAccount {
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
export interface MnemosDraftProposal { action: number; document: string; name: string; status: "saved"; head: string }

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
const REVOKED = "Аккаунт Mnemos отключён или срок входа истёк; войдите заново в приложении Mnemos.";
const AGENT_REVOKED = "Агентская связь Workshop с Mnemos отозвана или аккаунт отключён; переподключите аккаунт в приложении Mnemos.";
const UNAVAILABLE = "Документ недоступен: его нет, к нему нет доступа, либо это не текстовый документ.";
const STALE = "Версия устарела: документ изменён во время записи. Прочитайте документ заново и повторите сохранение.";
const NOT_FOUND = "Действие не найдено: у Mnemos нет такого ожидающего действия.";

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
  createDraft(queue: RpcStub<ApprovalQueue>, project: string, parent: string, name: string, content: string, mediaType: "text/plain" | "text/markdown"): Promise<MnemosDraftProposal>;
  listProjects(queue: RpcStub<ApprovalQueue>): Promise<MnemosProject[]>;
  searchProject(queue: RpcStub<ApprovalQueue>, project: string, query: string): Promise<MnemosSearchResult>;
  readDocument(queue: RpcStub<ApprovalQueue>, project: string, document: string): Promise<MnemosDocument>;
  saveDraft(queue: RpcStub<ApprovalQueue>, project: string, document: string, content: string): Promise<MnemosDraftProposal>;
}

/** Сессия агента: чтение — наблюдение, запись личного черновика — сразу по выданным правам. */
export class MnemosLibrarySession extends RpcTarget {
  #calls: SessionCalls;
  #queue: RpcStub<ApprovalQueue>;
  constructor(calls: SessionCalls, queue: RpcStub<ApprovalQueue>) { super(); this.#calls = calls; this.#queue = queue; }
  async listProjects(): Promise<MnemosProject[]> { return this.#calls.listProjects(this.#queue); }
  async searchProject(project: string, query: string): Promise<MnemosSearchResult> { return this.#calls.searchProject(this.#queue, project, query); }
  async readDocument(project: string, document: string): Promise<MnemosDocument> { return this.#calls.readDocument(this.#queue, project, document); }
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
      snippet: "Поиск и чтение опубликованных документов команды; личные черновики записываются сразу.",
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
        listProjects: q => this.#listProjects(q),
        searchProject: (q, project, query) => this.#searchProject(q, project, query),
        readDocument: (q, project, document) => this.#readDocument(q, project, document),
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
      const content = new TextEncoder().encode(proposal.content ?? "");
      const sum = await sha256(content);
      const { storageOrigin, issuer } = app.textUploads;
      const ticket = await this.#data(() => issuer.issue(proposal.project, content.length, sum.base64));
      if (ticket.method !== "PUT" || ticket.content_length !== content.length || ticket.checksum_value !== sum.base64) throw new Error("Выдача загрузки Mnemos не совпала с текстом предложения.");
      const response = await fetch(storageTarget(storageOrigin, ticket.url), { method: "PUT", redirect: "manual", signal: AbortSignal.timeout(20000), headers: { [ticket.checksum_header]: sum.base64 }, body: content });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`Хранилище Mnemos не приняло текст (код ${response.status}).`);
      let saved: DraftHead | undefined;
      try {
        if (proposal.create) {
          const result = await ui.createPrivateDocument(proposal.project, {request_id: proposal.create.requestId, expected_head: expected, parent_id: proposal.create.parent, name: proposal.name, content_type: proposal.create.mediaType, upload_id: ticket.upload_id, message: "Новый личный документ агента"});
          proposal.node = result.node_id; saved = result;
        } else saved = await ui.saveDraftDocument(proposal.project, proposal.node, ticket.upload_id, expected);
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
    const proposal = this.#proposal(action);
    if (proposal.state === "applied") throw new Error("Действие уже выполнено; отклонить его нельзя, откатите черновик в приложении Mnemos.");
    this.#settle(action, proposal, "rejected");
  }
  async revertAction(action: number): Promise<{ message: string }> {
    const proposal = this.#proposal(action);
    return { message: `Откат делается в приложении Mnemos: восстановите в документе «${proposal.name}» прежнюю версию из истории личного черновика.` };
  }

  #key(action: number): string { return `draft:${action}`; }
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

  async #readDocument(queue: RpcStub<ApprovalQueue>, project: string, document: string): Promise<MnemosDocument> {
    identifier(project, "проект"); identifier(document, "документ", 4096);
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
    const content = await this.#quiet(() => reader.readProjectDocument(project, located.id));
    if (!content) throw new Error(UNAVAILABLE);
    await this.#recordWorkContext(queue, reader, project, located.name !== located.id ? located.name : undefined, publication);
    return { document: content.node_id, name: located.name, text: content.text, mediaType: content.media_type, truncated: content.truncated };
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
    const nodes: Node[] = [];
    let cursor = "";
    for (let page = 0; page < NODE_PAGES_LIMIT; page++) {
      const listing = await reader.browseProject(project, cursor);
      nodes.push(...listing.nodes);
      if (!listing.next_cursor) break;
      cursor = listing.next_cursor;
    }
    return nodes;
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
