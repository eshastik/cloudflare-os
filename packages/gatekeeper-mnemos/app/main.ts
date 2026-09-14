import {UploadUsageView} from './upload-usage.ts';
import {CentroidView} from "./centroid.ts";
import {ReindexBatchView} from "./reindex-batch.ts";
import {ReindexView} from "./reindex.ts";
import {PolicyAlertsView} from "./policy-alerts.ts";
import {WebDAVAccountsView} from './webdav-accounts.ts';
import type {WebDAVManagement} from '../src/webdav-accounts.ts';
import {PlatformSignalInboxView} from "./platform-signal-inbox.ts";
import {PlatformSignalOwnersView} from "./platform-signal-owners.ts";
import {RoleMembershipView} from "./role-membership.ts";
import {ImapAccountsView} from './imap-accounts.ts';
import type {ImapManagement} from '../src/imap-types.ts';
import {CalDAVAccountsView} from './caldav-accounts.ts';
import type {CalDAVManagement} from '../src/caldav-types.ts';
import type {CalendarDraftManagement} from '../src/calendar-drafts.ts';
import type {MailDraftManagement} from '../src/mail-drafts.ts';
import {AnswerEvaluation} from './answer-evaluation.ts';
import {SearchEvaluation} from './search-evaluation.ts';
import {AgentQuality} from './agent-quality.ts';
import {AgentAnswers} from './agent-answers.ts';
import {BusinessOverview} from './business-overview.ts';
import type {SignalGapTask} from './signal-gap-task.ts';
import {SignalsOverview} from './signals-overview.ts';
import {ProjectSignalsView} from './project-signals.ts';
import {BudgetOverview} from './budget-overview.ts';
import {VoiceView} from "./voice.ts";
import type {VoiceManagement} from "../src/voice-management.ts";
import {TelegramView} from './telegram.ts';
import type {TelegramManagement} from '../src/telegram-management.ts';
import {CalendarConnectionsView} from "./calendar-connections.ts";
import {MailConnectionsView} from "./mail-connections.ts";
import type {CorporateTaskManagement} from "../src/corporate-task-creation.ts";
import {CorporateImportView} from "./corporate-import.ts";
import {DatabaseConnectionsView} from "./database-connections.ts";
import {OperationAuditView} from "./operation-audit.ts";
import {GitConnectionsView} from "./git-connections.ts";
import {resourceMapMime,resourceMapText,resourceReviewText} from "../src/resource-map-artifact.ts";
import type {ResourceMapManagement} from "../src/resource-map-creation.ts";
import type {ResourceMapEditManagement} from "../src/resource-map-edits.ts";
import {ResourceMapView} from "./resource-map.ts";
import type {TrackerInvitations} from "../src/account-session.ts";
import type {TrackerEditManagement} from "../src/tracker-edits.ts";
import type {TrackerManagement} from "../src/tracker-creation.ts";
import {TaskTrackerView} from "./task-tracker.ts";
import {WorkTemplateView} from "./work-templates.ts";
import {AbsenceTaskView} from "./absence-task.ts";
import type {TeamDocumentManagement} from "../src/team-document-creation.ts";
import {TeamBudgetView} from "./team-budget.ts";
import {parseBudgetUSD, formatBudgetUSD} from "./budget-money.ts";
import { startUIReadinessAttempt } from "./ui-readiness.ts";
import { histogramPercentileBound } from "./latency.ts";
import type { MnemosAccountSession, ManagedAgentRequest, ManagedTaskRequest } from "../src/account-session.ts";
import type { RpcTarget, RpcStub } from "capnweb";
import type { AgentConnectionPage, WhoAmI, ProjectPage, NodePage, DocumentContent, DraftDocument, DraftState, DraftHead, PublicationResult, PublicationReview, PublicationReviewPage, PublicationPolicy, PolicyDomain, PolicyApproverPage, ProjectSearchPage, NodeHistoryPage } from "../src/mnemos-api.ts";
export interface Management extends WebDAVManagement, ImapManagement, CalDAVManagement, CalendarDraftManagement, MailDraftManagement, RpcTarget, TelegramManagement, VoiceManagement {
 beginInboxUpload: MnemosAccountSession["beginInboxUpload"];
 submitInboxUpload: MnemosAccountSession["submitInboxUpload"];
 inboxStatus: MnemosAccountSession["inboxStatus"];
 inboxAlerts: MnemosAccountSession["inboxAlerts"];
 decideInboxAlert: MnemosAccountSession["decideInboxAlert"];
 replayInboxItem: MnemosAccountSession["replayInboxItem"];
 listPeople: MnemosAccountSession["listPeople"];
 createPerson: MnemosAccountSession["createPerson"];
 listPersonRights: MnemosAccountSession["listPersonRights"];
 grantPersonRight: MnemosAccountSession["grantPersonRight"];
 removePersonRight: MnemosAccountSession["removePersonRight"];
 createProject:MnemosAccountSession["createProject"];
 readWorkshopAgentScope:MnemosAccountSession["readWorkshopAgentScope"];
 updateWorkshopAgentScope:MnemosAccountSession["updateWorkshopAgentScope"];
 readCalendarConnection:MnemosAccountSession["readCalendarConnection"];
 readCalendarEvents:MnemosAccountSession["readCalendarEvents"];
 listCalendarConnections:MnemosAccountSession["listCalendarConnections"];
 readMailMessages:MnemosAccountSession["readMailMessages"];
 listMailConnections:MnemosAccountSession["listMailConnections"];
 readMailConnection:MnemosAccountSession["readMailConnection"];
 uploadUsage:MnemosAccountSession["uploadUsage"];
 prepareCentroid:MnemosAccountSession["prepareCentroid"];
 executeCentroid:MnemosAccountSession["executeCentroid"];
 readReindexBatch:MnemosAccountSession["readReindexBatch"];
 prepareReindexBatch:MnemosAccountSession["prepareReindexBatch"];
 executeReindexBatch:MnemosAccountSession["executeReindexBatch"];
 prepareReindex:MnemosAccountSession["prepareReindex"];
 executeReindex:MnemosAccountSession["executeReindex"];
 policyAlerts:MnemosAccountSession["policyAlerts"];
 reviewPolicyAlert:MnemosAccountSession["reviewPolicyAlert"];
 platformSignalInbox:MnemosAccountSession["platformSignalInbox"];
 readPlatformSignalNotification:MnemosAccountSession["readPlatformSignalNotification"];
 listPlatformSignalOwners:MnemosAccountSession["listPlatformSignalOwners"];
 setPlatformSignalOwner:MnemosAccountSession["setPlatformSignalOwner"];
 listOrganizationRoles:MnemosAccountSession["listOrganizationRoles"];
 createOrganizationRole:MnemosAccountSession["createOrganizationRole"];
 readPrincipalMembership:MnemosAccountSession["readPrincipalMembership"];
 setPrincipalMembership:MnemosAccountSession["setPrincipalMembership"];
 readCalendarGrantState:MnemosAccountSession["readCalendarGrantState"];
 readMailGrantState:MnemosAccountSession["readMailGrantState"];
 setCalendarReadGrant:MnemosAccountSession["setCalendarReadGrant"];
 setMailReadGrant:MnemosAccountSession["setMailReadGrant"];
 disableCalendarConnection:MnemosAccountSession["disableCalendarConnection"];
 disableMailConnection:MnemosAccountSession["disableMailConnection"];
 prepareCorporateAttachment:CorporateTaskManagement["prepareCorporateAttachment"];
 prepareCorporateUpdate:CorporateTaskManagement["prepareCorporateUpdate"];
 executeCorporateUpdate:CorporateTaskManagement["executeCorporateUpdate"];
 recoverCorporateUpdate:CorporateTaskManagement["recoverCorporateUpdate"];
 readCorporateOrigin:MnemosAccountSession["readCorporateOrigin"];
 prepareSharedCorporateWorkflow:CorporateTaskManagement["prepareSharedCorporateWorkflow"];
 executeSharedCorporateWorkflow:CorporateTaskManagement["executeSharedCorporateWorkflow"];
 previewCorporateWorkflow:MnemosAccountSession["previewCorporateWorkflow"];
 readJiraLinks:MnemosAccountSession["readJiraLinks"];
 resolveCorporateTarget:MnemosAccountSession["resolveCorporateTarget"];
 prepareCorporateTask:CorporateTaskManagement["prepareCorporateTask"];
 prepareMappedCorporateTask:CorporateTaskManagement["prepareMappedCorporateTask"];
 prepareMappedJiraCorporateTask:CorporateTaskManagement["prepareMappedJiraCorporateTask"];
 readCorporateCard:CorporateTaskManagement["readCorporateCard"];
 resolveCorporateCardLink:CorporateTaskManagement["resolveCorporateCardLink"];
 saveCorporateCard:CorporateTaskManagement["saveCorporateCard"];
 prepareCorporateRecord:CorporateTaskManagement["prepareCorporateRecord"];
 executeCorporateTask:CorporateTaskManagement["executeCorporateTask"];
  previewJiraImport:MnemosAccountSession["previewJiraImport"];
  resolveBitrixRecordUpdate:MnemosAccountSession["resolveBitrixRecordUpdate"];
  previewBitrixRecordUpdate:MnemosAccountSession["previewBitrixRecordUpdate"];
  previewBitrixDepartmentMembership:MnemosAccountSession["previewBitrixDepartmentMembership"];
  applyBitrixDepartmentMembership:MnemosAccountSession["applyBitrixDepartmentMembership"];
  previewBitrixImport:MnemosAccountSession["previewBitrixImport"];
  listPrivateDraftParticipants:MnemosAccountSession["listPrivateDraftParticipants"];
  setPrivateDraftParticipant:MnemosAccountSession["setPrivateDraftParticipant"];
  prepareTrackedAgentTask:MnemosAccountSession["prepareTrackedAgentTask"];
  resolveDraftConflict:MnemosAccountSession["resolveDraftConflict"];
  listInvitedTrackers:TrackerInvitations["listInvitedTrackers"];
  connectInvitedTracker:TrackerInvitations["connectInvitedTracker"];
  readResourceMapCreation:ResourceMapManagement["readResourceMapCreation"];
  saveResourceMapCreation:ResourceMapManagement["saveResourceMapCreation"];
  executeResourceMapCreation:ResourceMapManagement["executeResourceMapCreation"];
  readResourceMapEdit:ResourceMapEditManagement["readResourceMapEdit"];
  prepareResourceMapEdit:ResourceMapEditManagement["prepareResourceMapEdit"];
  claimResourceMapEdit:ResourceMapEditManagement["claimResourceMapEdit"];
  clearResourceMapEdit:ResourceMapEditManagement["clearResourceMapEdit"];
  readTrackerEdit:TrackerEditManagement["readTrackerEdit"];
  prepareTrackerEdit:TrackerEditManagement["prepareTrackerEdit"];
  claimTrackerEdit:TrackerEditManagement["claimTrackerEdit"];
  clearTrackerEdit:TrackerEditManagement["clearTrackerEdit"];
  readTrackerCreation:TrackerManagement["readTrackerCreation"];
  saveTrackerCreation:TrackerManagement["saveTrackerCreation"];
  executeTrackerCreation:TrackerManagement["executeTrackerCreation"];
 readTemplateProposalSource:MnemosAccountSession["readTemplateProposalSource"];
 readSavedTemplateDecision:MnemosAccountSession["readSavedTemplateDecision"];
 saveTemplateDecision:MnemosAccountSession["saveTemplateDecision"];
 executeSavedTemplateDecision:MnemosAccountSession["executeSavedTemplateDecision"];
 resolveWorkTemplate:MnemosAccountSession["resolveWorkTemplate"];
 listManagedTemplateScopes:MnemosAccountSession["listManagedTemplateScopes"];
 setTemplateScope:MnemosAccountSession["setTemplateScope"];
 listTemplateReviewScopes:MnemosAccountSession["listTemplateReviewScopes"];
 listTemplateProposals:MnemosAccountSession["listTemplateProposals"];
 readTemplateProposal:MnemosAccountSession["readTemplateProposal"];
 listTemplateScopes: MnemosAccountSession["listTemplateScopes"];
 listScopedWorkTemplates: MnemosAccountSession["listScopedWorkTemplates"];
 readScopedWorkTemplate: MnemosAccountSession["readScopedWorkTemplate"];
 listWorkTemplates: MnemosAccountSession["listWorkTemplates"];
 readWorkTemplate: MnemosAccountSession["readWorkTemplate"];
 readSavedTemplateAction: MnemosAccountSession["readSavedTemplateAction"];
 saveTemplateAction: MnemosAccountSession["saveTemplateAction"];
 deferTemplateAction: MnemosAccountSession["deferTemplateAction"];
 restoreTemplateAction: MnemosAccountSession["restoreTemplateAction"];
 executeSavedTemplateAction: MnemosAccountSession["executeSavedTemplateAction"];
 readSavedAbsenceAction: MnemosAccountSession["readSavedAbsenceAction"];
 saveAbsenceAction: MnemosAccountSession["saveAbsenceAction"];
 executeSavedAbsenceAction: MnemosAccountSession["executeSavedAbsenceAction"];
 createAbsenceTask: MnemosAccountSession["createAbsenceTask"];
 readAbsenceTask: MnemosAccountSession["readAbsenceTask"];
 dispatchAbsenceTask: MnemosAccountSession["dispatchAbsenceTask"];
 cancelAbsenceTask: MnemosAccountSession["cancelAbsenceTask"];
 readAbsenceRuntime: MnemosAccountSession["readAbsenceRuntime"];

 readAgentAbsence: MnemosAccountSession["readAgentAbsence"];
 setAgentAbsence: MnemosAccountSession["setAgentAbsence"];
 deferBudgetDraft: MnemosAccountSession["deferBudgetDraft"];
 resumeBudgetDraft: MnemosAccountSession["resumeBudgetDraft"];
 cancelSavedTeamTask: MnemosAccountSession["cancelSavedTeamTask"];
 budgetSavedAgentTask: MnemosAccountSession["budgetSavedAgentTask"];
 prepareTeamBudgetRework: MnemosAccountSession["prepareTeamBudgetRework"];
 prepareTeamBudgetReview: MnemosAccountSession["prepareTeamBudgetReview"];
 readTeamResultDraft: TeamDocumentManagement["readTeamResultDraft"];
 createTeamResultDocument: TeamDocumentManagement["createTeamResultDocument"];
 readTeamResultContribution: MnemosAccountSession["readTeamResultContribution"];
 recordTeamResultContribution: MnemosAccountSession["recordTeamResultContribution"];
 readTeamResultReview: MnemosAccountSession["readTeamResultReview"];
 readTeamMemberObservation: MnemosAccountSession["readTeamMemberObservation"];
 readTeamMemberActivity: MnemosAccountSession["readTeamMemberActivity"];
 readTeamBudgetUsage: MnemosAccountSession["readTeamBudgetUsage"];
 runTeamBudgetMember: MnemosAccountSession["runTeamBudgetMember"];
 readTeamBudgetMember: MnemosAccountSession["readTeamBudgetMember"];
 readTeamMemberInputs: MnemosAccountSession["readTeamMemberInputs"];
 cancelTeamBudgetMember: MnemosAccountSession["cancelTeamBudgetMember"];

 listTeamBudgets: MnemosAccountSession["listTeamBudgets"];
 readTeamBudget: MnemosAccountSession["readTeamBudget"];
 createTeamBudget: MnemosAccountSession["createTeamBudget"];
 decideTeamBudget: MnemosAccountSession["decideTeamBudget"];
 saveProjectSignalAssessment: MnemosAccountSession["saveProjectSignalAssessment"];
 readPublishedProjectSignals: MnemosAccountSession["readPublishedProjectSignals"];
 publishProjectSignals: MnemosAccountSession["publishProjectSignals"];
 readProjectSignalAssessment: MnemosAccountSession["readProjectSignalAssessment"];
 assessProjectSignals: MnemosAccountSession["assessProjectSignals"];
 listBudgetProjects: MnemosAccountSession["listBudgetProjects"];
  readProjectBudget: MnemosAccountSession["readProjectBudget"];
  setProjectBudget: MnemosAccountSession["setProjectBudget"];

 finishedAgentTasks: MnemosAccountSession["finishedAgentTasks"];
 readFinishedAgentTask: MnemosAccountSession["readFinishedAgentTask"];
 prepareAgentRework: MnemosAccountSession["prepareAgentRework"];

  readCollaborationProgress: MnemosAccountSession["readCollaborationProgress"];
  reviewCollaborationResult: MnemosAccountSession["reviewCollaborationResult"];

  listCollaborations: MnemosAccountSession["listCollaborations"];
  readCollaboration: MnemosAccountSession["readCollaboration"];
  createCollaboration: MnemosAccountSession["createCollaboration"];
  listCollaborationMessages: MnemosAccountSession["listCollaborationMessages"];
  appendCollaborationMessage: MnemosAccountSession["appendCollaborationMessage"];

  listEngagementRules: MnemosAccountSession["listEngagementRules"];
  setEngagementRule: MnemosAccountSession["setEngagementRule"];
  readPersonalMemory: MnemosAccountSession["readPersonalMemory"];
  readPersonalMemoryVersion: MnemosAccountSession["readPersonalMemoryVersion"];
  setPersonalMemory: MnemosAccountSession["setPersonalMemory"];
  listPrivateDocuments: MnemosAccountSession["listPrivateDocuments"];
  listPrivateDocumentsForOwner: MnemosAccountSession["listPrivateDocumentsForOwner"];
  recordUIReadiness: MnemosAccountSession["recordUIReadiness"];
  readPlatformMetrics: MnemosAccountSession["readPlatformMetrics"];
  managedTaskRequest(): Promise<ManagedTaskRequest | null>;
  discardUnsentAgentTask: MnemosAccountSession["discardUnsentAgentTask"];
  reviewSavedAgentTask: MnemosAccountSession["reviewSavedAgentTask"];
  prepareAgentTask: MnemosAccountSession["prepareAgentTask"];
  submitSavedAgentTask(id: string): Promise<ManagedTaskRequest>;
  refreshSavedAgentTask(id: string): Promise<ManagedTaskRequest>;
  finishSavedAgentTask(id: string): Promise<void>;
  managedAgentRequest(): Promise<ManagedAgentRequest | null>;
  prepareManagedAgent(template: string): Promise<ManagedAgentRequest>;
  submitManagedAgent(id: string): Promise<ManagedAgentRequest>;
  finishManagedAgentRequest(id: string): Promise<void>;
  openDraft(project: string): Promise<DraftHead>;
  readDraftDocument(project: string, node: string): Promise<DraftDocument>;
  draftState(project: string): Promise<DraftState>;
  readPublishedHead: MnemosAccountSession["readPublishedHead"];
  readPrivateVersionDigest: MnemosAccountSession["readPrivateVersionDigest"];
  saveDraftDocument(project: string, node: string, upload: string, head: string): Promise<DraftHead>;
  listPublicationReviews(cursor: string): Promise<PublicationReviewPage>;
  recordReviewDecision(id: string, domain: string, version: number, approved: boolean): Promise<void>;
  readPublicationPolicy(project: string): Promise<PublicationPolicy>;
  listPolicyApprovers(project: string, cursor: string): Promise<PolicyApproverPage>;
  setPublicationPolicy(project: string, revision: number, domains: PolicyDomain[]): Promise<{ revision: number }>;
  readPublicationReview(id: string): Promise<PublicationReview>;
  requestPublicationReview(project: string, personal: string, shared: string): Promise<{ candidate_id: string }>;
  publishDraft(project: string, head: string, shared: string, message: string): Promise<PublicationResult>;
  browseProject(project: string, cursor: string): Promise<NodePage>;
  readProjectDocument(project: string, node: string): Promise<DocumentContent>;
  searchProject(project: string, query: string): Promise<ProjectSearchPage>;
  nodeHistory(project: string, node: string, cursor: string): Promise<NodeHistoryPage>;
  /** Public setup parameters for connecting an external CLI to this organization. */
  /** Explicitly grant or remove one agent's project permission. */
  setAgentProjectRight: MnemosAccountSession["setAgentProjectRight"];
  externalAgentSetup: MnemosAccountSession["externalAgentSetup"];
  whoAmI(): Promise<WhoAmI>;
  listProjects(): Promise<ProjectPage>;
  listVisibleDatabaseConnections:MnemosAccountSession["listVisibleDatabaseConnections"];
  listDatabaseConnections:MnemosAccountSession["listDatabaseConnections"];
  registerDatabaseConnection:MnemosAccountSession["registerDatabaseConnection"];
  removeDatabaseConnection:MnemosAccountSession["removeDatabaseConnection"];
  readOperationAudit:MnemosAccountSession["readOperationAudit"];
  readGitFile:MnemosAccountSession["readGitFile"];
  readGitCommit:MnemosAccountSession["readGitCommit"];
  readOwnedGitBinding:MnemosAccountSession["readOwnedGitBinding"];
  listProjectGitRepositories: MnemosAccountSession["listProjectGitRepositories"];
  bindGitRepository: MnemosAccountSession["bindGitRepository"];
  listGitConnections: MnemosAccountSession["listGitConnections"];
  readGitConnection: MnemosAccountSession["readGitConnection"];
  disableGitConnection: MnemosAccountSession["disableGitConnection"];
  listGitRepositories: MnemosAccountSession["listGitRepositories"];
  listGitRegistrationIntents: MnemosAccountSession["listGitRegistrationIntents"];
  saveGitRegistrationIntent: MnemosAccountSession["saveGitRegistrationIntent"];
  inspectGitRegistrationIntent: MnemosAccountSession["inspectGitRegistrationIntent"];
  executeGitRegistrationIntent: MnemosAccountSession["executeGitRegistrationIntent"];
  listAgentConnections: MnemosAccountSession["listAgentConnections"];
  checkTrackerAssignee: MnemosAccountSession["checkTrackerAssignee"];
  revokeAgentConnection(id: string): Promise<void>;
}
export interface Host extends RpcTarget {
  setUnsavedChanges(dirty: boolean): void;
  subscribeAccent(frame: RpcTarget): string;
  getSelectedSection(): string;
  pickInboxFiles(directory: boolean): Promise<import("../src/intake.ts").PickedIntakeFile[]>;
  openSection(section: string, project?: string): void;
  openApprovals(): Promise<void>;
  getSelectedProject(): Promise<string>;
  saveMailAttachment(bytes:Uint8Array,filename:string):Promise<void>;
  createCalendarDraft(id:string,sha256:string):Promise<import('@gadgets/workshop-shared/calendar-draft').CalendarDraftExecution>;
  sendMailDraft(id:string,sha256:string):Promise<{state:'attempted'|'accepted';message_id?:string}>;
  uploadText(project: string, text: string): Promise<string>;
  downloadReviewText(review: string, node: string, version: number, side: "before" | "after"): Promise<string | null>;
  downloadFile(project:string,node:string,version:string,filename:string):Promise<void>;
  downloadText(project: string, node: string, head: string, side: number): Promise<string>;
  ui: RpcStub<Management>; subscribeTheme(frame: RpcTarget): Promise<string> }
// Handshake с хостом и корневой элемент даёт вызывающий (оболочка на React): у фрейма одна RPC-сессия на всех.
let host: RpcStub<Host>;
let root: HTMLElement;
let activeUIReadiness: ReturnType<typeof startUIReadinessAttempt> | null = null;
/** Монтирует прежние разделы в контейнер и начинает загрузку данных. */
export function mountLegacy(container: HTMLElement, hostStub: RpcStub<Host>): void {
  root = container; host = hostStub;
  window.addEventListener("visibilitychange", () => { if(document.hidden) activeUIReadiness?.finish("abandoned"); });
  window.addEventListener("pagehide", () => { activeUIReadiness?.finish("abandoned"); closed = true; host[Symbol.dispose](); }, { once: true });
  void load(false);
}
let rows: AgentConnectionPage["connections"] = [], cursor = "", busy = false, closed = false, selected = "", notice = "";
let identity: WhoAmI | null = null;
let managedRequest: ManagedAgentRequest | null = null;
let managedTemplate = "";
let taskRequest: ManagedTaskRequest | null = null;
let taskHistory: {page: ReturnType<MnemosAccountSession["finishedAgentTasks"]>; selected?: ManagedTaskRequest} | null = null;
let taskBudgetProject = "", taskBudgetEstimate = "0", taskBudgetLimit = "0";
let taskTrackerProject="",taskTrackerNode="";
let taskTrackers:Awaited<ReturnType<MnemosAccountSession["listPrivateDocuments"]>>|undefined;
let taskBinding = "", taskMessage = "", taskCriteria = "", taskReviewComment = "";
let projects: ProjectPage["projects"] = [];
let openProject = "", nodes: NodePage["nodes"] = [], nodeCursor = "", nodeTruncated = false;
let searchQuery = "", searchPage: ProjectSearchPage | null = null;
let documentContent: DocumentContent | null = null;
type HistoryEvent = NodeHistoryPage["events"][number];
type HistoryComparison = { left: HistoryEvent; right: HistoryEvent; before: string | null; after: string | null };
let history: { project: string; node: string; name: string; page: NodeHistoryPage; opened?: { event: string; text: string }; baseline?: HistoryEvent; comparison?: HistoryComparison } | null = null;
type Editor = { requestingReview?:boolean; side?:number; project: string; doc: DraftDocument; text: string | null; original: string; uncertain: boolean; publishing: DraftState | null; reviewId: string; review: PublicationReview | null };
let editor: Editor | null = null;
type PolicyEditor = { policy: PublicationPolicy; people: PolicyApproverPage["approvers"]; peopleCursor: string; files: NodePage["nodes"]; fileCursor: string; dirty: boolean; uncertain: boolean };
let policyEditor: PolicyEditor | null = null;
let memoryEditor: MemoryEditor | null = null;
let absenceEditor: AbsenceEditor | null = null;
let engagementEditor: EngagementEditor | null = null;
let collaborationView: CollaborationView | null = null;
let budgetEditor: BudgetEditor | null = null;
let inboxOpen = false, inboxCursor = "";
let inboxRows: PublicationReview[] = [], inboxReview: PublicationReview | null = null;
const comparedNodes = new Set<string>();
let comparison: { node: string; before: string | null; after: string | null } | null = null;
export function hasUnsavedLegacyChanges(): boolean {
  return !!((editor && (busy || editor.text !== null && editor.text !== editor.original)) || (policyEditor && (busy || policyEditor.dirty)));
}
let reportedDirty: boolean | undefined;
function reportUnsavedChanges(): void {
  const dirty = hasUnsavedLegacyChanges();
  if (!host || reportedDirty === dirty) return;
  reportedDirty = dirty;
  void host.setUnsavedChanges(dirty).catch(() => { reportedDirty = undefined; });
}
export function confirmLegacyNavigation(): boolean {
  return !hasUnsavedLegacyChanges() || window.confirm("Есть несохранённые изменения. Уйти и потерять их?");
}
// Уход со страницы проверяет host: iframe beforeunload не видит переходы оболочки.
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = ""): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag); el.textContent = text; return el;
}
function button(text: string, action: () => void): HTMLButtonElement {
  const b = element("button", text); b.type = "button"; b.disabled = busy; b.addEventListener("click", action); return b;
}
let platformUsage: Awaited<ReturnType<MnemosAccountSession["readPlatformMetrics"]>> | null = null;
let metricsNotice = "";
async function loadPlatformMetrics() {
  if (busy || closed) return;
  busy = true; platformUsage = null; metricsNotice = ""; render();
  try {
    const usage = await host.ui.readPlatformMetrics();
    if (!closed) platformUsage = usage;
  } catch {
    if (!closed) metricsNotice = "Метрики недоступны. Проверьте право просмотра или повторите позже.";
  } finally { busy = false; if (!closed) render(); }
}
let trackerView: TaskTrackerView | null = null;
let agentQuality: AgentQuality | null = null;
let searchEvaluation: SearchEvaluation | null = null;
let answerEvaluation: AnswerEvaluation | null = null;
let agentAnswers: AgentAnswers | null = null;
let businessOverview: BusinessOverview | null = null;
let signalsOverview: SignalsOverview | null = null;
let projectSignals: ProjectSignalsView | null = null;
let expenseOverview: BudgetOverview | null = null;
let resourceMapView: ResourceMapView | null = null;
let corporateImportView:CorporateImportView|null=null;
let voiceView:VoiceView|null=null;
let telegramView:TelegramView|null=null;
let imapAccountsView:ImapAccountsView|null=null;
let webdavAccountsView:WebDAVAccountsView|null=null;
let caldavAccountsView:CalDAVAccountsView|null=null;
let uploadUsageView:UploadUsageView|null=null;
let centroidView:CentroidView|null=null;
let reindexBatchView:ReindexBatchView|null=null;
let reindexView:ReindexView|null=null;
let policyAlertsView:PolicyAlertsView|null=null;
let platformSignalInboxView:PlatformSignalInboxView|null=null;
let platformSignalOwnersView:PlatformSignalOwnersView|null=null;
let roleMembershipView:RoleMembershipView|null=null;
let calendarConnectionsView:CalendarConnectionsView|null=null;
let mailConnectionsView:MailConnectionsView|null=null;
let databaseConnectionsView:DatabaseConnectionsView|null=null;
let operationAuditView:OperationAuditView|null=null;
let gitConnectionsView: GitConnectionsView | null = null;
let workTemplateView: WorkTemplateView | null = null;
let absenceTaskView: AbsenceTaskView | null = null;
let teamBudgetView: TeamBudgetView | null = null;
/** Разделы, которые открываются и с домашней страницы «Ещё», и из вкладок React (openLegacySection). */
const openers = {
  signalsOverview: ()=>{signalsOverview=new SignalsOverview(root,host.ui,()=>{signalsOverview=null;render();},project=>{signalsOverview=null;projectSignals=new ProjectSignalsView(root,host.ui,projects,()=>{projectSignals=null;render();},project,task=>{projectSignals=null;void openTaskTracker(task.project,"",task);});void projectSignals.published();});void signalsOverview.load();},
  projectSignals: ()=>{projectSignals=new ProjectSignalsView(root,host.ui,projects,()=>{projectSignals=null;render();},"",task=>{projectSignals=null;void openTaskTracker(task.project,"",task);});projectSignals.render();},
  businessOverview: ()=>{businessOverview=new BusinessOverview(root,host.ui,projects,()=>{businessOverview=null;render();},(project,node,head,side)=>host.downloadText(project,node,head,side),source=>{businessOverview=null;teamBudgetView=new TeamBudgetView(root,host.ui,source.project,review=>{teamBudgetView=null;if(review)taskRequest=review;render();});const view=teamBudgetView;void view.load().then(()=>{if(teamBudgetView===view)view.prepareAnalytics(source);});},(project,view)=>{businessOverview=null;if(view==='expenses')openExpenses(project);else openAnswers(project);});businessOverview.render();},
  agentAnswers: ()=>openAnswers(),
  agentQuality: ()=>{agentQuality=new AgentQuality(root,host.ui,projects,()=>{agentQuality=null;render();},project=>{agentQuality=null;openAnswers(project);});agentQuality.render();},
  expenses: ()=>openExpenses(),
  jiraImport: ()=>{corporateImportView=new CorporateImportView(root,host.ui,projects,()=>{corporateImportView=null;render();});corporateImportView.render();},
  bitrixImport: ()=>{corporateImportView=new CorporateImportView(root,host.ui,projects,()=>{corporateImportView=null;render();},"bitrix");corporateImportView.render();},
  voice: ()=>{voiceView=new VoiceView(root,host.ui,()=>{voiceView=null;void host.ui.managedTaskRequest().then(task=>{taskRequest=task;render();}).catch(()=>{notice="Не удалось перечитать задачу агента.";render();});});voiceView.render();},
  resourceMap: ()=>{resourceMapView=new ResourceMapView(root,host.ui,projects,()=>{resourceMapView=null;render();},(project,node,head,side)=>host.downloadText(project,node,head,side),(project,text)=>host.uploadText(project,text),(project,node)=>{resourceMapView=null;openProject=project;void openEditor(project,node);},source=>{resourceMapView=null;teamBudgetView=new TeamBudgetView(root,host.ui,source.project,review=>{teamBudgetView=null;if(review)taskRequest=review;render();});const view=teamBudgetView;void view.load().then(()=>{if(teamBudgetView===view)view.prepareObservability(source);});});resourceMapView.render();},
  workTemplates: () => {workTemplateView=new WorkTemplateView(root,host.ui,projects,()=>{workTemplateView=null;render();},(project,node,version,side)=>host.downloadText(project,node,version,side));workTemplateView.render();},
  telegram: () => {telegramView=new TelegramView(root,host.ui,()=>{telegramView=null;render();});telegramView.render();void telegramView.list();},
  imap: () => {imapAccountsView=new ImapAccountsView(root,host.ui,()=>{imapAccountsView=null;render();});void imapAccountsView.load();},
  webdav: () => {webdavAccountsView=new WebDAVAccountsView(root,host.ui,()=>{webdavAccountsView=null;render();});void webdavAccountsView.load();},
  caldav: () => {caldavAccountsView=new CalDAVAccountsView(root,host.ui,()=>{caldavAccountsView=null;render();});void caldavAccountsView.load();},
  calendar: () => {calendarConnectionsView=new CalendarConnectionsView(root,host.ui,()=>{calendarConnectionsView=null;render();},(id,hash)=>host.createCalendarDraft(id,hash));void calendarConnectionsView.listConnections();},
  mail: () => {mailConnectionsView=new MailConnectionsView(root,host.ui,()=>{mailConnectionsView=null;render();},(id,hash)=>host.sendMailDraft(id,hash),(bytes,filename)=>host.saveMailAttachment(bytes,filename));void mailConnectionsView.listConnections();},
  databases: () => {databaseConnectionsView=new DatabaseConnectionsView(root,host.ui,projects,()=>{databaseConnectionsView=null;render();});void databaseConnectionsView.discover();},
  git: () => {gitConnectionsView=new GitConnectionsView(root,host.ui,()=>{gitConnectionsView=null;render();},projects);void gitConnectionsView.load();},
  operationAudit: () => {operationAuditView=new OperationAuditView(root,host.ui,()=>{operationAuditView=null;render();});void operationAuditView.load();},
  policyAlerts: () => {policyAlertsView=new PolicyAlertsView(root,host.ui,()=>{policyAlertsView=null;render();});void policyAlertsView.load();},
  signalInbox: () => {platformSignalInboxView=new PlatformSignalInboxView(root,host.ui,()=>{platformSignalInboxView=null;render();});void platformSignalInboxView.load();},
  // С домашней страницы закрытие перечитывает метрики (раздел открыт из них); во вкладке достаточно перерисовки.
  signalOwners: () => {platformSignalOwnersView=new PlatformSignalOwnersView(root,host.ui,()=>{platformSignalOwnersView=null;if(embedded)render();else void loadPlatformMetrics();});void platformSignalOwnersView.read();},
  reindexBatch: () => {reindexBatchView=new ReindexBatchView(root,host.ui,projects,()=>{reindexBatchView=null;render();});void reindexBatchView.load();},
  searchEvaluation: () => {searchEvaluation=new SearchEvaluation(root,host.ui,projects,()=>{searchEvaluation=null;render();},(project,node,head,side)=>host.downloadText(project,node,head,side));searchEvaluation.render();},
  answerEvaluation: () => {answerEvaluation=new AnswerEvaluation(root,host.ui,projects,()=>{answerEvaluation=null;render();},(project,node,head,side)=>host.downloadText(project,node,head,side));answerEvaluation.render();},
  uploadUsage: () => {uploadUsageView=new UploadUsageView(root,host.ui,()=>{uploadUsageView=null;render();});void uploadUsageView.load();},
  roleMembership: () => {roleMembershipView=new RoleMembershipView(root,host.ui,()=>{roleMembershipView=null;render();});roleMembershipView.render();},
  metrics: () => void loadPlatformMetrics(),
  memory: () => void openMemoryEditor(),
  budget: () => void openBudgetEditor(),
  taskHistory: () => void openTaskHistory(),
  collaborations: () => void openCollaborations(),
  agentTask: () => render(),
  absence: (project: string) => void openAbsenceEditor(project),
  policy: (project: string) => void openPolicy(project),
  tracker: (project: string) => void openTaskTracker(project),
  centroid: (project: string, name: string) => {centroidView=new CentroidView(root,host.ui,project,name,()=>{centroidView=null;render();});void centroidView.load();},
  engagement: (binding: string, name: string) => void openEngagementEditor(binding, name),
};
export type LegacySection =
  | { kind: "signalsOverview" | "projectSignals" | "businessOverview" | "agentAnswers" | "agentQuality" | "expenses" | "jiraImport" | "bitrixImport" | "voice" | "resourceMap" | "workTemplates" | "telegram" | "imap" | "webdav" | "caldav" | "calendar" | "mail" | "databases" | "git" | "operationAudit" | "policyAlerts" | "signalInbox" | "signalOwners" | "reindexBatch" | "searchEvaluation" | "answerEvaluation" | "uploadUsage" | "roleMembership" | "metrics" | "memory" | "budget" | "taskHistory" | "collaborations" | "agentTask" }
  | { kind: "document"; project: string; node: string }
  | { kind: "absence" | "policy" | "tracker"; project: string }
  | { kind: "centroid"; project: string; name: string }
  | { kind: "engagement"; binding: string; name: string };
/** Раздел, открытый из вкладки React: по его закрытии контейнер возвращается вкладке, а не домашней странице. */
let embedded: { section: LegacySection; close: () => void } | null = null;
/** Раздел, открытие которого отложено: открыватели молча выходят при busy, поэтому ждём конца текущей загрузки. */
let embeddedPending: LegacySection | null = null;
export function openLegacySection(section: LegacySection, close: () => void): void {
  embedded = { section, close }; notice = "";
  if (busy) { embeddedPending = section; render(); return; }
  startSection(section);
}
function startSection(section: LegacySection): void {
  switch (section.kind) {
    case "document": openProject = section.project; void openEditor(section.project, section.node); break;
    case "absence": openers.absence(section.project); break;
    case "policy": openers.policy(section.project); break;
    case "tracker": openers.tracker(section.project); break;
    case "centroid": openers.centroid(section.project, section.name); break;
    case "engagement": openers.engagement(section.binding, section.name); break;
    default: openers[section.kind]();
  }
}
/** Вкладка ушла: сбросить всё, что раздел мог открыть, и вернуть контейнеру домашнюю страницу. */
export function closeLegacySection(): void {
  embedded = null; embeddedPending = null; notice = "";
  signalsOverview = null; projectSignals = null; businessOverview = null; agentAnswers = null; agentQuality = null; expenseOverview = null; corporateImportView = null; voiceView = null; resourceMapView = null; workTemplateView = null;
  uploadUsageView = null; centroidView = null; reindexBatchView = null; reindexView = null; policyAlertsView = null; platformSignalInboxView = null; platformSignalOwnersView = null; roleMembershipView = null;
  telegramView = null; imapAccountsView = null; webdavAccountsView = null; caldavAccountsView = null; calendarConnectionsView = null; mailConnectionsView = null; databaseConnectionsView = null; operationAuditView = null; gitConnectionsView = null;
  answerEvaluation = null; searchEvaluation = null; trackerView = null; absenceTaskView = null; teamBudgetView = null;
  budgetEditor = null; taskHistory = null; collaborationView = null; absenceEditor = null; engagementEditor = null; memoryEditor = null; editor = null; policyEditor = null;
  render();
}
function renderEmbeddedTail() {
  const current = embedded!;
  const closeButton = () => button("Закрыть раздел", () => { embedded = null; current.close(); });
  const status = () => { const message = element("p", busy ? "Загрузка…" : notice); message.setAttribute("role", "status"); root.append(message); };
  if (embeddedPending) {
    if (busy) { status(); return; }
    const pending = embeddedPending; embeddedPending = null;
    startSection(pending);
    // Открыватель сам перерисовал контейнер; если он ничего не открыл синхронно, ниже покажем состояние.
    if (busy || uploadUsageView || centroidView || reindexBatchView || policyAlertsView || platformSignalInboxView || platformSignalOwnersView || roleMembershipView || telegramView || imapAccountsView || webdavAccountsView || caldavAccountsView || calendarConnectionsView || mailConnectionsView || databaseConnectionsView || operationAuditView || gitConnectionsView || answerEvaluation || searchEvaluation || trackerView) return;
  }
  if (current.section.kind === "metrics") {
    root.append(button("Обновить метрики", () => void loadPlatformMetrics()));
    if (metricsNotice) root.append(element("p", metricsNotice));
    if (platformUsage) renderPlatformMetrics(platformUsage);
    if (busy) status();
    root.append(closeButton()); return;
  }
  if (current.section.kind === "agentTask") { renderAgentTask(); if (notice || busy) status(); root.append(closeButton()); return; }
  if (busy) { status(); return; }
  if (notice) { status(); root.append(closeButton()); return; }
  embedded = null; current.close();
}
function render() {
  reportUnsavedChanges();
 if(uploadUsageView){uploadUsageView.render();return;}
 if(centroidView){centroidView.render();return;}
 if(reindexBatchView){reindexBatchView.render();return;}
 if(reindexView){reindexView.render();return;}
 if(policyAlertsView){policyAlertsView.render();return;}
 if(platformSignalInboxView){platformSignalInboxView.render();return;}
 if(platformSignalOwnersView){platformSignalOwnersView.render();return;}
 if(roleMembershipView){roleMembershipView.render();return;}
 if(corporateImportView){corporateImportView.render();return;}
 if(voiceView){voiceView.render();return;}
 if(telegramView){telegramView.render();return;}
 if(imapAccountsView){imapAccountsView.render();return;}
 if(webdavAccountsView){webdavAccountsView.render();return;}
 if(caldavAccountsView){caldavAccountsView.render();return;}
  if(calendarConnectionsView){calendarConnectionsView.render();return;}
 if(mailConnectionsView){mailConnectionsView.render();return;}
 if(databaseConnectionsView){databaseConnectionsView.render();return;}
 if(operationAuditView){operationAuditView.render();return;}
 if(gitConnectionsView){gitConnectionsView.render();return;}
  if (answerEvaluation) {answerEvaluation.render();return;}
  if (searchEvaluation) {searchEvaluation.render();return;}
  if (agentQuality) {agentQuality.render();return;}
  if (agentAnswers) {agentAnswers.render();return;}
  if (businessOverview) {businessOverview.render();return;}
  if (signalsOverview) {signalsOverview.render();return;}
  if (projectSignals) {projectSignals.render();return;}
  if (expenseOverview) {expenseOverview.render();return;}
  if (resourceMapView) {resourceMapView.render();return;}
  if (trackerView) {trackerView.render();return;}
  if (workTemplateView) {workTemplateView.render();return;}
  if (absenceTaskView) {absenceTaskView.render(); return;}
  if (teamBudgetView) {teamBudgetView.render(); return;}
  root.replaceChildren();
  if (!embedded) root.append(element("h1", "Корпоративная память"));
  if (budgetEditor) {renderBudgetEditor(); return;}
  if (taskHistory) { renderTaskHistory(); return; }
  if (collaborationView) { renderCollaborations(); return; }
  if (absenceEditor) { renderAbsenceEditor(); return; }
  if (engagementEditor) { renderEngagementEditor(); return; }
  if (memoryEditor) { renderMemoryEditor(); return; }
  if (editor) { renderEditor(editor); return; }
  if (policyEditor) { renderPolicyEditor(policyEditor); return; }
  if (embedded) { renderEmbeddedTail(); return; }
  if (inboxOpen) { renderInbox(); return; }
  if (identity) root.append(element("p", `${identity.tenant_name} · ${identity.subject.user_id}`));
  if (identity) {
    root.append(button("Обзор проектов",()=>{signalsOverview=new SignalsOverview(root,host.ui,()=>{signalsOverview=null;render();},project=>{signalsOverview=null;projectSignals=new ProjectSignalsView(root,host.ui,projects,()=>{projectSignals=null;render();},project,task=>{projectSignals=null;void openTaskTracker(task.project,"",task);});void projectSignals.published();});void signalsOverview.load();}));
    root.append(button("Оценка данных проекта",()=>{projectSignals=new ProjectSignalsView(root,host.ui,projects,()=>{projectSignals=null;render();},"",task=>{projectSignals=null;void openTaskTracker(task.project,"",task);});projectSignals.render();}));
    root.append(button("Организация и клиенты",()=>{businessOverview=new BusinessOverview(root,host.ui,projects,()=>{businessOverview=null;render();},(project,node,head,side)=>host.downloadText(project,node,head,side),source=>{businessOverview=null;teamBudgetView=new TeamBudgetView(root,host.ui,source.project,review=>{teamBudgetView=null;if(review)taskRequest=review;render();});const view=teamBudgetView;void view.load().then(()=>{if(teamBudgetView===view)view.prepareAnalytics(source);});},(project,view)=>{businessOverview=null;if(view==='expenses')openExpenses(project);else openAnswers(project);});businessOverview.render();}));
    root.append(button("Ответы агентов",()=>openAnswers()));
    root.append(button("Качество агентов",()=>{agentQuality=new AgentQuality(root,host.ui,projects,()=>{agentQuality=null;render();},project=>{agentQuality=null;openAnswers(project);});agentQuality.render();}));
    root.append(button("Расходы по проектам",()=>openExpenses()));
    root.append(button("Трекер проекта",()=>void openTaskTracker()));
    root.append(button("Перенос из Jira",()=>{corporateImportView=new CorporateImportView(root,host.ui,projects,()=>{corporateImportView=null;render();});corporateImportView.render();}));
    root.append(button("Перенос из Bitrix24",()=>{corporateImportView=new CorporateImportView(root,host.ui,projects,()=>{corporateImportView=null;render();},"bitrix");corporateImportView.render();}));
    root.append(button("Аудио",()=>{voiceView=new VoiceView(root,host.ui,()=>{voiceView=null;void host.ui.managedTaskRequest().then(task=>{taskRequest=task;render();}).catch(()=>{notice="Не удалось перечитать задачу агента.";render();});});voiceView.render();}));
    root.append(button("Ресурсы проекта",()=>{resourceMapView=new ResourceMapView(root,host.ui,projects,()=>{resourceMapView=null;render();},(project,node,head,side)=>host.downloadText(project,node,head,side),(project,text)=>host.uploadText(project,text),(project,node)=>{resourceMapView=null;openProject=project;void openEditor(project,node);},source=>{resourceMapView=null;teamBudgetView=new TeamBudgetView(root,host.ui,source.project,review=>{teamBudgetView=null;if(review)taskRequest=review;render();});const view=teamBudgetView;void view.load().then(()=>{if(teamBudgetView===view)view.prepareObservability(source);});});resourceMapView.render();}));
    root.append(button("Рабочие шаблоны", () => {workTemplateView=new WorkTemplateView(root,host.ui,projects,()=>{workTemplateView=null;render();},(project,node,version,side)=>host.downloadText(project,node,version,side));workTemplateView.render();}));
    // Метрики остаются и здесь: их проверяет прежний тест app.test.mjs; вкладка «Организация» открывает тот же раздел.
    if (identity.capabilities?.includes("platform.metrics.read")) root.append(button("Метрики платформы", () => openers.metrics()));
    if (metricsNotice) root.append(element("p", metricsNotice));
    if (platformUsage) renderPlatformMetrics(platformUsage);
    renderManagedAgent();
    renderAgentTask();
    root.append(button("Согласования", () => { inboxOpen = true; void loadInbox(false); }));
    root.append(element("h2", "Доступные проекты"));
    const projectList = element("ul");
    for (const project of projects) { const item = element("li"); item.append(button(project.name, () => void browse(project.id, false)), element("p", project.slug)); projectList.append(item); }
    root.append(projectList);
    if (!projects.length) root.append(element("p", "Нет доступных проектов."));
  }
  if (openProject) {
    root.append(element("h2", "Документы проекта"));
    root.append(button("Пересчитать профиль проекта",()=>{centroidView=new CentroidView(root,host.ui,openProject,projects.find(p=>p.id===openProject)?.name??openProject,()=>{centroidView=null;render();});void centroidView.load();}));
    root.append(button("Замещение на время отсутствия", () => void openAbsenceEditor(openProject)));
    root.append(button("Настроить согласования", () => void openPolicy(openProject)));
    const form = element("form"), label = element("label", "Поиск по опубликованным документам проекта");
    const input = element("input"); input.type = "search"; input.id = "project-search"; input.maxLength = 2048;
    label.htmlFor = input.id; input.value = searchQuery; input.disabled = busy;
    input.addEventListener("input", () => { searchQuery = input.value; });
    // The host sandbox forbids native form submission; invoke the RPC directly.
    const submit = button("Найти", () => { void search(); }); submit.type = "button";
    input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void search(); } });
    form.addEventListener("submit", event => { event.preventDefault(); });
    form.append(label, input, submit); root.append(form);
    if (searchPage) {
      root.append(element("h3", "Результаты поиска"));
      if (searchPage.index_pending) root.append(element("p", "Часть опубликованных документов ещё индексируется. Повторите поиск позже."));
      if (searchPage.degraded) root.append(element("p", "Поиск работает в ограниченном режиме; результаты могут быть неполными."));
      if (!searchPage.hits.length) root.append(element("p", searchPage.index_pending || searchPage.degraded ? "Совпадений пока нет." : "Совпадений не найдено."));
      const results = element("ul");
      for (const hit of searchPage.hits) {
        const item = element("li"); item.append(button(hit.name || hit.node_id, () => void readDocument(hit.node_id)), element("p", hit.text)); results.append(item);
      }
      root.append(results);
    }
    const list = element("ul");
    for (const node of nodes) {
      const item = element("li");
      item.append(node.is_dir ? element("strong", node.name) : button(node.name, () => void readDocument(node.node_id)));
      if (!node.is_dir) item.append(button(`Пересчитать индекс: ${node.name}`,()=>{reindexView=new ReindexView(root,host.ui,node.node_id,node.name,()=>{reindexView=null;render();});void reindexView.load();}));
      if (!node.is_dir) item.append(button(`История: ${node.name}`, () => void loadHistory(openProject, node.node_id, node.name)));
      list.append(item);
    }
    root.append(list);
    if (nodeTruncated) root.append(element("p", "Показана часть доступных документов."));
    if (nodeCursor) root.append(button("Ещё документы", () => void browse(openProject, true)));
    if (!busy && !nodes.length) root.append(element("p", "Нет доступных документов."));
  }
  if (documentContent) {
    root.append(element("h2", "Содержимое документа"), element("pre", documentContent.text));
    root.append(button("Редактировать личный черновик", () => void openEditor()));
    if (documentContent.truncated) root.append(element("p", "Показана часть текста документа."));
  }
  if (history) renderHistory(history);
  root.append(element("h2", "Подключения агентов"));
  root.append(element("p", "Доступ к документам определяется правами агента и ограничен вашими правами."));
  root.append(button("Обновить список", () => void load(false)));
  if (notice || busy) { const message = element("p", busy ? "Загрузка…" : notice); message.setAttribute("role", "status"); root.append(message); }
  if (!busy && !notice && !rows.length) root.append(element("p", "Подключений пока нет."));
  const list = element("ul");
  for (const row of rows) {
    const item = element("li"); item.append(element("strong", row.agent_principal_id), element("p", `${row.runtime_id} · ${row.runtime_agent_id}`), element("p", row.revoked ? "Доступ отозван" : "Доступ не отозван"));
    item.append(button("Разрешения на привлечение", () => void openEngagementEditor(row.binding_id, row.agent_principal_id)));
    if (row.revoked === false) {
      if (selected === row.binding_id) {
        item.append(element("p", "Отозвать доступ этого агента к Mnemos?"), button("Подтвердить отзыв", () => void revoke(row.binding_id)), button("Отмена", () => { selected = ""; render(); }));
      } else item.append(button("Отозвать доступ", () => { selected = row.binding_id; render(); }));
    }
    list.append(item);
  }
  root.append(list);
  if (cursor) root.append(button("Показать ещё", () => void load(true)));
}
async function load(more: boolean) {
  if (busy || closed) return;
  const readiness = more ? null : startUIReadinessAttempt(sample=>host.ui.recordUIReadiness(sample));
  if (readiness) { activeUIReadiness?.finish("abandoned"); activeUIReadiness=readiness; }
  let initialDataReady=false;
  busy = true; notice = ""; selected = "";
  if (!more) { platformUsage = null; metricsNotice = ""; rows = []; cursor = ""; identity = null; projects = []; openProject = ""; nodes = []; documentContent = null; history = null; searchPage = null; searchQuery = ""; }
  render();
  try {
    if (!more) {
      const [person, visible, request, task] = await Promise.all([host.ui.whoAmI(), host.ui.listProjects(), host.ui.managedAgentRequest(), host.ui.managedTaskRequest()]);
      if (closed) return;
      identity = person; projects = visible.projects; managedRequest = request; taskRequest = task;
    }
    const page = await host.ui.listAgentConnections(more ? cursor : "");
    if (closed) return;
    const merged = new Map(rows.map(row => [row.binding_id, row]));
    for (const row of page.connections) merged.set(row.binding_id, row);
    rows = [...merged.values()]; cursor = page.next_cursor ?? ""; initialDataReady=true;
  } catch { rows = []; cursor = ""; identity = null; projects = []; openProject = ""; nodes = []; documentContent = null; history = null; searchPage = null; searchQuery = ""; notice = "Не удалось загрузить подключения. Проверьте сессию и обновите список."; }
  finally {
    busy = false;
    if (!closed) render();
    if (closed || document.hidden) readiness?.finish("abandoned");
    else if(initialDataReady) void readiness?.afterPaint();
    else readiness?.finish("error");
  }
}
async function revoke(id: string) {
  if (busy || closed) return;
  busy = true; notice = ""; selected = ""; render();
  try {
    await host.ui.revokeAgentConnection(id);
    if (closed) return;
    rows = []; cursor = ""; busy = false;
    await load(false);
  } catch { rows = []; cursor = ""; identity = null; projects = []; openProject = ""; nodes = []; documentContent = null; history = null; searchPage = null; searchQuery = ""; notice = "Результат отзыва не подтверждён. Обновите список перед повтором."; }
  finally { busy = false; if (!closed) render(); }
}
async function browse(project: string, more: boolean) {
  if (busy || closed) return;
  busy = true; notice = ""; documentContent = null; history = null;
  if (!more) { searchPage = null; searchQuery = ""; openProject = project; nodes = []; nodeCursor = ""; nodeTruncated = false; }
  render();
  try {
    const page = await host.ui.browseProject(project, more ? nodeCursor : "");
    if (closed) return;
    const merged = new Map(nodes.map(node => [node.node_id, node]));
    for (const node of page.nodes) merged.set(node.node_id, node);
    nodes = [...merged.values()]; nodeCursor = page.next_cursor ?? ""; nodeTruncated = page.truncated;
  } catch { openProject = ""; nodes = []; documentContent = null; history = null; searchPage = null; searchQuery = ""; notice = "Не удалось открыть проект. Обновите список и проверьте доступ."; }
  finally { busy = false; if (!closed) render(); }
}
async function search() {
  if (busy || closed || !openProject) return;
  searchPage = null; documentContent = null; history = null;
  if (!searchQuery.trim() || new TextEncoder().encode(searchQuery).length > 4096) {
    notice = "Введите поисковый запрос до 4096 байт."; render(); return;
  }
  busy = true; notice = ""; render();
  try { const page = await host.ui.searchProject(openProject, searchQuery); if (!closed) searchPage = page; }
  catch { searchPage = null; notice = "Не удалось выполнить поиск. Проверьте доступ и повторите запрос."; }
  finally { busy = false; if (!closed) render(); }
}
async function readDocument(node: string) {
  if (busy || closed) return;
  busy = true; notice = ""; documentContent = null; history = null; render();
  try { const content = await host.ui.readProjectDocument(openProject, node); if (!closed) documentContent = content; }
  catch { nodes = []; documentContent = null; history = null; notice = "Документ недоступен или его текст ещё готовится. Обновите проект."; }
  finally { busy = false; if (!closed) render(); }
}
async function loadHistory(project: string, node: string, name: string, cursor = "") {
  if (busy || closed) return;
  const baseline = cursor && history?.project === project && history.node === node ? history.baseline : undefined;
  busy = true; notice = ""; history = null; render();
  try {
    const page = await host.ui.nodeHistory(project, node, cursor);
    if (!closed) history = { project, node, name, page, baseline };
  } catch {
    documentContent = null;
    notice = "История недоступна. Проверьте соединение и доступ к документу, затем откройте историю заново.";
  } finally { busy = false; if (!closed) render(); }
}
async function openHistoryVersion(current: NonNullable<typeof history>, event: string) {
  if (busy || closed || history !== current) return;
  current.opened = undefined; current.comparison = undefined; busy = true; notice = ""; render();
  try {
    const text = await host.downloadText(current.project, current.node, `publication:${event}`, 0);
    if (!closed && history === current) current.opened = { event, text };
  } catch {
    history = null; documentContent = null;
    notice = "Не удалось открыть версию. Проверьте доступ и откройте историю заново. Просмотр поддерживает текстовые файлы до 256 КиБ.";
  } finally { busy = false; if (!closed) render(); }
}
async function compareHistoryVersions(current: NonNullable<typeof history>, right: HistoryEvent) {
  const left = current.baseline;
  if (busy || closed || history !== current || !left || left.event_id === right.event_id) return;
  current.opened = undefined; current.comparison = undefined; busy = true; notice = ""; render();
  try {
    const read = (event: HistoryEvent) => event.exists
      ? host.downloadText(current.project, current.node, `publication:${event.event_id}`, 0)
      : Promise.resolve(null);
    const before = await read(left);
    const after = await read(right);
    // Both versions (including absent content) need current access after the
    // whole comparison has loaded. Never display half a failed comparison.
    await host.ui.nodeHistory(current.project, current.node, "");
    if (!closed && history === current) current.comparison = { left, right, before, after };
  } catch {
    history = null; documentContent = null;
    notice = "Не удалось сравнить версии. Проверьте доступ и выберите версии заново. Просмотр поддерживает текстовые файлы до 256 КиБ.";
  } finally { busy = false; if (!closed) render(); }
}
function historyDate(event: HistoryEvent): string {
  const date = new Date(event.recorded_at);
  return Number.isNaN(date.getTime()) ? "Время не указано" : date.toLocaleString("ru-RU");
}
function renderHistory(current: NonNullable<typeof history>) {
  const section = element("section"); section.setAttribute("aria-label", "История публикаций");
  section.append(element("h2", `История публикаций: ${current.name}`));
  section.append(element("p", "Здесь показаны принятые версии. Личные сохранения в эту историю не входят."));
  section.append(button("Обновить историю", () => void loadHistory(current.project, current.node, current.name)));
  section.append(button("Закрыть историю", () => { history = null; render(); }));
  if (current.baseline) {
    section.append(element("p", `Выбрана версия для сравнения: ${historyDate(current.baseline)}${current.baseline.exists ? "" : " (документ отсутствует)"}. Можно выбрать вторую на другой странице.`));
    section.append(button("Сбросить выбор версий", () => { current.baseline = undefined; current.comparison = undefined; render(); }));
  }
  if (current.comparison) {
    const compared = current.comparison;
    const group = element("section"); group.setAttribute("aria-label", "Сравнение опубликованных версий");
    group.append(element("h3", compared.before === compared.after ? "Содержимое версий совпадает" : "Содержимое версий отличается"));
    const columns = element("div"); columns.style.display = "grid"; columns.style.gridTemplateColumns = "repeat(auto-fit, minmax(min(100%, 280px), 1fr))"; columns.style.gap = "1rem";
    for (const [title, event, text] of [["Выбранная версия", compared.left, compared.before], ["Версия для сравнения", compared.right, compared.after]] as const) {
      const column = element("div"); column.append(element("h4", `${title}: ${historyDate(event)}`));
      const body = element(text === null ? "p" : "pre", text === null ? "Документ отсутствует" : text || "(Пустой файл)");
      body.style.whiteSpace = "pre-wrap"; body.style.overflowWrap = "anywhere";
      column.append(body); columns.append(column);
    }
    group.append(columns); section.append(group);
  }
  if (!current.page.events.length) section.append(element("p", "На этой странице нет событий публикации."));
  const list = element("ol");
  for (const event of current.page.events) {
    const row = element("li"), date = new Date(event.recorded_at);
    row.append(element("p", event.observed ? "Состояние на момент подключения истории" : event.exists ? "Опубликована версия" : "Документ удалён из общей версии"));
    row.append(element("p", Number.isNaN(date.getTime()) ? "Время не указано" : date.toLocaleString("ru-RU")));
    if (event.actor) row.append(element("p", `Автор действия: ${event.actor}`));
    else row.append(element("p", "Автор действия не указан"));
    if (event.on_behalf_of) row.append(element("p", `От имени: ${event.on_behalf_of}`));
    if (event.exists && event.content_type === "text/plain") row.append(button("Открыть эту версию", () => void openHistoryVersion(current, event.event_id)));
    else if (event.exists) row.append(element("p", "Просмотр этого формата пока недоступен."));
    if (!event.exists || event.content_type === "text/plain") {
      row.append(button("Выбрать для сравнения", () => { current.baseline = event; current.comparison = undefined; current.opened = undefined; render(); }));
      if (current.baseline && current.baseline.event_id !== event.event_id) row.append(button("Сравнить с выбранной", () => void compareHistoryVersions(current, event)));
    }
    if (current.opened?.event === event.event_id) {
      const text = element("pre", current.opened.text || "(Пустой файл)"); text.setAttribute("aria-label", "Текст опубликованной версии"); row.append(text);
    }
    list.append(row);
  }
  section.append(list);
  if (current.page.next_cursor) section.append(button("Следующая страница истории", () => void loadHistory(current.project, current.node, current.name, current.page.next_cursor)));
  root.append(section);
}

function renderEditor(current: Editor) {
  root.append(element("h2", "Личный черновик"));
  root.append(element("p", "Сохранение меняет ваш черновик. Публикация делает изменения проекта общими."));
  if (current.doc.conflicted) root.append(element("p", "В документе конфликт. Выберите сторону как основу и подготовьте итоговый текст. Отсутствие документа не равно пустому тексту."));
  if (current.text === null || current.doc.conflicted) {
    current.doc.terms.forEach((term, side) => {
      if (term.present) root.append(button(`Открыть сторону ${side + 1}${term.negative ? " (основание слияния)" : ""}`, () => void loadEditorSide(side)));
    });
  }
  if(current.text !== null) {
    if(current.doc.content_type===resourceMapMime){try{root.append(element("pre",resourceMapText(current.text)));}catch{root.append(element("p","Некорректная карта: согласование недоступно."));return;}}else{
    const area = element("textarea"); area.setAttribute("aria-label", "Текст личного черновика"); area.value = current.text;
    area.setAttribute("aria-label", "Текст личного черновика"); area.rows = 20; area.style.width = "100%";
    area.disabled = busy || current.publishing !== null;area.readOnly=current.doc.conflicted;
    area.addEventListener("input", () => { current.text = area.value; reportUnsavedChanges(); }); root.append(area);
    }
    if(current.doc.conflicted&&!current.uncertain&&current.side!==undefined&&!current.doc.terms[current.side]?.negative)root.append(button("Принять показанную сторону конфликта",()=>void resolveEditorSide()));
    if (!current.doc.conflicted && !current.uncertain && !current.publishing) {
      if(current.doc.content_type!==resourceMapMime)root.append(button("Сохранить черновик", () => void saveEditor()));
      root.append(button("Отправить изменения на согласование", () => void requestReview()));
      root.append(button("Опубликовать изменения проекта…", () => void preparePublication()));
    }
  }
  if(current.requestingReview){root.append(element("p","Отправить на согласование все сохранённые изменения вашего черновика в этом проекте?"),button("Подтвердить отправку на согласование",()=>void requestReview(true)),button("Отменить отправку",()=>{current.requestingReview=false;render();}));}
  if (current.reviewId) {
    root.append(element("h3", "Согласование изменений"));
    const review = current.review;
    if (review) {
      const stale = review.stale || review.personal_head !== current.doc.head;
      root.append(element("p", stale ? "Согласование устарело. Отправьте актуальные изменения заново." : review.ready ? "Все согласующие приняли эту версию." : "Ожидаются решения согласующих."));
      for (const domain of review.domains) {
        root.append(element("h4", domain.domain_id));
        for (const approver of domain.approvers) {
          const decision = domain.decisions.find(d => d.approver_id === approver);
          root.append(element("p", `${approver}: ${decision ? decision.approved ? "Согласовано" : "Отклонено" : "Ожидается решение"}`));
        }
      }
    } else root.append(element("p", "Статус согласования не загружен."));
    root.append(button("Обновить статус согласования", () => void refreshReview()));
  }
  if (current.publishing) {
    root.append(element("p", "Будут опубликованы все изменения вашего личного черновика в этом проекте, включая другие документы. Продолжить?"));
    root.append(button("Подтвердить публикацию проекта", () => void publishEditor()), button("Отмена публикации", () => { current.publishing = null; render(); }));
  }
  if (notice || busy) { const status = element("p", busy ? "Загрузка…" : notice); status.setAttribute("role", "status"); root.append(status); }
  root.append(button("Закрыть редактор", () => {
    if (current.text !== current.original && !window.confirm("Закрыть редактор и потерять несохранённый текст?")) return;
    editor = null; notice = "";
    if (embedded?.section.kind === "document") { const close = embedded.close; embedded = null; close(); }
    else void readDocument(current.doc.node_id);
  }));
}
async function openEditor(project = openProject, node = documentContent?.node_id) {
  if (busy || closed || !node) return;
  busy = true; notice = ""; render();
  try {
    await host.ui.openDraft(project);
    const doc = await host.ui.readDraftDocument(project, node);
    if (closed) return;
    if (!doc.exists) throw new Error("Absent document");
    if (doc.content_type!==resourceMapMime&&doc.content_type!=="application/vnd.mnemos.task-tracker+json"&&!/^(text\/|application\/(json|xml|javascript|x-yaml|yaml)(;|$))/.test(doc.content_type ?? "")) throw new Error("Non-text document");
    editor = { project, doc, text: null, original: "", uncertain: false, publishing: null, reviewId: "", review: null };
    if (!doc.conflicted && doc.terms.length === 1 && doc.terms[0].present) {
      const text = await host.downloadText(project, node, doc.head, 0);
      if (!closed) { editor.text = text; editor.original = text; }
    }
  } catch { editor = null; notice = "Не удалось открыть текст личного черновика. Проверьте доступ, формат и размер документа (до 256 КиБ)."; }
  finally { busy = false; if (!closed) render(); }
}
async function loadEditorSide(side: number) {
  if (busy || closed || !editor) return;
  const current = editor; busy = true; notice = ""; render();
  try {
    const text = await host.downloadText(current.project, current.doc.node_id, current.doc.head, side);
    if (!closed) { current.text = text; current.original = text; current.side=side; }
  } catch { notice = "Не удалось открыть сторону. Версия или доступ могли измениться. Закройте и откройте редактор заново."; }
  finally { busy = false; if (!closed) render(); }
}
async function resolveEditorSide(){
  if(busy||closed||!editor||editor.uncertain||!editor.doc.conflicted||editor.side===undefined||editor.doc.terms[editor.side]?.negative||editor.text===null)return;
  const current=editor,side=current.side!;busy=true;notice="";render();
  try{
    const saved=await host.ui.resolveDraftConflict(current.project,current.doc.node_id,current.doc.head,side);
    const doc=await host.ui.readDraftDocument(current.project,current.doc.node_id);
    if(doc.head!==saved.head||doc.conflicted||!doc.exists)throw Error("Conflict state changed");
    if(!closed){current.doc=doc;current.side=undefined;current.reviewId="";current.review=null;notice="Показанная сторона принята в личной версии. Общее состояние не изменено; публикация требует нового согласования.";}
  }catch{current.uncertain=true;notice="Разрешение конфликта не подтверждено. Повтор отключён; откройте документ заново и проверьте результат.";}
  finally{busy=false;if(!closed)render();}
}
async function saveEditor() {
  if (busy || closed || !editor || editor.doc.conflicted || editor.text === null || editor.uncertain) return;
  const current = editor, text = current.text!;
  if (new TextEncoder().encode(text).length > 262144) { notice = "Текст превышает 256 КиБ."; render(); return; }
  busy = true; notice = ""; render(); let saving = false;
  try {
    const upload = await host.uploadText(current.project, text);
    if (closed) return;
    saving = true;
    const saved = await host.ui.saveDraftDocument(current.project, current.doc.node_id, upload, current.doc.head);
    if (!closed) { current.doc.head = saved.head; current.doc.conflicted = false; current.original = text; notice = "Черновик сохранён. Общая версия не изменена."; }
  } catch {
    current.uncertain = saving;
    notice = saving ? "Сохранение не подтверждено. Скопируйте текст и заново откройте черновик для проверки результата. Повторная запись отключена." : "Не удалось загрузить текст. Он сохранён в редакторе; можно повторить загрузку.";
  } finally { busy = false; if (!closed) render(); }
}
async function preparePublication() {
  if (busy || closed || !editor || editor.uncertain) return;
  const current = editor;
  if (current.text !== current.original || current.doc.conflicted) { notice = "Сначала сохраните итоговый текст черновика."; render(); return; }
  busy = true; notice = ""; render();
  try {
    const state = await host.ui.draftState(current.project);
    if (state.personal_head !== current.doc.head) throw new Error("Changed draft");
    if (!current.reviewId) { notice = "Сначала отправьте изменения на согласование."; return; }
    await loadReview(current, state);
    if (!current.review?.ready || current.review.stale) { notice = "Для публикации нужны актуальные решения всех согласующих."; return; }
    if (!closed) current.publishing = state;
  } catch { notice = "Версия или доступ могли измениться. Заново откройте черновик перед публикацией."; }
  finally { busy = false; if (!closed) render(); }
}
async function publishEditor() {
  if (busy || closed || !editor?.publishing || editor.uncertain) return;
  const current = editor, state = current.publishing!;
  busy = true; notice = ""; current.publishing = null; render();
  try {
    const result = await host.ui.publishDraft(current.project, state.personal_head, state.shared_head, "Publish reviewed changes");
    if (!closed) {
      current.uncertain = true;
      notice = result.published ? "Изменения проекта опубликованы. Закройте редактор и обновите документ." : result.conflicted ? "При публикации обнаружен конфликт. Заново откройте черновик и разрешите его." : "Публикация не выполнена. Заново откройте черновик для проверки состояния.";
    }
  } catch { current.uncertain = true; notice = "Результат публикации не подтверждён. Заново откройте черновик для проверки; повторная публикация отключена."; }
  finally { busy = false; if (!closed) render(); }
}

async function requestReview(confirmed=false) {
  if (busy || closed || !editor || editor.uncertain) return;
  const current = editor;
  if (current.text !== current.original || current.doc.conflicted) {
    notice = "Сначала сохраните итоговый текст черновика."; render(); return;
  }
  if(!confirmed){current.requestingReview=true;render();return;}
  if(!current.requestingReview)return;current.requestingReview=false;
  busy = true; notice = ""; render();
  try {
    const state = await host.ui.draftState(current.project);
    if (state.personal_head !== current.doc.head) throw new Error("Changed draft");
    const created = await host.ui.requestPublicationReview(current.project, state.personal_head, state.shared_head);
    current.reviewId = created.candidate_id; current.review = null;
    try { await loadReview(current, state); } catch { /* Keep ID so refresh can retry this read. */ }
    if (!closed) notice = "Изменения отправлены на согласование. Публикация станет доступна после решений всех назначенных согласующих. Новые правки потребуют нового согласования.";
  } catch {
    if (!closed) notice = "Отправка на согласование не подтверждена. Проверьте актуальность черновика и настройку согласующих проекта. Повторная отправка той же версии не создаёт дубликат.";
  } finally { busy = false; if (!closed) render(); }
}

async function loadReview(current: Editor, state: DraftState) {
  current.review = null;
  const review = await host.ui.readPublicationReview(current.reviewId);
  if (review.candidate_id !== current.reviewId || review.project_id !== current.project) throw new Error("Mismatched review");
  if (!closed && editor === current) current.review = { ...review, stale: review.stale || review.personal_head !== state.personal_head || review.shared_head !== state.shared_head };
}
async function refreshReview() {
  if (busy || closed || !editor?.reviewId) return;
  const current = editor;
  busy = true; notice = ""; current.review = null; render();
  try { await loadReview(current, await host.ui.draftState(current.project)); }
  catch { notice = "Не удалось обновить согласование. Версия или доступ могли измениться."; }
  finally { busy = false; if (!closed) render(); }
}

function renderInbox() {
  root.append(element("h2", "Отправленные и назначенные согласования"));
  root.append(button("К документам", () => { inboxOpen = false; inboxRows = []; inboxReview = null; comparison = null; comparedNodes.clear(); inboxCursor = ""; notice = ""; render(); }));
  root.append(button("Обновить согласования", () => void loadInbox(false)));
  if (notice || busy) { const status = element("p", busy ? "Загрузка…" : notice); status.setAttribute("role", "status"); root.append(status); }
  if (!busy && !inboxRows.length) root.append(element("p", inboxCursor ? "На этой странице нет доступных предложений. Можно перейти дальше." : "Доступных предложений нет."));
  for (const review of inboxRows) {
    const project = projects.find(p => p.id === review.project_id)?.name ?? review.project_id;
    const role = review.author_id === identity?.subject.user_id ? "Отправлено вами" : `Автор: ${review.author_id}`;
    const item = element("section");
    item.append(element("h3", project), element("p", role), element("p", review.domains.map(d => d.domain_id).join(", ")),
      button("Открыть согласование", () => void openInboxReview(review.candidate_id)));
    root.append(item);
  }
  if (inboxCursor) root.append(button("Следующая страница согласований", () => void loadInbox(true)));
  if (inboxReview) {
    root.append(element("h2", "Решения по предложению"));
    root.append(element("p", inboxReview.stale ? "Предложение устарело." : inboxReview.ready ? "Все согласующие приняли эту версию." : "Ожидаются решения согласующих."));
    for (const domain of inboxReview.domains) {
      root.append(element("h3", domain.domain_id));
      for (const node of domain.node_ids) root.append(button(`Сравнить документ ${node}`, () => void compareReviewDocument(node)));
      if (!inboxReview.stale && identity && domain.approvers.includes(identity.subject.user_id)) {
        const accept = button("Согласовать направление", () => void decideReview(domain.domain_id, true));
        accept.disabled = busy || !domain.node_ids.every(node => comparedNodes.has(node));
        if (!domain.node_ids.every(node => comparedNodes.has(node))) root.append(element("p", "Перед согласованием просмотрите все изменённые документы этого направления."));
        root.append(accept, button("Отклонить направление", () => void decideReview(domain.domain_id, false)));
      }
      for (const user of domain.approvers) {
        const decision = domain.decisions.find(d => d.approver_id === user);
        root.append(element("p", `${user}: ${decision ? decision.approved ? "Согласовано" : "Отклонено" : "Ожидается решение"}`));
      }
    }
    if(pendingReviewDecision&&pendingReviewDecision.candidate===inboxReview.candidate_id&&pendingReviewDecision.version===inboxReview.decision_version){const pending=pendingReviewDecision;root.append(element("p",`${pending.approved?"Согласовать":"Отклонить"} показанную версию направления «${pending.domain}»?`),button("Подтвердить решение",()=>void decideReview(pending.domain,pending.approved,true)),button("Отменить решение",()=>{pendingReviewDecision=null;render();}));}
    if (comparison) {
      root.append(element("h3", `Изменения документа ${comparison.node}`));
      const columns = element("div"); columns.style.display = "grid"; columns.style.gridTemplateColumns = "repeat(auto-fit, minmax(260px, 1fr))"; columns.style.gap = "16px";
      for (const [title, text, absent] of [["До изменений", comparison.before, "Документ ещё не существовал."], ["Предлагаемая версия", comparison.after, "Документ будет удалён."]] as const) {
        const section = element("section"); section.append(element("h4", title));
        if (text === null) section.append(element("p", absent));
        else { const content = element("pre", text === "" ? "(Пустой файл)" : text); content.style.whiteSpace = "pre-wrap"; content.style.overflowWrap = "anywhere"; section.append(content); }
        columns.append(section);
      }
      root.append(columns);
    }
    root.append(button("Обновить открытое согласование", () => void openInboxReview(inboxReview!.candidate_id)));
  }
}
async function loadInbox(more: boolean) {
  if (busy || closed) return;
  const next = more ? inboxCursor : "";
  busy = true; notice = ""; inboxRows = []; inboxReview = null; comparison = null; comparedNodes.clear(); inboxCursor = ""; render();
  try {
    const page = await host.ui.listPublicationReviews(next);
    if (!closed) { inboxRows = page.reviews; inboxCursor = page.next_cursor; }
  } catch { notice = "Не удалось загрузить согласования. Проверьте сессию и повторите обновление."; }
  finally { busy = false; if (!closed) render(); }
}
async function openInboxReview(id: string) {
  pendingReviewDecision=null;
  if (busy || closed) return;
  busy = true; notice = ""; inboxReview = null; comparison = null; comparedNodes.clear(); render();
  try {
    const review = await host.ui.readPublicationReview(id);
    if (review.candidate_id !== id) throw new Error("Mismatched review");
    if (!closed) inboxReview = review;
  } catch { inboxRows = []; inboxCursor = ""; notice = "Согласование недоступно. Обновите список и проверьте доступ."; }
  finally { busy = false; if (!closed) render(); }
}

async function compareReviewDocument(node: string) {
  if (busy || closed || !inboxReview) return;
  const review = inboxReview;
  if (!review.domains.some(domain => domain.node_ids.includes(node))) return;
  busy = true; notice = ""; comparison = null; render();
  try {
    const before = await host.downloadReviewText(review.candidate_id, node, review.decision_version, "before");
    const after = await host.downloadReviewText(review.candidate_id, node, review.decision_version, "after");
    const current = await host.ui.readPublicationReview(review.candidate_id);
    if (current.candidate_id !== review.candidate_id || current.decision_version !== review.decision_version || current.personal_head !== review.personal_head || current.shared_head !== review.shared_head || !current.domains.some(domain => domain.node_ids.includes(node))) throw new Error("Review changed");
    if (!closed) { inboxReview = current; comparison = { node, before:resourceReviewText(before), after:resourceReviewText(after) }; comparedNodes.add(node); }
  } catch { comparison = null; comparedNodes.clear(); notice = "Не удалось загрузить сравнение. Версия или доступ могли измениться. Здесь доступны текстовые файлы до 256 КиБ."; }
  finally { busy = false; if (!closed) render(); }
}

let pendingReviewDecision:{candidate:string;version:number;domain:string;approved:boolean}|null=null;
async function decideReview(domainId: string, approved: boolean, confirmed=false) {
  if (busy || closed || !inboxReview || inboxReview.stale || !identity) return;
  const review = inboxReview, domain = review.domains.find(d => d.domain_id === domainId);
  if (!domain || !domain.approvers.includes(identity.subject.user_id) || (approved && !domain.node_ids.every(node => comparedNodes.has(node)))) return;
  if(!confirmed){pendingReviewDecision={candidate:review.candidate_id,version:review.decision_version,domain:domainId,approved};render();return;}
  if(!pendingReviewDecision||pendingReviewDecision.candidate!==review.candidate_id||pendingReviewDecision.version!==review.decision_version||pendingReviewDecision.domain!==domainId||pendingReviewDecision.approved!==approved)return;
  pendingReviewDecision=null;
  busy = true; notice = ""; comparison = null; comparedNodes.clear(); render();
  try {
    await host.ui.recordReviewDecision(review.candidate_id, domainId, review.decision_version, approved);
    const current = await host.ui.readPublicationReview(review.candidate_id);
    if (current.candidate_id !== review.candidate_id) throw new Error("Mismatched review");
    if (!closed) { inboxReview = current; notice = approved ? "Согласие записано." : "Отказ записан."; }
  } catch {
    inboxReview = null; inboxRows = []; inboxCursor = "";
    notice = "Результат решения не подтверждён. Обновите список и проверьте согласование перед повтором.";
  } finally { busy = false; if (!closed) render(); }
}

async function openPolicy(project: string) {
  if (busy || closed) return;
  if (policyEditor?.dirty && !window.confirm("Загрузить настройки заново и потерять несохранённые изменения?")) return;
  busy = true; notice = ""; render();
  try {
    const policy = await host.ui.readPublicationPolicy(project);
    if (policy.project_id !== project) throw new Error("Wrong project");
    const [people, files] = await Promise.all([host.ui.listPolicyApprovers(project, ""), host.ui.browseProject(project, "")]);
    if (!closed) policyEditor = { policy, people: people.approvers, peopleCursor: people.next_cursor, files: files.nodes, fileCursor: files.next_cursor ?? "", dirty: false, uncertain: false };
  } catch {
    if (policyEditor) policyEditor.uncertain = true;
    notice = "Не удалось загрузить настройки. Проверьте соединение и право управления согласованиями. Для сохранения нужно успешно перечитать настройки; введённые изменения сохранены в форме.";
  }
  finally { busy = false; if (!closed) render(); }
}
function renderPolicyEditor(current: PolicyEditor) {
  root.append(element("h2", "Настройка согласований"));
  root.append(element("p", "Для каждого направления выберите документы и всех обязательных согласующих. Изменение настроек потребует нового согласования ранее отправленных версий."));
  current.policy.domains.forEach((domain, index) => {
    const group = element("fieldset"), legend = element("legend", `Направление ${index + 1}`); group.append(legend);
    const nameLabel = element("label", "Название направления"), name = element("input"); name.maxLength = 255; name.value = domain.domain_id; name.setAttribute("aria-label", `Название направления ${index + 1}`); name.disabled = busy || current.uncertain;
    name.addEventListener("input", () => { domain.domain_id = name.value; current.dirty = true; reportUnsavedChanges(); }); nameLabel.append(name); group.append(nameLabel);
    const choose = (title: string, options: { id: string; name: string }[], selected: string[]) => {
      group.append(element("h3", title));
      const all = new Map(options.map(option => [option.id, option.name]));
      for (const id of selected) if (!all.has(id)) all.set(id, `${id} (не загружен или недоступен)`);
      for (const [id, text] of all) {
        const label = element("label", text), input = element("input"); input.type = "checkbox"; input.checked = selected.includes(id); input.disabled = busy || current.uncertain;
        input.addEventListener("change", () => { const at = selected.indexOf(id); if (input.checked && at < 0) selected.push(id); else if (!input.checked && at >= 0) selected.splice(at, 1); current.dirty = true; reportUnsavedChanges(); });
        label.prepend(input); const row = element("div"); row.append(label); group.append(row);
      }
    };
    const allLabel = element("label", "Все документы проекта, включая новые"), all = element("input");
    all.type = "checkbox"; all.checked = !!domain.all_documents; all.disabled = busy || current.uncertain;
    all.addEventListener("change", () => {
      domain.all_documents = all.checked;
      if (all.checked) domain.node_ids = [];
      current.dirty = true; reportUnsavedChanges(); render();
    });
    allLabel.prepend(all); group.append(allLabel);
    if (!domain.all_documents) choose("Документы", current.files.filter(file => !file.is_dir).map(file => ({ id: file.node_id, name: file.name })), domain.node_ids);
    choose("Обязательные согласующие", current.people.map(person => ({ id: person.principal_id, name: person.display_name || person.principal_id })), domain.approver_ids);
    if (!current.uncertain) group.append(button("Удалить направление", () => { current.policy.domains.splice(index, 1); current.dirty = true; reportUnsavedChanges(); render(); }));
    root.append(group);
  });
  if (!current.uncertain) root.append(button("Добавить направление", () => { current.policy.domains.push({ domain_id: "", node_ids: [], approver_ids: [] }); current.dirty = true; reportUnsavedChanges(); render(); }), button("Сохранить настройки согласования", () => void savePolicy()));
  if (current.peopleCursor) root.append(button("Загрузить ещё людей", () => void morePolicyOptions("people")));
  if (current.fileCursor) root.append(button("Загрузить ещё документы", () => void morePolicyOptions("files")));
  root.append(button("Перечитать настройки", () => void openPolicy(current.policy.project_id)), button("Закрыть настройки", () => { if (current.dirty && !window.confirm("Закрыть настройки без сохранения?")) return; policyEditor = null; notice = ""; render(); }));
  if (notice || busy) { const status = element("p", busy ? "Загрузка…" : notice); status.setAttribute("role", "status"); root.append(status); }
}
async function morePolicyOptions(kind: "people" | "files") {
  if (busy || closed || !policyEditor) return;
  const current = policyEditor; busy = true; notice = ""; render();
  try {
    if (kind === "people") {
      const page = await host.ui.listPolicyApprovers(current.policy.project_id, current.peopleCursor);
      current.people = [...new Map([...current.people, ...page.approvers].map(person => [person.principal_id, person])).values()]; current.peopleCursor = page.next_cursor;
    } else {
      const page = await host.ui.browseProject(current.policy.project_id, current.fileCursor);
      current.files = [...new Map([...current.files, ...page.nodes].map(file => [file.node_id, file])).values()]; current.fileCursor = page.next_cursor ?? "";
    }
  } catch { current.uncertain = true; notice = "Не удалось обновить доступные варианты. Перечитайте настройки перед сохранением."; }
  finally { busy = false; if (!closed) render(); }
}
async function savePolicy() {
  if (busy || closed || !policyEditor || policyEditor.uncertain) return;
  const current = policyEditor, domains = current.policy.domains;
  if (!domains.length || domains.some(domain => !domain.domain_id.trim() || (!domain.all_documents && !domain.node_ids.length) || !domain.approver_ids.length) || new Set(domains.map(domain => domain.domain_id)).size !== domains.length) { notice = "Укажите уникальные названия направлений, документы и согласующих."; render(); return; }
  if (!window.confirm("Сохранить новый состав обязательных согласующих? Прежние предложения потребуется отправить на согласование заново.")) return;
  busy = true; notice = ""; render();
  try {
    const saved = await host.ui.setPublicationPolicy(current.policy.project_id, current.policy.revision, domains);
    if (!Number.isSafeInteger(saved.revision) || saved.revision !== current.policy.revision + 1) throw new Error("Unexpected revision");
    current.policy.revision = saved.revision; current.dirty = false; notice = "Настройки согласования сохранены.";
  } catch { current.uncertain = true; notice = "Сохранение не подтверждено: права или версия могли измениться. Перечитайте настройки перед повтором."; }
  finally { busy = false; if (!closed) render(); }
}

function renderManagedAgent() {
  root.append(element("h2", "Выдать агента AgenticOS"));
  if (managedRequest) {
    root.append(element("p", `Шаблон: ${managedRequest.template_id}`));
    if (managedRequest.result) {
      root.append(element("p", "Агент подготовлен. Права на документы назначаются отдельно."));
      root.append(button("Новая заявка", () => void managedAction("finish")));
    } else {
      root.append(element("p", "Заявка сохранена. При неизвестном результате повтор использует ту же заявку."));
      root.append(button("Выполнить / повторить выдачу", () => void managedAction("submit")));
    }
    return;
  }
  const label = element("label", "ID разрешённого шаблона AgenticOS");
  const input = element("input"); input.value = managedTemplate; input.maxLength = 255; input.disabled = busy;
  input.addEventListener("input", () => { managedTemplate = input.value; });
  label.append(input); root.append(label, button("Подготовить заявку", () => void managedAction("prepare")));
}
async function managedAction(action: "prepare" | "submit" | "finish") {
  if (busy || closed) return;
  busy = true; notice = ""; render();
  try {
    if (action === "prepare") managedRequest = await host.ui.prepareManagedAgent(managedTemplate);
    else if (action === "submit" && managedRequest) managedRequest = await host.ui.submitManagedAgent(managedRequest.request_id);
    else if (action === "finish" && managedRequest) {
      await host.ui.finishManagedAgentRequest(managedRequest.request_id); managedRequest = null;
    }
  } catch { notice = "Результат не подтверждён. Обновите список: сохранённая заявка останется доступна для повтора."; }
  finally { busy = false; if (!closed) render(); }
}

async function openTaskTracker(project="",node="",gapTask?:SignalGapTask) {
  trackerView=new TaskTrackerView(root,host.ui,projects,()=>{trackerView=null;render();},(project,node,version,side)=>host.downloadText(project,node,version,side),(project,text)=>host.uploadText(project,text),(project,node)=>{trackerView=null;openProject=project;void openEditor(project,node);},gapTask);
  const view=trackerView;
  if(project){await view.load(project);if(node&&trackerView===view)await view.open(node);}
  else view.render();
}

function renderAgentTask() {
  root.append(element("h2", "Задача агенту"));
  if (taskRequest) {
    if(taskRequest.voice)root.append(element("p", `Источник: аудиозапись ${taskRequest.voice.source_request_id}, версия ${taskRequest.voice.revision}. Подтверждение: ${taskRequest.voice.confirmation_id}.`));
    root.append(element("p", `Агент: ${taskRequest.binding_id}`), element("pre", taskRequest.message), element("h3", "Критерии приёмки"), element("p", taskRequest.criteria ?? "У прежней задачи критерии не сохранены."));
    if(taskRequest.tracker){const {project_id,node_id}=taskRequest.tracker;root.append(button("Открыть выбранный трекер",()=>void openTaskTracker(project_id,node_id)));}
    if (taskRequest.outcome?.state === "completed") {
      root.append(element("p", "Запуск завершён. Проверьте результат по критериям."), element("pre", taskRequest.outcome.result?.content ?? ""));
      if (taskRequest.legacy_review) root.append(element("p", "Прежнее личное решение (не общая приёмка): " + taskRequest.legacy_review.decision), element("p", taskRequest.legacy_review.comment));
      if (taskRequest.review) root.append(element("p", `${taskRequest.review.decision === "accepted" ? "Принято" : "Требуется доработка"} · ${taskRequest.review.reviewer_id} · ${taskRequest.review.reviewed_at}`), element("p", taskRequest.review.comment));
      const comment = element("textarea"); comment.setAttribute("aria-label", "Комментарий приёмки"); comment.value = taskReviewComment; comment.disabled = busy; comment.maxLength = 3000; comment.addEventListener("input", () => {taskReviewComment = comment.value;});
      root.append(comment, button("Принять результат", () => void reviewAgentTask("accepted")), button("Вернуть на доработку", () => void reviewAgentTask("changes_requested")));
      if (taskRequest.review || !taskRequest.criteria) root.append(button("Новая задача", () => void taskAction("finish")));
    } else if (taskRequest.outcome?.state === "budget_blocked") {
      root.append(element("p", "Запуск остановлен лимитом бюджета или токенов. Эта заявка больше не выполняется. Сохранённые изменения остаются в документах."));
      root.append(element("p", "Для продолжения перенесите остановленную заявку в историю и создайте новую задачу. Проверьте оставшуюся работу и её статус в выбранном трекере."));
    } else {
      root.append(element("p", taskRequest.submitted ? "Исход задачи не подтверждён. Проверьте состояние перед повтором." : "Задача сохранена и ещё не отправлена."));
      if (taskRequest.criteria && !taskRequest.cancel_requested && !taskRequest.cancelled && (taskRequest.team_budget || taskRequest.submitted)) root.append(button(taskRequest.submitted ? "Повторить ту же заявку" : "Запустить задачу", () => void taskAction("submit")));
      else if (!taskRequest.criteria && !taskRequest.submitted) {
        const criteria = element("textarea"); criteria.setAttribute("aria-label", "Критерии прежней задачи"); criteria.value = taskCriteria; criteria.disabled = busy; criteria.maxLength = 3000; criteria.addEventListener("input", () => {taskCriteria = criteria.value;});
        root.append(element("label", "Добавьте критерии перед первым запуском"), criteria, button("Сохранить критерии задачи", () => void taskAction("prepare")));
      } else if (!taskRequest.criteria) root.append(element("p", "Прежняя задача уже отправлена без критериев. Проверьте её состояние; сохранённое тело запуска защищено от изменений."));
    }
    if (!taskRequest.submitted && !taskRequest.team_budget && taskRequest.criteria) {
      const pending=taskRequest.budget_request;
      const project=element("select");project.setAttribute("aria-label","Проект бюджета задачи");project.append(new Option("Выберите проект", ""));for(const item of projects)project.append(new Option(item.name,item.id));
      if(pending && !projects.some(p=>p.id===pending.project_id))project.append(new Option("Сохранённый проект",pending.project_id));
      project.value=pending?.project_id??taskBudgetProject;project.disabled=busy||!!pending;project.onchange=()=>{taskBudgetProject=project.value;};root.append(element("label","Проект бюджета задачи"),project);
      for(const [label,value,change] of [
        ["Оценка задачи, USD",pending?formatBudgetUSD(pending.input.estimate_usd_micros):taskBudgetEstimate,(v:string)=>{taskBudgetEstimate=v;}],
        ["Предел задачи, USD",pending?formatBudgetUSD(pending.input.limit_usd_micros):taskBudgetLimit,(v:string)=>{taskBudgetLimit=v;}]
      ] as const) {const field=element("input");field.setAttribute("aria-label",label);field.value=value;field.disabled=busy||!!pending;field.oninput=()=>change(field.value);root.append(element("label",label),field);}
      if(pending)root.append(button("Отложить бюджетный черновик",()=>void taskAction("defer")),element("p","Черновик останется в истории. Это не отменяет заявку, которую сервер мог уже сохранить."));
      root.append(button(pending?"Повторить сохранение бюджета задачи":"Сохранить бюджет задачи",()=>void budgetTask()));
    }
    if(taskRequest.team_budget) {
      const budgetStopped=taskRequest.outcome?.state==="budget_blocked";
      root.append(button(budgetStopped?"Перенести остановленную задачу в историю":taskRequest.cancel_requested?"Повторить отмену задачи":"Отменить задачу",()=>void taskAction("cancel")));
      if(!budgetStopped) root.append(element("p","Отмена останавливает дальнейшие вызовы и переносит задачу в историю. Уже начатый вызов может завершиться."));
    }
    if(taskRequest.team_budget) root.append(element("p",`Бюджетная заявка: ${taskRequest.team_budget.proposal_id}. Запуск требует действующего согласования.`),button("Открыть бюджет задачи",()=>void openTaskBudget()));
    if (!taskRequest.submitted && !taskRequest.team_budget && !taskRequest.budget_request) root.append(button("Удалить неотправленную задачу", () => void taskAction("discard")));
    if (taskRequest.submitted || taskRequest.team_budget) root.append(button("Проверить состояние задачи", () => void taskAction("refresh")));
    return;
  }
  const bindingLabel = element("label", "Подключение агента");
  const binding = element("select"); binding.disabled = busy;
  binding.append(new Option("Выберите агента", ""));
  for (const row of rows.filter(row => !row.revoked && row.managed_runtime === true)) binding.append(new Option(row.agent_principal_id, row.binding_id));
  binding.value = taskBinding; binding.addEventListener("change", () => { taskBinding = binding.value; });
  bindingLabel.append(binding);
  const messageLabel = element("label", "Текст задачи"); const message = element("textarea");
  message.value = taskMessage; message.disabled = busy; message.maxLength = 12000;
  message.addEventListener("input", () => { taskMessage = message.value; }); messageLabel.append(message);
  const criteriaLabel = element("label", "Критерии приёмки"); const criteria = element("textarea"); criteria.setAttribute("aria-label", "Критерии приёмки задачи"); criteria.value = taskCriteria; criteria.disabled = busy; criteria.maxLength = 3000; criteria.addEventListener("input", () => {taskCriteria = criteria.value;}); criteriaLabel.append(criteria);
  const trackerProject=element("select");trackerProject.setAttribute("aria-label","Проект трекера задачи");trackerProject.disabled=busy;trackerProject.append(new Option("Без трекера",""));for(const p of projects)trackerProject.append(new Option(p.name||p.slug,p.id));trackerProject.value=taskTrackerProject;trackerProject.onchange=()=>void loadTaskTrackers(trackerProject.value);
  root.append(element("label","Рабочий трекер (необязательно)"),trackerProject);
  if(taskTrackerProject){const selected=element("select");selected.setAttribute("aria-label","Трекер задачи агента");selected.disabled=busy;selected.append(new Option("Выберите трекер",""));for(const doc of taskTrackers?.documents??[])if(doc.content_type==="application/vnd.mnemos.task-tracker+json"&&!doc.conflicted)selected.append(new Option(doc.name,doc.node_id));selected.value=taskTrackerNode;selected.onchange=()=>{taskTrackerNode=selected.value;};root.append(selected);if(taskTrackers?.next_cursor)root.append(button("Следующая страница трекеров",()=>void loadTaskTrackers(taskTrackerProject,taskTrackers!.next_cursor)));}
  root.append(bindingLabel, messageLabel, criteriaLabel, button("Сохранить задачу", () => void taskAction("prepare")));
}
async function loadTaskTrackers(project:string,cursor=""){
 if(busy||closed)return;taskTrackerProject=project;taskTrackerNode="";taskTrackers=undefined;busy=true;notice="";render();
 try{if(project)taskTrackers=await host.ui.listPrivateDocuments(project,cursor);}catch{notice="Не удалось прочитать доступные трекеры.";}finally{busy=false;if(!closed)render();}
}
async function budgetTask() {
 if(busy||closed||!taskRequest)return;busy=true;notice="";render();
 try {const p=taskRequest.budget_request;taskRequest=await host.ui.budgetSavedAgentTask(taskRequest.request_id,p?.project_id??taskBudgetProject,p?.input.estimate_usd_micros??parseBudgetUSD(taskBudgetEstimate),p?.input.limit_usd_micros??parseBudgetUSD(taskBudgetLimit));notice="Бюджетная заявка сохранена. Проверьте согласование перед запуском.";}
 catch {taskRequest=await host.ui.managedTaskRequest();notice="Сохранение бюджета не подтверждено. Повтор использует те же условия; проверьте проект, права и политику бюджета.";}
 finally {busy=false;if(!closed)render();}
}
async function openTaskBudget() {
 if(busy||closed||!taskRequest?.team_budget)return;
 teamBudgetView=new TeamBudgetView(root,host.ui,taskRequest.team_budget.project_id,(review)=>{teamBudgetView=null;if(review)taskRequest=review;render();});await teamBudgetView.load();
}
async function taskAction(action: "prepare" | "submit" | "refresh" | "finish" | "discard" | "cancel" | "defer") {
  if (busy || closed) return;
  busy = true; notice = ""; render();
  try {
    if (action === "prepare") {
      if(taskTrackerProject&&!taskRequest){if(!taskTrackerNode)throw Error("Select tracker");taskRequest=await host.ui.prepareTrackedAgentTask(taskBinding,taskMessage,taskCriteria,taskTrackerProject,taskTrackerNode);taskBudgetProject=taskTrackerProject;}
      else taskRequest = await host.ui.prepareAgentTask(taskRequest?.binding_id ?? taskBinding, taskRequest?.message ?? taskMessage, taskCriteria);
    }
    else if (action === "discard" && taskRequest) {await host.ui.discardUnsentAgentTask(taskRequest.request_id); taskRequest = null; taskMessage = ""; taskCriteria = "";}
    else if (action === "defer" && taskRequest) {await host.ui.deferBudgetDraft(taskRequest.request_id);taskRequest=null;notice="Черновик отложен в историю. Его можно восстановить с прежними условиями.";}
    else if (action === "cancel" && taskRequest) {await host.ui.cancelSavedTeamTask(taskRequest.request_id);taskRequest=null;notice="Дальнейшие вызовы отменены. Задача сохранена в истории.";}
    else if (action === "submit" && taskRequest) taskRequest = await host.ui.submitSavedAgentTask(taskRequest.request_id);
    else if (action === "refresh" && taskRequest) taskRequest = await host.ui.refreshSavedAgentTask(taskRequest.request_id);
    else if (action === "finish" && taskRequest) { await host.ui.finishSavedAgentTask(taskRequest.request_id); taskRequest = null; taskMessage = ""; taskCriteria = ""; }
  } catch { try {taskRequest=await host.ui.managedTaskRequest();} catch {if(taskRequest)delete taskRequest.outcome;} notice = "Результат не подтверждён. Обновите список, чтобы восстановить сохранённую заявку и проверить состояние."; }
  finally { busy = false; if (!closed) render(); }
}


type MemoryEditor = {
  selection: Awaited<ReturnType<MnemosAccountSession["readPersonalMemory"]>>;
  name: string;
  project: string;
  page: Awaited<ReturnType<MnemosAccountSession["listPrivateDocuments"]>> | null;
};
async function openMemoryEditor() {
  if (busy) return;
  busy = true; notice = ""; render();
  try {
    const selection = await host.ui.readPersonalMemory();
    let name = "Память отключена";
    if (selection.node_id) {
      try { const doc = await host.ui.readDraftDocument(selection.project_id, selection.node_id); name = doc.terms[0]?.metadata?.name || "Выбранный документ"; }
      catch { name = "Выбранный документ сейчас недоступен"; }
    }
    if (!closed) memoryEditor = {selection, name, project: "", page: null};
  } catch { notice = "Не удалось прочитать выбор памяти. Повторите позже."; }
  finally { busy = false; if (!closed) render(); }
}
async function listMemoryDocuments(project: string, cursor = "") {
  if (busy || !memoryEditor) return;
  busy = true; notice = ""; render();
  try {
    const page = await host.ui.listPrivateDocuments(project, cursor);
    if (!closed && memoryEditor) { memoryEditor.project = project; memoryEditor.page = page; }
  } catch { notice = "Список изменился или недоступен. Откройте документы проекта заново."; }
  finally { busy = false; if (!closed) render(); }
}
async function chooseMemory(node: string, name: string) {
  const state = memoryEditor;
  if (busy || !state) return;
  busy = true; notice = ""; render();
  try {
    const selection = await host.ui.setPersonalMemory(state.selection.revision, node ? state.project : "", node, node ? state.page?.head || "" : "");
    if (!closed && memoryEditor === state) { state.selection = selection; state.name = name; notice = node ? "Память выбрана. Подключения агента прочитают её при следующем запросе контекста." : "Память отключена для следующих запросов контекста."; }
  } catch { notice = "Выбор не подтверждён: обновите настройку и список перед повтором."; }
  finally { busy = false; if (!closed) render(); }
}
function renderMemoryEditor() {
  const state = memoryEditor!;
  root.append(element("h2", "Личная память агента"));
  root.append(element("p", "Выберите свой документ с предпочтениями, правилами и рабочими наработками. Его содержимое можно редактировать в приложении Документы. Выбор общий для ваших подключений; права каждого агента проверяются отдельно."));
  root.append(element("p", state.name));
  root.append(button("Обновить настройку", () => void openMemoryEditor()));
  if (state.selection.node_id) root.append(button("Отключить память", () => void chooseMemory("", "Память отключена")));
  for (const project of projects) root.append(button("Документы: " + project.name, () => void listMemoryDocuments(project.id)));
  if (state.page) {
    const documents = state.page.documents.filter(d => !d.conflicted && d.content_type === "application/vnd.cloudflareos.document+json");
    for (const doc of documents) root.append(button("Использовать: " + doc.name, () => void chooseMemory(doc.node_id, doc.name)));
    if (!documents.length) root.append(element("p", "На этой странице нет подходящих личных документов. Создайте документ с инструкциями в приложении Документы и сохраните его в Mnemos."));
    if (state.page.next_cursor) root.append(button("Следующая страница", () => void listMemoryDocuments(state.project, state.page!.next_cursor)));
  }
  if (notice) root.append(element("p", notice));
  root.append(button("Закрыть память", () => { memoryEditor = null; notice = ""; render(); }));
}


type EngagementRule = Awaited<ReturnType<MnemosAccountSession["listEngagementRules"]>>["rules"][number];
type EngagementEditor = {binding: string; name: string; page: Awaited<ReturnType<MnemosAccountSession["listEngagementRules"]>>; requester: string; project: string; purpose: EngagementRule["purpose"]};
const engagementPurposes = {observe: "Наблюдение", review_spec: "Проверка ТЗ", collaborate: "Совместное исполнение"};
async function openEngagementEditor(binding: string, name: string, cursor = "") {
  if (busy) return;
  busy = true; notice = ""; render();
  try {
    const page = await host.ui.listEngagementRules(binding, cursor);
    if (!closed) engagementEditor = {binding, name, page, requester: "", project: "", purpose: "review_spec"};
  } catch { notice = "Правила недоступны. Управлять ими может владелец агента."; }
  finally { busy = false; if (!closed) render(); }
}
async function saveEngagementRule(rule: Omit<EngagementRule, "rule_id">) {
  const state = engagementEditor;
  if (busy || !state) return;
  busy = true; notice = ""; render();
  try {
    const saved = await host.ui.setEngagementRule(state.binding, rule);
    if (!closed && engagementEditor === state) {
      const at = state.page.rules.findIndex(item => item.rule_id === saved.rule_id);
      if (at < 0) state.page.rules.push(saved); else state.page.rules[at] = saved;
      notice = saved.enabled ? "Привлечение разрешено для выбранной цели и проекта." : "Разрешение отозвано.";
    }
  } catch { notice = "Изменение не подтверждено. Обновите правила перед повтором; проверьте выбранного участника и права на проект."; }
  finally { busy = false; if (!closed) render(); }
}
function renderEngagementEditor() {
  const state = engagementEditor!;
  root.append(element("h2", "Разрешения на привлечение"), element("p", state.name));
  root.append(element("p", "Выберите, кто может приглашать вашего агента, в каком проекте и для какой работы. Разрешение пользователю не включает его агентов. Права на документы, действия и результат проверяются отдельно."));
  const requester = element("input"); requester.setAttribute("aria-label", "Пользователь или агент: идентификатор"); requester.placeholder = "Идентификатор пользователя или агента"; requester.maxLength = 255; requester.value = state.requester; requester.disabled = busy; requester.addEventListener("input", () => { state.requester = requester.value; });
  const project = element("select"); project.setAttribute("aria-label", "Проект привлечения"); project.append(new Option("Выберите проект", "")); for (const item of projects) project.append(new Option(item.name, item.id)); project.value = state.project; project.disabled = busy; project.addEventListener("change", () => { state.project = project.value; });
  const purpose = element("select"); purpose.setAttribute("aria-label", "Цель привлечения"); for (const [key, label] of Object.entries(engagementPurposes)) purpose.append(new Option(label, key)); purpose.value = state.purpose; purpose.disabled = busy; purpose.addEventListener("change", () => { state.purpose = purpose.value as EngagementRule["purpose"]; });
  root.append(requester, project, purpose, button("Разрешить привлечение", () => {
    if (!state.requester.trim() || !state.project) { notice = "Укажите участника и проект."; render(); return; }
    const current = state.page.rules.find(item => item.requester_id === state.requester.trim() && item.project_id === state.project && item.purpose === state.purpose);
    void saveEngagementRule({requester_id: state.requester.trim(), project_id: state.project, purpose: state.purpose, revision: current?.revision ?? 0, enabled: true});
  }));
  for (const rule of state.page.rules) {
    const item = element("section"); item.append(element("p", `${rule.requester_id} · ${projects.find(p => p.id === rule.project_id)?.name ?? "Проект недоступен"} · ${engagementPurposes[rule.purpose]} · ${rule.enabled ? "Разрешено" : "Отозвано"}`));
    item.append(button(rule.enabled ? "Отозвать разрешение" : "Разрешить снова", () => void saveEngagementRule({...rule, enabled: !rule.enabled}))); root.append(item);
  }
  if (!state.page.rules.length) root.append(element("p", "Другим участникам привлечение не разрешено."));
  if (notice) root.append(element("p", notice));
  root.append(button("Обновить правила", () => void openEngagementEditor(state.binding, state.name)));
  if (state.page.next_cursor) root.append(button("Следующие правила", () => void openEngagementEditor(state.binding, state.name, state.page.next_cursor)));
  root.append(button("Закрыть разрешения", () => { engagementEditor = null; notice = ""; render(); }));
}

type CollaborationCreate = Parameters<MnemosAccountSession["createCollaboration"]>[0];
type CollaborationRequest = Awaited<ReturnType<MnemosAccountSession["readCollaboration"]>>;
type CollaborationProgress = Awaited<ReturnType<MnemosAccountSession["readCollaborationProgress"]>>;
type CollaborationReviewCreate = Parameters<MnemosAccountSession["reviewCollaborationResult"]>[1];
const collaborationStates: Record<CollaborationProgress["state"], string> = {awaiting_result: "Ожидается результат", awaiting_review: "Ожидается приёмка", accepted: "Принято", changes_requested: "Требуется доработка"};
type CollaborationView = {
 progress?: CollaborationProgress;
 states?: Record<string, CollaborationProgress | null>;
 reviewComment?: string;
 pendingReview?: CollaborationReviewCreate;
 page: Awaited<ReturnType<MnemosAccountSession["listCollaborations"]>>;
 detail?: CollaborationRequest;
 messages: Awaited<ReturnType<MnemosAccountSession["listCollaborationMessages"]>>;
 draft?: CollaborationCreate;
 pendingCreate?: CollaborationCreate;
 text: string;
 kind: "comment" | "result";
 pendingMessage?: {message_id: string; kind: "comment" | "result"; body: string};
};
async function openCollaborations(cursor = "") {
 if (busy || closed) return;
 busy = true; notice = ""; render();
 try {
  const page = await host.ui.listCollaborations(cursor);
  const states = Object.fromEntries(await Promise.all(page.requests.map(async request => [request.request_id, await host.ui.readCollaborationProgress(request.request_id).catch(() => null)] as const)));
  if (!closed) collaborationView = {page, states, messages: {messages: []}, text: "", kind: "comment"};
 } catch { if (collaborationView) { collaborationView.detail = undefined; collaborationView.messages = {messages: []}; collaborationView.page = {requests: []}; } notice = "Обращения недоступны. Проверьте текущие права."; }
 finally {busy = false; if (!closed) render();}
}
async function openCollaboration(id: string, messageCursor = 0) {
 if (busy || closed) return;
 const state = collaborationView!; busy = true; notice = ""; render();
 try {
  const detail = await host.ui.readCollaboration(id);
  const messages = await host.ui.listCollaborationMessages(id, messageCursor);
  const progress = await host.ui.readCollaborationProgress(id);
  if (!closed && collaborationView === state) {state.detail = detail; state.messages = messages; state.progress = progress; state.draft = undefined;}
 } catch {state.detail = undefined; state.progress = undefined; state.messages = {messages: []}; notice = "Обращение недоступно. Проверьте текущие права и разрешение владельца агента.";}
 finally {busy = false; if (!closed) render();}
}
async function submitCollaboration() {
 const state = collaborationView!;
 if (busy || closed || !state.draft) return;
 const draft = state.draft;
 if (!state.pendingCreate && (!draft.project_id || !draft.node_id || !/^[a-f0-9]{64}$/.test(draft.source_head) || (!!draft.target_user_id === !!draft.target_binding_id) || !draft.title.trim() || !draft.description.trim() || !draft.criteria.trim())) {
  notice = "Укажите проект, документ и версию, одного получателя, заголовок, описание и критерии."; render(); return;
 }
 state.pendingCreate ??= {...state.draft};
 busy = true; notice = ""; render();
 try {
  const detail = await host.ui.createCollaboration(state.pendingCreate);
  if (!closed && collaborationView === state) {state.detail = detail; state.draft = undefined; state.pendingCreate = undefined; state.messages = {messages: []}; notice = "Обращение отправлено.";}
 } catch {notice = "Отправка не подтверждена. Повторите ту же заявку: дубль не создаётся. У обоих участников должны быть права на источник; для агента нужно разрешение владельца.";}
 finally {busy = false; if (!closed) render();}
}
async function sendCollaborationMessage() {
 const state = collaborationView!;
 if (busy || closed || !state.detail || (!state.text.trim() && !state.pendingMessage)) return;
 state.pendingMessage ??= {message_id: crypto.randomUUID(), kind: state.kind, body: state.text};
 busy = true; notice = ""; render();
 try {
  await host.ui.appendCollaborationMessage(state.detail.request_id, state.pendingMessage);
  if (!closed && collaborationView === state) {state.pendingMessage = undefined; state.text = ""; notice = "Сообщение отправлено. Обновите обсуждение.";}
 } catch {notice = "Отправка не подтверждена. Повтор использует прежний идентификатор; проверьте права участников.";}
 finally {busy = false; if (!closed) render();}
}
function renderCollaborations() {
 const state = collaborationView!;
 root.append(element("h2", "Обращения и обсуждения"));
 if (notice) root.append(element("p", notice));
 if (state.draft) {
  const draft = state.draft;
  root.append(element("p", "Укажите источник, получателя и критерии. Доступ к документу и разрешение владельца агента должны быть предоставлены заранее."));
  const field = (label: string, key: "node_id" | "source_head" | "target_user_id" | "target_binding_id" | "title" | "description" | "criteria", multiline = false) => {
   const input = multiline ? element("textarea") : element("input"); input.setAttribute("aria-label", label); input.value = draft[key]; input.disabled = busy || !!state.pendingCreate; input.addEventListener("input", () => {draft[key] = input.value;}); root.append(element("label", label), input);
  };
  const project = element("select"); project.setAttribute("aria-label", "Проект обращения"); project.append(new Option("Выберите проект", ""));
  for (const item of projects) project.append(new Option(item.name, item.id));
  project.value = draft.project_id; project.disabled = busy || !!state.pendingCreate; project.addEventListener("change", () => {draft.project_id = project.value;}); root.append(project);
  field("Документ: идентификатор", "node_id"); field("Версия источника", "source_head");
  root.append(button("Взять текущую версию документа", () => {void (async () => {
   if (busy || state.pendingCreate) return; busy = true; render();
   try {const doc = await host.ui.readDraftDocument(draft.project_id, draft.node_id); if (!closed && collaborationView === state && doc.exists && !doc.conflicted) draft.source_head = doc.head;}
   catch {notice = "Документ недоступен в вашей рабочей ветке.";} finally {busy = false; if (!closed) render();}
  })();}));
  field("Получатель: пользователь", "target_user_id"); field("Получатель: подключение агента", "target_binding_id");
  root.append(element("p", "Заполните только одного получателя."));
  const purpose = element("select"); purpose.setAttribute("aria-label", "Цель обращения"); for (const [key, label] of Object.entries(engagementPurposes)) purpose.append(new Option(label, key)); purpose.value = draft.purpose; purpose.disabled = busy || !!state.pendingCreate; purpose.addEventListener("change", () => {draft.purpose = purpose.value as CollaborationCreate["purpose"];});
  const role = element("select"); role.setAttribute("aria-label", "Роль получателя"); role.append(new Option("Наблюдатель", "observer"), new Option("Соисполнитель", "coexecutor")); role.value = draft.role; role.disabled = busy || !!state.pendingCreate; role.addEventListener("change", () => {draft.role = role.value as CollaborationCreate["role"];}); root.append(purpose, role);
  field("Заголовок обращения", "title"); field("Описание работы", "description", true); field("Критерии результата", "criteria", true);
  root.append(button(state.pendingCreate ? "Повторить отправку обращения" : "Отправить обращение", () => void submitCollaboration()));
 } else if (state.detail) {
  const detail = state.detail;
  if (detail.role === "coexecutor") root.append(button("Задача замещения", () => {
    absenceTaskView = new AbsenceTaskView(root, host.ui, detail, identity?.subject.user_id ?? "", () => {absenceTaskView = null; render();});
    void absenceTaskView.load();
  }));
  if (state.progress) {
    root.append(element("h3", collaborationStates[state.progress.state]));
    const review = state.progress.review;
    if (review) root.append(element("p", `${review.agent_id || review.user_id} · ${review.created_at}`), element("p", review.comment));
    if (state.progress.result_sequence && detail.requester_user_id === identity?.subject.user_id) {
      const comment = element("textarea"); comment.setAttribute("aria-label", "Обоснование приёмки обращения"); comment.value = state.reviewComment ?? ""; comment.disabled = busy || !!state.pendingReview; comment.addEventListener("input", () => {state.reviewComment = comment.value;});
      root.append(comment);
      if (state.pendingReview) root.append(button("Повторить решение по обращению", () => void submitCollaborationReview(state.pendingReview!.decision)));
      else root.append(button("Принять результат обращения", () => void submitCollaborationReview("accepted")), button("Запросить доработку обращения", () => void submitCollaborationReview("changes_requested")));
    }
  }
  root.append(element("h3", detail.title), element("p", detail.description), element("h4", "Критерии результата"), element("p", detail.criteria));
  root.append(element("p", `Отправитель: ${detail.requester_agent_id || detail.requester_user_id} · владелец ${detail.requester_user_id}`), element("p", `Получатель: ${detail.target_agent_id || detail.target_user_id} · владелец ${detail.target_user_id} · ${detail.role === "observer" ? "Наблюдатель" : "Соисполнитель"}`));
  root.append(element("p", `Источник: ${detail.node_id} · версия ${detail.source_head}`));
  for (const message of state.messages.messages) root.append(element("p", `${message.kind === "result" ? "Результат проверки" : "Комментарий"} · ${message.agent_id || message.user_id} · ${message.created_at}`), element("p", message.body));
  if (!state.messages.messages.length) root.append(element("p", "На этой странице сообщений нет."));
  const kind = element("select"); kind.setAttribute("aria-label", "Тип сообщения"); kind.append(new Option("Комментарий", "comment"), new Option("Результат проверки", "result")); kind.value = state.kind; kind.disabled = busy || !!state.pendingMessage; kind.addEventListener("change", () => {state.kind = kind.value as "comment" | "result";});
  const text = element("textarea"); text.setAttribute("aria-label", "Сообщение участникам"); text.value = state.text; text.disabled = busy || !!state.pendingMessage; text.addEventListener("input", () => {state.text = text.value;}); root.append(kind, text, button(state.pendingMessage ? "Повторить отправку сообщения" : "Отправить сообщение", () => void sendCollaborationMessage()));
  root.append(button("Обновить обсуждение", () => void openCollaboration(detail.request_id)));
  if (state.messages.next_cursor) root.append(button("Следующие сообщения", () => void openCollaboration(detail.request_id, state.messages.next_cursor)));
 } else {
  for (const request of state.page.requests) {const progress = state.states?.[request.request_id]; root.append(button(request.title, () => void openCollaboration(request.request_id)), element("p", progress ? collaborationStates[progress.state] : "Состояние недоступно"));}
  if (!state.page.requests.length) root.append(element("p", "На этой странице доступных обращений нет."));
  if (state.page.next_cursor) root.append(button("Следующие обращения", () => void openCollaborations(state.page.next_cursor)));
  root.append(button("Новое обращение", () => {state.draft = {request_id: crypto.randomUUID(), project_id: "", node_id: "", source_head: "", target_user_id: "", target_binding_id: "", purpose: "review_spec", role: "coexecutor", title: "", description: "", criteria: ""}; notice = ""; render();}));
 }
 if (!state.pendingCreate && !state.pendingMessage) root.append(button("Список обращений", () => void openCollaborations()), button("Закрыть обращения", () => {collaborationView = null; notice = ""; render();}));
}

async function reviewAgentTask(decision: "accepted" | "changes_requested") {
 if (busy || closed || !taskRequest || taskRequest.outcome?.state !== "completed") return;
 const request = taskRequest; busy = true; notice = ""; render();
 try {taskRequest = await host.ui.reviewSavedAgentTask(request.request_id, request.review?.revision ?? 0, request.outcome?.result?.content ?? "", decision, taskReviewComment); taskReviewComment = "";}
 catch {delete request.outcome; delete request.review; notice = "Решение не подтверждено. Обновите состояние задачи перед повтором.";}
 finally {busy = false; if (!closed) render();}
}

async function submitCollaborationReview(decision: "accepted" | "changes_requested") {
 const state = collaborationView;
 if (busy || closed || !state?.detail || !state.progress) return;
 if (!state.pendingReview && !state.reviewComment?.trim()) {notice = "Укажите обоснование решения по критериям."; render(); return;}
 state.pendingReview ??= {review_id: crypto.randomUUID(), expected_revision: state.progress.review_revision, result_sequence: state.progress.result_sequence, decision, comment: state.reviewComment!};
 busy = true; notice = ""; render();
 try {
  await host.ui.reviewCollaborationResult(state.detail.request_id, state.pendingReview);
  state.pendingReview = undefined; state.reviewComment = "";
  const progress = await host.ui.readCollaborationProgress(state.detail.request_id);
  if (!closed && collaborationView === state) {state.progress = progress; notice = "Решение сохранено.";}
 } catch {notice = "Решение не подтверждено. Проверьте состояние обращения; повтор сохраняет исходные результат и ревизию.";}
 finally {busy = false; if (!closed) render();}
}

async function openTaskHistory(cursor = "") {
 if (busy || closed) return; busy = true; notice = ""; render();
 try {const page = await host.ui.finishedAgentTasks(cursor); if (!closed) taskHistory = {page};}
 catch {taskHistory = null; notice = "История задач недоступна.";}
 finally {busy = false; if (!closed) render();}
}
async function openFinishedTask(id: string) {
 if (busy || closed || !taskHistory) return; busy = true; notice = ""; taskHistory.selected = undefined; render();
 try {const selected = await host.ui.readFinishedAgentTask(id); if (!closed && taskHistory) taskHistory.selected = selected;}
 catch {notice = "Результат недоступен. Проверьте текущий доступ к агенту.";}
 finally {busy = false; if (!closed) render();}
}
function renderTaskHistory() {
 const state = taskHistory!; root.append(element("h2", "История задач агента"));
 if (notice) root.append(element("p", notice));
 if (state.selected) {
  const task = state.selected; root.append(element("p", `Агент: ${task.binding_id}`), element("pre", task.message), element("h3", "Критерии приёмки"), element("p", task.criteria ?? "У прежней задачи критерии не сохранены."));
  if (task.team_budget) root.append(element("p", `Заявка команды: ${task.team_budget.proposal_id}. Роль: ${task.team_budget.role}. Доработка требует новой согласованной заявки команды.`));
  if (task.cancelled) root.append(element("p","Дальнейшие вызовы отменены. Уже начатый вызов мог завершиться; результат проверяется отдельно."));
  if (task.parent_request_id) root.append(element("p", `Доработка задачи: ${task.parent_request_id}`));
  if(task.deferred) {
    root.append(element("p",task.resumed?"Этот черновик уже возвращён в работу.":"Отложенный бюджетный черновик. Сохранение заявки на сервере не подтверждено; отмена не выполнялась."));
    if(!task.resumed)root.append(button("Вернуть бюджетный черновик",()=>{void(async()=>{
      if(busy||closed)return;busy=true;render();
      try {taskRequest=await host.ui.resumeBudgetDraft(task.request_id);taskHistory=null;notice="Черновик восстановлен. Повтор сохранения использует прежние условия.";}
      catch {notice="Не удалось восстановить черновик. Завершите текущую задачу и проверьте доступ к проекту.";}
      finally {busy=false;if(!closed)render();}
    })();}));
  }
  if (task.outcome?.state === "completed") root.append(element("pre", task.outcome.result?.content ?? ""));
  else if(!task.deferred) root.append(element("p", task.outcome?.state === "budget_blocked" ? "Остановлено бюджетом. Согласуйте новую заявку с достаточным лимитом; прежняя задача автоматически не повторяется." : "Результат пока не подтверждён."));
  if (task.team_budget) root.append(button("Открыть общую приёмку",()=>{void(async()=>{
    if(busy||closed)return;busy=true;render();
    try {taskRequest=await host.ui.prepareTeamBudgetReview(task.team_budget!.project_id,task.team_budget!.proposal_id,task.binding_id);taskHistory=null;}
    catch {notice="Не удалось открыть приёмку. Завершите текущую задачу и проверьте доступ.";}
    busy=false;if(!closed)render();
  })();}));
  if (task.legacy_review) root.append(element("p", "Прежнее личное решение (не общая приёмка): " + task.legacy_review.decision), element("p", task.legacy_review.comment));
  if (task.review) root.append(element("p", `${task.review.decision === "accepted" ? "Принято" : "Требуется доработка"} · ${task.review.reviewer_id}`), element("p", task.review.comment));
  if(task.review?.decision === "changes_requested" && task.team_budget) root.append(button("Подготовить бюджет доработки",()=>{void(async()=>{
   if(busy||closed)return;busy=true;notice="";render();
   try {const draft=await host.ui.prepareTeamBudgetRework(task.request_id);if(closed)return;taskHistory=null;budgetEditor=null;teamBudgetView=new TeamBudgetView(root,host.ui,draft.project_id,(review)=>{teamBudgetView=null;if(review)taskRequest=review;render();});await teamBudgetView.load();teamBudgetView.prepareRework(draft.proposal);}
   catch {notice="Не удалось подготовить бюджет доработки. Проверьте результат, замечания и доступ к заявке.";}
   finally {busy=false;if(!closed)render();}
  })();}));
  if (task.review?.decision === "changes_requested" && !task.team_budget) root.append(button("Подготовить задачу на доработку", () => {void (async () => {
   if (busy || closed) return; busy = true; render();
   try {taskRequest = await host.ui.prepareAgentRework(task.request_id); taskHistory = null; notice = "Задача на доработку сохранена. Запустите её после проверки.";}
   catch {notice = "Не удалось подготовить доработку. Проверьте доступ и наличие другой текущей задачи.";}
   finally {busy = false; if (!closed) render();}
  })();}));
 } else {
  for (const task of state.page.requests) root.append(button(task.message.slice(0,160), () => void openFinishedTask(task.request_id)));
  if (!state.page.requests.length) root.append(element("p", "Завершённых задач пока нет."));
  if (state.page.next_cursor) root.append(button("Следующие завершённые задачи", () => void openTaskHistory(state.page.next_cursor)));
 }
 root.append(button("Обновить историю задач", () => void openTaskHistory()), button("Закрыть историю задач", () => {taskHistory = null; notice = ""; render();}));
}

type BudgetEditor = {catalog: Awaited<ReturnType<MnemosAccountSession["listBudgetProjects"]>>; project: string; policy?: Awaited<ReturnType<MnemosAccountSession["readProjectBudget"]>>; owner: string; limit: string; automatic: string; team: string};
async function loadProjectBudget() {
 const state = budgetEditor; if (busy || closed || !state?.project) return; busy = true; state.policy = undefined; notice = ""; render();
 try {const policy = await host.ui.readProjectBudget(state.project); if (!closed && budgetEditor === state) {state.policy = policy; state.owner = policy.owner_id; state.limit = formatBudgetUSD(policy.limit_usd_micros); state.automatic = formatBudgetUSD(policy.automatic_usd_micros); state.team = String(policy.automatic_team_size || 1);}}
 catch {notice = "Политика бюджета недоступна.";}
 finally {busy = false; if (!closed) render();}
}
async function saveProjectBudget() {
 const state = budgetEditor; if (busy || closed || !state?.policy) return; busy = true; notice = ""; render();
 try {
  const policy = await host.ui.setProjectBudget(state.project, {revision: state.policy.revision, owner_id: state.owner.trim(), limit_usd_micros: parseBudgetUSD(state.limit), automatic_usd_micros: parseBudgetUSD(state.automatic), automatic_team_size: Number(state.team)});
  if (!closed && budgetEditor === state) {state.policy = policy; notice = "Политика бюджета сохранена.";}
 } catch {notice = "Сохранение не подтверждено. Перечитайте политику и проверьте суммы, владельца и полномочие управления бюджетом.";}
 finally {busy = false; if (!closed) render();}
}
function renderBudgetEditor() {
 const state = budgetEditor!; root.append(element("h2", "Бюджет проекта"));
 root.append(element("p", "Политика задаёт пороги расходов и согласования. Согласование заявки не означает её выполнение."));
 const project = element("select"); project.setAttribute("aria-label", "Проект бюджета"); project.append(new Option("Выберите проект", "")); const available = new Map(projects.map(item => [item.id, item.name])); for (const item of state.catalog.projects) available.set(item.project_id, item.name); for (const [id,name] of available) project.append(new Option(name, id)); project.value = state.project; project.disabled = busy; project.addEventListener("change", () => {state.project = project.value; state.policy = undefined; render();}); root.append(project, button("Открыть политику бюджета", () => void loadProjectBudget()));
 if (state.policy) {
  if (state.policy.revision) root.append(button("Заявки на команду", () => {
   teamBudgetView = new TeamBudgetView(root, host.ui, state.project, (review) => {teamBudgetView = null; if (review) {budgetEditor = null; taskRequest = review;} render();});
   void teamBudgetView.load();
  }));
  root.append(element("p", state.policy.revision ? `Ревизия ${state.policy.revision}` : "Бюджет не настроен. Это не означает неограниченные расходы."));
  for (const [key,label] of [["owner","Владелец бюджета: пользователь"],["limit","Общий бюджет, USD"],["automatic","Порог суммы без дополнительного согласования, USD"],["team","Размер команды без дополнительного согласования"]] as const) {
   const input = element("input"); input.setAttribute("aria-label",label); input.value = state[key]; input.disabled = busy; input.addEventListener("input", () => {state[key] = input.value;}); root.append(element("label",label),input);
  }
  root.append(element("p", "Размер команды — порог согласования, а не максимальное количество участников. Полномочие бюджета не даёт права на документы или их публикацию."), button("Сохранить политику бюджета", () => void saveProjectBudget()));
 }
 if (notice) root.append(element("p",notice));
 if (state.catalog.next_cursor) root.append(button("Следующие назначенные бюджеты", () => void openBudgetEditor(state.catalog.next_cursor)));
 root.append(button("Закрыть бюджет проекта", () => {budgetEditor = null; notice = ""; render();}));
}

async function openBudgetEditor(cursor = "") {
 if (busy || closed) return; busy = true; notice = ""; render();
 try {const catalog = await host.ui.listBudgetProjects(cursor); if (!closed) budgetEditor = {catalog, project: "", owner: "", limit: "0", automatic: "0", team: "1"};}
 catch {budgetEditor = null; notice = "Назначенные бюджеты недоступны.";}
 finally {busy = false; if (!closed) render();}
}


type Absence = Awaited<ReturnType<MnemosAccountSession["readAgentAbsence"]>>;
type AbsenceEditor = {project: string; saved?: Absence; local: string; managed: string; starts: string; ends: string; uncertain: boolean};
function absenceLocalTime(value: string) {
  const date = new Date(value); if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
}
async function openAbsenceEditor(project: string) {
  if (busy || closed) return;
  const state: AbsenceEditor = {project, local: "", managed: "", starts: "", ends: "", uncertain: true};
  absenceEditor = state; busy = true; notice = ""; render();
  try {
    const saved = await host.ui.readAgentAbsence(project);
    if (!closed && absenceEditor === state) {
      if (saved.project_id !== project || !Number.isSafeInteger(saved.revision) || saved.revision < 0) throw new Error("invalid absence receipt");
      state.saved = saved; state.local = saved.local_binding_id; state.managed = saved.managed_binding_id;
      state.starts = absenceLocalTime(saved.revision ? saved.starts_at : new Date().toISOString());
      state.ends = absenceLocalTime(saved.revision ? saved.ends_at : new Date(Date.now()+86400000).toISOString());
      state.uncertain = false;
    }
  } catch { notice = "Настройка недоступна. Перечитайте её перед изменением."; }
  finally { busy = false; if (!closed) render(); }
}
async function saveAbsence(enabled: boolean) {
  const state = absenceEditor;
  if (busy || closed || !state?.saved || state.uncertain) return;
  const saved = state.saved;
  if (enabled && (!state.local || !state.managed || state.local === state.managed || !Number.isFinite(Date.parse(state.starts)) || !Number.isFinite(Date.parse(state.ends)) || Date.parse(state.ends) <= Date.parse(state.starts))) {notice = "Выберите двух агентов и корректный период."; render(); return;}
  const input = {local_binding_id: enabled ? state.local : saved.local_binding_id, managed_binding_id: enabled ? state.managed : saved.managed_binding_id, starts_at: enabled ? new Date(state.starts).toISOString() : saved.starts_at, ends_at: enabled ? new Date(state.ends).toISOString() : saved.ends_at, expected_revision: saved.revision, enabled};
  busy = true; notice = ""; render();
  try {
    const out = await host.ui.setAgentAbsence(state.project, input);
    if (!closed && absenceEditor === state) {
      if (out.project_id !== state.project || out.revision <= saved.revision || out.enabled !== enabled) throw new Error("invalid absence receipt");
      state.saved = out; notice = enabled ? "Замещение разрешено на указанный период." : "Замещение отключено.";
    }
  } catch {state.uncertain = true; notice = "Сохранение не подтверждено. Перечитайте настройку перед повтором.";}
  finally {busy = false; if (!closed) render();}
}
function renderAbsenceEditor() {
  const state = absenceEditor!;
  root.append(element("h2", "Замещение на время отсутствия"), element("p", "Корпоративный агент сможет принимать обращения коллег в указанный период. Права на документы, разрешения на привлечение и бюджет проверяются отдельно."));
  if (notice) root.append(element("p", notice));
  if (state.saved) root.append(element("p", state.saved.enabled ? `Разрешено: ${new Date(state.saved.starts_at).toLocaleString()} — ${new Date(state.saved.ends_at).toLocaleString()}` : "Замещение отключено"));
  for (const [key,label,managed] of [["local","Локальный Claude Code / Codex",false],["managed","Корпоративный агент",true]] as const) {
    const select = element("select"); select.setAttribute("aria-label",label); select.append(new Option("Выберите агента", ""));
    for (const row of rows.filter(row => !row.revoked && (managed ? row.managed_runtime === true : row.managed_runtime === false))) select.append(new Option(`${row.agent_principal_id} · ${row.runtime_id}`,row.binding_id));
    if (state[key] && !Array.from(select.options).some(option => option.value === state[key])) select.append(new Option("Сохранённое подключение (проверьте доступность)",state[key]));
    select.value = state[key]; select.disabled = busy || state.uncertain; select.addEventListener("change",()=>{state[key]=select.value;}); root.append(element("label",label),select);
  }
  for (const [key,label] of [["starts","Начало отсутствия"],["ends","Конец отсутствия"]] as const) {
    const input = element("input"); input.type="datetime-local"; input.setAttribute("aria-label",label); input.value=state[key]; input.disabled=busy || state.uncertain; input.addEventListener("input",()=>{state[key]=input.value;}); root.append(element("label",label),input);
  }
  if (state.saved && !state.uncertain) {
    root.append(button("Разрешить замещение",()=>void saveAbsence(true)));
    if (state.saved.enabled) root.append(button("Отключить замещение",()=>void saveAbsence(false)));
  }
  root.append(button("Перечитать настройку",()=>void openAbsenceEditor(state.project)), button("Закрыть замещение",()=>{absenceEditor=null;notice="";render();}));
}

function openAnswers(project='') {
 expenseOverview=null;
 agentAnswers=new AgentAnswers(root,host.ui,projects,()=>{agentAnswers=null;render();});
 if(project)void agentAnswers.load(project);else agentAnswers.render();
}
function openExpenses(project='') {
 expenseOverview=new BudgetOverview(root,host.ui,()=>{expenseOverview=null;render();},(id,requester)=>{
  expenseOverview=null;teamBudgetView=new TeamBudgetView(root,host.ui,id,review=>{teamBudgetView=null;if(review)taskRequest=review;render();},requester);void teamBudgetView.load();
 },{project,answers:openAnswers});
 void expenseOverview.load();
}

/** Текст метрик платформы; вынесен, чтобы вкладка «Организация» показывала его без домашней страницы «Ещё». */
function renderPlatformMetrics(platformUsage: NonNullable<Awaited<ReturnType<MnemosAccountSession["readPlatformMetrics"]>>>) {
      root.append(element("p", `Завершённые публикации: ${platformUsage.shared_publications}`));
      root.append(element("p", `Вошедшие пользователи за 24 часа: ${platformUsage.authenticated_users_24h}`));
      root.append(element("p", `Успешные входы за 24 часа: ${platformUsage.human_logins_24h} (включая повторные входы)`));
      root.append(element("p", `Данные на ${new Date(platformUsage.recorded_at).toLocaleString()}`));
      if (platformUsage.signals) {
        root.append(element("h3", "Сигналы состояния платформы"));
        root.append(button("Ответственные за сигналы",()=>{platformSignalOwnersView=new PlatformSignalOwnersView(root,host.ui,()=>{platformSignalOwnersView=null;void loadPlatformMetrics();});void platformSignalOwnersView.read();}));
        root.append(element("p", "По последним проверкам. Отсутствие свежих данных требует проверки мониторинга и не означает исправность платформы."));
        const signalNames = {dependencies:"Зависимости API", "external.readiness":"Внешняя доступность", "external.login":"Внешний вход", "external.read":"Внешнее чтение", "external.save":"Внешнее сохранение"};
        const reasons = {check_unavailable:"проверка недоступна",source_unavailable:"источник наблюдений недоступен",observations_missing:"наблюдений нет",observations_stale:"наблюдения устарели",check_failed:"последняя проверка неуспешна",check_passed:"последняя проверка успешна"};
        for (const signal of platformUsage.signals) {
          const state = {ok:"Исправно по последней проверке",firing:"Тревога",unknown:"Неизвестно"}[signal.state];
          const owner = platformUsage.signal_owners?.find(row=>row.signal_key===signal.key);
          root.append(element("p", owner ? `Ответственный: ${owner.owner_id ? (owner.owner_name || owner.owner_id) + (owner.owner_active ? "" : " — неактивен") : "не назначен"}.` : "Сведения об ответственном недоступны."));
          root.append(element("p", `${signalNames[signal.key]}: ${state} — ${reasons[signal.reason]}.${signal.observed_at ? " Наблюдение: " + new Date(signal.observed_at).toLocaleString() + "." : ""}`));
        }
      }
      const attempts = platformUsage.workflow_attempts;
      if (attempts) {
        root.append(element("p", "Попытки по этапам — записанные операции API с известным сценарием, включая дошедшие до API вызовы MCP. Обращения без сценария и ошибки до отправки в API здесь не учтены."));
        if (!attempts.length) root.append(element("p", "Связанные попытки ещё не записаны."));
        const names = {open:"Открытие",save:"Сохранение",review:"Согласование",publish:"Публикация"};
        for (const row of attempts) {
          const result = row.status>=500 ? "ошибка сервера" : row.status>=400 ? "отказ" : "ответ без ошибки";
          const context = row.deployment;
          root.append(element("p", context ? `Контекст попыток: окружение ${context.environment || "неизвестно"}; релиз ${context.release || "неизвестен"}; исходники ${context.source_revision || "неизвестны"}${context.source_modified ? " (с локальными изменениями)" : ""}; схема ${context.schema_version}.` : "Контекст этих попыток не сохранён; текущий релиз к ним не применяется."));
          root.append(element("p", `${names[row.operation]}: ${row.attempts} попыток в ${row.workflows} сценариях; ${result}, HTTP ${row.status}, ${row.outcome}; среднее ${row.mean_duration_ms.toFixed(1)} мс. Последнее наблюдение: ${new Date(row.last_observed_at).toLocaleString()}.`));
        }
      }
      const deployment = platformUsage.deployment;
      if (deployment) {
        root.append(element("p", `Текущий сервис метрик: окружение — ${deployment.environment || 'не указано'}, релиз — ${deployment.release || 'не указан'}, схема — ${deployment.schema_version}.`));
        root.append(element("p", `Исходная ревизия: ${deployment.source_revision || 'неизвестна'}${deployment.source_modified === true ? ' (сборка с незакоммиченными изменениями)' : deployment.source_modified === null ? ' (состояние изменений неизвестно)' : ''}.`));
        root.append(element("p", "Эти сведения относятся к запущенному storage-api. Исторические события и клиентские замеры могут относиться к другим версиям; эта строка не присваивает им текущий релиз."));
      }
      const workflow = platformUsage.workflow;
      if (workflow) {
        root.append(element("p", `Сценарии работы: открыто — ${workflow.opened}, сохранено — ${workflow.saved}, отправлено на согласование — ${workflow.reviewed}, опубликовано — ${workflow.published}.`));
        root.append(element("p", workflow.opened ? `Дошли от открытия до публикации: ${(workflow.published / workflow.opened * 100).toFixed(1)}%.` : "Долю завершения пока нельзя рассчитать: наблюдавшихся открытий нет."));
        root.append(element("p", `Сценарии без наблюдавшегося начала: ${workflow.opening_unobserved}; в эту воронку не включены.`));
        if (workflow.first_observed_at) root.append(element("p", `Накопленные наблюдения с ${new Date(workflow.first_observed_at).toLocaleString()}. Согласование и публикация относятся к одному сценарию, повторы не добавляют завершений.`));
      }
      const stages = platformUsage.review_stages;
      if (stages) {
        root.append(element("p", `Согласования: ${stages.submitted} кандидатов. Текущие решения: ожидают — ${stages.awaiting_decisions}, отклонены — ${stages.rejected}, полностью одобрены — ${stages.approved}.`));
        root.append(element("p", `Подтверждённые публикации согласованных кандидатов: ${stages.published}. Исторические кандидаты без сведений о завершении: ${stages.historical_completion_unknown}.`));
        const decisions = stages.decisions;
        if (decisions) {
          root.append(element("p", `Полная история решений: ${decisions.tracked_candidates} кандидатов. Прежние кандидаты без полной истории: ${decisions.historical_candidates}; в показатели ответов и возвратов не включены.`));
          root.append(element("p", decisions.responded_candidates
            ? `Возвращены на доработку до публикации: ${decisions.returned_candidates} из ${decisions.responded_candidates} кандидатов, получивших ответ (${(decisions.returned_candidates / decisions.responded_candidates * 100).toFixed(1)}%). Последующее одобрение не стирает возврат.`
            : "Доля возвратов пока не определена: кандидатов с полной историей и полученным ответом нет."));
          for (const [label, duration] of [["До первого ответа назначенного согласующего", decisions.first_response], ["До первого полного одобрения кандидата", decisions.full_approval]] as const) {
            root.append(element("p", duration.samples
              ? `${label}: ${duration.samples} замеров; среднее ${(duration.mean_ms! / 1000).toFixed(1)} с, p50 ${(duration.p50_ms! / 1000).toFixed(1)} с, p95 ${(duration.p95_ms! / 1000).toFixed(1)} с, p99 ${(duration.p99_ms! / 1000).toFixed(1)} с.`
              : `${label}: подтверждённых измерений пока нет.`));
          }
          root.append(element("p", "Отсчёт от отправки на согласование. Первый ответ — одобрение или отказ по назначенной паре согласующий/направление; полное одобрение — один замер на кандидата. События после публикации исключены. Отзыв решения сохраняется в истории, но сам по себе не считается отказом. Ожидание по другим типам командных задач сюда не входит."));
        }
        const timing = stages.timing;
        if (timing) {
          const seconds = (ms: number) => (ms / 1000).toFixed(1);
          root.append(element("p", timing.completed_samples
            ? `От отправки на согласование до публикации: ${timing.completed_samples} завершённых кандидатов; среднее ${seconds(timing.mean_completion_ms!)} с, p50 ${seconds(timing.p50_completion_ms!)} с, p95 ${seconds(timing.p95_completion_ms!)} с, p99 ${seconds(timing.p99_completion_ms!)} с.`
            : "Время от отправки на согласование до публикации: подтверждённых измерений пока нет."));
          root.append(element("p", `Неопубликованные кандидаты, ожидающие решений: ${timing.pending_candidates}. ` + (timing.oldest_pending_ms === null
            ? "Возраст ожидания не измерен."
            : `Самый старый отправлен ${seconds(timing.oldest_pending_ms)} с назад.`)));
          root.append(element("p", "Календарное время включает паузы и ожидание публикации автором. Это не активное время согласующего. Выборка накопительная; перцентили точные, по завершённым кандидатам. Возраст ожидающих считается от отправки, в том числе после изменения решения."));
        }
        root.append(element("p", "Повторы не добавляют кандидатов. Решения могут меняться после публикации; её подтверждение сохраняется. Начало редактирования и личные сохранения в эти числа не входят."));
      }
      const versions = platformUsage.ui_readiness_versions;
      if (versions) {
        const details = element("details");
        details.append(element("summary", `Готовность по версиям коллектора: ${versions.total_groups} групп`));
        details.append(element("p", "Версия коллектора определяется по собранному скрипту CloudflareOS или панели Mnemos. Она не идентифицирует редактируемый код native-документа. Старые и неопознанные сборки отмечены отдельно. Контекст API относится к приёму первого конечного результата, для ожидающей загрузки — к приёму начала; это не версия всех серверов, участвовавших в загрузке."));
        if (versions.truncated) details.append(element("p", "Показаны 100 групп с наиболее свежими наблюдениями; список неполный. Общие показатели ниже включают все версии."));
        for (const row of versions.groups) {
          const name = {"mnemos.management":"Панель Mnemos","cloudflareos.shell":"Оболочка CloudflareOS","cloudflareos.document":"Docs","cloudflareos.spreadsheet":"Sheets","cloudflareos.presentation":"Slides"}[row.surface];
          details.append(element("p", `${name}; коллектор ${row.client_version || 'неизвестен'}; ${row.outcome}: ${row.samples} за 24 часа.`));
          const receiver = row.deployment;
          details.append(element("p", receiver ? `Принимающий API: ${receiver.environment || "окружение неизвестно"}; релиз ${receiver.release || "неизвестен"}; схема ${receiver.schema_version}; исходники ${receiver.source_revision || "неизвестны"}${receiver.source_modified ? " (с локальными изменениями)" : ""}.` : "Версия принимающего API не сохранена."));
          if (row.p50_ms !== null) details.append(element("p", `В этой группе: p50 — ${row.p50_ms} мс; p95 — ${row.p95_ms} мс; p99 — ${row.p99_ms} мс.`));
        }
        root.append(details);
      }
      root.append(element("p", "Общие показатели готовности ниже объединяют все версии коллектора."));
      const uiReadiness=platformUsage.ui_readiness;
      root.append(element("p", "Оболочка CloudflareOS: от начала навигации до загруженных данных сессии, конфигурации, навигации и отрисовки каркаса. Измеряется автоматическое восстановление входа; ручной вход и онбординг исключены. Содержимое открытой страницы и документа измеряется отдельно. Если JavaScript или подтверждённая сессия не запустились, отчёт может отсутствовать."));
      root.append(element("p", "Docs, Sheets и Slides: от запроса кода редактора до отрисовки загруженного документа. Время открытия оболочки сюда не входит. Для старых редакторов требуется обновление кода; отсутствие измерений не означает отказ."));
      root.append(element("p", "Готовность панели Mnemos: от начала загрузки начальных данных до их отрисовки и доступных действий. Загрузка оболочки и нативных редакторов сюда не входит."));
      if (!uiReadiness?.length) root.append(element("p", "Полученных измерений готовности панели пока нет."));
      else {
        const surfaces={"mnemos.management":"Панель Mnemos","cloudflareos.shell":"Оболочка CloudflareOS","cloudflareos.document":"Docs","cloudflareos.spreadsheet":"Sheets","cloudflareos.presentation":"Slides"};
        const names={pending:"загрузка идёт",ready:"готово",error:"ошибка загрузки",timeout:"истекло время ожидания",abandoned:"пользователь ушёл или скрыл панель",unconfirmed:"результат не подтверждён"};
        for(const row of uiReadiness){
          root.append(element("p", `${surfaces[row.surface]}: ${names[row.outcome]} — ${row.samples} за 24 часа.`));
          if(row.p50_ms!==null && row.p95_ms!==null && row.p99_ms!==null) root.append(element("p", `Длительность до этого результата: p50 — ${row.p50_ms} мс; p95 — ${row.p95_ms} мс; p99 — ${row.p99_ms} мс.`));
        }
      }
      const external = platformUsage.external;
      if (external) {
        root.append(element("p", "Внешние проверки за последние 24 часа. Доля успешных попыток не означает непрерывную доступность. Зависимые шаги после ошибки не выполняются."));
        const names = {readiness:"Готовность",login:"Вход",read:"Чтение",save:"Сохранение"};
        if (external.versions) {
          const versions = external.versions;
          const details = element("details");
          details.append(element("summary", `Внешние проверки по версиям наблюдателя: ${versions.total_groups} групп`));
          details.append(element("p", "Метки наблюдателя и контекст проверяемого API показаны отдельно. Для готовности версия API берётся из того же ответа; при сетевом сбое и в старых записях она неизвестна. Общие показатели ниже объединяют все группы."));
          if (versions.truncated) details.append(element("p", "Показаны 100 недавно наблюдавшихся групп; список неполный."));
          for (const row of versions.groups) {
            details.append(element("p", `${names[row.operation]}; окружение ${row.environment || "неизвестно"}; релиз наблюдателя ${row.observer_release || "неизвестен"}; код ${row.observer_version || "неизвестен"}: ${row.successes} из ${row.samples} успешно.`));
            const target = row.target_deployment;
            details.append(element("p", target ? `Проверяемый API: ${target.environment || "окружение неизвестно"}; релиз ${target.release || "неизвестен"}; схема ${target.schema_version}; исходники ${target.source_revision || "неизвестны"}${target.source_modified ? " (с локальными изменениями)" : ""}.` : "Версия проверяемого сервиса не сохранена."));
            const q = row.duration_percentiles_ms;
            if (q) details.append(element("p", `В этой группе: p50 — ${q.p50.toFixed(1)} мс; p95 — ${q.p95.toFixed(1)} мс; p99 — ${q.p99.toFixed(1)} мс.`));
          }
          root.append(details);
        }
        for (const op of external.operations) {
          if (op.source_status !== "ready") {
            root.append(element("p", `${names[op.operation]}: наблюдения недоступны (${op.source_status}).`));
            continue;
          }
          const totals = op.samples ? `${op.successes} из ${op.samples} успешно (${(op.successes / op.samples * 100).toFixed(1)}%); ошибок — ${op.samples - op.successes}` : "попыток за сутки нет";
          const last = op.last_observed_at ? `Последняя проверка: ${new Date(op.last_observed_at).toLocaleString()}, ${op.last_success ? "успешно" : op.last_outcome}.` : "Проверок ещё не было.";
          const stale = op.stale ? " Данные устарели или ещё не поступали." : "";
          root.append(element("p", `${names[op.operation]}: ${totals}. ${last}${stale}`));
          const latency = op.duration_percentiles_ms;
          if (latency) root.append(element("p", `Задержки проверки «${names[op.operation]}» по ${op.samples} попыткам: p50 — ${latency.p50.toFixed(1)} мс; p95 — ${latency.p95.toFixed(1)} мс; p99 — ${latency.p99.toFixed(1)} мс. Включая неуспешные попытки.`));
          if (op.mean_duration_ms !== null) root.append(element("p", `Средняя длительность проверки: ${op.mean_duration_ms.toFixed(1)} мс.`));
        }
      } else root.append(element("p", "Внешние проверки не подключены."));
      const readiness = platformUsage.readiness;
      if (readiness) {
        root.append(element("p", `Готовность API: ${readiness.ready ? "готов" : "не готов"}. Проверено ${new Date(readiness.checked_at).toLocaleString()}.`));
        if (!readiness.ready) root.append(element("p", `Причины недоступности: ${readiness.reasons.join(", ")}`));
      } else root.append(element("p", "Текущая готовность API не проверена."));
      root.append(element("p", "p50, p95 и p99 описывают длительность половины, 95% и 99% измеренных попыток. Для API показаны границы корзин; внешние проверки используют сохранённые значения. Это не время готовности интерфейса."));
      const service = platformUsage.service;
      if (service) {
        root.append(element("p", `Запросы API с ${new Date(service.started_at).toLocaleString()} по ${new Date(service.observed_at).toLocaleString()}. Счётчики обнуляются при перезапуске процесса.`));
        root.append(element("p", "Коды результатов включают ожидаемые отказы доступа. Задержки измерены по завершённым запросам; это не показатель непрерывной доступности."));
        if (!service.operations.length) root.append(element("p", "Завершённых запросов пока нет."));
        const rows = element("ul");
        for (const op of service.operations) {
          const latency = ([50,95,99] as const).map(p=>`p${p} по корзинам — ${histogramPercentileBound(op,p)}`).join("; ");
          rows.append(element("li", `${op.surface} ${op.method}: ${op.requests} запросов; среднее ${(op.duration_seconds / op.requests * 1000).toFixed(1)} мс; ${latency}. Результаты: ${Object.entries(op.outcomes).map(([code, count]) => `${code}: ${count}`).join(", ")}`));
        }
        root.append(rows);
      } else root.append(element("p", "Измерения запросов API недоступны."));
      const work = platformUsage.organization_work;
      if (work) {
        const collaboration = work.collaboration;
        if (collaboration) {
          root.append(element("p", "Поручения соисполнителям, созданные за последние 24 часа. Ответ — первое сообщение адресата или его владельца; собственные сообщения отправителя исключены. Время календарное, включая ожидание человека."));
          root.append(element("p", `Поручений — ${collaboration.requests}; ответили — ${collaboration.first_response.samples}; пока без ответа — ${collaboration.requests-collaboration.first_response.samples}.`));
          root.append(element("p", `Результатов — ${collaboration.results}; получили первую проверку — ${collaboration.first_review.samples}; без сохранённой проверки — ${collaboration.results-collaboration.first_review.samples}.`));
          for (const [label,timing] of [["До первого ответа",collaboration.first_response],["От результата до первой проверки",collaboration.first_review]] as const) {
            root.append(element("p", timing.samples ? `${label}: ${timing.samples} измерений; p50 — ${timing.p50_seconds!.toFixed(1)} с; p95 — ${timing.p95_seconds!.toFixed(1)} с; p99 — ${timing.p99_seconds!.toFixed(1)} с.` : `${label}: завершённых измерений нет; длительность неизвестна.`));
          }
          root.append(element("p", collaboration.reviewed_requests ? `Доработка запрошена у ${collaboration.reworked_requests} из ${collaboration.reviewed_requests} проверенных поручений (${(100*collaboration.reworked_requests/collaboration.reviewed_requests).toFixed(1)}%). Повторные решения не увеличивают число поручений.` : "Доля поручений с доработкой неизвестна: проверенных результатов нет."));
        } else root.append(element("p", "Время ответа и проверки поручений пока недоступно."));
        root.append(element("p", "Результаты этой организации: публикации документов и принятые поручения учитываются отдельно. Поручение считается один раз по первой приёмке результата; последующие доработки не добавляют завершений."));
        for (const period of work.periods) root.append(element("p", `За ${period.days} дн.: ${period.publications} публикаций в ${period.projects} проектах; ${period.has_completed_publication ? "есть подтверждённый результат" : "публикации не зарегистрированы"}.`));
        if (work.periods.every(p=>p.completed_projects!==undefined)) {
          for (const period of work.periods) root.append(element("p", `За ${period.days} дн.: проектов с завершённой работой — ${period.completed_projects}; организация ${period.has_completed_work ? "имеет подтверждённый результат" : "не имеет зарегистрированных завершений"}.`));
          root.append(element("p", "Проект с публикацией и принятым поручением учитывается один раз. Это свод текущей организации; отдельные результаты не складываются в число уникальных задач."));
        } else root.append(element("p", "Объединённый свод завершённых проектов недоступен."));
        if (work.first_acceptance_at !== undefined) {
          for (const period of work.periods) root.append(element("p", `За ${period.days} дн.: впервые принятых поручений — ${period.accepted_requests}, проектов — ${period.accepted_request_projects}.`));
          if (work.first_acceptance_at) root.append(element("p", `Первая сохранённая приёмка поручения: ${new Date(work.first_acceptance_at).toLocaleString()}.`));
        } else root.append(element("p", "Данные о принятых поручениях недоступны."));
        root.append(element("p", "Это сохранённые приёмки поручений людям и агентам, а не число запусков моделей или текущих статусов задач трекера."));
        if (work.first_publication_at) root.append(element("p", `Первая сохранённая публикация: ${new Date(work.first_publication_at).toLocaleString()}. Более ранняя история может быть неизвестна.`));
      }
      const periods = platformUsage.activity_windows;
      if (periods) {
        root.append(element("p", `Наблюдаемая активность: первые сохранённые сигналы — ${new Date(periods.first_observed_at).toLocaleString()}. Это не подтверждает непрерывное покрытие всех сотрудников.`));
        for (const period of periods.windows) {
          root.append(element("p", period.reporting_users ? `За ${period.days} дн.: активных людей — ${period.active_users}; телеметрия от ${period.reporting_users}.` : `За ${period.days} дн.: телеметрия не поступала; активность неизвестна.`));
          if (Date.parse(periods.observed_at) - Date.parse(periods.first_observed_at) < period.days * 86400000) root.append(element("p", `История наблюдений короче ${period.days} дн.; полный период пока не накоплен.`));
        }
      } else root.append(element("p", "Активность за день, неделю и месяц пока неизвестна: нет полученных сигналов."));
      const a = platformUsage.workspace_activity;
      if (a) {
        root.append(element("p", `Активность команды за 24 часа: ${a.active_users} пользователей · ${a.sessions} рабочих сессий · ${(a.active_seconds / 60).toFixed(1)} мин активности`));
        root.append(element("p", `Телеметрия получена от ${a.reporting_users} пользователей; длительность наблюдаемых сессий — ${(a.session_seconds / 60).toFixed(1)} мин.`));
      } else root.append(element("p", "Данные активности команды ещё не поступали. Отправку можно настроить в своём профиле CloudflareOS."));
}
