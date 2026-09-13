import type {MnemosAccountSession} from '../src/account-session.ts';
import {formatBudgetUSD} from './budget-money.ts';
type API=Pick<MnemosAccountSession,'listProjects'|'listTeamBudgets'|'readTeamBudget'|'readTeamBudgetUsage'>;
export type RequesterExpenses={user:string;known:string;reserved:string;proposals:number;unavailable:number};
export type ProjectAgent={binding:string;roles:string[];proposals:number};
export type ProjectExpenses={project:string;name:string;known:string;reserved:string;proposals:number;unavailable:number;complete:boolean;requesters:RequesterExpenses[];agents:ProjectAgent[];agentsUnavailable:number};
/** Aggregate only authorized ledger readings, retaining gaps and pagination limits. */
export async function projectExpenses(api:API,project:string,name:string):Promise<ProjectExpenses>{
 const out:ProjectExpenses={project,name,known:'0',reserved:'0',proposals:0,unavailable:0,complete:false,requesters:[],agents:[],agentsUnavailable:0};
 const agents=new Map<string,ProjectAgent>();
 const owners=new Map<string,RequesterExpenses>();
 const seen=new Set<string>(),cursors=new Set<string>();let cursor='';
 try{
  for(let pageNumber=0;pageNumber<10;pageNumber++){
   const page=await api.listTeamBudgets(project,cursor);
   for(const proposal of page.proposals){
    if(seen.has(proposal.id)){out.complete=false;return out;}seen.add(proposal.id);out.proposals++;
    const user=typeof proposal.user_id==='string'&&proposal.user_id.trim()?proposal.user_id:'';
    let owner=owners.get(user);if(!owner){owner={user,known:'0',reserved:'0',proposals:0,unavailable:0};owners.set(user,owner);out.requesters.push(owner);}owner.proposals++;
    try{
     const details=await api.readTeamBudget(project,proposal.id);
     if(details.id!==proposal.id||details.project_id!==project)throw Error('Wrong proposal');
     const inProposal=new Set<string>();
     for(const member of details.proposal.members){
      if(inProposal.has(member.binding_id))continue;inProposal.add(member.binding_id);
      let agent=agents.get(member.binding_id);
      if(!agent){agent={binding:member.binding_id,roles:[],proposals:0};agents.set(member.binding_id,agent);out.agents.push(agent);}
      agent.proposals++;if(!agent.roles.includes(member.role))agent.roles.push(member.role);
     }
    }catch{out.agentsUnavailable++;}
    try{
     const usage=await api.readTeamBudgetUsage(project,proposal.id);
     if(usage.project_id!==project||usage.proposal_id!==proposal.id||usage.accounting_basis!=='rated_tokens'||!/^\d+$/.test(usage.actual_usd_micros)||!/^\d+$/.test(usage.reserved_usd_micros))throw Error('Invalid expense source');
     out.known=(BigInt(out.known)+BigInt(usage.actual_usd_micros)).toString();out.reserved=(BigInt(out.reserved)+BigInt(usage.reserved_usd_micros)).toString();
     owner.known=(BigInt(owner.known)+BigInt(usage.actual_usd_micros)).toString();owner.reserved=(BigInt(owner.reserved)+BigInt(usage.reserved_usd_micros)).toString();
    }catch{out.unavailable++;owner.unavailable++;}
   }
   if(!page.next_cursor){out.complete=out.unavailable===0;return out;}
   if(cursors.has(page.next_cursor))return out;cursors.add(page.next_cursor);cursor=page.next_cursor;
  }
 }catch{out.complete=false;}
 return out;
}
/** Read-only expense overview. Opening source proposals rechecks their current permissions. */
export class BudgetOverview{
 private rows:ProjectExpenses[]=[];private cursor='';private next='';private busy=false;private closed=false;private notice='';private at='';
 constructor(private root:HTMLElement,private api:API,private close:()=>void,private open:(project:string,requester?:string)=>void,private options:{project?:string;answers?:(project:string)=>void}={}){}
 async load(cursor=''){
  if(this.busy||this.closed)return;this.busy=true;this.rows=[];this.next='';this.at='';this.notice='';this.cursor=cursor;this.render();
  try{
   const catalog=await this.api.listProjects();const projects=this.options.project?catalog.projects.filter(p=>p.id===this.options.project):catalog.projects;const start=cursor?Number(cursor):0;const page={projects:projects.slice(start,start+20),next_cursor:start+20<projects.length?String(start+20):''};const rows:ProjectExpenses[]=[];
   // Limit concurrent project reads, including the per-project ledger sequence.
   for(let index=0;index<page.projects.length;index+=4){
    if(this.closed)return;
    rows.push(...await Promise.all(page.projects.slice(index,index+4).map(p=>projectExpenses(this.api,p.id,p.name))));
   }
   if(!this.closed){this.rows=rows;this.next=page.next_cursor??'';this.at=new Date().toLocaleString();}
  }catch{this.rows=[];this.notice='Сводка недоступна. Проверьте подключение и права.';}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 render(){
  if(this.closed)return;this.root.replaceChildren();
  const text=(value:string,tag='p')=>{const e=document.createElement(tag);e.textContent=value;this.root.append(e);};
  const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.disabled=this.busy;b.onclick=action;this.root.append(b);return b;};
  text('Расходы по проектам','h2');button('Закрыть сводку',()=>{this.closed=true;this.rows=[];this.close();}).disabled=false;
  button('Обновить расходы',()=>void this.load(this.cursor));
  text('Расчёт по зарегистрированным вызовам агентов, в USD. Это не счёт поставщика. Здесь только доступные вам проекты и заявки.');
  if(this.busy)text('Получаем расходы…');if(this.notice)text(this.notice);if(this.at)text('Данные получены: '+this.at);
  for(const row of this.rows){
   text(row.name,'h3');
   text((row.complete?'Учтённые расходы: ':'Известная часть расходов: ')+formatBudgetUSD(row.known)+' USD; зарезервировано: '+formatBudgetUSD(row.reserved)+' USD.');
   text('Заявок прочитано: '+row.proposals+'.'+(row.complete?'':' Данные неполные; недоступных расходов по заявкам: '+row.unavailable+'.'));
   text('Агенты в прочитанных заявках: '+row.agents.length+' подключений. Это состав заявок, включая историю, а не число работающих сейчас агентов.');
   if(row.agentsUnavailable)text('Состав недоступен для '+row.agentsUnavailable+' заявок; список агентов неполон.');
   for(const [index,agent] of row.agents.entries()){
    text('Агент '+(index+1)+': '+agent.roles.join(', ')+'; заявок: '+agent.proposals+'.');
    const detail=document.createElement('details'),summary=document.createElement('summary'),id=document.createElement('p');summary.textContent='Идентификатор подключения';id.textContent=agent.binding;detail.append(summary,id);this.root.append(detail);
   }
   if(row.requesters.length){
    text('По инициаторам заявок. Суммы относятся к заявкам, а не к личному потреблению или зарплате.');
    for(const requester of row.requesters){
     text((requester.user||'Инициатор не указан')+': '+formatBudgetUSD(requester.known)+' USD; резерв '+formatBudgetUSD(requester.reserved)+' USD; заявок '+requester.proposals+(requester.unavailable?'; учёт недоступен для '+requester.unavailable+' заявок.':'.'));
     if(requester.user)button('Заявки инициатора: '+requester.user,()=>{this.closed=true;this.rows=[];this.open(row.project,requester.user);});
    }
   }
   button('Открыть заявки: '+row.name,()=>{this.closed=true;this.rows=[];this.open(row.project);});
   if(this.options.answers)button('Ответы агентов: '+row.name,()=>{this.closed=true;this.rows=[];this.options.answers!(row.project);});
  }
  if(this.at&&!this.rows.length)text('Доступных проектов на этой странице нет.');
  if(this.next)button('Следующие проекты',()=>void this.load(this.next));
 }
}
