import type {MnemosAccountSession} from '../src/account-session.ts';
type API=Pick<MnemosAccountSession,'platformSignalInbox'|'readPlatformSignalNotification'>;

export class PlatformSignalInboxView {
 private page?:Awaited<ReturnType<API['platformSignalInbox']>>;
 private busy=false;
 private closed=false;
 private notice='';
 private before='';
 private timer:ReturnType<typeof setInterval>;
 constructor(private root:HTMLElement,private api:API,private close:()=>void){
  this.timer=setInterval(()=>{if(!document.hidden&&!this.before)void this.load();},60_000);
 }
 async load(before=''){await this.run(async()=>{const page=await this.api.platformSignalInbox(before);if(!this.closed){this.page=page;this.before=before;}});}
 async mark(id:string){await this.run(async()=>{const page=await this.api.readPlatformSignalNotification(id);if(!this.closed){this.page=page;this.before='';}});}
 private async run(work:()=>Promise<void>){
  if(this.closed||this.busy)return;
  this.busy=true;this.notice='';this.page=undefined;this.render();
  try{await work();}catch{this.page=undefined;this.notice='Уведомления недоступны. Проверьте подключение и право на метрики.';}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 render(){
  if(this.closed)return;
  this.root.replaceChildren();
  const text=(value:string)=>{const p=document.createElement('p');p.textContent=value;this.root.append(p);};
  const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.disabled=this.busy;b.onclick=action;this.root.append(b);return b;};
  text('Уведомления платформы');
  button('Закрыть уведомления',()=>{this.closed=true;clearInterval(this.timer);this.page=undefined;this.root.replaceChildren();this.close();}).disabled=false;
  button('Обновить уведомления',()=>void this.load());
  text('Сообщения для назначенного ответственного. Хранятся 90 дней. Открытый список обновляется раз в минуту.');
  if(this.notice)text(this.notice);
  if(!this.page)return;
  text(`Непрочитанных: ${this.page.unread}`);
  if(!this.page.items.length)text('Уведомлений нет.');
  const names={dependencies:'Зависимости API','external.readiness':'Внешняя доступность','external.login':'Вход','external.read':'Чтение','external.save':'Сохранение'};
  const reasons={check_passed:'проверка успешна',check_failed:'проверка неуспешна',check_unavailable:'проверка недоступна',source_unavailable:'источник недоступен',observations_missing:'наблюдений нет',observations_stale:'наблюдения устарели'};
  for(const item of this.page.items){
   text(`${names[item.key]} — ${{ok:'Восстановлено',firing:'Тревога',unknown:'Неизвестно'}[item.state]}: ${reasons[item.reason]}. ${new Date(item.created_at).toLocaleString()}${item.read_at?' · Прочитано':''}`);
   if(!item.read_at)button(`Прочитано: ${names[item.key]}`,()=>void this.mark(item.id));
  }
  if(this.page.next_before){const cursor=this.page.next_before;button('Более ранние уведомления',()=>void this.load(cursor));}
 }
}
