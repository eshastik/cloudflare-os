import type {MnemosAccountSession} from '../src/account-session.ts';
import type {CentroidRequest} from '../src/centroid.ts';
type API=Pick<MnemosAccountSession,'prepareCentroid'|'executeCentroid'>;
/** Human control for a durable, project profile rebuild. */
export class CentroidView {
 private request?:CentroidRequest;private busy=false;private closed=false;private notice='';
 constructor(private root:HTMLElement,private api:API,private project:string,private name:string,private close:()=>void){}
 async load(restart=false){await this.run(async()=>{this.request=await this.api.prepareCentroid(this.project,restart);});}
 private async execute(){const request=this.request;if(!request)return;await this.run(async()=>{this.request=await this.api.executeCentroid(this.project,request.request_id);});}
 private async run(work:()=>Promise<void>){
  if(this.closed||this.busy)return;this.busy=true;this.notice='';this.request=undefined;this.render();
  try{await work();}catch{this.request=undefined;this.notice='Результат не подтверждён. Обновите состояние: сохранённый запрос останется прежним. Проверьте соединение и доступ к проекту и его документам.';}
  finally{this.busy=false;if(this.closed)this.request=undefined;else this.render();}
 }
 render(){
  if(this.closed)return;this.root.replaceChildren();
  const text=(s:string)=>{const p=document.createElement('p');p.textContent=s;this.root.append(p);};
  const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.disabled=this.busy;b.onclick=action;this.root.append(b);return b;};
  text('Профиль распределения документов: '+this.name);
  button('Закрыть профиль',()=>{this.closed=true;this.request=undefined;this.root.replaceChildren();this.close();}).disabled=false;
  button('Обновить состояние',()=>void this.load());
  if(this.notice)text(this.notice);const request=this.request;if(!request)return;
  text('Профиль будет построен из текущих документов проекта по действующим правилам. Исходные файлы сохранятся.');
  const result=request.result;
  if(result){
   text(result.changed?'Профиль пересчитан.':'Профиль не изменён: проект изменился во время расчёта. Для нового прохода создайте новый запрос.');
   text(`Документов: ${result.documents}; исключено политикой: ${result.excluded}; стоимость: ${(result.embed_micro_usd/1000000).toFixed(6)} USD.`);
   if(result.replayed)text('Получено подтверждение ранее завершённого запроса.');
   button('Новый пересчёт профиля',()=>void this.load(true));
  }else{
   text('Правила могут включать платную обработку моделью. После потери ответа восстановите этот же запрос; повтор до завершения сервера может снова вызвать модель.');
   button('Выполнить / восстановить пересчёт',()=>void this.execute());
  }
 }
}
