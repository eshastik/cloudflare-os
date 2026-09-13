import type {ImapManagement} from '../src/imap-types.ts';
/** Minimal account form inside the trusted Mnemos management screen. */
export class ImapAccountsView {
 private state?:Awaited<ReturnType<ImapManagement['listImapAccounts']>>;
 private request=crypto.randomUUID();private busy=false;private closed=false;private notice='';
 constructor(private root:HTMLElement,private api:ImapManagement,private close:()=>void){}
 private async run(work:()=>Promise<void>){if(this.closed||this.busy)return;this.busy=true;this.notice='';this.render();try{await work();}catch{this.state=undefined;this.notice='Результат не подтверждён. Обновите список перед повтором. Пароль приложения потребуется ввести снова.';}finally{this.busy=false;if(!this.closed)this.render();}}
 async load(){await this.run(async()=>{const state=await this.api.listImapAccounts();if(!this.closed){this.state=state;if(state.accounts.some(account=>account.id===this.request&&account.enabled))this.request=crypto.randomUUID();}});}
 async connect(server:string,username:string,password:string,mailbox:string,smtp?:Parameters<ImapManagement['connectImapAccount']>[0]['smtp']){const request=this.request;await this.run(async()=>{await this.api.connectImapAccount({request,server,username,password,mailbox,...(smtp?{smtp}:{})});const state=await this.api.listImapAccounts();if(!this.closed){this.state=state;this.request=crypto.randomUUID();this.notice='Папка добавлена. В форме «Подключить почту к Mnemos» выберите этот аккаунт Mnemos как источник, затем папку и проект. Права агентам выдаются отдельно.';}});}
 async remove(id:string){await this.run(async()=>{await this.api.removeImapAccount(id);const state=await this.api.listImapAccounts();if(!this.closed){this.state=state;this.notice='Пароль удалён. Сохранённый доступ к этой папке отозван.';}});}
 render(){if(this.closed)return;this.root.replaceChildren();const text=(value:string)=>{const p=document.createElement('p');p.textContent=value;this.root.append(p);};const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.disabled=this.busy;b.onclick=action;this.root.append(b);return b;};
 text('Аккаунты почты: Яндекс, iCloud, IMAP');button('Закрыть аккаунты почты',()=>{this.closed=true;this.state=undefined;this.root.replaceChildren();this.close();}).disabled=false;
 text('Введите логин и отдельный пароль приложения почты. Для корпоративного сервера используйте выделенную учётную запись. Пароль остаётся на сервере Mnemos и не передаётся агентам.');
 button('Обновить аккаунты почты',()=>void this.load());if(this.notice)text(this.notice);if(!this.state)return;
 for(const account of this.state.accounts){text(account.username+' — '+account.server+(account.enabled?'':' (подключение проверяется)'));text(account.mailbox);if(account.send_from)text('Отправка от: '+account.send_from);button('Удалить аккаунт '+account.username+' — '+account.mailbox,()=>void this.remove(account.id));}
 const label=(name:string,control:HTMLElement)=>{const element=document.createElement('label');element.textContent=name;control.setAttribute('aria-label',name);element.append(control);this.root.append(element);};
 const server=document.createElement('select');for(const item of this.state.servers){const option=document.createElement('option');option.value=item.id;option.textContent=item.title+' — '+item.host+':'+item.port;server.append(option);}server.disabled=this.busy;label('Сервис почты',server);
 const username=document.createElement('input');username.autocomplete='username';username.maxLength=255;username.disabled=this.busy;label('Логин почты',username);
 const password=document.createElement('input');password.type='password';password.autocomplete='new-password';password.maxLength=4096;password.disabled=this.busy;label('Пароль приложения почты',password);
 const mailbox=document.createElement('input');mailbox.value='INBOX';mailbox.maxLength=512;mailbox.disabled=this.busy;label('Папка почты',mailbox);
 text('Отправка необязательна. Укажите адрес отправителя, чтобы включить SMTP. Каждое письмо потребует отдельного согласования.');
 const from=document.createElement('input');from.type='email';from.maxLength=254;from.disabled=this.busy;label('Адрес отправителя SMTP',from);
 const smtpUser=document.createElement('input');smtpUser.maxLength=255;smtpUser.disabled=this.busy;label('Логин SMTP (если отличается)',smtpUser);
 const smtpPassword=document.createElement('input');smtpPassword.type='password';smtpPassword.autocomplete='new-password';smtpPassword.maxLength=4096;smtpPassword.disabled=this.busy;label('Пароль SMTP (если отличается)',smtpPassword);
 button('Добавить аккаунт почты',()=>{const secret=password.value,sendSecret=smtpPassword.value;password.value='';smtpPassword.value='';const smtp=from.value.trim()?{from:from.value.trim(),username:smtpUser.value.trim()||username.value.trim(),password:sendSecret||secret}:undefined;void this.connect(server.value,username.value.trim(),secret,mailbox.value,smtp);});
 }
}
