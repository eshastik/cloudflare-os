import { HUMAN_SESSION_MS } from "./human-session.ts";
import { retryWhileUploading } from "./upload-batches.ts";
import {validateUploadUsage} from './upload-usage.ts';
import {CentroidRequests} from './centroid.ts';
import {ReindexBatches,type ReindexBatch} from './reindex-batch.ts';
import {ReindexRequests} from './reindex.ts';
import {validPolicyAlertPage} from './policy-alerts.ts';
import type {ConnectionAuditEvent} from "./connection-audit-storage.ts";
import {storedAccountOwner, type StoredAccountOwner} from "./account-identity.ts";
import { isNativeDocumentFormat } from "@gadgets/workshop-shared/native-document";
import {validSignalInbox} from "./platform-signal-inbox.ts";
import { validSignalOwners, validSignalOwnerPage } from "./platform-signal-owners.ts";
import { validPlatformSignals } from "./platform-signals.ts";
import {validateOfficeUpdateComparison} from "./office-update-validation.ts";
import type {OfficeUpdateInput,OfficeUpdateDecision,SpendingPeriod} from "./mnemos-api.ts";
import type { SpendingEntry } from "@gadgets/workshop-shared/spending";
import type {CalendarGrantDecision} from "./calendar-connections.ts";
import type {MailGrantDecision} from "./mail-connections.ts";
import type {BitrixTaskMapping} from "./corporate-import.ts";
import type {DatabaseRegistration} from "./database-connections.ts";
import {GitRegistrations} from "./git-registration.ts";
import type {GitSetup,GitRegistration} from "./git-connections.ts";
import {TemplateReviewActions} from "./template-review-actions.ts";
import type {TemplateDecisionInput} from "./work-templates.ts";
import {TemplateActions,type TemplateAction} from "./template-actions.ts";
import {AbsenceActions, type AbsenceAction} from "./absence-actions.ts";
import { validReviewDecisions } from "./review-decisions.ts";
import { validReviewTiming } from "./review-timing.ts";
import { validUIReadinessUsage, validUIReadinessVersions } from "./ui-readiness-metrics.ts";
import { validOrganizationWork } from "./organization-metrics.ts";
import { validActivityWindows } from "./activity-periods.ts";
import { validExternalSnapshot } from "./external-metrics.ts";
import { validServiceSnapshot } from "./service-metrics.ts";
import { SelectedDocumentReader, parseDocumentResource, type DocumentResource } from "./document-resource.ts";
import { MnemosAPI, MnemosAPIError, type UIReadinessSample, type AgentTaskOutcome, type TeamBudgetCreate, type AgentConnectionPage, type AgentConsentPreview, type AgentCredential, type PolicyDomain, type PrivateDocumentCreate, type PrivateParticipantMode } from "./mnemos-api.ts";
import type { NativeDocumentFormat } from "@gadgets/workshop-shared/native-document";

interface CredentialRecord { token: string; generation: string; expiresAt: number; owner?: StoredAccountOwner; epoch?: string; audit_account_id?: string; connection_audit?: ConnectionAuditEvent[] }
// Matches the synchronous KV storage of a Cloudflare UserAccount durable object.
export interface AccountStorage {
  get<T>(key: string): T | undefined;
  put<T>(key: string, value: T): void;
  delete(key: string): void;
}
export interface ManagedAgentRequest {
  request_id: string;
  template_id: string;
  result?: AgentConnectionPage["connections"][number];
}
export interface ManagedTaskRequest {
  voice?: NonNullable<TeamBudgetCreate["voice"]> & {project_id:string};
  tracker?: {project_id:string;node_id:string;agent_id:string;original_message:string};
  request_id: string;
  binding_id: string;
  message: string;
  criteria?: string;
  parent_request_id?: string;
  /** Immutable source terms; all result reads use the team authorization route. */
  team_budget?: {project_id: string; proposal_id: string; role: string};
  budget_request?: {project_id: string; input: TeamBudgetCreate & {request_id: string}; proposal_id?: string};
  draft_request_id?: string;
  deferred?: boolean;
  resumed?: boolean;
  cancel_requested?: boolean;
  cancelled?: boolean;
  submitted: boolean;
  outcome?: AgentTaskOutcome;
  legacy_review?: {revision: number; decision: "accepted" | "changes_requested"; comment: string; reviewer_id: string; reviewed_at: string; result_content: string};
  review?: {source?: "server"; revision: number; decision: "accepted" | "changes_requested"; comment: string; reviewer_id: string; reviewed_at: string; result_content: string};
}
const TASK_REQUEST = "mnemosManagedTaskRequest";
const TASK_HISTORY_HEAD = "mnemosTaskHistoryHead";
const TASK_HISTORY_PREFIX = "mnemosTaskHistory:";
interface FinishedTask {request: ManagedTaskRequest; next: string}
const MANAGED_REQUEST = "mnemosManagedAgentRequest";
const KEY = "mnemosCredential";
/** Связь синглтона Workshop (S14/S15): без credential, привязана к эпохе подключения. */
const AGENT_KEY = "mnemosWorkshopAgent";
/** Кэш короткоживущего агентского credential; отдельный ключ, чтобы запись связи токена не содержала. */
const AGENT_CREDENTIAL_KEY = "mnemosWorkshopAgentCredential";
/** Credential обновляется заранее, чтобы запись не упёрлась в истечение посреди загрузки. */
const AGENT_REFRESH_MARGIN_MS = 10_000;
interface WorkshopAgentRecord { bindingId: string; connectionName: string; epoch: string }
interface WorkshopAgentCredential { bindingId: string; token: string; expiresAt: number }

/** request_id связи: стабилен для аккаунта в пределах эпохи подключения, меняется после отключения. */
async function workshopAgentRequestId(accountId: string, epoch: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`workshop-agent\0${accountId}\0${epoch}`)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Internal account helper; never a UI or agent RPC target. */
export class MnemosAccount {
  #storage: AccountStorage;
  #origin: string;
  #fetch: typeof fetch;
  #clock: () => number;
  constructor(storage: AccountStorage, origin: string, fetcher: typeof fetch = fetch, clock: () => number = Date.now) {
    this.#storage = storage; this.#origin = origin; this.#fetch = fetcher; this.#clock = clock;
  }
  /** Связь Workshop заводится один раз на эпоху подключения; scope — проекты, доступные человеку сейчас. */
  async ensureWorkshopAgent(accountId: string, connectionName: string): Promise<{ bindingId: string; connectionName: string }> {
    const epoch = this.calendarEpoch();
    if (!epoch) throw new MnemosAPIError(401);
    const existing = this.#storage.get<WorkshopAgentRecord>(AGENT_KEY);
    if (existing && existing.epoch === epoch) return { bindingId: existing.bindingId, connectionName: existing.connectionName };
    const requestId = await workshopAgentRequestId(accountId, epoch);
    const human = this.session();
    try {
      const projects = (await human.listProjects()).projects.map(project => project.id);
      const connection = await human.provisionWorkshopAgent(requestId, connectionName, projects);
      if (connection.revoked) throw new MnemosAPIError(403);
      if (this.calendarEpoch() !== epoch) throw new MnemosAPIError(401);
      const record: WorkshopAgentRecord = { bindingId: connection.binding_id, connectionName: connection.connection_name, epoch };
      this.#storage.put(AGENT_KEY, record);
      return { bindingId: record.bindingId, connectionName: record.connectionName };
    } finally { human.dispose(); }
  }
  /** Сессия под агентским credential: выпуск и обновление идут по связи через сессию человека, токен наружу не выходит. */
  agentSession(): MnemosAccountSession {
    const record = this.#storage.get<WorkshopAgentRecord>(AGENT_KEY);
    const human = this.#storage.get<CredentialRecord>(KEY);
    if (!record || !human?.token || !(human.expiresAt > Date.now())) throw new MnemosAPIError(401);
    const valid = () => {
      const current = this.#storage.get<WorkshopAgentRecord>(AGENT_KEY), owner = this.#storage.get<CredentialRecord>(KEY);
      return current?.bindingId === record.bindingId && current.epoch === record.epoch && !!owner?.token && owner.expiresAt > Date.now();
    };
    const client = new MnemosAPI(this.#origin, async () => {
      if (!valid()) throw new MnemosAPIError(401);
      const cached = this.#storage.get<WorkshopAgentCredential>(AGENT_CREDENTIAL_KEY);
      if (cached?.bindingId === record.bindingId && cached.expiresAt - AGENT_REFRESH_MARGIN_MS > this.#clock()) return cached.token;
      const session = this.session();
      let credential: AgentCredential;
      try { credential = await session.issueAgentCredential(record.bindingId); } finally { session.dispose(); }
      if (credential.token_type !== "Bearer" || typeof credential.access_token !== "string" || !credential.access_token || !Number.isSafeInteger(credential.expires_in) || credential.expires_in <= 0) throw new MnemosAPIError(502);
      if (!valid()) throw new MnemosAPIError(401);
      this.#storage.put(AGENT_CREDENTIAL_KEY, { bindingId: record.bindingId, token: credential.access_token, expiresAt: this.#clock() + credential.expires_in * 1000 } satisfies WorkshopAgentCredential);
      return credential.access_token;
    }, this.#fetch);
    return new MnemosAccountSession(client, valid, this.#storage);
  }
  /** Отзыв связи на сервере и очистка кэша; локальная очистка идёт первой, чтобы потеря ответа не оставила credential. */
  async revokeWorkshopAgent(): Promise<void> {
    const record = this.#storage.get<WorkshopAgentRecord>(AGENT_KEY);
    this.#clearWorkshopAgent();
    if (!record) return;
    const session = this.session();
    try { await session.revokeAgentConnection(record.bindingId); } finally { session.dispose(); }
  }
  #clearWorkshopAgent(): void { this.#storage.delete(AGENT_KEY); this.#storage.delete(AGENT_CREDENTIAL_KEY); }
  // Only credentials from the trusted server connection flow enter here.
  // Ownership is established by Mnemos, then kept immutable across reconnects.
  async connect(token: string, expiresAt = Date.now() + HUMAN_SESSION_MS): Promise<void> {
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + HUMAN_SESSION_MS) throw new MnemosAPIError(400);
    const generationBeforeProbe = this.#storage.get<CredentialRecord>(KEY)?.generation;
    const identity = await new MnemosAPI(this.#origin, async () => token, this.#fetch).whoAmI();
    if (this.#storage.get<CredentialRecord>(KEY)?.generation !== generationBeforeProbe) throw new MnemosAPIError(409);
    const subject = identity.subject;
    if (!subject || typeof subject.tenant_id !== "string" || !subject.tenant_id || typeof subject.user_id !== "string" || !subject.user_id || subject.agent_principal_id) throw new MnemosAPIError(403);
    const owner = storedAccountOwner(this.#storage);
    if (owner && (owner.tenant !== subject.tenant_id || owner.user !== subject.user_id)) throw new MnemosAPIError(403);
    if (expiresAt <= Date.now()) throw new MnemosAPIError(401);
    const epoch = this.#storage.get<CredentialRecord>(KEY)?.epoch
      ?? this.#storage.get<string>("mnemosCalendarEpoch") ?? crypto.randomUUID();
    this.#saveCredential({ token, generation: crypto.randomUUID(), expiresAt,
      owner: {tenant: subject.tenant_id, user: subject.user_id}, epoch }, "connected");
  }
  /** Check one immutable publication using this observer's current credential.
   * Neither the credential nor the signed download ticket leaves this account. */
  async canReadPublication(resourceUrl: string, eventId: string, tenantId: string): Promise<boolean> {
    const resource = parseDocumentResource(this.#origin, resourceUrl);
    if (typeof tenantId !== "string" || !tenantId || storedAccountOwner(this.#storage)?.tenant !== tenantId) return false;
    let session: MnemosAccountSession | undefined;
    try {
      session = this.session();
      if (eventId.startsWith("private:")) {
        await session.checkPrivateVersionRead(resource.projectId, resource.nodeId, eventId.slice(8));
      } else {
        const reader = new SelectedDocumentReader(session, resource);
        await reader.validatePublication(eventId);
      }
      return true;
    } catch (error) {
      if (error instanceof MnemosAPIError && [401, 403, 404].includes(error.status)) return false;
      throw error;
    } finally { session?.dispose(); }
  }
  /** Stable calendar ownership survives human login expiry and same-owner reconnect.
   * Explicit disconnect changes the epoch; the API independently checks agent/project grants. */
  calendarEpoch(): string | undefined {
    const record = this.#storage.get<CredentialRecord>(KEY), owner = storedAccountOwner(this.#storage);
    if (!owner || !record?.token) return undefined;
    const epoch = record.epoch ?? this.#storage.get<string>("mnemosCalendarEpoch") ?? crypto.randomUUID();
    if (!record.epoch) {
      if (this.#storage.get<string>("mnemosCalendarEpoch")) this.#storage.put(KEY, {...record, owner, epoch});
      else this.#saveCredential({...record, owner, epoch}, "epoch-initialized");
    }
    return epoch;
  }
  disconnect(): void {
    // One write fences both in-flight sessions and external account capabilities.
    this.#saveCredential({ token: "", generation: crypto.randomUUID(), expiresAt: 0,
      owner: storedAccountOwner(this.#storage), epoch: crypto.randomUUID() }, "disconnected");
    this.#clearWorkshopAgent();
  }
  #saveCredential(record: CredentialRecord, phase: "connected"|"disconnected"|"epoch-initialized") {
    const previous = this.#storage.get<CredentialRecord>(KEY);
    if (!record.owner) { this.#storage.put(KEY, record); return; }
    const events = previous?.connection_audit ?? [];
    if (events.length >= (phase === "connected" ? 126 : 128)) throw Error("Account audit delivery backlog full.");
    const id = previous?.audit_account_id ?? crypto.randomUUID();
    const event: ConnectionAuditEvent = {event_id:crypto.randomUUID(),protocol:"account",account_id:id,
      tenant_id:record.owner.tenant,owner_id:record.owner.user,phase,observed_at:new Date().toISOString()};
    this.#storage.put(KEY, {...record,audit_account_id:id,connection_audit:[...events,event]});
  }
  session(): MnemosAccountSession {
    const record = this.#storage.get<CredentialRecord>(KEY);
    if (!record?.token || !(record.expiresAt > Date.now())) throw new MnemosAPIError(401);
    const valid = () => record.expiresAt > Date.now() && this.#storage.get<CredentialRecord>(KEY)?.generation === record.generation;
    const client = new MnemosAPI(this.#origin, async () => {
      if (!valid()) throw new MnemosAPIError(401);
      return record.token;
    }, this.#fetch);
    return new MnemosAccountSession(client, valid, this.#storage);
  }
}

/** Scoped controller to be wrapped by a human-only RpcTarget. It exports no token. */
export class MnemosAccountSession {
  #client: MnemosAPI;
  #valid: () => boolean;
  #lifetime = new AbortController();
  #consent?: { selection: string; request: string; preview: AgentConsentPreview };
  #consentRevision = 0;
  private requestStorage?: AccountStorage;
  constructor(client: MnemosAPI, valid: () => boolean, requestStorage?: AccountStorage) { this.#client = client; this.#valid = valid; this.requestStorage = requestStorage; }
  #check(): void {
    if (this.#lifetime.signal.aborted || !this.#valid()) throw new MnemosAPIError(401);
  }
  /** Create an internal document-scoped reader after checking membership and access. */
  async selectedDocument(resource: DocumentResource): Promise<SelectedDocumentReader> {
    this.#check();
    const reader = new SelectedDocumentReader(this, resource);
    await reader.history();
    this.#check();
    return reader;
  }
  async listPrivateVersions(project:string,node:string,cursor=''){this.#check();const out=await this.#client.listPrivateVersions(project,node,cursor,this.#lifetime.signal);this.#check();return out;}
  async restorePrivateDraftContent(project:string,node:string,source:string,expectedHead:string){this.#check();const out=await this.#client.restorePrivateDraftContent(project,node,source,expectedHead,this.#lifetime.signal);this.#check();return out;}
  async checkPrivateVersionRead(project: string, node: string, version: string) {
    this.#check();
    const result = await this.#client.checkPrivateVersionRead(project, node, version, this.#lifetime.signal);
    this.#check();
    if (result.node_id !== node || result.head !== version) throw new MnemosAPIError(502);
  }
  async downloadPrivateVersion(project: string, node: string, version: string) {
    this.#check();
    const result = await this.#client.downloadPrivateVersion(project, node, version, this.#lifetime.signal);
    this.#check();
    if (result.node_id !== node || result.head !== version || result.term_index !== 0) throw new MnemosAPIError(502);
    return result;
  }
  async readPrivateVersionDigest(project:string,node:string,version:string) {
    const ticket=await this.downloadPrivateVersion(project,node,version);
    if(!/^[a-f0-9]{64}$/.test(ticket.sha256_hex))throw new MnemosAPIError(502);
    await this.checkPrivateVersionRead(project,node,version);
    return {project_id:project,node_id:node,head:version,sha256:ticket.sha256_hex};
  }
  async officeOrigin(project: string, node: string, version: string) {
    this.#check();
    const result = await this.#client.officeOrigin(project,node,version,this.#lifetime.signal);
    this.#check();
    if (result !== null && (!result || typeof result.source_node_id !== "string" || !result.source_node_id || result.source_node_id.length > 255 ||
      ![result.source_head,result.source_sha256,result.output_sha256].every(v=>typeof v === "string" && /^[a-f0-9]{64}$/.test(v)))) throw new MnemosAPIError(502);
    return result;
  }
  async compareOfficeUpdate(project:string,node:string,input:OfficeUpdateInput){
    input={...input};
    this.#check();const result=await this.#client.compareOfficeUpdate(project,node,input,this.#lifetime.signal);this.#check();
    validateOfficeUpdateComparison(result,node,input);return result;
  }
  async prepareOfficeUpdate(project:string,node:string,input:OfficeUpdateInput,decision:OfficeUpdateDecision){
    input={...input};decision={...decision};
    this.#check();const result=await this.#client.prepareOfficeUpdate(project,node,input,decision,this.#lifetime.signal);this.#check();
    validateOfficeUpdateComparison(result.comparison,node,input);
    const comparison=result.comparison;
    if(typeof result.update_id!=="string"||!result.update_id||result.update_id.length>255||/[\x00-\x1f\x7f]/.test(result.update_id)||
      comparison.current_sha256!==decision.current_sha256||comparison.incoming.source_sha256!==decision.source_sha256||comparison.incoming.sha256_hex!==decision.output_sha256||
      (comparison.outcome!=="update_available"&&comparison.outcome!=="conflict")||
      (comparison.outcome==="conflict"&&!decision.replace_local)||(comparison.incoming.unsupported.length>0&&!decision.accept_unsupported))throw new MnemosAPIError(502);
    return result;
  }
  async applyOfficeUpdate(project:string,node:string,request:string,update:string,upload:string){
    this.#check();const result=await this.#client.applyOfficeUpdate(project,node,request,update,upload,this.#lifetime.signal);this.#check();
    if(result.node_id!==node||typeof result.head!=="string"||!/^[a-f0-9]{64}$/.test(result.head))throw new MnemosAPIError(502);
    return result;
  }
  async convertOffice(project: string, node: string, expected: string, format: "docx" | "xlsx" | "pptx", importing: boolean, title = "", sourceHead = "") {
    this.#check();
    const result = await this.#client.convertOffice(project, node, expected, format, importing, title, this.#lifetime.signal, sourceHead);
    this.#check();
    const mime = importing ? `application/vnd.cloudflareos.${format === "docx" ? "document" : format === "pptx" ? "presentation" : "spreadsheet"}+json` :
      format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : format === "pptx" ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if ((importing && (typeof result.preview_id !== "string" || !result.preview_id || result.preview_id.length > 255)) || result.source_node_id !== node || result.source_head !== (sourceHead || expected) || result.content_type !== mime || result.method !== "GET" ||
      !Number.isSafeInteger(result.size_bytes) || result.size_bytes < 0 || result.size_bytes > 4 * 1024 * 1024 ||
      typeof result.sha256_hex !== "string" || !/^[a-f0-9]{64}$/.test(result.sha256_hex) ||
      typeof result.source_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(result.source_sha256) ||
      !Array.isArray(result.unsupported) || result.unsupported.length > 4096 || result.unsupported.some(v => typeof v !== "string" || v.length > 2048)) throw new MnemosAPIError(502);
    return result;
  }
  async listInvitedTrackers(project:string,cursor:string,node=""){const page=await this.listInvitedDocuments(project,cursor,node);return {...page,documents:page.documents.filter(d=>d.content_type==="application/vnd.mnemos.task-tracker+json")};}
  async validateInvitedTracker(project:string,node:string,source:string){
    const invited=await this.listInvitedDocuments(project,"",node);
    if(!invited.documents.some(d=>d.node_id===node&&d.head===source&&d.content_type==="application/vnd.mnemos.task-tracker+json"))throw new Error("Tracker invitation unavailable or changed");
    await this.checkPrivateVersionRead(project,node,source);
  }
  async downloadInvitedTracker(project:string,node:string,source:string){
    await this.validateInvitedTracker(project,node,source);
    const ticket=await this.downloadPrivateVersion(project,node,source);
    if(ticket.content_type!=="application/vnd.mnemos.task-tracker+json")throw new MnemosAPIError(502);
    return ticket;
  }
  async connectInvitedTracker(project:string,node:string,source:string){
    await this.validateInvitedTracker(project,node,source);
    // Приглашение «только к документу» копии к себе не даёт; сервер тоже откажет.
    if((await this.listInvitedDocuments(project,"",node)).documents.some(d=>d.node_id===node&&d.document_only===true))throw new Error("Document-only invitation cannot be copied");
    const head=(await this.openDraft(project)).head;
    // The core adoption operation rejects existing nodes and stale heads.
    // Reading an absent private node can return 403, so it cannot test absence.
    return this.adoptPrivateVersion(project,node,head,source);
  }
  async listInvitedDocuments(project: string, cursor = "", node = "") {
    this.#check();
    const page = await this.#client.listInvitedDocuments(project, cursor, node, this.#lifetime.signal);
    this.#check();
    if (!Array.isArray(page.documents) || page.documents.length > 100 || typeof page.next_cursor !== "string" || page.next_cursor.length > 2048 || page.documents.some(d =>
      !d || typeof d.node_id !== "string" || !d.node_id || d.node_id.length > 255 || (node && d.node_id !== node) ||
      typeof d.head !== "string" || !/^[a-f0-9]{64}$/.test(d.head) || typeof d.owner_id !== "string" || !d.owner_id || d.owner_id.length > 255 ||
      typeof d.name !== "string" || !d.name || d.name.length > 255 || typeof d.content_type !== "string" || d.content_type.length > 255 ||
      (d.document_only !== undefined && typeof d.document_only !== "boolean"))) throw new MnemosAPIError(502);
    return page;
  }
  async listSharedDocuments() {
    this.#check();
    const page = await this.#client.listSharedDocuments(this.#lifetime.signal);
    this.#check();
    const text = (v: unknown, max = 255) => typeof v === "string" && v.length <= max;
    if (!page || !Array.isArray(page.documents) || page.documents.length > 100 || page.documents.some(d => !d ||
      !text(d.project_id) || !d.project_id || !text(d.node_id) || !d.node_id || !text(d.owner_id) || !d.owner_id || !text(d.name) || !d.name ||
      !text(d.project_name) || !text(d.owner_name) || !text(d.granted_by_name) || !text(d.content_type) || typeof d.head !== "string" || !/^[a-f0-9]{64}$/.test(d.head) ||
      (d.mode !== "read" && d.mode !== "write") || typeof d.granted_at !== "string" || typeof d.seen !== "boolean" ||
      (d.document_only !== undefined && typeof d.document_only !== "boolean"))) throw new MnemosAPIError(502);
    return page.documents;
  }
  async markSharedDocumentSeen(project: string, owner: string, node: string) {
    this.#check();
    await this.#client.markSharedDocumentSeen(project, owner, node, this.#lifetime.signal);
  }
  async saveSharedDocument(project: string, node: string, owner: string, base: string, uploadId: string) {
    this.#check();
    const result = await this.#client.saveSharedDocument(project, node, owner, base, uploadId, this.#lifetime.signal);
    this.#check();
    if (typeof result.head !== "string" || !/^[a-f0-9]{64}$/.test(result.head)) throw new MnemosAPIError(502);
    return result;
  }
  async adoptPrivateVersion(project: string, node: string, expected: string, source: string) {
    this.#check();
    const result = await this.#client.adoptPrivateVersion(project, node, expected, source, this.#lifetime.signal);
    this.#check();
    if (typeof result.head !== "string" || !/^[a-f0-9]{64}$/.test(result.head)) throw new MnemosAPIError(502);
    return result;
  }
  async listPrivateDocuments(projectId: string, cursor = "") {
    this.#check();
    const page = await this.#client.listPrivateDocuments(projectId, cursor, this.#lifetime.signal);
    this.#check();
    if (!Array.isArray(page.documents) || page.documents.length > 100 || typeof page.next_cursor !== "string" || page.documents.some(d => !d.node_id || typeof d.name !== "string")) throw new MnemosAPIError(502);
    return page;
  }
  async listPrivateDocumentsForOwner(projectId: string, owner: string, cursor = "") {
    this.#check();
    const page = await this.#client.listPrivateDocumentsForOwner(projectId, owner, cursor, this.#lifetime.signal);
    this.#check();
    if (!Array.isArray(page.documents) || page.documents.length > 100 || typeof page.next_cursor !== "string" || page.documents.some(d => !d.node_id || typeof d.name !== "string") || (page.documents.length > 0 && !/^[a-f0-9]{64}$/.test(page.head))) throw new MnemosAPIError(502);
    return page;
  }
  async readDraftDocument(projectId: string, nodeId: string) {
    this.#check();
    const result = await this.#client.readDraftDocument(projectId, nodeId, this.#lifetime.signal);
    this.#check();
    if (result.node_id !== nodeId) throw new MnemosAPIError(502);
    return result;
  }
  async beginDraftDownload(projectId: string, nodeId: string, expectedHead: string, termIndex: number) {
    this.#check();
    const result = await this.#client.beginDraftDownload(projectId, nodeId, expectedHead, termIndex, this.#lifetime.signal);
    this.#check();
    if (result.node_id !== nodeId || result.head !== expectedHead || result.term_index !== termIndex) throw new MnemosAPIError(502);
    return result;
  }
  async readPublishedHead(project:string) {this.#check();const result=await this.#client.readPublishedHead(project,this.#lifetime.signal);this.#check();return result;}
  async draftState(projectId: string) {
    this.#check();
    const result = await retryWhileUploading(() => this.#client.draftState(projectId, this.#lifetime.signal), { signal: this.#lifetime.signal });
    this.#check(); return result;
  }
  async openDraft(projectId: string) {
    this.#check();
    const result = await retryWhileUploading(() => this.#client.openDraft(projectId, this.#lifetime.signal), { signal: this.#lifetime.signal });
    this.#check(); return result;
  }
  async checkTrackerAssignee(project:string,node:string,head:string,principal:string){
    this.#check();await this.#client.checkTrackerAssignee(project,node,head,principal,this.#lifetime.signal);this.#check();
  }
  async listPrivateDraftParticipants(project: string, node: string, head: string, cursor: string) {
    this.#check();
    const result = await this.#client.listPrivateDraftParticipants(project,node,head,cursor,this.#lifetime.signal);
    this.#check(); return result;
  }
  async setPrivateDraftParticipant(project: string, node: string, head: string, participant: string, expected: PrivateParticipantMode, mode: PrivateParticipantMode) {
    this.#check();
    const result = await this.#client.setPrivateDraftParticipant(project,node,head,participant,expected,mode,this.#lifetime.signal);
    this.#check();
    return result;
  }
  async createPrivateDocument(projectId: string, request: PrivateDocumentCreate) {
    this.#check();
    const result = await this.#client.createPrivateDocument(projectId, request, this.#lifetime.signal);
    this.#check(); return result;
  }
  async saveDraftLocation(project: string, node: string, expectedHead: string, name: string, parent: string) {
    this.#check();
    const result = await this.#client.saveDraftLocation(project, node, expectedHead, name, parent, this.#lifetime.signal);
    this.#check(); return result;
  }
  async updateDraft(project: string, expectedHead: string) {
    this.#check();
    const result = await this.#client.updateDraft(project, expectedHead, this.#lifetime.signal);
    this.#check(); return result;
  }
  async resolveDraftConflict(project: string, node: string, expectedHead: string, termIndex: number) {
    this.#check();
    const result = await this.#client.resolveDraftConflict(project, node, expectedHead, termIndex, this.#lifetime.signal);
    this.#check(); return result;
  }
  async restoreDeletedDraft(project: string, node: string, event: string, expectedHead: string) {
    this.#check();
    const result = await this.#client.restoreDeletedDraft(project, node, event, expectedHead, this.#lifetime.signal);
    this.#check(); return result;
  }
  async restoreDraftContent(project: string, node: string, event: string, expectedHead: string) {
    this.#check();
    const result = await this.#client.restoreDraftContent(project, node, event, expectedHead, this.#lifetime.signal);
    this.#check(); return result;
  }
  async deleteDraftDocument(project: string, node: string, expectedHead: string) {
    this.#check();
    const result = await this.#client.deleteDraftDocument(project, node, expectedHead, this.#lifetime.signal);
    this.#check(); return result;
  }
  async saveDraftDocument(projectId: string, nodeId: string, uploadId: string, expectedHead: string) {
    this.#check();
    const result = await this.#client.saveDraftDocument(projectId, nodeId, uploadId, expectedHead, this.#lifetime.signal);
    this.#check(); return result;
  }
  async listPublicationReviews(cursor: string) {
    this.#check();
    const result = await this.#client.listPublicationReviews(cursor, this.#lifetime.signal);
    this.#check(); return result;
  }
  async beginReviewDownload(review: string, node: string, version: number, side: "before" | "after") {
    return this.#reviewDownload(review, node, version, side, "text/plain");
  }
  /** Exact native review side; generic JSON and text cannot stand in for a native format. */
  async beginNativeReviewDownload(review: string, node: string, version: number, side: "before" | "after", format: NativeDocumentFormat) {
    if (!isNativeDocumentFormat(format)) throw new MnemosAPIError(400);
    return this.#reviewDownload(review, node, version, side, `application/vnd.${format}+json`);
  }
  async #reviewDownload(review: string, node: string, version: number, side: "before" | "after", contentType: string) {
    this.#check();
    const ticket = await this.#client.beginReviewDownload(review, node, version, side, this.#lifetime.signal);
    this.#check();
    if (ticket.review_id !== review || ticket.node_id !== node || ticket.decision_version !== version || ticket.side !== side) throw new MnemosAPIError(502);
    if (ticket.present === false) return null;
    if(contentType==="text/plain"&&(ticket.content_type==="application/vnd.mnemos.task-tracker+json"||ticket.content_type==="application/vnd.mnemos.resource-map+json"))contentType=ticket.content_type;
    if (ticket.present !== true || ticket.content_type !== contentType || !ticket.url || !ticket.method || !ticket.sha256_hex) throw new MnemosAPIError(400);
    const metadata = ticket.metadata;
    if (metadata !== undefined && (!metadata || typeof metadata.name !== "string" || !metadata.name || typeof metadata.parent_id !== "string" || metadata.content_type !== contentType)) throw new MnemosAPIError(502);
    return { url: ticket.url, method: ticket.method, size_bytes: ticket.size_bytes, sha256_hex: ticket.sha256_hex, content_type: contentType,
      ...(metadata ? { metadata: { name: metadata.name, parent_id: metadata.parent_id } } : {}) };

  }
  async validateReviewDownload(review: string, node: string, version: number) {
    const preview = await this.readPublicationReview(review);
    if (preview.candidate_id !== review || preview.decision_version !== version || !preview.domains.some(domain => domain.node_ids.includes(node))) throw new MnemosAPIError(403);
  }
  async withdrawPublicationReview(id: string) {
    this.#check();
    await this.#client.withdrawPublicationReview(id, this.#lifetime.signal);
    this.#check();
  }
  async recordReviewDecision(id: string, domain: string, version: number, approved: boolean) {
    this.#check();
    await this.#client.recordReviewDecision(id, domain, version, approved, this.#lifetime.signal);
    this.#check();
  }
  async readPublicationPolicy(project: string) {
    this.#check(); const result = await this.#client.readPublicationPolicy(project, this.#lifetime.signal); this.#check();
    if (result.project_id !== project) throw new MnemosAPIError(502);
    return result;
  }
  async listPolicyApprovers(project: string, cursor: string) {
    this.#check(); const result = await this.#client.listPolicyApprovers(project, cursor, this.#lifetime.signal); this.#check(); return result;
  }
  async setPublicationPolicy(project: string, revision: number, domains: PolicyDomain[]) {
    this.#check(); const result = await this.#client.setPublicationPolicy(project, revision, domains, this.#lifetime.signal); this.#check(); return result;
  }
  async readPublicationReview(id: string) {
    this.#check();
    const result = await this.#client.readPublicationReview(id, this.#lifetime.signal);
    this.#check(); return result;
  }
  async requestPublicationReview(projectId: string, personalHead: string, sharedHead: string) {
    this.#check();
    const result = await this.#client.requestPublicationReview(projectId, personalHead, sharedHead, this.#lifetime.signal);
    this.#check(); return result;
  }
  async publishDraft(projectId: string, expectedHead: string, sharedHead: string, message: string) {
    this.#check();
    const result = await this.#client.publishDraft(projectId, expectedHead, sharedHead, message, this.#lifetime.signal);
    this.#check(); return result;
  }
  /** Bind the human's publication action to the reviewed proposal, never newer draft content. */
  async publishReview(project: string, id: string) {
    const review = await this.readPublicationReview(id);
    const identity = await this.whoAmI();
    if (review.candidate_id !== id || review.project_id !== project || review.author_id !== identity.subject.user_id || review.stale || !review.ready) throw new MnemosAPIError(403);
    const state = await this.draftState(project);
    if (!state.personal_exists || state.personal_head !== review.personal_head || state.shared_head !== review.shared_head) throw new MnemosAPIError(409);
    return this.publishDraft(project, review.personal_head, review.shared_head, "Publish reviewed native changes");
  }
  async beginTextUpload(projectId: string, size: number, checksum: string) {
    this.#check();
    const ticket = await this.#client.beginTextUpload(projectId, size, checksum, this.#lifetime.signal);
    this.#check(); return ticket;
  }
  /** Internal source-import upload; not exposed by the management iframe. */
  async beginImportUpload(projectId: string, size: number, checksum: string) {
    this.#check();
    const ticket = await this.#client.beginImportUpload(projectId, size, checksum, this.#lifetime.signal);
    this.#check(); return ticket;
  }
  async beginNativeUpload(projectId: string, size: number, checksum: string) {
    this.#check();
    const ticket = await this.#client.beginNativeUpload(projectId, size, checksum, this.#lifetime.signal);
    this.#check(); return ticket;
  }
  private async requireIntakeManager() {
    const identity = await this.whoAmI();
    if (!identity.capabilities?.includes("project.create")) throw new MnemosAPIError(403);
  }
  async beginInboxUpload(size: number, checksum: string) {await this.requireIntakeManager();const result=await this.#client.beginInboxUpload(size,checksum,this.#lifetime.signal);this.#check();return result;}
  async beginProjectUpload(projectId: string, size: number, checksum: string) {
    this.#check();
    const ticket = await this.#client.beginProjectUpload(projectId, size, checksum, this.#lifetime.signal);
    this.#check();
    return ticket;
  }
  async submitProjectUpload(projectId: string, uploadId: string, sourcePath: string, modifiedAt?: number) {
    this.#check();
    const result = await this.#client.submitProjectUpload(projectId, uploadId, sourcePath, modifiedAt, this.#lifetime.signal);
    this.#check();
    return result;
  }
  async submitInboxUpload(uploadId: string, sourcePath: string, modifiedAt?: number) {await this.requireIntakeManager();const result=await this.#client.submitInboxUpload(uploadId,sourcePath,modifiedAt,this.#lifetime.signal);this.#check();return result;}
  async inboxStatus(projectId?:string) {this.#check();if(!projectId)await this.requireIntakeManager();const result=await this.#client.inboxStatus(this.#lifetime.signal,projectId);this.#check();return result;}
  async inboxAlerts(decided=false, projectId?: string) {this.#check();if (!projectId) await this.requireIntakeManager();const result=await this.#client.inboxAlerts(decided,this.#lifetime.signal,projectId);this.#check();return result;}
  async decideInboxAlert(id: string, decision: import("./intake.ts").IntakeDecision) {this.#check();if (!decision.intake_project_id) await this.requireIntakeManager();const result=await this.#client.decideInboxAlert(id,decision,this.#lifetime.signal);this.#check();return result;}
  async replayInboxItem(hash: string, version: number) {await this.requireIntakeManager();const result=await this.#client.replayInboxItem(hash,version,this.#lifetime.signal);this.#check();return result;}
  private async requirePeopleManager() {
    const identity = await this.whoAmI();
    if (!identity.capabilities?.includes("principal.manage")) throw new MnemosAPIError(403);
  }
  async listPeople() { await this.requirePeopleManager(); const result = await this.#client.listPeople(this.#lifetime.signal); this.#check(); return result; }
  async createPerson(input: import("./admin-people.ts").AdminPersonCreate) { await this.requirePeopleManager(); const result = await this.#client.createPerson(input,this.#lifetime.signal); this.#check(); return result; }
  async listPersonRights(principal: string) { await this.requirePeopleManager(); const result = await this.#client.listPersonRights(principal,this.#lifetime.signal); this.#check(); return result; }
  async grantPersonRight(input: import("./admin-people.ts").AdminRight) { await this.requirePeopleManager(); const result = await this.#client.grantPersonRight(input,this.#lifetime.signal); this.#check(); return result; }
  async removePersonRight(input: import("./admin-people.ts").AdminRight) { await this.requirePeopleManager(); const result = await this.#client.removePersonRight(input,this.#lifetime.signal); this.#check(); return result; }
  async removePerson(principal: string) { await this.requirePeopleManager(); const result = await this.#client.removePerson(principal,this.#lifetime.signal); this.#check(); return result; }
  async returnPerson(principal: string) { await this.requirePeopleManager(); const result = await this.#client.returnPerson(principal,this.#lifetime.signal); this.#check(); return result; }
  async createProject(name: string, slug: string) {
    this.#check(); const result = await this.#client.createProject(name, slug, this.#lifetime.signal); this.#check(); return result;
  }
  /** Проект с кодом из папки: проект, внутренний репозиторий и первый коммит одним запросом. */
  async createCodeProject(name: string, slug: string, files: import("./mnemos-api.ts").CodeProjectFile[]) {
    this.#check();
    const result = await this.#client.createCodeProject(name, slug, files, this.#lifetime.signal);
    this.#check();
    const repo = result?.repository;
    if (!result?.project || typeof result.project.id !== "string" || !result.project.id ||
        (repo !== null && (!repo || typeof repo.repository_id !== "string" || typeof repo.repository_name !== "string" || typeof repo.connection_id !== "string")) ||
        (repo === null && typeof result.repository_error !== "string")) throw new MnemosAPIError(502);
    return result;
  }
  /** Поиск по всем проектам, которые видит человек; limit — до 50 совпадений. */
  async searchAll(query: string, limit = 20) {
    this.#check();
    const page = await this.#client.searchAll(query, Math.min(Math.max(Math.trunc(limit) || 20, 1), 50), this.#lifetime.signal);
    this.#check();
    if (!Array.isArray(page.hits) || page.hits.some(hit => typeof hit.project_id !== "string" || !hit.project_id)) throw new MnemosAPIError(502);
    return { hits: page.hits.map(({ project_id, node_id, name, text, ordinal, path }) => ({ project_id, node_id, name, text, ordinal, ...(typeof path === "string" ? { path } : {}) })), index_pending: page.index_pending, degraded: page.degraded };
  }
  async readProjectDocumentWindow(projectId: string, nodeId: string, ordinal: number, radius: number, maxBytes = 262144) {
    this.#check();
    const content = await this.#client.readProjectDocumentWindow(projectId, nodeId, ordinal, radius, maxBytes, this.#lifetime.signal);
    this.#check();
    if (content.node_id !== nodeId) throw new MnemosAPIError(502);
    return content;
  }
  /** Субъект сохраняется: сервер различает человеческое подтверждение и агентское исполнение. */
  async workshopAdminOperation(binding: string, operation: string, phase: "prepare" | "approve" | "reject" | "execute", request: import("./admin-operations.ts").AdminOperationRequest) {
    this.#check(); const result = await this.#client.workshopAdminOperation(binding, operation, phase, request, this.#lifetime.signal); this.#check(); return result;
  }
  async readWorkshopAgentScope(binding: string) { this.#check(); const result=await this.#client.readWorkshopAgentScope(binding,this.#lifetime.signal); this.#check(); return result; }
  async updateWorkshopAgentScope(binding: string, expected: string[], projects: string[]) {
    this.#check(); const result = await this.#client.updateWorkshopAgentScope(binding, expected, projects, this.#lifetime.signal); this.#check(); return result;
  }
  /** Connection instructions are scoped to the currently authenticated organization. */
  /** Explicit human action; the API checks principal.manage and current grant validity. */
  async setAgentProjectRight(principal: string, project: string, mode: 'read' | 'write', enabled: boolean) { await this.whoAmI(); const out=await this.#client.setAgentProjectRight(principal,project,mode,enabled,this.#lifetime.signal); this.#check(); return out; }
  async externalAgentSetup() { await this.whoAmI(); return this.#client.externalAgentSetup(); }
  async whoAmI() {
    this.#check();
    const identity = await this.#client.whoAmI(this.#lifetime.signal);
    this.#check();
    if (!identity.subject?.user_id || identity.subject.agent_principal_id) throw new MnemosAPIError(403);
    return identity;
  }
  /** Server-only registration after the human confirmed the exact Telegram sender. */
  async registerTelegramChannel(input: import('./mnemos-api.ts').TelegramChannelRegistration) {
    input = {...input};
    const identity = await this.whoAmI();
    const result = await this.#client.registerTelegramChannel(input, this.#lifetime.signal);
    this.#check();
    if (!result || result.id !== input.request_id || result.owner_id !== identity.subject.user_id ||
        result.binding_id !== input.binding_id || result.bot_id !== input.bot_id ||
        result.sender_id !== input.sender_id || result.revision !== 1 || result.enabled !== true) throw new MnemosAPIError(502);
    return {id: result.id, owner_id: result.owner_id, binding_id: result.binding_id, bot_id: result.bot_id,
      sender_id: result.sender_id, revision: result.revision, enabled: result.enabled};
  }
  async beginVoiceUpload(project:string,size:number,checksum:string){
    if(!Number.isSafeInteger(size)||size<1||size>20_000_000)throw new MnemosAPIError(400);
    await this.whoAmI();const out=await this.#client.beginVoiceUpload(project,size,checksum,this.#lifetime.signal);this.#check();return out;
  }
  async downloadVoiceSource(input:import('./voice-contract.ts').VoiceSource){
    input={...input};await this.whoAmI();const out=await this.#client.downloadVoiceSource(input,this.#lifetime.signal);this.#check();return out;
  }
  async importVoiceSource(request:string,project:string,upload:string,mime:string){await this.whoAmI();const out=await this.#client.importVoiceSource(request,project,upload,mime,this.#lifetime.signal);this.#check();return out;}
  async readVoiceSource(request:string){await this.whoAmI();const out=await this.#client.readVoiceSource(request,this.#lifetime.signal);this.#check();return out;}
  async readVoiceTranscript(source:string,revision:number){await this.whoAmI();const out=await this.#client.readVoiceTranscript(source,revision,this.#lifetime.signal);this.#check();return out;}
  async editVoiceTranscript(source:string,input:import('./voice-contract.ts').VoiceEdit){input={...input};await this.whoAmI();const out=await this.#client.editVoiceTranscript(source,input,this.#lifetime.signal);this.#check();return out;}
  async confirmVoiceTranscript(source:string,input:import('./voice-contract.ts').VoiceConfirm){input={...input};await this.whoAmI();const out=await this.#client.confirmVoiceTranscript(source,input,this.#lifetime.signal);this.#check();return out;}
  async readVoiceConfirmation(source:string,operation:string){await this.whoAmI();const out=await this.#client.readVoiceConfirmation(source,operation,this.#lifetime.signal);this.#check();return out;}
  async readTelegramBudget(id:string){
    await this.whoAmI();
    const out=await this.#client.readTelegramBudget(id,this.#lifetime.signal);this.#check();return out;
  }
  async setTelegramBudget(id:string,expected:number,input:Omit<import('./mnemos-api.ts').TelegramBudgetSettings,'revision'>,confirmed:boolean){
    input={project_id:input.project_id,policy_revision:input.policy_revision,limit_usd_micros:input.limit_usd_micros,...(input.voice_binding_id!==undefined||input.voice_limit_usd_micros!==undefined?{voice_binding_id:input.voice_binding_id,voice_limit_usd_micros:input.voice_limit_usd_micros}:{})};
    await this.whoAmI();
    const out=await this.#client.setTelegramBudget(id,expected,input,confirmed,this.#lifetime.signal);this.#check();return out;
  }
  /** Exposes only the current human's source journal, including disabled channels. */
  async telegramTaskJournal(id:string,after=-1) {
    const identity=await this.whoAmI();
    const page=await this.#client.telegramTaskJournal(id,after,this.#lifetime.signal);this.#check();
    const c=page?.channel;
    if(!c||c.id!==id||c.owner_id!==identity.subject.user_id||!Array.isArray(page.items)||page.items.length>25)throw new MnemosAPIError(502);
    let previous=after;
    const items=page.items.map(item=>{
      if(!Number.isSafeInteger(item.update_id)||item.update_id<=previous||!Number.isSafeInteger(item.message_id)||item.message_id<1||item.sender_id!==c.sender_id||typeof item.message!=='string'||typeof item.criteria!=='string'||typeof item.request_id!=='string'||!item.request_id)throw new MnemosAPIError(502);
      previous=item.update_id;
      const source={update_id:item.update_id,message_id:item.message_id,sender_id:item.sender_id,message:item.message,criteria:item.criteria,request_id:item.request_id};
      if(item.kind==='task'&&item.target_update_id===null&&item.correction_id===null)return {...source,kind:'task' as const,target_update_id:null,correction_id:null};
      if(item.kind==='correction'&&Number.isSafeInteger(item.target_update_id)&&item.target_update_id>=0&&typeof item.correction_id==='string'&&item.correction_id)return {...source,kind:'correction' as const,target_update_id:item.target_update_id,correction_id:item.correction_id};
      throw new MnemosAPIError(502);
    });
    if(page.next_after!==null&&(items.length!==25||page.next_after!==previous))throw new MnemosAPIError(502);
    return {channel:{id:c.id,owner_id:c.owner_id,binding_id:c.binding_id,bot_id:c.bot_id,sender_id:c.sender_id,revision:c.revision,enabled:c.enabled},items,next_after:page.next_after};
  }
  async disableTelegramChannel(id: string) {
    this.#check();
    const result = await this.#client.disableTelegramChannel(id, this.#lifetime.signal);
    this.#check(); if (!result || result.disabled !== true) throw new MnemosAPIError(502);
  }
  async searchProject(projectId: string, query: string) {
    this.#check();
    const page = await this.#client.searchProject(projectId, query, 20, this.#lifetime.signal);
    this.#check();
    if (!Array.isArray(page.hits) || page.hits.some(hit => hit.project_id !== projectId)) throw new MnemosAPIError(502);
    return { hits: page.hits.map(({ project_id, node_id, name, text, ordinal, path }) => ({ project_id, node_id, name, text, ordinal, ...(typeof path === "string" ? { path } : {}) })), index_pending: page.index_pending, degraded: page.degraded };
  }
  /** Submit only diagnostic activity; the API derives the human from this credential. */
  async recordWorkspaceActivity(stream: string, sequence: number, active: boolean): Promise<void> {
    this.#check();
    await this.#client.recordWorkspaceActivity(stream, sequence, active, this.#lifetime.signal);
    this.#check();
  }
  /** Forward only bounded performance diagnostics under the current session. */
  async recordUIReadiness(sample:UIReadinessSample):Promise<void> {
    this.#check();
    await this.#client.recordUIReadiness(sample,this.#lifetime.signal);
    this.#check();
  }
  /** Read one verified organization's result counters using current account rights. */
  async readOrganizationMetrics(origin: string): Promise<import('@gadgets/workshop-shared/organization-metrics').OrganizationMetrics> {
    const identity = await this.whoAmI();
    const usage = await this.readPlatformMetrics();
    const work = usage.organization_work;
    if (!identity.subject.tenant_id || !work || work.periods.some(p=>p.completed_projects===undefined || p.has_completed_work===undefined)) throw new MnemosAPIError(502);
    return {origin,tenantId:identity.subject.tenant_id,name:identity.tenant_name || identity.subject.tenant_id,observedAt:work.observed_at,
      periods:work.periods.map(p=>({days:p.days,completedProjects:p.completed_projects!,hasCompletedWork:p.has_completed_work!}))};
  }
  /** Read current tenant usage without retaining it across authorization checks. */
  async readPlatformMetrics() {
    this.#check();
    const usage = await this.#client.platformMetrics(this.#lifetime.signal);
    this.#check();
    if (![usage.shared_publications, usage.human_logins_24h, usage.authenticated_users_24h].every(value => Number.isSafeInteger(value) && value >= 0) || usage.authenticated_users_24h > usage.human_logins_24h || typeof usage.recorded_at !== "string" || !Number.isFinite(Date.parse(usage.recorded_at))) throw new MnemosAPIError(502);
    for (const deployment of [usage.deployment, ...(Array.isArray(usage.external?.versions?.groups) ? usage.external.versions.groups.map(row=>row?.target_deployment) : []), ...(Array.isArray(usage.workflow_attempts) ? usage.workflow_attempts.map(row=>row?.deployment) : []), ...(Array.isArray(usage.ui_readiness_versions?.groups) ? usage.ui_readiness_versions.groups.map(row=>row?.deployment) : [])]) {
      if (deployment == null) continue;
      const label = (v: unknown, max: number) => typeof v === "string" && (v === "" || (v.length <= max && /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(v)));
      if (typeof deployment !== "object" || !label(deployment.environment,64) || !label(deployment.release,96)
          || typeof deployment.source_revision !== "string" || (deployment.source_revision !== "" && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(deployment.source_revision))
          || (deployment.source_modified !== null && typeof deployment.source_modified !== "boolean")
          || (deployment.source_revision === "" && deployment.source_modified !== null)
          || typeof deployment.go_version !== "string" || deployment.go_version.length > 96
          || !Number.isSafeInteger(deployment.schema_version) || deployment.schema_version <= 0) throw new MnemosAPIError(502);
    }
    if (usage.external != null && !validExternalSnapshot(usage.external)) throw new MnemosAPIError(502);
    if (usage.service != null && !validServiceSnapshot(usage.service)) throw new MnemosAPIError(502);
    if (usage.signal_owners != null && !validSignalOwners(usage.signal_owners)) throw new MnemosAPIError(502);
    if (usage.signals != null && !validPlatformSignals(usage.signals)) throw new MnemosAPIError(502);
    const readiness = usage.readiness;
    if (readiness != null && (typeof readiness !== "object" || typeof readiness.ready !== "boolean" || !Array.isArray(readiness.reasons) || !readiness.reasons.every(reason => typeof reason === "string" && reason.startsWith("readiness.")) || readiness.ready !== (readiness.reasons.length === 0) || typeof readiness.checked_at !== "string" || !Number.isFinite(Date.parse(readiness.checked_at)))) throw new MnemosAPIError(502);
    const attempts = usage.workflow_attempts;
    if (attempts != null && (!Array.isArray(attempts) || attempts.some(row=>!row || typeof row!=="object" || !["open","save","review","publish"].includes(row.operation) || !Number.isSafeInteger(row.status) || row.status<100 || row.status>599 || typeof row.outcome!=="string" || !/^[a-z][a-z0-9_.]{0,95}$/.test(row.outcome) || ![row.attempts,row.workflows].every(v=>Number.isSafeInteger(v)&&v>0) || row.workflows>row.attempts || !Number.isFinite(row.mean_duration_ms) || row.mean_duration_ms<0 || typeof row.first_observed_at!=="string" || typeof row.last_observed_at!=="string" || !Number.isFinite(Date.parse(row.first_observed_at)) || !Number.isFinite(Date.parse(row.last_observed_at)) || Date.parse(row.last_observed_at)<Date.parse(row.first_observed_at)))) throw new MnemosAPIError(502);
    const workflow = usage.workflow;
    if (workflow != null && (typeof workflow !== "object" || ![workflow.opened,workflow.saved,workflow.reviewed,workflow.published,workflow.opening_unobserved].every(v=>Number.isSafeInteger(v)&&v>=0) || workflow.published>workflow.reviewed || workflow.reviewed>workflow.saved || workflow.saved>workflow.opened || ((workflow.opened+workflow.opening_unobserved===0) !== (workflow.first_observed_at===null)) || (workflow.first_observed_at!==null && (typeof workflow.first_observed_at!=="string" || !Number.isFinite(Date.parse(workflow.first_observed_at)))))) throw new MnemosAPIError(502);
    const stages = usage.review_stages;
    if (stages != null && (typeof stages !== "object" || ![stages.submitted,stages.awaiting_decisions,stages.rejected,stages.approved,stages.published,stages.historical_completion_unknown].every(v=>Number.isSafeInteger(v)&&v>=0) || stages.awaiting_decisions+stages.rejected+stages.approved!==stages.submitted || stages.published+stages.historical_completion_unknown>stages.submitted)) throw new MnemosAPIError(502);
    if (stages?.decisions !== undefined && !validReviewDecisions(stages.decisions, stages.submitted)) throw new MnemosAPIError(502);
    if (stages?.timing !== undefined && !validReviewTiming(stages.timing, stages.published, stages.awaiting_decisions)) throw new MnemosAPIError(502);
    if (usage.ui_readiness_versions != null && !validUIReadinessVersions(usage.ui_readiness_versions)) throw new MnemosAPIError(502);
    if (usage.ui_readiness != null && !validUIReadinessUsage(usage.ui_readiness)) throw new MnemosAPIError(502);
    if (usage.organization_work != null && !validOrganizationWork(usage.organization_work)) throw new MnemosAPIError(502);
    if (usage.activity_windows != null && !validActivityWindows(usage.activity_windows)) throw new MnemosAPIError(502);
    const a = usage.workspace_activity;
    if (a !== null && (typeof a !== "object" || !a || ![a.reporting_users, a.active_users, a.sessions].every(v => Number.isSafeInteger(v) && v >= 0) || ![a.active_seconds, a.session_seconds].every(v => Number.isFinite(v) && v >= 0) || a.active_users > a.reporting_users || a.sessions < a.active_users || a.active_seconds > a.session_seconds + 0.001)) throw new MnemosAPIError(502);
    return usage;
  }
  async saveProjectSignalAssessment(project:string,request:string,profile:import('./mnemos-api.ts').ProjectSignalProfile){this.#check();const out=await this.#client.saveProjectSignalAssessment(project,request,profile,this.#lifetime.signal);this.#check();return out;}
  async readPublishedProjectSignals(project:string){this.#check();const out=await this.#client.readPublishedProjectSignals(project,this.#lifetime.signal);this.#check();return out;}
  async publishProjectSignals(project:string,selection:import('./mnemos-api.ts').SignalPublicationRequest){this.#check();const out=await this.#client.publishProjectSignals(project,selection,this.#lifetime.signal);this.#check();return out;}
  async readProjectSignalAssessment(project:string,request:string){this.#check();const out=await this.#client.readProjectSignalAssessment(project,request,this.#lifetime.signal);this.#check();return out;}
  async assessProjectSignals(project:string,profile:import('./mnemos-api.ts').ProjectSignalProfile){this.#check();const out=await this.#client.assessProjectSignals(project,profile,this.#lifetime.signal);this.#check();return out;}
  async listProjects() {
    this.#check();
    const page = await this.#client.listProjects(this.#lifetime.signal);
    this.#check(); return page;
  }
  /** Поделиться может только человек: whoAmI отсекает агентскую сессию до обращения к серверу. */
  async setProjectVisibility(project: string, level: import("./project-sharing.ts").ProjectVisibility, canEdit: boolean, consent = false) {
    await this.whoAmI(); const out = await this.#client.setProjectVisibility(project, level, canEdit, this.#lifetime.signal, consent === true); this.#check(); return out;
  }
  async listShareRequests(mine = false) {
    await this.whoAmI(); const out = await this.#client.listShareRequests(mine, this.#lifetime.signal); this.#check(); return out;
  }
  async decideShareRequest(request: string, approve: boolean, consent = false) {
    await this.whoAmI(); const out = await this.#client.decideShareRequest(request, approve, this.#lifetime.signal, consent === true); this.#check(); return out;
  }
  async listPersonPhotos() { this.#check(); const out = await this.#client.listPersonPhotos(this.#lifetime.signal); this.#check(); return out; }
  async beginPersonPhotoUpload(size: number, checksum: string) { this.#check(); const out = await this.#client.beginPersonPhotoUpload(size, checksum, this.#lifetime.signal); this.#check(); return out; }
  async savePersonPhoto(uploadId: string) { this.#check(); const out = await this.#client.savePersonPhoto(uploadId, this.#lifetime.signal); this.#check(); return out; }
  async removePersonPhoto(principal = "") { this.#check(); await this.#client.removePersonPhoto(principal, this.#lifetime.signal); this.#check(); }
  async listOrgUnits() { this.#check(); const out = await this.#client.listOrgUnits(this.#lifetime.signal); this.#check(); return out; }
  async createOrgUnit(name: string) { this.#check(); const out = await this.#client.createOrgUnit(name, this.#lifetime.signal); this.#check(); return out; }
  async deleteOrgUnit(unit: string) { this.#check(); const out = await this.#client.deleteOrgUnit(unit, this.#lifetime.signal); this.#check(); return out; }
  async setOrgUnitMember(unit: string, principal: string, member: boolean, head: boolean) { this.#check(); await this.#client.setOrgUnitMember(unit, principal, member, head, this.#lifetime.signal); this.#check(); }
  async listInvitations() { this.#check(); const out = await this.#client.listInvitations(this.#lifetime.signal); this.#check(); return out; }
  async createInvitation(email: string, displayName: string, orgUnit: string, role: import("./mnemos-api.ts").InvitationRole = "employee", codeAgent = false) { this.#check(); const out = await this.#client.createInvitation(email, displayName, orgUnit, role, this.#lifetime.signal, codeAgent); this.#check(); return out; }
  async revokeInvitation(id: string) { this.#check(); const out = await this.#client.revokeInvitation(id, this.#lifetime.signal); this.#check(); return out; }
  async readProjectSharingSettings() {
    this.#check(); const out = await this.#client.readProjectSharingSettings(this.#lifetime.signal); this.#check(); return out;
  }
  async updateProjectSharingSettings(settings: import("./project-sharing.ts").ProjectSharingSettings) {
    await this.requirePeopleManager(); const out = await this.#client.updateProjectSharingSettings(settings, this.#lifetime.signal); this.#check(); return out;
  }
  async browseProject(projectId: string, cursor = "") {
    this.#check();
    const page = await this.#client.browseProject(projectId, cursor, this.#lifetime.signal);
    this.#check(); return page;
  }
  async readProjectDocument(projectId: string, nodeId: string, maxBytes = 262144) {
    this.#check();
    const content = await this.#client.readProjectDocument(projectId, nodeId, maxBytes, this.#lifetime.signal);
    this.#check();
    if (content.node_id !== nodeId) throw new MnemosAPIError(502);
    return content;
  }
  async downloadProjectDocument(projectId: string, nodeId: string) {
    this.#check();
    const ticket = await this.#client.downloadProjectDocument(projectId, nodeId, this.#lifetime.signal);
    this.#check();
    if (ticket.node_id !== nodeId) throw new MnemosAPIError(502);
    return ticket;
  }
  async beginPublicationTextDownload(project: string, node: string, event: string) {
    const ticket = await this.downloadPublication(project, node, event);
    if (ticket.content_type !== "text/plain" && ticket.content_type !== "application/vnd.mnemos.resource-map+json") throw new MnemosAPIError(400);
    return { url: ticket.url, method: ticket.method, size_bytes: ticket.size_bytes, sha256_hex: ticket.sha256_hex };
  }
  async validatePublicationTextDownload(project: string, node: string) {
    // Publication events are immutable. The history read rechecks current rights
    // to this project/node without materializing and signing the old body twice.
    await this.nodeHistory(project, node, "", 1);
  }
  async checkPublicationRead(projectId: string, nodeId: string, eventId: string): Promise<void> {
    this.#check();
    const verdict = await this.#client.checkPublicationRead(projectId, nodeId, eventId, this.#lifetime.signal);
    this.#check();
    if (verdict.node_id !== nodeId || verdict.event_id !== eventId) throw new MnemosAPIError(502);
  }
  async downloadPublication(projectId: string, nodeId: string, eventId: string) {
    this.#check();
    const ticket = await this.#client.downloadPublication(projectId, nodeId, eventId, this.#lifetime.signal);
    this.#check();
    if (ticket.node_id !== nodeId || ticket.event_id !== eventId) throw new MnemosAPIError(502);
    return ticket;
  }
  async nodeHistory(projectId: string, nodeId: string, cursor = "", limit = 50) {
    this.#check();
    const page = await this.#client.nodeHistory(projectId, nodeId, cursor, limit, this.#lifetime.signal);
    this.#check(); return page;
  }
  async readDocument(nodeId: string) {
    this.#check();
    const content = await this.#client.readDocument(nodeId, this.#lifetime.signal);
    this.#check();
    if (content.node_id !== nodeId) throw new MnemosAPIError(502);
    return content;
  }
  async previewAgentConsent(request: string) {
    this.#check();
    const revision = ++this.#consentRevision;
    this.#consent = undefined;
    const preview = await this.#client.previewAgentConsent(request, this.#lifetime.signal);
    this.#check();
    if (revision !== this.#consentRevision) throw new MnemosAPIError(409);
    if (!preview || typeof preview.client_id !== "string" || !preview.client_id ||
        typeof preview.resource !== "string" || !preview.resource ||
        !Array.isArray(preview.scopes) || !preview.scopes.every(scope => typeof scope === "string" && scope.length > 0) ||
        typeof preview.expires_at !== "string" || !(Date.parse(preview.expires_at) > Date.now()) ||
        (preview.projects !== undefined && preview.projects !== null && (!Array.isArray(preview.projects) || preview.projects.length > 10000 ||
          !preview.projects.every(p => !!p && typeof p.project_id === "string" && !!p.project_id && p.project_id.length <= 255 && typeof p.name === "string" && p.name.length <= 255)))) throw new MnemosAPIError(502);
    if (!preview.projects) preview.projects = [];
    const selection = crypto.randomUUID();
    this.#consent = { selection, request, preview: structuredClone(preview) };
    return { selection, ...preview };
  }
  /** projectIds — выбор человека из показанных проектов; не передан — все показанные. */
  async decideAgentConsent(selection: string, approved: boolean, projectIds?: string[]) {
    this.#check();
    const consent = this.#consent;
    if (!consent || selection !== consent.selection || typeof approved !== "boolean" ||
        !(Date.parse(consent.preview.expires_at) > Date.now())) throw new MnemosAPIError(409);
    const shown = new Set((consent.preview.projects ?? []).map(p => p.project_id));
    if (projectIds !== undefined && (!Array.isArray(projectIds) || projectIds.length > 100 || !projectIds.every(id => typeof id === "string" && shown.has(id)))) throw new MnemosAPIError(400);
    // Consume locally before sending: an ambiguous response must never silently
    // retry issuance, and a later preview cannot change this decision's target.
    this.#consent = undefined;
    ++this.#consentRevision;
    const result = await this.#client.decideAgentConsent(consent.request, consent.preview, approved, this.#lifetime.signal, projectIds === undefined ? undefined : [...new Set(projectIds)]);
    this.#check();
    return result;
  }
  managedAgentRequest(): ManagedAgentRequest | null {
    this.#check();
    return structuredClone(this.requestStorage?.get<ManagedAgentRequest>(MANAGED_REQUEST) ?? null);
  }
  prepareManagedAgent(templateId: string): ManagedAgentRequest {
    this.#check();
    if (!this.requestStorage || typeof templateId !== "string" || !templateId.trim() || templateId.length > 255) throw new MnemosAPIError(400);
    const previous = this.managedAgentRequest();
    if (previous) {
      if (previous.template_id !== templateId) throw new MnemosAPIError(409);
      return previous;
    }
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const request_id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const request = { request_id, template_id: templateId };
    this.requestStorage.put(MANAGED_REQUEST, request);
    return structuredClone(request);
  }
  async submitManagedAgent(requestId: string): Promise<ManagedAgentRequest> {
    const request = this.managedAgentRequest();
    if (!request || request.request_id !== requestId) throw new MnemosAPIError(409);
    if (request.result) return request;
    const result = await this.provisionManagedAgent(request.request_id, request.template_id);
    this.#check();
    if (this.managedAgentRequest()?.request_id !== requestId) throw new MnemosAPIError(409);
    const completed = { ...request, result };
    this.requestStorage!.put(MANAGED_REQUEST, completed);
    return structuredClone(completed);
  }
  finishManagedAgentRequest(requestId: string): void {
    const request = this.managedAgentRequest();
    if (!request || request.request_id !== requestId || !request.result) throw new MnemosAPIError(409);
    this.requestStorage!.delete(MANAGED_REQUEST);
  }
  #storedTaskRequest(): ManagedTaskRequest | null {
    this.#check();
    return structuredClone(this.requestStorage?.get<ManagedTaskRequest>(TASK_REQUEST) ?? null);
  }
  /** Return recovery metadata only; cached agent output is not fresh authorization. */
  managedTaskRequest(): ManagedTaskRequest | null {
    const request = this.#storedTaskRequest();
    if (request) {delete request.outcome; delete request.review; delete request.legacy_review;}
    return request;
  }
  /** Bring an owned member's completed result into the existing human review/history flow. */
  async prepareTeamBudgetReview(project: string, proposalId: string, bindingId: string): Promise<ManagedTaskRequest> {
    this.#check();
    if (!this.requestStorage) throw new MnemosAPIError(409);
    const [proposal, outcome] = await Promise.all([this.readTeamBudget(project, proposalId), this.readTeamBudgetMember(project, proposalId, bindingId)]);
    const member = proposal.proposal.members.find(member => member.binding_id === bindingId);
    if (proposal.id !== proposalId || proposal.project_id !== project || !member || outcome.state !== "completed" || typeof outcome.result?.content !== "string") throw new MnemosAPIError(409);
    const previous = this.#storedTaskRequest();
    if (previous && (previous.request_id !== outcome.request_id || previous.binding_id !== bindingId || previous.team_budget?.project_id !== project || previous.team_budget.proposal_id !== proposalId)) throw new MnemosAPIError(409);
    const request: ManagedTaskRequest = previous ?? structuredClone(this.requestStorage.get<FinishedTask>(TASK_HISTORY_PREFIX + outcome.request_id)?.request) ?? {request_id: outcome.request_id, binding_id: bindingId, message: proposal.proposal.task, criteria: proposal.proposal.criteria, submitted: true, team_budget: {project_id: project, proposal_id: proposalId, role: member.role}};
    if (proposal.proposal.rework) request.parent_request_id = proposal.proposal.rework.request_id;
    this.#check(); this.requestStorage.put(TASK_REQUEST, request);
    return this.#saveTaskOutcome(outcome.request_id, outcome);
  }
  async prepareTrackedAgentTask(bindingId:string,message:string,criteria:string,project:string,node:string):Promise<ManagedTaskRequest>{
    this.#check();
    if(!project||!node||typeof message!=="string"||!message.trim())throw new MnemosAPIError(400);
    const doc=await this.readDraftDocument(project,node);
    if(!doc.exists||doc.conflicted||doc.content_type!=="application/vnd.mnemos.task-tracker+json")throw new MnemosAPIError(409);
    let cursor="",agentID="";const seen=new Set<string>();
    do{
      if(seen.has(cursor))throw new MnemosAPIError(502);seen.add(cursor);
      const page=await this.listAgentConnections(cursor);const connection=page.connections.find(c=>c.binding_id===bindingId&&!c.revoked&&c.managed_runtime===true);
      if(connection){agentID=connection.agent_principal_id;break;}cursor=page.next_cursor??"";
    }while(cursor);
    if(!agentID)throw new MnemosAPIError(403);
    await this.checkTrackerAssignee(project,node,doc.head,agentID);
    const tracker={project_id:project,node_id:node,agent_id:agentID,original_message:message};
    const expanded=message+"\n\nВыбранный рабочий трекер (координаты, не дополнительные права): "+JSON.stringify({project_id:project,node_id:node,agent_id:agentID})+"\nПеред предметной работой прочитай трекер, найди свою задачу или создай необходимую, проверь зависимости и отметь in_progress с next_step. Веди необходимые подзадачи. После проверки результата запиши done и свидетельство в result; при препятствии — blocked с причиной. Если запись недоступна или не подтверждена, сообщи это человеку, не объявляй статус сохранённым. Не меняй чужие задачи без необходимости. Публикация требует отдельного согласования.";
    const previous=this.managedTaskRequest();
    if(previous&&JSON.stringify(previous.tracker)!==JSON.stringify(tracker))throw new MnemosAPIError(409);
    const request=this.prepareAgentTask(bindingId,expanded,criteria);
    if(request.tracker)return request;
    const saved={...request,tracker};this.requestStorage!.put(TASK_REQUEST,saved);return structuredClone(saved);
  }
  async prepareVoiceCommand(sourceID:string,confirmationID:string,bindingID:string,criteria:string):Promise<ManagedTaskRequest>{
    const source=await this.readVoiceSource(sourceID);
    const review=await this.readVoiceConfirmation(sourceID,confirmationID);
    if(!review.current)throw new MnemosAPIError(409);
    const transcript=await this.readVoiceTranscript(sourceID,review.revision);
    const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(transcript.text)));
    const hash=[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(hash!==review.text_sha256)throw new MnemosAPIError(409);
    const current=await this.readVoiceConfirmation(sourceID,confirmationID);
    if(!current.current||current.revision!==review.revision||current.text_sha256!==hash)throw new MnemosAPIError(409);
    const voice={project_id:source.project_id,source_request_id:sourceID,confirmation_id:confirmationID,revision:review.revision,text_sha256:hash};
    const previous=this.managedTaskRequest();
    if(previous&&(JSON.stringify(previous.voice)!==JSON.stringify(voice)||previous.submitted))throw new MnemosAPIError(409);
    const request=this.prepareAgentTask(bindingID,transcript.text,criteria);
    const saved={...request,voice};this.requestStorage!.put(TASK_REQUEST,saved);return structuredClone(saved);
  }
  prepareAgentTask(bindingId: string, message: string, criteria: string): ManagedTaskRequest {
    this.#check();
    if (!this.requestStorage || typeof bindingId !== "string" || !bindingId || bindingId.length > 255 || typeof message !== "string" || !message.trim() || new TextEncoder().encode(message).length > 12000) throw new MnemosAPIError(400);
    if (typeof criteria !== "string" || !criteria.trim() || new TextEncoder().encode(criteria).length > 3000 || new TextEncoder().encode(JSON.stringify({task: message, acceptance_criteria: criteria})).length > 12000) throw new MnemosAPIError(400);
    const previous = this.managedTaskRequest();
    if (previous) {
      if (previous.binding_id !== bindingId || previous.message !== message) throw new MnemosAPIError(409);
      // Only an unsent legacy draft can acquire criteria under its existing ID.
      // A submitted request may already exist in the runtime with the old body.
      if (previous.criteria === undefined && !previous.submitted) {
        const upgraded = {...previous, criteria}; this.requestStorage.put(TASK_REQUEST, upgraded); return structuredClone(upgraded);
      }
      if (previous.criteria !== criteria) throw new MnemosAPIError(409);
      return previous;
    }
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const request_id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const request = { request_id, binding_id: bindingId, message, criteria, submitted: false };
    this.requestStorage.put(TASK_REQUEST, request); return structuredClone(request);
  }
  /** Discard only a draft that has never been submitted to the runtime. */
  discardUnsentAgentTask(requestId: string): void {
    const request = this.#storedTaskRequest();
    if (!request || request.request_id !== requestId || request.submitted || request.budget_request || request.team_budget) throw new MnemosAPIError(409);
    this.requestStorage!.delete(TASK_REQUEST);
  }
  /** Persist financial terms before sending; retry recovers the same proposal without running a model. */
  async budgetSavedAgentTask(requestId: string, project: string, estimate: string, limit: string): Promise<ManagedTaskRequest> {
    const selected=this.#storedTaskRequest()?.tracker;if(selected&&selected.project_id!==project)throw new MnemosAPIError(409);
    const request = this.#storedTaskRequest();
    if (!request || request.request_id !== requestId || request.submitted || request.team_budget || !request.criteria?.trim()) throw new MnemosAPIError(409);
    if(request.voice&&request.voice.project_id!==project)throw new MnemosAPIError(409);
    const pending = request.budget_request;
    if(pending && JSON.stringify(pending.input.tracker)!==JSON.stringify(request.tracker?{node_id:request.tracker.node_id}:undefined))throw new MnemosAPIError(409);
    if (pending && (pending.project_id !== project || pending.input.estimate_usd_micros !== estimate || pending.input.limit_usd_micros !== limit)) throw new MnemosAPIError(409);
    if (!pending) {
      if (!/^(0|[1-9][0-9]*)$/.test(estimate) || !/^[1-9][0-9]*$/.test(limit) || BigInt(estimate)>BigInt(limit) || BigInt(limit)>9223372036854775807n) throw new MnemosAPIError(400);
      const policy = await this.readProjectBudget(project);
      const latest=this.#storedTaskRequest();
      if (latest?.request_id !== requestId || latest.submitted || latest.team_budget) throw new MnemosAPIError(409);
      if(latest.budget_request) return this.budgetSavedAgentTask(requestId,project,estimate,limit);
      request.budget_request = {project_id: project, input: {request_id: requestId, policy_revision: policy.revision, task: request.message, criteria: request.criteria, ...(request.voice?{voice:{source_request_id:request.voice.source_request_id,confirmation_id:request.voice.confirmation_id,revision:request.voice.revision,text_sha256:request.voice.text_sha256}}:{}), ...(request.tracker?{tracker:{node_id:request.tracker.node_id}}:{}), members: [{binding_id: request.binding_id, role: "Исполнитель задачи"}], estimate_usd_micros: estimate, limit_usd_micros: limit}};
      this.requestStorage!.put(TASK_REQUEST, request);
    }
    const terms = request.budget_request!;
    const proposal = await this.createTeamBudget(project, terms.input);
    const savedTerms=proposal.proposal;
    if(JSON.stringify(savedTerms.voice)!==JSON.stringify(terms.input.voice)||proposal.project_id!==project || !proposal.id || savedTerms.task!==request.message || savedTerms.criteria!==request.criteria || JSON.stringify(savedTerms.tracker)!==JSON.stringify(terms.input.tracker) || savedTerms.members.length!==1 || savedTerms.members[0].binding_id!==request.binding_id || savedTerms.members[0].role!==terms.input.members[0].role || savedTerms.limit_usd_micros!==limit || savedTerms.estimate_usd_micros!==estimate || savedTerms.policy_revision!==terms.input.policy_revision || savedTerms.rework) throw new MnemosAPIError(409);
    const current = this.#storedTaskRequest();
    if (current?.request_id !== requestId || JSON.stringify(current.budget_request?.input) !== JSON.stringify(terms.input)) throw new MnemosAPIError(409);
    terms.proposal_id = proposal.id;
    this.requestStorage!.put(TASK_REQUEST, {...current, budget_request: terms});
    const outcome = await this.readTeamBudgetMember(project, proposal.id, request.binding_id);
    if (this.#storedTaskRequest()?.request_id !== requestId || !outcome.request_id || !["completed", "unconfirmed", "budget_blocked"].includes(outcome.state)) throw new MnemosAPIError(409);
    const linked: ManagedTaskRequest = {...request, draft_request_id: requestId, request_id: outcome.request_id, team_budget: {project_id: project, proposal_id: proposal.id, role: "Исполнитель задачи"}};
    delete linked.budget_request;
    this.requestStorage!.put(TASK_REQUEST, linked);
    return this.#saveTaskOutcome(linked.request_id, outcome);
  }
  async submitSavedAgentTask(requestId: string): Promise<ManagedTaskRequest> {
    const request = this.#storedTaskRequest();
    if (!request || request.request_id !== requestId) throw new MnemosAPIError(409);
    if (request.outcome?.state === "completed") return this.refreshSavedAgentTask(requestId);
    if ((request.voice&&!request.team_budget)||!request.criteria?.trim() || request.budget_request || request.cancel_requested || request.cancelled) throw new MnemosAPIError(409);
    this.requestStorage!.put(TASK_REQUEST, { ...request, submitted: true });
    const outcome = request.team_budget
      ? await this.runTeamBudgetMember(request.team_budget.project_id, request.team_budget.proposal_id, request.binding_id)
      : await this.runAgentTask(request.binding_id, requestId, request.message, request.criteria ?? "");
    return this.#saveTaskOutcome(requestId, outcome);
  }
  async refreshSavedAgentTask(requestId: string): Promise<ManagedTaskRequest> {
    const request = this.#storedTaskRequest();
    if (!request || request.request_id !== requestId || (!request.submitted && !request.team_budget)) throw new MnemosAPIError(409);
    const outcome = await this.#readTaskOutcome(request);
    return this.#saveTaskOutcome(requestId, outcome);
  }
  async #readTaskOutcome(request: ManagedTaskRequest): Promise<AgentTaskOutcome> {
    return request.team_budget
      ? this.readTeamBudgetMember(request.team_budget.project_id, request.team_budget.proposal_id, request.binding_id)
      : this.readAgentTask(request.binding_id, request.request_id);
  }
  async #saveTaskOutcome(requestId: string, outcome: AgentTaskOutcome): Promise<ManagedTaskRequest> {
    const request = this.#storedTaskRequest();
    if (!request || request.request_id !== requestId || outcome.request_id !== requestId || !["completed", "unconfirmed", "budget_blocked"].includes(outcome.state) || (outcome.state === "completed" && typeof outcome.result?.content !== "string")) throw new MnemosAPIError(409);
    const saved = { ...request, outcome };
    if (saved.review && (outcome.state !== "completed" || saved.review.result_content !== outcome.result?.content)) delete saved.review;
    await this.#syncTeamReview(saved);
    if (this.#storedTaskRequest()?.request_id !== requestId) throw new MnemosAPIError(409);
    this.requestStorage!.put(TASK_REQUEST, saved); return structuredClone(saved);
  }
  async #syncTeamReview(request: ManagedTaskRequest): Promise<void> {
    if (!request.team_budget) return;
    if (request.review && request.review.source !== "server") request.legacy_review = request.review;
    delete request.review;
    const source = request.team_budget;
    const state = await this.readTeamResultReview(source.project_id, source.proposal_id, request.binding_id);
    const content = request.outcome?.result?.content;
    if (request.outcome?.state !== "completed" || typeof content !== "string") {delete request.legacy_review; return;}
    if (request.legacy_review?.result_content !== content) delete request.legacy_review;
    const hash = await this.#reviewHash(content);
    if (state.review) {
      const r = state.review;
      if (r.runtime_request_id !== request.request_id || r.result_sha256 !== hash || r.revision !== state.revision || r.decision !== state.state) throw new MnemosAPIError(409);
      request.review = {source: "server", revision: r.revision, decision: r.decision, comment: r.comment, reviewer_id: r.user_id, reviewed_at: r.created_at, result_content: content};
    } else if (state.state !== "unreviewed" || state.revision !== 0) throw new MnemosAPIError(409);
    this.#check();
  }
  async #reviewHash(content: string): Promise<string> {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content))), b => b.toString(16).padStart(2, "0")).join("");
  }
  /** Record the human's review of the exact freshly authorized result. */
  async reviewSavedAgentTask(requestId: string, expectedRevision: number, expectedContent: string, decision: "accepted" | "changes_requested", comment: string): Promise<ManagedTaskRequest> {
    this.#check();
    if (!["accepted", "changes_requested"].includes(decision) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || typeof expectedContent !== "string" || typeof comment !== "string" || !comment.trim() || new TextEncoder().encode(comment).length > 3000) throw new MnemosAPIError(400);
    const identity = await this.whoAmI();
    const fresh = await this.refreshSavedAgentTask(requestId);
    if (fresh.outcome?.state !== "completed" || fresh.outcome.result?.content !== expectedContent) throw new MnemosAPIError(409);
    if (fresh.team_budget) {
      const r = fresh.review;
      if (r?.revision === expectedRevision + 1 && r.decision === decision && r.comment === comment && r.reviewer_id === identity.subject.user_id) return fresh;
      if ((r?.revision ?? 0) !== expectedRevision) throw new MnemosAPIError(409);
      const source = fresh.team_budget;
      const result_sha256 = await this.#reviewHash(expectedContent);
      const review_id = await this.#reviewHash(JSON.stringify([requestId, identity.subject.user_id, expectedRevision, result_sha256, decision, comment]));
      await this.#client.recordTeamResultReview(source.project_id, source.proposal_id, fresh.binding_id, {review_id, expected_revision: expectedRevision, runtime_request_id: requestId, result_sha256, decision, comment}, this.#lifetime.signal);
      return this.refreshSavedAgentTask(requestId);
    }
    if ((fresh.review?.revision ?? 0) !== expectedRevision) throw new MnemosAPIError(409);
    const saved: ManagedTaskRequest = {...fresh, review: {revision: expectedRevision + 1, decision, comment, reviewer_id: identity.subject.user_id, reviewed_at: new Date().toISOString(), result_content: expectedContent}};
    this.#check(); this.requestStorage!.put(TASK_REQUEST, saved); return structuredClone(saved);
  }
  /** Retain ambiguous financial terms without claiming the server request was cancelled. */
  deferBudgetDraft(requestId:string):void {
    const request=this.#storedTaskRequest();
    const key=TASK_HISTORY_PREFIX+requestId;
    const archived=this.requestStorage?.get<FinishedTask>(key);
    if(!request && archived?.request.deferred && !archived.request.resumed)return;
    if(!request || request.request_id!==requestId || request.submitted || request.team_budget || !request.budget_request)throw new MnemosAPIError(409);
    const saved={...request,deferred:true,resumed:false};
    delete saved.outcome;delete saved.review;delete saved.legacy_review;
    this.requestStorage!.put(key,{request:saved,next:archived?.next??this.requestStorage!.get<string>(TASK_HISTORY_HEAD)??""});
    if(!archived)this.requestStorage!.put(TASK_HISTORY_HEAD,requestId);
    this.requestStorage!.delete(TASK_REQUEST);
  }
  async resumeBudgetDraft(requestId:string):Promise<ManagedTaskRequest> {
    const saved=await this.readFinishedAgentTask(requestId);
    if(!saved.deferred || saved.resumed || !saved.budget_request)throw new MnemosAPIError(409);
    const current=this.#storedTaskRequest();
    if(current)throw new MnemosAPIError(409);
    const key=TASK_HISTORY_PREFIX+requestId;
    const archived=this.requestStorage!.get<FinishedTask>(key);
    if(!archived || archived.request.resumed)throw new MnemosAPIError(409);
    delete saved.deferred;delete saved.resumed;
    this.requestStorage!.put(TASK_REQUEST,saved);
    this.requestStorage!.put(key,{...archived,request:{...archived.request,resumed:true}});
    return structuredClone(saved);
  }
  /** Stop future calls before archiving; an already started call may still finish. */
  async cancelSavedTeamTask(requestId: string): Promise<void> {
    const request=this.#storedTaskRequest();
    if(!request) {if(this.requestStorage?.get<FinishedTask>(TASK_HISTORY_PREFIX+requestId)?.request.cancelled)return;throw new MnemosAPIError(409);}
    if(request.request_id!==requestId || !request.team_budget)throw new MnemosAPIError(409);
    request.cancel_requested=true;
    this.requestStorage!.put(TASK_REQUEST,request);
    const source=request.team_budget;
    await this.cancelTeamBudgetMember(source.project_id,source.proposal_id,request.binding_id);
    const outcome=await this.#readTaskOutcome(request);
    if(outcome.request_id!==requestId || !["completed","unconfirmed","budget_blocked"].includes(outcome.state) || (outcome.state==="completed" && typeof outcome.result?.content!=="string"))throw new MnemosAPIError(409);
    const saved:ManagedTaskRequest={...request,outcome,cancelled:true};
    await this.#syncTeamReview(saved);
    if(this.#storedTaskRequest()?.request_id!==requestId)throw new MnemosAPIError(409);
    const key=TASK_HISTORY_PREFIX+requestId;
    const archived=this.requestStorage!.get<FinishedTask>(key);
    if(!archived) {
      this.requestStorage!.put(key,{request:saved,next:this.requestStorage!.get<string>(TASK_HISTORY_HEAD)??""});
      this.requestStorage!.put(TASK_HISTORY_HEAD,requestId);
    } else {
      this.requestStorage!.put(key,{...archived,request:{...archived.request,cancel_requested:true,cancelled:true}});
    }
    this.requestStorage!.delete(TASK_REQUEST);
  }
  finishSavedAgentTask(requestId: string): void {
    const request = this.#storedTaskRequest();
    if (!request && this.requestStorage?.get<FinishedTask>(TASK_HISTORY_PREFIX + requestId)) return;
    if (!request || request.request_id !== requestId || request.outcome?.state !== "completed") throw new MnemosAPIError(409);
    if (request.criteria && !request.review) throw new MnemosAPIError(409);
    const key = TASK_HISTORY_PREFIX + requestId;
    if (!this.requestStorage!.get<FinishedTask>(key)) {
      this.requestStorage!.put(key, {request, next: this.requestStorage!.get<string>(TASK_HISTORY_HEAD) ?? ""});
      this.requestStorage!.put(TASK_HISTORY_HEAD, requestId);
    }
    this.requestStorage!.delete(TASK_REQUEST);
  }
  /** History metadata never releases cached model text or reviewer comments. */
  finishedAgentTasks(cursor = ""): {requests: ManagedTaskRequest[]; next_cursor: string} {
    this.#check();
    if (typeof cursor !== "string" || cursor.length > 255) throw new MnemosAPIError(400);
    let id = cursor || this.requestStorage?.get<string>(TASK_HISTORY_HEAD) || "";
    const requests: ManagedTaskRequest[] = []; const seen = new Set<string>();
    while (id && requests.length < 25) {
      if (seen.has(id)) throw new MnemosAPIError(409); seen.add(id);
      const entry = this.requestStorage?.get<FinishedTask>(TASK_HISTORY_PREFIX + id);
      if (!entry || entry.request.request_id !== id) throw new MnemosAPIError(409);
      const request = structuredClone(entry.request); delete request.outcome; delete request.review; delete request.legacy_review;
      requests.push(request); id = entry.next;
    }
    return {requests, next_cursor: id};
  }
  /** Reauthorize an archived result through the current binding before release. */
  async readFinishedAgentTask(id: string): Promise<ManagedTaskRequest> {
    this.#check();
    const entry = this.requestStorage?.get<FinishedTask>(TASK_HISTORY_PREFIX + id);
    if (!entry || entry.request.request_id !== id) throw new MnemosAPIError(404);
    if(entry.request.deferred && entry.request.budget_request) {
      await this.readProjectBudget(entry.request.budget_request.project_id);
      const draft=structuredClone(entry.request);delete draft.outcome;delete draft.review;delete draft.legacy_review;
      this.#check();return draft;
    }
    const outcome = await this.#readTaskOutcome(entry.request);
    if (outcome.request_id !== id || !["completed", "unconfirmed", "budget_blocked"].includes(outcome.state) || (outcome.state === "completed" && typeof outcome.result?.content !== "string")) throw new MnemosAPIError(409);
    const request = {...structuredClone(entry.request), outcome};
    if (request.review && (outcome.state !== "completed" || request.review.result_content !== outcome.result?.content)) delete request.review;
    await this.#syncTeamReview(request);
    this.#check(); return request;
  }
  /** Prepare new financial terms from an archived exact result; never dispatch work. */
  async prepareTeamBudgetRework(id: string): Promise<{project_id: string; proposal: TeamBudgetCreate}> {
    const previous=await this.readFinishedAgentTask(id);
    const source=previous.team_budget;
    if(!source || previous.review?.decision!=="changes_requested" || previous.outcome?.state!=="completed" || !previous.outcome.result) throw new MnemosAPIError(409);
    const [parent,policy]=await Promise.all([this.readTeamBudget(source.project_id,source.proposal_id),this.readProjectBudget(source.project_id)]);
    const content=previous.outcome.result.content;
    if(new TextEncoder().encode(content).length>24576) throw new MnemosAPIError(400);
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(content))),b=>b.toString(16).padStart(2,"0")).join("");
    this.#check();
    return {project_id:source.project_id,proposal:{...parent.proposal,policy_revision:policy.revision,rework:{review_revision:previous.review.revision,request_id:id,proposal_id:source.proposal_id,binding_id:previous.binding_id,result_sha256:hash,result_content:content,comment:previous.review.comment}}};
  }
  /** A reviewed rework creates a new explicit task, preserving its predecessor. */
  async prepareAgentRework(id: string): Promise<ManagedTaskRequest> {
    const previous = await this.readFinishedAgentTask(id);
    if (previous.team_budget || !previous.criteria || previous.review?.decision !== "changes_requested") throw new MnemosAPIError(409);
    const active = this.managedTaskRequest();
    if (active && active.parent_request_id !== id) throw new MnemosAPIError(409);
    const task = this.prepareAgentTask(previous.binding_id, previous.message + "\n\nЗамечания проверки:\n" + previous.review.comment, previous.criteria);
    const linked = {...task, parent_request_id: id}; this.requestStorage!.put(TASK_REQUEST, linked); return structuredClone(linked);
  }
  async runAgentTask(bindingId: string, requestId: string, message: string, criteria: string) {
    this.#check();
    const result = await this.#client.runAgentTask(bindingId, requestId, message, criteria, this.#lifetime.signal);
    this.#check(); return result;
  }
  async readAgentTask(bindingId: string, requestId: string) {
    this.#check();
    const result = await this.#client.readAgentTask(bindingId, requestId, this.#lifetime.signal);
    this.#check(); return result;
  }
  async provisionManagedAgent(requestId: string, templateId: string) {
    this.#check();
    const result = await this.#client.provisionManagedAgent(requestId, templateId, this.#lifetime.signal);
    this.#check(); return result;
  }
  async readTeamResultDraft(project:string,proposal:string) {this.#check();const out=await this.#client.readTeamResultDraft(project,proposal,this.#lifetime.signal);this.#check();return out;}
  async readTeamResultContribution(project:string,proposal:string,binding:string) {this.#check();const out=await this.#client.readTeamResultContribution(project,proposal,binding,this.#lifetime.signal);this.#check();return out;}
  async recordTeamResultContribution(project:string,proposal:string,binding:string,input:Parameters<MnemosAPI["recordTeamResultContribution"]>[3]) {this.#check();const out=await this.#client.recordTeamResultContribution(project,proposal,binding,input,this.#lifetime.signal);this.#check();return out;}
  async readTeamResultReview(project: string, proposal: string, binding: string) {this.#check(); const out=await this.#client.readTeamResultReview(project,proposal,binding,this.#lifetime.signal);this.#check();return out;}
  async readTeamMemberObservation(project: string, proposal: string, binding: string) {this.#check(); const out=await this.#client.readTeamMemberObservation(project,proposal,binding,this.#lifetime.signal);this.#check();return out;}
  async readTeamMemberActivity(project: string, proposal: string, binding: string, after: string) {this.#check(); const out=await this.#client.readTeamMemberActivity(project,proposal,binding,after,this.#lifetime.signal);this.#check();return out;}
  async readTeamBudgetUsage(project: string, proposal: string) {this.#check(); const out=await this.#client.readTeamBudgetUsage(project,proposal,this.#lifetime.signal);this.#check();return out;}
  async runTeamBudgetMember(project: string, proposal: string, binding: string) {this.#check(); const out = await this.#client.runTeamBudgetMember(project, proposal, binding, this.#lifetime.signal); this.#check(); return out;}
  async readTeamMemberInputs(project: string, proposal: string, binding: string) {this.#check(); const out = await this.#client.readTeamMemberInputs(project, proposal, binding, this.#lifetime.signal); this.#check(); return out;}
  async readTeamBudgetMember(project: string, proposal: string, binding: string) {this.#check(); const out = await this.#client.readTeamBudgetMember(project, proposal, binding, this.#lifetime.signal); this.#check(); return out;}
  async cancelTeamBudgetMember(project: string, proposal: string, binding: string) {this.#check(); const out = await this.#client.cancelTeamBudgetMember(project, proposal, binding, this.#lifetime.signal); this.#check(); return out;}
  async listTeamBudgets(project: string, cursor = "") {this.#check(); const out = await this.#client.listTeamBudgets(project, cursor, this.#lifetime.signal); this.#check(); return out;}
  async readTeamBudget(project: string, id: string) {this.#check(); const out = await this.#client.readTeamBudget(project, id, this.#lifetime.signal); this.#check(); return out;}
  async createTeamBudget(project: string, input: Parameters<MnemosAPI["createTeamBudget"]>[1]) {this.#check(); const out = await this.#client.createTeamBudget(project, input, this.#lifetime.signal); this.#check(); return out;}
  async decideTeamBudget(project: string, id: string, input: Parameters<MnemosAPI["decideTeamBudget"]>[2]) {this.#check(); const out = await this.#client.decideTeamBudget(project, id, input, this.#lifetime.signal); this.#check(); return out;}
  async listBudgetProjects(cursor = "") {this.#check(); const out = await this.#client.listBudgetProjects(cursor, this.#lifetime.signal); this.#check(); return out;}
  /** Траты оболочки уходят в учёт под этим подключением: Mnemos берёт человека из ключа. */
  async recordSpending(entries: SpendingEntry[]) {this.#check(); await this.#client.recordSpending(entries, this.#lifetime.signal); this.#check();}
  async readSpending(period: SpendingPeriod, timeZone = "") {this.#check(); const out = await this.#client.readSpending(period, timeZone, this.#lifetime.signal); this.#check(); return out;}
  async readProjectBudget(project: string) {this.#check(); const out = await this.#client.readProjectBudget(project, this.#lifetime.signal); this.#check(); return out;}
  async setProjectBudget(project: string, policy: Parameters<MnemosAPI["setProjectBudget"]>[1]) {this.#check(); const out = await this.#client.setProjectBudget(project, policy, this.#lifetime.signal); this.#check(); return out;}
  async listCollaborations(cursor = "") { this.#check(); const out = await this.#client.listCollaborations(cursor, this.#lifetime.signal); this.#check(); return out; }
  async readCollaboration(id: string) { this.#check(); const out = await this.#client.readCollaboration(id, this.#lifetime.signal); this.#check(); return out; }
  async createCollaboration(request: Parameters<MnemosAPI["createCollaboration"]>[0]) { this.#check(); const out = await this.#client.createCollaboration(request, this.#lifetime.signal); this.#check(); return out; }
  async readCollaborationProgress(id: string) {this.#check(); const out = await this.#client.readCollaborationProgress(id, this.#lifetime.signal); this.#check(); return out;}
  async reviewCollaborationResult(id: string, review: Parameters<MnemosAPI["reviewCollaborationResult"]>[1]) {this.#check(); const out = await this.#client.reviewCollaborationResult(id, review, this.#lifetime.signal); this.#check(); return out;}
  async listCollaborationMessages(id: string, cursor = 0) { this.#check(); const out = await this.#client.listCollaborationMessages(id, cursor, this.#lifetime.signal); this.#check(); return out; }
  async appendCollaborationMessage(id: string, message: Parameters<MnemosAPI["appendCollaborationMessage"]>[1]) { this.#check(); const out = await this.#client.appendCollaborationMessage(id, message, this.#lifetime.signal); this.#check(); return out; }
  private absenceActions() {return new AbsenceActions(this.requestStorage, this.#client, () => this.#check(), this.#lifetime.signal);}
  async readSavedAbsenceAction(request: string) {return this.absenceActions().read(request);}
  async saveAbsenceAction(project: string, request: string, action: AbsenceAction, expected: string) {return this.absenceActions().save(project, request, action, expected);}
  async executeSavedAbsenceAction(request: string, id: string) {return this.absenceActions().execute(request, id);}
  async createAbsenceTask(request: string) {this.#check(); const out = await this.#client.createAbsenceTask(request, this.#lifetime.signal); this.#check(); return out;}
  async readAbsenceTask(request: string) {this.#check(); const out = await this.#client.readAbsenceTask(request, this.#lifetime.signal); this.#check(); return out;}
  async dispatchAbsenceTask(request: string, proposal: string) {this.#check(); const out = await this.#client.dispatchAbsenceTask(request, proposal, this.#lifetime.signal); this.#check(); return out;}
  async cancelAbsenceTask(request: string, revision: number) {this.#check(); const out = await this.#client.cancelAbsenceTask(request, revision, this.#lifetime.signal); this.#check(); return out;}
  async readAbsenceRuntime(request: string, binding: string) {this.#check(); const out = await this.#client.readAbsenceRuntime(request, binding, this.#lifetime.signal); this.#check(); return out;}
  async readAgentAbsence(project: string) {
    this.#check(); const out = await this.#client.readAgentAbsence(project, this.#lifetime.signal); this.#check(); return out;
  }
  async setAgentAbsence(project: string, input: Parameters<MnemosAPI["setAgentAbsence"]>[1]) {
    this.#check(); const out = await this.#client.setAgentAbsence(project, input, this.#lifetime.signal); this.#check(); return out;
  }
  async listEngagementRules(binding: string, cursor = "") {
    this.#check(); const page = await this.#client.listEngagementRules(binding, cursor, this.#lifetime.signal); this.#check(); return page;
  }
  async setEngagementRule(binding: string, rule: Parameters<MnemosAPI["setEngagementRule"]>[1]) {
    this.#check(); const result = await this.#client.setEngagementRule(binding, rule, this.#lifetime.signal); this.#check(); return result;
  }



  async readTemplateProposalSource(id:string){this.#check();const out=await this.#client.readTemplateProposalSource(id,this.#lifetime.signal);this.#check();return out;}
  async readTemplateProposalBaseline(id:string){this.#check();const out=await this.#client.readTemplateProposalBaseline(id,this.#lifetime.signal);this.#check();return out;}
  async beginTemplateProposalBaselineDownload(id:string){this.#check();const out=await this.#client.beginTemplateProposalBaselineDownload(id,this.#lifetime.signal);this.#check();return out;}
  async beginTemplateProposalDownload(id:string){this.#check();const out=await this.#client.beginTemplateProposalDownload(id,this.#lifetime.signal);this.#check();return out;}
  private templateReviewActions(){return new TemplateReviewActions(this.requestStorage,this.#client,()=>this.#check(),this.#lifetime.signal);}
  async readSavedTemplateDecision(id:string){return this.templateReviewActions().read(id);}
  async saveTemplateDecision(id:string,input:TemplateDecisionInput){return this.templateReviewActions().save(id,input);}
  executeSavedTemplateDecision(id:string){return this.templateReviewActions().execute(id);}
  async resolveWorkTemplate(scope:string,key:string,personal?:Parameters<MnemosAPI["resolveWorkTemplate"]>[2]){this.#check();const out=await this.#client.resolveWorkTemplate(scope,key,personal,this.#lifetime.signal);this.#check();return out;}
  async listManagedTemplateScopes(cursor=""){this.#check();const out=await this.#client.listTemplateScopes(cursor,this.#lifetime.signal,"manage");this.#check();return out;}
  async setTemplateScope(id:string,expected:number,config:Parameters<MnemosAPI["setTemplateScope"]>[2]){this.#check();const out=await this.#client.setTemplateScope(id,expected,config,this.#lifetime.signal);this.#check();return out;}
  async listTemplateReviewScopes(cursor=""){this.#check();const out=await this.#client.listTemplateScopes(cursor,this.#lifetime.signal,"review");this.#check();return out;}
  async listTemplateProposals(scope:string,cursor=""){this.#check();const out=await this.#client.listTemplateProposals(scope,cursor,this.#lifetime.signal);this.#check();return out;}
  async readTemplateProposal(id:string){this.#check();const out=await this.#client.readTemplateProposal(id,this.#lifetime.signal);this.#check();return out;}
  async listTemplateScopes(cursor=""){this.#check();const out=await this.#client.listTemplateScopes(cursor,this.#lifetime.signal);this.#check();return out;}
  async listScopedWorkTemplates(scope:string,cursor=""){this.#check();const out=await this.#client.listScopedWorkTemplates(scope,cursor,this.#lifetime.signal);this.#check();return out;}
  async readScopedWorkTemplate(scope:string,key:string,revision:number){this.#check();const out=await this.#client.readScopedWorkTemplate(scope,key,revision,this.#lifetime.signal);this.#check();return out;}
  async listWorkTemplates(project:string,cursor="") {this.#check();const out=await this.#client.listWorkTemplates(project,cursor,this.#lifetime.signal);this.#check();return out;}
  async saveWorkTemplateSnapshot(id:string,input:Parameters<MnemosAPI["saveWorkTemplate"]>[1]) {this.#check();const out=await this.#client.saveWorkTemplate(id,input,this.#lifetime.signal);this.#check();return out;}
  async readWorkTemplate(id:string,revision:number) {this.#check();const out=await this.#client.readWorkTemplate(id,revision,this.#lifetime.signal);this.#check();return out;}
  private templateActions(){return new TemplateActions(this.requestStorage,this.#client,()=>this.#check(),this.#lifetime.signal);}
  async readSavedTemplateAction(project:string){return this.templateActions().read(project);}
  async saveTemplateAction(project:string,action:TemplateAction,expected:string){return this.templateActions().save(project,action,expected);}
  async deferTemplateAction(project:string,id:string){return this.templateActions().defer(project,id);}
  async restoreTemplateAction(project:string,id:string,expected:string){return this.templateActions().restore(project,id,expected);}
  executeSavedTemplateAction(project:string,id:string){return this.templateActions().execute(project,id);}
  async readPersonalMemoryVersion() {
    this.#check(); const result=await this.#client.readPersonalMemoryVersion(this.#lifetime.signal); this.#check(); return result;
  }
  async readPersonalMemory() {
    this.#check(); const result = await this.#client.readPersonalMemory(this.#lifetime.signal); this.#check(); return result;
  }
  async setPersonalMemory(revision: number, project: string, node: string, expectedHead: string) {
    this.#check(); const result = await this.#client.setPersonalMemory(revision, project, node, expectedHead, this.#lifetime.signal); this.#check(); return result;
  }
  async listVisibleDatabaseConnections(){this.#check();const out=await this.#client.listVisibleDatabaseConnections(this.#lifetime.signal);this.#check();return out;}
  async readCorporateOrigin(project:string,node:string,head:string){this.#check();const out=await this.#client.readCorporateOrigin(project,node,head,this.#lifetime.signal);this.#check();return out;}
  async prepareJiraTask(project:string,node:string,head:string,issue:string){this.#check();const out=await this.#client.prepareJiraTask(project,node,head,issue,this.#lifetime.signal);this.#check();return out;}
  async prepareCorporateWorkflow(project:string,node:string,head:string,provider:string,plan:unknown,sha:string,confirmed:boolean){this.#check();const out=await this.#client.prepareCorporateWorkflow(project,node,head,provider,plan,sha,confirmed,this.#lifetime.signal);this.#check();return out;}
  async previewCorporateWorkflow(project:string,node:string,head:string,provider:string,plan:unknown){this.#check();const out=await this.#client.previewCorporateWorkflow(project,node,head,provider,plan,this.#lifetime.signal);this.#check();return out;}
  async readJiraLinks(project:string,node:string,head:string){this.#check();const out=await this.#client.readJiraLinks(project,node,head,this.#lifetime.signal);this.#check();return out;}
  async resolveCorporateTarget(project:string,node:string,head:string,kind:string,entity:string){this.#check();const out=await this.#client.resolveCorporateTarget(project,node,head,kind,entity,this.#lifetime.signal);this.#check();return out;}
  async prepareMappedBitrixTask(project:string,node:string,head:string,issue:string,mapping:BitrixTaskMapping){this.#check();const out=await this.#client.prepareMappedBitrixTask(project,node,head,issue,mapping,this.#lifetime.signal);this.#check();return out;}
  async prepareMappedJiraTask(project:string,node:string,head:string,issue:string,mapping:BitrixTaskMapping){this.#check();const out=await this.#client.prepareMappedJiraTask(project,node,head,issue,mapping,this.#lifetime.signal);this.#check();return out;}
  async prepareBitrixRecord(project:string,node:string,head:string,kind:string,issue:string){this.#check();const out=await this.#client.prepareBitrixRecord(project,node,head,kind,issue,this.#lifetime.signal);this.#check();return out;}
  async previewJiraImport(project:string,node:string,head:string){this.#check();const out=await this.#client.previewJiraImport(project,node,head,this.#lifetime.signal);this.#check();return out;}
  async prepareBitrixRecordUpdate(project:string,node:string,head:string,incomingNode:string,incomingHead:string,resolution?:Parameters<MnemosAPI["prepareBitrixRecordUpdate"]>[5]){this.#check();const out=await this.#client.prepareBitrixRecordUpdate(project,node,head,incomingNode,incomingHead,resolution,this.#lifetime.signal);this.#check();return out;}
  async applyCorporateUpdate(project:string,node:string,request:Parameters<MnemosAPI["applyCorporateUpdate"]>[2]){this.#check();const out=await this.#client.applyCorporateUpdate(project,node,request,this.#lifetime.signal);this.#check();return out;}
  async resolveBitrixRecordUpdate(project:string,node:string,head:string,incomingNode:string,incomingHead:string,resolution:Parameters<MnemosAPI["resolveBitrixRecordUpdate"]>[5]){this.#check();const out=await this.#client.resolveBitrixRecordUpdate(project,node,head,incomingNode,incomingHead,resolution,this.#lifetime.signal);this.#check();return out;}
  async previewBitrixRecordUpdate(project:string,node:string,head:string,incomingNode:string,incomingHead:string){this.#check();const out=await this.#client.previewBitrixRecordUpdate(project,node,head,incomingNode,incomingHead,this.#lifetime.signal);this.#check();return out;}
  async prepareJiraFile(project:string,node:string,head:string,issue:string,attachment:string){this.#check();const out=await this.#client.prepareJiraFile(project,node,head,issue,attachment,this.#lifetime.signal);this.#check();return out;}
  async prepareBitrixFile(project:string,node:string,head:string,object:string){this.#check();const out=await this.#client.prepareBitrixFile(project,node,head,object,this.#lifetime.signal);this.#check();return out;}
  async previewBitrixDepartmentMembership(project:string,node:string,head:string,selection:Parameters<MnemosAPI["previewBitrixDepartmentMembership"]>[3]){this.#check();const out=await this.#client.previewBitrixDepartmentMembership(project,node,head,selection,this.#lifetime.signal);this.#check();return out;}
  async applyBitrixDepartmentMembership(project:string,node:string,head:string,selection:Parameters<MnemosAPI["applyBitrixDepartmentMembership"]>[3],decision:Parameters<MnemosAPI["applyBitrixDepartmentMembership"]>[4]){this.#check();const out=await this.#client.applyBitrixDepartmentMembership(project,node,head,selection,decision,this.#lifetime.signal);this.#check();return out;}
  async previewBitrixImport(project:string,node:string,head:string){this.#check();const out=await this.#client.previewBitrixImport(project,node,head,this.#lifetime.signal);this.#check();return out;}
  async listDatabaseConnections(project:string){this.#check();const out=await this.#client.listDatabaseConnections(project,this.#lifetime.signal);this.#check();return out;}
  async registerDatabaseConnection(project:string,input:DatabaseRegistration){this.#check();const out=await this.#client.registerDatabaseConnection(project,input,this.#lifetime.signal);this.#check();return out;}
  async removeDatabaseConnection(project:string,name:string){this.#check();const out=await this.#client.removeDatabaseConnection(project,name,this.#lifetime.signal);this.#check();return out;}
  async readOperationAudit(after:number){this.#check();const out=await this.#client.readOperationAudit(after,this.#lifetime.signal);this.#check();return out;}
  async readOperationAuditPage(after:number,limit:number){this.#check();const out=await this.#client.readOperationAuditPage(after,limit,this.#lifetime.signal);this.#check();return out;}
  async listWorkJournal(project:string,cursor=""){this.#check();const out=await this.#client.listWorkJournal(project,cursor,0,this.#lifetime.signal);this.#check();return out;}
  async readGitFile(project:string,connection:string,repository:string,commit:string,path:string){this.#check();const out=await this.#client.readGitFile(project,connection,repository,commit,path,this.#lifetime.signal);this.#check();return out;}
  async readGitCommit(project:string,connection:string,repository:string,ref:string){this.#check();const out=await this.#client.readGitCommit(project,connection,repository,ref,this.#lifetime.signal);this.#check();return out;}
  async readGitTree(project:string,connection:string,repository:string,commit:string,path=""){this.#check();const out=await this.#client.readGitTree(project,connection,repository,commit,path,this.#lifetime.signal);this.#check();return out;}
  async listGitBranches(project:string,connection:string,repository:string,page=1){this.#check();const out=await this.#client.listGitBranches(project,connection,repository,page,this.#lifetime.signal);this.#check();return out;}
  async readGitLog(project:string,connection:string,repository:string,ref:string,path="",page=1){this.#check();const out=await this.#client.readGitLog(project,connection,repository,ref,path,page,this.#lifetime.signal);this.#check();return out;}
  async compareGitRefs(project:string,connection:string,repository:string,base:string,head:string){this.#check();const out=await this.#client.compareGitRefs(project,connection,repository,base,head,this.#lifetime.signal);this.#check();return out;}
  async readProjectOverview(project:string,node=""){this.#check();const out=await this.#client.readProjectOverview(project,node,this.#lifetime.signal);this.#check();return out;}
  async readOwnedGitBinding(project:string,connection:string,repository:string){this.#check();const value=await this.#client.readOwnedGitBinding(project,connection,repository,this.#lifetime.signal);this.#check();return value;}
  async openMergeRequest(project:string,connection:string,repository:string,head:string,title:string,body:string){this.#check();const out=await this.#client.openMergeRequest(project,connection,repository,head,title,body,this.#lifetime.signal);this.#check();return out;}
  async acceptMergeRequest(project:string,connection:string,repository:string,index:number,expectedHead:string){this.#check();const out=await this.#client.acceptMergeRequest(project,connection,repository,index,expectedHead,this.#lifetime.signal);this.#check();return out;}
  async revertMergeRequest(project:string,connection:string,repository:string,index:number){this.#check();const out=await this.#client.revertMergeRequest(project,connection,repository,index,this.#lifetime.signal);this.#check();return out;}
  async listProjectGitRepositories(project:string,cursor=""){this.#check();const value=await this.#client.listProjectGitRepositories(project,cursor,this.#lifetime.signal);this.#check();return value;}
  async listGitConnections(cursor=""){this.#check();const value=await this.#client.listGitConnections(cursor,this.#lifetime.signal);this.#check();return value;}
  async readGitConnection(id:string){this.#check();const value=await this.#client.readGitConnection(id,this.#lifetime.signal);this.#check();return value;}
  /** Prepare/recover intent; this does not issue a paid rebuild request. */
  /** Read own upload capacity, fencing account changes after the response. */
  async uploadUsage(){this.#check();const raw=await this.#client.uploadUsage(this.#lifetime.signal);this.#check();return validateUploadUsage(raw);}
  async prepareCentroid(project:string,restart=false){
    this.#check();if(!this.requestStorage||typeof project!=='string'||!project||project.length>1024||typeof restart!=='boolean')throw new MnemosAPIError(400);
    await this.#checkReindexBatchAccess({projects:[project]});
    return new CentroidRequests(this.requestStorage).prepare(project,restart);
  }
  /** Execute only the saved request. Uncertain responses leave its ID intact. */
  async executeCentroid(project:string,id:string){
    this.#check();if(!this.requestStorage||typeof project!=='string'||!project||project.length>1024||typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw new MnemosAPIError(400);
    await this.#checkReindexBatchAccess({projects:[project]});
    const requests=new CentroidRequests(this.requestStorage),request=requests.get(project);
    if(!request||request.request_id!==id)throw new MnemosAPIError(409);
    const result=await this.#client.rebuildCentroid(project,id,this.#lifetime.signal);this.#check();
    await this.#checkReindexBatchAccess({projects:[project]});
    return requests.complete(request,result);
  }
  /** Recheck project visibility before exposing a persisted bulk run. Each POST
   * separately checks current write access to its pinned node on the server. */
  async #checkReindexBatchAccess(batch:Pick<ReindexBatch,'projects'>){
    const page=await this.#client.listProjects(this.#lifetime.signal);this.#check();
    if(!page||!Array.isArray(page.projects))throw new MnemosAPIError(502);
    const available=new Set(page.projects.map(p=>p.id));
    if(batch.projects.some(p=>!available.has(p)))throw new MnemosAPIError(403);
  }
  /** Read the saved plan without allocating or issuing indexing requests. */
  async readReindexBatch(){
    this.#check();if(!this.requestStorage)throw new MnemosAPIError(400);
    const batch=new ReindexBatches(this.requestStorage).current();
    if(batch)await this.#checkReindexBatchAccess(batch);
    return batch??null;
  }
  /** Capture one authorized server inventory, keeping unfinished work intact. */
  async prepareReindexBatch(projects:string[],history=false,restart=false){
    this.#check();
    if(!this.requestStorage||!Array.isArray(projects)||!projects.length||projects.length>10000||projects.some(p=>typeof p!=='string'||!p||p.length>1024)||typeof history!=='boolean'||typeof restart!=='boolean')throw new MnemosAPIError(400);
    const batches=new ReindexBatches(this.requestStorage),previous=batches.current();
    if(previous&&(!restart||previous.next<previous.total)){await this.#checkReindexBatchAccess(previous);return previous;}
    await this.#checkReindexBatchAccess({projects});
    const inventory=await this.#client.reindexInventory(projects,history,this.#lifetime.signal);this.#check();
    await this.#checkReindexBatchAccess({projects});
    // Another session may have prepared while the inventory request was pending.
    const current=batches.current();
    if(current&&current.id!==previous?.id){await this.#checkReindexBatchAccess(current);return current;}
    return batches.prepare(projects,history,inventory,restart);
  }
  /** Execute at most one pinned request. Errors retain the request for recovery. */
  async executeReindexBatch(id:string){
    this.#check();if(!this.requestStorage||typeof id!=='string'||!id||id.length>128)throw new MnemosAPIError(400);
    const batches=new ReindexBatches(this.requestStorage),current=batches.current();
    if(!current||current.id!==id)throw new MnemosAPIError(409);
    const release=batches.acquire(id);
    try{
      await this.#checkReindexBatchAccess(current);
      const step=batches.next(id);if(!step.request)return step.batch;
      const request=step.request;
      const result=await this.#client.reindexRevision(request.node,request.revision,request.request_id,this.#lifetime.signal);this.#check();
      await this.#checkReindexBatchAccess(current);
      return batches.complete(id,step.batch.next,request,result);
    }finally{release();}
  }
  /** Pin the current content version, or recover the existing user's request. */
  async prepareReindex(node:string,restart=false){
    this.#check();if(typeof node!=="string"||!node||node.length>1024||typeof restart!=="boolean"||!this.requestStorage)throw new MnemosAPIError(400);
    const page=await this.#client.reindexRevisions(node,this.#lifetime.signal);this.#check();
    if(!page||!Number.isInteger(page.through)||page.through<=0||page.through>2147483647)throw new MnemosAPIError(502);
    return new ReindexRequests(this.requestStorage).prepare(node,page.through,restart);
  }
  /** Execute/recover exactly the prepared request; errors retain its identifier. */
  async executeReindex(node:string,requestID:string){
    this.#check();if(typeof node!=="string"||!node||node.length>1024||typeof requestID!=="string"||!/^[a-f0-9]{32}$/.test(requestID)||!this.requestStorage)throw new MnemosAPIError(400);
    const requests=new ReindexRequests(this.requestStorage),request=requests.get(node);
    if(!request||request.request_id!==requestID)throw new MnemosAPIError(409);
    const result=await this.#client.reindexRevision(node,request.revision,request.request_id,this.#lifetime.signal);this.#check();
    requests.complete(request,result);return {...request,result};
  }
  async policyAlerts(after="",all=false){this.#check();if((after!==""&&!/^[a-f0-9]{32}$/.test(after))||typeof all!=="boolean")throw new MnemosAPIError(400);const page=await this.#client.policyAlerts(after,all,this.#lifetime.signal);this.#check();if(!validPolicyAlertPage(page))throw new MnemosAPIError(502);return page;}
  async reviewPolicyAlert(id:string,note:string){this.#check();if(!/^[a-f0-9]{32}$/.test(id)||typeof note!=="string"||new TextEncoder().encode(note).length>4096)throw new MnemosAPIError(400);const result=await this.#client.reviewPolicyAlert(id,note,this.#lifetime.signal);this.#check();if(!result||typeof result.reviewed!=="boolean")throw new MnemosAPIError(502);return result;}
  async platformSignalInbox(before=""){this.#check();const value=await this.#client.platformSignalInbox(before,this.#lifetime.signal);this.#check();if(!validSignalInbox(value))throw new MnemosAPIError(502);return value;}
  async readPlatformSignalNotification(id:string){this.#check();const value=await this.#client.readPlatformSignalNotification(id,this.#lifetime.signal);this.#check();if(!validSignalInbox(value))throw new MnemosAPIError(502);return value;}
  async listPlatformSignalOwners(){this.#check();const value=await this.#client.listPlatformSignalOwners(this.#lifetime.signal);this.#check();if(!validSignalOwnerPage(value))throw new MnemosAPIError(502);return value;}
  async setPlatformSignalOwner(key:string,decision:Parameters<MnemosAPI["setPlatformSignalOwner"]>[1]){this.#check();const value=await this.#client.setPlatformSignalOwner(key,decision,this.#lifetime.signal);this.#check();if(!validSignalOwnerPage(value))throw new MnemosAPIError(502);return value;}
  async listOrganizationRoles(cursor=""){this.#check();const value=await this.#client.listOrganizationRoles(cursor,this.#lifetime.signal);this.#check();return value;}
  async createOrganizationRole(input:Parameters<MnemosAPI["createOrganizationRole"]>[0]){this.#check();const value=await this.#client.createOrganizationRole(input,this.#lifetime.signal);this.#check();if(value.id!==input.id||value.kind!==input.kind||value.name!==input.name)throw new MnemosAPIError(502);return value;}
  async readPrincipalMembership(container:string,member:string){this.#check();const value=await this.#client.readPrincipalMembership(container,member,this.#lifetime.signal);this.#check();if(value.container_id!==container||value.member_id!==member)throw new MnemosAPIError(502);return value;}
  async setPrincipalMembership(container:string,member:string,decision:Parameters<MnemosAPI["setPrincipalMembership"]>[2]){this.#check();const value=await this.#client.setPrincipalMembership(container,member,decision,this.#lifetime.signal);this.#check();if(value.container_id!==container||value.member_id!==member)throw new MnemosAPIError(502);return value;}
  async readCalendarGrantState(id:string,principal:string){this.#check();const value=await this.#client.readCalendarGrantState(id,principal,this.#lifetime.signal);this.#check();if(value.connection_id!==id||value.principal_id!==principal)throw new MnemosAPIError(502);return value;}
  async readMailGrantState(id:string,principal:string){this.#check();const value=await this.#client.readMailGrantState(id,principal,this.#lifetime.signal);this.#check();if(value.connection_id!==id||value.principal_id!==principal)throw new MnemosAPIError(502);return value;}
  async listCalendarConnections(cursor=''){this.#check();const result=await this.#client.listCalendarConnections(cursor,this.#lifetime.signal);this.#check();return result;}
  async readCalendarEvents(project:string,connection:string,query:import('./calendar-connections.ts').CalendarEventQuery){this.#check();const result=await this.#client.readCalendarEvents(project,connection,query,this.#lifetime.signal);this.#check();return result;}
  async readCalendarConnection(id:string){this.#check();const value=await this.#client.readCalendarConnection(id,this.#lifetime.signal);this.#check();if(value.connection_id!==id)throw new MnemosAPIError(502);return value;}
  async readMailMessages(project:string,connection:string,query:import('./mail-connections.ts').MailMessageQuery){this.#check();const result=await this.#client.readMailMessages(project,connection,query,this.#lifetime.signal);this.#check();return result;}
  async listMailConnections(cursor=''){this.#check();const result=await this.#client.listMailConnections(cursor,this.#lifetime.signal);this.#check();return result;}
  async readMailConnection(id:string){this.#check();const value=await this.#client.readMailConnection(id,this.#lifetime.signal);this.#check();if(value.connection_id!==id)throw new MnemosAPIError(502);return value;}
  async registerCalendarConnection(project:string,request:string,selection:string){this.#check();const value=await this.#client.registerCalendarConnection(project,request,selection,this.#lifetime.signal);this.#check();if(value.project_id!==project)throw new MnemosAPIError(502);return value;}
  async registerMailConnection(project:string,request:string,selection:string){this.#check();const value=await this.#client.registerMailConnection(project,request,selection,this.#lifetime.signal);this.#check();if(value.project_id!==project)throw new MnemosAPIError(502);return value;}
  async setCalendarReadGrant(id:string,decision:CalendarGrantDecision){this.#check();const value=await this.#client.setCalendarReadGrant(id,decision,this.#lifetime.signal);this.#check();return value;}
  async setMailReadGrant(id:string,decision:MailGrantDecision){this.#check();const value=await this.#client.setMailReadGrant(id,decision,this.#lifetime.signal);this.#check();return value;}
  async disableCalendarConnection(id:string,expected:number){this.#check();const value=await this.#client.disableCalendarConnection(id,expected,this.#lifetime.signal);this.#check();return value;}
  async disableMailConnection(id:string,expected:number){this.#check();const value=await this.#client.disableMailConnection(id,expected,this.#lifetime.signal);this.#check();return value;}
  async registerGitConnection(input:GitRegistration){this.#check();const value=await this.#client.registerGitConnection(input,this.#lifetime.signal);this.#check();return value;}
  async disableGitConnection(id:string,expected:number){this.#check();const value=await this.#client.disableGitConnection(id,expected,this.#lifetime.signal);this.#check();return value;}
  async listGitRepositories(id:string,page=1){this.#check();const value=await this.#client.listGitRepositories(id,page,this.#lifetime.signal);this.#check();return value;}
  async listGitSyncLinks(){this.#check();const value=await this.#client.listGitSyncLinks(this.#lifetime.signal);this.#check();return value;}
  async listProjectGitSync(project:string){this.#check();const value=await this.#client.listProjectGitSync(project,this.#lifetime.signal);this.#check();return value;}
  async createGitSyncLink(input:import("./mnemos-api.ts").GitSyncLinkCreate){this.#check();const value=await this.#client.createGitSyncLink(input,this.#lifetime.signal);this.#check();return value;}
  async updateGitSyncLink(link:string,input:import("./mnemos-api.ts").GitSyncLinkUpdate){this.#check();const value=await this.#client.updateGitSyncLink(link,input,this.#lifetime.signal);this.#check();return value;}
  async deleteGitSyncLink(link:string,expectedRevision:number){this.#check();const value=await this.#client.deleteGitSyncLink(link,expectedRevision,this.#lifetime.signal);this.#check();return value;}
  async createProjectFromRepository(input:import("./mnemos-api.ts").GitSyncProjectCreate){this.#check();const value=await this.#client.createProjectFromRepository(input,this.#lifetime.signal);this.#check();return value;}
  async refreshGitSyncLink(link:string){this.#check();const value=await this.#client.refreshGitSyncLink(link,this.#lifetime.signal);this.#check();return value;}
  async listGitAppRepositories(){this.#check();const value=await this.#client.listGitAppRepositories(this.#lifetime.signal);this.#check();return value;}
  async startGitHubConnect(){this.#check();const value=await this.#client.startGitHubConnect(this.#lifetime.signal);this.#check();return value;}
  async listGitHubAccounts(){this.#check();const value=await this.#client.listGitHubAccounts(this.#lifetime.signal);this.#check();return value;}
  async disconnectGitHubAccount(installation:string){this.#check();const value=await this.#client.disconnectGitHubAccount(installation,this.#lifetime.signal);this.#check();return value;}
  async listRepositoryOverview(){this.#check();const value=await this.#client.listRepositoryOverview(this.#lifetime.signal);this.#check();return value;}
  async addRepository(input:import("./git-repositories.ts").RepositoryInput){this.#check();const value=await this.#client.addRepository(input,this.#lifetime.signal);this.#check();return value;}
  async listProjectRepositories(project:string){this.#check();const value=await this.#client.listProjectRepositories(project,this.#lifetime.signal);this.#check();if(value.records.some(r=>r.project_id!==project))throw new MnemosAPIError(502);return value;}
  async setRepositoryCapabilities(project:string,connection:string,repository:string,change:import("./git-repositories.ts").CapabilityChange){this.#check();const value=await this.#client.setRepositoryCapabilities(project,connection,repository,change,this.#lifetime.signal);this.#check();if(value.project_id!==project||value.repository_id!==repository)throw new MnemosAPIError(502);return value;}
  async detachRepository(project:string,connection:string,repository:string,expected:number){this.#check();const value=await this.#client.detachRepository(project,connection,repository,expected,this.#lifetime.signal);this.#check();return value;}
  async resolveRevokedRepository(link:string,remove:boolean){this.#check();const value=await this.#client.resolveRevokedRepository(link,remove,this.#lifetime.signal);this.#check();return value;}
  async readGitOwnership(person:string){this.#check();const value=await this.#client.readGitOwnership(person,this.#lifetime.signal);this.#check();return value;}
  async transferGitOwnership(person:string,to:string){this.#check();const value=await this.#client.transferGitOwnership(person,to,this.#lifetime.signal);this.#check();return value;}
  async connectCodeFromFiles(project:string){this.#check();const value=await this.#client.connectCodeFromFiles(project,this.#lifetime.signal);this.#check();return value;}
  async disableInternalCodeHosting(expected:number){this.#check();const value=await this.#client.disableInternalCodeHosting(expected,this.#lifetime.signal);this.#check();return value;}
  private gitRegistrations(){this.#check();if(!this.requestStorage)throw Error("Git request storage unavailable");return new GitRegistrations(this.requestStorage);}
  async listGitRegistrationIntents(){return this.gitRegistrations().list(this);}
  async saveGitRegistrationIntent(setup:GitSetup){return this.gitRegistrations().save(this,setup);}
  async inspectGitRegistrationIntent(id:string){return this.gitRegistrations().inspect(this,id);}
  async executeGitRegistrationIntent(id:string,token:string,retry:boolean){return this.gitRegistrations().execute(this,id,token,retry);}
  async listAgentConnections(cursor = "") {
    this.#check();
    const page = await this.#client.listAgentConnections(cursor, this.#lifetime.signal);
    this.#check(); return page;
  }
  async revokeAgentConnection(bindingId: string): Promise<void> {
    this.#check();
    await this.#client.revokeAgentConnection(bindingId, this.#lifetime.signal);
    this.#check();
  }
  async provisionWorkshopAgent(requestId: string, connectionName: string, projectIds: string[]) {
    this.#check();
    const connection = await this.#client.provisionWorkshopAgent(requestId, connectionName, projectIds, this.#lifetime.signal);
    this.#check();
    if (typeof connection.binding_id !== "string" || !connection.binding_id || typeof connection.connection_name !== "string") throw new MnemosAPIError(502);
    return connection;
  }
  /** Только для агентской сессии аккаунта; значение наружу не отдаётся. */
  async issueAgentCredential(bindingId: string) {
    this.#check();
    const credential = await this.#client.issueAgentCredential(bindingId, this.#lifetime.signal);
    this.#check(); return credential;
  }
  dispose(): void { this.#lifetime.abort(); }
}

export type TrackerInvitations = Pick<MnemosAccountSession,"listInvitedTrackers"|"connectInvitedTracker">;
