import { BlueprintTemplates } from "./blueprint-templates.ts";
import { managementSections } from "./management-sections.ts";
import { inboxCounts } from "./inbox-count.ts";
import {storedAccountOwner} from './account-identity.ts';
import {LocalOperationStorage} from './local-operation-storage.ts';
import {ConnectionAuditQueue} from './connection-audit-queue.ts';
import {AccountAlarms} from './account-alarms.ts';
import {CODE_AGENT_CAPABILITY,WorkspaceClient,WorkspaceTasks} from './workspace-tasks.ts';
import {DraftAuditQueue} from './draft-audit-queue.ts';
import { LoginProfiles, organizationAccountName } from './login-profiles.ts';
import { isNativeDocumentFormat } from "@gadgets/workshop-shared/native-document";
import {WebDAVAccounts,webdavServers,WEBDAV_RESOURCE,type WebDAVSetup} from './webdav-accounts.ts';
import {signDriveOrigin,driveSourceBinding} from "./drive-origin-proof.ts";
import {SmtpClient} from './smtp-client.ts';
import {connectSmtp} from './smtp-sockets.ts';
import {ImapAccounts,imapServers,IMAP_RESOURCE} from './imap-accounts.ts';
import type {ImapSetup} from './imap-types.ts';
import {CalDAVAccounts,caldavServers,CALDAV_RESOURCE} from './caldav-accounts.ts';
import type {CalDAVSetup} from './caldav-types.ts';
import {CalendarDrafts,calendarDraftReview,listCalendarDrafts} from './calendar-drafts.ts';
import {MailDrafts,mailDraftReview,listMailDrafts} from './mail-drafts.ts';
import {MailSelections} from "./mail-selection.ts";
import {handleMailBridge, splitMailSelection, type MailBridgeDraft, type MailBridgeRead, type MailBridgeResolve, type MailBridgeConnection} from "./mail-bridge.ts";
import {VoiceTransfer} from "./voice-transfer.ts";
import type {VoiceManagement} from "./voice-management.ts";
import type {TelegramManagement} from './telegram-management.ts';
import {OfficeUpdateRecovery} from "./office-update-recovery.ts";
export {TelegramBot} from './telegram-bot.ts';
export {TelegramPoller} from './telegram-poller.ts';
export { MnemosLibrary } from './agent-library.ts';
import { MNEMOS_LIBRARY_TYPES } from './agent-library-types.ts';
import {telegramRoute} from './telegram-bot.ts';
import {DriveImportCapture} from "./drive-import-capture.ts";
import type {DriveImportSource} from "@gadgets/workshop-shared/drive-import";
import type {CalendarGrantDecision} from "./calendar-connections.ts";
import type {MailGrantDecision} from "./mail-connections.ts";
import {handleCalendarBridge, splitCalendarSelection, type CalendarBridgeDraft, type CalendarBridgeRead, type CalendarBridgeResolve, type CalendarBridgeConnection} from "./calendar-bridge.ts";
import {CalendarSelections} from "./calendar-selection.ts";
import type {CalendarReadSource, CalendarWriteSource, MailReadSource, MailSendSource} from "@gadgets/workshop-shared/gatekeeper";
import type {BitrixTaskMapping} from "./corporate-import.ts";
import {CorporateTaskCreation} from "./corporate-task-creation.ts";
import type {DatabaseRegistration} from "./database-connections.ts";
import type {GitRepositorySelection} from "./git-connections.ts";
import type {GitSetup} from "./git-connections.ts";
import {ResourceMapCreation,type ResourceMapSetup} from "./resource-map-creation.ts";
import {ResourceMapEdits,type ResourceMapEditInput} from "./resource-map-edits.ts";
import {TrackerEdits,type TrackerEditInput} from "./tracker-edits.ts";
import {TrackerCreation,type TrackerSetup} from "./tracker-creation.ts";
import {TeamDocumentCreation,type TeamDocumentManagement} from "./team-document-creation.ts";
import type { UIReadinessSample } from "@gadgets/workshop-shared/ui-readiness";
import type { SpendingEntry } from "@gadgets/workshop-shared/spending";
import type { PrivateParticipantMode } from "./mnemos-api.ts";
import { documentResourceUrl, parseDocumentResource, publicationIdentifier } from "./document-resource.ts";
import { MnemosAPIError, type PolicyDomain } from "./mnemos-api.ts";
import { DurableObject, RpcStub, RpcTarget, WorkerEntrypoint } from "cloudflare:workers";
import { MnemosAccount, type MnemosAccountSession, type AccountStorage } from "./account-session.ts";
import type { SelectedDocumentReader } from "./document-resource.ts";
import { NativeCreationRecovery } from "./native-creation-recovery.ts";
import { NativeWriteSelector, listNativeDocuments } from "./native-writer.ts";
import type { NativeDocumentFormat } from "@gadgets/workshop-shared/native-document";

import { LoginFlow, type LoginConfig } from "./login-flow.ts";
import type { ExtraActionSession } from "./agent-actions-extra.ts";
import { agentActionError, checkedAgentAction, checkedAgentRead, executeAgentAction, prepareAgentAction, readForAgent, type AgentActionKind, type AgentActionRequest, type AgentReadRequest, type PreparedAgentAction } from "./agent-actions.ts";

import { BrowserLoginBinding, handleBrowserLogin } from "./browser-login.ts";

import type { NativeDocumentSource, ObservationAuthorizer, AccountDescription, AppUiContext, GatekeeperUser, GatekeeperConnectCallback, GatekeeperConnectOptions, GatekeeperUserVerifier, GatekeeperVendor as Vendor, SupportedResource, ResourceConfiguratorFrame, Gatekeeper, VendorDescription } from "@gadgets/workshop-shared/gatekeeper";

import APP_HTML from "./generated/app.txt";

interface Env { MNEMOS_WORKSPACE_ORIGIN?:string; MNEMOS_WORKSPACE_TOKEN?:string; MNEMOS_WEBDAV_SERVERS?:string; MNEMOS_DRIVE_ORIGIN_KEY?:string; MNEMOS_IMAP_SERVERS?:string; MNEMOS_CALDAV_SERVERS?:string; MNEMOS_API_ORIGIN: string; MNEMOS_STORAGE_ORIGIN?: string; MNEMOS_LOGIN_CONFIG?: string; MNEMOS_LOGIN_PROFILES?: string; MNEMOS_CALENDAR_BRIDGE_TOKEN?: string; MNEMOS_MAIL_BRIDGE_TOKEN?: string }

function callbackUrl(env: Env): string {
  try {
    const config: LoginConfig = JSON.parse(env.MNEMOS_LOGIN_CONFIG ?? "");
    const url = new URL(config.callbackUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href;
  } catch { throw new Error("Mnemos login is not configured"); }
}
const AVATAR = { url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' rx='12' fill='%23334155'/%3E%3Ctext x='32' y='44' text-anchor='middle' font-size='40' fill='white'%3EM%3C/text%3E%3C/svg%3E" };

/** Trusted Workshop entrypoint. It mints new accounts; it cannot select an existing owner. */
export class GatekeeperVendor extends WorkerEntrypoint<Env> implements Vendor {
  async describe(): Promise<VendorDescription> {
    return { displayName: "Mnemos", url: new URL(callbackUrl(this.env)).origin, logo: AVATAR,
      tagline: "Документы и знания команды", providesAuth: true, providesAccountUi: true };
  }
  async connectAccount(callback: Fetcher<GatekeeperConnectCallback>, options?: GatekeeperConnectOptions): Promise<{ url: string }> {
    if (options?.resourceUrlPatterns?.some(pattern=>![CALDAV_RESOURCE.urlPattern,IMAP_RESOURCE.urlPattern,WEBDAV_RESOURCE.urlPattern].includes(pattern))) throw new Error("Mnemos agent resources are not configured");
    const base = callbackUrl(this.env);
    const id = this.ctx.exports.UserAccount.newUniqueId();
    const nonce = await this.ctx.exports.UserAccount.get(id).setCallback(callback);
    return { url: `${base}/start/${id}/${nonce}` };
  }
  // Agent resource implementations are not registered until their rights and observations exist.
  async getSupportedResources(_options?: { userId?: string }): Promise<SupportedResource[]> { return [CALDAV_RESOURCE,IMAP_RESOURCE,WEBDAV_RESOURCE]; }
  async getTypeScriptTypes(): Promise<string> { return MNEMOS_LIBRARY_TYPES; }
}

/** Human account capability, retained by Workshop rather than handed to agents. */
/** Набор проектов беседы: сколько проектов показать и у скольких проверить подключённый код. */
const CHAT_PROJECTS_LIMIT=50;
const CHAT_PROJECTS_WITH_CODE_CHECK=20;

export class GatekeeperUserImpl extends WorkerEntrypoint<Env, { userObjectId: string }> implements GatekeeperUser {
  #account() { return this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(this.ctx.props.userObjectId)); }
  async describe(): Promise<AccountDescription> {
    const identity = await this.#account().connectionIdentity();
    return { displayName: identity.tenant_name || identity.subject.user_id,
      uniqueName: identity.connectionName, avatar: AVATAR,
      sourceErrors: await this.#account().sourceErrors(),
      receivesWorkspaceActivity: true, singleton: { tsType: "MnemosLibrary" }, providesUi: { title: "Mnemos", icon: AVATAR, sections: await this.#sections(identity) } };
  }
  /** Разделы меню со счётчиком «Входящих» (в нём и согласования); медленный или недоступный счётчик просто не показывается. */
  async #sections(identity: Parameters<typeof managementSections>[0]) {
    const counts = await this.#account().inboxCounts(identity.subject.user_id).catch(() => undefined);
    return managementSections(identity, counts?.inbox);
  }
  /** Агентский синглтон MNEMOS (ADR 0024 §1); данные он берёт через этот же аккаунт. */
  async getSingletonGatekeeperClass(): Promise<DurableObjectClass<Gatekeeper<any>>> {
    return this.ctx.exports.MnemosLibrary({ props: { userObjectId: this.ctx.props.userObjectId } });
  }
  /** Forward diagnostic samples through the connected human account. */
  async recordWorkspaceActivity(stream: string, sequence: number, active: boolean): Promise<void> { await this.#account().recordWorkspaceActivity(stream, sequence, active); }
  async recordUIReadiness(sample: UIReadinessSample): Promise<void> { await this.#account().recordUIReadiness(sample); }
  /** Траты оболочки на модели — в единый учёт через подключение человека. */
  async recordSpending(entries: SpendingEntry[]): Promise<void> { await this.#account().recordSpending(entries); }
  async startAppUi(_context: AppUiContext) { return this.#account().startAppUi(); }
  /** Trusted host receiver; not exposed by the human management iframe. */
  async captureDriveImport(project:string,request:string,sourceKey:string,fileId:string,source:Fetcher<DriveImportSource>) {
    return this.#account().captureDriveImport(project,request,sourceKey,fileId,source);
  }
  /** Human registration entrypoint retained by the trusted Workshop host. */
  async registerCalendarSelection(project:string,request:string,selection:string) {
    return this.#account().registerCalendarSelection(project,request,selection);
  }
  async registerMailSelection(project:string,request:string,selection:string) {
    return this.#account().registerMailSelection(project,request,selection);
  }
  /** Trusted host passes source authority; the management iframe cannot call this method. */
  async listMailFolders(parent:string){return this.#account().listImapFolders(parent);}
  async getMailReadSource(query:string){return this.#account().imapReadSource(query);}
  async getMailSendSource(query:string){return this.#account().imapSendSource(query);}
  async listDriveImportAccounts(){const result=await this.#account().listWebDAVAccounts();return result.accounts.filter(a=>a.enabled).map(a=>({id:a.id,name:a.username+' — '+a.server}));}
  async getDriveImportSource(fileId:string){return this.#account().webdavReadSource(fileId);}
  async listCalendars(){return this.#account().listCalDAVCalendars();}
  async getCalendarReadSource(id:string){return this.#account().caldavReadSource(id);}
  async getCalendarWriteSource(id:string){return this.#account().caldavWriteSource(id);}
  async prepareCalendarDraftCreate(id:string,sha256:string){return this.#account().prepareCalendarDraftCreate(id,sha256);}
  async createCalendarDraft(id:string,sha256:string,sourceKey:string,source:Fetcher<CalendarWriteSource>){return this.#account().createCalendarDraft(id,sha256,sourceKey,source);}
  async prepareMailDraftSend(id:string,sha256:string){return this.#account().prepareMailDraftSend(id,sha256);}
  async sendMailDraft(id:string,sha256:string,sourceKey:string,source:Fetcher<MailSendSource>){return this.#account().sendMailDraft(id,sha256,sourceKey,source);}
  async acceptMailReadSource(project: string, request: string, sourceKey: string, source: Fetcher<MailReadSource>) {
    return this.#account().acceptMailReadSource(project, request, sourceKey, source);
  }

  async acceptCalendarReadSource(project: string, request: string, sourceKey: string, source: Fetcher<CalendarReadSource>) {
    return this.#account().acceptCalendarReadSource(project, request, sourceKey, source);
  }

  /** Работа с кодом беседы: хост вызывает от имени этого человека; фрейм управления их не видит. */
  async listChatProjects(){return this.#account().listChatProjects();}
  /** Право «Агент кода» этого человека: без него беседа не показывает «Код» и не зовёт агента кода. */
  async codeWorkAllowed(){return this.#account().codeWorkAllowed();}
  async codeWorkStart(project:string,target:{connectionId:string;repositoryId:string;repositoryName:string},prompt:string){return this.#account().codeWorkStart(project,target,prompt);}
  async codeWorkMessage(project:string,task:string,text:string){return this.#account().codeWorkMessage(project,task,text);}
  async codeWorkEvents(project:string,task:string,after:number,waitMs:number){return this.#account().codeWorkEvents(project,task,after,waitMs);}
  async codeWorkAbort(project:string,task:string){return this.#account().codeWorkAbort(project,task);}
  async codeWorkInterrupt(project:string,task:string){return this.#account().codeWorkInterrupt(project,task);}
  async codeWorkChanges(project:string,task:string,since?:'accepted'|'start'){return this.#account().codeWorkChanges(project,task,since);}
  async codeWorkAccept(project:string,task:string,summary:string){return this.#account().codeWorkAccept(project,task,summary);}
  async codeWorkRevert(project:string,task:string,mergeRequest:number){return this.#account().codeWorkRevert(project,task,mergeRequest);}
  async codeWorkPutFile(project:string,task:string,path:string,contentBase64:string){return this.#account().codeWorkPutFile(project,task,path,contentBase64);}
  async revoke(): Promise<void> { await this.#account().revoke(); }
  async reconnect(): Promise<{ url: string }> {
    const nonce = await this.#account().prepareReconnect();
    return { url: `${callbackUrl(this.env)}/start/${this.ctx.props.userObjectId}/${nonce}` };
  }
  /** Почта, подтверждённая входом в Mnemos этого подключения; оболочка по ней заводит сеанс. */
  async getAuthenticatedEmail(): Promise<string | null> { return this.#account().authenticatedEmail(); }
  async getSupportedResources(): Promise<SupportedResource[]> { return [CALDAV_RESOURCE,IMAP_RESOURCE,WEBDAV_RESOURCE]; }
  async getGatekeeperClassFor(_url: string): Promise<{ class: DurableObjectClass<Gatekeeper<any>>; resource: SupportedResource }> { throw new Error("Mnemos agent resources are not configured"); }
  async startResourceConfigurator(_pattern: string): Promise<ResourceConfiguratorFrame> { throw new Error("Mnemos agent resources are not configured"); }
  async ensureResources(patterns: string[]): Promise<{ url?: string }> {
    if (patterns.some(pattern=>![CALDAV_RESOURCE.urlPattern,IMAP_RESOURCE.urlPattern,WEBDAV_RESOURCE.urlPattern].includes(pattern))) throw new Error("Mnemos agent resources are not configured");
    return {};
  }
  async getNativeDocumentSource(resourceUrl: string, publication: string) {
    return this.#account().nativeDocumentSource(resourceUrl, publication);
  }
  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    return this.#account().getVerifier();
  }
}

/** Same-vendor observer oracle; never grants a document or download capability. */
export interface MnemosVerifierApi extends GatekeeperUserVerifier {
  /** Recheck this exact publication with the observer's own account in the source's organization. */
  canReadPublication(resourceUrl: string, eventId: string, tenantId: string): Promise<boolean>;
  /** Observer's connected account belongs to this organization; no document capability is implied. */
  sameTenant(tenantId: string): Promise<boolean>;
}

/** Persistent verifier minted by the observer's connected account. */
export class MnemosVerifier extends WorkerEntrypoint<Env, { userObjectId: string }> implements MnemosVerifierApi {
  async canReadPublication(resourceUrl: string, eventId: string, tenantId: string): Promise<boolean> {
    const account = this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(this.ctx.props.userObjectId));
    return account.canReadPublication(resourceUrl, eventId, tenantId);
  }
  async sameTenant(tenantId: string): Promise<boolean> {
    const account = this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(this.ctx.props.userObjectId));
    return account.sameTenant(tenantId);
  }
}

/** Per-account storage; HTTP exposes only the nonce-bound login boundary. */
/** Ключ хранилища подключения: почта из последнего успешного входа в Mnemos. */
const AUTHENTICATED_EMAIL = "authenticatedEmail";
export class UserAccount extends DurableObject<Env> {
 constructor(ctx:DurableObjectState,env:Env){
  super(ctx,env);
  ctx.blockConcurrencyWhile(async()=>{
   const existing=await ctx.storage.getAlarm();
   if(existing!==null&&!this.#alarms().hasDeadlines())await this.#alarms().schedule('login',existing);
  });
 }
 #alarms(){return new AccountAlarms(this.ctx.storage.kv,this.ctx.storage);}
 /** Задачи агентов в рабочих местах; без настройки службы — только чтение списка. */
 #workspace(){
  let control:WorkspaceClient|null=null;
  if(this.env.MNEMOS_WORKSPACE_ORIGIN&&this.env.MNEMOS_WORKSPACE_TOKEN){try{control=new WorkspaceClient(this.env.MNEMOS_WORKSPACE_ORIGIN,this.env.MNEMOS_WORKSPACE_TOKEN);}catch{control=null;}}
  return new WorkspaceTasks(this.ctx.storage.kv,{control,
   agent:()=>this.#account().ensureWorkshopAgent(this.ctx.id.toString(),WORKSHOP_AGENT_NAME),
   human:()=>{const session=this.#account().session();return {issueAgentCredential:(b:string)=>session.issueAgentCredential(b),readWorkshopAgentScope:(b:string)=>session.readWorkshopAgentScope(b),updateWorkshopAgentScope:(b:string,e:string[],p:string[])=>session.updateWorkshopAgentScope(b,e,p),listProjectGitRepositories:(p:string)=>session.listProjectGitRepositories(p,''),openMergeRequest:(p:string,c:string,r:string,h:string,t:string,b:string)=>session.openMergeRequest(p,c,r,h,t,b),acceptMergeRequest:(p:string,c:string,r:string,i:number,h:string)=>session.acceptMergeRequest(p,c,r,i,h),revertMergeRequest:(p:string,c:string,r:string,i:number)=>session.revertMergeRequest(p,c,r,i),dispose:()=>session.dispose()};},
   wake:at=>at===null?this.#alarms().clear('workspace'):this.#alarms().reschedule('workspace',at)});
 }
 async workspaceAvailable(){return this.#workspace().available();}
 async listWorkspaceTasks(project:string){return {tasks:this.#workspace().list(project)};}
 async startWorkspaceTask(project:string,connection:string,repository:string,prompt:string){return this.#workspace().start(project,connection,repository,prompt);}
 async readWorkspaceTask(project:string,task:string){return this.#workspace().read(project,task);}
 async messageWorkspaceTask(project:string,task:string,text:string){return this.#workspace().message(project,task,text);}
 async abortWorkspaceTask(project:string,task:string){return this.#workspace().abort(project,task);}
 /** Право «Агент кода» (полномочие code.agent.use в Mnemos). Сбой чтения — «нет»: окончательно
  * решает служба рабочих мест, спрашивая Mnemos с ключом агента. */
 async codeWorkAllowed(){
  const session=this.#account().session();
  try{return (await session.whoAmI()).capabilities?.includes(CODE_AGENT_CAPABILITY)===true;}
  catch{return false;}
  finally{session.dispose();}
 }
 /** Проекты человека для набора проектов беседы; у первых проектов проверяется подключённый код.
  * Без права «Агент кода» код проектов не называется: беседе некуда звать агента кода. */
 async listChatProjects(){
  const session=this.#account().session();
  try{
   const identity=await session.whoAmI();
   const codeAllowed=identity.capabilities?.includes(CODE_AGENT_CAPABILITY)===true;
   const projects=(await session.listProjects()).projects.slice(0,CHAT_PROJECTS_LIMIT);
   const out:{projectId:string;title:string;code?:{connectionId:string;repositoryId:string;repositoryName:string}}[]=[];
   for(const [i,p] of projects.entries()){
    let code:{connectionId:string;repositoryId:string;repositoryName:string}|undefined;
    if(codeAllowed&&i<CHAT_PROJECTS_WITH_CODE_CHECK){try{const r=(await session.listProjectGitRepositories(p.id,'')).repositories.find(x=>x.enabled);if(r)code={connectionId:r.connection_id,repositoryId:r.repository_id,repositoryName:r.repository_name};}catch{/* проект без доступного кода */}}
    out.push({projectId:p.id,title:p.name,...(code?{code}:{})});
   }
   return {projects:out};
  }finally{session.dispose();}
 }
 async codeWorkStart(project:string,target:{connectionId:string;repositoryId:string},prompt:string){const out=await this.#workspace().startTask(project,target.connectionId,target.repositoryId,prompt,{agentName:'chat',allRepositories:true});return {taskId:out.task.task_id,state:out.task.state,scopeExtended:out.scopeExtended};}
 async codeWorkMessage(project:string,task:string,text:string){return this.#workspace().message(project,task,text);}
 async codeWorkEvents(project:string,task:string,after:number,waitMs:number){return this.#workspace().events(project,task,after,waitMs);}
 async codeWorkAbort(project:string,task:string){return this.#workspace().abort(project,task);}
 async codeWorkInterrupt(project:string,task:string){return this.#workspace().interrupt(project,task);}
 async codeWorkChanges(project:string,task:string,since?:'accepted'|'start'){return this.#workspace().changes(project,task,since);}
 async codeWorkAccept(project:string,task:string,summary:string){return this.#workspace().accept(project,task,summary);}
 async codeWorkRevert(project:string,task:string,mergeRequest:number){return this.#workspace().revert(project,task,mergeRequest);}
 /** Файл в /workspace/.mnemos задачи: контекст беседы или приложенный файл; задача должна принадлежать проекту. */
 async codeWorkPutFile(project:string,task:string,path:string,contentBase64:string){return this.#workspace().putFile(project,task,path,contentBase64);}
 #auditCredential(kind:'mail'|'calendar',origin:string){
  const configured=[this.env.MNEMOS_API_ORIGIN];
  if(this.env.MNEMOS_LOGIN_PROFILES){
   const profiles:unknown=JSON.parse(this.env.MNEMOS_LOGIN_PROFILES);
   if(!Array.isArray(profiles))throw Error('Audit configuration unavailable.');
   for(const profile of profiles)if(profile&&typeof profile.apiOrigin==='string')configured.push(profile.apiOrigin);
  }
  if(!configured.includes(origin))throw Error('Audit destination unavailable.');
  return (kind==='mail'?this.env.MNEMOS_MAIL_BRIDGE_TOKEN:this.env.MNEMOS_CALENDAR_BRIDGE_TOKEN)??'';
 }
 #auditQueue(){return new DraftAuditQueue(this.ctx.storage.kv,(kind,origin)=>this.#auditCredential(kind,origin));}
 #connectionAuditQueue(){return new ConnectionAuditQueue(this.ctx.storage.kv,origin=>this.#auditCredential('calendar',origin));}
 #connectionStorage(){return this.#connectionAuditQueue().capture(this.#origins().apiOrigin,()=>{
  this.ctx.waitUntil(this.#alarms().schedule('audit',Date.now()+1000));
 });}
 #operationStorage(){return new LocalOperationStorage(this.ctx.storage.kv,this.#connectionStorage());}
 #draftStorage():AccountStorage{
  const drafts=this.#auditQueue().capture(this.#origins().apiOrigin,()=>{this.ctx.waitUntil(this.#alarms().schedule('audit',Date.now()+1000));});
  const selections=this.#connectionStorage();
  return {get:<T>(key:string)=>drafts.get<T>(key),delete:key=>drafts.delete(key),put:<T>(key:string,value:T)=>{
   if(/^(mail|calendar)SelectionRequest:/.test(key))selections.put(key,value);else drafts.put(key,value);
  }};
 }

 #voiceTransfer?:VoiceTransfer;
  /** Internal bot authority lookup: all identity comes from the live Mnemos session. */
  async telegramAuthority(binding: string) {
    if (typeof binding !== 'string' || !binding || binding.length > 255) throw Error('Invalid agent binding.');
    const session = this.#account().session();
    try {
      const identity = await session.whoAmI();
      const epoch = this.#account().calendarEpoch();
      if (!epoch) throw Error('Mnemos account unavailable.');
      let cursor = ''; const seen = new Set<string>();
      for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
        const page = await session.listAgentConnections(cursor);
        if (page.connections.some(item => item.binding_id === binding && !item.revoked)) {
          await session.whoAmI();
          if (this.#account().calendarEpoch() !== epoch) throw Error('Mnemos account changed.');
          return {tenant: identity.subject.tenant_id, owner: identity.subject.user_id, epoch, ...this.#origins()};
        }
        if (!page.next_cursor || seen.has(page.next_cursor)) break;
        cursor = page.next_cursor; seen.add(cursor);
      }
      throw Error('Agent connection unavailable.');
    } finally { session.dispose(); }
  }
  /** Pairing-only check survives expiry but not explicit account disconnect. */
  /** Internal audit attribution remains available after credential revocation. */
  telegramAuditOwner(){const owner=storedAccountOwner(this.ctx.storage.kv);if(!owner)throw Error('Telegram audit owner unavailable');return owner;}
  async telegramEpochValid(epoch: string): Promise<boolean> { return this.#account().calendarEpoch() === epoch; }
  /** Only the bot DO supplies the digest, after an owned sender-confirmation operation. */
  async registerTelegramGrant(epoch: string, input: import('./mnemos-api.ts').TelegramChannelRegistration) {
    const authority = await this.telegramAuthority(input.binding_id);
    if (authority.epoch !== epoch) throw Error('Mnemos account changed.');
    const session = this.#account().session();
    try {
      const result = await session.registerTelegramChannel(input);
      if (this.#account().calendarEpoch() !== epoch) throw Error('Mnemos account changed.');
      return result;
    } finally { session.dispose(); }
  }
  /** Human cleanup remains possible after the selected agent was revoked. */
  async disableTelegramGrant(id: string) {
    const session = this.#account().session();
    try { await session.whoAmI(); await session.disableTelegramChannel(id); }
    finally { session.dispose(); }
  }
  #telegramBot(bot: string) {
    if (typeof bot !== 'string' || !/^[1-9][0-9]{0,19}$/.test(bot)) throw Error('Invalid Telegram bot.');
    return this.ctx.exports.TelegramBot.get(this.ctx.exports.TelegramBot.idFromName(bot));
  }
  async connectTelegram(request: string, token: string, binding: string, deliveryAcknowledged: boolean) {
    const authority = await this.telegramAuthority(binding);
    if (typeof token !== 'string' || !/^[1-9][0-9]{0,19}:[A-Za-z0-9_-]{30,100}$/.test(token)) throw Error('Invalid Telegram bot credential.');
    const bot = token.split(':')[0];
    const bots = this.ctx.storage.kv.get<string[]>('telegramBots') ?? [];
    if (!bots.includes(bot)) {
      if (bots.length >= 100) throw Error('Telegram connection limit reached.');
      bots.push(bot); this.ctx.storage.kv.put('telegramBots', bots);
    }
    return this.#telegramBot(bot).configure(this.ctx.id.toString(), request, token, binding, deliveryAcknowledged, authority.epoch);
  }
  /** Called only by the human target after the source journal's owner check. */
  async telegramLocalInbox(bot:string,channel:string,after:number){
    return this.#telegramBot(bot).localInbox(this.ctx.id.toString(),channel,after);
  }
  async telegramVoiceInbox(bot:string,channel:string){
    return this.#telegramBot(bot).voiceInbox(this.ctx.id.toString(),channel);
  }
  async telegramVoiceFile(bot:string,channel:string,update:number){
    const file=await this.#telegramBot(bot).voiceFile(this.ctx.id.toString(),channel,update);
    return {request:file.request,mime:file.mime,bytes:file.bytes,sha256:file.sha256};
  }
  async telegramVoiceImportState(bot:string,channel:string,update:number):Promise<{request:string;project:string;sha256:string}|null>{
    const saved=await this.#telegramBot(bot).voiceImportState(this.ctx.id.toString(),channel,update);
    return saved?{request:saved.request,project:saved.project,sha256:saved.sha256}:null;
  }
  async completeTelegramVoiceImport(bot:string,channel:string,update:number,source:import('./telegram-voice-inbox.ts').TelegramVoiceImport){return this.#telegramBot(bot).completeVoiceImport(this.ctx.id.toString(),channel,update,source);}
  async telegramDeliveryStates(bot:string,channel:string,updates:number[]){
    return this.#telegramBot(bot).deliveryStates(this.ctx.id.toString(),channel,updates);
  }
  async listTelegram():ReturnType<TelegramManagement['listTelegram']> {
    const session=this.#account().session(),epoch=this.#account().calendarEpoch();
    try {
      await session.whoAmI();
      const bots=this.ctx.storage.kv.get<string[]>('telegramBots')??[];
      const results=await Promise.allSettled(bots.map(bot=>this.#telegramBot(bot).describe(this.ctx.id.toString())));
      await session.whoAmI();
      if(!epoch||epoch!==this.#account().calendarEpoch())throw Error('Mnemos account changed.');
      const connections:Awaited<ReturnType<TelegramManagement['listTelegram']>>['connections']=[];
      let unavailable=0;
      for(const result of results){
        if(result.status==='rejected'){unavailable++;continue;}
        const {bot,username,binding,ready,disconnected,cleanup_pending,channel_registered}=result.value;
        connections.push({bot,username,binding,ready,disconnected,cleanup_pending,channel_registered});
      }
      return {connections,unavailable};
    } finally {session.dispose();}
  }
  async describeTelegram(bot: string) { return this.#telegramBot(bot).describe(this.ctx.id.toString()); }
  async confirmTelegram(bot: string, epoch: string, sender: number) { return this.#telegramBot(bot).confirm(this.ctx.id.toString(), epoch, sender); }
  async disconnectTelegram(bot: string) { return this.#telegramBot(bot).disconnect(this.ctx.id.toString()); }
 #driveImports?:DriveImportCapture;
 #teamDocuments?:TeamDocumentCreation;
 #corporateTasks?:CorporateTaskCreation;
 #trackers?:TrackerCreation;
  #resourceMaps?: ResourceMapCreation;
  /** Mint a verifier for this account; callers cannot choose another observer. */
  async getVerifier(): Promise<Fetcher<MnemosVerifierApi>> {
    return this.ctx.exports.MnemosVerifier({ props: { userObjectId: this.ctx.id.toString() } });
  }
  /** Internal observer check; the management UI does not expose this method. */
  async canReadPublication(resourceUrl: string, eventId: string, tenantId: string): Promise<boolean> {
    return this.#account().canReadPublication(resourceUrl, eventId, tenantId);
  }
  /** Internal observer check: a live credential of the same organization. Disconnect keeps the owner but empties the token. */
  async sameTenant(tenantId: string): Promise<boolean> {
    if (typeof tenantId !== "string" || !tenantId) return false;
    const storage = this.#operationStorage();
    const record = storage.get<{ token?: string; expiresAt?: number }>('mnemosCredential');
    if (!record?.token || !(typeof record.expiresAt === 'number' && record.expiresAt > Date.now())) return false;
    return storedAccountOwner(storage)?.tenant === tenantId;
  }
  /** Trusted factory: source coordinates and organization are immutable and server verified. */
  async nativeDocumentSource(resourceUrl: string, publication: string) {
    parseDocumentResource(this.#origins().apiOrigin, resourceUrl);
    publicationIdentifier(publication);
    const identity = await this.identity();
    const tenantId = identity.subject.tenant_id;
    if (!await this.#account().canReadPublication(resourceUrl, publication, tenantId)) throw new Error("Publication access denied");
    return {
      class: this.ctx.exports.MnemosNativeDocumentSource({ props: { userObjectId: this.ctx.id.toString(), resourceUrl, publication, tenantId } }),
      sourceKey: JSON.stringify([tenantId, resourceUrl, publication]),
      resource: { urlPattern: `${new URL(this.#origins().apiOrigin).origin}/v1/projects/*/nodes/*`, title: "Документ Mnemos", description: "Одна версия нативного документа" },
    };
  }
  /** Open an owned human read capability; never exposed on the management session. */
  async openNativePublication(resourceUrl: string, publication: string) {
    const resource = parseDocumentResource(this.#origins().apiOrigin, resourceUrl);
    publicationIdentifier(publication);
    const session = this.#account().session();
    try {
      if (publication.startsWith("private:")) {
        await session.checkPrivateVersionRead(resource.projectId, resource.nodeId, publication.slice(8));
        return new RpcStub(new MnemosPrivateVersionDownload(session, resource.projectId, resource.nodeId, publication.slice(8), true));
      }
      return new RpcStub(new MnemosNativeDocumentDownload(await session.selectedDocument(resource), publication, session));
    } catch (error) { session.dispose(); throw error; }
  }
  /** Use verified account credentials for diagnostics and release the temporary session. */
  async recordUIReadiness(sample: UIReadinessSample): Promise<void> {
    const session = this.#account().session();
    try { await session.recordUIReadiness(sample); } finally { session.dispose(); }
  }
  /** Use a fresh account session for each activity sample and dispose it afterward. */
  async recordWorkspaceActivity(stream: string, sequence: number, active: boolean): Promise<void> {
    const session = this.#account().session();
    try { await session.recordWorkspaceActivity(stream, sequence, active); } finally { session.dispose(); }
  }
  /** Траты пишутся свежей сессией человека: Mnemos берёт человека из её ключа. */
  async recordSpending(entries: SpendingEntry[]): Promise<void> {
    const session = this.#account().session();
    try { await session.recordSpending(entries); } finally { session.dispose(); }
  }
  /** Save an account-owned source copy through a fresh human session. */
  async captureDriveImport(project:string,request:string,sourceKey:string,fileId:string,source:Fetcher<DriveImportSource>) {
    const session=this.#account().session();
    try {
      const identity=await session.whoAmI();
      if(identity.subject.agent_principal_id)throw new Error("Human account required.");
      const imports=this.#driveImports??=new DriveImportCapture(this.#operationStorage(),this.#origins().storageOrigin||"");
      return await imports.capture(session,{project,request,sourceKey,fileId},source,async value=>signDriveOrigin(this.env.MNEMOS_DRIVE_ORIGIN_KEY||"",{
        version:1,tenant:identity.subject.tenant_id,owner:identity.subject.user_id,project:value.input.project,request:value.input.request,upload:value.upload,expected_head:value.head,
        provider:value.origin.provider,source_binding:await driveSourceBinding(value.input.sourceKey),file:value.origin.fileId,revision:value.origin.sourceVersion,sha256:value.origin.sha256,size:value.origin.sizeBytes,
      }));
    } finally {session.dispose();}
  }
  /** Resolve the stored owner/project/request before invoking the Mnemos registration API. */
  async registerCalendarSelection(project:string,request:string,selection:string) {
    const {account,id}=splitCalendarSelection(selection);
    if(account!==this.ctx.id.toString())throw new Error("Calendar selection unavailable.");
    const session=this.#account().session();
    try {
      const identity=await session.whoAmI();
      if(identity.subject.agent_principal_id)throw new Error("Human account required.");
      await new CalendarSelections(this.#draftStorage()).resolve(id,{tenant:identity.subject.tenant_id,owner:identity.subject.user_id,project,request},()=>this.#account().calendarEpoch());
      return await session.registerCalendarConnection(project,request,selection);
    } finally {session.dispose();}
  }
  async registerMailSelection(project:string,request:string,selection:string) {
    const {account,id}=splitMailSelection(selection);
    if(account!==this.ctx.id.toString())throw new Error("Mail selection unavailable.");
    const session=this.#account().session();
    try {
      const identity=await session.whoAmI();
      if(identity.subject.agent_principal_id)throw new Error("Human account required.");
      await new MailSelections(this.#draftStorage()).resolve(id,{tenant:identity.subject.tenant_id,owner:identity.subject.user_id,project,request},()=>this.#account().calendarEpoch());
      return await session.registerMailConnection(project,request,selection);
    } finally {session.dispose();}
  }

  /** Persist a host-selected calendar under this verified Mnemos owner. */
  async acceptCalendarReadSource(project: string, request: string, sourceKey: string, source: Fetcher<CalendarReadSource>) {
    const epoch = this.#account().calendarEpoch();
    if (!epoch) throw new Error("Mnemos account unavailable.");
    const session = this.#account().session();
    try {
      const identity = await session.whoAmI();
      const subject = identity.subject;
      if (subject.agent_principal_id) throw new Error("Human account required.");
      const validate = async () => {
        if (this.#account().calendarEpoch() !== epoch) throw new Error("Mnemos account changed.");
        const current = (await session.whoAmI()).subject;
        if (current.tenant_id !== subject.tenant_id || current.user_id !== subject.user_id || current.agent_principal_id ||
            this.#account().calendarEpoch() !== epoch) throw new Error("Mnemos account changed.");
      };
      const prepared = await new CalendarSelections(this.#draftStorage()).prepare({tenant: subject.tenant_id, owner: subject.user_id, epoch},
        project, request, sourceKey, source, validate);
      return {...prepared, selection_id: this.ctx.id.toString() + "." + prepared.selection_id};
    } finally { session.dispose(); }
  }

  /** Called only by the service-authenticated calendar relay, never the management UI. */
  async resolveCalendarSelection(input: CalendarBridgeResolve): Promise<CalendarBridgeConnection> {
    const {account,id} = splitCalendarSelection(input.selection_id);
    if (account !== this.ctx.id.toString()) throw new Error("Calendar selection unavailable.");
    const record = await new CalendarSelections(this.#draftStorage()).resolve(id,
      {tenant:input.tenant_id,owner:input.owner_id,project:input.project_id,request:input.request_id},
      () => this.#account().calendarEpoch());
    return {connection_id: record.id,owner_id:record.owner,project_id:record.project,provider:record.metadata.provider,
      calendar_id:record.metadata.calendar_id,bridge_handle:input.selection_id,revision:1,enabled:true};
  }

  /** Service-only event read. Mnemos validates the current SQL grant before and after calling it. */
  async stageCalendarDraft(input:CalendarBridgeDraft){
    const {account,id}=splitCalendarSelection(input.selection_id);
    if(account!==this.ctx.id.toString())throw Error('Calendar selection unavailable.');
    return new CalendarSelections(this.#draftStorage()).stageDraft(id,input,()=>this.#account().calendarEpoch());
  }
  async #withCalendarOwner<T>(work:(owner:{tenant:string;owner:string;epoch:string},validate:(connection:string)=>Promise<void>,identity:()=>Promise<void>)=>Promise<T>){
    const session=this.#account().session(),epoch=this.#account().calendarEpoch();
    try{
      const subject=(await session.whoAmI()).subject;
      if(!epoch||subject.agent_principal_id)throw Error('Human account required.');
      const owner={tenant:subject.tenant_id,owner:subject.user_id,epoch};
      const identity=async()=>{const current=(await session.whoAmI()).subject;if(current.tenant_id!==owner.tenant||current.user_id!==owner.owner||current.agent_principal_id||this.#account().calendarEpoch()!==epoch)throw Error('Calendar drafts unavailable.');};
      const validate=async(connection:string)=>{await identity();const saved=await session.readCalendarConnection(connection);if(!saved.enabled)throw Error('Calendar connection disabled.');await new CalendarSelections(this.#draftStorage()).validateDraftConnection(connection,owner.tenant,owner.owner,()=>this.#account().calendarEpoch());await identity();};
      const result=await work(owner,validate,identity);await identity();return result;
    }finally{session.dispose();}
  }
  #imap(){return new ImapAccounts(this.#connectionStorage(),imapServers(this.env.MNEMOS_IMAP_SERVERS),()=>this.#account().calendarEpoch(),undefined,(server,credential,validate)=>new SmtpClient(server,credential,connectSmtp,validate));}
  /** Diagnostics are derived from this account's selected sources, without credentials. */
  async sourceErrors(): Promise<Array<'mail'|'calendar'|'drive'>> {
    const errors: Array<'mail'|'calendar'|'drive'> = [];
    const checks = [
      ['mail', () => this.listImapAccounts()],
      ['calendar', () => this.listCalDAVAccounts()],
      ['drive', () => this.listWebDAVAccounts()],
    ] as const;
    for (const [kind,read] of checks) {
      try { if ((await read()).accounts.some(a => !a.enabled || !!a.last_error_at)) errors.push(kind); }
      catch { errors.push(kind); }
    }
    const session = this.#account().session();
    try {
      try { if ((await session.listMailConnections("")).connections.some(c => !c.enabled || !!c.last_error_at) && !errors.includes('mail')) errors.push('mail'); } catch { if (!errors.includes('mail')) errors.push('mail'); }
      try { if ((await session.listCalendarConnections("")).connections.some(c => !c.enabled || !!c.last_error_at) && !errors.includes('calendar')) errors.push('calendar'); } catch { if (!errors.includes('calendar')) errors.push('calendar'); }
    } finally { session.dispose(); }
    return errors;
  }
  async listImapAccounts(){return this.#withCalendarOwner(async owner=>this.#imap().list(owner));}
  async connectImapAccount(input:ImapSetup){return this.#withCalendarOwner(owner=>this.#imap().connect(owner,input));}
  async removeImapAccount(id:string){return this.#withCalendarOwner(async owner=>this.#imap().remove(owner,id));}
  async listImapFolders(parent:string){
    if(parent!=='')throw Error('IMAP folder unavailable.');
    const value=await this.listImapAccounts();
    return {folders:value.accounts.filter(account=>account.enabled).map(account=>({id:account.id,name:account.username+' — '+account.mailbox,hasChildren:false})),truncated:false};
  }
  async imapReadSource(query:string){
    if(typeof query!=='string'||!query.startsWith('folder:'))throw Error('Select an IMAP folder.');
    const id=query.slice(7),selected=await this.#withCalendarOwner(async owner=>this.#imap().select(owner,id));
    const source=this.ctx.exports.MnemosImapReadSource({props:{account:this.ctx.id.toString(),mailbox:id,generation:selected.generation}});
    return {source,sourceKey:JSON.stringify([this.ctx.id.toString(),id,selected.generation]),resource:IMAP_RESOURCE};
  }
  async imapSendSource(query:string){
    if(typeof query!=='string'||!query.startsWith('folder:'))throw Error('Select an IMAP folder.');
    const id=query.slice(7),selected=await this.#withCalendarOwner(async owner=>this.#imap().select(owner,id));
    this.#imap().validateSender(id,selected.generation);
    const source=this.ctx.exports.MnemosSmtpSendSource({props:{account:this.ctx.id.toString(),mailbox:id,generation:selected.generation}});
    return {source,sourceKey:JSON.stringify([this.ctx.id.toString(),id,selected.generation]),resource:IMAP_RESOURCE};
  }
  async validateSmtpSender(id:string,generation:string){this.#imap().validateSender(id,generation);}
  async sendSmtp(id:string,generation:string,content:Parameters<MailSendSource['send']>[0]){return this.#imap().send(id,generation,content);}
  async validateImapSource(id:string,generation:string){this.#imap().validate(id,generation);}
  async imapMetadata(id:string,generation:string){return this.#imap().metadata(id,generation);}
  async readImapSelection(id:string,generation:string,input:import('@gadgets/workshop-shared/mail-search').MailReadRequest){return this.#imap().readSelection(id,generation,input);}
  #webdav(){return new WebDAVAccounts(this.#connectionStorage(),webdavServers(this.env.MNEMOS_WEBDAV_SERVERS),()=>this.#account().calendarEpoch());}
  async listWebDAVAccounts(){return this.#withCalendarOwner(async owner=>this.#webdav().list(owner));}
  async connectWebDAVAccount(input:WebDAVSetup){return this.#withCalendarOwner(owner=>this.#webdav().connect(owner,input));}
  async removeWebDAVAccount(id:string){return this.#withCalendarOwner(async owner=>this.#webdav().remove(owner,id));}
  async webdavReadSource(fileId:string){
    if(typeof fileId!=='string'||fileId.length>255||!/^[-a-f0-9]{36}:.+/.test(fileId))throw Error('Select a WebDAV account and file.');
    const id=fileId.slice(0,36),selected=await this.#withCalendarOwner(async owner=>this.#webdav().select(owner,id));
    const source=this.ctx.exports.MnemosWebDAVImportSource({props:{account:this.ctx.id.toString(),id,fileId,generation:selected.generation}});
    return {source,sourceKey:JSON.stringify([this.ctx.id.toString(),id,selected.generation,fileId]),resource:WEBDAV_RESOURCE};
  }
  async validateWebDAVSource(id:string,generation:string){this.#webdav().validate(id,generation);}
  async readWebDAVSource(id:string,generation:string,fileId:string){
    if(fileId.slice(0,37)!==id+':')throw Error('WebDAV selection changed.');
    const snapshot=await this.#webdav().read(id,generation,fileId.slice(37));return {...snapshot,fileId};
  }
  #caldav(){return new CalDAVAccounts(this.#connectionStorage(),caldavServers(this.env.MNEMOS_CALDAV_SERVERS),()=>this.#account().calendarEpoch());}
  async checkCalDAVScheduling(calendarId:string){return this.#withCalendarOwner(owner=>this.#caldav().checkScheduling(owner,calendarId));}
  async listCalDAVAccounts(){return this.#withCalendarOwner(async owner=>this.#caldav().list(owner));}
  async connectCalDAVAccount(input:CalDAVSetup){return this.#withCalendarOwner(owner=>this.#caldav().connect(owner,input));}
  async removeCalDAVAccount(id:string){return this.#withCalendarOwner(async owner=>this.#caldav().remove(owner,id));}
  async listCalDAVCalendars(){const result=await this.listCalDAVAccounts();return {calendars:result.accounts.filter(account=>account.enabled).flatMap(account=>account.calendars.map(calendar=>({id:calendar.id,name:account.username+' — '+calendar.title}))),truncated:false};}
  async #caldavSelection(id:string){return this.#withCalendarOwner(async owner=>this.#caldav().select(owner,id));}
  async caldavReadSource(id:string){
    const selected=await this.#caldavSelection(id),source=this.ctx.exports.MnemosCalDAVReadSource({props:{account:this.ctx.id.toString(),calendar:id,generation:selected.generation}});
    return {source,sourceKey:JSON.stringify([this.ctx.id.toString(),id,selected.generation]),resource:CALDAV_RESOURCE};
  }
  async caldavWriteSource(id:string){
    const selected=await this.#caldavSelection(id),source=this.ctx.exports.MnemosCalDAVWriteSource({props:{account:this.ctx.id.toString(),calendar:id,generation:selected.generation}});
    return {source,sourceKey:JSON.stringify([this.ctx.id.toString(),id,selected.generation]),resource:CALDAV_RESOURCE};
  }
  async validateCalDAVSource(id:string,generation:string){this.#caldav().validate(id,generation);}
  async caldavMetadata(id:string,generation:string){return this.#caldav().metadata(id,generation);}
  async readCalDAVWindow(id:string,generation:string,input:Parameters<CalendarReadSource['readWindow']>[0]){return this.#caldav().readWindow(id,generation,input);}
  async createCalDAVMeeting(id:string,generation:string,content:Parameters<CalendarWriteSource['create']>[0]){return this.#caldav().create(id,generation,content);}

  async listCalendarDrafts(connection:string,cursor=''){
    return this.#withCalendarOwner((owner,validate)=>listCalendarDrafts(this.ctx.storage.kv,owner,connection,cursor,()=>validate(connection)));
  }
  async #reviewCalendarDraft(id:string,decision?:{sha256:string;approved:boolean}){
    return this.#withCalendarOwner(async(owner,validate)=>{
      const drafts=new CalendarDrafts(this.#draftStorage()),shown=await drafts.read(id,owner,async()=>{});
      const check=()=>validate(shown.context.connection);await check();
      const result=decision?await drafts.decide(id,owner,decision.sha256,decision.approved,check):shown;
      await check();return calendarDraftReview(result);
    });
  }
  async readCalendarDraft(id:string){return this.#reviewCalendarDraft(id);}
  async decideCalendarDraft(id:string,sha256:string,approved:boolean){return this.#reviewCalendarDraft(id,{sha256,approved});}

  async prepareCalendarDraftCreate(id:string,sha256:string){
    return this.#withCalendarOwner(async(owner,validate)=>{
      const draft=await new CalendarDrafts(this.#draftStorage()).read(id,owner,async()=>{});
      if(draft.sha256!==sha256||draft.state!=='approved')throw Error('Approve the exact meeting before creating it.');
      await validate(draft.context.connection);
      const selected=await new CalendarSelections(this.#draftStorage()).validateDraftConnection(draft.context.connection,owner.tenant,owner.owner,()=>this.#account().calendarEpoch());
      await validate(draft.context.connection);
      return {sourceKey:selected.sourceKey,calendar_id:selected.metadata.calendar_id};
    });
  }
  async createCalendarDraft(id:string,sha256:string,sourceKey:string,source:Fetcher<CalendarWriteSource>){
    return this.#withCalendarOwner(async(owner,validate)=>{
      const drafts=new CalendarDrafts(this.#draftStorage()),draft=await drafts.read(id,owner,async()=>{});
      const check=async()=>{
        await validate(draft.context.connection);
        const selected=await new CalendarSelections(this.#draftStorage()).validateDraftConnection(draft.context.connection,owner.tenant,owner.owner,()=>this.#account().calendarEpoch());
        if(selected.sourceKey!==sourceKey)throw Error('Calendar writer changed.');
        await source.validate();await validate(draft.context.connection);
      };
      const result=await drafts.dispatch(id,owner,sha256,check,content=>source.create(content));
      if(!result.execution)throw Error('Calendar creation outcome is unconfirmed.');
      return result.execution;
    });
  }

  async readCalendarWindow(input: CalendarBridgeRead) {
    const {account,id} = splitCalendarSelection(input.selection_id);
    if (account !== this.ctx.id.toString()) throw new Error("Calendar selection unavailable.");
    return new CalendarSelections(this.#draftStorage()).readWindow(id,input,() => this.#account().calendarEpoch());
  }

  /** Persist a host-selected mail under this verified Mnemos owner. */
  async acceptMailReadSource(project: string, request: string, sourceKey: string, source: Fetcher<MailReadSource>) {
    const epoch = this.#account().calendarEpoch();
    if (!epoch) throw new Error("Mnemos account unavailable.");
    const session = this.#account().session();
    try {
      const identity = await session.whoAmI();
      const subject = identity.subject;
      if (subject.agent_principal_id) throw new Error("Human account required.");
      const validate = async () => {
        if (this.#account().calendarEpoch() !== epoch) throw new Error("Mnemos account changed.");
        const current = (await session.whoAmI()).subject;
        if (current.tenant_id !== subject.tenant_id || current.user_id !== subject.user_id || current.agent_principal_id ||
            this.#account().calendarEpoch() !== epoch) throw new Error("Mnemos account changed.");
      };
      const prepared = await new MailSelections(this.#draftStorage()).prepare({tenant: subject.tenant_id, owner: subject.user_id, epoch},
        project, request, sourceKey, source, validate);
      return {...prepared, selection_id: this.ctx.id.toString() + "." + prepared.selection_id};
    } finally { session.dispose(); }
  }

  /** Called only by the service-authenticated mail relay, never the management UI. */
  async resolveMailSelection(input: MailBridgeResolve): Promise<MailBridgeConnection> {
    const {account,id} = splitMailSelection(input.selection_id);
    if (account !== this.ctx.id.toString()) throw new Error("Mail selection unavailable.");
    const record = await new MailSelections(this.#draftStorage()).resolve(id,
      {tenant:input.tenant_id,owner:input.owner_id,project:input.project_id,request:input.request_id},
      () => this.#account().calendarEpoch());
    return {connection_id: record.id,owner_id:record.owner,project_id:record.project,provider:record.provider,
      query_sha256:record.querySHA256,bridge_handle:input.selection_id,revision:1,enabled:true};
  }

  /** Service-only event read. Mnemos validates the current SQL grant before and after calling it. */
  async #reviewMailDraft(id:string,decision?:{sha256:string;approved:boolean},send?:{sha256:string;sourceKey:string;source:Fetcher<MailSendSource>}){
    const session=this.#account().session(),epoch=this.#account().calendarEpoch();
    try{
      const subject=(await session.whoAmI()).subject;
      if(!epoch||subject.agent_principal_id)throw Error('Human account required.');
      const owner={tenant:subject.tenant_id,owner:subject.user_id,epoch};
      const identity=async()=>{
        const current=(await session.whoAmI()).subject;
        if(current.tenant_id!==owner.tenant||current.user_id!==owner.owner||current.agent_principal_id||this.#account().calendarEpoch()!==epoch)throw Error('Mail draft unavailable.');
      };
      const drafts=new MailDrafts(this.#draftStorage()),shown=await drafts.read(id,owner,identity);
      const validate=async()=>{
        await identity();
        const connection=await session.readMailConnection(shown.context.connection);
        if(!connection.enabled)throw Error('Mail connection disabled.');
        const selected=await new MailSelections(this.#draftStorage()).validateDraftConnection(shown.context.connection,owner.tenant,owner.owner,()=>this.#account().calendarEpoch());
        if(send){if(selected.sourceKey!==send.sourceKey)throw Error('Mail sender changed.');await send.source.validate();}
        await identity();
      };
      await validate();
      const result=send?await drafts.dispatch(id,owner,send.sha256,validate,({to,cc,subject,body,reply,attachments})=>send.source.send({to,...(attachments?.length?{attachments}:{}),...(cc?.length?{cc}:{}),subject,body,...(reply?{reply}:{})})):decision?await drafts.decide(id,owner,decision.sha256,decision.approved,validate):shown;
      await validate();return mailDraftReview(result);
    }finally{session.dispose();}
  }
  async prepareMailDraftSend(id:string,sha256:string){
    const shown=await this.#reviewMailDraft(id);
    if(shown.sha256!==sha256||shown.state!=='approved')throw Error('Approve the exact mail draft before sending.');
    const session=this.#account().session();
    try{
      const subject=(await session.whoAmI()).subject;
      if(subject.agent_principal_id)throw Error('Human account required.');
      const selected=await new MailSelections(this.#draftStorage()).validateDraftConnection(shown.connection_id,subject.tenant_id,subject.user_id,()=>this.#account().calendarEpoch());
      await this.#reviewMailDraft(id);
      return {sourceKey:selected.sourceKey,query:selected.query};
    }finally{session.dispose();}
  }
  async sendMailDraft(id:string,sha256:string,sourceKey:string,source:Fetcher<MailSendSource>){
    const result=await this.#reviewMailDraft(id,undefined,{sha256,sourceKey,source});
    if(!result.delivery)throw Error('Mail send outcome is unconfirmed.');
    return result.delivery;
  }
  async listMailDrafts(connection:string,cursor=''){
    const session=this.#account().session(),epoch=this.#account().calendarEpoch();
    try{
      const subject=(await session.whoAmI()).subject;
      if(!epoch||subject.agent_principal_id)throw Error('Human account required.');
      const owner={tenant:subject.tenant_id,owner:subject.user_id,epoch};
      const validate=async()=>{
        const current=(await session.whoAmI()).subject;
        if(current.tenant_id!==owner.tenant||current.user_id!==owner.owner||current.agent_principal_id||this.#account().calendarEpoch()!==epoch)throw Error('Mail drafts unavailable.');
        const saved=await session.readMailConnection(connection);
        if(!saved.enabled)throw Error('Mail connection disabled.');
        await new MailSelections(this.#draftStorage()).validateDraftConnection(connection,owner.tenant,owner.owner,()=>this.#account().calendarEpoch());
        const latest=(await session.whoAmI()).subject;
        if(latest.tenant_id!==owner.tenant||latest.user_id!==owner.owner||latest.agent_principal_id||this.#account().calendarEpoch()!==epoch)throw Error('Mail drafts unavailable.');
      };
      return await listMailDrafts(this.ctx.storage.kv,owner,connection,cursor,validate);
    }finally{session.dispose();}
  }
  async readMailDraft(id:string){return this.#reviewMailDraft(id);}
  async decideMailDraft(id:string,sha256:string,approved:boolean){return this.#reviewMailDraft(id,{sha256,approved});}

  async stageMailDraft(input:MailBridgeDraft) {
    const {account,id}=splitMailSelection(input.selection_id);
    if(account!==this.ctx.id.toString())throw Error('Mail selection unavailable.');
    return new MailSelections(this.#draftStorage()).stageDraft(id,input,()=>this.#account().calendarEpoch());
  }

  async readMailSelection(input: MailBridgeRead) {
    const {account,id} = splitMailSelection(input.selection_id);
    if (account !== this.ctx.id.toString()) throw new Error("Mail selection unavailable.");
    return new MailSelections(this.#draftStorage()).readSelection(id,input,() => this.#account().calendarEpoch());
  }

  async connectionIdentity() {
    const identity=await this.identity();
    return {...identity,connectionName:organizationAccountName(this.env.MNEMOS_API_ORIGIN,this.#origins().apiOrigin,identity.subject.tenant_id,identity.subject.user_id)};
  }
  async identity() {
    const session = this.#account().session();
    try { return await session.whoAmI(); } finally { session.dispose(); }
  }
  /** Счётчик «Входящих» для навигации: первая страница согласований и обращения человека.
   * Недочитанное или медленное не выдаётся за ноль — тогда счётчика нет. */
  async inboxCount(userId: string): Promise<number | undefined> {
    return (await this.inboxCounts(userId))?.inbox;
  }
  /** Оба счётчика меню одним чтением: «Входящие» и решения по чужой работе для «Согласований». */
  async inboxCounts(userId: string): Promise<{ inbox: number; approvals: number } | undefined> {
    const session = this.#account().session();
    const count = (async () => {
      // Шаблоны и приёмная — те же источники, что строки «Входящих»; источник, в котором человеку
      // отказано, для него пуст, а медленный — снимает весь счётчик через общий срок ниже.
      const templates = (async () => {
        const scopes = (await session.listTemplateReviewScopes("")).scopes.slice(0, INBOX_TEMPLATE_SCOPES);
        const pages = await Promise.all(scopes.map(async scope => (await session.listTemplateProposals(scope.scope_id, "").catch(() => ({ proposals: [] }))).proposals.map(review => ({ scope, review }))));
        return pages.flat();
      })().catch(() => []);
      const alerts = (async () => {
        const projects = (await session.listProjects()).projects.slice(0, INBOX_ALERT_PROJECTS);
        const pages = await Promise.all(projects.map(async project => (await session.inboxAlerts(false, project.id).catch(() => ({ alerts: [] }))).alerts.map(alert => ({ project: project.id, alert }))));
        return pages.flat();
      })().catch(() => []);
      // Запросы видимости: сервер без этой возможности или отказ — пусто, как у шаблонов.
      const shares = session.listShareRequests(false).then(page => page.requests, () => []);
      const documents = session.listSharedDocuments().catch(() => []);
      const [reviews, requests] = await Promise.all([session.listPublicationReviews(""), session.listCollaborations("")]);
      const mine = requests.requests.filter(request => request.requester_user_id === userId).slice(0, INBOX_PROGRESS_LIMIT);
      const collaborations = await Promise.all(mine.map(async request => ({ request, progress: await session.readCollaborationProgress(request.request_id).catch(() => null) })));
      return inboxCounts(reviews.reviews, collaborations, userId, { templates: await templates, alerts: await alerts, shares: await shares, documents: await documents });
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([count, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), INBOX_COUNT_MS); })]);
    } catch { return undefined; }
    finally { if (timer) clearTimeout(timer); count.catch(() => {}).finally(() => session.dispose()); }
  }
  async setCallback(callback: Fetcher<GatekeeperConnectCallback>): Promise<string> {
    if (this.ctx.storage.kv.get("workshopCallback")) throw new Error("Connection already initialized");
    this.ctx.storage.kv.put("workshopCallback", callback);
    return this.prepareBrowserLogin();
  }
  async prepareReconnect(): Promise<string> {
    if (!this.ctx.storage.kv.get("workshopCallback") || !this.ctx.storage.kv.get("workshopConnected")) throw new Error("Connection is unavailable");
    return this.prepareBrowserLogin();
  }
  #browser(): BrowserLoginBinding { return new BrowserLoginBinding(this.ctx.storage.kv); }
  /** Minted only through a trusted connection capability, never by HTTP. */
  async prepareBrowserLogin(): Promise<string> {
    LoginFlow.cancelStored(this.ctx.storage.kv);
    const nonce = this.#browser().prepare();
    await this.#alarms().schedule('login',Date.now()+300000);
    return nonce;
  }
  #origins() { return this.env.MNEMOS_LOGIN_PROFILES ? this.#profiles().origins(this.env.MNEMOS_API_ORIGIN,this.env.MNEMOS_STORAGE_ORIGIN) : {apiOrigin:this.env.MNEMOS_API_ORIGIN,storageOrigin:this.env.MNEMOS_STORAGE_ORIGIN}; }
  async nativeStorageOrigin() { return this.#origins().storageOrigin; }
  #profiles() { return new LoginProfiles(this.ctx.storage.kv,this.env.MNEMOS_LOGIN_CONFIG??'',this.env.MNEMOS_LOGIN_PROFILES); }
  async loginOrganizations(nonce:string) { this.#browser().check(nonce);return this.#profiles().choices(); }
  async startBrowserLogin(nonce: string, profile?:string, invitation?: string): Promise<{ url: string; browserNonce: string }> {
    this.#browser().check(nonce);
    this.#profiles().select(profile);
    const browserNonce = this.#browser().start(nonce);
    return { url: await this.beginLogin(invitation), browserNonce };
  }
  /** Ссылка-приглашение: адрес входа этого подключения и организация, в которую приглашают. */
  async invitationLink(code: string): Promise<string> {
    if (typeof code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error("Invalid invitation");
    const callback = new URL(this.#profiles().config().callbackUrl);
    const link = new URL(callback.pathname.replace(/\/$/, "") + "/invite/" + code, callback.origin);
    if (this.env.MNEMOS_LOGIN_PROFILES) link.searchParams.set("organization", this.#profiles().current());
    return link.href;
  }
  async completeBrowserLogin(nonce: string, state: string, code: string): Promise<void> {
    this.#browser().complete(nonce);
    const epoch = this.ctx.storage.kv.get<string>("loginRevocationEpoch");
    const expiresAt = await this.completeLogin(state, code);
    if (this.ctx.storage.kv.get<string>("loginRevocationEpoch") !== epoch) throw new Error("Mnemos login cancelled");
    const callback = this.ctx.storage.kv.get<Fetcher<GatekeeperConnectCallback>>("workshopCallback");
    if (callback) {
      try {
        if (this.ctx.storage.kv.get("workshopConnected")) await callback.credentialsRestored(new Date(expiresAt));
        else await callback.complete(this.ctx.exports.GatekeeperUserImpl({ props: { userObjectId: this.ctx.id.toString() } }), new Date(expiresAt));
        if (this.ctx.storage.kv.get<string>("loginRevocationEpoch") !== epoch) throw new Error("Mnemos login cancelled");
        this.ctx.storage.kv.put("workshopConnected", true);
      } catch {
        this.#disconnectAccount();
        throw new Error("CloudflareOS connection could not be confirmed");
      }
    }
    await this.#alarms().clear('login');
  }
  async authenticatedEmail(): Promise<string | null> { return this.ctx.storage.kv.get<string>(AUTHENTICATED_EMAIL) ?? null; }
  #disconnectAccount(){
    this.ctx.storage.kv.delete(AUTHENTICATED_EMAIL);
    this.#account().disconnect();
    for(const prefix of ['caldavAccount','imapAccount']){
      for(const [key] of [...this.ctx.storage.kv.list({prefix})])this.ctx.storage.kv.delete(key);
    }
  }
  async alarm(): Promise<void> {
    const deadlines=this.#alarms();
    if(deadlines.due('login')){
      this.ctx.storage.kv.put("loginRevocationEpoch", crypto.randomUUID());
      if (!this.ctx.storage.kv.get("workshopConnected")) {
        this.ctx.storage.kv.delete("workshopCallback");
        this.#disconnectAccount();
      }
      this.#browser().cancel();
      LoginFlow.cancelStored(this.ctx.storage.kv);
      await deadlines.clear('login');
    }
    if(deadlines.due('workspace')){
      // Обновление ключа само переставляет будильник; сбой повторяется через минуту, раньше срока ключа.
      try{await this.#workspace().refresh();}catch{await deadlines.reschedule('workspace',Date.now()+60000);}
    }
    if(deadlines.due('audit')){
      await deadlines.reschedule('audit',Date.now()+60000);
      try{const queue=this.#auditQueue(),connections=this.#connectionAuditQueue();await queue.drain();await connections.drain();if(!queue.hasPending()&&!connections.hasPending())await deadlines.clear('audit');}
      catch{await deadlines.schedule('audit',Date.now()+60000);}
    }
  }

  #login(): LoginFlow {
    // Secret binding configured by the operator; never browser-supplied settings.
    let config: LoginConfig;
    try { config = this.#profiles().config(); }
    catch { throw new Error("Mnemos login is not configured"); }
    return new LoginFlow(this.ctx.storage.kv, config);
  }
  /** Trusted connector entry only; the human iframe receives no login methods. */
  async beginLogin(invitation?: string): Promise<string> { return this.#login().begin(invitation); }
  /** Consume the provider proof and install its short-lived human credential.
   * No bearer credential crosses the return boundary. */
  async completeLogin(state: string, code: string): Promise<number> {
    const epoch = this.ctx.storage.kv.get<string>("loginRevocationEpoch");
    const credential = await this.#login().complete(state, code);
    if (this.ctx.storage.kv.get<string>("loginRevocationEpoch") !== epoch) throw new Error("Mnemos login cancelled");
    if (credential.email) this.ctx.storage.kv.put(AUTHENTICATED_EMAIL, credential.email);
    else this.ctx.storage.kv.delete(AUTHENTICATED_EMAIL);
    // connect also fences revocation during its identity verification request.
    await this.#account().connect(credential.token, credential.expiresAt);
    return credential.expiresAt;
  }
  #account(): MnemosAccount {
    return new MnemosAccount(this.#operationStorage(), this.#origins().apiOrigin);
  }
  // Only the trusted server connection flow may call this after authenticating
  // the intended owner. Never forward an iframe-supplied token here.
  async acceptVerifiedCredential(token: string, expiresAt?: number): Promise<void> {
    await this.#account().connect(token, expiresAt);
  }
  async openManagementSession(): Promise<RpcStub<MnemosManagementSession>> {
    return new RpcStub(new MnemosManagementSession(this.#account().session(),this.#teamDocuments??=new TeamDocumentCreation(this.#operationStorage(),this.#origins().storageOrigin||""),this.#trackers??=new TrackerCreation(this.#operationStorage(),this.#origins().storageOrigin||""),new TrackerEdits(this.#operationStorage()),this.#resourceMaps??=new ResourceMapCreation(this.#operationStorage(),this.#origins().storageOrigin||""),new ResourceMapEdits(this.#operationStorage()),this.#corporateTasks??=new CorporateTaskCreation(this.#operationStorage(),this.#origins().storageOrigin||""),this.ctx.exports.UserAccount.get(this.ctx.id),this.#voiceTransfer??=new VoiceTransfer(this.#operationStorage(),this.#origins().storageOrigin||"")));
  }
  async startAppUi() {
    const storageOrigin = this.#origins().storageOrigin;
    if (storageOrigin) {
      const url = new URL(storageOrigin);
      if (url.protocol !== "https:" || url.origin !== storageOrigin) throw new Error("Invalid storage origin");
    }
    return { ...(storageOrigin ? { blueprintTemplates: { storageOrigin, selector: new RpcStub(new BlueprintTemplates(this.#account().session(), this.#operationStorage())) } } : {}), iframeHtml: APP_HTML, ui: await this.openManagementSession(),
      organizationMetrics: new RpcStub(new MnemosOrganizationMetrics(this.#account().session(),this.#origins().apiOrigin)),
      agentConsent: new RpcStub(new MnemosAgentConsent(this.#account().session())),
      ...(storageOrigin ? { nativeWrites: { storageOrigin, selector: new RpcStub(new NativeWriteSelector(this.#account().session(), new NativeCreationRecovery(this.#connectionStorage()),new OfficeUpdateRecovery(this.#connectionStorage()),this.#driveImports??=new DriveImportCapture(this.#operationStorage(),storageOrigin))) } } : {}),
      ...(storageOrigin ? { nativeDownloads: { storageOrigin, selector: new RpcStub(new MnemosNativeDocumentSelector(this.#account().session(), this.#origins().apiOrigin)) } } : {}),
      ...(storageOrigin ? { inboxUploads: {storageOrigin,issuer:new RpcStub(new MnemosInboxUploadIssuer(this.#account().session()))}, reviewDownloads: { storageOrigin, issuer: new RpcStub(new MnemosReviewDownloadIssuer(this.#account().session())) }, textDownloads: { storageOrigin, issuer: new RpcStub(new MnemosTextDownloadIssuer(this.#account().session())) }, textUploads: { storageOrigin, issuer: new RpcStub(new MnemosTextUploadIssuer(this.#account().session())) } } : {}) };

  }
  /** Связь синглтона Workshop (S15): имя агента для описания действия; связь заводится при первом обращении. */
  async workshopAgent(): Promise<{ connectionName: string }> {
    const agent = await this.#account().ensureWorkshopAgent(this.ctx.id.toString(), WORKSHOP_AGENT_NAME);
    return { connectionName: agent.connectionName };
  }
  /** Путь записи черновика под агентским credential; bearer человека сюда не попадает. */
  async startWorkshopAgent() {
    const storageOrigin = this.#origins().storageOrigin;
    if (storageOrigin) {
      const url = new URL(storageOrigin);
      if (url.protocol !== "https:" || url.origin !== storageOrigin) throw new Error("Invalid storage origin");
    }
    const agent = await this.#account().ensureWorkshopAgent(this.ctx.id.toString(), WORKSHOP_AGENT_NAME);
    return { connectionName: agent.connectionName, bindingId: agent.bindingId, personal: new RpcStub(new MnemosAgentPersonalReader(this.#account().agentSession())), admin: new RpcStub(new MnemosAgentAdministration(this.#account().agentSession(), agent.bindingId)), ui: new RpcStub(new MnemosAgentDraftWriter(this.#account().agentSession())),
      ...(storageOrigin ? { textDownloads: { storageOrigin, issuer: new RpcStub(new MnemosTextDownloadIssuer(this.#account().agentSession())) }, textUploads: { storageOrigin, issuer: new RpcStub(new MnemosTextUploadIssuer(this.#account().agentSession())) } } : {}) };
  }
  /** Только доверенный callback очереди подтверждений; в агентскую сессию этот метод не передаётся. */
  async decideWorkshopAdmin(binding: string, operation: string, phase: "approve" | "reject", request: import("./admin-operations.ts").AdminOperationRequest) {
    const session = this.#account().session();
    try { return await session.workshopAdminOperation(binding, operation, phase, request); }
    finally { session.dispose(); }
  }
  async revoke(): Promise<void> {
    this.ctx.storage.kv.delete("workshopCallback");
    this.#browser().cancel();
    this.ctx.storage.kv.put("loginRevocationEpoch", crypto.randomUUID());
    // Cancel pending proofs even when login configuration has been removed.
    LoginFlow.cancelStored(this.ctx.storage.kv);
    // Связь Workshop отзывается до отключения, пока credential человека ещё принимается сервером.
    // Потеря ответа не страшна: кэш агента уже очищен, а новый credential без человека не выпустить.
    try { await this.#account().revokeWorkshopAgent(); } catch { /* связь на сервере доживёт до переподключения */ }
    this.#disconnectAccount();
    const results = await Promise.allSettled((this.ctx.storage.kv.get<string[]>('telegramBots') ?? [])
      .map(bot => this.#telegramBot(bot).revokeAccount(this.ctx.id.toString())));
    if (results.some(result => result.status === 'rejected')) throw Error('Account disconnected; retry to confirm Telegram cleanup.');
  }
  /** Ящики, календари, диск и Telegram хранятся в самом аккаунте, а не на сервере: действиям они
   * нужны рядом с методами сессии. Методы сессии привязываются к ней из-за приватных полей. */
  #withSources(session: MnemosAccountSession) {
    const own: Record<string, (...args: never[]) => unknown> = {
      listImapAccounts: () => this.listImapAccounts(), removeImapAccount: (id: string) => this.removeImapAccount(id),
      listCalDAVAccounts: () => this.listCalDAVAccounts(), removeCalDAVAccount: (id: string) => this.removeCalDAVAccount(id),
      listWebDAVAccounts: () => this.listWebDAVAccounts(), removeWebDAVAccount: (id: string) => this.removeWebDAVAccount(id),
      listTelegram: () => this.listTelegram(), disconnectTelegram: (bot: string) => this.disconnectTelegram(bot),
    };
    return new Proxy(session, { get: (target, key, receiver) => {
      if (typeof key === "string" && Object.hasOwn(own, key)) return own[key];
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    } }) as unknown as ExtraActionSession;
  }
  /** Действие агента беседы (agent-actions.ts): подготовка сессией человека; область агента — проекты его связи.
   * Вызывает только MnemosLibrary; во фрейм управления и в сессию агента метод не передаётся. */
  async prepareAgentAction(input: AgentActionRequest) {
    const request = checkedAgentAction(input);
    let agent: { bindingId: string };
    try { agent = await this.#account().ensureWorkshopAgent(this.ctx.id.toString(), WORKSHOP_AGENT_NAME); }
    catch (error) { throw agentActionError(error); }
    const session = this.#account().session();
    try {
      const scope = await session.readWorkshopAgentScope(agent.bindingId);
      if (scope.revoked) throw new MnemosAPIError(401);
      return await prepareAgentAction(this.#withSources(session), new Set(scope.project_ids), request);
    } catch (error) { throw agentActionError(error); }
    finally { session.dispose(); }
  }
  /** Выполнение после подтверждения человеком карточкой: вызывается только из applyAction очереди подтверждений. */
  async executeAgentAction(kind: AgentActionKind, resolved: PreparedAgentAction["resolved"]) {
    const session = this.#account().session();
    try { return await executeAgentAction(this.#withSources(session), kind, resolved); }
    catch (error) { throw agentActionError(error); }
    finally { session.dispose(); }
  }
  async readForAgent(input: AgentReadRequest) {
    const session = this.#account().session();
    try { return await readForAgent(this.#withSources(session), checkedAgentRead(input)); }
    catch (error) { throw agentActionError(error); }
    finally { session.dispose(); }
  }
}

/** One immutable publication imported by a human; it never lends their account to an agent. */
export class MnemosNativeDocumentSource extends DurableObject<Env, {
  userObjectId: string; resourceUrl: string; publication: string; tenantId: string;
}> implements NativeDocumentSource {
  async describe() {
    return { url: this.ctx.props.resourceUrl, title: "Документ Mnemos", snippet: "Источник опубликованного документа",
      suggestedBindingName: "MNEMOS_SOURCE", tsType: "never" };
  }
  async getTypeScriptTypes() { return ""; }
  async getAutoApprovableActions() { return []; }
  async startSession(): Promise<never> { throw new Error("This source is for an explicit human import, not an agent session."); }
  async applyAction(): Promise<void> { throw new Error("Read-only source"); }
  async rejectAction(): Promise<void> { throw new Error("Read-only source"); }
  async revertAction(): Promise<void> { throw new Error("Read-only source"); }
  #observers() { return this.ctx.storage.kv.get<Map<string, Fetcher<MnemosVerifierApi>>>("observers") ?? new Map(); }
  async addObserver(id: string, user: Fetcher<GatekeeperUserVerifier>): Promise<void> {
    const verifier = user as Fetcher<MnemosVerifierApi>;
    const { resourceUrl, publication, tenantId } = this.ctx.props;
    if (!await verifier.canReadPublication(resourceUrl, publication, tenantId)) throw new Error("Publication access denied");
    const observers = this.#observers(); observers.set(id, verifier); this.ctx.storage.kv.put("observers", observers);
  }
  async removeObserver(id: string): Promise<void> {
    const observers = this.#observers(); observers.delete(id); this.ctx.storage.kv.put("observers", observers);
  }
  async #authorize(authorizer: RpcStub<ObservationAuthorizer>): Promise<void> {
    const { resourceUrl, publication, tenantId } = this.ctx.props;
    const excluded: string[] = [];
    for (const [id, verifier] of this.#observers()) {
      if (!await verifier.canReadPublication(resourceUrl, publication, tenantId)) excluded.push(id);
    }
    await authorizer.authorizeObservation({ title: "Открыть документ Mnemos", description: "Чтение выбранной публикации нативного документа.", excludeObservers: excluded });
  }
  async openDocument(authorizer: RpcStub<ObservationAuthorizer>) {
    const storageOrigin = await this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(this.ctx.props.userObjectId)).nativeStorageOrigin();
    if (!storageOrigin || new URL(storageOrigin).protocol !== "https:" || new URL(storageOrigin).origin !== storageOrigin) throw new Error("Invalid storage origin");
    // RPC arguments are released on return; retain the authorizer for issue/validate calls.
    authorizer = authorizer.dup();
    try {
      await this.#authorize(authorizer);
      const account = this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(this.ctx.props.userObjectId));
      const download = await account.openNativePublication(this.ctx.props.resourceUrl, this.ctx.props.publication);
      return { storageOrigin, download: new RpcStub(new ObservedNativeDownload(download, () => this.#authorize(authorizer), () => authorizer[Symbol.dispose]())) };
    } catch (error) { authorizer[Symbol.dispose](); throw error; }
  }
}

/** Recheck observer rights before issuing data and after the host has transferred the body. */
class ObservedNativeDownload extends RpcTarget {
  #download: Awaited<ReturnType<DurableObjectStub<UserAccount>["openNativePublication"]>>;
  #authorize: () => Promise<void>;
  #dispose: () => void;
  constructor(download: Awaited<ReturnType<DurableObjectStub<UserAccount>["openNativePublication"]>>, authorize: () => Promise<void>, dispose: () => void) {
    super(); this.#download = download; this.#authorize = authorize; this.#dispose = dispose;
  }
  async issue() { await this.#authorize(); return this.#download.issue(); }
  async validate() { await this.#download.validate(); await this.#authorize(); }
  [Symbol.dispose](): void { this.#download[Symbol.dispose](); this.#dispose(); }
}

/** Human host selector; no account or agent authority is returned to a gadget. */
class MnemosNativeDocumentSelector extends RpcTarget {
  #session: MnemosAccountSession;
  #origin: string;
  constructor(session: MnemosAccountSession, origin: string) { super(); this.#session = session; this.#origin = origin; }
  async selectReview(review: string, node: string, version: number, side: "before" | "after", format: NativeDocumentFormat) {
    if ((side !== "before" && side !== "after") || (!isNativeDocumentFormat(format))) throw new MnemosAPIError(400);
    await this.#session.validateReviewDownload(review, node, version);
    const session = this.#session;
    return new RpcStub(new class extends RpcTarget {
      async issue() { return session.beginNativeReviewDownload(review, node, version, side, format); }
      async validate() { await session.validateReviewDownload(review, node, version); }
    }());
  }
  async scopes() {
    return { scopes: (await this.#session.listProjects()).projects.map(p => ({ id: p.id, name: p.name })) };
  }
  async documents(project: string, cursor: string) { return listNativeDocuments(this.#session, project, cursor); }
  async publications(project: string, node: string, cursor: string) {
    const resourceUrl = documentResourceUrl(this.#origin, { projectId: project, nodeId: node });
    const formatOf = (mime: string) => mime === "application/vnd.cloudflareos.document+json" ? "cloudflareos.document" as const : mime === "application/vnd.cloudflareos.spreadsheet+json" ? "cloudflareos.spreadsheet" as const : mime === "application/vnd.cloudflareos.presentation+json" ? "cloudflareos.presentation" as const : null;
    const privateVersions: {id: string; recordedAt: string; actor: string; author?: string; recordedBy?: {actor: string; onBehalfOf: string}; format: "cloudflareos.document" | "cloudflareos.spreadsheet" | "cloudflareos.presentation"}[] = [];
    let privateNext='';let historyLimited=false;
    if(!cursor||cursor.startsWith('private-history:')){
      const history=await this.#session.listPrivateVersions(project,node,cursor.startsWith('private-history:')?cursor.slice(16):'');
      historyLimited=history.limited??false;
      for(const version of history.versions){const format=formatOf(version.content_type);if(format)privateVersions.push({id:`private:${version.head}`,recordedAt:version.recorded_at,actor:'',...(typeof version.author_name==='string'&&version.author_name.length<=255?{author:version.author_name}:{}),format});}
      privateNext=history.next_cursor?'private-history:'+history.next_cursor:'';
    }
    if (!cursor) {
      try{const current=await this.#session.readDraftDocument(project,node);const shown=privateVersions.find(v=>v.id===`private:${current.head}`);if(shown&&current.recorded_by)shown.recordedBy={actor:current.recorded_by.actor,onBehalfOf:current.recorded_by.on_behalf_of};}catch(error){if(!(error instanceof MnemosAPIError&&[403,404].includes(error.status)))throw error;}
      const invited = await this.#session.listInvitedDocuments(project, "", node);
      for (const version of invited.documents) {
        const format = formatOf(version.content_type);
        if (format && !privateVersions.some(v => v.id === `private:${version.head}`)) {
          await this.#session.checkPrivateVersionRead(project, node, version.head);
          privateVersions.push({id: `private:${version.head}`, recordedAt: "", actor: version.owner_id, format});
        }
      }
    }
    if(privateNext)return {resourceUrl,publications:privateVersions,nextCursor:privateNext,historyLimited};
    if(cursor.startsWith('private-history:'))return {resourceUrl,publications:privateVersions,nextCursor:'published-history:',historyLimited};
    if(cursor==='published-history:')cursor='';
    try {
      const page = await this.#session.nodeHistory(project, node, cursor, 50);
      return { resourceUrl, historyLimited, ...(!cursor && page.events.length ? { sharedDeleted: !page.events[0].exists } : {}), publications: [...privateVersions, ...page.events.flatMap(event => {
        const format = formatOf(event.content_type || "");
        return event.exists && format ? [{ id: event.event_id, recordedAt: event.recorded_at, actor: event.actor, onBehalfOf: event.on_behalf_of, format }] : [];
      })], nextCursor: page.next_cursor || "" };
    } catch (error) {
      if ((privateVersions.length||cursor==='') && error instanceof MnemosAPIError && [403, 404].includes(error.status)) return {resourceUrl, publications: privateVersions, nextCursor: "", historyLimited};
      throw error;
    }
  }
  async select(projectId: string, nodeId: string, publication: string) {
    if (typeof publication !== "string" || !publication || publication.length > 255 ||
        publication === "." || publication === ".." || /[\\/\u0000-\u0020\u007f]/u.test(publication)) throw new Error("Invalid publication");
    if (publication.startsWith("private:")) {
      await this.#session.checkPrivateVersionRead(projectId, nodeId, publication.slice(8));
      return new RpcStub(new MnemosPrivateVersionDownload(this.#session, projectId, nodeId, publication.slice(8)));
    }
    const reader = await this.#session.selectedDocument({ projectId, nodeId });
    return new RpcStub(new MnemosNativeDocumentDownload(reader, publication));
  }
  [Symbol.dispose](): void { this.#session.dispose(); }
}

/** Immutable selection; neither method accepts a replacement document or version. */
class MnemosNativeDocumentDownload extends RpcTarget {
  #reader: SelectedDocumentReader;
  #publication: string;
  #ownedSession?: MnemosAccountSession;
  constructor(reader: SelectedDocumentReader, publication: string, ownedSession?: MnemosAccountSession) {
    super(); this.#reader = reader; this.#publication = publication; this.#ownedSession = ownedSession;
  }
  [Symbol.dispose](): void { this.#ownedSession?.dispose(); }
  async issue() {
    const ticket = await this.#reader.publicationTicket(this.#publication);
    return { url: ticket.url, method: ticket.method, size_bytes: ticket.size_bytes,
      sha256_hex: ticket.sha256_hex, content_type: ticket.content_type };
  }
  async validate(): Promise<void> { await this.#reader.validateRead(); }
}

/** Имя связи агента: под ним запись видна в авторстве личного черновика (S14). */
const WORKSHOP_AGENT_NAME = "Агент Workshop";
/** Счётчик «Входящих» не должен задерживать описание аккаунта. */
const INBOX_COUNT_MS = 1500;
const INBOX_PROGRESS_LIMIT = 20;
const INBOX_TEMPLATE_SCOPES = 5;
const INBOX_ALERT_PROJECTS = 10;

/** Административные операции синглтона под агентским credential; чтения публикаций здесь нет. */
class MnemosAgentAdministration extends RpcTarget {
  #session: MnemosAccountSession;
  #binding: string;
  constructor(session: MnemosAccountSession, binding: string) { super(); this.#session = session; this.#binding = binding; }
  async prepare(operation: string, request: import("./admin-operations.ts").AdminOperationRequest) { return this.#session.workshopAdminOperation(this.#binding, operation, "prepare", request); }
  async execute(operation: string, request: import("./admin-operations.ts").AdminOperationRequest) { return this.#session.workshopAdminOperation(this.#binding, operation, "execute", request); }
  [Symbol.dispose](): void { this.#session.dispose(); }
}

class MnemosAgentPersonalReader extends RpcTarget {
  #session: MnemosAccountSession;
  constructor(session: MnemosAccountSession) { super(); this.#session = session; }
  async list(project: string, cursor: string) { return this.#session.listPrivateDocuments(project, cursor); }
  async read(project: string, node: string) { return this.#session.readDraftDocument(project, node); }
  [Symbol.dispose](): void { this.#session.dispose(); }
}

class MnemosAgentDraftWriter extends RpcTarget {
  async createPrivateDocument(project: string, request: import("./mnemos-api.ts").PrivateDocumentCreate) { return this.#session.createPrivateDocument(project,request); }
  #session: MnemosAccountSession;
  constructor(session: MnemosAccountSession) { super(); this.#session = session; }
  async draftState(projectId: string) { return this.#session.draftState(projectId); }
  async openDraft(projectId: string) { return this.#session.openDraft(projectId); }
  async saveDraftDocument(projectId: string, nodeId: string, uploadId: string, expectedHead: string) {
    return this.#session.saveDraftDocument(projectId, nodeId, uploadId, expectedHead);
  }
  /** Публикация и запрос согласования агента беседы: в аудите actor — агент, on_behalf_of — человек (ADR 0010). */
  async requestPublicationReview(projectId: string, personalHead: string, sharedHead: string) { return this.#session.requestPublicationReview(projectId, personalHead, sharedHead); }
  async publishDraft(projectId: string, expectedHead: string, sharedHead: string, message: string) { return this.#session.publishDraft(projectId, expectedHead, sharedHead, message); }
  [Symbol.dispose](): void { this.#session.dispose(); }
}

/** Host-only issuer. Never put this capability inside the iframe's ui object. */
class MnemosInboxUploadIssuer extends RpcTarget {
  #session: MnemosAccountSession;
  constructor(session: MnemosAccountSession) {super();this.#session=session;}
  async issue(size:number,checksum:string,project?:string) {return project ? this.#session.beginProjectUpload(project,size,checksum) : this.#session.beginInboxUpload(size,checksum);}
  async submit(uploadId:string,sourcePath:string,modifiedAt:number,project?:string) {return project ? this.#session.submitProjectUpload(project,uploadId,sourcePath,modifiedAt) : this.#session.submitInboxUpload(uploadId,sourcePath,modifiedAt);}
  [Symbol.dispose]():void {this.#session.dispose();}
}

class MnemosTextUploadIssuer extends RpcTarget {
  #session: MnemosAccountSession;
  constructor(session: MnemosAccountSession) { super(); this.#session = session; }
  async issue(projectId: string, size: number, checksum: string) {
    if (typeof projectId !== "string" || !projectId || projectId.length > 255) throw new Error("Invalid project");
    return this.#session.beginTextUpload(projectId, size, checksum);
  }
  [Symbol.dispose](): void { this.#session.dispose(); }
}

/** Host-only download authority bound to the human account's generation. */
class MnemosTextDownloadIssuer extends RpcTarget {
  #session: MnemosAccountSession;
  constructor(session: MnemosAccountSession) { super(); this.#session = session; }
  async issue(projectId: string, nodeId: string, version: string, side: number) {
    if(version.startsWith("private:")){
      if(side!==0)throw new Error("Invalid private version side");
      return this.#session.downloadPrivateVersion(projectId,nodeId,version.slice(8));
    }
    if(version.startsWith("tracker-invitation:")){
      if(side!==0)throw new Error("Invalid tracker side");
      return this.#session.downloadInvitedTracker(projectId,nodeId,version.slice(19));
    }
    if(version.startsWith("template-baseline:")){
      if(side!==0)throw new Error("Invalid template side");
      const {source,ticket}=await this.#session.beginTemplateProposalBaselineDownload(version.slice(18));
      if(source.project_id!==projectId||source.node_id!==nodeId)throw new Error("Template source mismatch");
      return ticket;
    }
    if(version.startsWith("template-proposal:")){
      if(side!==0)throw new Error("Invalid template source side");
      const {source,ticket}=await this.#session.beginTemplateProposalDownload(version.slice(18));
      if(source.source.project_id!==projectId||source.source.node_id!==nodeId)throw new Error("Template source mismatch");
      return ticket;
    }

    if (version.startsWith("publication:")) {
      if (side !== 0) throw new Error("Invalid publication side");
      return this.#session.beginPublicationTextDownload(projectId, nodeId, version.slice(12));
    }
    return this.#session.beginDraftDownload(projectId, nodeId, version, side);
  }
  async validate(projectId: string, nodeId: string, version: string): Promise<void> {
    if(version.startsWith("private:")){
      await this.#session.checkPrivateVersionRead(projectId,nodeId,version.slice(8));return;
    }
    if(version.startsWith("tracker-invitation:")){
      await this.#session.validateInvitedTracker(projectId,nodeId,version.slice(19));return;
    }
    if(version.startsWith("template-baseline:")){
      const source=await this.#session.readTemplateProposalBaseline(version.slice(18));
      if(!source||source.project_id!==projectId||source.node_id!==nodeId)throw new Error("Template source mismatch");
      return;
    }
    if(version.startsWith("template-proposal:")){
      const source=await this.#session.readTemplateProposalSource(version.slice(18));
      if(source.source.project_id!==projectId||source.source.node_id!==nodeId)throw new Error("Template source mismatch");
      return;
    }

    if (version.startsWith("publication:")) {
      await this.#session.validatePublicationTextDownload(projectId, nodeId);
      return;
    }
    const document = await this.#session.readDraftDocument(projectId, nodeId);
    if (document.head !== version || !document.exists) throw new Error("Document version changed");
  }
  [Symbol.dispose](): void { this.#session.dispose(); }
}

/** Host-only authority for a specific reviewed document side. */
class MnemosReviewDownloadIssuer extends RpcTarget {
  #session: MnemosAccountSession;
  constructor(session: MnemosAccountSession) { super(); this.#session = session; }
  async issue(review: string, node: string, version: number, side: "before" | "after") { return this.#session.beginReviewDownload(review, node, version, side); }
  async validate(review: string, node: string, version: number) { return this.#session.validateReviewDownload(review, node, version); }
  [Symbol.dispose](): void { this.#session.dispose(); }
}

/** Human management capability; not returned by any agent resource method. */
/** This capability is retained by the host; the embedded app cannot approve agents. */
class MnemosOrganizationMetrics extends RpcTarget {
  #session: MnemosAccountSession;
  #origin: string;
  constructor(session: MnemosAccountSession, origin: string) { super(); this.#session=session;this.#origin=new URL(origin).origin; }
  async read() { return this.#session.readOrganizationMetrics(this.#origin); }
  [Symbol.dispose](): void { this.#session.dispose(); }
}

class MnemosAgentConsent extends RpcTarget {
  #session: MnemosAccountSession;
  constructor(session: MnemosAccountSession) { super(); this.#session = session; }
  async preview(request: string) {
    const identity = await this.#session.whoAmI();
    const preview = await this.#session.previewAgentConsent(request);
    // Человеку показывается организация, а не внутренние идентификаторы.
    return { ...preview, account: identity.tenant_name || "Mnemos" };
  }
  /** projectIds — отмеченные человеком проекты; без него агент получает все показанные. */
  async decide(selection: string, approved: boolean, projectIds?: string[]) { return this.#session.decideAgentConsent(selection, approved, projectIds); }
  [Symbol.dispose](): void { this.#session.dispose(); }
}

class MnemosManagementSession extends RpcTarget implements TeamDocumentManagement, TelegramManagement, VoiceManagement {
  async createProject(...args:Parameters<MnemosAccountSession["createProject"]>) { return this.#session.createProject(...args); }
  async readWorkshopAgentScope(...args:Parameters<MnemosAccountSession["readWorkshopAgentScope"]>) { return this.#session.readWorkshopAgentScope(...args); }
  async updateWorkshopAgentScope(...args:Parameters<MnemosAccountSession["updateWorkshopAgentScope"]>) { return this.#session.updateWorkshopAgentScope(...args); }

  async saveProjectSignalAssessment(...args:Parameters<MnemosAccountSession['saveProjectSignalAssessment']>){return this.#session.saveProjectSignalAssessment(...args);}
  async readPublishedProjectSignals(...args:Parameters<MnemosAccountSession['readPublishedProjectSignals']>){return this.#session.readPublishedProjectSignals(...args);}
  async publishProjectSignals(...args:Parameters<MnemosAccountSession['publishProjectSignals']>){return this.#session.publishProjectSignals(...args);}
  async readProjectSignalAssessment(...args:Parameters<MnemosAccountSession['readProjectSignalAssessment']>){return this.#session.readProjectSignalAssessment(...args);}
  async assessProjectSignals(...args:Parameters<MnemosAccountSession['assessProjectSignals']>){return this.#session.assessProjectSignals(...args);}
  async prepareVoiceCommand(...args:Parameters<MnemosAccountSession['prepareVoiceCommand']>){return this.#session.prepareVoiceCommand(...args);}
  async prepareVoiceCommandBudget(source:string,confirmation:string,binding:string,criteria:string,limit:string){if(!this.#voiceTransfer)throw Error('Voice unavailable.');return this.#voiceTransfer.prepareCommandBudget(this.#session,source,confirmation,binding,criteria,limit);}
  async resumeVoiceCommandBudget(source:string){if(!this.#voiceTransfer)throw Error('Voice unavailable.');return this.#voiceTransfer.resumeCommandBudget(this.#session,source);}
  async prepareVoiceTranscription(source:string,revision:number,binding:string,limit:string){if(!this.#voiceTransfer)throw Error('Voice unavailable.');return this.#voiceTransfer.prepareTranscription(this.#session,source,revision,binding,limit);}
  async resumeVoiceTranscription(source:string,revision:number){if(!this.#voiceTransfer)throw Error('Voice unavailable.');return this.#voiceTransfer.resumeTranscription(this.#session,source,revision);}
  async uploadVoice(request:string,project:string,mime:string,bytes:Uint8Array){if(!this.#voiceTransfer)throw Error('Voice unavailable.');return this.#voiceTransfer.upload(this.#session,request,project,mime,bytes);}
  async readVoiceAudio(source:import('./voice-contract.ts').VoiceSource){if(!this.#voiceTransfer)throw Error('Voice unavailable.');return this.#voiceTransfer.read(this.#session,source);}
  async beginVoiceUpload(...args:Parameters<MnemosAccountSession['beginVoiceUpload']>){return this.#session.beginVoiceUpload(...args);}
  async downloadVoiceSource(...args:Parameters<MnemosAccountSession['downloadVoiceSource']>){return this.#session.downloadVoiceSource(...args);}
  async importVoiceSource(...args:Parameters<MnemosAccountSession['importVoiceSource']>){return this.#session.importVoiceSource(...args);}
  async readVoiceSource(...args:Parameters<MnemosAccountSession['readVoiceSource']>){return this.#session.readVoiceSource(...args);}
  async readVoiceTranscript(...args:Parameters<MnemosAccountSession['readVoiceTranscript']>){return this.#session.readVoiceTranscript(...args);}
  async editVoiceTranscript(...args:Parameters<MnemosAccountSession['editVoiceTranscript']>){return this.#session.editVoiceTranscript(...args);}
  async confirmVoiceTranscript(...args:Parameters<MnemosAccountSession['confirmVoiceTranscript']>){return this.#session.confirmVoiceTranscript(...args);}
  async readVoiceConfirmation(...args:Parameters<MnemosAccountSession['readVoiceConfirmation']>){return this.#session.readVoiceConfirmation(...args);}
  async readTelegramBudget(...args:Parameters<MnemosAccountSession['readTelegramBudget']>){return this.#session.readTelegramBudget(...args);}
  async setTelegramBudget(...args:Parameters<MnemosAccountSession['setTelegramBudget']>){return this.#session.setTelegramBudget(...args);}
  #voiceTransfer?:VoiceTransfer;
  #session: MnemosAccountSession;
  #teamDocuments:TeamDocumentCreation;
  #telegram?: DurableObjectStub<UserAccount>;
  constructor(session: MnemosAccountSession,teamDocuments:TeamDocumentCreation,private trackers:TrackerCreation,private trackerEdits:TrackerEdits,private resourceMaps:ResourceMapCreation,private resourceMapEdits:ResourceMapEdits,private corporateTasks:CorporateTaskCreation, telegram?: DurableObjectStub<UserAccount>,voiceTransfer?:VoiceTransfer) { super(); this.#voiceTransfer=voiceTransfer; this.#session = session;this.#teamDocuments=teamDocuments;this.#telegram=telegram; }
  async telegramVoiceInbox(id:string){
    const proof=await this.#session.telegramTaskJournal(id,-1);
    if(!this.#telegram)throw Error('Telegram unavailable.');
    const items=await this.#telegram.telegramVoiceInbox(proof.channel.bot_id,id);
    await this.#session.telegramTaskJournal(id,-1);return items;
  }
  async importTelegramVoice(id:string,update:number,project:string){
    const proof=await this.#session.telegramTaskJournal(id,-1);
    if(!this.#telegram||!this.#voiceTransfer)throw Error('Telegram voice unavailable.');
    const imported=await this.#telegram.telegramVoiceImportState(proof.channel.bot_id,id,update);
    if(imported){
      if(imported.project!==project)throw Error('Telegram voice project changed.');
      const source=await this.#session.readVoiceSource(imported.request);
      if(source.project_id!==project||source.sha256!==imported.sha256)throw Error('Telegram voice original changed.');
      await this.#session.telegramTaskJournal(id,-1);return source;
    }
    const file=await this.#telegram.telegramVoiceFile(proof.channel.bot_id,id,update);
    await this.#session.telegramTaskJournal(id,-1);
    const source=await this.#voiceTransfer.upload(this.#session,file.request,project,file.mime,file.bytes);
    if(source.sha256!==file.sha256)throw Error('Telegram voice original changed.');
    await this.#session.telegramTaskJournal(id,-1);
    await this.#telegram.completeTelegramVoiceImport(proof.channel.bot_id,id,update,{request:source.request_id,project:source.project_id,sha256:source.sha256});
    await this.#session.telegramTaskJournal(id,-1);return source;
  }
  async telegramLocalInbox(id:string,after=-1){
    const proof=await this.#session.telegramTaskJournal(id,-1);
    if(!this.#telegram)throw Error('Telegram unavailable.');
    const inbox=await this.#telegram.telegramLocalInbox(proof.channel.bot_id,id,after);
    const current=await this.#session.whoAmI();
    if(current.subject.user_id!==proof.channel.owner_id)throw Error('Telegram inbox unavailable.');
    return inbox;
  }
  async telegramTaskJournal(id:string,after=-1){
    const page=await this.#session.telegramTaskJournal(id,after);
    const states=this.#telegram?await this.#telegram.telegramDeliveryStates(page.channel.bot_id,id,page.items.map(item=>item.update_id)):[];
    const current=await this.#session.whoAmI();
    if(current.subject.user_id!==page.channel.owner_id)throw Error('Telegram journal unavailable.');
    const delivery=states.filter(state=>{const item=page.items.find(item=>item.update_id===state.update_id);return item&&(state.request_id===null||state.request_id===item.request_id);});
    return {...page,delivery};
  }
  async connectTelegram(request: string, token: string, binding: string, deliveryAcknowledged: boolean) {
    await this.#session.whoAmI(); if (!this.#telegram) throw Error('Telegram unavailable.');
    return this.#telegram.connectTelegram(request, token, binding, deliveryAcknowledged);
  }
  async listTelegram(){await this.#session.whoAmI();if(!this.#telegram)throw Error('Telegram unavailable.');const result=await this.#telegram.listTelegram();await this.#session.whoAmI();return result;}
  async describeTelegram(bot: string) { await this.#session.whoAmI(); if (!this.#telegram) throw Error('Telegram unavailable.'); return this.#telegram.describeTelegram(bot); }
  async confirmTelegram(bot: string, epoch: string, sender: number) { await this.#session.whoAmI(); if (!this.#telegram) throw Error('Telegram unavailable.'); return this.#telegram.confirmTelegram(bot, epoch, sender); }
  async disconnectTelegram(bot: string) { await this.#session.whoAmI(); if (!this.#telegram) throw Error('Telegram unavailable.'); return this.#telegram.disconnectTelegram(bot); }
  async readPrivateVersionDigest(project:string,node:string,version:string) {return this.#session.readPrivateVersionDigest(project,node,version);}
  async readDraftDocument(projectId: string, nodeId: string) { return this.#session.readDraftDocument(projectId, nodeId); }
  async checkTrackerAssignee(project:string,node:string,head:string,principal:string){return this.#session.checkTrackerAssignee(project,node,head,principal);}
  async readPublishedHead(project:string) {return this.#session.readPublishedHead(project);}
  async draftState(projectId: string) { return this.#session.draftState(projectId); }
  async openDraft(projectId: string) { return this.#session.openDraft(projectId); }
  async listPrivateDraftParticipants(project:string,node:string,head:string,cursor:string){return this.#session.listPrivateDraftParticipants(project,node,head,cursor);}
  async setPrivateDraftParticipant(project: string, node: string, head: string, participant: string, expected: PrivateParticipantMode, mode: PrivateParticipantMode) {
    return this.#session.setPrivateDraftParticipant(project,node,head,participant,expected,mode);
  }
  async saveDraftDocument(projectId: string, nodeId: string, uploadId: string, expectedHead: string) {
    return this.#session.saveDraftDocument(projectId, nodeId, uploadId, expectedHead);
  }
  async listPublicationReviews(cursor: string) {
    return this.#session.listPublicationReviews(cursor);
  }
  async recordReviewDecision(id: string, domain: string, version: number, approved: boolean) {
    return this.#session.recordReviewDecision(id, domain, version, approved);
  }
  async readPublicationPolicy(project: string) { return this.#session.readPublicationPolicy(project); }
  async listPolicyApprovers(project: string, cursor: string) { return this.#session.listPolicyApprovers(project, cursor); }
  async setPublicationPolicy(project: string, revision: number, domains: PolicyDomain[]) { return this.#session.setPublicationPolicy(project, revision, domains); }
  async readPublicationReview(id: string) {
    return this.#session.readPublicationReview(id);
  }
  async requestPublicationReview(projectId: string, personalHead: string, sharedHead: string) {
    return this.#session.requestPublicationReview(projectId, personalHead, sharedHead);
  }
  async publishDraft(projectId: string, expectedHead: string, sharedHead: string, message: string) {
    return this.#session.publishDraft(projectId, expectedHead, sharedHead, message);
  }
  async setAgentProjectRight(...args: Parameters<MnemosAccountSession["setAgentProjectRight"]>) { return this.#session.setAgentProjectRight(...args); }
  async externalAgentSetup() { return this.#session.externalAgentSetup(); }
  async beginInboxUpload(...args: Parameters<MnemosAccountSession["beginInboxUpload"]>) {return this.#session.beginInboxUpload(...args);}
  async submitInboxUpload(...args: Parameters<MnemosAccountSession["submitInboxUpload"]>) {return this.#session.submitInboxUpload(...args);}
  async inboxStatus(...args: Parameters<MnemosAccountSession["inboxStatus"]>) {return this.#session.inboxStatus(...args);}
  async inboxAlerts(...args: Parameters<MnemosAccountSession["inboxAlerts"]>) {return this.#session.inboxAlerts(...args);}
  async decideInboxAlert(...args: Parameters<MnemosAccountSession["decideInboxAlert"]>) {return this.#session.decideInboxAlert(...args);}
  async replayInboxItem(...args: Parameters<MnemosAccountSession["replayInboxItem"]>) {return this.#session.replayInboxItem(...args);}
  async listPeople(...args: Parameters<MnemosAccountSession["listPeople"]>) { return this.#session.listPeople(...args); }
  async createPerson(...args: Parameters<MnemosAccountSession["createPerson"]>) { return this.#session.createPerson(...args); }
  async listPersonRights(...args: Parameters<MnemosAccountSession["listPersonRights"]>) { return this.#session.listPersonRights(...args); }
  async grantPersonRight(...args: Parameters<MnemosAccountSession["grantPersonRight"]>) { return this.#session.grantPersonRight(...args); }
  async removePersonRight(...args: Parameters<MnemosAccountSession["removePersonRight"]>) { return this.#session.removePersonRight(...args); }
  async whoAmI() { return this.#session.whoAmI(); }
  /** Relay UI diagnostics through the human management session. */
  async recordUIReadiness(sample:Parameters<MnemosAccountSession["recordUIReadiness"]>[0]) { return this.#session.recordUIReadiness(sample); }
  async readPlatformMetrics() { return this.#session.readPlatformMetrics(); }
  async listProjects() { return this.#session.listProjects(); }
  async setProjectVisibility(...args: Parameters<MnemosAccountSession["setProjectVisibility"]>) { return this.#session.setProjectVisibility(...args); }
  async listShareRequests(...args: Parameters<MnemosAccountSession["listShareRequests"]>) { return this.#session.listShareRequests(...args); }
  async listSharedDocuments() { return this.#session.listSharedDocuments(); }
  async markSharedDocumentSeen(...args: Parameters<MnemosAccountSession["markSharedDocumentSeen"]>) { return this.#session.markSharedDocumentSeen(...args); }
  async decideShareRequest(...args: Parameters<MnemosAccountSession["decideShareRequest"]>) { return this.#session.decideShareRequest(...args); }
  async readProjectSharingSettings() { return this.#session.readProjectSharingSettings(); }
  async listOrgUnits() { return this.#session.listOrgUnits(); }
  async createOrgUnit(name: string) { return this.#session.createOrgUnit(name); }
  async setOrgUnitMember(unit: string, principal: string, member: boolean, head: boolean) { return this.#session.setOrgUnitMember(unit, principal, member, head); }
  async deleteOrgUnit(unit: string) { return this.#session.deleteOrgUnit(unit); }
  async listInvitations() { return this.#session.listInvitations(); }
  /** Ссылка собирается здесь: адрес входа знает только подключение, а не фрейм. */
  async createInvitation(email: string, displayName: string, orgUnit: string, role: import("./mnemos-api.ts").InvitationRole = "employee", codeAgent = false) {
    if (!this.#telegram) throw new Error("Invitation link unavailable");
    const { code, ...invitation } = await this.#session.createInvitation(email, displayName, orgUnit, role, codeAgent);
    return { invitation, link: await this.#telegram.invitationLink(code) };
  }
  async revokeInvitation(id: string) { return this.#session.revokeInvitation(id); }
  async updateProjectSharingSettings(...args: Parameters<MnemosAccountSession["updateProjectSharingSettings"]>) { return this.#session.updateProjectSharingSettings(...args); }
  async nodeHistory(projectId: string, nodeId: string, cursor: string) { return this.#session.nodeHistory(projectId, nodeId, cursor, 50); }
  async searchProject(projectId: string, query: string) { return this.#session.searchProject(projectId, query); }
  async searchAll(query: string, limit = 20) { return this.#session.searchAll(query, limit); }
  async readProjectDocument(projectId: string, nodeId: string) { return this.#session.readProjectDocument(projectId, nodeId); }
  async readProjectDocumentWindow(projectId: string, nodeId: string, ordinal: number, radius: number, maxBytes = 262144) { return this.#session.readProjectDocumentWindow(projectId, nodeId, ordinal, radius, maxBytes); }
  async createCodeProject(...args: Parameters<MnemosAccountSession["createCodeProject"]>) { return this.#session.createCodeProject(...args); }
  async browseProject(projectId: string, cursor = "") {
    if (typeof projectId !== "string" || !projectId || projectId.length > 255 || typeof cursor !== "string" || cursor.length > 4096) throw new Error("Invalid project request");
    return this.#session.browseProject(projectId, cursor);
  }
  async readDocument(nodeId: string) {
    if (typeof nodeId !== "string" || !nodeId || nodeId.length > 255) throw new Error("Invalid document");
    return this.#session.readDocument(nodeId);
  }
  async managedAgentRequest() { return this.#session.managedAgentRequest(); }
  async prepareManagedAgent(templateId: string) { return this.#session.prepareManagedAgent(templateId); }
  async submitManagedAgent(requestId: string) { return this.#session.submitManagedAgent(requestId); }
  async finishManagedAgentRequest(requestId: string) { this.#session.finishManagedAgentRequest(requestId); }
  async managedTaskRequest() { return this.#session.managedTaskRequest(); }
  async prepareTrackedAgentTask(binding:string,message:string,criteria:string,project:string,node:string){return this.#session.prepareTrackedAgentTask(binding,message,criteria,project,node);}
  async prepareAgentTask(bindingId: string, message: string, criteria: string) { return this.#session.prepareAgentTask(bindingId, message, criteria); }
  async discardUnsentAgentTask(requestId: string) {this.#session.discardUnsentAgentTask(requestId);}
  async submitSavedAgentTask(requestId: string) { return this.#session.submitSavedAgentTask(requestId); }
  async refreshSavedAgentTask(requestId: string) { return this.#session.refreshSavedAgentTask(requestId); }
  async reviewSavedAgentTask(...args: Parameters<MnemosAccountSession["reviewSavedAgentTask"]>) { return this.#session.reviewSavedAgentTask(...args); }
  async finishedAgentTasks(cursor = "") {return this.#session.finishedAgentTasks(cursor);}
  async readFinishedAgentTask(id: string) {return this.#session.readFinishedAgentTask(id);}
  async prepareAgentRework(id: string) {return this.#session.prepareAgentRework(id);}
  async finishSavedAgentTask(requestId: string) { this.#session.finishSavedAgentTask(requestId); }
  async runAgentTask(bindingId: string, requestId: string, message: string, criteria: string) { return this.#session.runAgentTask(bindingId, requestId, message, criteria); }
  async readAgentTask(bindingId: string, requestId: string) { return this.#session.readAgentTask(bindingId, requestId); }
  async provisionManagedAgent(requestId: string, templateId: string) {
    return this.#session.provisionManagedAgent(requestId, templateId);
  }
  async prepareTeamBudgetRework(id: string) {return this.#session.prepareTeamBudgetRework(id);}
  async prepareTeamBudgetReview(project: string, proposal: string, binding: string) {return this.#session.prepareTeamBudgetReview(project, proposal, binding);}
  async readTeamResultDraft(project:string,proposal:string) {return this.#session.readTeamResultDraft(project,proposal);}
  async resolveDraftConflict(project:string,node:string,head:string,side:number){return this.#session.resolveDraftConflict(project,node,head,side);}
  async listInvitedTrackers(project:string,cursor:string,node=""){return this.#session.listInvitedTrackers(project,cursor,node);}
  async connectInvitedTracker(project:string,node:string,source:string){return this.#session.connectInvitedTracker(project,node,source);}
  async readResourceMapCreation(project:string){return this.resourceMaps.read(this.#session,project);}
  async saveResourceMapCreation(project:string,setup:ResourceMapSetup,expected:string){return this.resourceMaps.save(this.#session,project,setup,expected);}
  async executeResourceMapCreation(project:string,id:string){return this.resourceMaps.execute(this.#session,project,id);}
  async readResourceMapEdit(project:string,node:string){return this.resourceMapEdits.read(this.#session,project,node);}
  async prepareResourceMapEdit(project:string,node:string,input:ResourceMapEditInput){return this.resourceMapEdits.prepare(this.#session,project,node,input);}
  async claimResourceMapEdit(project:string,node:string,id:string){return this.resourceMapEdits.claim(this.#session,project,node,id);}
  async clearResourceMapEdit(project:string,node:string,id:string,head:string){return this.resourceMapEdits.clear(this.#session,project,node,id,head);}
  async readTrackerEdit(project:string,node:string){return this.trackerEdits.read(this.#session,project,node);}
  async prepareTrackerEdit(project:string,node:string,input:TrackerEditInput){return this.trackerEdits.prepare(this.#session,project,node,input);}
  async claimTrackerEdit(project:string,node:string,id:string){return this.trackerEdits.claim(this.#session,project,node,id);}
  async clearTrackerEdit(project:string,node:string,id:string,head:string){return this.trackerEdits.clear(this.#session,project,node,id,head);}
  async readTrackerCreation(project:string){return this.trackers.read(this.#session,project);}
  async saveTrackerCreation(project:string,setup:TrackerSetup,expected:string){return this.trackers.save(this.#session,project,setup,expected);}
  async executeTrackerCreation(project:string,id:string){return this.trackers.execute(this.#session,project,id);}
  async createTeamResultDocument(project:string,proposal:string,source:string) {return this.#teamDocuments.create(this.#session,project,proposal,source);}
  async readTeamResultContribution(project:string,proposal:string,binding:string) {return this.#session.readTeamResultContribution(project,proposal,binding);}
  async recordTeamResultContribution(project:string,proposal:string,binding:string,input:Parameters<MnemosAccountSession["recordTeamResultContribution"]>[3]) {return this.#session.recordTeamResultContribution(project,proposal,binding,input);}
  async readTeamResultReview(project: string, proposal: string, binding: string) {return this.#session.readTeamResultReview(project,proposal,binding);}
  async readTeamMemberObservation(project: string, proposal: string, binding: string) {return this.#session.readTeamMemberObservation(project,proposal,binding);}
  async readTeamMemberActivity(project: string, proposal: string, binding: string, after: string) {return this.#session.readTeamMemberActivity(project,proposal,binding,after);}
  async deferBudgetDraft(requestId:string) {return this.#session.deferBudgetDraft(requestId);}
  async resumeBudgetDraft(requestId:string) {return this.#session.resumeBudgetDraft(requestId);}
  async cancelSavedTeamTask(requestId:string) {return this.#session.cancelSavedTeamTask(requestId);}
  async budgetSavedAgentTask(requestId: string, project: string, estimate: string, limit: string) {return this.#session.budgetSavedAgentTask(requestId,project,estimate,limit);}
  async readTeamBudgetUsage(project: string, proposal: string) {return this.#session.readTeamBudgetUsage(project,proposal);}
  async runTeamBudgetMember(project: string, proposal: string, binding: string) {return this.#session.runTeamBudgetMember(project, proposal, binding);}
  async readTeamMemberInputs(project: string, proposal: string, binding: string) {return this.#session.readTeamMemberInputs(project, proposal, binding);}
  async readTeamBudgetMember(project: string, proposal: string, binding: string) {return this.#session.readTeamBudgetMember(project, proposal, binding);}
  async cancelTeamBudgetMember(project: string, proposal: string, binding: string) {return this.#session.cancelTeamBudgetMember(project, proposal, binding);}
  async listTeamBudgets(project: string, cursor = "") {return this.#session.listTeamBudgets(project, cursor);}
  async readTeamBudget(project: string, id: string) {return this.#session.readTeamBudget(project, id);}
  async createTeamBudget(project: string, input: Parameters<MnemosAccountSession["createTeamBudget"]>[1]) {return this.#session.createTeamBudget(project, input);}
  async decideTeamBudget(project: string, id: string, input: Parameters<MnemosAccountSession["decideTeamBudget"]>[2]) {return this.#session.decideTeamBudget(project, id, input);}
  async listBudgetProjects(cursor = "") {return this.#session.listBudgetProjects(cursor);}
  async readProjectBudget(project: string) {return this.#session.readProjectBudget(project);}
  async readSpending(period: Parameters<MnemosAccountSession["readSpending"]>[0], timeZone = "") {return this.#session.readSpending(period, timeZone);}
  async setProjectBudget(project: string, policy: Parameters<MnemosAccountSession["setProjectBudget"]>[1]) {return this.#session.setProjectBudget(project, policy);}
  async listCollaborations(cursor = "") { return this.#session.listCollaborations(cursor); }
  async readCollaboration(id: string) { return this.#session.readCollaboration(id); }
  async createCollaboration(request: Parameters<MnemosAccountSession["createCollaboration"]>[0]) { return this.#session.createCollaboration(request); }
  async readCollaborationProgress(id: string) {return this.#session.readCollaborationProgress(id);}
  async reviewCollaborationResult(id: string, review: Parameters<MnemosAccountSession["reviewCollaborationResult"]>[1]) {return this.#session.reviewCollaborationResult(id, review);}
  async listCollaborationMessages(id: string, cursor = 0) { return this.#session.listCollaborationMessages(id, cursor); }
  async appendCollaborationMessage(id: string, message: Parameters<MnemosAccountSession["appendCollaborationMessage"]>[1]) { return this.#session.appendCollaborationMessage(id, message); }
  async readSavedAbsenceAction(request: string) {return this.#session.readSavedAbsenceAction(request);}
  async saveAbsenceAction(project: string, request: string, action: Parameters<MnemosAccountSession["saveAbsenceAction"]>[2], expected: string) {return this.#session.saveAbsenceAction(project, request, action, expected);}
  async executeSavedAbsenceAction(request: string, id: string) {return this.#session.executeSavedAbsenceAction(request, id);}
  async createAbsenceTask(request: string) {return this.#session.createAbsenceTask(request);}
  async readAbsenceTask(request: string) {return this.#session.readAbsenceTask(request);}
  async dispatchAbsenceTask(request: string, proposal: string) {return this.#session.dispatchAbsenceTask(request, proposal);}
  async cancelAbsenceTask(request: string, revision: number) {return this.#session.cancelAbsenceTask(request, revision);}
  async readAbsenceRuntime(request: string, binding: string) {return this.#session.readAbsenceRuntime(request, binding);}
  async readAgentAbsence(project: string) { return this.#session.readAgentAbsence(project); }
  async setAgentAbsence(project: string, input: Parameters<MnemosAccountSession["setAgentAbsence"]>[1]) { return this.#session.setAgentAbsence(project, input); }
  async listEngagementRules(binding: string, cursor = "") { return this.#session.listEngagementRules(binding, cursor); }
  async setEngagementRule(binding: string, rule: Parameters<MnemosAccountSession["setEngagementRule"]>[1]) { return this.#session.setEngagementRule(binding, rule); }



  async readTemplateProposalBaseline(id:string){return this.#session.readTemplateProposalBaseline(id);}
  async readTemplateProposalSource(id:string){return this.#session.readTemplateProposalSource(id);}
  async readSavedTemplateDecision(id:string){return this.#session.readSavedTemplateDecision(id);}
  async saveTemplateDecision(id:string,input:Parameters<MnemosAccountSession["saveTemplateDecision"]>[1]){return this.#session.saveTemplateDecision(id,input);}
  executeSavedTemplateDecision(id:string){return this.#session.executeSavedTemplateDecision(id);}
  async resolveWorkTemplate(scope:string,key:string,personal?:Parameters<MnemosAccountSession["resolveWorkTemplate"]>[2]){return this.#session.resolveWorkTemplate(scope,key,personal);}
  async listManagedTemplateScopes(cursor=""){return this.#session.listManagedTemplateScopes(cursor);}
  async setTemplateScope(id:string,expected:number,config:Parameters<MnemosAccountSession["setTemplateScope"]>[2]){return this.#session.setTemplateScope(id,expected,config);}
  async listTemplateReviewScopes(cursor=""){return this.#session.listTemplateReviewScopes(cursor);}
  async listTemplateProposals(scope:string,cursor=""){return this.#session.listTemplateProposals(scope,cursor);}
  async readTemplateProposal(id:string){return this.#session.readTemplateProposal(id);}
  async listTemplateScopes(cursor=""){return this.#session.listTemplateScopes(cursor);}
  async listScopedWorkTemplates(scope:string,cursor=""){return this.#session.listScopedWorkTemplates(scope,cursor);}
  async readScopedWorkTemplate(scope:string,key:string,revision:number){return this.#session.readScopedWorkTemplate(scope,key,revision);}
  async listWorkTemplates(project:string,cursor=""){return this.#session.listWorkTemplates(project,cursor);}
  async readWorkTemplate(id:string,revision:number){return this.#session.readWorkTemplate(id,revision);}
  async readSavedTemplateAction(project:string){return this.#session.readSavedTemplateAction(project);}
  async saveTemplateAction(project:string,action:Parameters<MnemosAccountSession["saveTemplateAction"]>[1],expected:string){return this.#session.saveTemplateAction(project,action,expected);}
  async deferTemplateAction(project:string,id:string){return this.#session.deferTemplateAction(project,id);}
  async restoreTemplateAction(project:string,id:string,expected:string){return this.#session.restoreTemplateAction(project,id,expected);}
  async executeSavedTemplateAction(project:string,id:string){return this.#session.executeSavedTemplateAction(project,id);}
  async readPersonalMemoryVersion() { return this.#session.readPersonalMemoryVersion(); }
  async readPersonalMemory() { return this.#session.readPersonalMemory(); }
  async setPersonalMemory(revision: number, project: string, node: string, head: string) { return this.#session.setPersonalMemory(revision, project, node, head); }
  async listPrivateDocumentsForOwner(project: string, owner: string, cursor = "") { return this.#session.listPrivateDocumentsForOwner(project, owner, cursor); }
  async listPrivateDocuments(project: string, cursor = "") { return this.#session.listPrivateDocuments(project, cursor); }
  async listVisibleDatabaseConnections(){return this.#session.listVisibleDatabaseConnections();}
  async prepareSharedCorporateWorkflow(project:string,shown:Parameters<CorporateTaskCreation["prepareWorkflow"]>[2],plan:unknown,confirmed:boolean){return this.corporateTasks.prepareWorkflow(this.#session,project,shown,plan,confirmed);}
  async executeSharedCorporateWorkflow(id:string){return this.corporateTasks.executeWorkflow(this.#session,id);}
  async previewCorporateWorkflow(project:string,node:string,head:string,provider:string,plan:unknown){return this.#session.previewCorporateWorkflow(project,node,head,provider,plan);}
  async readJiraLinks(project:string,node:string,head:string){return this.#session.readJiraLinks(project,node,head);}
  async resolveCorporateTarget(project:string,node:string,head:string,kind:string,entity:string){return this.#session.resolveCorporateTarget(project,node,head,kind,entity);}
  async readCorporateOrigin(project:string,node:string,head:string){return this.#session.readCorporateOrigin(project,node,head);}
  async prepareCorporateUpdate(project:string,shown:Parameters<CorporateTaskCreation["prepareUpdate"]>[2]){return this.corporateTasks.prepareUpdate(this.#session,project,shown);}
  async executeCorporateUpdate(id:string){return this.corporateTasks.executeUpdate(this.#session,id);}
  async recoverCorporateUpdate(project:string,node:string){return this.corporateTasks.recoverUpdate(this.#session,project,node);}
  async resolveCorporateCardLink(project:string,node:string,head:string,index:number){return this.corporateTasks.resolveCardLink(this.#session,project,node,head,index);}
  async readCorporateCard(project:string,node:string){return this.corporateTasks.readCard(this.#session,project,node);}
  async saveCorporateCard(project:string,node:string,head:string,title:string,notes:string){return this.corporateTasks.saveCard(this.#session,project,node,head,title,notes);}
  async prepareMappedCorporateTask(project:string,node:string,head:string,issue:string,mapping:BitrixTaskMapping){return this.corporateTasks.prepare(this.#session,project,node,head,issue,"task",mapping);}
  async prepareMappedJiraCorporateTask(project:string,node:string,head:string,issue:string,mapping:BitrixTaskMapping){return this.corporateTasks.prepare(this.#session,project,node,head,issue,"jira-task",mapping);}
  async prepareCorporateTask(project:string,node:string,head:string,issue:string){return this.corporateTasks.prepare(this.#session,project,node,head,issue);}
  async prepareCorporateAttachment(project:string,node:string,head:string,issue:string,attachment:string){return this.corporateTasks.prepare(this.#session,project,node,head,attachment,"attachment",undefined,issue);}
  async prepareCorporateRecord(project:string,node:string,head:string,kind:string,issue:string){return this.corporateTasks.prepare(this.#session,project,node,head,issue,kind);}
  async executeCorporateTask(id:string){return this.corporateTasks.execute(this.#session,id);}
  async previewJiraImport(project:string,node:string,head:string){return this.#session.previewJiraImport(project,node,head);}
  async resolveBitrixRecordUpdate(project:string,node:string,head:string,incomingNode:string,incomingHead:string,resolution:Parameters<MnemosAccountSession["resolveBitrixRecordUpdate"]>[5]){return this.#session.resolveBitrixRecordUpdate(project,node,head,incomingNode,incomingHead,resolution);}
  async previewBitrixRecordUpdate(project:string,node:string,head:string,incomingNode:string,incomingHead:string){return this.#session.previewBitrixRecordUpdate(project,node,head,incomingNode,incomingHead);}
  async previewBitrixDepartmentMembership(project:string,node:string,head:string,selection:Parameters<MnemosAccountSession["previewBitrixDepartmentMembership"]>[3]){return this.#session.previewBitrixDepartmentMembership(project,node,head,selection);}
  async applyBitrixDepartmentMembership(project:string,node:string,head:string,selection:Parameters<MnemosAccountSession["applyBitrixDepartmentMembership"]>[3],decision:Parameters<MnemosAccountSession["applyBitrixDepartmentMembership"]>[4]){return this.#session.applyBitrixDepartmentMembership(project,node,head,selection,decision);}
  async previewBitrixImport(project:string,node:string,head:string){return this.#session.previewBitrixImport(project,node,head);}
  async listDatabaseConnections(project:string){return this.#session.listDatabaseConnections(project);}
  async registerDatabaseConnection(project:string,input:DatabaseRegistration){return this.#session.registerDatabaseConnection(project,input);}
  async removeDatabaseConnection(project:string,name:string){return this.#session.removeDatabaseConnection(project,name);}
  async readOperationAudit(after:number){return this.#session.readOperationAudit(after);}
  async readOperationAuditPage(after:number,limit:number){return this.#session.readOperationAuditPage(after,limit);}
  async listWorkJournal(project:string,cursor=""){return this.#session.listWorkJournal(project,cursor);}
  async readGitFile(project:string,connection:string,repository:string,commit:string,path:string){return this.#session.readGitFile(project,connection,repository,commit,path);}
  async readGitCommit(project:string,connection:string,repository:string,ref:string){return this.#session.readGitCommit(project,connection,repository,ref);}
  async readGitTree(project:string,connection:string,repository:string,commit:string,path=""){return this.#session.readGitTree(project,connection,repository,commit,path);}
  async listGitBranches(project:string,connection:string,repository:string,page=1){return this.#session.listGitBranches(project,connection,repository,page);}
  #workspace(){if(!this.#telegram)throw Error('Рабочие места агентов недоступны.');return this.#telegram;}
  async workspaceAvailable(){return this.#telegram?this.#telegram.workspaceAvailable():false;}
  async listWorkspaceTasks(project:string){return this.#workspace().listWorkspaceTasks(project);}
  async startWorkspaceTask(project:string,connection:string,repository:string,prompt:string){return this.#workspace().startWorkspaceTask(project,connection,repository,prompt);}
  async readWorkspaceTask(project:string,task:string){return this.#workspace().readWorkspaceTask(project,task);}
  async messageWorkspaceTask(project:string,task:string,text:string){return this.#workspace().messageWorkspaceTask(project,task,text);}
  async abortWorkspaceTask(project:string,task:string){return this.#workspace().abortWorkspaceTask(project,task);}
  async readGitLog(project:string,connection:string,repository:string,ref:string,path="",page=1){return this.#session.readGitLog(project,connection,repository,ref,path,page);}
  async compareGitRefs(project:string,connection:string,repository:string,base:string,head:string){return this.#session.compareGitRefs(project,connection,repository,base,head);}
  async readProjectOverview(project:string,node=""){return this.#session.readProjectOverview(project,node);}
  async readOwnedGitBinding(project:string,connection:string,repository:string){return this.#session.readOwnedGitBinding(project,connection,repository);}
  async listProjectGitRepositories(project:string,cursor=""){return this.#session.listProjectGitRepositories(project,cursor);}
  async bindGitRepository(project:string,connection:string,repository:string,input:GitRepositorySelection){return this.#session.bindGitRepository(project,connection,repository,input);}
  async listGitConnections(cursor=""){return this.#session.listGitConnections(cursor);}
  async readGitConnection(id:string){return this.#session.readGitConnection(id);}
  /** Read the connected subject's upload reservations. */
  async uploadUsage(){return this.#session.uploadUsage();}
  async prepareCentroid(project:string,restart=false){return this.#session.prepareCentroid(project,restart);}
  async executeCentroid(project:string,request:string){return this.#session.executeCentroid(project,request);}
  async readReindexBatch(){return this.#session.readReindexBatch();}
  async prepareReindexBatch(projects:string[],history=false,restart=false){return this.#session.prepareReindexBatch(projects,history,restart);}
  async executeReindexBatch(id:string){return this.#session.executeReindexBatch(id);}
  async prepareReindex(node:string,restart=false){return this.#session.prepareReindex(node,restart);}
  async executeReindex(node:string,request:string){return this.#session.executeReindex(node,request);}
  async policyAlerts(after="",all=false){return this.#session.policyAlerts(after,all);}
  async reviewPolicyAlert(id:string,note:string){return this.#session.reviewPolicyAlert(id,note);}
  async platformSignalInbox(before=""){return this.#session.platformSignalInbox(before);}
  async readPlatformSignalNotification(id:string){return this.#session.readPlatformSignalNotification(id);}
  async listPlatformSignalOwners(){return this.#session.listPlatformSignalOwners();}
  async setPlatformSignalOwner(key:string,decision:Parameters<MnemosAccountSession["setPlatformSignalOwner"]>[1]){return this.#session.setPlatformSignalOwner(key,decision);}
  async listOrganizationRoles(cursor=""){return this.#session.listOrganizationRoles(cursor);}
  async createOrganizationRole(input:Parameters<MnemosAccountSession["createOrganizationRole"]>[0]){return this.#session.createOrganizationRole(input);}
  async readPrincipalMembership(container:string,member:string){return this.#session.readPrincipalMembership(container,member);}
  async setPrincipalMembership(container:string,member:string,decision:Parameters<MnemosAccountSession["setPrincipalMembership"]>[2]){return this.#session.setPrincipalMembership(container,member,decision);}
  async readCalendarGrantState(id:string,principal:string){return this.#session.readCalendarGrantState(id,principal);}
  async readMailGrantState(id:string,principal:string){return this.#session.readMailGrantState(id,principal);}
  async listCalendarDrafts(connection:string,cursor=''){await this.#session.whoAmI();if(!this.#telegram)throw Error('Account unavailable.');const out=await this.#telegram.listCalendarDrafts(connection,cursor);await this.#session.whoAmI();return out;}
  async readCalendarDraft(id:string){await this.#session.whoAmI();if(!this.#telegram)throw Error('Account unavailable.');const out=await this.#telegram.readCalendarDraft(id);await this.#session.whoAmI();return out;}
  async decideCalendarDraft(id:string,sha256:string,approved:boolean){await this.#session.whoAmI();if(!this.#telegram)throw Error('Account unavailable.');const out=await this.#telegram.decideCalendarDraft(id,sha256,approved);await this.#session.whoAmI();return out;}
  async listImapAccounts(){await this.#session.whoAmI();if(!this.#telegram)throw Error('Account unavailable.');const result=await this.#telegram.listImapAccounts();await this.#session.whoAmI();return result;}
  async connectImapAccount(input:ImapSetup){await this.#session.whoAmI();if(!this.#telegram)throw Error('Account unavailable.');const result=await this.#telegram.connectImapAccount(input);await this.#session.whoAmI();return result;}
  async removeImapAccount(id:string){await this.#session.whoAmI();if(!this.#telegram)throw Error('Account unavailable.');await this.#telegram.removeImapAccount(id);await this.#session.whoAmI();}
  async listWebDAVAccounts(){await this.#session.whoAmI();if(!this.#telegram)throw Error('Account unavailable.');const result=await this.#telegram.listWebDAVAccounts();await this.#session.whoAmI();return result;}
  async connectWebDAVAccount(input:WebDAVSetup){await this.#session.whoAmI();if(!this.#telegram)throw Error('Account unavailable.');const result=await this.#telegram.connectWebDAVAccount(input);await this.#session.whoAmI();return result;}
  async removeWebDAVAccount(id:string){await this.#session.whoAmI();if(!this.#telegram)throw Error('Account unavailable.');await this.#telegram.removeWebDAVAccount(id);await this.#session.whoAmI();}
  async checkCalDAVScheduling(calendarId:string){await this.#session.whoAmI();if(!this.#telegram)throw Error('Account unavailable.');const result=await this.#telegram.checkCalDAVScheduling(calendarId);await this.#session.whoAmI();return result;}
  async listCalDAVAccounts(){await this.#session.whoAmI();if(!this.#telegram)throw Error('Account unavailable.');const result=await this.#telegram.listCalDAVAccounts();await this.#session.whoAmI();return result;}
  async connectCalDAVAccount(input:CalDAVSetup){await this.#session.whoAmI();if(!this.#telegram)throw Error('Account unavailable.');const result=await this.#telegram.connectCalDAVAccount(input);await this.#session.whoAmI();return result;}
  async removeCalDAVAccount(id:string){await this.#session.whoAmI();if(!this.#telegram)throw Error('Account unavailable.');await this.#telegram.removeCalDAVAccount(id);await this.#session.whoAmI();}
  async listCalendarConnections(cursor=''){return this.#session.listCalendarConnections(cursor);}
  async readCalendarEvents(project:string,connection:string,query:import('./calendar-connections.ts').CalendarEventQuery){return this.#session.readCalendarEvents(project,connection,query);}
  async readCalendarConnection(id:string){return this.#session.readCalendarConnection(id);}
  async listMailDrafts(connection:string,cursor=''){await this.#session.whoAmI();if(!this.#telegram)throw Error('Account unavailable.');const result=await this.#telegram.listMailDrafts(connection,cursor);await this.#session.whoAmI();return result;}
  async readMailDraft(id:string){await this.#session.whoAmI();if(!this.#telegram)throw Error('Account unavailable.');const result=await this.#telegram.readMailDraft(id);await this.#session.whoAmI();return result;}
  async decideMailDraft(id:string,sha256:string,approved:boolean){await this.#session.whoAmI();if(!this.#telegram)throw Error('Account unavailable.');const result=await this.#telegram.decideMailDraft(id,sha256,approved);await this.#session.whoAmI();return result;}
  async readMailMessages(project:string,connection:string,query:import('./mail-connections.ts').MailMessageQuery){return this.#session.readMailMessages(project,connection,query);}
  async listMailConnections(cursor=''){return this.#session.listMailConnections(cursor);}
  async readMailConnection(id:string){return this.#session.readMailConnection(id);}
  async registerCalendarConnection(project:string,request:string,selection:string){return this.#session.registerCalendarConnection(project,request,selection);}
  async registerMailConnection(project:string,request:string,selection:string){return this.#session.registerMailConnection(project,request,selection);}
  async setCalendarReadGrant(id:string,decision:CalendarGrantDecision){return this.#session.setCalendarReadGrant(id,decision);}
  async setMailReadGrant(id:string,decision:MailGrantDecision){return this.#session.setMailReadGrant(id,decision);}
  async disableCalendarConnection(id:string,expected:number){return this.#session.disableCalendarConnection(id,expected);}
  async disableMailConnection(id:string,expected:number){return this.#session.disableMailConnection(id,expected);}
  async disableGitConnection(id:string,expected:number){return this.#session.disableGitConnection(id,expected);}
  async listGitRepositories(id:string,page=1){return this.#session.listGitRepositories(id,page);}
  async listGitSyncLinks(){return this.#session.listGitSyncLinks();}
  async listProjectGitSync(project:string){return this.#session.listProjectGitSync(project);}
  async createGitSyncLink(input:import("./mnemos-api.ts").GitSyncLinkCreate){return this.#session.createGitSyncLink(input);}
  async updateGitSyncLink(link:string,input:import("./mnemos-api.ts").GitSyncLinkUpdate){return this.#session.updateGitSyncLink(link,input);}
  async deleteGitSyncLink(link:string,expectedRevision:number){return this.#session.deleteGitSyncLink(link,expectedRevision);}
  async refreshGitSyncLink(link:string){return this.#session.refreshGitSyncLink(link);}
  async listGitAppRepositories(){return this.#session.listGitAppRepositories();}
  async startGitHubConnect(){return this.#session.startGitHubConnect();}
  async listGitHubAccounts(){return this.#session.listGitHubAccounts();}
  async disconnectGitHubAccount(installation:string){return this.#session.disconnectGitHubAccount(installation);}
  async listGitRegistrationIntents(){return this.#session.listGitRegistrationIntents();}
  async saveGitRegistrationIntent(setup:GitSetup){return this.#session.saveGitRegistrationIntent(setup);}
  async inspectGitRegistrationIntent(id:string){return this.#session.inspectGitRegistrationIntent(id);}
  async executeGitRegistrationIntent(id:string,token:string,retry:boolean){return this.#session.executeGitRegistrationIntent(id,token,retry);}
  async listAgentConnections(cursor = "") {
    if (typeof cursor !== "string" || cursor.length > 255) throw new Error("Invalid cursor");
    return this.#session.listAgentConnections(cursor);
  }
  async revokeAgentConnection(bindingId: string): Promise<void> {
    if (typeof bindingId !== "string" || !bindingId || bindingId.length > 255) throw new Error("Invalid connection");
    await this.#session.revokeAgentConnection(bindingId);
  }
  [Symbol.dispose](): void { this.#session.dispose(); }
}

// Browser login and a separately service-authenticated calendar relay are routed.
// Account preparation and credential installation are never generic HTTP RPC.
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let callbackUrl: string;
    try { callbackUrl = JSON.parse(env.MNEMOS_LOGIN_CONFIG ?? "").callbackUrl; }
    catch { return new Response("Not Found", { status: 404 }); }
    const telegram = telegramRoute(request, callbackUrl);
    if (telegram) {
      let id:DurableObjectId;
      try { id=ctx.exports.TelegramBot.idFromString(telegram); }
      catch { return new Response("Not Found", {status:404}); }
      return ctx.exports.TelegramBot.get(id).fetch(request);
    }
    const mailBridge = await handleMailBridge(request, callbackUrl, env.MNEMOS_MAIL_BRIDGE_TOKEN,
      (id,input) => ctx.exports.UserAccount.get(ctx.exports.UserAccount.idFromString(id)).resolveMailSelection(input),
      (id,input) => ctx.exports.UserAccount.get(ctx.exports.UserAccount.idFromString(id)).readMailSelection(input),
      (id,input) => ctx.exports.UserAccount.get(ctx.exports.UserAccount.idFromString(id)).stageMailDraft(input));
    if (mailBridge) return mailBridge;
    const bridge = await handleCalendarBridge(request, callbackUrl, env.MNEMOS_CALENDAR_BRIDGE_TOKEN,
      (id,input) => ctx.exports.UserAccount.get(ctx.exports.UserAccount.idFromString(id)).resolveCalendarSelection(input),
      (id,input) => ctx.exports.UserAccount.get(ctx.exports.UserAccount.idFromString(id)).readCalendarWindow(input),
      (id,input) => ctx.exports.UserAccount.get(ctx.exports.UserAccount.idFromString(id)).stageCalendarDraft(input));
    if (bridge) return bridge;
    return handleBrowserLogin(request, callbackUrl, id => ctx.exports.UserAccount.get(ctx.exports.UserAccount.idFromString(id)));
  },
};

/** Immutable private version; each observer still authorizes through their own account. */
class MnemosPrivateVersionDownload extends RpcTarget {
  #session: MnemosAccountSession;
  #project: string;
  #node: string;
  #version: string;
  #ownsSession: boolean;
  constructor(session: MnemosAccountSession, project: string, node: string, version: string, ownsSession = false) {
    super(); this.#session = session; this.#project = project; this.#node = node; this.#version = version; this.#ownsSession = ownsSession;
  }
  async issue() {
    const ticket = await this.#session.downloadPrivateVersion(this.#project, this.#node, this.#version);
    return {url: ticket.url, method: ticket.method, size_bytes: ticket.size_bytes, sha256_hex: ticket.sha256_hex, content_type: ticket.content_type};
  }
  async validate() { await this.#session.checkPrivateVersionRead(this.#project, this.#node, this.#version); }
  [Symbol.dispose]() { if (this.#ownsSession) this.#session.dispose(); }
}

/** Saved read-only CalDAV selection, with no credential accessor or write method. */
export class MnemosCalDAVReadSource extends WorkerEntrypoint<Env,{account:string;calendar:string;generation:string}> implements CalendarReadSource {
 #account(){return this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(this.ctx.props.account));}
 async validate(){await this.#account().validateCalDAVSource(this.ctx.props.calendar,this.ctx.props.generation);}
 async metadata(){return this.#account().caldavMetadata(this.ctx.props.calendar,this.ctx.props.generation);}
 async readWindow(input:Parameters<CalendarReadSource['readWindow']>[0]){return this.#account().readCalDAVWindow(this.ctx.props.calendar,this.ctx.props.generation,input);}
}
/** Separate temporary writer issued only through the host's human approval path. */
export class MnemosCalDAVWriteSource extends WorkerEntrypoint<Env,{account:string;calendar:string;generation:string}> implements CalendarWriteSource {
 #account(){return this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(this.ctx.props.account));}
 async validate(){await this.#account().validateCalDAVSource(this.ctx.props.calendar,this.ctx.props.generation);}
 async create(content:Parameters<CalendarWriteSource['create']>[0]){return this.#account().createCalDAVMeeting(this.ctx.props.calendar,this.ctx.props.generation,content);}
}

/** Owner-selected IMAP reading authority; credentials and writes are not exposed. */
export class MnemosImapReadSource extends WorkerEntrypoint<Env,{account:string;mailbox:string;generation:string}> implements MailReadSource {
 #account(){return this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(this.ctx.props.account));}
 async validate(){await this.#account().validateImapSource(this.ctx.props.mailbox,this.ctx.props.generation);}
 async metadata(){return this.#account().imapMetadata(this.ctx.props.mailbox,this.ctx.props.generation);}
 async readSelection(input:Parameters<MailReadSource['readSelection']>[0]){return this.#account().readImapSelection(this.ctx.props.mailbox,this.ctx.props.generation,input);}
}

/** Separate send authority minted by the trusted host for an approved mail draft. */
export class MnemosSmtpSendSource extends WorkerEntrypoint<Env,{account:string;mailbox:string;generation:string}> implements MailSendSource {
 #account(){return this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(this.ctx.props.account));}
 async validate(){await this.#account().validateSmtpSender(this.ctx.props.mailbox,this.ctx.props.generation);}
 async send(content:Parameters<MailSendSource['send']>[0]){return this.#account().sendSmtp(this.ctx.props.mailbox,this.ctx.props.generation,content);}
}

/** Fixed read-only WebDAV selection; credentials remain in the owning account. */
export class MnemosWebDAVImportSource extends WorkerEntrypoint<Env,{account:string;id:string;fileId:string;generation:string}> implements DriveImportSource {
 #account(){return this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(this.ctx.props.account));}
 async validate(){await this.#account().validateWebDAVSource(this.ctx.props.id,this.ctx.props.generation);}
 async read(){return this.#account().readWebDAVSource(this.ctx.props.id,this.ctx.props.generation,this.ctx.props.fileId);}
}
