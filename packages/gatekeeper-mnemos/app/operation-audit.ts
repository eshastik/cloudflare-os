import type {MnemosAccountSession} from "../src/account-session.ts";
import type {OperationAuditPage} from "../src/operation-audit.ts";
type API=Pick<MnemosAccountSession,"readOperationAudit">;
export class OperationAuditView {
 private page?:OperationAuditPage;private after=0;private busy=false;private closed=false;private notice="";private filter="";
 constructor(private root:HTMLElement,private api:API,private close:()=>void){}
 async load(after?:number){if(this.busy||this.closed)return;this.busy=true;this.page=undefined;this.notice="";this.render();try{
  if(after===undefined){const head=await this.api.readOperationAudit(0);after=Math.max(0,head.checkpoint.sequence-100);}
  if(!Number.isSafeInteger(after)||after<0)throw Error("Invalid audit cursor");
  const page=await this.api.readOperationAudit(after);if(!this.closed){this.after=after;this.page=page;}
 }catch{this.page=undefined;this.notice="Журнал недоступен. Для просмотра нужны действующие административные права.";}finally{this.busy=false;if(!this.closed)this.render();}}
 render(){if(this.closed)return;this.root.replaceChildren();const text=(value:string,tag="p")=>{const e=document.createElement(tag);e.textContent=value;this.root.append(e);};const button=(label:string,fn:()=>void)=>{const b=document.createElement("button");b.textContent=label;b.disabled=this.busy;b.onclick=fn;this.root.append(b);return b;};
  text("Журнал операций","h2");button("Закрыть журнал",()=>{this.closed=true;this.page=undefined;this.root.replaceChildren();this.close();}).disabled=false;button("Последние события",()=>void this.load());button("С начала журнала",()=>void this.load(0));
  text("Начало попытки не означает успех. Проверенный результат не подтверждает его доставку пользователю.");
  if(this.notice)text(this.notice);if(this.busy)text("Загрузка…");
  const filter=document.createElement("input");filter.setAttribute("aria-label","Фильтр текущей страницы");filter.value=this.filter;filter.disabled=this.busy;this.root.append(filter);button("Применить фильтр",()=>{this.filter=filter.value.trim();this.render();});text("Фильтр ищет только на загруженной странице: по исполнителю, действию, ресурсу или ID попытки.");
  const page=this.page;if(!page)return;
  text(`События после ${this.after}; прочитано ${page.events.length}. Вершина журнала: ${page.checkpoint.sequence}.`);
  text(`Хеш вершины: ${page.checkpoint.hash}`);
  const events=page.events.filter(e=>!this.filter||[e.actor,e.on_behalf_of,e.action,e.resource,e.subject].some(v=>v.includes(this.filter)));
  if(!events.length)text("На этой странице подходящих событий нет.");
  for(const e of events){text(`${e.id} · ${e.at} · ${e.action}`,"h3");text(`Исполнитель: ${e.actor}${e.on_behalf_of?` · От имени: ${e.on_behalf_of}`:""}`);text(e.reason==="requested"?"Начало попытки; результат находится в отдельной записи.":`Решение: ${e.allowed?"разрешено":"не разрешено"} · ${e.reason}`);text(`Ресурс: ${e.resource}`);text(`Предмет / ID попытки: ${e.subject}`);}
  if(page.truncated)button("Следующая страница",()=>void this.load(page.next));
 }
}
