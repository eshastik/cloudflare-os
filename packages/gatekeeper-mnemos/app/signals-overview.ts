import type {MnemosAccountSession} from '../src/account-session.ts';
import type {PublishedSignalAssessment} from '../src/mnemos-api.ts';
type API=Pick<MnemosAccountSession,'listProjects'|'readPublishedProjectSignals'>;
const states={sufficient:'Данных достаточно для выбранных требований',insufficient:'Данных недостаточно',unavailable:'Источники недоступны',available:'Есть измерение',missing:'Нет измерения',stale:'Измерение устарело',future_timestamp:'Некорректное время измерения',unit_mismatch:'Единица измерения не соответствует требованию'};
type Row={id:string;name:string;data?:PublishedSignalAssessment};
/** Shared selections only; missing authorization never becomes a healthy project. */
export class SignalsOverview {
 private rows:Row[]=[];private busy=false;private closed=false;private start=0;private next=false;private notice='';
 constructor(private root:HTMLElement,private api:API,private close:()=>void,private open:(project:string)=>void){}
 async load(start=0){
  if(this.busy||this.closed)return;this.busy=true;this.rows=[];this.notice='';this.next=false;this.start=start;this.render();
  try{
   const catalog=await this.api.listProjects();const page=catalog.projects.slice(start,start+20);const rows:Row[]=[];
   for(let i=0;i<page.length;i+=4){
    if(this.closed)return;
    rows.push(...await Promise.all(page.slice(i,i+4).map(async p=>{
     try{const data=await this.api.readPublishedProjectSignals(p.id);
      if(data.project_id!==p.id||(data.publication.enabled&&(!data.snapshot||data.snapshot.project_id!==p.id||data.snapshot.request_id!==data.publication.source_request_id)))throw Error('Invalid source');
      return {...p,data};
     }catch{return {...p};}
    })));
   }
   if(!this.closed){this.rows=rows;this.next=start+20<catalog.projects.length;}
  }catch{this.notice='Список проектов недоступен. Проверьте подключение и права.';}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 render(){
  if(this.closed)return;this.root.replaceChildren();
  const text=(value:string,tag='p')=>{const e=document.createElement(tag);e.textContent=value;this.root.append(e);};
  const button=(label:string,run:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.disabled=this.busy;b.onclick=run;this.root.append(b);return b;};
  text('Обзор проектов','h2');button('Закрыть обзор',()=>{this.closed=true;this.rows=[];this.close();}).disabled=false;
  button('Обновить оценки',()=>void this.load(this.start));
  text('Опубликованные оценки доступных вам проектов. Достаточность измерений относится к выбранным требованиям и не означает исправность проекта.');
  if(this.busy)text('Читаем оценки…');if(this.notice)text(this.notice);
  if(!this.busy&&!this.notice&&!this.rows.length)text('Доступных проектов нет.');
  for(const row of this.rows){
   text(row.name,'h3');
   if(!row.data)text('Оценка недоступна. Проверьте доступ и источники.');
   else if(!row.data.publication.enabled)text('Общая оценка не опубликована.');
   else if(row.data.snapshot){
    const snapshot=row.data.snapshot;text(states[snapshot.assessment.state]);text('Снимок: '+snapshot.collected_at+' · актуальность проверена: '+snapshot.assessment.assessed_at);
    for(const f of snapshot.assessment.findings){text(f.purpose+': '+states[f.state]+(f.value===undefined?'':' · '+f.value+' '+f.unit));if(f.source_id)text('Источник: '+f.source_id+(f.observed_at?' · '+f.observed_at:''));}
   }
   button('Оценка и источники: '+row.name,()=>{this.closed=true;this.rows=[];this.open(row.id);});
  }
  if(this.start)button('Первые проекты',()=>void this.load());
  if(this.next)button('Следующие проекты',()=>void this.load(this.start+20));
 }
}
