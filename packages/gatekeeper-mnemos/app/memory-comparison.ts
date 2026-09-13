import type {MnemosAccountSession} from '../src/account-session.ts';
import {taskTelemetry} from './task-telemetry.ts';
import {formatBudgetUSD} from './budget-money.ts';

type API=Pick<MnemosAccountSession,'readTeamBudget'|'readTeamBudgetMember'|'readTeamMemberInputs'|'readTeamResultReview'|'readTeamBudgetUsage'|'readTeamMemberActivity'|'readPersonalMemoryVersion'>;
export type QualityRun={proposal:string;binding:string;label:string};
const digest=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

/** Version equality measures source currency, not the factual correctness of its prose. */
export function memoryCurrency(recorded:Awaited<ReturnType<API['readTeamMemberInputs']>>['input_manifest'],current:Awaited<ReturnType<API['readPersonalMemoryVersion']>>|undefined):string {
 if(!recorded||!current)return 'Текущая версия памяти недоступна или не проверена.';
 if(!current.node_id)return recorded.memory.enabled?'Сейчас память отключена; результат использовал ранее выбранную память.':'Память была и остаётся отключённой.';
 if(!recorded.memory.enabled||recorded.memory.project_id!==current.project_id||recorded.memory.node_id!==current.node_id)return 'Сейчас выбран другой источник памяти.';
 if(!hash(recorded.memory.document_sha256)||!hash(current.sha256))return 'Совпадение содержимого памяти неизвестно.';
 return recorded.memory.document_sha256===current.sha256?'Содержимое памяти совпадает с текущей доступной версией.':'Содержимое памяти изменилось после запуска; результат использовал другую версию.';
}

/** Re-read both private outcomes and correlate human decisions with the exact result bytes. */
export async function compareMemoryRuns(api:API,project:string,first:QualityRun,second:QualityRun){
 if(first.proposal===second.proposal&&first.binding===second.binding)throw Error('Choose distinct runs');
 const readRun=async(ref:QualityRun)=>{
  const proposal=await api.readTeamBudget(project,ref.proposal);
  const member=proposal.proposal.members.find(m=>m.binding_id===ref.binding);
  if(proposal.id!==ref.proposal||proposal.project_id!==project||!member)throw Error('Wrong member');
  const outcome=await api.readTeamBudgetMember(project,ref.proposal,ref.binding);
  const inputs=await api.readTeamMemberInputs(project,ref.proposal,ref.binding);
  if(outcome.state!=='completed'||!outcome.result||!outcome.request_id||inputs.request_id!==outcome.request_id)throw Error('Completed owned result required');
  const [review,usage,telemetry]=await Promise.all([
   api.readTeamResultReview(project,ref.proposal,ref.binding).catch(()=>undefined),
   api.readTeamBudgetUsage(project,ref.proposal).catch(()=>undefined),
   taskTelemetry(api,project,ref.proposal,ref.binding,outcome.request_id),
  ]);
  const confirmed=review?.review&&review.state===review.review.decision&&review.revision===review.review.revision&&review.review.runtime_request_id===outcome.request_id&&review.review.result_sha256===await digest(outcome.result.content);
  const cost=usage&&usage.project_id===project&&usage.proposal_id===ref.proposal&&usage.accounting_basis==='rated_tokens'&&/^\d+$/.test(usage.actual_usd_micros)?usage.actual_usd_micros:undefined;
  return {ref,proposal,member,outcome,inputs,decision:confirmed?review!.state:'unknown',cost,telemetry};
 };
 // Owned runtime reads refresh binding credentials; serialize the two runs
 // so a shared agent binding cannot invalidate the other read mid-flight.
 const runs=[await readRun(first),await readRun(second)];
 const [a,b]=runs;
 if(a.outcome.request_id===b.outcome.request_id)throw Error('Same runtime request');
 const differences:string[]=[];
 for(const [key,label] of [['task','текст задачи'],['criteria','критерии приёмки']] as const){
  if(a.proposal.proposal[key]!==b.proposal.proposal[key])differences.push(label);
 }
 if(a.member.role!==b.member.role)differences.push('роль агента');
 // These envelopes can change the task beyond its visible task/criteria fields.
 if(runs.some(r=>r.proposal.proposal.rework||r.proposal.proposal.replay||r.proposal.proposal.tracker||r.proposal.proposal.voice))differences.push('специальный контекст: доработка, повтор, трекер или голос');
 const x=a.inputs.input_manifest,y=b.inputs.input_manifest;
 const manifestReady=runs.every(r=>{
  const m=r.inputs.input_manifest;
  return r.inputs.checkpoint_found&&hash(r.inputs.input_manifest_sha256)&&m?.format_version===1&&!!m.model_id&&
   [m.message_sha256,m.system_prompt_sha256,m.tool_catalog_sha256,m.limits_sha256,m.memory_context_sha256].every(hash)&&
   r.inputs.model_inputs?.some(c=>c.task_start&&hash(c.input_sha256)&&c.model_id===m.model_id);
 });
 let memoryChanged:boolean|undefined;
 if(!manifestReady||!x||!y)differences.push('записанные входы неизвестны или неполны');
 else {
  for(const [key,label] of [['model_id','модель'],['system_prompt_sha256','системная инструкция'],['tool_catalog_sha256','набор инструментов'],['limits_sha256','лимиты'],['message_sha256','полный запрос, включая служебные поля']] as const){
   if(x[key]!==y[key])differences.push(label);
  }
  memoryChanged=x.memory_context_sha256!==y.memory_context_sha256;
 }
 const regression=a.decision==='accepted'&&b.decision==='changes_requested'&&manifestReady&&differences.every(d=>d==='полный запрос, включая служебные поля');
 let currentMemory:Awaited<ReturnType<API["readPersonalMemoryVersion"]>>|undefined;
 try{currentMemory=await api.readPersonalMemoryVersion();}catch{}
 return {runs,differences,memoryChanged,regression,currentMemory};
}

/** Read-only comparison of existing runs; it neither changes selected memory nor starts agents. */
export class MemoryComparison{
 #root:HTMLElement;#api:API;#project:string;#runs:QualityRun[];#closed=false;#busy=false;
 #first=0;#second=1;#result?:Awaited<ReturnType<typeof compareMemoryRuns>>;#notice='';
 constructor(root:HTMLElement,api:API,project:string,runs:QualityRun[]){this.#root=root;this.#api=api;this.#project=project;this.#runs=runs;}
 dispose(){this.#closed=true;this.#result=undefined;this.#root.replaceChildren();}
 async compare(){
  if(this.#busy||this.#closed||!this.#runs[this.#first]||!this.#runs[this.#second])return;
  this.#busy=true;this.#result=undefined;this.#notice='';this.render();
  try{const result=await compareMemoryRuns(this.#api,this.#project,this.#runs[this.#first],this.#runs[this.#second]);if(!this.#closed)this.#result=result;}
  catch{if(!this.#closed)this.#notice='Сравнение недоступно: выберите два разных завершённых результата своих агентов и проверьте права.';}
  finally{this.#busy=false;this.render();}
 }
 render(){
  if(this.#closed)return;this.#root.replaceChildren();
  const text=(value:string,tag='p',parent=this.#root)=>{const e=document.createElement(tag);e.textContent=value;parent.append(e);return e;};
  text('Сравнение задачи и памяти','h3');
  if(this.#runs.length<2){text('Нужны как минимум два результата.');return;}
  for(const [index,title] of ['Исходный запуск','Сравниваемый запуск'].entries()){
   const label=text(title,'label');const select=document.createElement('select');select.disabled=this.#busy;
   this.#runs.forEach((run,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=run.label+' · '+run.proposal.slice(-8);select.append(option);});
   select.value=String(index===0?this.#first:this.#second);
   select.onchange=()=>{if(index===0)this.#first=Number(select.value);else this.#second=Number(select.value);this.#result=undefined;this.#notice='';this.render();};label.append(select);
  }
  const button=document.createElement('button');button.textContent=this.#busy?'Сравниваем…':'Сравнить результаты и память';button.disabled=this.#busy||this.#first===this.#second;button.onclick=()=>void this.compare();this.#root.append(button);
  if(this.#notice)text(this.#notice);
  const r=this.#result;if(!r)return;
  text(r.memoryChanged===undefined?'Изменение памяти неизвестно.':r.memoryChanged?'Переданный контекст памяти различается.':'Переданный контекст памяти совпадает.');
  text(r.differences.length?'Различия или пробелы: '+r.differences.join('; ')+'.':'Записанные условия задачи совпадают.');
  if(r.regression)text('Сигнал ухудшения на одинаковой задаче: первый результат принят, второй отправлен на доработку.');
  else text('Сопоставимый сигнал ухудшения не установлен: проверьте решения и различия условий. Неизвестное решение не считается успехом.');
  text('Это сравнение двух наблюдений. Причина изменения качества не доказана: версии внешних источников, исполнение инструментов и случайность модели могут влиять на результат.');
  for(const [i,run] of r.runs.entries()){
   text(i===0?'Исходный результат':'Сравниваемый результат','h4');
   const decisions:Record<string,string>={accepted:'принято',changes_requested:'нужна доработка',unknown:'неизвестно'};
   text('Решение: '+decisions[run.decision]+'. Расходы всей заявки: '+(run.cost===undefined?'неизвестны':formatBudgetUSD(run.cost)+' USD')+'.');
   const t=run.telemetry;
   text(t?'Инструменты: '+t.calls+' вызовов, '+t.failures+' ошибок. Поиск: '+(t.searches===undefined?'неизвестно':t.searches+' вызовов, '+t.searchFailures+' ошибок')+'.':'Журнал запуска недоступен или неполон: вызовы и ошибки неизвестны.');
   text('Время запуска по журналу: '+(t?.elapsedMs===undefined?'неизвестно':(t.elapsedMs/1000).toFixed(2)+' с')+'. Зарегистрированное время поиска: '+(t?.searchMs===undefined?'неизвестно':t.searchMs+' мс')+'.');
   if(t)text('Подтверждённых отказов доступа: '+t.accessDenied+'; ошибок с неизвестной причиной: '+t.unclassifiedErrors+'.');
   text('Ошибка инструмента не обязательно означает отказ доступа. Полнота и актуальность найденных сведений этими счётчиками не измеряются.');
   const m=run.inputs.input_manifest;
   text(memoryCurrency(m,r.currentMemory));
   text('Это проверка текущего источника с правами человека. Достоверность фактов внутри документа и текущий доступ агента требуют отдельной проверки.');
   text('Модель: '+(m?.model_id||'неизвестна')+'. Версия памяти: '+(m?.memory.enabled?m.memory.head||'неизвестна':m?'отключена':'неизвестна')+'.');
   const details=text('','details');text('Текст результата','summary',details);text(run.outcome.result!.content,'pre',details);
  }
 }
}
