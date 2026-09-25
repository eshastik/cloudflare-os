import { HISTORY_PREPARING, historyPreparingMessage, historyProgress, type HistoryProgress } from "./history-preparing.ts";
import { checkedIntakeSubmit, type IntakeReceipt, type IntakeStatus, type IntakeAlerts, type IntakeAlert, type IntakeDecision } from "./intake.ts";
import { checkedAdminRight, type AdminPersonCreate, type AdminPerson, type AdminPeopleResult, type AdminRight, type AdminRights } from "./admin-people.ts";
import type {CentroidResult} from './centroid.ts';
import type {ReindexInventory} from './reindex-batch.ts';
import type {ReindexResult} from './reindex.ts';
import type {PolicyAlertPage} from './policy-alerts.ts';
import {telegramVoiceBudget} from './telegram-budget.ts';
import {voiceRecord,checkedVoiceDownload,type VoiceSource,checkedVoiceSource,checkedVoiceTranscript,checkedVoiceConfirmation,voiceID,voiceRevision,voiceHash,type VoiceEdit,type VoiceConfirm} from "./voice-contract.ts";
import type {CalendarConnectionInfo,CalendarGrantDecision,CalendarGrantState} from "./calendar-connections.ts";
import type {MailConnectionInfo,MailGrantDecision,MailGrantState} from "./mail-connections.ts";
import type {CorporateFilePrepared,CorporateUpdateResolution,CorporateRecordUpdatePreview,BitrixTaskMapping,BitrixImportPreview,JiraImportPreview,JiraTaskPrepared,CorporateOrigin} from "./corporate-import.ts";
import type {DatabaseConnection,DatabaseRegistration} from "./database-connections.ts";
import type {OperationAuditPage} from "./operation-audit.ts";
import type {GitFile,GitCommit,GitBindingState} from "./git-connections.ts";
import type {GitProjectRepositoryPage,GitProjectRepository,GitRepositorySelection,GitTree,GitBranchPage,GitLogPage,GitComparison} from "./git-connections.ts";
import {checkedGitTree,checkedGitBranches,checkedGitLog,checkedGitComparison} from "./git-connections.ts";
import type {GitConnection,GitConnectionPage,GitRegistration,GitRepositoryPage,GitDisabled} from "./git-connections.ts";
import type {PersonalWorkTemplateSelection,WorkTemplateResolution} from "./work-templates.ts";
import {validTemplateScopeConfig,type TemplateScope,type TemplateScopeConfig} from "./work-templates.ts";
import type {TemplateDecisionInput,TemplatePromotionDecision,TemplateProposalSource} from "./work-templates.ts";
import {validTemplatePromotionReview,type TemplatePromotionReview,type TemplatePromotionPage} from "./work-templates.ts";
import type {TemplatePromotionInput,TemplatePromotion} from "./work-templates.ts";
import {validScopedWorkTemplate,type TemplateScopePage,type ScopedWorkTemplatePage,type ScopedWorkTemplateVersion,type ScopedWorkTemplateApplied} from "./work-templates.ts";
import {validWorkTemplate, type WorkTemplateVersion, type WorkTemplatePage, type WorkTemplateSave, type WorkTemplateApplication, type WorkTemplateApplied} from "./work-templates.ts";
import { checkedSharingSettings, isProjectVisibility, validShareRequest, validSharingSettings, validVisibilityResult, type ProjectSharingSettings, type ProjectVisibility, type ProjectVisibilityResult, type ShareRequest } from "./project-sharing.ts";
import type { ReviewDecisions } from "./review-decisions.ts";
import type { ReviewTiming } from "./review-timing.ts";
import { UI_READINESS_SURFACES, isUIReadinessSample, type UIReadinessSample } from "@gadgets/workshop-shared/ui-readiness";
import { MAX_SPENDING_BATCH, isSpendingEntry, type SpendingEntry } from "@gadgets/workshop-shared/spending";
export { UI_READINESS_SURFACES, type UIReadinessSample } from "@gadgets/workshop-shared/ui-readiness";
/** Aggregated browser load outcomes, separated by interface. */
export interface UIReadinessUsage { surface:typeof UI_READINESS_SURFACES[number];outcome:UIReadinessSample["outcome"]|"unconfirmed";samples:number;p50_ms:number|null;p95_ms:number|null;p99_ms:number|null;last_observed_at:string }
/** Confirmed publication results in this organization only; not all task types. */
/** Calendar-time percentiles for observed replies; an empty sample has null durations. */
export interface CollaborationDuration { samples:number; p50_seconds:number|null; p95_seconds:number|null; p99_seconds:number|null }
/** Coexecutor requests created in the last 24 hours; each result has at most one first review. */
export interface CollaborationTiming { requests:number; results:number; reviewed_requests:number; reworked_requests:number; first_response:CollaborationDuration; first_review:CollaborationDuration }
export interface OrganizationWork { collaboration?:CollaborationTiming; first_publication_at:string|null; first_acceptance_at?:string|null; observed_at:string; periods:{days:1|7|30;publications:number;projects:number;has_completed_publication:boolean;completed_projects?:number;has_completed_work?:boolean;accepted_requests?:number;accepted_request_projects?:number}[] }
/** Distinct reporting and active humans in rolling periods; coverage may be partial. */
export interface ActivityWindows { first_observed_at:string; observed_at:string; windows:{days:1|7|30;reporting_users:number;active_users:number}[] }
/** External attempted probes over a fixed last-day window, independent of API uptime. */
export interface ExternalSnapshot { versions?: {groups: (ExternalOperation & {environment:string;observer_release:string;observer_version:string;target_deployment?:PlatformDeployment|null})[];total_groups:number;truncated:boolean}; window_start: string; observed_at: string; operations: ExternalOperation[] }
/** Missing or stale probes are unknown; success counts include only attempted checks. */
export interface ExternalOperation { duration_percentiles_ms?: {p50:number;p95:number;p99:number}|null; operation: "readiness" | "login" | "read" | "save"; source_status: "ready" | "unavailable" | "invalid" | "too_large"; samples:number; successes:number; last_observed_at:string|null; last_success:boolean|null; last_outcome:string|null; stale:boolean; mean_duration_ms:number|null }
/** Recorded HTTP outcomes linked to workflows; counts are attempts, not milestones. */
export interface WorkflowAttemptUsage { deployment?:PlatformDeployment|null; operation: "open" | "save" | "review" | "publish"; status:number; outcome:string; attempts:number; workflows:number; mean_duration_ms:number; first_observed_at:string; last_observed_at:string }
/** Process-wide completed request measurements since registry initialization. */
export interface ServiceSnapshot { started_at: string; observed_at: string; operations: ServiceOperation[] }
/** Cumulative histogram: null upper bound includes all completed requests. */
export interface ServiceOperation { surface: string; method: string; requests: number; duration_seconds: number; outcomes: Record<string, number>; buckets: { upper_seconds: number | null; count: number }[] }
/** Tenant publication count and the time at which it was read. */
/** Last-day activity received from connected workspaces; null means no telemetry. */
export interface WorkspaceActivityUsage { reporting_users: number; active_users: number; sessions: number; active_seconds: number; session_seconds: number }
/** Current storage-api process identity; historical samples can span other releases. */
export interface PlatformDeployment {environment:string;release:string;source_revision:string;source_modified:boolean|null;go_version:string;schema_version:number}
/** Bounded last-day groups; unknown collector builds remain a separate group. */
export interface UIReadinessVersions {groups:(UIReadinessUsage & {client_version:string;deployment?:PlatformDeployment|null})[];total_groups:number;truncated:boolean}
export interface PlatformSignal {key:"dependencies"|"external.readiness"|"external.login"|"external.read"|"external.save";state:"ok"|"firing"|"unknown";reason:"check_unavailable"|"source_unavailable"|"observations_missing"|"observations_stale"|"check_failed"|"check_passed";observed_at:string|null}
export interface PlatformSignalNotification extends PlatformSignal {id:string;created_at:string;read_at:string|null}
export interface PlatformSignalInbox {items:PlatformSignalNotification[];unread:number;next_before:string}
export interface PlatformSignalOwner {signal_key:PlatformSignal["key"];owner_id:string;owner_name:string;owner_active:boolean;revision:number}
export interface PlatformSignalOwnerPage {generation:number;owners:PlatformSignalOwner[]}
export interface PlatformUsage { signal_owners?:PlatformSignalOwner[]|null; signals?:PlatformSignal[]|null; ui_readiness_versions?:UIReadinessVersions|null; deployment?:PlatformDeployment|null; ui_readiness?:UIReadinessUsage[]|null; organization_work?:OrganizationWork|null; activity_windows?: ActivityWindows | null; external?: ExternalSnapshot | null; workflow_attempts?: WorkflowAttemptUsage[] | null; workflow?: { first_observed_at: string | null; opened:number; saved:number; reviewed:number; published:number; opening_unobserved:number } | null; review_stages?: {decisions?:ReviewDecisions;timing?:ReviewTiming;submitted:number;awaiting_decisions:number;rejected:number;approved:number;published:number;historical_completion_unknown:number} | null; readiness?: { ready: boolean; reasons: string[]; checked_at: string } | null; service?: ServiceSnapshot | null; workspace_activity: WorkspaceActivityUsage | null; recorded_at: string; shared_publications: number; human_logins_24h: number; authenticated_users_24h: number }
export const SPENDING_PERIODS = ["today", "7d", "30d", "all"] as const;
export type SpendingPeriod = typeof SPENDING_PERIODS[number];
/** Сумма по одному значению разбивки: name — для показа, key — только для связи строк. */
export interface SpendingGroup { key: string; name: string; micro_usd: string; count: number; estimated_count: number }
export interface SpendingSummary {
  period: SpendingPeriod; since?: string; all_visible: boolean; micro_usd: string; count: number; estimated_count: number;
  usd_rub_rate?: number;
  kinds: SpendingGroup[]; operations: SpendingGroup[]; projects: SpendingGroup[]; people: SpendingGroup[]; agents: SpendingGroup[]; models: SpendingGroup[];
}
export interface AgentTaskOutcome { request_id: string; state: "completed" | "unconfirmed" | "budget_blocked"; result: { content: string } | null }
import type { PublicationReview } from "@gadgets/workshop-shared/publication-review";

/** Server-side transport. Never expose this object or its credential provider as UI RPC. */
export class MnemosAPI {
  #origin: string;
  #credential: () => Promise<string>;
  #fetch: typeof fetch;
  constructor(origin: string, credential: () => Promise<string>, fetcher: typeof fetch = fetch) {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Invalid Mnemos origin");
    this.#origin = url.origin; this.#credential = credential; this.#fetch = fetcher.bind(globalThis);
  }
  async #request<T>(path: string, method: "GET" | "POST" | "PUT" | "DELETE", signal?: AbortSignal, body?: object, allowNoContent = false, timeoutMs = 20_000): Promise<T> {
    let token: string;
    try { token = await this.#credential(); } catch { throw new MnemosAPIError(401); }
    if (!token || /\s/.test(token)) throw new MnemosAPIError(401);
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.#fetch(this.#origin + path, { method, redirect: "manual", cache: "no-store", signal: combined, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new MnemosAPIError(503); }
    if (!response.ok) { const failure=await safeFailureCode(response); throw new MnemosAPIError(response.status,failure?.code,failure?.refusal,failure?.progress); }
    if (response.status === 204 && allowNoContent) return undefined as T;
    // Read bounded metadata; files are downloaded directly through separate tickets.
    const reader = response.body?.getReader();
    if (!reader) throw new MnemosAPIError(502);
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 1_048_576) { await reader.cancel(); throw new MnemosAPIError(502); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) as T;
    } catch { throw new MnemosAPIError(502); }
    finally { reader.releaseLock(); }
  }
  beginInboxUpload(size: number, checksum: string, signal?: AbortSignal): Promise<UploadTicket> {
    if (!Number.isSafeInteger(size) || size < 0 || size > 64*1024*1024 || typeof checksum !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(checksum)) throw new MnemosAPIError(400);
    return this.#request('/v1/inbox/uploads', 'POST', signal, {size_bytes:size,checksum_sha256:checksum});
  }
  submitProjectUpload(projectId: string, uploadId: string, sourcePath: string, modifiedAt?: number, signal?: AbortSignal): Promise<IntakeReceipt> {
    if (typeof projectId !== "string" || !projectId || projectId.length > 255) throw new TypeError("Не выбран проект");
    return this.#request('/v1/inbox','POST',signal,{...checkedIntakeSubmit(uploadId,sourcePath,modifiedAt),project_id:projectId});
  }
  submitInboxUpload(uploadId: string, sourcePath: string, modifiedAt?: number, signal?: AbortSignal): Promise<IntakeReceipt> {return this.#request('/v1/inbox','POST',signal,checkedIntakeSubmit(uploadId,sourcePath,modifiedAt));}
  inboxStatus(signal?: AbortSignal, projectId?:string): Promise<IntakeStatus> {return this.#request('/v1/inbox/status?limit=200'+(projectId?'&project_id='+encodeURIComponent(projectId):''),'GET',signal);}
  inboxAlerts(decided=false,signal?: AbortSignal,projectId?:string): Promise<IntakeAlerts> {return this.#request(`/v1/inbox/alerts?limit=200&decided=${decided ? 'true' : 'false'}${projectId ? `&project_id=${encodeURIComponent(projectId)}` : ''}`,'GET',signal);}
  decideInboxAlert(id: string, decision: IntakeDecision, signal?: AbortSignal): Promise<{alert:IntakeAlert}> {return this.#request(`/v1/inbox/alerts/${segment(id)}`,'POST',signal,decision);}
  replayInboxItem(hash: string, version: number, signal?: AbortSignal): Promise<{blob_sha256_hex:string;pipeline_version:number}> {
    if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(version) || version<1) throw new MnemosAPIError(400);
    return this.#request(`/v1/inbox/items/${hash}/replay`,'POST',signal,{pipeline_version:version});
  }
  listPeople(signal?: AbortSignal): Promise<{users: AdminPerson[]}> { return this.#request('/v1/admin/users', 'GET', signal); }
  createPerson(input: AdminPersonCreate, signal?: AbortSignal): Promise<AdminPeopleResult> { return this.#request('/v1/admin/users', 'POST', signal, input); }
  listPersonRights(principal: string, signal?: AbortSignal): Promise<AdminRights> { return this.#request(`/v1/admin/rights?principal_id=${encodeURIComponent(principal)}`, 'GET', signal); }
  grantPersonRight(input: AdminRight, signal?: AbortSignal): Promise<{right: AdminRight}> { return this.#request('/v1/admin/rights', 'POST', signal, checkedAdminRight(input)); }
  removePersonRight(input: AdminRight, signal?: AbortSignal): Promise<{outcome: string; right: AdminRight}> { return this.#request('/v1/admin/rights/remove', 'POST', signal, checkedAdminRight(input)); }
  /** Вывести сотрудника из организации: вход, токены, агенты, приглашения и права сняты; учётная запись остаётся. */
  removePerson(principal: string, signal?: AbortSignal): Promise<PersonRemoval> { return this.#request(`/v1/admin/users/${segment(principal)}/remove`, 'POST', signal, {}); }
  /** Вернуть выбывшего сотрудника: вход снова открыт, прежние права не возвращаются. */
  returnPerson(principal: string, signal?: AbortSignal): Promise<PersonReturn> { return this.#request(`/v1/admin/users/${segment(principal)}/return`, 'POST', signal, {}); }
  listPrivateVersions(project:string,node:string,cursor='',signal?:AbortSignal):Promise<{versions:Array<{head:string;content_type:string;recorded_at:string;author_name?:string}>;next_cursor?:string;limited?:boolean}>{return this.#request(`/v1/projects/${segment(project)}/nodes/${segment(node)}/private-versions?cursor=${encodeURIComponent(cursor)}`,"GET",signal);}
  restorePrivateDraftContent(project:string,node:string,source:string,expectedHead:string,signal?:AbortSignal):Promise<DraftHead>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/restore-private`,"POST",signal,{source_head:source,expected_head:expectedHead});}
  checkPrivateVersionRead(project: string, node: string, version: string, signal?: AbortSignal): Promise<{node_id: string; head: string}> {
    head(version);
    return this.#request(`/v1/projects/${segment(project)}/nodes/${segment(node)}/private-versions/${version}/access`, "GET", signal);
  }
  downloadPrivateVersion(project: string, node: string, version: string, signal?: AbortSignal): Promise<DraftDownloadTicket & {content_type: string}> {
    head(version);
    return this.#request(`/v1/projects/${segment(project)}/nodes/${segment(node)}/private-versions/${version}/download`, "POST", signal);
  }
  officeOrigin(project: string, node: string, version: string, signal?: AbortSignal): Promise<{drive?:{provider:string;source_binding:string;file:string;revision:string;sha256:string;size:number};revision_head?:string;source_node_id: string; source_head: string; source_sha256: string; output_sha256: string; unsupported: string[]} | null> {
    head(version);
    return this.#request(`/v1/projects/${segment(project)}/nodes/${segment(node)}/private-versions/${version}/office-origin`, "GET", signal);
  }
  compareOfficeUpdate(project: string, node: string, input: OfficeUpdateInput, signal?: AbortSignal): Promise<OfficeUpdateComparison> {
    validateOfficeUpdateInput(input);
    return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/office/update-comparison`, "POST", signal, {...input});
  }
  prepareOfficeUpdate(project: string, node: string, input: OfficeUpdateInput, decision: OfficeUpdateDecision, signal?: AbortSignal): Promise<{update_id:string;comparison:OfficeUpdateComparison}> {
    validateOfficeUpdateInput(input);
    for(const value of [decision.current_sha256,decision.source_sha256,decision.output_sha256])head(value);
    if(typeof decision.accept_unsupported!=="boolean"||typeof decision.replace_local!=="boolean")throw new MnemosAPIError(400);
    return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/office/update-prepare`, "POST", signal, {...input,decision:{...decision}});
  }
  applyOfficeUpdate(project:string,node:string,request:string,update:string,upload:string,signal?:AbortSignal):Promise<{node_id:string;head:string}> {
    for(const value of [request,update,upload])segment(value);
    if(request.length>220)throw new MnemosAPIError(400);
    return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/office/update`,"POST",signal,{request_id:request,update_id:update,upload_id:upload});
  }
  convertOffice(project: string, node: string, expected: string, format: "docx" | "xlsx" | "pptx", importing: boolean, title = "", signal?: AbortSignal, sourceHead = ""): Promise<OfficeTicket> {
    head(expected);
    if(sourceHead){head(sourceHead);if(!importing)throw new MnemosAPIError(400);}
    if ((format !== "docx" && format !== "xlsx" && format !== "pptx") || typeof importing !== "boolean" || typeof title !== "string" || title.length > 255 || (!importing && title)) throw new MnemosAPIError(400);
    return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/office/${importing ? "import-preview" : "export"}`, "POST", signal, {expected_head: expected, format, title, ...(sourceHead ? {source_head: sourceHead} : {})});
  }
  readTeamMemberActivity(project: string, proposal: string, binding: string, after: string, signal?: AbortSignal): Promise<TeamMemberActivity> {
    return this.#request(`/v1/projects/${segment(project)}/team-budgets/${segment(proposal)}/members/${segment(binding)}/activity?after_sequence=${encodeURIComponent(after)}`, "GET", signal);
  }
  readTeamMemberObservation(project: string, proposal: string, binding: string, signal?: AbortSignal): Promise<TeamMemberObservation> {
    return this.#request(`/v1/projects/${segment(project)}/team-budgets/${segment(proposal)}/members/${segment(binding)}/observation`, "GET", signal);
  }
  readTeamResultDraft(project:string,proposal:string,signal?:AbortSignal):Promise<TeamResultDraft> {
    return this.#request(`/v1/projects/${segment(project)}/team-budgets/${segment(proposal)}/result-draft`, "GET", signal);
  }
  readTeamResultContribution(project:string, proposal:string, binding:string, signal?:AbortSignal):Promise<TeamResultContribution> {
    return this.#request(`/v1/projects/${segment(project)}/team-budgets/${segment(proposal)}/members/${segment(binding)}/contribution`, "GET", signal);
  }
  recordTeamResultContribution(project:string, proposal:string, binding:string, input:TeamResultContributionInput, signal?:AbortSignal):Promise<TeamResultContribution> {
    return this.#request(`/v1/projects/${segment(project)}/team-budgets/${segment(proposal)}/members/${segment(binding)}/contribution`, "POST", signal, input);
  }
  readTeamResultReview(project: string, proposal: string, binding: string, signal?: AbortSignal): Promise<TeamResultReviewState> {
    return this.#request(`/v1/projects/${segment(project)}/team-budgets/${segment(proposal)}/members/${segment(binding)}/review`, "GET", signal);
  }
  recordTeamResultReview(project: string, proposal: string, binding: string, input: TeamResultReviewInput, signal?: AbortSignal): Promise<TeamResultReview> {
    return this.#request(`/v1/projects/${segment(project)}/team-budgets/${segment(proposal)}/members/${segment(binding)}/review`, "POST", signal, input);
  }
  readTeamBudgetUsage(project: string, proposal: string, signal?: AbortSignal): Promise<TeamBudgetUsage> {
    return this.#request(`/v1/projects/${segment(project)}/team-budgets/${segment(proposal)}/usage`, "GET", signal);
  }
  runTeamBudgetMember(project: string, proposal: string, binding: string, signal?: AbortSignal): Promise<AgentTaskOutcome> {
    return this.#request(`/v1/projects/${segment(project)}/team-budgets/${segment(proposal)}/members/${segment(binding)}/task`, "POST", signal, {});
  }
  readTeamMemberInputs(project: string, proposal: string, binding: string, signal?: AbortSignal): Promise<AgentTaskInputs> {
    return this.#request(`/v1/projects/${segment(project)}/team-budgets/${segment(proposal)}/members/${segment(binding)}/inputs`, "GET", signal);
  }
  readTeamBudgetMember(project: string, proposal: string, binding: string, signal?: AbortSignal): Promise<AgentTaskOutcome> {
    return this.#request(`/v1/projects/${segment(project)}/team-budgets/${segment(proposal)}/members/${segment(binding)}/task`, "GET", signal);
  }
  cancelTeamBudgetMember(project: string, proposal: string, binding: string, signal?: AbortSignal): Promise<{state: "cancelled"}> {
    return this.#request(`/v1/projects/${segment(project)}/team-budgets/${segment(proposal)}/members/${segment(binding)}/cancel`, "POST", signal, {});
  }
  listTeamBudgets(project: string, cursor = "", signal?: AbortSignal): Promise<{proposals: TeamBudgetSummary[]; next_cursor?: string}> {
    return this.#request(`/v1/projects/${segment(project)}/team-budgets?cursor=${encodeURIComponent(cursor)}`, "GET", signal);
  }
  readTeamBudget(project: string, id: string, signal?: AbortSignal): Promise<TeamBudgetProposal> {
    return this.#request(`/v1/projects/${segment(project)}/team-budgets/${segment(id)}`, "GET", signal);
  }
  createTeamBudget(project: string, input: TeamBudgetCreate & {request_id: string}, signal?: AbortSignal): Promise<TeamBudgetProposal> {
    return this.#request(`/v1/projects/${segment(project)}/team-budgets`, "POST", signal, input);
  }
  decideTeamBudget(project: string, id: string, input: TeamBudgetDecide, signal?: AbortSignal): Promise<TeamBudgetDecision> {
    return this.#request(`/v1/projects/${segment(project)}/team-budgets/${segment(id)}/decisions`, "POST", signal, input);
  }
  listBudgetProjects(cursor = "", signal?: AbortSignal): Promise<{projects: {project_id: string; name: string}[]; next_cursor?: string}> {
    if (typeof cursor !== "string" || cursor.length > 255) throw new MnemosAPIError(400);
    return this.#request(`/v1/project-budgets?cursor=${encodeURIComponent(cursor)}`, "GET", signal);
  }
  /** Записать траты оболочки; человек и агент — из этого ключа, не из записей. */
  recordSpending(entries: SpendingEntry[], signal?: AbortSignal): Promise<{recorded: number}> {
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_SPENDING_BATCH || !entries.every(isSpendingEntry)) throw new MnemosAPIError(400);
    return this.#request("/v1/spending", "POST", signal, {records: entries});
  }
  /** Сводка трат за период; администратор видит организацию, остальные — свои траты. */
  readSpending(period: SpendingPeriod, timeZone = "", signal?: AbortSignal): Promise<SpendingSummary> {
    if (!SPENDING_PERIODS.includes(period) || typeof timeZone !== "string" || timeZone.length > 64 || !/^[A-Za-z0-9_+\-/]*$/.test(timeZone)) throw new MnemosAPIError(400);
    return this.#request(`/v1/spending?period=${period}${timeZone ? `&tz=${encodeURIComponent(timeZone)}` : ""}`, "GET", signal);
  }
  readProjectBudget(project: string, signal?: AbortSignal): Promise<ProjectBudgetPolicy> {
    return this.#request(`/v1/projects/${segment(project)}/budget-policy`, "GET", signal);
  }
  setProjectBudget(project: string, policy: Omit<ProjectBudgetPolicy, "project_id">, signal?: AbortSignal): Promise<ProjectBudgetPolicy> {
    if (!Number.isSafeInteger(policy.revision) || policy.revision < 0 || !Number.isSafeInteger(policy.automatic_team_size) || policy.automatic_team_size < 1 || policy.automatic_team_size > 2147483647) throw new MnemosAPIError(400);
    for (const amount of [policy.limit_usd_micros, policy.automatic_usd_micros]) if (typeof amount !== "string" || !/^\d{1,19}$/.test(amount) || BigInt(amount) > 9223372036854775807n) throw new MnemosAPIError(400);
    if (BigInt(policy.automatic_usd_micros) > BigInt(policy.limit_usd_micros)) throw new MnemosAPIError(400);
    return this.#request(`/v1/projects/${segment(project)}/budget-policy`, "PUT", signal, {expected_revision: policy.revision, owner_id: policy.owner_id, limit_usd_micros: policy.limit_usd_micros, automatic_usd_micros: policy.automatic_usd_micros, automatic_team_size: policy.automatic_team_size});
  }
  listCollaborations(cursor = "", signal?: AbortSignal): Promise<{requests: CollaborationRequest[]; next_cursor?: string}> {
    return this.#request(`/v1/collaborations?cursor=${encodeURIComponent(cursor)}`, "GET", signal);
  }
  readCollaboration(id: string, signal?: AbortSignal): Promise<CollaborationRequest> {
    return this.#request(`/v1/collaborations/${segment(id)}`, "GET", signal);
  }
  createCollaboration(request: CollaborationCreate, signal?: AbortSignal): Promise<CollaborationRequest> {
    head(request.source_head); segment(request.request_id); segment(request.project_id); segment(request.node_id);
    return this.#request("/v1/collaborations", "POST", signal, request);
  }
  readCollaborationProgress(id: string, signal?: AbortSignal): Promise<CollaborationProgress> {
    return this.#request(`/v1/collaborations/${segment(id)}/progress`, "GET", signal);
  }
  reviewCollaborationResult(id: string, review: CollaborationReviewCreate, signal?: AbortSignal): Promise<CollaborationReview> {
    return this.#request(`/v1/collaborations/${segment(id)}/reviews`, "POST", signal, review);
  }
  listCollaborationMessages(id: string, cursor = 0, signal?: AbortSignal): Promise<{messages: CollaborationMessage[]; next_cursor?: number}> {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new MnemosAPIError(400);
    return this.#request(`/v1/collaborations/${segment(id)}/messages?cursor=${cursor}`, "GET", signal);
  }
  appendCollaborationMessage(id: string, message: {message_id: string; kind: "comment" | "result"; body: string}, signal?: AbortSignal): Promise<CollaborationMessage> {
    return this.#request(`/v1/collaborations/${segment(id)}/messages`, "POST", signal, message);
  }
  createAbsenceTask(request: string, signal?: AbortSignal): Promise<AbsenceTask> {
    return this.#request(`/v1/collaborations/${segment(request)}/absence-task`, "POST", signal, {});
  }
  readAbsenceTask(request: string, signal?: AbortSignal): Promise<AbsenceTask> {
    return this.#request(`/v1/collaborations/${segment(request)}/absence-task`, "GET", signal);
  }
  dispatchAbsenceTask(request: string, proposal: string, signal?: AbortSignal): Promise<AbsenceDispatch> {
    segment(proposal);
    return this.#request(`/v1/collaborations/${segment(request)}/absence-dispatch`, "POST", signal, {proposal_id: proposal});
  }
  cancelAbsenceTask(request: string, revision: number, signal?: AbortSignal): Promise<AbsenceCancellation> {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new MnemosAPIError(400);
    return this.#request(`/v1/collaborations/${segment(request)}/absence-cancellation`, "POST", signal, {expected_revision: revision});
  }
  readAbsenceRuntime(request: string, binding: string, signal?: AbortSignal): Promise<AgentTaskOutcome> {
    return this.#request(`/v1/collaborations/${segment(request)}/absence-task/${segment(binding)}/runtime`, "GET", signal);
  }
  shareAgentAbsenceResult(request: string, binding: string, runtime: string, hash: string, body: string, signal?: AbortSignal): Promise<CollaborationMessage> {
    if (!runtime || runtime.length > 255 || !/^[0-9a-f]{64}$/.test(hash) || !body.trim() || [...body].length > 16384) throw new MnemosAPIError(400);
    return this.#request(`/v1/collaborations/${segment(request)}/absence-task/${segment(binding)}/result`, "POST", signal, {runtime_request_id: runtime, result_sha256: hash, body});
  }
  readAgentAbsence(project: string, signal?: AbortSignal): Promise<AgentAbsence> {
    return this.#request(`/v1/projects/${segment(project)}/agent-absence`, "GET", signal);
  }
  setAgentAbsence(project: string, input: AgentAbsenceInput, signal?: AbortSignal): Promise<AgentAbsence> {
    if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0 || typeof input.enabled !== "boolean" || !Number.isFinite(Date.parse(input.starts_at)) || !Number.isFinite(Date.parse(input.ends_at)) || Date.parse(input.ends_at) <= Date.parse(input.starts_at) || input.local_binding_id === input.managed_binding_id) throw new MnemosAPIError(400);
    segment(input.local_binding_id); segment(input.managed_binding_id);
    return this.#request(`/v1/projects/${segment(project)}/agent-absence`, "PUT", signal, {local_binding_id: input.local_binding_id, managed_binding_id: input.managed_binding_id, starts_at: input.starts_at, ends_at: input.ends_at, expected_revision: input.expected_revision, enabled: input.enabled});
  }
  listEngagementRules(binding: string, cursor = "", signal?: AbortSignal): Promise<{rules: EngagementRule[]; next_cursor: string}> {
    if (typeof cursor !== "string" || cursor.length > 64) throw new MnemosAPIError(400);
    return this.#request(`/v1/agent-connections/${segment(binding)}/engagement-rules?cursor=${encodeURIComponent(cursor)}`, "GET", signal);
  }
  setEngagementRule(binding: string, rule: Omit<EngagementRule, "rule_id">, signal?: AbortSignal): Promise<EngagementRule> {
    if (!Number.isSafeInteger(rule.revision) || rule.revision < 0 || typeof rule.enabled !== "boolean" || !["observe", "review_spec", "collaborate"].includes(rule.purpose)) throw new MnemosAPIError(400);
    segment(rule.requester_id); segment(rule.project_id);
    return this.#request(`/v1/agent-connections/${segment(binding)}/engagement-rules`, "PUT", signal, {requester_id: rule.requester_id, project_id: rule.project_id, purpose: rule.purpose, expected_revision: rule.revision, enabled: rule.enabled});
  }


  async proposeWorkTemplate(template:string,input:TemplatePromotionInput,signal?:AbortSignal):Promise<TemplatePromotion>{
    segment(template);segment(input.project_id);segment(input.request_id);segment(input.target_scope_id);
    if(!Number.isSafeInteger(input.revision)||input.revision<1||!Number.isSafeInteger(input.target_scope_revision)||input.target_scope_revision<1||!Number.isSafeInteger(input.expected_catalogue_revision)||input.expected_catalogue_revision<0||typeof input.template_key!=="string"||!input.template_key.trim()||typeof input.message!=="string"||!input.message.trim())throw new MnemosAPIError(400);
    const common={request_id:input.request_id,target_scope_id:input.target_scope_id,target_scope_revision:input.target_scope_revision,template_key:input.template_key,expected_catalogue_revision:input.expected_catalogue_revision,message:input.message};
    let source:WorkTemplateVersion;let body;let kind;
    if(input.source_scope_id){segment(input.source_scope_id);if(template!==input.template_key)throw new MnemosAPIError(400);const shared=await this.readScopedWorkTemplate(input.source_scope_id,template,input.revision,signal);source=shared.source;kind="scoped";body={...common,source_scope_id:input.source_scope_id,source_revision:input.revision};}
    else{source=await this.readWorkTemplate(template,input.revision,signal);kind="personal";body={...common,template_id:template,template_revision:input.revision};}
    if(source.project_id!==input.project_id)throw new MnemosAPIError(403);
    const out=await this.#request<TemplatePromotion>(`/v1/template-promotions/${kind}`,"POST",signal,body);
    if(!out||typeof out.proposal_id!=="string"||!out.proposal_id||out.request_id!==input.request_id||out.template_id!==source.template_id||out.template_revision!==source.revision||out.target_scope_id!==input.target_scope_id||out.target_scope_revision!==input.target_scope_revision||out.template_key!==input.template_key||out.expected_catalogue_revision!==input.expected_catalogue_revision||out.message!==input.message||(out.source_scope_id??"")!==(input.source_scope_id??"")||(out.source_scope_revision??0)!==(input.source_scope_id?input.revision:0)||typeof out.user_id!=="string"||!out.user_id||typeof out.source_owner_id!=="string"||!out.source_owner_id||!Number.isFinite(Date.parse(out.created_at))||!Array.isArray(out.scope_path)||!out.scope_path.length||out.scope_path[0].scope_id!==input.target_scope_id||out.scope_path[0].revision!==input.target_scope_revision)throw new MnemosAPIError(502);return out;
  }


  async readTemplateProposalSource(id:string,signal?:AbortSignal):Promise<TemplateProposalSource>{
    const out=await this.#request<TemplateProposalSource>(`/v1/template-promotions/${segment(id)}/source`,"GET",signal);
    if(!out||out.proposal_id!==id||!validWorkTemplate(out.source))throw new MnemosAPIError(502);return out;
  }
  async readTemplateProposalBaseline(id:string,signal?:AbortSignal):Promise<WorkTemplateVersion|null>{
    const {proposal}=await this.readTemplateProposal(id,signal);
    if(!proposal.expected_catalogue_revision)return null;
    const version=await this.readScopedWorkTemplate(proposal.target_scope_id,proposal.template_key,proposal.expected_catalogue_revision,signal);
    return version.source;
  }
  async beginTemplateProposalBaselineDownload(id:string,signal?:AbortSignal){
    const {proposal}=await this.readTemplateProposal(id,signal);
    if(!proposal.expected_catalogue_revision)throw new MnemosAPIError(404);
    const source=await this.readTemplateProposalBaseline(id,signal);
    if(!source)throw new MnemosAPIError(404);
    const ticket=await this.#request<DraftDownloadTicket&{content_type:string}>(`/v1/template-scopes/${segment(proposal.target_scope_id)}/templates/${segment(proposal.template_key)}/download`,"POST",signal,{revision:proposal.expected_catalogue_revision});
    if(!ticket||ticket.head!==source.source_head||ticket.node_id!==source.node_id||ticket.term_index!==0||ticket.content_type!==source.content_type||ticket.method!=="GET"||!Number.isSafeInteger(ticket.size_bytes)||ticket.size_bytes<0||!/^[0-9a-f]{64}$/.test(ticket.sha256_hex)||typeof ticket.url!=="string")throw new MnemosAPIError(502);
    return {source,ticket};
  }
  async beginTemplateProposalDownload(id:string,signal?:AbortSignal){
    const source=await this.readTemplateProposalSource(id,signal);
    const ticket=await this.#request<DraftDownloadTicket&{content_type:string}>(`/v1/template-promotions/${segment(id)}/source/download`,"POST",signal,{});
    if(!ticket||ticket.head!==source.source.source_head||ticket.node_id!==source.source.node_id||ticket.term_index!==0||ticket.content_type!==source.source.content_type||ticket.method!=="GET"||!Number.isSafeInteger(ticket.size_bytes)||ticket.size_bytes<0||!/^[0-9a-f]{64}$/.test(ticket.sha256_hex)||typeof ticket.url!=="string")throw new MnemosAPIError(502);return {source,ticket};
  }
  async decideTemplateProposal(id:string,kind:"personal"|"scoped",input:TemplateDecisionInput,signal?:AbortSignal):Promise<TemplatePromotionDecision>{
    const proposal=await this.readTemplateProposal(id,signal);
    if((proposal.proposal.source_scope_id?"scoped":"personal")!==kind)throw new MnemosAPIError(409);
    if(typeof input.approved!=="boolean"||!Number.isSafeInteger(input.scope_revision)||input.scope_revision<1||typeof input.comment!=="string"||!input.comment.trim())throw new MnemosAPIError(400);segment(input.request_id);
    const body={request_id:input.request_id,approved:input.approved,scope_revision:input.scope_revision,comment:input.comment};
    const out=await this.#request<TemplatePromotionDecision>(`/v1/template-promotions/${kind}/${segment(id)}/decision`,"PUT",signal,body);
    if(!out||!validTemplatePromotionReview({proposal:proposal.proposal,decision:out})||out.request_id!==input.request_id||out.approved!==input.approved||out.scope_revision!==input.scope_revision||out.comment!==input.comment||(input.approved&&out.catalogue_revision!==proposal.proposal.expected_catalogue_revision+1))throw new MnemosAPIError(502);return out;
  }
  async listTemplateProposals(scope:string,cursor="",signal?:AbortSignal):Promise<TemplatePromotionPage>{
    if(typeof cursor!=="string"||cursor.length>255)throw new MnemosAPIError(400);
    const out=await this.#request<TemplatePromotionPage>(`/v1/template-scopes/${segment(scope)}/proposals?cursor=${encodeURIComponent(cursor)}`,"GET",signal);
    if(!out||!Array.isArray(out.proposals)||out.proposals.length>50)throw new MnemosAPIError(502);
    let previous=cursor;for(const v of out.proposals){if(!validTemplatePromotionReview(v)||v.proposal.target_scope_id!==scope||v.proposal.proposal_id<=previous)throw new MnemosAPIError(502);previous=v.proposal.proposal_id;}
    if(out.next_cursor&&(typeof out.next_cursor!=="string"||out.next_cursor<=cursor||out.next_cursor<previous))throw new MnemosAPIError(502);return out;
  }
  async readTemplateProposal(id:string,signal?:AbortSignal):Promise<TemplatePromotionReview>{
    const out=await this.#request<TemplatePromotionReview>(`/v1/template-promotions/${segment(id)}`,"GET",signal);
    if(!validTemplatePromotionReview(out)||out.proposal.proposal_id!==id)throw new MnemosAPIError(502);return out;
  }
  async resolveWorkTemplate(scope:string,key:string,personal?:PersonalWorkTemplateSelection,signal?:AbortSignal):Promise<WorkTemplateResolution>{
    segment(scope);segment(key);if(personal){segment(personal.template_id);if(!Number.isSafeInteger(personal.revision)||personal.revision<1)throw new MnemosAPIError(400);}
    const body=personal?{personal:{template_id:personal.template_id,revision:personal.revision}}:{};
    const out=await this.#request<WorkTemplateResolution>(`/v1/template-scopes/${segment(scope)}/templates/${segment(key)}/resolve`,"POST",signal,body);
    if(!out||out.selected_scope_id!==scope||out.template_key!==key||(personal?!!out.scoped||!out.personal||!validWorkTemplate(out.personal)||out.personal.template_id!==personal.template_id||out.personal.revision!==personal.revision:!!out.personal||!out.scoped||!validScopedWorkTemplate(out.scoped)||out.scoped.template_key!==key))throw new MnemosAPIError(502);return out;
  }
  async setTemplateScope(id:string,expected:number,config:TemplateScopeConfig,signal?:AbortSignal):Promise<TemplateScope>{
    segment(id);if(!Number.isSafeInteger(expected)||expected<0||expected>=Number.MAX_SAFE_INTEGER||!validTemplateScopeConfig(config)||config.parent_id===id)throw new MnemosAPIError(400);
    const body={expected_revision:expected,level:config.level,parent_id:config.parent_id,reader_group_id:config.reader_group_id,name:config.name,enabled:config.enabled,approvers:[...config.approvers].sort()};
    const out=await this.#request<TemplateScope>(`/v1/template-scopes/${segment(id)}`,"PUT",signal,body);
    if(!out||!validTemplateScopeConfig(out)||out.scope_id!==id||out.revision!==expected+1||out.level!==body.level||out.parent_id!==body.parent_id||out.reader_group_id!==body.reader_group_id||out.name!==body.name||out.enabled!==body.enabled||JSON.stringify([...out.approvers].sort())!==JSON.stringify(body.approvers))throw new MnemosAPIError(502);return out;
  }
  async listTemplateScopes(cursor="",signal?:AbortSignal,mode:"member"|"review"|"manage"="member"):Promise<TemplateScopePage>{
    if(typeof cursor!=="string"||cursor.length>255)throw new MnemosAPIError(400);
    const out=await this.#request<TemplateScopePage>(`/v1/template-scopes?mode=${mode}&cursor=${encodeURIComponent(cursor)}`,"GET",signal);
    if(!out||!Array.isArray(out.scopes)||out.scopes.length>100)throw new MnemosAPIError(502);
    let previous=cursor;for(const v of out.scopes){if(!v||typeof v.scope_id!=="string"||v.scope_id<=previous||!Number.isSafeInteger(v.revision)||v.revision<1||(mode==="manage"?typeof v.enabled!=="boolean"||!validTemplateScopeConfig(v):!v.enabled)||!["organization","department","group"].includes(v.level)||typeof v.name!=="string"||!v.name)throw new MnemosAPIError(502);previous=v.scope_id;}
    if(out.next_cursor&&(out.scopes.length!==100||out.next_cursor!==previous))throw new MnemosAPIError(502);return out;
  }
  async listScopedWorkTemplates(scope:string,cursor="",signal?:AbortSignal):Promise<ScopedWorkTemplatePage>{
    if(cursor!==""&&(!/^(0|[1-9][0-9]*)$/.test(cursor)||!Number.isSafeInteger(Number(cursor))||Number(cursor)>2147483647))throw new MnemosAPIError(400);
    const out=await this.#request<ScopedWorkTemplatePage>(`/v1/template-scopes/${segment(scope)}/templates?cursor=${encodeURIComponent(cursor)}`,"GET",signal);
    if(!out||out.selected_scope_id!==scope||!Array.isArray(out.templates)||out.templates.length>50)throw new MnemosAPIError(502);
    let previous="";for(const v of out.templates){if(!validScopedWorkTemplate(v)||v.template_key<=previous)throw new MnemosAPIError(502);previous=v.template_key;}
    if(out.next_cursor&&out.next_cursor!==String(Number(cursor||0)+50))throw new MnemosAPIError(502);return out;
  }
  async readScopedWorkTemplate(scope:string,key:string,revision:number,signal?:AbortSignal):Promise<ScopedWorkTemplateVersion>{
    if(!Number.isSafeInteger(revision)||revision<0)throw new MnemosAPIError(400);
    const out=await this.#request<ScopedWorkTemplateVersion>(`/v1/template-scopes/${segment(scope)}/templates/${segment(key)}?revision=${revision}`,"GET",signal);
    if(!validScopedWorkTemplate(out)||out.scope_id!==scope||out.template_key!==key||(revision>0&&out.revision!==revision))throw new MnemosAPIError(502);return out;
  }
  async createFromScopedWorkTemplate(scope:string,key:string,input:WorkTemplateApplication,signal?:AbortSignal):Promise<ScopedWorkTemplateApplied>{
    segment(input.project_id);segment(input.request_id);head(input.expected_head);
    if(!Number.isSafeInteger(input.revision)||input.revision<1)throw new MnemosAPIError(400);
    const source=await this.readScopedWorkTemplate(scope,key,input.revision,signal);
    const body={request_id:input.request_id,revision:input.revision,project_id:input.project_id,parent_id:input.parent_id,name:input.name,expected_head:input.expected_head,message:input.message};
    const out=await this.#request<ScopedWorkTemplateApplied>(`/v1/template-scopes/${segment(scope)}/templates/${segment(key)}/documents`,"POST",signal,body);
    if(!out||typeof out.node_id!=="string"||!out.node_id||!/^[0-9a-f]{64}$/.test(out.head)||out.scope_id!==scope||out.template_key!==key||out.template_revision!==input.revision||out.source_head!==source.source.source_head)throw new MnemosAPIError(502);return out;
  }
  async listWorkTemplates(project:string,cursor="",signal?:AbortSignal):Promise<WorkTemplatePage>{
    segment(project);if(typeof cursor!=="string"||cursor.length>255)throw new MnemosAPIError(400);
    const out=await this.#request<WorkTemplatePage>(`/v1/work-templates?project_id=${encodeURIComponent(project)}&cursor=${encodeURIComponent(cursor)}`,"GET",signal);
    if(!out||!Array.isArray(out.templates)||out.templates.length>100||typeof out.next_cursor!=="string")throw new MnemosAPIError(502);
    let previous=cursor;for(const item of out.templates){if(!validWorkTemplate(item)||item.project_id!==project||item.template_id<=previous)throw new MnemosAPIError(502);previous=item.template_id;}
    if(out.next_cursor&&(out.next_cursor<=cursor||out.next_cursor<previous))throw new MnemosAPIError(502);return out;
  }
  async readWorkTemplate(id:string,revision:number,signal?:AbortSignal):Promise<WorkTemplateVersion>{
    if(!Number.isSafeInteger(revision)||revision<0)throw new MnemosAPIError(400);
    const out=await this.#request<WorkTemplateVersion>(`/v1/work-templates/${segment(id)}?revision=${revision}`,"GET",signal);
    if(!validWorkTemplate(out)||out.template_id!==id||(revision>0&&out.revision!==revision))throw new MnemosAPIError(502);return out;
  }
  async saveWorkTemplate(id:string,input:WorkTemplateSave,signal?:AbortSignal):Promise<WorkTemplateVersion>{
    segment(input.project_id);segment(input.node_id);head(input.source_head);
    if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<0||input.expected_revision>=Number.MAX_SAFE_INTEGER)throw new MnemosAPIError(400);
    const body={expected_revision:input.expected_revision,title:input.title,kind:input.kind,purpose:input.purpose,project_id:input.project_id,node_id:input.node_id,source_head:input.source_head};
    const out=await this.#request<WorkTemplateVersion>(`/v1/work-templates/${segment(id)}`,"PUT",signal,body);
    if(!validWorkTemplate(out)||out.template_id!==id||out.revision!==input.expected_revision+1||out.title!==input.title||out.kind!==input.kind||out.purpose!==input.purpose||out.project_id!==input.project_id||out.node_id!==input.node_id||out.source_head!==input.source_head)throw new MnemosAPIError(502);return out;
  }
  async createFromWorkTemplate(id:string,input:WorkTemplateApplication,signal?:AbortSignal):Promise<WorkTemplateApplied>{
    segment(input.project_id);segment(input.request_id);head(input.expected_head);
    if(!Number.isSafeInteger(input.revision)||input.revision<1)throw new MnemosAPIError(400);
    const source=await this.readWorkTemplate(id,input.revision,signal);
    const body={request_id:input.request_id,revision:input.revision,project_id:input.project_id,parent_id:input.parent_id,name:input.name,expected_head:input.expected_head,message:input.message};
    const out=await this.#request<WorkTemplateApplied>(`/v1/work-templates/${segment(id)}/documents`,"POST",signal,body);
    if(!out||typeof out.node_id!=="string"||!out.node_id||!/^[0-9a-f]{64}$/.test(out.head)||out.template_id!==id||out.template_revision!==input.revision||out.source_head!==source.source_head)throw new MnemosAPIError(502);return out;
  }
  readPersonalMemory(signal?: AbortSignal): Promise<{revision: number; project_id: string; node_id: string}> {
    return this.#request("/v1/personal-memory", "GET", signal);
  }
  /** Current selected version, rechecked after resolving its content digest; no URL or body escapes. */
  async readPersonalMemoryVersion(signal?: AbortSignal): Promise<{revision:number;project_id:string;node_id:string;head:string|null;sha256:string|null}> {
    type Context={revision:number;project_id:string;node_id:string;document?:DraftDocument};
    const current=()=>this.#request<Context>("/v1/personal-memory/context","GET",signal);
    const selected=await current();
    if(!Number.isSafeInteger(selected.revision)||selected.revision<0||typeof selected.project_id!=="string"||typeof selected.node_id!=="string")throw new MnemosAPIError(502);
    if(!selected.project_id&&!selected.node_id&&!selected.document)return {revision:selected.revision,project_id:"",node_id:"",head:null,sha256:null};
    const doc=selected.document;
    if(!selected.project_id||!selected.node_id||!doc||doc.node_id!==selected.node_id||!doc.exists||doc.conflicted||doc.content_type!=="application/vnd.cloudflareos.document+json")throw new MnemosAPIError(502);
    const ticket=await this.beginDraftDownload(selected.project_id,selected.node_id,doc.head,0,signal);
    if(ticket.head!==doc.head||ticket.node_id!==selected.node_id||ticket.term_index!==0||!/^[a-f0-9]{64}$/.test(ticket.sha256_hex))throw new MnemosAPIError(502);
    const checked=await current();
    if(checked.revision!==selected.revision||checked.project_id!==selected.project_id||checked.node_id!==selected.node_id||checked.document?.head!==doc.head||checked.document?.conflicted||!checked.document?.exists)throw new MnemosAPIError(409);
    return {revision:selected.revision,project_id:selected.project_id,node_id:selected.node_id,head:doc.head,sha256:ticket.sha256_hex};
  }
  setPersonalMemory(revision: number, project: string, node: string, expectedHead: string, signal?: AbortSignal): Promise<{revision: number; project_id: string; node_id: string}> {
    if (!Number.isSafeInteger(revision) || revision < 0 || (!!project !== !!node)) throw new MnemosAPIError(400);
    if (project) { segment(project); segment(node); head(expectedHead); }
    else if (expectedHead) throw new MnemosAPIError(400);
    return this.#request("/v1/personal-memory", "PUT", signal, {expected_revision: revision, project_id: project, node_id: node, expected_head: expectedHead});
  }
  listInvitedDocuments(project: string, cursor = "", node = "", signal?: AbortSignal): Promise<InvitedDocumentPage> {
    if (typeof cursor !== "string" || cursor.length > 2048 || typeof node !== "string" || node.length > 255) throw new MnemosAPIError(400);
    return this.#request(`/v1/projects/${segment(project)}/draft/invitations?cursor=${encodeURIComponent(cursor)}&node_id=${encodeURIComponent(node)}`, "GET", signal);
  }
  /** Документы других людей, открытые этому человеку («Поделились со мной»), новые сверху. */
  listSharedDocuments(signal?: AbortSignal): Promise<{documents: SharedDocument[]}> {
    return this.#request("/v1/me/shared-documents", "GET", signal);
  }
  /** Отметка «прочитано» у уведомления о выданном доступе: человек открыл документ. */
  markSharedDocumentSeen(project: string, owner: string, node: string, signal?: AbortSignal): Promise<{seen: boolean}> {
    segment(project); segment(owner); segment(node);
    return this.#request("/v1/me/shared-documents/seen", "POST", signal, {project_id: project, owner_id: owner, node_id: node});
  }
  /** Сохранить правку в ветку владельца документа; base — голова, от которой сделана правка. Изменённый с тех пор документ — 409. */
  saveSharedDocument(project: string, node: string, owner: string, base: string, uploadId: string, signal?: AbortSignal): Promise<DraftHead> {
    head(base); segment(owner);
    if (typeof uploadId !== "string" || !uploadId || uploadId.length > 255) throw new MnemosAPIError(400);
    return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/shared-save`, "POST", signal, {owner_id: owner, base_head: base, upload_id: uploadId});
  }
  adoptPrivateVersion(project: string, node: string, expected: string, source: string, signal?: AbortSignal): Promise<DraftHead> {
    head(expected); head(source);
    return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/adopt`, "POST", signal, {expected_head: expected, source_head: source});
  }
  listPrivateDocuments(projectId: string, cursor = "", signal?: AbortSignal): Promise<PrivateDocumentPage> {
    if (typeof cursor !== "string" || cursor.length > 2048) throw new MnemosAPIError(400);
    return this.#request(`/v1/projects/${segment(projectId)}/draft/documents?cursor=${encodeURIComponent(cursor)}`, "GET", signal);
  }
  listPrivateDocumentsForOwner(projectId: string, owner: string, cursor = "", signal?: AbortSignal): Promise<PrivateDocumentPage> {
    if (typeof cursor !== "string" || cursor.length > 2048) throw new MnemosAPIError(400);
    return this.#request(`/v1/projects/${segment(projectId)}/draft/documents?owner=${segment(owner)}&cursor=${encodeURIComponent(cursor)}`, "GET", signal);
  }
  readDraftDocument(projectId: string, nodeId: string, signal?: AbortSignal): Promise<DraftDocument> {
    return this.#request(`/v1/projects/${segment(projectId)}/draft/nodes/${segment(nodeId)}`, "GET", signal);
  }
  beginDraftDownload(projectId: string, nodeId: string, expectedHead: string, termIndex: number, signal?: AbortSignal): Promise<DraftDownloadTicket> {
    head(expectedHead);
    if (!Number.isSafeInteger(termIndex) || termIndex < 0) throw new MnemosAPIError(400);
    return this.#request(`/v1/projects/${segment(projectId)}/draft/nodes/${segment(nodeId)}/download`, "POST", signal,
      { expected_head: expectedHead, term_index: termIndex });
  }
  async readPublishedHead(projectId:string,signal?:AbortSignal):Promise<{shared_head:string}> {
    const result=await this.#request<{shared_head:string}>(`/v1/projects/${segment(projectId)}/published-head`,"GET",signal);head(result.shared_head);return result;
  }
  draftState(projectId: string, signal?: AbortSignal): Promise<DraftState> {
    return this.#request(`/v1/projects/${segment(projectId)}/draft/state`, "GET", signal);
  }
  openDraft(projectId: string, signal?: AbortSignal): Promise<DraftHead> {
    return this.#request(`/v1/projects/${segment(projectId)}/draft/open`, "POST", signal);
  }
  async saveDraftLocation(project: string, node: string, expectedHead: string, name: string, parent: string, signal?: AbortSignal): Promise<DraftHead> {
    head(expectedHead);
    if (!name.trim() || new TextEncoder().encode(name).length > 255 || /[/\\\0]/.test(name)) throw new MnemosAPIError(400);
    const result = await this.#request<DraftHead>(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/location`, "POST", signal, { expected_head: expectedHead, name, parent_id: parent });
    head(result.head); return result;
  }
  async updateDraft(project: string, expectedHead: string, signal?: AbortSignal): Promise<DraftHead> {
    head(expectedHead);
    const result = await this.#request<DraftHead>(`/v1/projects/${segment(project)}/draft/update`, "POST", signal, { expected_head: expectedHead });
    head(result.head); return result;
  }
  async resolveDraftConflict(project: string, node: string, expectedHead: string, termIndex: number, signal?: AbortSignal): Promise<DraftHead> {
    head(expectedHead);
    if (!Number.isSafeInteger(termIndex) || termIndex < 0 || termIndex % 2 !== 0) throw new MnemosAPIError(400);
    const result = await this.#request<DraftHead>(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/resolve`, "POST", signal, { expected_head: expectedHead, term_index: termIndex });
    head(result.head); return result;
  }
  async restoreDeletedDraft(project: string, node: string, event: string, expectedHead: string, signal?: AbortSignal): Promise<DraftHead> {
    head(expectedHead); segment(event);
    const result = await this.#request<DraftHead>(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/restore-deleted`, "POST", signal, { expected_head: expectedHead, event_id: event });
    head(result.head); return result;
  }
  async restoreDraftContent(project: string, node: string, event: string, expectedHead: string, signal?: AbortSignal): Promise<DraftHead> {
    head(expectedHead); segment(event);
    const result = await this.#request<DraftHead>(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/restore`, "POST", signal, { expected_head: expectedHead, event_id: event });
    head(result.head); return result;
  }
  async deleteDraftDocument(project: string, node: string, expectedHead: string, signal?: AbortSignal): Promise<DraftHead> {
    segment(node); head(expectedHead);
    const result = await this.#request<DraftHead>(`/v1/projects/${segment(project)}/draft/save`, "POST", signal,
      { expected_head: expectedHead, message: "Delete document", changes: [{ node_id: node, delete: true }] });
    head(result.head); return result;
  }
  saveDraftDocument(projectId: string, nodeId: string, uploadId: string, expectedHead: string, signal?: AbortSignal): Promise<DraftHead> {
    segment(nodeId); segment(uploadId); head(expectedHead);
    return this.#request(`/v1/projects/${segment(projectId)}/draft/save`, "POST", signal,
      { expected_head: expectedHead, message: "Edit document", changes: [{ node_id: nodeId, upload_id: uploadId }] });
  }
  async checkTrackerAssignee(project:string,node:string,head:string,principal:string,signal?:AbortSignal):Promise<void>{
    if(!/^[a-f0-9]{64}$/.test(head)||!principal||principal.length>255)throw new MnemosAPIError(400);
    const result=await this.#request<{head:string;principal_id:string}>(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/tracker-assignee?expected_head=${head}&principal_id=${encodeURIComponent(principal)}`,"GET",signal);
    if(result.head!==head||result.principal_id!==principal)throw new MnemosAPIError(502);
  }
  async listPrivateDraftParticipants(project: string, node: string, expectedHead: string, cursor: string, signal?: AbortSignal): Promise<PrivateParticipantPage> {
    head(expectedHead);
    if (typeof cursor !== "string" || cursor.length > 512) throw new MnemosAPIError(400);
    const page = await this.#request<PrivateParticipantPage>(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/participants?expected_head=${expectedHead}&cursor=${encodeURIComponent(cursor)}`, "GET", signal);
    if (page.head !== expectedHead || !Array.isArray(page.participants) || page.participants.length > 50) throw new MnemosAPIError(502);
    return page;
  }
  async setPrivateDraftParticipant(project: string, node: string, expectedHead: string, participant: string, expectedMode: PrivateParticipantMode, mode: PrivateParticipantMode, signal?: AbortSignal): Promise<{ participant_id: string; mode: PrivateParticipantMode }> {
    head(expectedHead);
    if (!["", "read", "write"].includes(expectedMode) || !["", "read", "write"].includes(mode)) throw new MnemosAPIError(400);
    const result = await this.#request<{participant_id: string; mode: PrivateParticipantMode}>(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/participants/${segment(participant)}`, "POST", signal,
      {expected_head: expectedHead, expected_mode: expectedMode, mode});
    if (result.participant_id !== participant || result.mode !== mode) throw new MnemosAPIError(502);
    return result;
  }
  async createPrivateDocument(projectId: string, request: PrivateDocumentCreate, signal?: AbortSignal): Promise<{ node_id: string; head: string }> {
    head(request.expected_head); segment(request.request_id); segment(request.upload_id);
    if (request.parent_id) segment(request.parent_id);
    if (!request.name || /[/\\\0]/.test(request.name) || new TextEncoder().encode(request.name).length > 255 ||
        !["application/pdf", "text/plain", "text/markdown", "text/csv", "application/octet-stream", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/json", "application/vnd.cloudflareos.document+json", "application/vnd.cloudflareos.spreadsheet+json", "application/vnd.cloudflareos.presentation+json", "application/vnd.mnemos.task-tracker+json", "application/vnd.mnemos.resource-map+json", "application/vnd.mnemos.blueprint-template+json"].includes(request.content_type)) throw new MnemosAPIError(400);
    const result = await this.#request<{ node_id: string; head: string }>(`/v1/projects/${segment(projectId)}/draft/create`, "POST", signal, request);
    try { segment(result.node_id); head(result.head); } catch { throw new MnemosAPIError(502); }
    return result;
  }
  listPublicationReviews(cursor = "", signal?: AbortSignal): Promise<PublicationReviewPage> {
    if (cursor) head(cursor);
    return this.#request(`/v1/publication-reviews${cursor ? `?cursor=${cursor}` : ""}`, "GET", signal);
  }
  beginReviewDownload(review: string, node: string, version: number, side: "before" | "after", signal?: AbortSignal): Promise<ReviewDownloadTicket> {
    head(review); segment(node);
    if (!Number.isSafeInteger(version) || version < 0 || (side !== "before" && side !== "after")) throw new MnemosAPIError(400);
    return this.#request(`/v1/publication-reviews/${review}/nodes/${segment(node)}/download`, "POST", signal, { expected_version: version, side });
  }
  withdrawPublicationReview(id: string, signal?: AbortSignal): Promise<void> {
    head(id);
    return this.#request(`/v1/publication-reviews/${id}/withdraw`, "POST", signal, {});
  }
  recordReviewDecision(id: string, domain: string, version: number, approved: boolean, signal?: AbortSignal): Promise<void> {
    head(id); segment(domain);
    if (!Number.isSafeInteger(version) || version < 0 || typeof approved !== "boolean") throw new MnemosAPIError(400);
    return this.#request(`/v1/publication-reviews/${id}/decisions`, "POST", signal,
      { domain_id: domain, expected_version: version, approved });
  }
  readPublicationPolicy(project: string, signal?: AbortSignal): Promise<PublicationPolicy> {
    return this.#request(`/v1/projects/${segment(project)}/publication-policy`, "GET", signal);
  }
  listPolicyApprovers(project: string, cursor = "", signal?: AbortSignal): Promise<PolicyApproverPage> {
    return this.#request(`/v1/projects/${segment(project)}/publication-policy/approvers${cursor ? `?cursor=${segment(cursor)}` : ""}`, "GET", signal);
  }
  setPublicationPolicy(project: string, revision: number, domains: PolicyDomain[], signal?: AbortSignal): Promise<{ revision: number }> {
    if (!Number.isSafeInteger(revision) || revision < 0 || !Array.isArray(domains) || domains.length === 0) throw new MnemosAPIError(400);
    const body = { expected_revision: revision, domains };
    if (new TextEncoder().encode(JSON.stringify(body)).length > 1048576) throw new MnemosAPIError(400);
    return this.#request(`/v1/projects/${segment(project)}/publication-policy`, "PUT", signal, body);
  }
  readPublicationReview(id: string, signal?: AbortSignal): Promise<PublicationReview> {
    head(id);
    return this.#request(`/v1/publication-reviews/${id}`, "GET", signal);
  }
  requestPublicationReview(projectId: string, personalHead: string, sharedHead: string, signal?: AbortSignal): Promise<{ candidate_id: string }> {
    head(personalHead); head(sharedHead);
    return this.#request(`/v1/projects/${segment(projectId)}/reviews`, "POST", signal,
      { personal_head: personalHead, shared_head: sharedHead });
  }
  publishDraft(projectId: string, expectedHead: string, sharedHead: string, message: string, signal?: AbortSignal): Promise<PublicationResult> {
    head(expectedHead); head(sharedHead);
    if (typeof message !== "string" || new TextEncoder().encode(message).length > 4096) throw new MnemosAPIError(400);
    return this.#request(`/v1/projects/${segment(projectId)}/draft/publish`, "POST", signal,
      { expected_head: expectedHead, expected_shared_head: sharedHead, message });
  }
  beginTextUpload(projectId: string, size: number, checksum: string, signal?: AbortSignal): Promise<UploadTicket> {
    return this.#beginUpload(projectId, size, checksum, 262144, signal);
  }
  /** Bounded source capture; native parsing has its own smaller upload limit. */
  beginVoiceUpload(project:string,size:number,checksum:string,signal?:AbortSignal):Promise<UploadTicket>{return this.#beginUpload(project,size,checksum,20_000_000,signal);}
  beginImportUpload(projectId: string, size: number, checksum: string, signal?: AbortSignal): Promise<UploadTicket> {
    return this.#beginUpload(projectId, size, checksum, 16 * 1024 * 1024, signal);
  }
  beginProjectUpload(projectId: string, size: number, checksum: string, signal?: AbortSignal): Promise<UploadTicket> {
    return this.#beginUpload(projectId, size, checksum, 64 * 1024 * 1024, signal);
  }
  beginNativeUpload(projectId: string, size: number, checksum: string, signal?: AbortSignal): Promise<UploadTicket> {
    return this.#beginUpload(projectId, size, checksum, 4 * 1024 * 1024, signal);
  }
  #beginUpload(projectId: string, size: number, checksum: string, maxBytes: number, signal?: AbortSignal): Promise<UploadTicket> {
    segment(projectId);
    if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes || typeof checksum !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(checksum)) throw new MnemosAPIError(400);
    return this.#request("/v1/uploads", "POST", signal, { project_id: projectId, size_bytes: size, checksum_sha256: checksum });
  }
  searchProject(projectId: string, query: string, limit = 20, signal?: AbortSignal): Promise<ProjectSearchPage> {
    segment(projectId);
    if (typeof query !== "string" || !query.trim() || new TextEncoder().encode(query).length > 4096 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new MnemosAPIError(400);
    const params = new URLSearchParams({ project_id: projectId, q: query, limit: String(limit) });
    return this.#request(`/v1/search?${params}`, "GET", signal);
  }
  createProject(name: string, slug: string, signal?: AbortSignal): Promise<{project: ProjectPage["projects"][number]}> {
    return this.#request("/v1/projects", "POST", signal, {name, slug});
  }
  /** Проект с внутренним репозиторием: дерево папки ложится первым коммитом. Запись в хранилище кода идёт дольше обычного запроса. */
  createCodeProject(name: string, slug: string, files: CodeProjectFile[], signal?: AbortSignal): Promise<CodeProjectResult> {
    if (typeof name !== "string" || !name.trim() || typeof slug !== "string" || !Array.isArray(files) || files.length === 0 || files.length > CODE_PROJECT_LIMITS.files) throw new MnemosAPIError(400);
    let total = 0;
    const body = files.map(file => {
      if (!file || typeof file.path !== "string" || !file.path || !(file.content instanceof Uint8Array) || file.content.length > CODE_PROJECT_LIMITS.fileBytes) throw new MnemosAPIError(400);
      total += file.content.length;
      if (total > CODE_PROJECT_LIMITS.totalBytes) throw new MnemosAPIError(400);
      return { path: file.path, content_base64: base64(file.content) };
    });
    return this.#request("/v1/code-projects", "POST", signal, { name, slug, files: body }, false, 180_000);
  }
  /** Поиск по всем проектам, доступным человеку; проект у каждого совпадения свой. */
  searchAll(query: string, limit = 20, signal?: AbortSignal): Promise<ProjectSearchPage> {
    if (typeof query !== "string" || !query.trim() || new TextEncoder().encode(query).length > 4096 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new MnemosAPIError(400);
    return this.#request(`/v1/search?${new URLSearchParams({ q: query, limit: String(limit) })}`, "GET", signal);
  }
  /** Окно документа: фрагмент ordinal и radius соседей с каждой стороны, не больше maxBytes. */
  readProjectDocumentWindow(projectId: string, nodeId: string, ordinal: number, radius: number, maxBytes = 262144, signal?: AbortSignal): Promise<DocumentContent> {
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || !Number.isSafeInteger(radius) || radius < 1 || radius > 50 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 262144) throw new MnemosAPIError(400);
    return this.#request(`/v1/projects/${segment(projectId)}/nodes/${segment(nodeId)}/content?${new URLSearchParams({ ordinal: String(ordinal), radius: String(radius), max_bytes: String(maxBytes) })}`, "GET", signal);
  }
  workshopAdminOperation(binding: string, operation: string, phase: "prepare" | "approve" | "reject" | "execute", request: import("./admin-operations.ts").AdminOperationRequest, signal?: AbortSignal): Promise<import("./admin-operations.ts").AdminOperation> {
    return this.#request(`/v1/agent-connections/${segment(binding)}/admin-operations/${segment(operation)}/${phase}`, "POST", signal, request);
  }
  readWorkshopAgentScope(binding: string, signal?: AbortSignal) { return this.#request<WorkshopAgentConnection>(`/v1/agent-connections/${segment(binding)}/workshop-scope`, "GET", signal); }
  updateWorkshopAgentScope(binding: string, expected: string[], projects: string[], signal?: AbortSignal) {
    return this.#request<WorkshopAgentConnection>(`/v1/agent-connections/${segment(binding)}/workshop-scope`, "POST", signal, {expected_project_ids: expected, project_ids: projects});
  }
  /** Public MCP address of this account's configured service; contains no credential. */
  /** Human administrator grant for an explicitly selected agent and project. */
  setAgentProjectRight(principal: string, project: string, mode: 'read' | 'write', enabled: boolean, signal?: AbortSignal) {
    segment(principal); segment(project);
    if (!['read','write'].includes(mode) || typeof enabled !== 'boolean') throw new MnemosAPIError(400);
    return this.#request('/v1/admin/rights' + (enabled ? '' : '/remove'), 'POST', signal, {kind:'anchor',principal_id:principal,project_id:project,class:'filesystem',mode});
  }
  externalAgentSetup() { return {resource: this.#origin + '/mcp', clientId: 'mnemos-cli'}; }
  whoAmI(signal?: AbortSignal): Promise<WhoAmI> {
    return this.#request("/v1/whoami", "GET", signal);
  }
  async readTelegramBudget(id:string,signal?:AbortSignal):Promise<TelegramBudgetSettings>{
    const out=await this.#request<TelegramBudgetSettings>('/v1/telegram-channels/'+segment(id)+'/budget','GET',signal);
    return checkedTelegramBudget(out);
  }
  async setTelegramBudget(id:string,expected:number,input:Omit<TelegramBudgetSettings,'revision'>,confirmed:boolean,signal?:AbortSignal):Promise<TelegramBudgetSettings>{
    if(!Number.isSafeInteger(expected)||expected<0||expected>=Number.MAX_SAFE_INTEGER||confirmed!==true)throw new MnemosAPIError(400);
    const selection={project_id:input.project_id,policy_revision:input.policy_revision,limit_usd_micros:input.limit_usd_micros,...(input.voice_binding_id!==undefined||input.voice_limit_usd_micros!==undefined?{voice_binding_id:input.voice_binding_id,voice_limit_usd_micros:input.voice_limit_usd_micros}:{})};
    try{checkedTelegramBudget({revision:expected+1,...selection});}catch{throw new MnemosAPIError(400);}
    const out=checkedTelegramBudget(await this.#request<TelegramBudgetSettings>('/v1/telegram-channels/'+segment(id)+'/budget','POST',signal,{expected_revision:expected,...selection,confirmed:true}));
    if(out.revision!==expected+1||out.project_id!==selection.project_id||out.policy_revision!==selection.policy_revision||out.limit_usd_micros!==selection.limit_usd_micros||(out.voice_binding_id??'')!==(selection.voice_binding_id??'')||(out.voice_limit_usd_micros??'0')!==(selection.voice_limit_usd_micros??'0'))throw new MnemosAPIError(502);
    return out;
  }
  async readVoiceSource(request:string,signal?:AbortSignal){
    if(!voiceID(request))throw new MnemosAPIError(400);
    const value=voiceRecord(await this.#request('/v1/voice-sources/'+segment(request),'GET',signal));
    if(!voiceID(value.project_id)||typeof value.media_type!=='string'||!/^audio\/[A-Za-z0-9.+-]{1,100}$/.test(value.media_type)||typeof value.size_bytes!=='number'||value.size_bytes>20_000_000)throw new MnemosAPIError(502);
    return checkedVoiceSource(value,request,value.project_id,value.media_type);
  }
  async downloadVoiceSource(input:VoiceSource,signal?:AbortSignal){
    const source={...input};return checkedVoiceDownload(await this.#request('/v1/voice-sources/'+segment(source.request_id)+'/download','POST',signal,{}),source);
  }
  async importVoiceSource(request:string,project:string,upload:string,mime:string,signal?:AbortSignal){
    if(!voiceID(request)||!voiceID(project)||!voiceID(upload)||!/^audio\/[A-Za-z0-9.+-]{1,100}$/.test(mime))throw new MnemosAPIError(400);
    return checkedVoiceSource(await this.#request('/v1/voice-sources','POST',signal,{request_id:request,project_id:project,upload_id:upload,media_type:mime}),request,project,mime);
  }
  async readVoiceTranscript(source:string,revision:number,signal?:AbortSignal){
    if(!voiceRevision(revision))throw new MnemosAPIError(400);
    return checkedVoiceTranscript(await this.#request('/v1/voice-sources/'+segment(source)+'/transcripts/'+revision,'GET',signal),source,revision);
  }
  async editVoiceTranscript(source:string,input:VoiceEdit,signal?:AbortSignal){
    const body={operation_id:input.operation_id,expected_revision:input.expected_revision,text:input.text,uncertain:input.uncertain};
    if(!voiceID(body.operation_id)||!Number.isSafeInteger(body.expected_revision)||body.expected_revision<0||body.expected_revision>=Number.MAX_SAFE_INTEGER||typeof body.text!=='string'||!body.text.trim()||body.text.includes('\0')||new TextEncoder().encode(body.text).length>65536||typeof body.uncertain!=='boolean')throw new MnemosAPIError(400);
    const out=checkedVoiceTranscript(await this.#request('/v1/voice-sources/'+segment(source)+'/transcripts','POST',signal,body),source,body.expected_revision+1);
    if(out.kind!=='human'||out.operation_id!==body.operation_id||out.text!==body.text||out.uncertain!==body.uncertain)throw new MnemosAPIError(502);return out;
  }
  async confirmVoiceTranscript(source:string,input:VoiceConfirm,signal?:AbortSignal){
    const body={operation_id:input.operation_id,revision:input.revision,text_sha256:input.text_sha256,confirmed:input.confirmed};
    if(!voiceID(body.operation_id)||!voiceRevision(body.revision)||!voiceHash(body.text_sha256)||body.confirmed!==true)throw new MnemosAPIError(400);
    const out=checkedVoiceConfirmation(await this.#request('/v1/voice-sources/'+segment(source)+'/confirmations','POST',signal,body),source,body.operation_id);
    if(out.revision!==body.revision||out.text_sha256!==body.text_sha256)throw new MnemosAPIError(502);return out;
  }
  async readVoiceConfirmation(source:string,operation:string,signal?:AbortSignal){
    return checkedVoiceConfirmation(await this.#request('/v1/voice-sources/'+segment(source)+'/confirmations/'+segment(operation),'GET',signal),source,operation);
  }
  /** Human-owned source journal; each page is limited by the server to 25 messages. */
  telegramTaskJournal(id: string, after: number, signal?:AbortSignal):Promise<TelegramTaskJournal> {
    segment(id);
    if(!Number.isSafeInteger(after)||after < -1||after>Number.MAX_SAFE_INTEGER)throw new MnemosAPIError(400);
    return this.#request('/v1/telegram-channels/'+encodeURIComponent(id)+'/journal','POST',signal,{after});
  }
  registerTelegramChannel(input: TelegramChannelRegistration, signal?: AbortSignal): Promise<TelegramChannelInfo> {
    segment(input.request_id); segment(input.binding_id);
    if (!/^[1-9][0-9]{0,19}$/.test(input.bot_id) || !Number.isSafeInteger(input.sender_id) || input.sender_id < 1 ||
        !/^[a-f0-9]{64}$/.test(input.credential_sha256) || input.confirmed !== true) throw new MnemosAPIError(400);
    return this.#request('/v1/telegram-channels', 'POST', signal, {...input});
  }
  disableTelegramChannel(id: string, signal?: AbortSignal): Promise<{disabled: boolean}> {
    return this.#request(`/v1/telegram-channels/${segment(id)}/disable`, 'POST', signal, {});
  }
  /** Record a bounded readiness event through this verified human account. */
  recordUIReadiness(sample:UIReadinessSample, signal?:AbortSignal):Promise<void> {
    if (!isUIReadinessSample(sample)) throw new MnemosAPIError(400);
    return this.#request("/v1/me/ui-readiness","POST",signal,sample,true);
  }
  /** Send a sequenced diagnostic sample without identity or time overrides. */
  recordWorkspaceActivity(stream: string, sequence: number, active: boolean, signal?: AbortSignal): Promise<void> {
    if (!/^[a-f0-9]{32}$/.test(stream) || !Number.isSafeInteger(sequence) || sequence < 1 || typeof active !== "boolean") throw new MnemosAPIError(400);
    return this.#request("/v1/me/workspace-activity", "POST", signal, { stream_id: stream, sequence, active }, true);
  }
  /** Read tenant aggregates with explicit platform.metrics.read authority. */
  platformMetrics(signal?: AbortSignal): Promise<PlatformUsage> {
    return this.#request("/v1/platform/metrics", "GET", signal);
  }
  saveProjectSignalAssessment(project:string,request:string,profile:ProjectSignalProfile,signal?:AbortSignal):Promise<SavedSignalAssessment>{return this.#request(`/v1/projects/${segment(project)}/signal-assessments/${segment(request)}`,"POST",signal,profile);}
  readPublishedProjectSignals(project:string,signal?:AbortSignal):Promise<PublishedSignalAssessment>{return this.#request(`/v1/projects/${segment(project)}/published-signals`,"GET",signal);}
  publishProjectSignals(project:string,selection:SignalPublicationRequest,signal?:AbortSignal):Promise<SignalPublication>{return this.#request(`/v1/projects/${segment(project)}/published-signals`,"POST",signal,selection);}
  readProjectSignalAssessment(project:string,request:string,signal?:AbortSignal):Promise<SavedSignalAssessment>{return this.#request(`/v1/projects/${segment(project)}/signal-assessments/${segment(request)}`,"GET",signal);}
  assessProjectSignals(project:string,profile:ProjectSignalProfile,signal?:AbortSignal):Promise<ProjectSignalAssessment>{
    return this.#request(`/v1/projects/${segment(project)}/signal-assessment`,"POST",signal,profile);
  }
  listProjects(signal?: AbortSignal): Promise<ProjectPage> {
    return this.#request("/v1/projects", "GET", signal);
  }
  /** Сервер либо меняет видимость сразу, либо заводит запрос руководителю или администратору. */
  async setProjectVisibility(project: string, level: ProjectVisibility, canEdit: boolean, signal?: AbortSignal): Promise<ProjectVisibilityResult> {
    segment(project);
    if (!isProjectVisibility(level) || typeof canEdit !== "boolean") throw new MnemosAPIError(400);
    const out = await this.#request<unknown>(`/v1/projects/${segment(project)}/visibility`, "POST", signal, { level, can_edit: canEdit });
    if (!validVisibilityResult(out, project)) throw new MnemosAPIError(502);
    return out;
  }
  /** mine=false — ждущие моего решения; mine=true — мои собственные запросы. */
  async listShareRequests(mine: boolean, signal?: AbortSignal): Promise<{ requests: ShareRequest[] }> {
    if (typeof mine !== "boolean") throw new MnemosAPIError(400);
    const out = await this.#request<{ requests?: unknown }>(`/v1/share-requests${mine ? "?mine=true" : ""}`, "GET", signal);
    // Пустой список Go отдаёт как null.
    const requests = out?.requests ?? [];
    if (!Array.isArray(requests) || requests.length > 500 || !requests.every(validShareRequest)) throw new MnemosAPIError(502);
    return { requests };
  }
  async decideShareRequest(request: string, approve: boolean, signal?: AbortSignal): Promise<ShareRequest> {
    segment(request);
    if (typeof approve !== "boolean") throw new MnemosAPIError(400);
    const out = await this.#request<unknown>(`/v1/share-requests/${segment(request)}/decision`, "POST", signal, { approve });
    if (!validShareRequest(out) || out.request_id !== request) throw new MnemosAPIError(502);
    return out;
  }
  async readProjectSharingSettings(signal?: AbortSignal): Promise<ProjectSharingSettings> {
    try { return checkedSharingSettings(await this.#request<unknown>("/v1/organization/settings", "GET", signal)); }
    catch (error) { throw error instanceof MnemosAPIError ? error : new MnemosAPIError(502); }
  }
  async updateProjectSharingSettings(settings: ProjectSharingSettings, signal?: AbortSignal): Promise<ProjectSharingSettings> {
    let body: ProjectSharingSettings;
    try { body = checkedSharingSettings(settings); } catch { throw new MnemosAPIError(400); }
    const out = await this.#request<unknown>("/v1/organization/settings", "PUT", signal, body);
    if (!validSharingSettings(out) || JSON.stringify(checkedSharingSettings(out)) !== JSON.stringify(body)) throw new MnemosAPIError(502);
    return checkedSharingSettings(out);
  }
  /** Фотографии людей организации: ссылка на показ (presigned GET) и сумма тела. */
  async listPersonPhotos(signal?: AbortSignal): Promise<PersonPhoto[]> {
    const out = await this.#request<{ photos?: unknown }>("/v1/people/photos", "GET", signal);
    const photos = out?.photos ?? [];
    if (!Array.isArray(photos) || photos.length > 10000 || !photos.every(validPersonPhoto)) throw new MnemosAPIError(502);
    return photos;
  }
  /** Билет на PUT своей фотографии во временную зону хранилища; тело — не больше 512 КБ. */
  beginPersonPhotoUpload(size: number, checksum: string, signal?: AbortSignal): Promise<UploadTicket> {
    if (!Number.isSafeInteger(size) || size < 1 || size > PERSON_PHOTO_MAX_BYTES || typeof checksum !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(checksum)) throw new MnemosAPIError(400);
    return this.#request("/v1/me/photo", "POST", signal, { size_bytes: size, checksum_sha256: checksum });
  }
  /** Сделать загруженное тело своей фотографией; сервис сверяет сумму и тип по байтам. */
  async savePersonPhoto(uploadId: string, signal?: AbortSignal): Promise<PersonPhoto> {
    segment(uploadId);
    const out = await this.#request<unknown>("/v1/me/photo", "PUT", signal, { upload_id: uploadId });
    if (!validPersonPhoto(out)) throw new MnemosAPIError(502);
    return out;
  }
  /** Убрать фотографию: без principal — свою, с principal — чужую (только администратор). */
  async removePersonPhoto(principal = "", signal?: AbortSignal): Promise<void> {
    await this.#request(principal ? `/v1/people/${segment(principal)}/photo` : "/v1/me/photo", "DELETE", signal);
  }
  /** Отделы: администратору — все, остальным — отделы, где человек состоит. */
  async listOrgUnits(signal?: AbortSignal): Promise<OrgUnit[]> {
    const out = await this.#request<{ org_units?: unknown }>("/v1/org-units", "GET", signal);
    const units = out?.org_units ?? [];
    if (!Array.isArray(units) || units.length > 1000 || !units.every(validOrgUnit)) throw new MnemosAPIError(502);
    return units;
  }
  async createOrgUnit(name: string, signal?: AbortSignal): Promise<OrgUnit> {
    if (typeof name !== "string" || !name.trim() || name.length > 255) throw new MnemosAPIError(400);
    const out = await this.#request<unknown>("/v1/org-units", "POST", signal, { name: name.trim() });
    if (!validOrgUnit(out)) throw new MnemosAPIError(502);
    return out;
  }
  /** member=false убирает человека из отдела; head имеет смысл только вместе с member. */
  /** Удаление отдела: проекты отдела становятся личными, сотрудники остаются в организации без отдела. */
  async deleteOrgUnit(unit: string, signal?: AbortSignal): Promise<OrgUnitDeletion> {
    if (typeof unit !== "string" || !unit || unit.length > 255) throw new MnemosAPIError(400);
    const out = await this.#request<unknown>(`/v1/org-units/${segment(unit)}`, "DELETE", signal);
    const d = out as OrgUnitDeletion | null;
    const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
    if (!d || d.deleted !== true || !count(d.projects_made_private) || !count(d.requests_closed) || !count(d.invitations_revoked) || !count(d.members_removed)) throw new MnemosAPIError(502);
    return { deleted: true, projects_made_private: d.projects_made_private, requests_closed: d.requests_closed, invitations_revoked: d.invitations_revoked, members_removed: d.members_removed };
  }
  async setOrgUnitMember(unit: string, principal: string, member: boolean, head: boolean, signal?: AbortSignal): Promise<void> {
    segment(unit); segment(principal);
    if (typeof member !== "boolean" || typeof head !== "boolean") throw new MnemosAPIError(400);
    await this.#request(`/v1/org-units/${segment(unit)}/members`, "PUT", signal, { principal_id: principal, member, head: member && head });
  }
  async listInvitations(signal?: AbortSignal): Promise<OrganizationInvitation[]> {
    const out = await this.#request<{ invitations?: unknown }>("/v1/invitations", "GET", signal);
    const list = out?.invitations ?? [];
    if (!Array.isArray(list) || list.length > 200 || !list.every(validInvitation)) throw new MnemosAPIError(502);
    return list;
  }
  /** Код ссылки приходит только в ответе на создание. */
  /** Роль «Сотрудник» не передаётся: сервер без поля role её и подразумевает, а старый сервер поле не знает.
   * codeAgent — выдать приглашённому право «Агент кода»; без него поле не передаётся. */
  async createInvitation(email: string, displayName: string, orgUnit: string, role: InvitationRole = "employee", signal?: AbortSignal, codeAgent = false): Promise<OrganizationInvitation & { code: string }> {
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 320 ||
        typeof displayName !== "string" || displayName.length > 255 || typeof orgUnit !== "string" || orgUnit.length > 255 ||
        !INVITATION_ROLES.includes(role) || (role === "head" && !orgUnit)) throw new MnemosAPIError(400);
    const out = await this.#request<unknown>("/v1/invitations", "POST", signal, { email: email.trim(), display_name: displayName.trim(), org_unit_id: orgUnit, ...(role === "employee" ? {} : { role }), ...(codeAgent === true ? { code_agent: true } : {}) });
    const code = (out as { code?: unknown } | null)?.code;
    if (!validInvitation(out) || typeof code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(code)) throw new MnemosAPIError(502);
    return { ...out, code };
  }
  async revokeInvitation(id: string, signal?: AbortSignal): Promise<OrganizationInvitation> {
    const out = await this.#request<unknown>(`/v1/invitations/${segment(id)}/revoke`, "POST", signal);
    if (!validInvitation(out) || out.invitation_id !== id) throw new MnemosAPIError(502);
    return out;
  }
  browseProject(projectId: string, cursor = "", signal?: AbortSignal): Promise<NodePage> {
    return this.#request(`/v1/projects/${segment(projectId)}/nodes?cursor=${encodeURIComponent(cursor)}`, "GET", signal);
  }
  readProjectDocument(projectId: string, nodeId: string, maxBytes = 262144, signal?: AbortSignal): Promise<DocumentContent> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 262144) throw new MnemosAPIError(400);
    return this.#request(`/v1/projects/${segment(projectId)}/nodes/${segment(nodeId)}/content?whole=true&max_bytes=${maxBytes}`, "GET", signal);
  }
  downloadProjectDocument(projectId: string, nodeId: string, signal?: AbortSignal): Promise<ContentDownloadTicket> {
    return this.#request(`/v1/projects/${segment(projectId)}/nodes/${segment(nodeId)}/content?as=file`, "GET", signal);
  }
  checkPublicationRead(projectId: string, nodeId: string, eventId: string, signal?: AbortSignal): Promise<{ node_id: string; event_id: string }> {
    return this.#request(`/v1/projects/${segment(projectId)}/nodes/${segment(nodeId)}/history/${segment(eventId)}/access`, "GET", signal);
  }
  downloadPublication(projectId: string, nodeId: string, eventId: string, signal?: AbortSignal): Promise<PublicationDownloadTicket> {
    return this.#request(`/v1/projects/${segment(projectId)}/nodes/${segment(nodeId)}/history/${segment(eventId)}/download`, "POST", signal);
  }
  readDocument(nodeId: string, signal?: AbortSignal): Promise<DocumentContent> {
    return this.#request(`/v1/nodes/${segment(nodeId)}/content?whole=true&max_bytes=262144`, "GET", signal);
  }
  previewAgentConsent(id: string, signal?: AbortSignal): Promise<AgentConsentPreview> {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(id)) throw new MnemosAPIError(400);
    return this.#request(`/v1/agent-authorizations/${id}`, "GET", signal);
  }
  /** projectIds не передан — сервер отдаёт агенту все проекты, видимые человеку. */
  decideAgentConsent(id: string, preview: AgentConsentPreview, approved: boolean, signal?: AbortSignal, projectIds?: string[]): Promise<{ redirect_uri: string; binding_id?: string }> {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(id) || typeof approved !== "boolean") throw new MnemosAPIError(400);
    if (projectIds !== undefined && (!Array.isArray(projectIds) || projectIds.length > 100 || !projectIds.every(p => typeof p === "string" && !!p && p.length <= 255))) throw new MnemosAPIError(400);
    return this.#request(`/v1/agent-authorizations/${id}`, "POST", signal, {
      expected_client_id: preview.client_id, expected_resource: preview.resource,
      expected_scopes: preview.scopes, approved,
      ...(projectIds !== undefined ? { project_ids: projectIds } : {}),
    });
  }
  runAgentTask(bindingId: string, requestId: string, message: string, criteria: string, signal?: AbortSignal): Promise<AgentTaskOutcome> {
    if (typeof requestId !== "string" || !requestId || requestId.length > 255 || typeof message !== "string" || !message.trim() || new TextEncoder().encode(message).length > 12000) throw new MnemosAPIError(400);
    if (typeof criteria !== "string" || !criteria.trim() || new TextEncoder().encode(criteria).length > 3000 || new TextEncoder().encode(JSON.stringify({task: message, acceptance_criteria: criteria})).length > 12000) throw new MnemosAPIError(400);
    return this.#request(`/v1/agent-connections/${segment(bindingId)}/tasks`, "POST", signal, { request_id: requestId, message, criteria });
  }
  readAgentTask(bindingId: string, requestId: string, signal?: AbortSignal): Promise<AgentTaskOutcome> {
    return this.#request(`/v1/agent-connections/${segment(bindingId)}/tasks/${segment(requestId)}`, "GET", signal);
  }
  provisionManagedAgent(requestId: string, templateId: string, signal?: AbortSignal): Promise<AgentConnectionPage["connections"][number]> {
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(requestId) || typeof templateId !== "string" || !templateId.trim() || templateId.length > 255) throw new MnemosAPIError(400);
    return this.#request("/v1/agent-connections/provision", "POST", signal, { request_id: requestId, template_id: templateId });
  }
  readCorporateOrigin(project:string,node:string,head:string,signal?:AbortSignal):Promise<CorporateOrigin|null>{return this.#request(`/v1/projects/${segment(project)}/nodes/${segment(node)}/private-versions/${segment(head)}/corporate-origin`,"GET",signal);}
  prepareJiraTask(project:string,node:string,head:string,issue:string,signal?:AbortSignal):Promise<JiraTaskPrepared>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/jira/task-preview`,"POST",signal,{expected_head:head,issue_id:issue,mode:"review"});}
  prepareCorporateWorkflow(project:string,node:string,head:string,provider:string,plan:unknown,sha:string,confirmed:boolean,signal?:AbortSignal):Promise<JiraTaskPrepared>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/corporate-workflow-prepare`,"POST",signal,{expected_head:head,provider,plan,expected_output_sha256:sha,confirm_shared_visibility:confirmed});}
  previewCorporateWorkflow(project:string,node:string,head:string,provider:string,plan:unknown,signal?:AbortSignal):Promise<import("./corporate-import.ts").CorporateWorkflowPreview>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/corporate-workflow-preview`,"POST",signal,{expected_head:head,provider,plan});}
  readJiraLinks(project:string,node:string,head:string,signal?:AbortSignal):Promise<import("./corporate-import.ts").CorporateLinks>{return this.#request(`/v1/projects/${segment(project)}/nodes/${segment(node)}/private-versions/${segment(head)}/jira/links`,"GET",signal);}
  resolveCorporateTarget(project:string,node:string,head:string,kind:string,entity:string,signal?:AbortSignal):Promise<{node_id:string}>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/corporate-target`,"POST",signal,{expected_head:head,kind,entity_id:entity});}
  prepareMappedBitrixTask(project:string,node:string,head:string,issue:string,mapping:BitrixTaskMapping,signal?:AbortSignal):Promise<JiraTaskPrepared>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/bitrix/task-preview`,"POST",signal,{expected_head:head,entity_id:issue,mode:"mapped",mapping,grant_assignee_read:true});}
  prepareMappedJiraTask(project:string,node:string,head:string,issue:string,mapping:BitrixTaskMapping,signal?:AbortSignal):Promise<JiraTaskPrepared>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/jira/mapped-task-preview`,"POST",signal,{expected_head:head,entity_id:issue,mode:"mapped",mapping,grant_assignee_read:true});}
  prepareJiraFile(project:string,node:string,head:string,issue:string,attachment:string,signal?:AbortSignal):Promise<CorporateFilePrepared>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/jira/file-preview`,"POST",signal,{expected_head:head,issue_id:issue,attachment_id:attachment,mode:"copy"});}
  prepareBitrixFile(project:string,node:string,head:string,object:string,signal?:AbortSignal):Promise<CorporateFilePrepared>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/bitrix/file-preview`,"POST",signal,{expected_head:head,entity_id:object,mode:"copy"});}
  prepareBitrixRecord(project:string,node:string,head:string,kind:string,issue:string,signal?:AbortSignal):Promise<JiraTaskPrepared>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/bitrix/record-preview`,"POST",signal,{expected_head:head,kind,entity_id:issue,mode:"copy"});}
  previewJiraImport(project:string,node:string,head:string,signal?:AbortSignal):Promise<JiraImportPreview>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/jira/import-preview`,"POST",signal,{expected_head:head});}
  prepareBitrixRecordUpdate(project:string,node:string,head:string,incomingNode:string,incomingHead:string,resolution?:CorporateUpdateResolution,signal?:AbortSignal):Promise<CorporateRecordUpdatePreview>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/bitrix/update-prepare`,"POST",signal,{expected_head:head,incoming_node_id:incomingNode,incoming_head:incomingHead,...(resolution?{resolution}:{})});}
  applyCorporateUpdate(project:string,node:string,request:{request_id:string;preview_id:string;upload_id:string},signal?:AbortSignal):Promise<{node_id:string;head:string}>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/corporate-update`,"POST",signal,request);}
  resolveBitrixRecordUpdate(project:string,node:string,head:string,incomingNode:string,incomingHead:string,resolution:CorporateUpdateResolution,signal?:AbortSignal):Promise<CorporateRecordUpdatePreview>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/bitrix/update-preview`,"POST",signal,{expected_head:head,incoming_node_id:incomingNode,incoming_head:incomingHead,resolution});}
  previewBitrixRecordUpdate(project:string,node:string,head:string,incomingNode:string,incomingHead:string,signal?:AbortSignal):Promise<CorporateRecordUpdatePreview>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/bitrix/update-preview`,"POST",signal,{expected_head:head,incoming_node_id:incomingNode,incoming_head:incomingHead});}
  previewBitrixDepartmentMembership(project:string,node:string,head:string,selection:import("./corporate-import.ts").BitrixDepartmentSelection,signal?:AbortSignal):Promise<import("./corporate-import.ts").BitrixDepartmentPreview>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/bitrix/department-membership`,"POST",signal,{expected_head:head,selection});}
  applyBitrixDepartmentMembership(project:string,node:string,head:string,selection:import("./corporate-import.ts").BitrixDepartmentSelection,decision:{expected_generation:number;expected_enabled:boolean;enabled:boolean},signal?:AbortSignal):Promise<import("./corporate-import.ts").BitrixDepartmentPreview>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/bitrix/department-membership`,"PUT",signal,{expected_head:head,selection,...decision});}
  previewBitrixImport(project:string,node:string,head:string,signal?:AbortSignal):Promise<BitrixImportPreview>{return this.#request(`/v1/projects/${segment(project)}/draft/nodes/${segment(node)}/bitrix/import-preview`,"POST",signal,{expected_head:head});}
  listVisibleDatabaseConnections(signal?:AbortSignal):Promise<{databases:DatabaseConnection[];truncated:boolean}>{return this.#request("/v1/databases","GET",signal);}
  listDatabaseConnections(project:string,signal?:AbortSignal):Promise<{databases:DatabaseConnection[]}>{return this.#request(`/v1/projects/${segment(project)}/databases`,"GET",signal);}
  registerDatabaseConnection(project:string,input:DatabaseRegistration,signal?:AbortSignal):Promise<{database:DatabaseConnection}>{return this.#request(`/v1/projects/${segment(project)}/databases`,"POST",signal,input);}
  removeDatabaseConnection(project:string,name:string,signal?:AbortSignal):Promise<{removed:boolean}>{return this.#request(`/v1/projects/${segment(project)}/databases?${new URLSearchParams({name})}`,"DELETE",signal);}
  readOperationAudit(after:number,signal?:AbortSignal):Promise<OperationAuditPage>{if(!Number.isSafeInteger(after)||after<0)throw Error("Invalid audit cursor");return this.#request(`/v1/admin/audit?${new URLSearchParams({after:String(after),limit:"100"})}`,"GET",signal);}
  /** Страница журнала операций с выбранным размером (сервер допускает до 1000 записей). */
  readOperationAuditPage(after:number,limit:number,signal?:AbortSignal):Promise<OperationAuditPage>{if(!Number.isSafeInteger(after)||after<0)throw Error("Invalid audit cursor");if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error("Invalid audit limit");return this.#request(`/v1/admin/audit?${new URLSearchParams({after:String(after),limit:String(limit)})}`,"GET",signal);}
  /** Журнал работ проекта: итоги принятых работ, от новых к старым; курсор — из прошлой страницы. */
  listWorkJournal(project:string,cursor="",limit=0,signal?:AbortSignal):Promise<WorkJournalPage>{const q=new URLSearchParams();if(cursor)q.set("cursor",cursor);if(limit)q.set("limit",String(limit));const query=q.toString();return this.#request(`/v1/projects/${segment(project)}/work-journal${query?`?${query}`:""}`,"GET",signal);}
  readGitFile(project:string,connection:string,repository:string,commit:string,path:string,signal?:AbortSignal):Promise<GitFile>{return this.#request(`/v1/projects/${segment(project)}/git/${segment(connection)}/repositories/${segment(repository)}/file?${new URLSearchParams({commit,path})}`,"GET",signal);}
  readGitCommit(project:string,connection:string,repository:string,ref:string,signal?:AbortSignal):Promise<GitCommit>{return this.#request(`/v1/projects/${segment(project)}/git/${segment(connection)}/repositories/${segment(repository)}/commit?${new URLSearchParams({ref})}`,"GET",signal);}
  async readGitTree(project:string,connection:string,repository:string,commit:string,path="",signal?:AbortSignal):Promise<GitTree>{const q=new URLSearchParams({commit});if(path)q.set("path",path);return checkedGitTree(await this.#request(`${gitRepositoryPath(project,connection,repository)}/tree?${q}`,"GET",signal));}
  async listGitBranches(project:string,connection:string,repository:string,page=1,signal?:AbortSignal):Promise<GitBranchPage>{return checkedGitBranches(await this.#request(`${gitRepositoryPath(project,connection,repository)}/branches?${new URLSearchParams({page:String(page)})}`,"GET",signal));}
  async readGitLog(project:string,connection:string,repository:string,ref:string,path="",page=1,signal?:AbortSignal):Promise<GitLogPage>{const q=new URLSearchParams({ref,page:String(page)});if(path)q.set("path",path);return checkedGitLog(await this.#request(`${gitRepositoryPath(project,connection,repository)}/log?${q}`,"GET",signal));}
  async compareGitRefs(project:string,connection:string,repository:string,base:string,head:string,signal?:AbortSignal):Promise<GitComparison>{return checkedGitComparison(await this.#request(`${gitRepositoryPath(project,connection,repository)}/compare?${new URLSearchParams({base,head})}`,"GET",signal));}
  /** Описания L0/L1 проекта или узла и краткие описания видимых детей. */
  async readProjectOverview(project:string,node="",signal?:AbortSignal):Promise<ProjectOverview>{const value:ProjectOverview=await this.#request(`/v1/projects/${segment(project)}/overview${node?`?${new URLSearchParams({node})}`:""}`,"GET",signal);if(!value||!Array.isArray(value.children)||typeof value.pending!=="boolean")throw new MnemosAPIError(502);return value;}
  async readOwnedGitBinding(project:string,connection:string,repository:string,signal?:AbortSignal):Promise<GitBindingState>{
    const state=await this.#request<GitBindingState>(`/v1/projects/${segment(project)}/git/${segment(connection)}/repositories/${segment(repository)}/binding`,"GET",signal);
    // Only the configured Mnemos origin can receive the agent credential. A
    // provider response or saved account label cannot substitute a gateway.
    delete state.push_url;delete state.mcp_resource;
    if(state.push_path){
      const encoded=state.push_path.match(/^\/git-push\/([A-Za-z0-9_-]{1,1100})$/)?.[1];
      if(!encoded||!state.binding?.enabled||state.binding.project_id!==project||state.binding.connection_id!==connection||state.binding.repository_id!==repository)throw new MnemosAPIError(502);
      let coords:unknown;try{coords=JSON.parse(new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(Uint8Array.from(atob(encoded.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0))));}catch{throw new MnemosAPIError(502);}
      if(!Array.isArray(coords)||coords.length!==3||coords[0]!==project||coords[1]!==connection||coords[2]!==repository)throw new MnemosAPIError(502);
      state.push_url=this.#origin+state.push_path;state.mcp_resource=this.#origin+"/mcp";
    }
    return state;
  }
  /** Внутренний механизм «Принять»: работа агента из его ветки предлагается в основную ветку. */
  openMergeRequest(project:string,connection:string,repository:string,head:string,title:string,body:string,signal?:AbortSignal):Promise<MergeRequestView>{return this.#request(`${gitRepositoryPath(project,connection,repository)}/merge-requests`,"POST",signal,{head,title,body});}
  /** Вливает, если человек может принять; иначе сервер отправляет ответственному (outcome awaiting_approval). */
  acceptMergeRequest(project:string,connection:string,repository:string,index:number,expectedHead:string,signal?:AbortSignal):Promise<MergeRequestView>{if(!Number.isSafeInteger(index)||index<1)throw new MnemosAPIError(400);return this.#request(`${gitRepositoryPath(project,connection,repository)}/merge-requests/${index}/accept`,"POST",signal,{expected_head:expectedHead});}
  /** «Вернуть как было»: отменяет принятые изменения (outcome reverted). */
  revertMergeRequest(project:string,connection:string,repository:string,index:number,signal?:AbortSignal):Promise<MergeRequestView>{if(!Number.isSafeInteger(index)||index<1)throw new MnemosAPIError(400);return this.#request(`${gitRepositoryPath(project,connection,repository)}/merge-requests/${index}/revert`,"POST",signal,{});}
  listProjectGitRepositories(project:string,cursor="",signal?:AbortSignal):Promise<GitProjectRepositoryPage>{return this.#request(`/v1/projects/${segment(project)}/git-repositories?cursor=${encodeURIComponent(cursor)}&limit=25`,"GET",signal);}
  bindGitRepository(project:string,connection:string,repository:string,input:GitRepositorySelection,signal?:AbortSignal):Promise<Omit<GitProjectRepository,"provider"|"connection_revision">>{return this.#request(`/v1/projects/${segment(project)}/git/${segment(connection)}/repositories/${segment(repository)}`,"POST",signal,input);}
  listGitConnections(cursor="",signal?:AbortSignal):Promise<GitConnectionPage>{return this.#request(`/v1/git/connections?cursor=${encodeURIComponent(cursor)}`,"GET",signal);}
  readGitConnection(id:string,signal?:AbortSignal):Promise<GitConnection>{return this.#request(`/v1/git/connections/${segment(id)}`,"GET",signal);}
  /** Current subject's staging reservations; owners cannot be selected by callers. */
  uploadUsage(signal?:AbortSignal):Promise<unknown>{return this.#request('/v1/uploads/usage','GET',signal);}
  rebuildCentroid(project:string,request:string,signal?:AbortSignal):Promise<CentroidResult>{return this.#request(`/v1/projects/${segment(project)}/centroid-requests/${segment(request)}`,'POST',signal);}
  reindexInventory(projects:string[],history:boolean,signal?:AbortSignal):Promise<ReindexInventory>{return this.#request('/v1/index/reindex-inventory','POST',signal,{project_ids:projects,history});}
  reindexRevisions(node:string,signal?:AbortSignal):Promise<{revisions:number[];through:number;next_after:number;truncated:boolean}>{return this.#request(`/v1/nodes/${segment(node)}/revisions`,"GET",signal);}
  reindexRevision(node:string,revision:number,request:string,signal?:AbortSignal):Promise<ReindexResult>{return this.#request(`/v1/nodes/${segment(node)}/revisions/${revision}/reindex-requests/${segment(request)}`,"POST",signal);}
  policyAlerts(after="",all=false,signal?:AbortSignal):Promise<PolicyAlertPage>{return this.#request(`/v1/admin/policy-alerts?after=${encodeURIComponent(after)}&limit=100&include_reviewed=${all}`,"GET",signal);}
  reviewPolicyAlert(id:string,note:string,signal?:AbortSignal):Promise<{reviewed:boolean}>{return this.#request(`/v1/admin/policy-alerts/${segment(id)}/review`,"POST",signal,{note});}
  platformSignalInbox(before="",signal?:AbortSignal):Promise<PlatformSignalInbox>{return this.#request(`/v1/me/platform-notifications${before?`?before=${encodeURIComponent(before)}`:""}`,"GET",signal);}
  readPlatformSignalNotification(id:string,signal?:AbortSignal):Promise<PlatformSignalInbox>{return this.#request(`/v1/me/platform-notifications/${segment(id)}/read`,"POST",signal,{});}
  listPlatformSignalOwners(signal?:AbortSignal):Promise<PlatformSignalOwnerPage>{return this.#request("/v1/admin/platform-signal-owners","GET",signal);}
  setPlatformSignalOwner(key:string,decision:{owner_id:string;expected_generation:number;expected_revision:number},signal?:AbortSignal):Promise<PlatformSignalOwnerPage>{return this.#request(`/v1/admin/platform-signal-owners/${segment(key)}`,"PUT",signal,decision);}
  listOrganizationRoles(cursor:string,signal?:AbortSignal):Promise<OrganizationRolePage>{return this.#request(`/v1/admin/roles?cursor=${encodeURIComponent(cursor)}`,"GET",signal);}
  createOrganizationRole(input:{id:string;kind:"group"|"functional_role";name:string;expected_generation:number},signal?:AbortSignal):Promise<OrganizationRole>{return this.#request('/v1/admin/roles',"POST",signal,input);}
  readPrincipalMembership(container:string,member:string,signal?:AbortSignal):Promise<PrincipalMembership>{return this.#request(`/v1/admin/roles/${segment(container)}/members/${segment(member)}`,"GET",signal);}
  setPrincipalMembership(container:string,member:string,decision:{expected_generation:number;expected_enabled:boolean;enabled:boolean},signal?:AbortSignal):Promise<PrincipalMembership>{return this.#request(`/v1/admin/roles/${segment(container)}/members/${segment(member)}`,"PUT",signal,decision);}
  readCalendarGrantState(id:string,principal:string,signal?:AbortSignal):Promise<CalendarGrantState>{return this.#request(`/v1/calendar-connections/${segment(id)}/grants/${segment(principal)}`,"GET",signal);}
  readMailGrantState(id:string,principal:string,signal?:AbortSignal):Promise<MailGrantState>{return this.#request(`/v1/mail-connections/${segment(id)}/grants/${segment(principal)}`,"GET",signal);}
  listCalendarConnections(cursor='',signal?:AbortSignal):Promise<import('./calendar-connections.ts').CalendarConnectionPage>{return this.#request(`/v1/calendar-connections${cursor?'?cursor='+encodeURIComponent(cursor):''}`,"GET",signal);}
  readCalendarEvents(project:string,connection:string,query:import('./calendar-connections.ts').CalendarEventQuery,signal?:AbortSignal):Promise<import('./calendar-connections.ts').CalendarEventWindow>{return this.#request(`/v1/projects/${segment(project)}/calendars/${segment(connection)}/events`,"POST",signal,query);}
  readCalendarConnection(id:string,signal?:AbortSignal):Promise<CalendarConnectionInfo>{return this.#request(`/v1/calendar-connections/${segment(id)}`,"GET",signal);}
  readMailMessages(project:string,connection:string,query:import('./mail-connections.ts').MailMessageQuery,signal?:AbortSignal):Promise<import('./mail-connections.ts').MailMessagePage>{return this.#request(`/v1/projects/${segment(project)}/mail/${segment(connection)}/messages`,"POST",signal,query);}
  listMailConnections(cursor='',signal?:AbortSignal):Promise<import('./mail-connections.ts').MailConnectionPage>{return this.#request(`/v1/mail-connections?cursor=${encodeURIComponent(cursor)}`,"GET",signal);}
  readMailConnection(id:string,signal?:AbortSignal):Promise<MailConnectionInfo>{return this.#request(`/v1/mail-connections/${segment(id)}`,"GET",signal);}
  registerCalendarConnection(project:string,request:string,selection:string,signal?:AbortSignal):Promise<CalendarConnectionInfo>{return this.#request(`/v1/projects/${segment(project)}/calendars`,"POST",signal,{request_id:request,selection_id:selection});}
  registerMailConnection(project:string,request:string,selection:string,signal?:AbortSignal):Promise<MailConnectionInfo>{return this.#request(`/v1/projects/${segment(project)}/mail`,"POST",signal,{request_id:request,selection_id:selection});}
  setCalendarReadGrant(id:string,decision:CalendarGrantDecision,signal?:AbortSignal):Promise<{revision:number}>{return this.#request(`/v1/calendar-connections/${segment(id)}/grants`,"POST",signal,decision);}
  setMailReadGrant(id:string,decision:MailGrantDecision,signal?:AbortSignal):Promise<{revision:number}>{return this.#request(`/v1/mail-connections/${segment(id)}/grants`,"POST",signal,decision);}
  disableCalendarConnection(id:string,expected:number,signal?:AbortSignal):Promise<{disabled:boolean}>{return this.#request(`/v1/calendar-connections/${segment(id)}/disable`,"POST",signal,{expected_revision:expected});}
  disableMailConnection(id:string,expected:number,signal?:AbortSignal):Promise<{disabled:boolean}>{return this.#request(`/v1/mail-connections/${segment(id)}/disable`,"POST",signal,{expected_revision:expected});}
  registerGitConnection(input:GitRegistration,signal?:AbortSignal):Promise<GitConnection>{return this.#request("/v1/git/connections","POST",signal,input);}
  disableGitConnection(id:string,expected:number,signal?:AbortSignal):Promise<GitDisabled>{return this.#request(`/v1/git/connections/${segment(id)}/disable`,"POST",signal,{expected_revision:expected});}
  listGitRepositories(id:string,page=1,signal?:AbortSignal):Promise<GitRepositoryPage>{return this.#request(`/v1/git/connections/${segment(id)}/repositories?page=${page}`,"GET",signal);}
  /** Связи синхронизации с GitHub, видимые человеку. */
  async listGitSyncLinks(signal?:AbortSignal):Promise<GitSyncLinkPage>{return checkedGitSyncPage(await this.#request<unknown>("/v1/git/sync-links","GET",signal));}
  /** Связи синхронизации одного проекта. */
  async listProjectGitSync(project:string,signal?:AbortSignal):Promise<GitSyncLinkPage>{return checkedGitSyncPage(await this.#request<unknown>(`/v1/projects/${segment(project)}/git/sync`,"GET",signal));}
  createGitSyncLink(input:GitSyncLinkCreate,signal?:AbortSignal):Promise<GitSyncLink>{
    segment(input.project_id);segment(input.repository_id);
    if(input.source==="app"){segment(input.installation_id??"");if(input.connection_id)throw new MnemosAPIError(400);}
    else if(input.source==="connection"){segment(input.connection_id??"");if(input.installation_id)throw new MnemosAPIError(400);}
    else throw new MnemosAPIError(400);
    if(!input.repository_name||input.repository_name.length>255)throw new MnemosAPIError(400);
    checkGitSyncSettings(input);
    return this.#request("/v1/git/sync-links","POST",signal,input);
  }
  updateGitSyncLink(link:string,input:GitSyncLinkUpdate,signal?:AbortSignal):Promise<GitSyncLink>{
    if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)throw new MnemosAPIError(400);
    checkGitSyncSettings(input);
    return this.#request(`/v1/git/sync-links/${segment(link)}`,"PUT",signal,input);
  }
  /** Отключает связь; файлы, уже попавшие в проект, остаются. */
  deleteGitSyncLink(link:string,expectedRevision:number,signal?:AbortSignal):Promise<{deleted:boolean}>{
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw new MnemosAPIError(400);
    return this.#request(`/v1/git/sync-links/${segment(link)}?expected_revision=${expectedRevision}`,"DELETE",signal);
  }
  refreshGitSyncLink(link:string,signal?:AbortSignal):Promise<{queued:boolean}>{return this.#request(`/v1/git/sync-links/${segment(link)}/refresh`,"POST",signal,{});}
  /** «Создать проект» из репозитория: проект и связь заводятся на сервере одной операцией. */
  createProjectFromRepository(input:GitSyncProjectCreate,signal?:AbortSignal):Promise<{project:{id:string;name:string;visibility?:string};link:GitSyncLink}>{
    const name=input.name.trim();
    if(!name||new TextEncoder().encode(name).length>255)throw new MnemosAPIError(400);
    segment(input.repository_id);
    if(input.source==="app"){segment(input.installation_id??"");if(input.connection_id)throw new MnemosAPIError(400);}
    else if(input.source==="connection"){segment(input.connection_id??"");if(input.installation_id)throw new MnemosAPIError(400);}
    else throw new MnemosAPIError(400);
    if(!input.repository_name||input.repository_name.length>255)throw new MnemosAPIError(400);
    checkGitSyncSettings(input);
    return this.#request("/v1/git/sync-projects","POST",signal,{...input,name});
  }
  /** Репозитории, к которым установлено GitHub App; available=false — приложение на сервере не настроено. */
  listGitAppRepositories(signal?:AbortSignal):Promise<GitAppRepositoryPage>{return this.#request("/v1/git/app/repositories","GET",signal);}
  /** «Подключить GitHub»: адрес страницы установки приложения на GitHub с одноразовым state. */
  async startGitHubConnect(signal?:AbortSignal):Promise<{url:string}>{
    const value=await this.#request<unknown>("/v1/git/app/connect","POST",signal,{});
    const url=value&&typeof value==="object"&&"url" in value?value.url:undefined;
    if(typeof url!=="string"||!url.startsWith("https://")||url.length>2048)throw new MnemosAPIError(502);
    return {url};
  }
  /** Аккаунты GitHub, которые человек подключил: у каждого свои репозитории. */
  async listGitHubAccounts(signal?:AbortSignal):Promise<GitHubAccountPage>{return checkedGitHubAccounts(await this.#request<unknown>("/v1/git/app/accounts","GET",signal));}
  /** «Отключить» один аккаунт GitHub; его связи останавливаются, файлы остаются в проектах. */
  disconnectGitHubAccount(installation:string,signal?:AbortSignal):Promise<{disconnected:boolean}>{
    if(!/^[1-9][0-9]{0,18}$/.test(installation))throw new MnemosAPIError(400);
    return this.#request(`/v1/git/app/accounts/${installation}`,"DELETE",signal);
  }
  listAgentConnections(cursor = "", signal?: AbortSignal): Promise<AgentConnectionPage> {
    return this.#request(`/v1/agent-connections?limit=50&cursor=${encodeURIComponent(cursor)}`, "GET", signal);
  }
  revokeAgentConnection(bindingId: string, signal?: AbortSignal): Promise<unknown> {
    return this.#request(`/v1/agent-connections/${segment(bindingId)}/revoke`, "POST", signal);
  }
  /** Связь синглтона Workshop (S14): повтор с тем же request_id возвращает ту же связь. */
  provisionWorkshopAgent(requestId: string, connectionName: string, projectIds: string[], signal?: AbortSignal): Promise<WorkshopAgentConnection> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(requestId) || !connectionName.trim() || connectionName.length > 255 || projectIds.length === 0 || projectIds.length > 100) throw new MnemosAPIError(400);
    for (const project of projectIds) segment(project);
    return this.#request("/v1/agent-connections/workshop", "POST", signal, { request_id: requestId, connection_name: connectionName, project_ids: projectIds });
  }
  /** Короткоживущий credential агента по связи Workshop; значение не журналировать. */
  issueAgentCredential(bindingId: string, signal?: AbortSignal): Promise<AgentCredential> {
    return this.#request(`/v1/agent-connections/${segment(bindingId)}/credential`, "POST", signal);
  }
  nodeHistory(projectId: string, nodeId: string, cursor = "", limit = 50, signal?: AbortSignal): Promise<NodeHistoryPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new MnemosAPIError(400);
    return this.#request(`/v1/projects/${segment(projectId)}/nodes/${segment(nodeId)}/history?cursor=${encodeURIComponent(cursor)}&limit=${limit}`, "GET", signal);
  }
}
function segment(id: string): string {
  if (typeof id !== "string" || !id || id === "." || id === ".." || new TextEncoder().encode(id).length > 255 || /[\x00-\x1f\x7f]/.test(id)) throw new MnemosAPIError(400);
  return encodeURIComponent(id);
}
/** base64 кусками: String.fromCharCode(...bytes) на мегабайтах переполняет стек аргументов. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export const MEMORY_UNAVAILABLE_ERROR = "Mnemos selected memory unavailable";
export const QUERY_CAPACITY_ERROR = "Mnemos query capacity exceeded";
/** Согласование в проекте не требуется (409): политики нет либо она не задевает изменённые документы; публикуют напрямую. */
export const REVIEW_NOT_REQUIRED = "publication.review_not_required";
type FailureCode='agent.memory_unavailable'|'external_db.query_busy'|'request.rate_limit'|typeof REVIEW_NOT_REQUIRED|GitFailureCode|typeof INGEST_REFUSED|typeof UPLOAD_IN_PROGRESS|typeof HISTORY_PREPARING;
/** Публичная причина отказа приёмной политики: reason из закрытого перечня сервера, detail — готовый текст для человека. */
export interface IngestRefusal {reason:string;detail:string}
/** Текст с сервера показывается человеку: без управляющих символов и не длиннее абзаца. */
function publicText(value:unknown):string{return typeof value==='string'?[...value].filter(char=>char.charCodeAt(0)>=32).join('').trim().slice(0,600):'';}
async function safeFailureCode(response:Response):Promise<{code:FailureCode;refusal?:IngestRefusal;progress?:HistoryProgress}|undefined>{
 if(response.status!==400&&response.status!==409&&response.status!==422&&response.status!==429&&response.status!==503){await response.body?.cancel();return undefined;}
 // Отказ политики несёт готовый абзац по-русски, поэтому у 400 предел тела больше.
 const limit=response.status===400?4096:1024;
 const reader=response.body?.getReader();if(!reader)return undefined;
 try{const chunks:Uint8Array[]=[];let size=0;for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit){await reader.cancel();return undefined;}chunks.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const body:unknown=JSON.parse(new TextDecoder().decode(bytes));
  if(!body||typeof body!=='object'||!('code' in body))return undefined;
  const fields=body as {code:unknown;reason?:unknown;detail?:unknown;message?:unknown;progress?:unknown};
  if(response.status===400&&fields.code===INGEST_REFUSED){
   const reason=typeof fields.reason==='string'&&/^[a-z_]{1,32}$/.test(fields.reason)?fields.reason:'';
   return {code:INGEST_REFUSED,refusal:{reason,detail:publicText(fields.detail)||publicText(fields.message)}};
  }
  if(response.status===409&&fields.code==='agent.memory_unavailable')return {code:'agent.memory_unavailable'};
  if(response.status===409&&fields.code===REVIEW_NOT_REQUIRED)return {code:REVIEW_NOT_REQUIRED};
  if(response.status===429&&fields.code==='request.rate_limit')return {code:'request.rate_limit'};
  if(response.status===429&&fields.code==='external_db.query_busy')return {code:'external_db.query_busy'};
  if(response.status===429&&fields.code===UPLOAD_IN_PROGRESS)return {code:UPLOAD_IN_PROGRESS};
  // История проекта ещё переносится в граф ядра: ход — в progress, опрос ведёт оболочка.
  if(response.status===429&&fields.code===HISTORY_PREPARING)return {code:HISTORY_PREPARING,progress:historyProgress(fields.progress)};
  if(response.status!==400&&typeof fields.code==='string'&&(GIT_FAILURE_CODES as readonly string[]).includes(fields.code))return {code:fields.code as GitFailureCode};
 }catch{return undefined;}finally{reader.releaseLock();}
 return undefined;
}
/** Файл не принят приёмной политикой установки (400): повтор ничего не изменит. */
export const INGEST_REFUSED="ingest.refused_by_policy";
/** В проект ещё загружаются файлы (429): история проекта откроется позже, повтор допустим. */
export const UPLOAD_IN_PROGRESS="project.upload_in_progress";
export const UPLOAD_IN_PROGRESS_ERROR="В проект ещё загружаются файлы; повторите через несколько минут";
export const REQUEST_RATE_ERROR="Request rate limit exceeded";
/** Отказы операций с кодом, которые клиент показывает человеку своими словами. */
export const GIT_FAILURE_CODES=["git.merge.no_approver","git.merge.stale","git.merge.not_ready","git.merge.not_responsible","git.merge.not_approved","git.merge.revert_conflict","git.merge.revert_unsupported","git.unavailable"] as const;
export type GitFailureCode=typeof GIT_FAILURE_CODES[number];
export class MnemosAPIError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly refusal?: IngestRefusal;
  /** Ход переноса истории проекта при project.history_preparing. */
  readonly progress?: HistoryProgress;
  constructor(status: number,code?:FailureCode,refusal?:IngestRefusal,progress?:HistoryProgress) { super(code==="request.rate_limit"?REQUEST_RATE_ERROR:code==="agent.memory_unavailable"?MEMORY_UNAVAILABLE_ERROR:code==="external_db.query_busy"?QUERY_CAPACITY_ERROR:code===UPLOAD_IN_PROGRESS?UPLOAD_IN_PROGRESS_ERROR:code===HISTORY_PREPARING?historyPreparingMessage(progress??{done:0,total:0}):"Mnemos request failed"); this.status = status; if(code)this.code=code; if(refusal)this.refusal=refusal; if(code===HISTORY_PREPARING)this.progress=progress??{done:0,total:0}; }
}
export interface AgentConnectionPage { connections: { document_grants?: { project_id: string; node_id: string; resource_class: string; mode: string; granted_to: string }[]; binding_id: string; agent_principal_id: string; runtime_id: string; runtime_agent_id: string; managed_runtime?: boolean; revoked: boolean }[]; next_cursor?: string }
/** Запрос на слияние с человеческим состоянием результата. */
export interface MergeRequestView { index: number; head_sha?: string; state?: "open" | "closed" | "merged"; outcome?: "draft" | "awaiting_approval" | "accepted" | "rejected" | "closed" | "reverted"; summary?: string; approval_required?: boolean; responsible?: { principal_id: string; display_name?: string }[]; revert_commit_sha?: string }
export interface WorkshopAgentConnection { binding_id: string; agent_principal_id: string; runtime_id: string; runtime_agent_id: string; revoked: boolean; connection_name: string; project_ids: string[] }
export interface AgentCredential { access_token: string; token_type: string; expires_in: number }
export interface NodeHistoryPage { events: { event_id: string; head: string; recorded_at: string; exists: boolean; content_type?: string; observed: boolean; actor: string; on_behalf_of: string }[]; next_cursor?: string }

export interface WhoAmI { subject: { tenant_id: string; user_id: string; agent_principal_id?: string }; tenant_name: string; capabilities?: string[]; roles?: PersonRoles }
/** Роли для меню: руководитель отдела, ответственный за проекты, право создавать проекты по правилу организации. */
export interface PersonRoles { department_head: boolean; project_responsible: boolean; can_create_projects: boolean; responsible_projects: string[] }
/** Файл папки для проекта с кодом; путь — внутри папки, без её имени. */
export interface CodeProjectFile { path: string; content: Uint8Array }
export interface CodeProjectResult {
  project: ProjectPage["projects"][number];
  /** null — проект создан, но хранилище кода не приняло папку; причина в repository_error. */
  repository: { connection_id: string; repository_id: string; repository_name: string; commit_sha: string } | null;
  repository_error?: string;
}
/** Пределы первого коммита, те же, что у сервера (gitprovider.MaxSeed*). */
export const CODE_PROJECT_LIMITS = { files: 2000, fileBytes: 4 * 1024 * 1024, totalBytes: 16 * 1024 * 1024 } as const;
/** visibility, can_edit, created_by и pending_share приходят с сервером, где есть видимость проектов. */
export interface ProjectPage { projects: { id: string; name: string; slug: string; org_unit_id?: string; visibility?: ProjectVisibility; can_edit?: boolean; created_by?: string; pending_share?: ProjectVisibility }[] }

export interface NodePage { nodes: { node_id: string; parent_id?: string; name: string; is_dir: boolean; functional_role_id?: string; shared_deleted?: boolean }[]; next_cursor?: string; truncated: boolean }
export interface DocumentContent { node_id: string; text: string; media_type: string; truncated: boolean }

export interface UploadTicket { upload_id: string; url: string; method: string; checksum_header: string; checksum_value: string; content_length: number }

function head(value: string): void {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new MnemosAPIError(400);
}
export interface DraftHead { head: string }
export interface DraftState { personal_head: string; shared_head: string; personal_exists: boolean }
export interface PublicationResult { personal_head: string; shared_head: string; published: boolean; conflicted: boolean }

export interface DraftDocument {
  recorded_by?: {actor: string; on_behalf_of: string; recorded_at: string};
  head: string; node_id: string; exists: boolean; content_type?: string; conflicted: boolean;
  terms: { present: boolean; negative: boolean; manifest?: string; manifest_size?: number; metadata?: { name: string; parent_id: string; content_type: string } }[];
}
export interface DraftDownloadTicket {
  head: string; node_id: string; term_index: number; url: string; method: string;
  size_bytes: number; sha256_hex: string; expires_at: string;
}

export interface ContentDownloadTicket { node_id: string; url: string; method: string; size_bytes: number; blob_sha256_hex: string; expires_at: string }
export interface PublicationDownloadTicket { content_type: string; node_id: string; event_id: string; url: string; method: string; size_bytes: number; sha256_hex: string; expires_at: string }

export interface ProjectSearchPage {
  hits: { project_id: string; node_id: string; name: string; text: string; ordinal: number }[];
  index_pending: boolean;
  degraded: boolean;
}

export type { PublicationReview } from "@gadgets/workshop-shared/publication-review";

export interface PublicationReviewPage { reviews: PublicationReview[]; next_cursor: string }

export interface ReviewDownloadTicket {
  metadata?: { name: string; parent_id: string; content_type: string };
  review_id: string; node_id: string; side: "before" | "after"; decision_version: number;
  present: boolean; content_type?: string; url?: string; method?: string; size_bytes: number; sha256_hex?: string;
}

export interface PolicyDomain { all_documents?: boolean; domain_id: string; node_ids: string[]; approver_ids: string[] }
export interface PublicationPolicy { project_id: string; revision: number; domains: PolicyDomain[] }
export interface PolicyApproverPage { approvers: { principal_id: string; display_name: string }[]; next_cursor: string }

/** Frozen fields for one private native-document creation; identity comes from the account. */
export interface PrivateDocumentCreate {
  /** Server-issued source provenance, bound to this exact creation and upload. */
  drive_origin_proof?:string;
 corporate_preview_id?:string;
  office_preview_id?: string;
  accept_unsupported?: boolean;
  request_id: string;
  expected_head: string;
  parent_id: string;
  name: string;
  content_type: string;
  upload_id: string;
  message: string;
}

/** Authorized documents in the account owner's current personal snapshot. */
export interface PrivateDocumentPage {
  documents: { node_id: string; name: string; content_type: string; conflicted: boolean }[];
  head: string;
  next_cursor: string;
}

/** Empty mode revokes an explicit invitation; folder rights remain independently required. */
export type PrivateParticipantMode = "" | "read" | "write";

/** document_only_read/_write — приглашение с этим правом откроет человеку только этот документ (у него нет такого права на папку). Старый сервер полей не присылает. */
export interface PrivateParticipantPage { head: string; next_cursor: string; participants: { principal_id: string; display_name: string; mode: PrivateParticipantMode; can_read: boolean; can_write: boolean; document_only_read?: boolean; document_only_write?: boolean; org_units?: { org_unit_id: string; name: string }[] }[] }

/** projects — проекты человека, которые можно отдать агенту; старый сервер их не присылает. */
export interface AgentConsentPreview { client_id: string; resource: string; scopes: string[]; expires_at: string; projects?: { project_id: string; name: string }[] }
export interface OrgUnitMember { principal_id: string; display_name: string; is_head: boolean }
export interface OrgUnit { org_unit_id: string; name: string; members: OrgUnitMember[] }
export interface OrgUnitDeletion { deleted: true; projects_made_private: number; requests_closed: number; invitations_revoked: number; members_removed: number }
export type InvitationStatus = "open" | "accepted" | "revoked" | "expired";
export type InvitationRole = "employee" | "head" | "admin";
export const INVITATION_ROLES: readonly InvitationRole[] = ["employee", "head", "admin"];
export interface OrganizationInvitation { invitation_id: string; email: string; display_name: string; org_unit_id?: string; org_unit_name?: string; role?: InvitationRole; created_by: string; created_by_name: string; created_at: string; expires_at: string; status: InvitationStatus; accepted_by?: string; accepted_by_name?: string; accepted_at?: string; email_status?: InvitationEmailStatus; /** Право «Агент кода» при принятии. */ code_agent?: boolean }
/** Судьба письма со ссылкой при создании приглашения. */
export type InvitationEmailStatus = "sent" | "failed" | "not_configured";
function shortText(value: unknown, max = 255): value is string { return typeof value === "string" && value.length <= max; }
function validOrgUnit(value: unknown): value is OrgUnit {
  const unit = value as OrgUnit;
  return !!unit && typeof unit === "object" && shortText(unit.org_unit_id) && !!unit.org_unit_id && shortText(unit.name) &&
    (unit.members === null || unit.members === undefined || (Array.isArray(unit.members) && unit.members.length <= 10000 &&
      unit.members.every(m => !!m && shortText(m.principal_id) && !!m.principal_id && shortText(m.display_name) && typeof m.is_head === "boolean")));
}
function validInvitation(value: unknown): value is OrganizationInvitation {
  const i = value as OrganizationInvitation;
  return !!i && typeof i === "object" && shortText(i.invitation_id, 64) && !!i.invitation_id && shortText(i.email, 320) && shortText(i.display_name) &&
    (i.org_unit_id === undefined || shortText(i.org_unit_id)) && (i.org_unit_name === undefined || shortText(i.org_unit_name)) &&
    shortText(i.created_by) && shortText(i.created_by_name) && typeof i.created_at === "string" && typeof i.expires_at === "string" &&
    ["open", "accepted", "revoked", "expired"].includes(i.status) && (i.accepted_by === undefined || shortText(i.accepted_by)) &&
    (i.accepted_by_name === undefined || shortText(i.accepted_by_name)) && (i.role === undefined || INVITATION_ROLES.includes(i.role)) &&
    (i.email_status === undefined || ["sent", "failed", "not_configured"].includes(i.email_status)) &&
    (i.code_agent === undefined || typeof i.code_agent === "boolean");
}

/** Документ другого человека, открытый вызывающему; mode — право на сейчас. */
export interface SharedDocument {
  project_id: string; project_name: string; node_id: string; owner_id: string; owner_name: string; granted_by_name: string;
  name: string; content_type: string; head: string; mode: "read" | "write"; granted_at: string; seen: boolean;
  /** Приглашение открывает только этот документ: пригласить дальше, перенести и забрать копию нельзя. */
  document_only?: boolean;
}

/** Authorized immutable versions explicitly invited by their owners. */
export interface InvitedDocumentPage {
  documents: {node_id: string; name: string; content_type: string; head: string; owner_id: string; document_only?: boolean}[];
  next_cursor: string;
}

/** A converted object bound to an authorized immutable source; body travels via storage. */
export interface OfficeTicket {
  preview_id?: string;
  source_node_id: string;
  source_head: string;
  source_sha256: string;
  content_type: string;
  unsupported: string[];
  url: string;
  method: "GET";
  size_bytes: number;
  sha256_hex: string;
  expires_at: string;
}

export type EngagementRule = {
  rule_id: string;
  requester_id: string;
  project_id: string;
  purpose: "observe" | "review_spec" | "collaborate";
  revision: number;
  enabled: boolean;
};

/** A saved collaboration operation contains source references, never identity or credentials. */
export interface CollaborationCreate {
 request_id: string; project_id: string; node_id: string; source_head: string;
 target_user_id: string; target_binding_id: string;
 purpose: "observe" | "review_spec" | "collaborate"; role: "observer" | "coexecutor";
 title: string; description: string; criteria: string;
}
export interface CollaborationRequest extends Omit<CollaborationCreate, "target_user_id"> {
 requester_user_id: string; requester_agent_id: string;
 target_user_id: string; target_agent_id: string; created_at: string;
}
export interface CollaborationMessage {absence_runtime_request_id?: string; absence_result_sha256?: string; sequence: number; user_id: string; agent_id: string; kind: "comment" | "result"; body: string; created_at: string}

export interface CollaborationReviewCreate {review_id: string; expected_revision: number; result_sequence: number; decision: "accepted" | "changes_requested"; comment: string}
export interface CollaborationReview {revision: number; result_sequence: number; user_id: string; agent_id: string; decision: "accepted" | "changes_requested"; comment: string; created_at: string}
export interface CollaborationProgress {state: "awaiting_result" | "awaiting_review" | "accepted" | "changes_requested"; result_sequence: number; review_revision: number; review?: CollaborationReview}

/** Configuration only; this policy is not a spending reservation or approval. */
export interface ProjectBudgetPolicy {project_id: string; revision: number; owner_id: string; limit_usd_micros: string; automatic_usd_micros: string; automatic_team_size: number}

/** Immutable financial terms. Approval does not grant file access or start models. */
export interface TeamBudgetCreate {
 voice?: {source_request_id:string;confirmation_id:string;revision:number;text_sha256:string};
 /** Explicit tracker in this proposal's project; actor identity comes from the server. */
 tracker?: {node_id:string};
 absence_request_id?: string;
 policy_revision: number; task: string; criteria: string;
 estimate_usd_micros: string; limit_usd_micros: string;
 members: {binding_id: string; role: string}[];
 rework?: {review_revision?:number;request_id:string;proposal_id:string;binding_id:string;result_sha256:string;result_content:string;comment:string};
 replay_request?: {source_proposal_id:string;source_binding_id:string;target_model:string;reason:string};
 replay?: {request_proposal_id?:string;source_proposal_id:string;source_binding_id:string;source_request_id:string;source_call_id:string;source_input_sha256:string;source_manifest_sha256:string;target_model:string};
}
/** An explicit human decision on a proposal and policy revision. */
export interface TeamBudgetDecide {
 decision_id: string; expected_revision: number; policy_revision: number;
 decision: "approved" | "rejected" | "revoked"; comment: string;
}
/** Server-recorded author and time of a financial decision. */
export interface TeamBudgetDecision {
 revision: number; policy_revision: number; user_id: string;
 decision: TeamBudgetDecide["decision"]; comment: string; created_at: string;
}
/** A financial proposal, not a receipt of runtime spending. */
export interface TeamBudgetProposal {
 id: string; project_id: string; user_id: string; agent_id: string;
 proposal: TeamBudgetCreate; automatic: boolean; created_at: string;
 state: string; decision?: TeamBudgetDecision; accepted_proposal_id?:string;
}
/** Bounded catalog entry; detailed terms require an authorized read by ID. */
export interface TeamBudgetSummary {
 id: string; user_id: string; agent_id: string; policy_revision: number;
 member_count: number; estimate_usd_micros: string; limit_usd_micros: string;
 state: string; created_at: string;
}

/** Observed rated-token costs in the named runtime ledger; not a provider invoice. */
export interface TeamBudgetUsage {tenant_id:string;project_id:string;proposal_id:string;actual_usd_micros:string;reserved_usd_micros:string;pending_calls:number;overrun_calls:number;accounting_basis:"rated_tokens";runtime_id:string}

export interface TeamResultReviewInput {review_id: string; expected_revision: number; runtime_request_id: string; result_sha256: string; decision: "accepted" | "changes_requested"; comment: string}
export interface TeamResultReview {revision: number; user_id: string; runtime_request_id: string; result_sha256: string; decision: "accepted" | "changes_requested"; comment: string; created_at: string}
export interface TeamResultReviewState {state: "unreviewed" | "accepted" | "changes_requested"; revision: number; review?: TeamResultReview}

export interface TeamMemberObservation {tenant_id:string;project_id:string;proposal_id:string;binding_id:string;request_id:string;runtime_id:string;state:"absent"|"unconfirmed"|"completed"|"budget_blocked"}

export interface TeamMemberActivity extends TeamMemberObservation {events: {sequence:string;event_id:string;created_at:string;tool_category?:"search"|"memory"|"other"|null;duration_ms?:number|null;failure_kind?:"access_denied"|null;kind:"task_started"|"tool_called"|"tool_responded"|"tool_failed"|"task_completed"}[];checkpoint_found:boolean;next_sequence:string|null}

export interface TeamResultContribution {revision:number;user_id:string;review_revision:number;runtime_request_id:string;result_sha256:string;state:"unshared"|"shared"|"withdrawn"|"review_changed";content?:string;created_at:string}
export interface TeamResultContributionInput {client_id:string;expected_revision:number;review_revision:number;runtime_request_id:string;result_sha256:string;state:"shared"|"withdrawn";content:string}

export interface TeamResultDraft {source:{tenant_id:string;project_id:string;proposal_id:string;task:string;criteria:string;all_parts_shared:boolean;snapshot_sha256:string;parts:{binding_id:string;role:string;contribution:TeamResultContribution}[]};document?:import("@gadgets/workshop-shared/native-document").NativeDocumentSnapshot}

/** Private versions recorded at task start; absent fields are never inferred. */
export interface AgentTaskInputs {
 history_versions_available?:boolean|null;
 request_id:string; checkpoint_found:boolean;
 input_manifest_sha256:string|null;
 model_inputs:{call_id:string;input_sha256:string;model_id:string;size_bytes:number;message_count:number;tool_count:number;task_start:boolean}[]|null;
 input_manifest:{format_version:1;message_sha256:string;model_id:string;system_prompt_sha256:string;tool_catalog_sha256:string;limits_sha256:string;memory_context_sha256:string;
 memory:{enabled:boolean;selection_revision:number|null;project_id:string|null;node_id:string|null;head:string|null;document_sha256:string|null}}|null;
}

export interface AgentAbsence {
  project_id: string; local_binding_id: string; managed_binding_id: string;
  starts_at: string; ends_at: string; revision: number; enabled: boolean;
}
export type AgentAbsenceInput = Omit<AgentAbsence, "project_id" | "revision"> & {expected_revision: number};

export interface AbsenceTask {
 request_id: string; owner_id: string; project_id: string; local_binding_id: string; managed_binding_id: string;
 state: "queued" | "claimed" | "cancelling" | "started" | "uncertain" | "completed" | "budget_blocked";
 revision: number; binding_id: string; absence_revision: number; runtime_request_id: string; result_sha256: string; budget_proposal_id: string;
}
export interface AbsenceDispatch {request_id: string; runtime_request_id: string; state: AgentTaskOutcome["state"]}
export interface AbsenceCancellation {request_id: string; revision: number; completed: boolean; next_runtime_request_id: string}

/** Exact native target and captured incoming version for an office comparison. */
export type OfficeUpdateInput={expected_head:string;source_node_id:string;source_head:string;format:"docx"|"xlsx"|"pptx";title:string};
/** Explicit decision over the three checksums displayed during review. */
export type OfficeUpdateDecision={current_sha256:string;source_sha256:string;output_sha256:string;accept_unsupported:boolean;replace_local:boolean};
export type OfficeUpdateComparison={drive_source_verified?:boolean;node_id:string;head:string;current_sha256:string;outcome:"source_unchanged"|"already_current"|"update_available"|"conflict";baseline:NonNullable<Awaited<ReturnType<MnemosAPI["officeOrigin"]>>>;incoming:OfficeTicket};
function validateOfficeUpdateInput(input:OfficeUpdateInput){
 head(input.expected_head);head(input.source_head);segment(input.source_node_id);
 if(!["docx","xlsx","pptx"].includes(input.format)||typeof input.title!=="string"||new TextEncoder().encode(input.title).length>255)throw new MnemosAPIError(400);
}

/** Dedicated task-channel consent; only a digest crosses the human API boundary. */
export interface TelegramChannelRegistration {
  request_id: string; binding_id: string; bot_id: string; sender_id: number;
  credential_sha256: string; confirmed: true;
}
/** Public metadata never contains either channel secret or credential digest. */
export interface TelegramChannelInfo {
  id: string; owner_id: string; binding_id: string; bot_id: string; sender_id: number;
  revision: number; enabled: boolean;
}

export interface TelegramTaskJournal {
 channel:TelegramChannelInfo;
 items:({update_id:number;message_id:number;sender_id:number;message:string;criteria:string;request_id:string} & ({kind:"task";target_update_id:null;correction_id:null}|{kind:"correction";target_update_id:number;correction_id:string}))[];
 next_after:number|null;
}

/** Human defaults for future Telegram proposals, not a spending permission. */
export interface TelegramBudgetSettings {revision:number;project_id:string;policy_revision:number;limit_usd_micros:string;voice_binding_id?:string;voice_limit_usd_micros?:string}
function checkedTelegramBudget(value:TelegramBudgetSettings):TelegramBudgetSettings {
 try{return telegramVoiceBudget(value);}catch{throw new MnemosAPIError(502);}
}

export interface ProjectSignalProfile {requirements:{id:string;purpose:string;max_age_seconds:number;expected_unit?:string}[];queries:{signal_id:string;database:string;sql:string}[]}
export interface ProjectSignalAssessment {state:'sufficient'|'insufficient'|'unavailable';assessed_at:string;findings:{signal_id:string;purpose:string;state:'available'|'missing'|'stale'|'unavailable'|'future_timestamp'|'unit_mismatch';source_id?:string;source_revision?:string;observed_at?:string;value?:number;unit?:string;expected_unit?:string}[]}

export interface SavedSignalAssessment {requirements_sha256:string;request_id:string;project_id:string;collected_at:string;assessment:ProjectSignalAssessment}

export interface SignalPublicationRequest {operation_id:string;request_id:string;expected_revision:number;enabled:boolean}
export interface SignalPublication {revision:number;operation_id:string;source_owner_id:string;source_request_id:string;enabled:boolean;selected_by:string;selected_at:string}
export interface PublishedSignalAssessment {project_id:string;publication:SignalPublication;snapshot?:SavedSignalAssessment}

/** Existing role/group membership shown before a human administrative decision. */
export interface PrincipalMembership {container_id:string;container_kind:string;container_name:string;member_id:string;member_kind:string;member_name:string;container_active:boolean;member_active:boolean;enabled:boolean;generation:number;}

/** A group or functional role does not itself grant resource access. */
export interface OrganizationRole {id:string;kind:string;name:string;active:boolean;}
/** One administrative catalog page at an authorization generation. */
export interface OrganizationRolePage {roles:OrganizationRole[];next_cursor:string;generation:number;}

function gitRepositoryPath(project:string,connection:string,repository:string):string{return `/v1/projects/${segment(project)}/git/${segment(connection)}/repositories/${segment(repository)}`;}

export interface ProjectOverviewChild {node_id:string;name:string;is_dir:boolean;l0:string}
export interface ProjectOverview {project_id:string;node_id:string;l0?:string;l1?:string;pending:boolean;children:ProjectOverviewChild[]}
/** Запись журнала работ проекта (services/internal/domain/work_journal.go). */
export interface WorkJournalEntry {entry_id:number;project_id:string;recorded_at:string;recorded_by:string;actor:string;on_behalf_of?:string;source:"manual"|"merge_request"|"publication"|string;summary:string;purpose?:string;changed:string[];result:{kind?:string;repository?:string;reference?:string;document?:string;version?:string};outcome:"accepted"|"awaiting_approval"|"returned"|string}
export interface WorkJournalPage {entries:WorkJournalEntry[];next_cursor?:string;truncated:boolean}

/** Синхронизация проекта с GitHub (сервер: services/storage-api/internal/app/git_sync.go). */
export type GitSyncVisibility = "private" | "department" | "organization";
export type GitSyncState = "pending" | "syncing" | "ok" | "conflict" | "blocked" | "error" | "disabled";
export interface GitSyncReport {added:number;updated:number;deleted:number;conflicts:number;skipped_binary:number;skipped_large:number;skipped_ignored:number;skipped_taken:number;conflict_paths:string[]}
export interface GitSyncLink {link_id:string;project_id:string;source:"app"|"connection";connection_id:string;installation_id:string;repository_id:string;repository_name:string;branch:string;folder:string;include:string[];exclude:string[];visibility:GitSyncVisibility|"";state:GitSyncState;message:string;last_synced_sha:string;last_synced_at:string;report:GitSyncReport;revision:number;can_manage:boolean}
export interface GitSyncLinkPage {links:GitSyncLink[]}
export interface GitSyncSettings {branch:string;folder:string;include:string[];exclude:string[];visibility?:GitSyncVisibility}
export interface GitSyncLinkCreate extends GitSyncSettings {project_id:string;source:"app"|"connection";installation_id?:string;connection_id?:string;repository_id:string;repository_name:string}
export interface GitSyncLinkUpdate extends GitSyncSettings {expected_revision:number}
export interface GitAppRepository {installation_id:string;id:string;name:string;default_branch:string;private:boolean}
export interface GitAppRepositoryPage {available:boolean;repositories:GitAppRepository[]}

function checkGitSyncSettings(s:GitSyncSettings):void{
  if(typeof s.branch!=="string"||!s.branch.trim()||s.branch.length>255||typeof s.folder!=="string"||s.folder.length>1024||/(^|\/)\.\.(\/|$)|\0/.test(s.folder))throw new MnemosAPIError(400);
  for(const list of [s.include,s.exclude])if(!Array.isArray(list)||list.length>50||list.some(p=>typeof p!=="string"||!p.trim()||p.length>255))throw new MnemosAPIError(400);
  if(s.visibility!==undefined&&!["private","department","organization"].includes(s.visibility))throw new MnemosAPIError(400);
}
function checkedGitSyncPage(value:unknown):GitSyncLinkPage{
  const links=(value as {links?:unknown}|null)?.links;
  if(!Array.isArray(links)||links.some(l=>!l||typeof l!=="object"||typeof (l as GitSyncLink).link_id!=="string"||typeof (l as GitSyncLink).project_id!=="string"||typeof (l as GitSyncLink).state!=="string"))throw new MnemosAPIError(502);
  const empty:GitSyncReport={added:0,updated:0,deleted:0,conflicts:0,skipped_binary:0,skipped_large:0,skipped_ignored:0,skipped_taken:0,conflict_paths:[]};
  return {links:links.map(l=>{const link=l as GitSyncLink;return {...link,include:link.include??[],exclude:link.exclude??[],report:{...empty,...(link.report??{}),conflict_paths:link.report?.conflict_paths??[]}};})};
}

/** Аккаунт GitHub, подключённый человеком кнопкой «Подключить GitHub» (сервер: services/storage-api/internal/app/git_app_owner.go). */
export interface GitHubAccount {installation_id:string;github_login:string;account_login:string;account_type:string;repository_selection:"all"|"selected";linked_at:string;repository_count:number;manage_url:string}
/** available=false — приложение GitHub на сервере не подключено; connectable=false — нет секрета клиента, подключить свой GitHub нельзя. */
export interface GitHubAccountPage {available:boolean;connectable:boolean;accounts:GitHubAccount[]}

function checkedGitHubAccounts(value:unknown):GitHubAccountPage{
  const page=value as Partial<GitHubAccountPage>|null;
  if(!page||typeof page!=="object"||typeof page.available!=="boolean"||typeof page.connectable!=="boolean"||!Array.isArray(page.accounts))throw new MnemosAPIError(502);
  const accounts=page.accounts.map(raw=>{
    const a=raw as Partial<GitHubAccount>|null;
    if(!a||typeof a!=="object"||typeof a.installation_id!=="string"||!/^[1-9][0-9]{0,18}$/.test(a.installation_id)||typeof a.account_login!=="string"||typeof a.github_login!=="string")throw new MnemosAPIError(502);
    const account:GitHubAccount={installation_id:a.installation_id,github_login:a.github_login,account_login:a.account_login,account_type:typeof a.account_type==="string"?a.account_type:"",
      repository_selection:a.repository_selection==="selected"?"selected":"all",linked_at:typeof a.linked_at==="string"?a.linked_at:"",
      repository_count:typeof a.repository_count==="number"&&Number.isSafeInteger(a.repository_count)?a.repository_count:-1,manage_url:typeof a.manage_url==="string"?a.manage_url:""};
    return account;
  });
  return {available:page.available,connectable:page.connectable,accounts};
}

/** Итог вывода сотрудника из организации (POST /v1/admin/users/{id}/remove). */
export interface PersonRemoval { principal_id: string; outcome: "removed" | "already_removed"; agents_disabled: number; invitations_removed: number; rights_removed: number; groups_left: number }
/** Итог возвращения выбывшего (POST /v1/admin/users/{id}/return). */
export interface PersonReturn { principal_id: string; outcome: "returned" | "already_active" }

/** Потолок тела фотографии человека на сервере (миграция 0162). */
export const PERSON_PHOTO_MAX_BYTES = 512 * 1024;
/** Фотография человека: url — presigned GET на 15 минут, sha256_hex — чтобы узнать, что фотография не менялась. */
export interface PersonPhoto { principal_id: string; sha256_hex: string; media_type: "image/jpeg" | "image/png" | "image/webp"; size_bytes: number; updated_at: string; url: string; expires_at: string }
function validPersonPhoto(value: unknown): value is PersonPhoto {
  const p = value as Partial<PersonPhoto> | null;
  if (!p || typeof p !== "object" || typeof p.principal_id !== "string" || !p.principal_id || p.principal_id.length > 255 ||
      typeof p.sha256_hex !== "string" || !/^[0-9a-f]{64}$/.test(p.sha256_hex) || !["image/jpeg", "image/png", "image/webp"].includes(p.media_type as string) ||
      !Number.isSafeInteger(p.size_bytes) || typeof p.url !== "string" || typeof p.expires_at !== "string") return false;
  try { const url = new URL(p.url); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}

/** «Создать проект» из репозитория GitHub (сервер: POST /v1/git/sync-projects). */
export interface GitSyncProjectCreate extends GitSyncSettings {name:string;source:"app"|"connection";installation_id?:string;connection_id?:string;repository_id:string;repository_name:string}
/** Дополнение списка репозиториев: аккаунт, дата последней отправки кода и язык по оценке GitHub. */
export interface GitAppRepository {account?:string;pushed_at?:string;language?:string|null}
/** Сколько файлов репозитория сейчас лежит в проекте по связи. */
export interface GitSyncLink {file_count?:number}
