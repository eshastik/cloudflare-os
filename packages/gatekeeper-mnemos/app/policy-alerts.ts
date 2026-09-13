import type {MnemosAccountSession} from '../src/account-session.ts';
import type {PolicyAlertPage} from '../src/policy-alerts.ts';
type API=Pick<MnemosAccountSession,'policyAlerts'|'reviewPolicyAlert'>;
/** Minimal operator queue; every review requires an explicit button press. */
export class PolicyAlertsView {
 private page?:PolicyAlertPage;private busy=false;private closed=false;private notice='';private all=false;
 constructor(private root:HTMLElement,private api:API,private close:()=>void){}
 async load(after=''){await this.run(async()=>{this.page=await this.api.policyAlerts(after,this.all);});}
 async review(id:string,note:string){await this.run(async()=>{
  const result=await this.api.reviewPolicyAlert(id,note);
  this.page=await this.api.policyAlerts('',this.all);
  this.notice=result.reviewed?'Рассмотрение записано.':'Новое решение не записано. Проверьте ранее рассмотренные предупреждения.';
 });}
 private async run(work:()=>Promise<void>){
  if(this.closed||this.busy)return;this.busy=true;this.notice='';this.page=undefined;this.render();
  try{await work();}catch{this.page=undefined;this.notice='Не удалось подтвердить результат. Обновите список; требуется право администратора.';}
  finally{this.busy=false;if(this.closed)this.page=undefined;else this.render();}
 }
 render(){
  if(this.closed)return;this.root.replaceChildren();
  const text=(value:string)=>{const p=document.createElement('p');p.textContent=value;this.root.append(p);};
  const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.disabled=this.busy;b.onclick=action;this.root.append(b);return b;};
  text('Предупреждения политики');
  button('Закрыть предупреждения',()=>{this.closed=true;this.page=undefined;this.root.replaceChildren();this.close();}).disabled=false;
  button('Обновить список',()=>void this.load());
  button(this.all?'Показать нерассмотренные':'Показать также рассмотренные',()=>{this.all=!this.all;void this.load();});
  text('Рассмотрение сохраняет комментарий администратора. Оно не изменяет правила загрузки и права доступа.');
  if(this.notice)text(this.notice);if(!this.page)return;
  if(!this.page.alerts.length)text('Предупреждений нет.');
  for(const alert of this.page.alerts){
   text(`${alert.source_path} · ${alert.policy_class} · ${alert.reason} · ${new Date(alert.raised_at).toLocaleString()}`);
   if(alert.reviewed_at){text(`Рассмотрено ${alert.reviewed_by}: ${alert.review_note??''}`);continue;}
   const note=document.createElement('textarea');note.setAttribute('aria-label','Комментарий к '+alert.source_path);note.maxLength=4096;this.root.append(note);
   button('Отметить рассмотренным: '+alert.source_path,()=>void this.review(alert.id,note.value));
  }
  if(this.page.truncated){const next=this.page.next;button('Следующая страница',()=>void this.load(next));}
 }
}
