import type {WebDAVManagement} from '../src/webdav-accounts.ts';
/** Minimal account form inside the trusted Mnemos management screen. */
export class WebDAVAccountsView {
 private state?:Awaited<ReturnType<WebDAVManagement['listWebDAVAccounts']>>;
 private request=crypto.randomUUID();private busy=false;private closed=false;private notice='';
 constructor(private root:HTMLElement,private api:WebDAVManagement,private close:()=>void){}
 private async run(work:()=>Promise<void>){if(this.closed||this.busy)return;this.busy=true;this.notice='';this.render();try{await work();}catch{this.state=undefined;this.notice='Результат не подтверждён. Обновите список перед повтором. Пароль приложения потребуется ввести снова.';}finally{this.busy=false;if(!this.closed)this.render();}}
 async load(){await this.run(async()=>{const state=await this.api.listWebDAVAccounts();if(!this.closed){this.state=state;if(state.accounts.some(account=>account.id===this.request&&account.enabled))this.request=crypto.randomUUID();}});}
 async connect(server:string,username:string,password:string){const request=this.request;await this.run(async()=>{await this.api.connectWebDAVAccount({request,server,username,password});const state=await this.api.listWebDAVAccounts();if(!this.closed){this.state=state;this.request=crypto.randomUUID();this.notice='Аккаунт добавлен. В форме «Копия файла с диска» выберите WebDAV, подключённый аккаунт и путь файла.';}});}
 async remove(id:string){await this.run(async()=>{await this.api.removeWebDAVAccount(id);const state=await this.api.listWebDAVAccounts();if(!this.closed){this.state=state;this.notice='Пароль удалён. Сохранённый доступ к файлам этого аккаунта отозван.';}});}
 render(){if(this.closed)return;this.root.replaceChildren();const text=(value:string)=>{const p=document.createElement('p');p.textContent=value;this.root.append(p);};const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.disabled=this.busy;b.onclick=action;this.root.append(b);return b;};
 text('Аккаунты WebDAV');button('Закрыть аккаунты WebDAV',()=>{this.closed=true;this.state=undefined;this.root.replaceChildren();this.close();}).disabled=false;
 text('Введите логин и отдельный пароль приложения WebDAV. Для корпоративного сервера используйте выделенную учётную запись. Пароль остаётся на сервере Mnemos и не передаётся агентам.');
 button('Обновить аккаунты WebDAV',()=>void this.load());if(this.notice)text(this.notice);if(!this.state)return;if(!this.state.servers.length){text("Администратор ещё не настроил серверы WebDAV.");return;}
 for(const account of this.state.accounts){text(account.username+' — '+account.server+(account.enabled?'':' (подключение проверяется)'));button('Удалить аккаунт '+account.username,()=>void this.remove(account.id));}
 const label=(name:string,control:HTMLElement)=>{const element=document.createElement('label');element.textContent=name;control.setAttribute('aria-label',name);element.append(control);this.root.append(element);};
 const server=document.createElement('select');for(const item of this.state.servers){const option=document.createElement('option');option.value=item.id;option.textContent=item.title+' — '+item.url;server.append(option);}server.disabled=this.busy;label('Сервис WebDAV',server);
 const username=document.createElement('input');username.autocomplete='username';username.maxLength=255;username.disabled=this.busy;label('Логин WebDAV',username);
 const password=document.createElement('input');password.type='password';password.autocomplete='new-password';password.maxLength=4096;password.disabled=this.busy;label('Пароль приложения WebDAV',password);
 button('Добавить аккаунт WebDAV',()=>{const secret=password.value;password.value='';void this.connect(server.value,username.value.trim(),secret);});
 }
}
