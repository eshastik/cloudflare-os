import type {MnemosAccountSession} from "../src/account-session.ts";
import {parseBudgetUSD} from "./budget-money.ts";
type API=Pick<MnemosAccountSession,"readSavedAbsenceAction"|"saveAbsenceAction"|"executeSavedAbsenceAction"|"createAbsenceTask"|"readAbsenceTask"|"dispatchAbsenceTask"|"cancelAbsenceTask"|"readAbsenceRuntime"|"readProjectBudget"|"createTeamBudget"|"readTeamBudget">;
type Source=Awaited<ReturnType<MnemosAccountSession["readCollaboration"]>>;
type Task=Awaited<ReturnType<API["readAbsenceTask"]>>;
export class AbsenceTaskView {
 private task?:Task; private busy=false;private closed=false;private notice="";private proposal="";private estimate="";private limit="";private result?:string;
 private saved?: NonNullable<Awaited<ReturnType<API["readSavedAbsenceAction"]>>>;
 private selectedText="";
 private pending?:Parameters<API["saveAbsenceAction"]>[2];
 constructor(private root:HTMLElement,private api:API,private source:Source,private user:string,private close:()=>void){}
 private check(task:Task){if(task.request_id!==this.source.request_id||task.project_id!==this.source.project_id||!Number.isSafeInteger(task.revision)||task.revision<1)throw new Error("invalid task receipt");return task;}
 async load(prepare=false){
  if(this.busy||this.closed||(prepare&&this.pending))return;
  this.busy=true;this.result=undefined;this.notice="";this.render();
  try{
   const saved=await this.api.readSavedAbsenceAction(this.source.request_id);
   if(saved && saved.project!==this.source.project_id)throw new Error("foreign saved action");
   this.saved=saved??undefined;this.pending=saved&&!saved.receipt?saved.action:undefined;
   if(saved?.receipt){this.notice=saved.receipt.message;if(saved.receipt.proposal)this.proposal=saved.receipt.proposal;}
   const task=this.check(await (prepare?this.api.createAbsenceTask(this.source.request_id):this.api.readAbsenceTask(this.source.request_id)));if(!this.closed){this.task=task;if(task.budget_proposal_id)this.proposal=task.budget_proposal_id;}}
  catch{this.task=undefined;this.notice=prepare?"Подготовка не подтверждена. Перечитайте задачу или повторите подготовку того же обращения.":"Задача недоступна или ещё не подготовлена. Подготовка также проверит ваши права.";}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 private async budget(){
  if(this.busy||this.closed||this.pending||!this.task)return;
  this.busy=true;this.notice="";this.render();
  try{
   const estimate=parseBudgetUSD(this.estimate),limit=parseBudgetUSD(this.limit);
   if(BigInt(limit)<=0n||BigInt(estimate)>BigInt(limit))throw new Error("invalid budget");
   const policy=await this.api.readProjectBudget(this.source.project_id);if(policy.project_id!==this.source.project_id)throw new Error("foreign policy");
   this.pending={kind:"budget",input:{request_id:crypto.randomUUID(),absence_request_id:this.source.request_id,policy_revision:policy.revision,task:this.source.title+"\n\n"+this.source.description,criteria:this.source.criteria,members:[{binding_id:this.task.managed_binding_id,role:this.source.role}],estimate_usd_micros:estimate,limit_usd_micros:limit}};
  }catch{this.notice="Проверьте суммы и доступ к бюджетной политике.";}finally{this.busy=false;}
  if(this.pending)await this.execute();else if(!this.closed)this.render();
 }
 private async execute(){
  const pending=this.pending;if(this.busy||this.closed||!pending)return;
  this.busy=true;this.result=undefined;this.notice="";this.render();
  try{
   if(!this.saved || this.saved.receipt || JSON.stringify(this.saved.action)!==JSON.stringify(pending)) {
    this.saved=await this.api.saveAbsenceAction(this.source.project_id,this.source.request_id,pending,this.saved?.id??"");
   }
   const out=await this.api.executeSavedAbsenceAction(this.source.request_id,this.saved.id);
   if(out.project!==this.source.project_id || out.request!==this.source.request_id || !out.receipt)throw new Error("unconfirmed saved action");
   this.saved=out;this.notice=out.receipt.message;if(out.receipt.proposal)this.proposal=out.receipt.proposal;
   this.pending=undefined;this.selectedText="";this.task=undefined;
  }catch{
   try{const saved=await this.api.readSavedAbsenceAction(this.source.request_id);if(saved&&saved.project===this.source.project_id){this.saved=saved;this.pending=saved.receipt?undefined:saved.action;if(saved.receipt){this.notice=saved.receipt.message;if(saved.receipt.proposal)this.proposal=saved.receipt.proposal;}}}catch{}
   if(this.pending)this.notice="Действие не подтверждено. Условия сохранены в аккаунте; перечитайте состояние или повторите действие.";
  }
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 private async readResult(){
  const task=this.task;if(this.busy||this.closed||!task||task.owner_id!==this.user||!task.binding_id)return;
  this.busy=true;this.result=undefined;this.notice="";this.render();
  try{const out=await this.api.readAbsenceRuntime(task.request_id,task.binding_id);if(out.request_id!==task.runtime_request_id)throw new Error("foreign receipt");if(!this.closed){this.result=out.result?.content;this.notice=`Состояние агента: ${out.state}`;}}
  catch{this.notice="Частный результат недоступен. Проверьте права и состояние задачи.";}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 render(){
  if(this.closed)return;
  const el=(tag:string,text="")=>{const e=document.createElement(tag);e.textContent=text;return e;};
  const button=(text:string,run:()=>void)=>{const b=document.createElement("button");b.textContent=text;b.disabled=this.busy;b.onclick=run;return b;};
  this.root.replaceChildren(el("h2","Задача замещения"),el("h3",this.source.title),el("p",this.notice));
  this.root.append(el("p","Запуск выполняет корпоративный агент по разрешению отсутствующего владельца и согласованному бюджету. Частный результат доступен отдельно владельцу."));
  if(this.task){
   const states={queued:"Ожидает назначения",claimed:"Назначена, ещё не запущена",cancelling:"Отмена не завершена",started:"Запущена",uncertain:"Результат исполнения неизвестен",completed:"Выполнена",budget_blocked:"Остановлена бюджетом"};
   this.root.append(el("p",states[this.task.state]),el("p",`Попытка: ${this.task.runtime_request_id} · ревизия ${this.task.revision}`));
   if(!this.pending && this.task.owner_id===this.user && this.task.state==="completed" && this.task.binding_id){
    const text=document.createElement("textarea");text.setAttribute("aria-label","Выбранный текст для участников");text.value=this.selectedText;text.disabled=this.busy;text.oninput=()=>{this.selectedText=text.value;};
    this.root.append(el("p","Выберите текст для отправки участникам. Частный ответ целиком автоматически не передаётся."),text,button("Передать выбранный результат",()=>{
     if(!this.selectedText.trim()||[...this.selectedText].length>16384){this.notice="Укажите выбранный текст до 16384 символов.";this.render();return;}
     this.pending={kind:"share",binding:this.task!.binding_id,runtime:this.task!.runtime_request_id,hash:this.task!.result_sha256,body:this.selectedText};void this.execute();
    }));
   }
   if(this.task.owner_id===this.user&&this.task.binding_id)this.root.append(button("Прочитать частный результат",()=>void this.readResult()));
   if(!this.pending&&this.task.owner_id===this.user&&this.task.state==="claimed")this.root.append(button("Отменить назначение до старта",()=>{this.pending={kind:"cancel",revision:this.task!.revision};void this.execute();}));
  }
  if(this.result!==undefined)this.root.append(el("pre",this.result));
  if(this.proposal)this.root.append(el("p",`Бюджет: ${this.proposal}`));
  const field=(label:string,value:string,change:(v:string)=>void)=>{const input=document.createElement("input");input.setAttribute("aria-label",label);input.value=value;input.disabled=this.busy||!!this.pending;input.oninput=()=>change(input.value);this.root.append(el("label",label),input);};
  if(!this.pending&&this.task){
   if(!this.task.budget_proposal_id&&this.task.state==="queued"){
    field("Оценка стоимости, USD",this.estimate,v=>this.estimate=v);field("Лимит стоимости, USD",this.limit,v=>this.limit=v);this.root.append(button("Предложить бюджет замещения",()=>void this.budget()));
   }
   field("Согласованный бюджет: идентификатор",this.proposal,v=>this.proposal=v);
   if(this.source.requester_user_id===this.user&&!this.source.requester_agent_id)this.root.append(button("Запустить заместителя",()=>{if(!this.proposal.trim()){this.notice="Укажите согласованный бюджет.";this.render();return;}this.pending={kind:"dispatch",proposal:this.proposal.trim()};void this.execute();}));
  }
  if(this.pending)this.root.append(button("Повторить действие с теми же условиями",()=>void this.execute()));
  else if(!this.task)this.root.append(button("Подготовить общую задачу",()=>void this.load(true)));
  this.root.append(button("Перечитать общую задачу",()=>void this.load()),button("Вернуться к обращению",()=>{this.closed=true;this.result=undefined;this.close();}));
 }
}
