import {MEMORY_UNAVAILABLE_ERROR} from "../src/mnemos-api.ts";
import {analyticsInquiry,type AnalyticsInquiry} from '../src/analytics-inquiry.ts';
import {observabilityInquiry,type ObservabilityInquiry} from '../src/observability-inquiry.ts';
import type {TeamDocumentManagement} from "../src/team-document-creation.ts";
import type {MnemosAccountSession, ManagedTaskRequest} from "../src/account-session.ts";
import type {ProjectBudgetPolicy, TeamBudgetCreate, TeamBudgetDecide, TeamBudgetProposal} from "../src/mnemos-api.ts";
import {parseBudgetUSD, formatBudgetUSD} from "./budget-money.ts";

type API = Pick<TeamDocumentManagement,"readTeamResultDraft"|"createTeamResultDocument"> & Pick<MnemosAccountSession, "readTeamMemberInputs" | "readTeamResultContribution" | "recordTeamResultContribution" | "readTeamMemberActivity" | "readTeamMemberObservation" | "readTeamResultReview" | "prepareTeamBudgetReview" | "readTeamBudgetUsage" | "readProjectBudget" | "listTeamBudgets" | "readTeamBudget" | "createTeamBudget" | "decideTeamBudget" | "listAgentConnections" | "runTeamBudgetMember" | "readTeamBudgetMember" | "cancelTeamBudgetMember">;
const states: Record<string,string> = {awaiting_source_approval:"Ожидает выбора входа владельцем",source_approved:"Владелец создал отдельную попытку",awaiting_approval:"Ожидает согласования", approved:"Согласовано", rejected:"Отклонено", revoked:"Отозвано", policy_changed:"Политика изменилась — нужна новая заявка"};
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "") {const e = document.createElement(tag); e.textContent = text; return e;}

/** Financial proposals and explicit execution of the current human’s owned members. */
export class TeamBudgetView {
 private prepared?:Awaited<ReturnType<API["readTeamResultDraft"]>>;
 private created?:{node_id:string;head:string};
 private contributions = new Map<string, Awaited<ReturnType<API["readTeamResultContribution"]>>>();
 private pendingContributions = new Map<string, Parameters<API["recordTeamResultContribution"]>[3]>();
 private activities = new Map<string, Awaited<ReturnType<API["readTeamMemberActivity"]>>>();
 private observations = new Map<string, Awaited<ReturnType<API["readTeamMemberObservation"]>>>();
 private reviews = new Map<string, Awaited<ReturnType<API["readTeamResultReview"]>>>();
 private usage?: Awaited<ReturnType<API["readTeamBudgetUsage"]>>;
 private comparison?: {label:string;result:Awaited<ReturnType<API["readTeamBudgetMember"]>>;inputs:Awaited<ReturnType<API["readTeamMemberInputs"]>>;usage:Awaited<ReturnType<API["readTeamBudgetUsage"]>>;review:Awaited<ReturnType<API["readTeamResultReview"]>>}[];
 private busy = false;
 private closed = false;
 private notice = "";
 private policy?: ProjectBudgetPolicy;
 private page?: Awaited<ReturnType<API["listTeamBudgets"]>>;
 private selected?: TeamBudgetProposal;
 private form?: {tracker?:TeamBudgetCreate["tracker"];task: string; criteria: string; members: string; estimate: string; limit: string};
 private rework?: TeamBudgetCreate["rework"];
 private replay?: TeamBudgetCreate["replay"];
 private replayRole = "";
 private analytics = false;
 private reviewRequest?: TeamBudgetProposal;
 private pending?: TeamBudgetCreate & {request_id: string};
 private pendingDecision?: {id: string; input: TeamBudgetDecide};
 private comment = "";
 private owned = new Set<string>();
 private inputs = new Map<string, Awaited<ReturnType<API["readTeamMemberInputs"]>>>();
 private outcomes = new Map<string, Awaited<ReturnType<API["readTeamBudgetMember"]>>>();

 constructor(private root: HTMLElement, private api: API, private project: string, private onClose: (review?: ManagedTaskRequest) => void, private requester="") {}
 private button(text: string, action: () => void) {const b = el("button",text); b.type="button"; b.disabled=this.busy; b.onclick=action; return b;}
 async load(cursor = "") {
  if(this.busy || this.closed) return; this.analytics=false; this.busy=true; this.notice=""; this.render();
  try {
   const [policy,page,owned] = await Promise.all([this.api.readProjectBudget(this.project),this.api.listTeamBudgets(this.project,cursor),this.ownedMembers()]);
   if(!this.closed) {this.policy=policy; this.page=page; this.owned=owned; this.selected=undefined;this.reviewRequest=undefined;this.outcomes.clear();this.inputs.clear();this.reviews.clear();this.observations.clear();this.activities.clear();this.contributions.clear();this.pendingContributions.clear();this.prepared=undefined;this.created=undefined;this.usage=undefined;this.comparison=undefined;}
  } catch {this.policy=undefined;this.page=undefined;this.selected=undefined;this.reviewRequest=undefined;this.notice="Заявки недоступны. Обновите список после восстановления доступа.";}
  finally {this.busy=false;this.render();}
 }
 prepareAnalytics(source:AnalyticsInquiry){
  if(this.closed||this.busy||!this.policy||source.project!==this.project||this.pending)return;
  const terms=analyticsInquiry(source);this.analytics=true;this.selected=undefined;this.reviewRequest=undefined;this.rework=undefined;this.replay=undefined;
  this.form={task:terms.task,criteria:terms.criteria,members:'',estimate:'0',limit:'0'};
  this.notice='Выберите агента и бюджет аналитического запроса. Подготовка заявки ещё не запускает модель.';this.render();
 }
 prepareObservability(source:ObservabilityInquiry){
  if(this.closed||this.busy||!this.policy||source.project!==this.project||this.pending)return;
  const terms=observabilityInquiry(source);this.analytics=true;this.selected=undefined;this.reviewRequest=undefined;this.rework=undefined;this.replay=undefined;
  this.form={task:terms.task,criteria:terms.criteria,members:'',estimate:'0',limit:'0'};
  this.notice='Проверьте задание, выберите своего агента с инструментами чтения карты и источников и задайте бюджет. Подготовка не запускает модель.';this.render();
 }
 prepareRework(proposal: TeamBudgetCreate) {
  this.analytics=false;
  if(this.closed||!this.policy)return;
  this.replay=undefined;this.replayRole="";this.rework=proposal.rework;this.selected=undefined;this.reviewRequest=undefined;this.outcomes.clear();this.inputs.clear();this.reviews.clear();this.observations.clear();this.activities.clear();this.contributions.clear();this.pendingContributions.clear();this.prepared=undefined;this.created=undefined;this.usage=undefined;this.comparison=undefined;
  this.form={tracker:proposal.tracker,task:proposal.task,criteria:proposal.criteria,members:proposal.members.map(m=>`${m.binding_id} | ${m.role}`).join("\n"),estimate:formatBudgetUSD(proposal.estimate_usd_micros),limit:formatBudgetUSD(proposal.limit_usd_micros)};this.render();
 }
 private prepareReplay(binding:string, callID:string) {
  if(this.busy||this.closed||this.pending||!this.selected||this.selected.proposal.replay)return;
  const recorded=this.inputs.get(binding),source=this.selected;
  const call=recorded?.model_inputs?.find(c=>c.call_id===callID&&c.task_start);
  const member=source.proposal.members.find(m=>m.binding_id===binding);
  if(!recorded?.input_manifest_sha256||recorded.history_versions_available!==true||!call||!member||!this.owned.has(binding))return;
  const request=this.reviewRequest, terms=request?.proposal.replay_request;
  if(request&&(!terms||request.state!=="awaiting_source_approval"||terms.source_proposal_id!==source.id||terms.source_binding_id!==binding||request.proposal.policy_revision!==this.policy?.revision||request.proposal.members.length!==1||!this.owned.has(request.proposal.members[0].binding_id)))return;
  this.replay={source_proposal_id:source.id,source_binding_id:binding,source_request_id:recorded.request_id,source_call_id:call.call_id,source_input_sha256:call.input_sha256,source_manifest_sha256:recorded.input_manifest_sha256,target_model:""};
  this.replayRole=member.role;this.rework=undefined;this.selected=undefined;this.reviewRequest=undefined;
  this.form={tracker:source.proposal.tracker,task:source.proposal.task,criteria:source.proposal.criteria,members:"",estimate:"0",limit:"0"};
  if(request&&terms) {
   this.replay.request_proposal_id=request.id;this.replay.target_model=terms.target_model;
   this.form.members=`${request.proposal.members[0].binding_id} | ${request.proposal.members[0].role}`;
   this.form.estimate=formatBudgetUSD(request.proposal.estimate_usd_micros);this.form.limit=formatBudgetUSD(request.proposal.limit_usd_micros);
  }
  this.notice=request?"Проверьте выбранный вход и сохраните отдельную попытку на предложенных условиях.":"Выберите отдельного агента с другой настроенной моделью и задайте бюджет новой попытки.";this.render();
 }
 private async considerRequest() {
  const selected=this.selected;if(this.busy||this.pending||!selected?.proposal.replay_request)return;
  this.busy=true;this.notice="";this.render();
  let request:TeamBudgetProposal;
  try {request=await this.api.readTeamBudget(this.project,selected.id);}
  catch {this.notice="Предложение недоступно.";this.busy=false;this.render();return;}
  this.busy=false;if(this.closed)return;
  const intent=request.proposal.replay_request;
  if(request.state!=="awaiting_source_approval"||!intent){this.selected=request;this.render();return;}
  await this.open(intent.source_proposal_id);
  if(this.closed)return;
  if(this.selected?.id!==intent.source_proposal_id||this.policy?.revision!==request.proposal.policy_revision||!this.owned.has(intent.source_binding_id)||request.proposal.members.length!==1||!this.owned.has(request.proposal.members[0].binding_id)) {
   this.notice="Нужны текущие права владельца обоих агентов и неизменная политика бюджета.";this.render();return;
  }
  this.reviewRequest=request;
  await this.readInputs(intent.source_binding_id);
  if(this.inputs.has(intent.source_binding_id)){this.notice="Выберите сохранённый начальный вызов для предложения агента.";this.render();}
 }
 private async open(id: string) {
  if(this.busy) return; this.busy=true;this.selected=undefined;this.reviewRequest=undefined;this.outcomes.clear();this.inputs.clear();this.reviews.clear();this.observations.clear();this.activities.clear();this.contributions.clear();this.pendingContributions.clear();this.prepared=undefined;this.created=undefined;this.usage=undefined;this.comparison=undefined;this.notice="";this.render();
  try {const [proposal,policy,owned]=await Promise.all([this.api.readTeamBudget(this.project,id),this.api.readProjectBudget(this.project),this.ownedMembers()]);if(!this.closed){this.selected=proposal;this.policy=policy;this.owned=owned;this.comment="";}}
  catch {this.notice="Заявка недоступна.";}
  finally {this.busy=false;this.render();}
 }
 private async submit() {
  if(this.busy || !this.form || !this.policy) return;
  try {
   if(!this.pending) {
    const f=this.form;
    const members=f.members.trim().split("\n").map(line=>{const split=line.indexOf("|");if(split<1) throw new Error("member");return {binding_id:line.slice(0,split).trim(),role:line.slice(split+1).trim()};});
    if(!f.task.trim() || !f.criteria.trim() || members.some(m=>!m.role || !m.binding_id)) throw new Error("terms");
    const estimate=parseBudgetUSD(f.estimate),limit=parseBudgetUSD(f.limit);
    if(BigInt(limit)<=0n || BigInt(estimate)>BigInt(limit)) throw new Error("amount");
    if(this.replay&&(!this.replay.target_model.trim()||members.length!==1||members[0].binding_id===this.replay.source_binding_id||!this.owned.has(members[0].binding_id)))throw new Error("replay terms");
    this.pending={request_id:crypto.randomUUID(),policy_revision:this.policy.revision,...(f.tracker?{tracker:f.tracker}:{}),task:f.task,criteria:f.criteria,members,estimate_usd_micros:estimate,limit_usd_micros:limit,...(this.rework?{rework:this.rework}:{}),...(this.replay?{replay:{...this.replay}}:{})};
   }
  } catch {this.notice="Заполните задачу, критерии, участников и суммы. Участник: ID подключения | роль, по одному на строку.";this.render();return;}
  this.busy=true;this.notice="";this.render();
  try {const result=await this.api.createTeamBudget(this.project,this.pending);if(!this.closed){this.outcomes.clear();this.inputs.clear();this.reviews.clear();this.observations.clear();this.activities.clear();this.contributions.clear();this.pendingContributions.clear();this.prepared=undefined;this.created=undefined;this.usage=undefined;this.comparison=undefined;this.selected=result;this.form=undefined;this.pending=undefined;this.rework=undefined;this.replay=undefined;this.replayRole="";this.notice="Заявка сохранена.";}}
  catch {this.notice="Сохранение не подтверждено. Повтор отправляет тот же идентификатор и условия. При изменении политики откройте бюджет заново.";}
  finally {this.busy=false;this.render();}
 }
 private async decide(decision: TeamBudgetDecide["decision"]) {
  if(this.busy || !this.selected || !this.policy) return;
  if(!this.pendingDecision) {
   if(!this.comment.trim()){this.notice="Укажите обоснование решения.";this.render();return;}
   this.pendingDecision={id:this.selected.id,input:{decision_id:crypto.randomUUID(),expected_revision:this.selected.decision?.revision??0,policy_revision:this.policy.revision,decision,comment:this.comment}};
  }
  this.busy=true;this.notice="";this.render();
  try {
   await this.api.decideTeamBudget(this.project,this.pendingDecision.id,this.pendingDecision.input);
   const id=this.pendingDecision.id;this.pendingDecision=undefined;
   this.selected=undefined;this.reviewRequest=undefined;
   const result=await this.api.readTeamBudget(this.project,id);
   if(!this.closed){this.selected=result;this.notice="Решение сохранено.";}
  } catch {this.selected=undefined;this.reviewRequest=undefined;this.notice="Решение не подтверждено. Повторите запрос или перечитайте заявку; устаревшее решение не перезаписывается.";}
  finally {this.busy=false;this.render();}
 }
 private async compareReplay() {
  const proposal=this.selected,replay=proposal?.proposal.replay,target=proposal?.proposal.members[0];
  if(this.busy||this.closed||!proposal||!replay||!target||!this.owned.has(target.binding_id))return;
  this.busy=true;this.notice="";this.comparison=undefined;this.render();
  try {
   const comparison=await Promise.all([
    {label:"Исходный результат",proposal:replay.source_proposal_id,binding:replay.source_binding_id},
    {label:"Результат повтора",proposal:proposal.id,binding:target.binding_id},
   ].map(async item=>{
    // Bound fan-out through the management session. Each owned runtime read
    // also refreshes its binding credential before consulting AgenticOS.
    const result=await this.api.readTeamBudgetMember(this.project,item.proposal,item.binding);
    const inputs=await this.api.readTeamMemberInputs(this.project,item.proposal,item.binding);
    const [usage,review]=await Promise.all([
     this.api.readTeamBudgetUsage(this.project,item.proposal),
     this.api.readTeamResultReview(this.project,item.proposal,item.binding),
    ]);
    if(result.state!=="completed"||!result.result||inputs.request_id!==result.request_id)throw new Error("Completed comparison required");
    return {label:item.label,result,inputs,usage,review};
   }));
   if(comparison[0].result.request_id!==replay.source_request_id||comparison[0].inputs.input_manifest_sha256!==replay.source_manifest_sha256||!comparison[0].inputs.model_inputs?.some(c=>c.call_id===replay.source_call_id&&c.input_sha256===replay.source_input_sha256)||comparison[1].inputs.input_manifest?.model_id!==replay.target_model)throw new Error("Pinned comparison required");
   if(!this.closed&&this.selected?.id===proposal.id)this.comparison=comparison;
  } catch {this.notice="Сравнение недоступно. Нужны два завершённых результата и текущий доступ к обоим подключениям и заявкам.";}
  finally {this.busy=false;this.render();}
 }
 private async readInputs(binding:string) {
  if(this.busy||!this.selected)return;
  this.busy=true;this.notice="";this.inputs.delete(binding);this.render();
  try {const result=await this.api.readTeamMemberInputs(this.project,this.selected.id,binding);if(!this.closed)this.inputs.set(binding,result);}
  catch {this.notice="Версии входов недоступны. Требуется текущий доступ владельца агента.";}
  finally {this.busy=false;this.render();}
 }
 private async prepareReview(binding: string) {
  if(this.busy || !this.selected) return;this.busy=true;this.notice="";this.render();
  try {const review=await this.api.prepareTeamBudgetReview(this.project,this.selected.id,binding);if(!this.closed){this.closed=true;this.onClose(review);}}
  catch {this.notice="Не удалось открыть приёмку. Завершите текущую задачу, проверьте историю и доступ к результату.";}
  finally {this.busy=false;if(!this.closed)this.render();}
 }
 private async prepareDocument() {
  if(this.busy||!this.selected||this.closed)return;this.busy=true;this.notice="";this.prepared=undefined;this.created=undefined;this.render();
  try {const out=await this.api.readTeamResultDraft(this.project,this.selected.id);if(!this.closed)this.prepared=out;}
  catch {this.notice="Снимок общего итога недоступен.";}
  finally {this.busy=false;this.render();}
 }
 private async createDocument() {
  if(this.busy||!this.selected||!this.prepared?.document||this.closed)return;this.busy=true;this.notice="";this.render();
  try {const out=await this.api.createTeamResultDocument(this.project,this.selected.id,this.prepared.source.snapshot_sha256);if(!this.closed){this.created=out;this.notice="Документ сохранён в личном черновике проекта. Он доступен в Docs через «Открыть из Mnemos».";}}
  catch {this.notice="Создание не подтверждено. Повтор сохранит тот же документ; если части изменились до создания, подготовьте снимок заново.";}
  finally {this.busy=false;this.render();}
 }
 private async readContribution(binding: string) {
  if(this.busy||!this.selected||this.closed)return;
  this.busy=true;this.contributions.delete(binding);this.notice="";this.render();
  try {const out=await this.api.readTeamResultContribution(this.project,this.selected.id,binding);if(!this.closed)this.contributions.set(binding,out);}
  catch {this.notice="Общая часть результата недоступна.";}
  finally {this.busy=false;this.render();}
 }
 private async contribute(binding: string, state:"shared"|"withdrawn") {
  if(this.busy||!this.selected||this.closed)return;
  this.busy=true;this.notice="";this.contributions.delete(binding);this.render();
  const proposal=this.selected.id;
  try {
   let input=this.pendingContributions.get(binding);
   if(!input) {
    const current=await this.api.readTeamResultContribution(this.project,proposal,binding);
    if(state==="shared") {
     const [review,result]=await Promise.all([this.api.readTeamResultReview(this.project,proposal,binding),this.api.readTeamBudgetMember(this.project,proposal,binding)]);
     if(review.state!=="accepted"||!review.review||result.state!=="completed"||!result.result||result.request_id!==review.review.runtime_request_id)throw new Error("Accepted result required");
     input={client_id:crypto.randomUUID(),expected_revision:current.revision,review_revision:review.revision,runtime_request_id:result.request_id,result_sha256:review.review.result_sha256,state,content:result.result.content};
    } else {
     if(!current.revision)throw new Error("Shared result required");
     input={client_id:crypto.randomUUID(),expected_revision:current.revision,review_revision:current.review_revision,runtime_request_id:current.runtime_request_id,result_sha256:current.result_sha256,state,content:""};
    }
    this.pendingContributions.set(binding,input);
   }
   await this.api.recordTeamResultContribution(this.project,proposal,binding,input);
   this.pendingContributions.delete(binding);
   const current=await this.api.readTeamResultContribution(this.project,proposal,binding);
   if(!this.closed){this.contributions.set(binding,current);this.notice="Состояние передачи перечитано.";}
  } catch {this.notice="Передача или отзыв не подтверждены. Повтор сохраняет тот же запрос; проверьте приёмку, доступ и текущую общую часть.";}
  finally {this.busy=false;this.render();}
 }
 private async readActivity(binding: string, after = "0") {
  if(this.busy || !this.selected || this.closed) return;
  this.busy=true;this.activities.delete(binding);this.notice="";this.render();
  try {const page=await this.api.readTeamMemberActivity(this.project,this.selected.id,binding,after);if(!this.closed)this.activities.set(binding,page);}
  catch {this.notice="Журнал недоступен. Проверьте доступ к заявке и подключение агента.";}
  finally {this.busy=false;this.render();}
 }
 private async readObservation(binding: string) {
  if(this.busy || !this.selected) return;this.busy=true;this.observations.delete(binding);this.notice="";this.render();
  try {const result=await this.api.readTeamMemberObservation(this.project,this.selected.id,binding);if(!this.closed)this.observations.set(binding,result);}
  catch {this.notice="Статус недоступен. Проверьте доступ к заявке и подключение агента.";}
  finally {this.busy=false;this.render();}
 }
 private async readReview(binding: string) {
  if(this.busy || !this.selected) return;this.busy=true;this.reviews.delete(binding);this.notice="";this.render();
  try {const result=await this.api.readTeamResultReview(this.project,this.selected.id,binding);if(!this.closed)this.reviews.set(binding,result);}
  catch {this.notice="Общая приёмка недоступна. Проверьте доступ к заявке.";}
  finally {this.busy=false;this.render();}
 }
 private async readUsage() {
  if(this.busy || !this.selected) return;this.busy=true;this.usage=undefined;this.comparison=undefined;this.notice="";this.render();
  try {const usage=await this.api.readTeamBudgetUsage(this.project,this.selected.id);if(!this.closed)this.usage=usage;}
  catch {this.notice="Расходы недоступны. Учёт runtime или права не подтверждены.";}
  finally {this.busy=false;this.render();}
 }
 private async ownedMembers() {
  const ids=new Set<string>(), cursors=new Set<string>(); let cursor="";
  do {
   if(cursors.has(cursor)) throw new Error("catalog cursor repeated"); cursors.add(cursor);
   const page=await this.api.listAgentConnections(cursor);
   for(const item of page.connections) if(!item.revoked && item.runtime_id!=="external") ids.add(item.binding_id);
   cursor=page.next_cursor??"";
  } while(cursor);
  return ids;
 }
 private async memberAction(binding: string, action: "run"|"read"|"cancel") {
  if(this.busy || !this.selected || this.closed) return;
  const id=this.selected.id;this.busy=true;this.outcomes.delete(binding);this.notice="";this.render();
  try {
   if(action==="cancel") {await this.api.cancelTeamBudgetMember(this.project,id,binding);this.notice="Дальнейшие вызовы участника отменены. Уже начатый вызов может завершиться.";}
   else {
    const out=await (action==="run"?this.api.runTeamBudgetMember(this.project,id,binding):this.api.readTeamBudgetMember(this.project,id,binding));
    if(!this.closed) {this.outcomes.set(binding,out);this.notice=action==="run"?"Запрос выполнения обработан.":"Результат перечитан.";}
   }
  } catch(error) {this.notice=error instanceof Error&&error.message===MEMORY_UNAVAILABLE_ERROR?"Запуск остановлен до выполнения: личная память недоступна агенту. Проверьте выбранный источник памяти и права доступа.":"Операция участника не подтверждена. Проверьте результат перед повтором запуска. Нужны действующие права, согласование и настроенное выполнение AgenticOS.";}
  finally {this.busy=false;this.render();}
 }
 render() {
  if(this.closed)return;
  const root=this.root;root.replaceChildren(el("h2","Заявки на команду"),el("p","Финансовое согласование и запуск участников. Каждый владелец запускает своих агентов. Текст и роль берутся из согласованной заявки."));
  if(this.policy)root.append(el("p",`Владелец бюджета: ${this.policy.owner_id}. Ревизия ${this.policy.revision}.`));
  if(this.notice)root.append(el("p",this.notice));
  if(this.pendingDecision)root.append(this.button("Повторить финансовое решение",()=>{
   // Reopen retains the exact pending decision; it never replaces its revision.
   void (async()=>{await this.open(this.pendingDecision!.id);if(this.selected)await this.decide(this.pendingDecision!.input.decision);})();
  }));
  if(this.form) {
   if(this.rework)root.append(el("p",`Доработка заявки ${this.rework.proposal_id}. Исходные задача и критерии сохранены.`),el("p",this.rework.comment));
   if(this.replay) {
    if(this.replay.request_proposal_id)root.append(el("p",`Принятие предложения ${this.replay.request_proposal_id}. Модель, участник и бюджет сохранены из предложения.`));
    root.append(el("p",`Повтор заявки ${this.replay.source_proposal_id}. Исходные задача, роль и критерии сохранены.`));
    const target=el("select");target.setAttribute("aria-label","Агент для повтора");target.disabled=this.busy||!!this.pending||!!this.replay.request_proposal_id;
    const empty=el("option","Выберите отдельного агента");empty.value="";target.append(empty);
    for(const binding of this.owned)if(binding!==this.replay.source_binding_id){const option=el("option",binding);option.value=binding;target.append(option);}
    target.value=this.form.members.split("|")[0].trim();target.onchange=()=>{this.form!.members=target.value?`${target.value} | ${this.replayRole}`:"";};
    const model=el("input");model.setAttribute("aria-label","ID модели выбранного агента");model.value=this.replay.target_model;model.disabled=this.busy||!!this.pending||!!this.replay.request_proposal_id;model.oninput=()=>{this.replay!.target_model=model.value.trim();};
    root.append(el("label","Агент для повтора"),target,el("label","ID модели выбранного агента"),model,el("p","Модель должна совпадать с настройкой выбранного агента. Новая заявка не меняет его настройку и не возобновляет старые разрешения."));
   }
  for(const [key,label] of [["task","Задача команды"],["criteria","Критерии результата команды"],["members","Участники команды: ID подключения | роль"],["estimate","Ожидаемая стоимость команды, USD"],["limit","Предел расходов команды, USD"]] as const) {
    if(this.replay&&key==="members")continue;
    if(this.analytics&&!this.rework&&key==='members'){
     const select=el('select');select.setAttribute('aria-label','Агент-аналитик');select.disabled=this.busy||!!this.pending;
     const empty=el('option','Выберите своего агента');empty.value='';select.append(empty);
     let index=0;for(const binding of this.owned){const option=el('option',`Агент ${++index} · ${binding.slice(-8)}`);option.value=binding;select.append(option);}
     select.value=this.form.members.split('|')[0].trim();select.onchange=()=>{this.form!.members=select.value?`${select.value} | Аналитик`:'';};
     root.append(el('label','Агент-аналитик'),select);continue;
    }
    const field=el("textarea");field.setAttribute("aria-label",label);field.value=this.form[key];field.disabled=this.busy||!!this.pending||!!this.replay?.request_proposal_id||(!!this.rework||!!this.replay)&&(key==="task"||key==="criteria");field.oninput=()=>{this.form![key]=field.value;};root.append(el("label",label),field);
   }
   root.append(this.button(this.pending?"Повторить заявку команды":"Сохранить заявку команды",()=>void this.submit()));
  } else if(this.policy && !this.pendingDecision) root.append(this.button("Новая заявка команды",()=>{this.analytics=false;this.selected=undefined;this.reviewRequest=undefined;this.replay=undefined;this.rework=undefined;this.form={task:"",criteria:"",members:"",estimate:"0",limit:"0"};this.render();}));
  if(this.selected) {
   const r=this.selected;if(r.proposal.tracker)root.append(el("p",`Рабочий трекер в этом проекте: ${r.proposal.tracker.node_id}`));if(r.proposal.rework)root.append(el("p",`Доработка заявки ${r.proposal.rework.proposal_id}. Исходный запрос: ${r.proposal.rework.request_id}.`),el("p",r.proposal.rework.comment),el("h3","Исходный результат доработки"),el("pre",r.proposal.rework.result_content));root.append(el("h3",states[r.state]??r.state),el("p",`Заявка ${r.id}. Автор: ${r.agent_id||r.user_id}.`),el("p",r.proposal.task),el("p",r.proposal.criteria),el("p",`Оценка: ${formatBudgetUSD(r.proposal.estimate_usd_micros)} USD. Предел: ${formatBudgetUSD(r.proposal.limit_usd_micros)} USD. Участников: ${r.proposal.members.length}.`));
   if(this.reviewRequest)root.append(el("p",`Рассмотрение предложения ${this.reviewRequest.id}. Автор: ${this.reviewRequest.agent_id||this.reviewRequest.user_id}.`),el("p",this.reviewRequest.proposal.replay_request!.reason));
   if(r.proposal.replay_request) {
    const intent=r.proposal.replay_request;
    root.append(el("p",`Предложение повторить ${intent.source_proposal_id} на модели ${intent.target_model}.`),el("p",intent.reason),el("p","Это предложение не запускается. Владелец выбирает сохранённый вход; новая попытка получает отдельный бюджет."));
    if(r.accepted_proposal_id)root.append(this.button("Открыть принятую попытку",()=>void this.open(r.accepted_proposal_id!)));
    else if(r.state==="awaiting_source_approval"&&this.owned.has(intent.source_binding_id))root.append(this.button("Рассмотреть предложение повтора",()=>void this.considerRequest()));
   }
   if(r.proposal.replay) {const replay=r.proposal.replay;root.append(el("p",`Повтор исходной заявки ${replay.source_proposal_id}. Модель новой попытки: ${replay.target_model}.`),el("pre",`Исходный вызов: ${replay.source_call_id}\nSHA входа: ${replay.source_input_sha256}`));}
   if(r.proposal.replay&&r.proposal.members[0]&&this.owned.has(r.proposal.members[0].binding_id)) {
    root.append(this.button("Сравнить исходный результат и повтор",()=>void this.compareReplay()));
    if(this.comparison) {
     root.append(el("h3","Сравнение по исходным критериям"),el("pre",r.proposal.criteria));
     const left=this.comparison[0].inputs.input_manifest,right=this.comparison[1].inputs.input_manifest;
     if(left&&right) for(const [key,label] of [["system_prompt_sha256","Системная инструкция"],["tool_catalog_sha256","Каталог инструментов"],["memory_context_sha256","Контекст памяти"],["limits_sha256","Настройки и тарифы"]] as const)root.append(el("p",`${label}: ${left[key]===right[key]?"совпадает":"отличается"}.`));
     root.append(el("p",this.comparison[0].result.result?.content===this.comparison[1].result.result?.content?"Тексты результатов совпадают.":"Тексты результатов различаются; проверьте каждый по критериям."));
     for(const item of this.comparison) {
      root.append(el("h3",item.label),el("p",`Модель: ${item.inputs.input_manifest?.model_id??"не записана"}. Запрос: ${item.result.request_id}.`),el("pre",item.result.result!.content));
      root.append(el("p",`Расход всей заявки: ${formatBudgetUSD(item.usage.actual_usd_micros)} USD; открытые резервы: ${formatBudgetUSD(item.usage.reserved_usd_micros)} USD. Учёт: ${item.usage.runtime_id}, по токенам.`));
      root.append(el("p",`Приёмка: ${item.review.state==="accepted"?"принят":item.review.state==="changes_requested"?"нужна доработка":"ещё не проверен"}.`));
      for(const call of item.inputs.model_inputs??[])root.append(el("pre",`Вызов: ${call.call_id}\nSHA входа: ${call.input_sha256}`));
     }
     root.append(el("p","Старые вызовы инструментов не исполняются повторно, подписи старой модели не переносятся. Новые действия проверяют текущие разрешения."),this.button("Проверить повтор по критериям",()=>void this.prepareReview(r.proposal.members[0].binding_id)));
    }
   }
   if(!r.proposal.replay_request) {
   root.append(this.button("Подготовить общий документ",()=>void this.prepareDocument()));
   if(this.prepared) {
    root.append(el("p",this.prepared.source.all_parts_shared?"Все части переданы и приняты. Будет сохранена копия этого снимка для редактирования; приёмка общего документа отдельно.":"Общий документ пока не готов: нужны актуально принятые и переданные части всех участников."));
    for(const part of this.prepared.source.parts)root.append(el("p",`${part.role}: ${{shared:"передано и принято",unshared:"не передано",withdrawn:"передача отозвана",review_changed:"приёмка изменилась"}[part.contribution.state]}`));
    if(this.prepared.document&&!this.created)root.append(this.button("Сохранить общий документ в Mnemos",()=>void this.createDocument()));
    if(this.created)root.append(el("p",`Документ «Итог команды ${r.id.slice(0,12)}» сохранён. ID: ${this.created.node_id}`));
   }
   root.append(this.button("Обновить расходы команды",()=>void this.readUsage()));
   if(this.usage) {const u=this.usage;root.append(el("p",`Учёт ${u.runtime_id}: ${formatBudgetUSD(u.actual_usd_micros)} USD по токенам; ${formatBudgetUSD(u.reserved_usd_micros)} USD в незакрытых резервах. Ожидают завершения: ${u.pending_calls}. Превышения: ${u.overrun_calls}.`),el("p","Снимок расходов этого runtime на момент запроса. Расходы внешних подключений учитываются отдельно; сверка со счётом провайдера ещё не выполнена."));}
   for(const m of r.proposal.members) {
    root.append(el("p",`${m.binding_id} — ${m.role}`));
    root.append(this.button(`Общая приёмка ${m.binding_id}`,()=>void this.readReview(m.binding_id)));
    root.append(this.button(`Статус участника ${m.binding_id}`,()=>void this.readObservation(m.binding_id)));
    root.append(this.button(`Действия участника ${m.binding_id}`,()=>void this.readActivity(m.binding_id)));
    const activity=this.activities.get(m.binding_id);
    if(activity) {
     const labels={task_started:"Задача начата",tool_called:"Инструмент вызван",tool_responded:"Ответ инструмента получен",tool_failed:"Ошибка инструмента",task_completed:"Выполнение завершено"};
     root.append(el("p",activity.checkpoint_found?"Сохранённые события задачи. Ответ инструмента не означает приёмку результата.":"В журнале нет подтверждённой границы этой задачи."));
     for(const event of activity.events)root.append(el("p",`${event.created_at} · ${labels[event.kind]} · № ${event.sequence}`));
     if(activity.next_sequence)root.append(this.button(`Следующие действия ${m.binding_id}`,()=>void this.readActivity(m.binding_id,activity.next_sequence!)));
    }
    const observation=this.observations.get(m.binding_id);
    if(observation)root.append(el("p",observation.state==="completed"?"Выполнение завершено. Приёмка результата отдельно.":observation.state==="budget_blocked"?"Остановлено бюджетом. Согласуйте новую заявку с достаточным лимитом; прежняя задача автоматически не повторяется.":observation.state==="absent"?"Запись выполнения отсутствует.":"Завершение не подтверждено. Этот статус не подтверждает, что агент сейчас работает."));
    root.append(this.button(`Общая часть ${m.binding_id}`,()=>void this.readContribution(m.binding_id)));
    const contribution=this.contributions.get(m.binding_id);
    if(contribution) {
     const labels={unshared:"Результат ещё не передан команде.",shared:"Принятый результат передан команде.",withdrawn:"Передача результата отозвана.",review_changed:"Приёмка изменилась — часть требует повторной передачи."};
     root.append(el("p",labels[contribution.state]));
     if(contribution.content)root.append(el("pre",contribution.content));
    }
    const review=this.reviews.get(m.binding_id);
    if(review)root.append(el("p",review.state==="unreviewed"?"Общее решение ещё не записано.":review.state==="accepted"?"Результат принят.":"Требуется доработка."));
    if(review?.review)root.append(el("p",`${review.review.user_id} · ${review.review.created_at} · ревизия ${review.revision}`),el("p",review.review.comment));
    if(this.owned.has(m.binding_id)) {
     root.append(this.button(`Версии входов ${m.binding_id}`,()=>void this.readInputs(m.binding_id)));
     const recorded=this.inputs.get(m.binding_id);
     if(recorded) {
      const v=recorded.input_manifest;
      if(!recorded.checkpoint_found)root.append(el("p","Запись начала задачи не найдена. Версии входов не подтверждены."));
      else if(!v)root.append(el("p","В этом старом запуске версии входов не записаны."));
      else {
       root.append(el("p",`Модель: ${v.model_id}. Версия записи: ${v.format_version}.`));
       root.append(el("p",v.memory.enabled?`Память: ${v.memory.project_id} / ${v.memory.node_id}; ревизия выбора ${v.memory.selection_revision}; версия ${v.memory.head}.`:"Личная память была отключена."));
       root.append(el("pre",`Задача: ${v.message_sha256}\nСистемная инструкция: ${v.system_prompt_sha256}\nКаталог инструментов: ${v.tool_catalog_sha256}\nНастройки запуска: ${v.limits_sha256}\nКонтекст памяти: ${v.memory_context_sha256}`));
       root.append(el("p","Точная внутренняя версия модели у провайдера не закреплена."));
       root.append(el("p",recorded.history_versions_available===true?"Версии истории доступны. Текущие права и данные перепроверяются при запуске.":"Повтор недоступен: версии прошлой истории отсутствуют или не позволяют проверить исходные данные. Нужна новая задача с полной записью версий."));
       if(recorded.input_manifest_sha256) root.append(el("pre",`Запись входов: ${recorded.input_manifest_sha256}`));
       if(!recorded.model_inputs?.length) root.append(el("p","Сохранённые входы завершённой задачи не найдены."));
       for(const input of recorded.model_inputs??[]) {
        root.append(el("p",`${input.task_start?"Начальный вызов задачи":"Продолжение задачи"}: ${input.call_id}. Модель: ${input.model_id}; сообщений: ${input.message_count}; инструментов: ${input.tool_count}; байт: ${input.size_bytes}.`));
        root.append(el("pre",`Сохранённый вход: ${input.input_sha256}`));
        if(input.task_start&&recorded.input_manifest_sha256&&recorded.history_versions_available===true&&!r.proposal.replay)root.append(this.button(`${this.reviewRequest?"Выбрать вход для предложения":"Повторить на другой модели"} ${input.call_id}`,()=>this.prepareReplay(m.binding_id,input.call_id)));
       }
       if(recorded.model_inputs?.length) root.append(el("p","Содержимое входов хранится приватно. Повтор требует новой заявки и актуального доступа к источнику."));
      }
     }

     const pending=this.pendingContributions.get(m.binding_id);
     if(pending)root.append(this.button(`Повторить передачу/отзыв ${m.binding_id}`,()=>void this.contribute(m.binding_id,pending.state)));
     else {
      root.append(el("p","Передача откроет точный принятый результат текущим читателям заявки. Отзыв не удаляет уже прочитанные копии."));
      root.append(this.button(`Передать результат команде ${m.binding_id}`,()=>void this.contribute(m.binding_id,"shared")),this.button(`Отозвать общую часть ${m.binding_id}`,()=>void this.contribute(m.binding_id,"withdrawn")));
     }

     if(r.state === "approved") root.append(this.button(`Запустить участника ${m.binding_id}`,()=>void this.memberAction(m.binding_id,"run")));
     root.append(this.button(`Проверить результат ${m.binding_id}`,()=>void this.memberAction(m.binding_id,"read")),this.button(`Отменить дальнейшие вызовы ${m.binding_id}`,()=>void this.memberAction(m.binding_id,"cancel")));
     const out=this.outcomes.get(m.binding_id);
     if(out?.state==="completed") root.append(this.button(`Принять или вернуть результат ${m.binding_id}`,()=>void this.prepareReview(m.binding_id)));
     if(out) {root.append(el("p",out.state==="completed"?"Выполнение завершено. Приёмка результата отдельно.":out.state==="budget_blocked"?"Остановлено бюджетом. Согласуйте новую заявку с достаточным лимитом; прежняя задача автоматически не повторяется.":"Результат пока не подтверждён."));if(out.result)root.append(el("pre",out.result.content));}
    } else root.append(el("p","Запуск и результат доступны владельцу этого подключения."));
   }
   }
   if(r.decision)root.append(el("p",`${r.decision.user_id}: ${r.decision.comment} (${r.decision.created_at})`));
   if(!this.pendingDecision&&!r.accepted_proposal_id){const comment=el("textarea");comment.setAttribute("aria-label","Обоснование бюджета команды");comment.value=this.comment;comment.disabled=this.busy;comment.oninput=()=>{this.comment=comment.value;};root.append(comment);for(const [value,label] of [["approved","Согласовать бюджет команды"],["rejected","Отклонить бюджет команды"],["revoked","Отозвать бюджет команды"]] as const)if(value!=="approved"||!r.proposal.replay_request)root.append(this.button(label,()=>void this.decide(value)));}
  }
  if(!this.form && !this.pendingDecision) {
   if(this.requester){
    root.append(el("p","Инициатор заявок: "+this.requester),this.button("Показать всех инициаторов",()=>{this.requester="";void this.load();}));
    if(this.page&&!this.page.proposals.some(p=>p.user_id===this.requester))root.append(el("p",this.page.next_cursor?"На этой странице заявок инициатора нет. Продолжите к следующим заявкам.":"На этой странице заявок инициатора нет."));
   }
   for(const r of (this.page?.proposals??[]).filter(p=>!this.requester||p.user_id===this.requester))root.append(this.button(`${states[r.state]??r.state} · ${r.member_count} участников · ${formatBudgetUSD(r.limit_usd_micros)} USD · ${r.id}`,()=>void this.open(r.id)));
   if(this.page?.next_cursor)root.append(this.button("Следующие заявки команды",()=>void this.load(this.page!.next_cursor)));
   root.append(this.button("Обновить заявки команды",()=>void this.load()));
  }
  root.append(this.button("Закрыть заявки команды",()=>{this.closed=true;this.onClose();}));
 }
}
