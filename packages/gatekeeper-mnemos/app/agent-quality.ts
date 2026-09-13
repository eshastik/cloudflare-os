import type {MnemosAccountSession} from '../src/account-session.ts';
import {MemoryComparison, type QualityRun} from './memory-comparison.ts';
import {formatBudgetUSD} from './budget-money.ts';
type API=Pick<MnemosAccountSession,'listTeamBudgets'|'readTeamBudget'|'readTeamResultReview'|'readTeamBudgetUsage'|'readTeamBudgetMember'|'readTeamMemberInputs'|'readTeamMemberActivity'|'readPersonalMemoryVersion'>;
export type QualitySummary={proposals:number;reworks:number;accepted:number;changes:number;unreviewed:number;unavailable:number;complete:boolean;cost:string;costUnavailable:number;decisionHours:number[];timingUnavailable:number;runs:QualityRun[]};

/** Latest authorized decisions, once per proposal member. Revisions are not new results. */
export async function projectQuality(api:API,project:string):Promise<QualitySummary>{
 const out:QualitySummary={proposals:0,reworks:0,accepted:0,changes:0,unreviewed:0,unavailable:0,complete:false,cost:'0',costUnavailable:0,decisionHours:[],timingUnavailable:0,runs:[]};
 const ids=new Set<string>(),cursors=new Set<string>();let cursor='';
 try{
  for(let pageNumber=0;pageNumber<10;pageNumber++){
   const page=await api.listTeamBudgets(project,cursor);
   for(const summary of page.proposals){
    if(ids.has(summary.id))return out;ids.add(summary.id);out.proposals++;
    try{
     const proposal=await api.readTeamBudget(project,summary.id);
     if(proposal.id!==summary.id||proposal.project_id!==project)throw Error('Wrong proposal');
     if(proposal.proposal.rework)out.reworks++;
     const members=new Set<string>();
     for(const member of proposal.proposal.members){
      if(members.has(member.binding_id))continue;members.add(member.binding_id);
      out.runs.push({proposal:summary.id,binding:member.binding_id,label:proposal.created_at+' · '+(proposal.proposal.task||summary.id).slice(0,100)+' · '+member.role});
      try{
       const state=await api.readTeamResultReview(project,summary.id,member.binding_id);
       if(state.state==='unreviewed'){out.unreviewed++;continue;}
       if(!state.review||state.review.decision!==state.state||state.review.revision!==state.revision)throw Error('Unconfirmed review');
       if(state.state==='accepted')out.accepted++;else if(state.state==='changes_requested')out.changes++;else throw Error('Unknown decision');
       const hours=(Date.parse(state.review.created_at)-Date.parse(proposal.created_at))/3600000;
       if(Number.isFinite(hours)&&hours>=0)out.decisionHours.push(hours);else out.timingUnavailable++;
      }catch{out.unavailable++;}
     }
    }catch{out.unavailable+=Math.max(1,summary.member_count);}
    try{
     const usage=await api.readTeamBudgetUsage(project,summary.id);
     if(usage.project_id!==project||usage.proposal_id!==summary.id||usage.accounting_basis!=='rated_tokens'||!/^\d+$/.test(usage.actual_usd_micros))throw Error('Invalid usage');
     out.cost=(BigInt(out.cost)+BigInt(usage.actual_usd_micros)).toString();
    }catch{out.costUnavailable++;}
   }
   if(!page.next_cursor){out.complete=true;return out;}
   if(cursors.has(page.next_cursor))return out;cursors.add(page.next_cursor);cursor=page.next_cursor;
  }
 }catch{}
 return out;
}

export class AgentQuality {
 private comparison?:MemoryComparison;private summary?:QualitySummary;private project='';private busy=false;private closed=false;private at='';
 constructor(private root:HTMLElement,private api:API,private projects:ReadonlyArray<{id:string;name:string}>,private close:()=>void,private answers:(project:string)=>void){}
 async load(project:string){
  if(this.busy||this.closed)return;this.busy=true;this.project=project;this.summary=undefined;this.at='';this.render();
  try{const summary=await projectQuality(this.api,project);if(!this.closed){this.summary=summary;this.at=new Date().toLocaleString();}}
  finally{this.busy=false;this.render();}
 }
 render(){
  if(this.closed)return;this.comparison?.dispose();this.comparison=undefined;this.root.replaceChildren();
  const text=(v:string,tag='p')=>{const e=document.createElement(tag);e.textContent=v;this.root.append(e);};
  const button=(label:string,run:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.disabled=this.busy;b.onclick=run;this.root.append(b);return b;};
  text('Качество результатов агентов','h2');button('Закрыть качество',()=>{this.comparison?.dispose();this.closed=true;this.summary=undefined;this.close();}).disabled=false;
  text('Последние решения по участникам доступных заявок. Повторное решение по одному результату не считается новым результатом.');
  for(const p of this.projects)button(p.name,()=>void this.load(p.id));
  if(this.busy)text('Читаем решения и расходы…');
  if(this.summary){const s=this.summary,reviewed=s.accepted+s.changes;
   if(!s.complete&&!s.proposals){text('Свод недоступен. Проверьте подключение и права.');button('Обновить качество',()=>void this.load(this.project));return;}
   text('Свод на '+this.at);text('Заявок: '+s.proposals+'; подтверждённых заявок на доработку: '+s.reworks+'.');
   text('Принято: '+s.accepted+'; нужна доработка: '+s.changes+'; решения ещё нет: '+s.unreviewed+'; решения недоступны: '+s.unavailable+'.');
   text(reviewed?'Доля принятых среди результатов с доступным решением: '+(100*s.accepted/reviewed).toFixed(1)+'% ('+s.accepted+' из '+reviewed+').':'Доля принятия неизвестна: доступных решений нет.');
   text('Это текущие решения, а не доля принятия с первой попытки. Отсутствие решения не означает успешный или неуспешный запуск.');
   if(s.proposals===s.costUnavailable)text('Расходы неизвестны: нет подтверждённого учёта.');
   else text((s.costUnavailable||!s.complete?'Известная часть расходов':'Учтённые расходы')+': '+formatBudgetUSD(s.cost)+' USD; заявок с недоступным учётом: '+s.costUnavailable+'. Стоимость относится к целой заявке, не к отдельному участнику.');
   if(s.decisionHours.length)text('От создания заявки до последнего решения: в среднем '+(s.decisionHours.reduce((a,b)=>a+b,0)/s.decisionHours.length).toFixed(2)+' ч.; измерений '+s.decisionHours.length+'. Это календарное ожидание, не время работы модели.');
   else text('Время до решения неизвестно.');
   if(s.timingUnavailable)text('Время решения не подтверждено для '+s.timingUnavailable+' результатов.');
   if(!s.complete||s.unavailable||s.costUnavailable)text('Свод неполон: часть данных недоступна или обход каталога не завершён.');
   text('Вызовы внешнего CLI, не передавшего результаты и телеметрию в эти заявки, здесь не измерены; их качество, время и стоимость неизвестны. Вклад памяти этот свод ещё не доказывает.');
   const comparisonRoot=document.createElement('section');this.root.append(comparisonRoot);this.comparison=new MemoryComparison(comparisonRoot,this.api,this.project,s.runs);this.comparison.render();
   button('Обновить качество',()=>void this.load(this.project));button('Посмотреть ответы проекта',()=>{this.comparison?.dispose();this.closed=true;this.summary=undefined;this.answers(this.project);});
  }
 }
}
