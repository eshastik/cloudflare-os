import type {MnemosAccountSession} from '../src/account-session.ts';
type API=Pick<MnemosAccountSession,'listPlatformSignalOwners'|'setPlatformSignalOwner'>;
/** Human responsibility assignments are independent of access grants. */
export class PlatformSignalOwnersView {
 private page?:Awaited<ReturnType<API['listPlatformSignalOwners']>>;
 private busy=false;private closed=false;private notice='';
 constructor(private root:HTMLElement,private api:API,private close:()=>void){}
 private async run(work:()=>Promise<void>){if(this.closed||this.busy)return;this.busy=true;this.notice='';this.render();try{await work();}catch{this.page=undefined;this.notice='Назначение не подтверждено. Перечитайте состояние: нужны административные права и активный пользователь этой организации.';}finally{this.busy=false;if(!this.closed)this.render();}}
 async read(){await this.run(async()=>{const page=await this.api.listPlatformSignalOwners();if(!this.closed)this.page=page;});}
 async set(key:string,owner:string,revision:number){const page=this.page;if(!page)return;await this.run(async()=>{const updated=await this.api.setPlatformSignalOwner(key,{owner_id:owner,expected_generation:page.generation,expected_revision:revision});if(!this.closed){this.page=updated;this.notice='Ответственный обновлён. Права доступа не менялись.';}});}
 render(){if(this.closed)return;this.root.replaceChildren();const text=(s:string)=>{const p=document.createElement('p');p.textContent=s;this.root.append(p);};const button=(s:string,fn:()=>void)=>{const b=document.createElement('button');b.textContent=s;b.disabled=this.busy;b.onclick=fn;this.root.append(b);return b;};
 text('Ответственные за сигналы платформы');button('Закрыть ответственных',()=>{this.closed=true;this.page=undefined;this.root.replaceChildren();this.close();}).disabled=false;
 text('Укажите ID человека в организации. Назначение не выдаёт доступ к метрикам; он управляется отдельно.');if(this.notice)text(this.notice);button('Обновить ответственных',()=>void this.read());
 const names={dependencies:'Зависимости API','external.readiness':'Внешняя доступность','external.login':'Вход','external.read':'Чтение','external.save':'Сохранение'};
 for(const row of this.page?.owners??[]){text(`${names[row.signal_key]}: ${row.owner_id?`${row.owner_name||row.owner_id} (${row.owner_id})${row.owner_active?'':' — неактивен'}`:'не назначен'}`);const input=document.createElement('input');input.setAttribute('aria-label',`Ответственный ${row.signal_key}`);input.value=row.owner_id;input.disabled=this.busy;this.root.append(input);button(`Назначить: ${names[row.signal_key]}`,()=>{if(input.value.trim())void this.set(row.signal_key,input.value.trim(),row.revision);});if(row.owner_id)button(`Снять назначение: ${names[row.signal_key]}`,()=>void this.set(row.signal_key,'',row.revision));}
 }
}
