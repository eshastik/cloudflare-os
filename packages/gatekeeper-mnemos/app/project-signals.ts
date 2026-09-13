import {QUERY_CAPACITY_ERROR} from '../src/mnemos-api.ts';
import {signalGapTask,type SignalGapTask} from './signal-gap-task.ts';
import {webServiceProfile} from '../src/web-service-observability.ts';
import type {MnemosAccountSession} from '../src/account-session.ts';
import type {ProjectSignalProfile,ProjectSignalAssessment} from '../src/mnemos-api.ts';
/** Diagnostic preview using registered read-only database connections. */
export class ProjectSignalsView{
 private selection?:import('../src/mnemos-api.ts').PublishedSignalAssessment;
 private request:string=crypto.randomUUID();private collectedAt='';
 private project='';private profile='{"requirements":[],"queries":[]}';private result?:ProjectSignalAssessment;private busy=false;private closed=false;private notice='';
 constructor(private root:HTMLElement,private api:Pick<MnemosAccountSession,'assessProjectSignals'|'saveProjectSignalAssessment'|'readProjectSignalAssessment'|'readPublishedProjectSignals'|'publishProjectSignals'>,private projects:ReadonlyArray<{id:string;name:string}>,private close:()=>void,initialProject='',private escalate?:(task:SignalGapTask)=>void){this.project=initialProject;}
 async assess(){
  if(this.busy||this.closed)return;this.busy=true;this.result=undefined;this.collectedAt='';this.notice='';this.render();
  try{const profile:ProjectSignalProfile=JSON.parse(this.profile);const result=await this.api.assessProjectSignals(this.project,profile);if(!this.closed)this.result=result;}
  catch(error){this.result=undefined;this.notice=error instanceof Error&&error.message===QUERY_CAPACITY_ERROR?'Достигнут лимит запросов Mnemos. Повторите оценку через минуту; это не признак сбоя источника.':'Оценка не получена. Проверьте профиль, подключение и права на базы проекта.';}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 async saved(read=false){
  if(this.busy||this.closed)return;this.busy=true;this.result=undefined;this.collectedAt='';this.notice='';this.render();
  try{const out=read?await this.api.readProjectSignalAssessment(this.project,this.request):await this.api.saveProjectSignalAssessment(this.project,this.request,JSON.parse(this.profile));if(!this.closed){this.result=out.assessment;this.collectedAt=out.collected_at;}}
  catch(error){this.result=undefined;this.notice=error instanceof Error&&error.message===QUERY_CAPACITY_ERROR?'Достигнут лимит запросов Mnemos. Оценка не сохранена; повторите через минуту с тем же ID.':'Сохранённая оценка недоступна или запрос изменён. Повторите прежнюю операцию с тем же ID; для новой оценки нужен новый ID.';}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 async gap(signal:string){
  if(this.busy||this.closed||!this.escalate||!this.selection)return;
  this.busy=true;this.notice='';this.render();
  try{
   const current=await this.api.readPublishedProjectSignals(this.project);
   if(current.publication.revision!==this.selection.publication.revision)throw Error('Selection changed');
   const task=await signalGapTask(current,signal);
   if(!this.closed){this.closed=true;this.escalate(task);}
  }catch{this.notice='Пробел изменился или оценка недоступна. Обновите общую оценку.';}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 async published(change?:boolean){
  if(this.busy||this.closed)return;
  this.busy=true;this.notice='';this.render();
  try{
   if(change!==undefined){
    if(!this.selection)throw new Error('Read selection first');
    await this.api.publishProjectSignals(this.project,{operation_id:crypto.randomUUID(),request_id:change?this.request:this.selection.publication.source_request_id,expected_revision:this.selection.publication.revision,enabled:change});
   }
   const out=await this.api.readPublishedProjectSignals(this.project);
   if(!this.closed)this.selection=out;
  }catch{this.selection=undefined;this.notice='Публикация недоступна или изменена другим пользователем. Обновите общую оценку перед следующим действием.';}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 render(){if(this.closed)return;this.root.replaceChildren();
  const text=(v:string,tag='p')=>{const e=document.createElement(tag);e.textContent=v;this.root.append(e);};
  text('Оценка данных проекта','h2');
  const close=document.createElement('button');close.textContent='Закрыть оценку';close.onclick=()=>{this.closed=true;this.result=undefined;this.close();};this.root.append(close);
  text('Предварительная оценка по выбранным требованиям и запросам. Достаточность данных не означает, что сам проект работает без ошибок.');
  const web=document.createElement('button');web.textContent='Начать профиль веб-сервиса';web.disabled=this.busy;web.onclick=()=>{this.profile=JSON.stringify(webServiceProfile(),null,2);this.request=crypto.randomUUID();this.result=undefined;this.collectedAt='';this.notice='Уточните основной пользовательский сценарий и зависимости по карте проекта. Привяжите требования к разрешённым источникам в queries. Пустые queries означают отсутствие измерений; адрес дашборда сам по себе не является измерением.';this.render();};this.root.append(web);
  const projects=document.createElement('select');projects.setAttribute('aria-label','Проект оценки');projects.disabled=this.busy;const empty=document.createElement('option');empty.value='';empty.textContent='Выберите проект';projects.append(empty);
  for(const p of this.projects){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;projects.append(option);}projects.value=this.project;projects.onchange=()=>{this.project=projects.value;this.result=undefined;this.collectedAt='';this.selection=undefined;this.render();};this.root.append(projects);
  text('Профиль JSON: requirements — id, purpose, max_age_seconds, expected_unit; queries — signal_id, database, sql. Каждый запрос возвращает одну строку value, unit, observed_at (ISO 8601 с часовым поясом). Используются только зарегистрированные базы выбранного проекта.');
  const input=document.createElement('textarea');input.setAttribute('aria-label','Профиль оценки');input.value=this.profile;input.disabled=this.busy;input.oninput=()=>{this.profile=input.value;};this.root.append(input);
  const run=document.createElement('button');run.textContent=this.busy?'Читаем источники…':'Прочитать источники и оценить';run.disabled=this.busy||!this.project;run.onclick=()=>void this.assess();this.root.append(run);
  const id=document.createElement('input');id.setAttribute('aria-label','ID оценки');id.value=this.request;id.disabled=this.busy;id.oninput=()=>{this.request=id.value;};this.root.append(id);
  const action=(label:string,run:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.disabled=this.busy||!this.project;b.onclick=run;this.root.append(b);};
  action('Прочитать источники и сохранить оценку',()=>void this.saved());action('Открыть сохранённую оценку',()=>void this.saved(true));action('Новая оценка',()=>{this.request=crypto.randomUUID();this.result=undefined;this.collectedAt='';this.render();});
  action('Обновить общую оценку',()=>void this.published());
  if(this.selection){
   const selected=this.selection;
   text(selected.publication.enabled?'Общая оценка: '+selected.publication.source_request_id+' · версия '+selected.publication.revision:'Общая оценка не опубликована');
   if(selected.snapshot){
    text('Снимок собран: '+selected.snapshot.collected_at+' · актуальность проверена: '+selected.snapshot.assessment.assessed_at);
    text('Достаточность данных: '+selected.snapshot.assessment.state);
    for(const f of selected.snapshot.assessment.findings){text(f.purpose+': '+f.state);if(f.value!==undefined)text('Измерение: '+f.value+' '+f.unit);if(f.expected_unit)text('Ожидаемая единица: '+f.expected_unit);if(f.source_id)text('Источник: '+f.source_id);if(f.observed_at)text('Время измерения: '+f.observed_at);if(f.source_revision)text('Отпечаток результата: '+f.source_revision);if(this.escalate&&f.state!=='available')action('Задача по пробелу: '+f.signal_id,()=>void this.gap(f.signal_id));}
   }
   action('Опубликовать оценку с указанным ID',()=>void this.published(true));
   if(selected.publication.enabled)action('Снять общую оценку',()=>void this.published(false));
  }
  if(this.collectedAt)text('Снимок собран: '+this.collectedAt+' · ID '+this.request);
  if(this.notice)text(this.notice);
  const states={sufficient:'Данных достаточно для выбранных требований',insufficient:'Данных недостаточно',unavailable:'Часть источников недоступна',available:'Доступно',missing:'Нет измерения',stale:'Измерение устарело',future_timestamp:'Некорректное время измерения',unit_mismatch:'Единица измерения не соответствует требованию'};
  if(this.result){text(states[this.result.state],'h3');text('Оценено: '+this.result.assessed_at);for(const f of this.result.findings){text(f.purpose,'h4');text(states[f.state]);if(f.value!==undefined)text('Измерение: '+f.value+' '+f.unit);if(f.expected_unit)text('Ожидаемая единица: '+f.expected_unit);if(f.observed_at)text('Время измерения: '+f.observed_at);if(f.source_id)text('Источник: '+f.source_id);if(f.source_revision)text('Отпечаток результата: '+f.source_revision);}}
 }
}
