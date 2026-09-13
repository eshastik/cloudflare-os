import type {CalDAVManagement} from '../src/caldav-types.ts';
/** Minimal account form inside the trusted Mnemos management screen. */
export class CalDAVAccountsView {
 private state?:Awaited<ReturnType<CalDAVManagement['listCalDAVAccounts']>>;
 private request=crypto.randomUUID();private busy=false;private closed=false;private notice='';
 constructor(private root:HTMLElement,private api:CalDAVManagement,private close:()=>void){}
 private async run(work:()=>Promise<void>){if(this.closed||this.busy)return;this.busy=true;this.notice='';this.render();try{await work();}catch{this.state=undefined;this.notice='Результат не подтверждён. Обновите список перед повтором. Пароль приложения потребуется ввести снова.';}finally{this.busy=false;if(!this.closed)this.render();}}
 async load(){await this.run(async()=>{const state=await this.api.listCalDAVAccounts();if(!this.closed){this.state=state;if(state.accounts.some(account=>account.id===this.request&&account.enabled))this.request=crypto.randomUUID();}});}
 async connect(server:string,username:string,password:string){const request=this.request;await this.run(async()=>{await this.api.connectCalDAVAccount({request,server,username,password});const state=await this.api.listCalDAVAccounts();if(!this.closed){this.state=state;this.request=crypto.randomUUID();this.notice='Аккаунт добавлен. В форме «Подключить календарь к Mnemos» выберите этот аккаунт Mnemos как источник, затем календарь и проект.';}});}
 async remove(id:string){await this.run(async()=>{await this.api.removeCalDAVAccount(id);const state=await this.api.listCalDAVAccounts();if(!this.closed){this.state=state;this.notice='Пароль удалён. Сохранённый доступ к календарям этого аккаунта отозван.';}});}
 render(){if(this.closed)return;this.root.replaceChildren();const text=(value:string)=>{const p=document.createElement('p');p.textContent=value;this.root.append(p);};const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.disabled=this.busy;b.onclick=action;this.root.append(b);return b;};
 text('Аккаунты календарей: Яндекс, iCloud, CalDAV');button('Закрыть аккаунты календарей',()=>{this.closed=true;this.state=undefined;this.root.replaceChildren();this.close();}).disabled=false;
 text('Введите логин и отдельный пароль приложения календаря. Для корпоративного сервера используйте выделенную учётную запись. Пароль остаётся на сервере Mnemos и не передаётся агентам.');
 button('Обновить аккаунты календарей',()=>void this.load());if(this.notice)text(this.notice);if(!this.state)return;
 for(const account of this.state.accounts){text(account.username+' — '+account.server+(account.enabled?'':' (подключение проверяется)'));for(const calendar of account.calendars)text(calendar.title);button('Удалить аккаунт '+account.username,()=>void this.remove(account.id));}
 const label=(name:string,control:HTMLElement)=>{const element=document.createElement('label');element.textContent=name;control.setAttribute('aria-label',name);element.append(control);this.root.append(element);};
 const server=document.createElement('select');for(const item of this.state.servers){const option=document.createElement('option');option.value=item.id;option.textContent=item.title+' — '+item.url;server.append(option);}server.disabled=this.busy;label('Сервис календаря',server);
 const username=document.createElement('input');username.autocomplete='username';username.maxLength=255;username.disabled=this.busy;label('Логин календаря',username);
 const password=document.createElement('input');password.type='password';password.autocomplete='new-password';password.maxLength=4096;password.disabled=this.busy;label('Пароль приложения календаря',password);
 button('Добавить аккаунт календаря',()=>{const secret=password.value;password.value='';void this.connect(server.value,username.value.trim(),secret);});
 }
}
