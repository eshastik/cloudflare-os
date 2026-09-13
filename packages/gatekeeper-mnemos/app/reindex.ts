import type {MnemosAccountSession} from '../src/account-session.ts';
import type {ReindexRequest} from '../src/reindex.ts';
type API=Pick<MnemosAccountSession,'prepareReindex'|'executeReindex'>;
/** Human control for a durable, version-pinned index rebuild. */
export class ReindexView {
 private request?:ReindexRequest;private busy=false;private closed=false;private notice='';
 constructor(private root:HTMLElement,private api:API,private node:string,private name:string,private close:()=>void){}
 async load(restart=false){await this.run(async()=>{this.request=await this.api.prepareReindex(this.node,restart);});}
 private async execute(){const request=this.request;if(!request)return;await this.run(async()=>{this.request=await this.api.executeReindex(this.node,request.request_id);});}
 private async run(work:()=>Promise<void>){
  if(this.closed||this.busy)return;this.busy=true;this.notice='';this.request=undefined;this.render();
  try{await work();}catch{this.request=undefined;this.notice='Результат не подтверждён. Обновите состояние: сохранённый запрос останется прежним. Проверьте соединение и право изменения файла.';}
  finally{this.busy=false;if(this.closed)this.request=undefined;else this.render();}
 }
 render(){
  if(this.closed)return;this.root.replaceChildren();
  const text=(s:string)=>{const p=document.createElement('p');p.textContent=s;this.root.append(p);};
  const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.disabled=this.busy;b.onclick=action;this.root.append(b);return b;};
  text('Пересчёт индекса: '+this.name);
  button('Закрыть пересчёт',()=>{this.closed=true;this.request=undefined;this.root.replaceChildren();this.close();}).disabled=false;
  button('Обновить состояние',()=>void this.load());
  if(this.notice)text(this.notice);const request=this.request;if(!request)return;
  text(`Выбрана версия ${request.revision}. Индекс будет построен из исходного файла по действующим правилам. Сам файл и его версия сохранятся.`);
  const result=request.result;
  if(result){
   text(result.changed?'Пересчёт завершён.':'Индекс не изменён: результат устарел. Для нового прохода создайте новый запрос.');
   text(`Сегментов: ${result.segments}; векторов: ${result.vectorized}; стоимость: ${(result.embed_micro_usd/1000000).toFixed(6)} USD.`);
   if(result.replayed)text('Получено подтверждение ранее завершённого запроса.');
   if(result.policy_alert)text('Предупреждение политики: '+result.policy_why);
   for(const note of result.notes??[])text(note);
   button('Новый пересчёт текущей версии',()=>void this.load(true));
  }else{
   text('Правила могут включать платную обработку моделью. После потери ответа восстановите этот же запрос; повтор до завершения сервера может снова вызвать модель.');
   button('Выполнить / восстановить пересчёт',()=>void this.execute());
  }
 }
}
