import type {MnemosAccountSession} from '../src/account-session.ts';
import {decodeAnswerEvaluation,evaluateAnswer} from '../src/answer-evaluation.ts';
type API=Pick<MnemosAccountSession,'listPrivateDocuments'|'readDraftDocument'|'readTeamBudgetMember'|'readTeamMemberInputs'|'readPrivateVersionDigest'>;

/** Private assessment documents stay separate from result reviews shared with proposal readers. */
export class AnswerEvaluation{
 #root:HTMLElement;#api:API;#download:(p:string,n:string,h:string,s:number)=>Promise<string>;
 #projects:ReadonlyArray<{id:string;name:string}>;#close:()=>void;#project='';#busy=false;#closed=false;#notice='';
 #page?:Awaited<ReturnType<API['listPrivateDocuments']>>;
 #report?:Awaited<ReturnType<typeof evaluateAnswer>>&{source:{project:string;node:string;head:string;sha256:string;revision:string};at:string};
 constructor(root:HTMLElement,api:API,projects:ReadonlyArray<{id:string;name:string}>,close:()=>void,download:(p:string,n:string,h:string,s:number)=>Promise<string>){this.#root=root;this.#api=api;this.#projects=projects;this.#close=close;this.#download=download;}
 async load(project:string,cursor=''){
  if(this.#busy||this.#closed)return;this.#busy=true;this.#project=project;this.#page=undefined;this.#report=undefined;this.#notice='';this.render();
  try{const page=await this.#api.listPrivateDocuments(project,cursor);if(!this.#closed)this.#page=page;}
  catch{this.#notice='Оценки недоступны. Проверьте подключение и права.';}
  finally{this.#busy=false;this.render();}
 }
 async run(node:string){
  if(this.#busy||this.#closed)return;this.#busy=true;this.#report=undefined;this.#notice='';this.render();
  try{
   const project=this.#project,doc=await this.#api.readDraftDocument(project,node);
   if(!doc.exists||doc.conflicted||doc.content_type!=='application/json')throw Error('Invalid assessment');
   const raw=await this.#download(project,node,doc.head,0),set=decodeAnswerEvaluation(raw);
   const result=await evaluateAnswer(this.#api,set);
   if(this.#closed)return;
   const current=await this.#api.readDraftDocument(project,node);
   if(!current.exists||current.conflicted||current.head!==doc.head||current.content_type!==doc.content_type)throw Error('Assessment changed');
   const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),n=>n.toString(16).padStart(2,'0')).join('');
   if(!this.#closed)this.#report={...result,source:{project,node,head:doc.head,sha256,revision:set.revision},at:new Date().toISOString()};
  }catch{this.#notice='Оценка недоступна: проверьте формат, точные версии ответа и входов, а также текущий доступ ко всем источникам.';}
  finally{this.#busy=false;this.render();}
 }
 render(){
  if(this.#closed)return;this.#root.replaceChildren();
  const text=(s:string,tag='p')=>{const e=document.createElement(tag);e.textContent=s;this.#root.append(e);};
  const button=(s:string,run:()=>void)=>{const b=document.createElement('button');b.textContent=s;b.disabled=this.#busy;b.onclick=run;this.#root.append(b);return b;};
  text('Оценка контекста и ответа','h2');button('Закрыть оценку ответа',()=>{this.#closed=true;this.#report=undefined;this.#close();}).disabled=false;
  text('Выберите приватный JSON-документ mnemos.answer-evaluation с разметкой оценщика. Привязки ответа, входов и источников проверяются заново. Это не автоматическая проверка истинности утверждений.');
  for(const p of this.#projects)button(p.name,()=>void this.load(p.id));
  for(const d of this.#page?.documents??[])if(d.content_type==='application/json')button('Оценить: '+d.name,()=>void this.run(d.node_id));
  if(this.#page?.next_cursor)button('Следующие оценки',()=>void this.load(this.#project,this.#page!.next_cursor));
  if(this.#busy)text('Проверяем привязки и источники…');if(this.#notice)text(this.#notice);
  const r=this.#report;if(!r)return;
  text('Разметка: '+r.source.revision+' · '+r.source.head);
  text('Необходимый контекст: '+r.context_present+' из '+r.context_total+'; неизвестно '+r.context_unknown+'. Полнота: '+(r.context_complete===null?'не определена':r.context_complete?'полный':'неполный')+'.');
  const states={present:'присутствует',missing:'отсутствует',outdated:'другая версия',unknown:'неизвестно'};
  for(const c of r.context)text(c.id+': '+states[c.status]+'; '+(c.basis==='recorded_memory'?'сверено с записанной памятью':'по разметке оценщика, вход привязан по хешу')+'.');
  text('Поддержано источниками по разметке: '+(r.support_rate===null?'неизвестно':(r.support_rate*100).toFixed(1)+'%')+' ('+r.supported_claims+' из '+r.assessed_claims+' оценённых утверждений); не оценено '+r.unknown_claims+'.');
  const verdicts={supported:'поддержано',contradicted:'противоречит источнику',unsupported:'не поддержано',unknown:'не оценено'};
  for(const c of r.claims)text(c.quote+' — '+verdicts[c.verdict]);
  if(!r.access.length)text('Проверка прав не выполнялась: нет размеченных наблюдений.');
  else text('Права по разметке: проверено '+r.assessed_access+'; неизвестно '+r.unknown_access+'; неожиданных разрешений '+r.unexpected_allow+'; неожиданных отказов '+r.unexpected_deny+'. Это оценка размеченных наблюдений, не автоматический аудит всех прав.');
  button('Скачать оценку JSON',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(r,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='mnemos-answer-evaluation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 }
}
