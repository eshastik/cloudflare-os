import type {MnemosAccountSession} from '../src/account-session.ts';
import {formatBudgetUSD} from './budget-money.ts';

type API = Pick<MnemosAccountSession, 'listTeamBudgets'|'readTeamBudget'|'listAgentConnections'|'readTeamBudgetMember'|'readTeamResultContribution'|'readTeamResultReview'|'readTeamBudgetUsage'>;
type Proposal = Awaited<ReturnType<API['readTeamBudget']>>;

/** Owners read their own results; colleagues see only explicitly shared contributions. */
export class AgentAnswers {
 private project=''; private page?:Awaited<ReturnType<API['listTeamBudgets']>>;
 private titles=new Map<string,string>();
 private selected?:Proposal; private answers:{role:string;content:string;status:string}[]=[];
 private expense=''; private notice=''; private busy=false; private closed=false;
 constructor(private root:HTMLElement, private api:API, private projects:ReadonlyArray<{id:string;name:string}>, private close:()=>void){}
 async load(project:string,cursor='') {
  if(this.busy||this.closed)return;
  this.busy=true;this.project=project;this.page=undefined;this.titles.clear();this.clear();this.render();
  try {
   const page=await this.api.listTeamBudgets(project,cursor),titles=new Map<string,string>();
   for(let i=0;i<page.proposals.length;i+=4){
    if(this.closed)return;
    await Promise.all(page.proposals.slice(i,i+4).map(async summary=>{
     try{const p=await this.api.readTeamBudget(project,summary.id);titles.set(summary.id,p.proposal.task.replace(/^Аналитический вопрос руководителя:\s*/, '').split('\n')[0].slice(0,180));}catch{}
    }));
   }
   if(!this.closed){this.page=page;this.titles=titles;}
  }
  catch {this.notice='Запросы недоступны. Проверьте подключение и права.';}
  finally {this.busy=false;this.render();}
 }
 private clear(){this.selected=undefined;this.answers=[];this.expense='';this.notice='';}
 private async owned(){
  const ids=new Set<string>(),seen=new Set<string>();let cursor='';
  for(let i=0;i<10;i++){
   const page=await this.api.listAgentConnections(cursor);
   for(const c of page.connections)if(!c.revoked&&c.managed_runtime)ids.add(c.binding_id);
   if(!page.next_cursor)return ids;
   if(seen.has(page.next_cursor))throw Error('Repeated cursor');
   seen.add(page.next_cursor);cursor=page.next_cursor;
  }
  throw Error('Incomplete connections');
 }
 async open(id:string){
  if(this.busy||this.closed)return;
  this.busy=true;this.clear();this.render();
  try{
   const proposal=await this.api.readTeamBudget(this.project,id),owned=await this.owned();
   const answers:{role:string;content:string;status:string}[]=[];
   // Read one selected request; never fetch every agent's private output for a list.
   for(const member of proposal.proposal.members){
    try{
     if(owned.has(member.binding_id)){
      const result=await this.api.readTeamBudgetMember(this.project,id,member.binding_id);
      const review=await this.api.readTeamResultReview(this.project,id,member.binding_id);
      answers.push({role:member.role,content:result.result?.content??'',status:result.state==='completed'?(review.state==='accepted'?'Принят':review.state==='changes_requested'?'Нужна доработка':'Ещё не проверен'):result.state==='budget_blocked'?'Остановлен бюджетом':'Завершение не подтверждено'});
     }else{
      const shared=await this.api.readTeamResultContribution(this.project,id,member.binding_id);
      answers.push({role:member.role,content:shared.state==='shared'?(shared.content??''):'',status:shared.state==='shared'?'Передан команде':'Результат не передан команде'});
     }
    }catch{answers.push({role:member.role,content:'',status:'Результат недоступен'});}
   }
   let expense='Учёт расходов недоступен.';
   try{const usage=await this.api.readTeamBudgetUsage(this.project,id);if(usage.project_id!==this.project||usage.proposal_id!==id||usage.accounting_basis!=='rated_tokens')throw Error('Wrong accounting');expense=`Расходы на запрос: ${formatBudgetUSD(usage.actual_usd_micros)} USD; резерв: ${formatBudgetUSD(usage.reserved_usd_micros)} USD. По учтённым вызовам модели.`;}catch{}
   await this.api.readTeamBudget(this.project,id);
   if(!this.closed){this.selected=proposal;this.answers=answers;this.expense=expense;}
  }catch{this.clear();this.notice='Ответы недоступны. Перечитайте запрос после восстановления доступа.';}
  finally{this.busy=false;this.render();}
 }
 render(){
  if(this.closed)return;this.root.replaceChildren();
  const text=(value:string,tag='p',parent:HTMLElement=this.root)=>{const e=document.createElement(tag);e.textContent=value;parent.append(e);return e;};
  const button=(label:string,run:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.disabled=this.busy;b.onclick=run;this.root.append(b);return b;};
  text('Ответы агентов','h2');button('Закрыть ответы',()=>{this.closed=true;this.clear();this.close();}).disabled=false;
  text('Ваши ответы и результаты, которые коллеги передали команде. Доступные запросы не означают доступ ко всем исходным данным.');
  for(const p of this.projects)button(p.name,()=>void this.load(p.id));
  for(const p of this.page?.proposals??[])button(`${this.titles.get(p.id)||'Запрос'} · ${new Date(p.created_at).toLocaleString()}`,()=>void this.open(p.id));
  if(this.page&&!this.page.proposals.length)text('На этой странице запросов нет.');
  if(this.page?.next_cursor)button('Следующие запросы',()=>void this.load(this.project,this.page!.next_cursor));
  if(this.busy)text('Читаем ответы…');if(this.notice)text(this.notice);
  if(this.selected){
   text('Результат запроса','h3');
   for(const answer of this.answers){text(answer.role,'h4');text(answer.status);if(answer.content)text(answer.content,'pre');}
   text(this.expense);button('Перечитать ответы',()=>void this.open(this.selected!.id));
   const details=document.createElement('details');this.root.append(details);text('Постановка и критерии','summary',details);text(this.selected.proposal.task,'pre',details);text(this.selected.proposal.criteria,'p',details);
  }
 }
}
