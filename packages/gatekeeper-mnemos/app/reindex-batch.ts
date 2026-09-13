import type {MnemosAccountSession} from '../src/account-session.ts';
import type {ReindexBatch} from '../src/reindex-batch.ts';
type API=Pick<MnemosAccountSession,'readReindexBatch'|'prepareReindexBatch'|'executeReindexBatch'>;
/** Explicit start and pause controls for a persistent bulk indexing plan. */
export class ReindexBatchView {
 private batch:ReindexBatch|null=null;private busy=false;private closed=false;private paused=false;private notice='';
 private selected:string;private history=false;
 constructor(private root:HTMLElement,private api:API,private projects:{id:string;name:string}[],private close:()=>void){this.selected=projects[0]?.id??'';}
 async load(){await this.run(async()=>{this.batch=await this.api.readReindexBatch();});}
 private async prepare(){await this.run(async()=>{this.batch=await this.api.prepareReindexBatch(this.selected==='*'?this.projects.map(p=>p.id):[this.selected],this.history,true);});}
 private async execute(){
  if(!this.batch)return;const id=this.batch.id;this.paused=false;
  await this.run(async()=>{
   do{this.batch=await this.api.executeReindexBatch(id);if(!this.closed)this.render();}
   while(!this.closed&&!this.paused&&this.batch.next<this.batch.total);
  });
 }
 private async run(work:()=>Promise<void>){
  if(this.closed||this.busy)return;this.busy=true;this.notice='';this.render();
  try{await work();}catch{this.batch=null;this.notice='Проход остановлен: результат не подтверждён. Обновите состояние и проверьте доступ. Для продолжения сохранены прежние запросы.';}
  finally{this.busy=false;if(this.closed)this.batch=null;else this.render();}
 }
 render(){
  if(this.closed)return;this.root.replaceChildren();
  const text=(s:string)=>{const p=document.createElement('p');p.textContent=s;this.root.append(p);};
  const button=(label:string,action:()=>void,enabled=false)=>{const b=document.createElement('button');b.textContent=label;b.disabled=this.busy&&!enabled;b.onclick=action;this.root.append(b);};
  text('Массовый пересчёт индекса');
  button('Закрыть массовый пересчёт',()=>{this.closed=true;this.paused=true;this.root.replaceChildren();this.close();},true);
  button('Обновить состояние',()=>void this.load());
  if(this.notice)text(this.notice);
  const batch=this.batch;
  if(batch){
   text('Сохранённый план: '+batch.projects.map(id=>this.projects.find(p=>p.id===id)?.name??id).join(', '));
   text(`${batch.history?'Все версии':'Последние версии'}; снимок ${batch.captured_at}. Обработано ${batch.next} из ${batch.total}; изменено ${batch.changed}; без изменения ${batch.failed}. Стоимость: ${(batch.micro_usd/1000000).toFixed(6)} USD.`);
   if(batch.next<batch.total){
    text('Выполняется по действующим правилам, возможна платная обработка. Закрытие или пауза останавливают проход после текущего запроса. После обрыва продолжайте этот план; пока сервер не завершил запрос, повтор может снова вызвать модель.');
    button('Запустить / продолжить проход',()=>void this.execute());
    if(this.busy)button('Пауза после текущего файла',()=>{this.paused=true;},true);
    return;
   }
   text(batch.failed?'Проход окончен, часть индексов не изменена.':'Проход завершён.');
  }
  const select=document.createElement('select');select.setAttribute('aria-label','Проекты для пересчёта');select.disabled=this.busy;
  for(const p of [{id:'*',name:'Все доступные проекты'},...this.projects]){const o=document.createElement('option');o.value=p.id;o.textContent=p.name;select.append(o);}
  select.value=this.selected;select.onchange=()=>{this.selected=select.value;};this.root.append(select);
  const label=document.createElement('label'),history=document.createElement('input');history.type='checkbox';history.checked=this.history;history.disabled=this.busy;history.onchange=()=>{this.history=history.checked;};label.append(history,document.createTextNode('Все сохранённые версии'));this.root.append(label);
  button('Создать план пересчёта',()=>void this.prepare());
 }
}
