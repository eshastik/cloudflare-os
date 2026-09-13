import type {MnemosAccountSession} from '../src/account-session.ts';
import {decodeSearchEvaluation,evaluateSearch} from '../src/search-evaluation.ts';
type API=Pick<MnemosAccountSession,'listPrivateDocuments'|'readDraftDocument'|'searchProject'|'whoAmI'|'readPublishedHead'>;
type Report=Awaited<ReturnType<typeof evaluateSearch>>&{source:{project:string;node:string;head:string;sha256:string;revision:string};observer:Awaited<ReturnType<API['whoAmI']>>['subject'];corpus_head:string;at:string};

/** Evaluate an exact saved reference document through the caller's existing search capability. */
export class SearchEvaluation{
 #root:HTMLElement;#api:API;#download:(project:string,node:string,head:string,side:number)=>Promise<string>;
 #projects:ReadonlyArray<{id:string;name:string}>;#close:()=>void;#project='';#busy=false;#closed=false;
 #page?:Awaited<ReturnType<API['listPrivateDocuments']>>;#report?:Report;#notice='';
 constructor(root:HTMLElement,api:API,projects:ReadonlyArray<{id:string;name:string}>,close:()=>void,download:(project:string,node:string,head:string,side:number)=>Promise<string>){this.#root=root;this.#api=api;this.#projects=projects;this.#close=close;this.#download=download;}
 async load(project:string,cursor=''){
  if(this.#busy||this.#closed)return;this.#busy=true;this.#project=project;this.#page=undefined;this.#report=undefined;this.#notice='';this.render();
  try{const page=await this.#api.listPrivateDocuments(project,cursor);if(!this.#closed)this.#page=page;}
  catch{this.#notice='Эталоны недоступны. Проверьте подключение и права.';}
  finally{this.#busy=false;this.render();}
 }
 async run(node:string){
  if(this.#busy||this.#closed)return;this.#busy=true;this.#report=undefined;this.#notice='';this.render();
  try{
   const project=this.#project,doc=await this.#api.readDraftDocument(project,node);
   if(!doc.exists||doc.conflicted||doc.content_type!=='application/json')throw Error('Reference unavailable');
   const raw=await this.#download(project,node,doc.head,0),set=decodeSearchEvaluation(raw);
   const observer=(await this.#api.whoAmI()).subject;
   const corpus=(await this.#api.readPublishedHead(project)).shared_head;
   const result=await evaluateSearch(project,set,async query=>{if(this.#closed)throw Error('Closed');return this.#api.searchProject(project,query);});
   if(this.#closed)return;
   const current=await this.#api.readDraftDocument(project,node);
   if((await this.#api.readPublishedHead(project)).shared_head!==corpus||!current.exists||current.conflicted||current.head!==doc.head||current.content_type!==doc.content_type)throw Error('Reference changed');
   const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),n=>n.toString(16).padStart(2,'0')).join('');
   if(!this.#closed)this.#report={...result,source:{project,node,head:doc.head,sha256,revision:set.revision},observer,corpus_head:corpus,at:new Date().toISOString()};
  }catch{this.#notice='Проверка недоступна: нужен корректный эталон поиска, неизменная версия и текущий доступ.';}
  finally{this.#busy=false;this.render();}
 }
 render(){
  if(this.#closed)return;this.#root.replaceChildren();
  const text=(s:string,tag='p')=>{const e=document.createElement(tag);e.textContent=s;this.#root.append(e);};
  const button=(s:string,run:()=>void)=>{const b=document.createElement('button');b.textContent=s;b.disabled=this.#busy;b.onclick=run;this.#root.append(b);return b;};
  text('Проверка качества поиска','h2');button('Закрыть проверку поиска',()=>{this.#closed=true;this.#report=undefined;this.#close();}).disabled=false;
  text('Выберите сохранённый JSON-эталон mnemos.search-evaluation. Ожидаемые фрагменты размечает человек для текущих прав подключения. Чужие права эта проверка не воспроизводит.');
  for(const p of this.#projects)button(p.name,()=>void this.load(p.id));
  for(const d of this.#page?.documents??[])if(d.content_type==='application/json')button('Проверить: '+d.name,()=>void this.run(d.node_id));
  if(this.#page?.next_cursor)button('Следующие эталоны',()=>void this.load(this.#project,this.#page!.next_cursor));
  if(this.#busy)text('Выполняем проверку…');if(this.#notice)text(this.#notice);
  const r=this.#report;if(!r)return;
  const percent=(n:number|null)=>n===null?'неизвестно':(n*100).toFixed(1)+'%';
  text('Версия эталона: '+r.source.revision+' · '+r.source.head);text('Проверено '+r.measured+' из '+r.case_count+' запросов; недоступно '+r.unavailable+'.');
  text('Recall@'+r.k+': '+percent(r.recall)+'; запросов с непустым эталоном: '+r.recall_cases+'.');
  text('Доля релевантных фрагментов в ответе: '+percent(r.precision)+'; запросов с непустой выдачей: '+r.precision_cases+'.');
  text('Средние считаются по запросам. Пустая выдача даёт нулевой Recall при непустом эталоне; доля релевантных в пустой выдаче не определена. Ошибка поиска и незавершённая индексация не считаются нулевым качеством.');
  for(const c of r.cases)text(c.id+': '+(c.state==='measured'?'Recall '+percent(c.recall)+', релевантность '+percent(c.precision)+' ('+c.matched+' совпадений)':'не измерен'));
  text('Оценка относится к размеченным фрагментам. Она не доказывает истинность утверждений, полноту контекста агента или отсутствие ошибок в самом эталоне.');
  button('Скачать отчёт JSON',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(r,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='mnemos-search-evaluation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 }
}
