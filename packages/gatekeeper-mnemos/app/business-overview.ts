import {analyticsInquiry,type AnalyticsInquiry} from '../src/analytics-inquiry.ts';
import type {MnemosAccountSession} from '../src/account-session.ts';
import {decodeBusinessDataset,groupBusinessRows,type BusinessDataset} from '../src/business-analytics.ts';
type API=Pick<MnemosAccountSession,'listPrivateDocuments'|'readDraftDocument'>;
/** Read the selected authorized document version and discard results on failed refresh. */
export class BusinessOverview{
 private question='';private project='';private page?:Awaited<ReturnType<API['listPrivateDocuments']>>;private source?:{node:string;head:string;name:string;data:BusinessDataset};private busy=false;private closed=false;private notice='';
 constructor(private root:HTMLElement,private api:API,private projects:ReadonlyArray<{id:string;name:string}>,private close:()=>void,private download:(project:string,node:string,head:string,side:number)=>Promise<string>,private inquire?:(source:AnalyticsInquiry)=>void,private related?:(project:string,view:'expenses'|'answers')=>void){}
 async load(project:string,cursor=''){
  if(this.busy||this.closed)return;this.busy=true;this.project=project;this.page=undefined;this.source=undefined;this.notice='';this.render();
  try{const page=await this.api.listPrivateDocuments(project,cursor);if(!this.closed)this.page=page;}catch{this.notice='Источники недоступны. Проверьте подключение и права.';}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 async open(node:string,name:string){
  if(this.busy||this.closed)return;this.busy=true;this.source=undefined;this.notice='';this.render();
  try{
   const doc=await this.api.readDraftDocument(this.project,node);
   if(!doc.exists||doc.conflicted||doc.content_type!=='application/json'||doc.terms.length!==1||!doc.terms[0].present||doc.terms[0].negative)throw Error('Invalid source');
   const data=decodeBusinessDataset(await this.download(this.project,node,doc.head,0));
   const current=await this.api.readDraftDocument(this.project,node);
   if(current.head!==doc.head||!current.exists||current.conflicted||current.content_type!=='application/json')throw Error('Source changed');
   if(!this.closed)this.source={node,head:doc.head,name,data};
  }catch{this.notice='Отчёт не получен: нет доступа, версия изменилась или документ не соответствует формату данных организации.';}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 async ask(){
  if(this.busy||this.closed||!this.source||!this.inquire||!this.question.trim())return;
  this.busy=true;this.notice='';this.render();
  try{const source=this.source,doc=await this.api.readDraftDocument(this.project,source.node);
   if(!doc.exists||doc.conflicted||doc.head!==source.head||doc.content_type!=='application/json')throw Error('Source changed');
   const inquiry={project:this.project,node:source.node,head:source.head,question:this.question};analyticsInquiry(inquiry);
   if(!this.closed){this.closed=true;this.inquire(inquiry);}
  }catch{this.source=undefined;this.notice='Источник изменился или недоступен. Перечитайте его перед вопросом агенту.';}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 render(){
  if(this.closed)return;this.root.replaceChildren();
  const text=(v:string,tag='p')=>{const e=document.createElement(tag);e.textContent=v;this.root.append(e);};
  const button=(v:string,run:()=>void)=>{const b=document.createElement('button');b.textContent=v;b.disabled=this.busy;b.onclick=run;this.root.append(b);return b;};
  text('Организация и клиенты','h2');button('Закрыть данные организации',()=>{this.closed=true;this.source=undefined;this.close();}).disabled=false;
  text('Выберите документ данных организации. Здесь учитываются записи выбранного источника, а не все пользователи платформы.');
  for(const p of this.projects)button(p.name,()=>void this.load(p.id));
  for(const d of this.page?.documents??[])if(d.content_type==='application/json')button('Источник: '+d.name,()=>void this.open(d.node_id,d.name));
  if(this.page?.next_cursor)button('Следующие источники',()=>void this.load(this.project,this.page!.next_cursor));
  if(this.page&&!this.page.documents.some(d=>d.content_type==='application/json'))text('На этой странице документов данных нет.');
  if(this.busy)text('Читаем источник…');if(this.notice)text(this.notice);
  if(this.source){const {data,name,node,head}=this.source;text(data.organization,'h3');text('Источник: '+name+' · версия '+head);text('Данные на: '+data.observed_at);
   if(Date.parse(data.observed_at)>Date.now())text('В источнике указана будущая дата; актуальность не подтверждена.');
   const coverage={complete:'полный по заявлению источника',partial:'частичный',unknown:'неизвестен'};
   text('Сотрудники: '+(data.employees===null?'данные отсутствуют':data.employees.length+' записей')+'; охват '+coverage[data.coverage.employees]);
   if(data.employees)for(const group of groupBusinessRows(data.employees.map(e=>({group:e.department}))))text((group.name??'Отдел не указан')+': '+group.count);
   text('Клиенты: '+(data.clients===null?'данные отсутствуют':data.clients.length+' записей')+'; охват '+coverage[data.coverage.clients]);
   if(data.clients)for(const group of groupBusinessRows(data.clients.map(c=>({group:c.status}))))text((group.name??'Статус клиента не указан')+': '+group.count);
   button('Перечитать источник',()=>void this.open(node,name));
   if(this.related){
    button('Агенты и расходы проекта',()=>{this.closed=true;this.related!(this.project,'expenses');});
    button('Ответы по проекту',()=>{this.closed=true;this.related!(this.project,'answers');});
   }
   if(this.inquire){const field=document.createElement('textarea');field.setAttribute('aria-label','Вопрос по данным организации');field.value=this.question;field.maxLength=4000;field.disabled=this.busy;field.oninput=()=>{this.question=field.value;};this.root.append(field);button('Подготовить запрос аналитику',()=>void this.ask());}

  }
 }
}
