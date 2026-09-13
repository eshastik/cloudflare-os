import {outgoingMailAttachments} from '@gadgets/workshop-shared/mail-attachment';
import {readMailAttachment} from './mail-attachment.ts';
import type {MailDraftManagement,MailDraftReview,MailDraftPage} from '../src/mail-drafts.ts';
import type {MnemosAccountSession} from '../src/account-session.ts';
import type {MailConnectionPage,MailMessagePage,MailMessageQuery,MailConnectionInfo,MailGrantState} from '../src/mail-connections.ts';
type API=Pick<MnemosAccountSession,'listMailConnections'|'readMailMessages'|'readMailConnection'|'readMailGrantState'|'setMailReadGrant'|'disableMailConnection'|'listAgentConnections'> & MailDraftManagement;
/** Minimal owner management for an existing mail connection. */
export class MailConnectionsView {
 private connections?:MailConnectionPage;
 private messages?:MailMessagePage;private messageId='';private searchText='';private searchFrom='';private messageQuery:MailMessageQuery={limit:5};
 private draftPage?:MailDraftPage;
 private draftId='';private draft?:MailDraftReview;
 private id='';private principal='';private receipt?:MailConnectionInfo;private grant?:MailGrantState;
 private agents:Awaited<ReturnType<API['listAgentConnections']>>['connections']=[];private cursor='';
 private busy=false;private closed=false;private notice='';
 #root:HTMLElement;#api:API;#close:()=>void;
 constructor(root:HTMLElement,api:API,close:()=>void,private send?: (id:string,sha256:string)=>Promise<NonNullable<MailDraftReview['delivery']>>,private saveAttachment?:(bytes:Uint8Array,filename:string)=>Promise<void>){this.#root=root;this.#api=api;this.#close=close;}
 private async run(work:()=>Promise<void>){if(this.closed||this.busy)return;this.busy=true;this.notice='';this.render();try{await work();}catch{this.connections=undefined;this.messages=undefined;this.messageId='';this.draft=undefined;this.draftPage=undefined;this.receipt=undefined;this.grant=undefined;this.notice='Результат не подтверждён. Обновите состояние перед повтором.';}finally{this.busy=false;if(!this.closed)this.render();}}
 async listConnections(more=false){await this.run(async()=>{const page=await this.#api.listMailConnections(more?this.connections?.next_cursor:'');if(!this.closed)this.connections={...page,connections:more?[...(this.connections?.connections??[]),...page.connections]:page.connections};});}
 async load(id:string){await this.run(async()=>{this.draft=undefined;this.draftPage=undefined;this.id=id;this.messages=undefined;this.messageId='';this.searchText='';this.searchFrom='';this.messageQuery={limit:5};this.receipt=undefined;this.grant=undefined;const receipt=await this.#api.readMailConnection(id);if(!this.closed)this.receipt=receipt;});}
 async listAgents(more=false){await this.run(async()=>{const result=await this.#api.listAgentConnections(more?this.cursor:'');if(this.closed)return;this.agents=more?[...this.agents,...result.connections]:result.connections;this.cursor=result.next_cursor??'';});}
 async select(principal:string){await this.run(async()=>{this.principal=principal;this.grant=undefined;const state=await this.#api.readMailGrantState(this.id,principal);if(!this.closed)this.grant=state;});}
 async decide(enabled:boolean){const state=this.grant;if(!state)return;await this.run(async()=>{this.grant=undefined;await this.#api.setMailReadGrant(state.connection_id,{principal_id:state.principal_id,connection_revision:state.connection_revision,expected_revision:state.revision,enabled});const current=await this.#api.readMailGrantState(state.connection_id,state.principal_id);if(!this.closed){this.grant=current;this.notice=enabled?'Разрешение чтения сохранено.':'Разрешение чтения отозвано.';}});}
 async disable(){const receipt=this.receipt;if(!receipt)return;await this.run(async()=>{this.messages=undefined;this.messageId='';this.draft=undefined;this.draftPage=undefined;this.grant=undefined;await this.#api.disableMailConnection(receipt.connection_id,receipt.revision);const current=await this.#api.readMailConnection(receipt.connection_id);if(!this.closed){this.receipt=current;this.notice='Подключение отключено.';}});}
 async readMessages(more=false){const receipt=this.receipt;if(!receipt?.enabled||more&&!this.messages?.next_cursor)return;
  const query:MailMessageQuery=more?{...this.messageQuery,cursor:this.messages!.next_cursor}:{limit:5,search:{...(this.searchText.trim()?{text:this.searchText.trim()}:{}),...(this.searchFrom.trim()?{from:this.searchFrom.trim()}: {})}};
  await this.run(async()=>{this.messages=undefined;this.messageId='';const page=await this.#api.readMailMessages(receipt.project_id,receipt.connection_id,query);
   if(page.provider!==receipt.provider||page.query_sha256!==receipt.query_sha256)throw Error('Mail selection changed');
   if(!this.closed){this.messages=page;this.messageQuery=query;}
  });
 }
 async downloadAttachment(messageId:string,attachmentId:string){const receipt=this.receipt,message=this.messages?.messages.find(m=>m.message_id===messageId),file=message?.attachments.find(a=>a.attachment_id===attachmentId);if(!receipt?.enabled||!file||file.kind==='reference'||!this.saveAttachment)return;
  const query=this.messageQuery;
  await this.run(async()=>{const bytes=await readMailAttachment(q=>this.#api.readMailMessages(receipt.project_id,receipt.connection_id,q),query,messageId,file,receipt,()=>!this.closed);
   if(!this.closed){await this.saveAttachment!(bytes,file.filename??'attachment');this.notice='Файл проверен и передан браузеру для скачивания.';}
  });
 }
 async downloadDraftAttachment(index:number){const draft=this.draft;if(!draft||!this.saveAttachment)return;
  await this.run(async()=>{const current=await this.#api.readMailDraft(draft.id);if(current.connection_id!==this.id||current.sha256!==draft.sha256)throw Error('Draft changed');const files=await outgoingMailAttachments(current.content.attachments);const file=files[index];if(!file)throw Error('Attachment unavailable');if(!this.closed)await this.saveAttachment!(Uint8Array.from(atob(file.content_base64),c=>c.charCodeAt(0)),file.filename);});
 }
 async listDrafts(more=false){await this.run(async()=>{const result=await this.#api.listMailDrafts(this.id,more?this.draftPage?.next_cursor:'');if(!this.closed)this.draftPage={...result,drafts:more?[...(this.draftPage?.drafts??[]),...result.drafts]:result.drafts};});}
 async sendDraft(){const draft=this.draft;if(!draft||draft.state!=='approved'||draft.delivery||!this.send)return;await this.run(async()=>{this.draft=undefined;this.draftPage=undefined;await this.send!(draft.id,draft.sha256);const current=await this.#api.readMailDraft(draft.id);if(current.sha256!==draft.sha256||current.connection_id!==this.id)throw Error('Draft changed');if(!this.closed)this.draft=current;});}
 async loadDraft(id:string){await this.run(async()=>{this.draft=undefined;this.draftPage=undefined;this.draftId=id;const draft=await this.#api.readMailDraft(id);if(draft.connection_id!==this.id)throw Error('Connection changed');if(!this.closed)this.draft=draft;});}
 async decideDraft(approved:boolean){const draft=this.draft;if(!draft||draft.state!=='pending')return;await this.run(async()=>{this.draft=undefined;this.draftPage=undefined;const result=await this.#api.decideMailDraft(draft.id,draft.sha256,approved);if(result.connection_id!==this.id||result.sha256!==draft.sha256)throw Error('Draft changed');if(!this.closed){this.draft=result;this.notice='Решение сохранено. Это не подтверждение отправки письма.';}});}
 render(){if(this.closed)return;this.#root.replaceChildren();const text=(value:string,tag='p')=>{const e=document.createElement(tag);e.textContent=value;this.#root.append(e);};const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.disabled=this.busy;b.onclick=action;this.#root.append(b);return b;};
 text('Доступ к почте','h2');button('Закрыть почтовое подключение',()=>{this.closed=true;this.messages=undefined;this.messageId='';this.draft=undefined;this.draftPage=undefined;this.receipt=undefined;this.grant=undefined;this.#root.replaceChildren();this.#close();}).disabled=false;
 button('Мои почтовые подключения',()=>void this.listConnections());
 if(this.connections){
  if(!this.connections.connections.length)text('Подключений почты пока нет. Используйте «Подключить почту к Mnemos» над приложением.');
  for(const connection of this.connections.connections)button(`${connection.provider} · ${connection.project_id} · ${connection.connection_id}${connection.enabled?'':' (отключено)'}`,()=>void this.load(connection.connection_id));
  if(this.connections.next_cursor)button('Ещё почтовые подключения',()=>void this.listConnections(true));
 }
 const label=document.createElement('label');label.textContent='ID подключения почты';const input=document.createElement('input');input.setAttribute('aria-label',label.textContent);input.value=this.id;input.disabled=this.busy;label.append(input);this.#root.append(label);button('Обновить почтовое подключение',()=>void this.load(input.value.trim()));
 if(this.notice)text(this.notice);if(!this.receipt)return;
 text(`Почта: ${this.receipt.provider}`);text(`Проект: ${this.receipt.project_id}. Подключение ${this.receipt.enabled?'включено':'отключено'}.`);
 if(this.receipt.enabled)button('Отключить почтовое подключение',()=>void this.disable());
 if(this.receipt.enabled){
  for(const [title,value,update] of [['Поиск в теме и тексте',this.searchText,(v:string)=>{this.searchText=v;}],['Отправитель (email)',this.searchFrom,(v:string)=>{this.searchFrom=v;}]] as const){const label=document.createElement('label');label.textContent=title;const field=document.createElement('input');field.setAttribute('aria-label',title);field.value=value;field.disabled=this.busy;field.oninput=()=>update(field.value);label.append(field);this.#root.append(label);}
  button('Показать письма',()=>void this.readMessages());
 }
 if(this.messages){
  text('Письма','h3');
  for(const message of this.messages.messages)button(`${message.subject||'(Без темы)'} — ${message.from.map(a=>a.address).join(', ')}`,()=>{this.messageId=message.message_id;this.render();});
  if(!this.messages.messages.length)text(this.messages.next_cursor?'На этой странице совпадений нет. Продолжите поиск на следующей.':'На этой странице писем нет.');
  if(this.messages.next_cursor)button('Следующая страница писем',()=>void this.readMessages(true));
  else if(this.messages.truncated)text('Источник ограничил результат. Продолжение недоступно.');
  const message=this.messages.messages.find(m=>m.message_id===this.messageId);
  if(message){text(message.subject||'(Без темы)','h3');text('От: '+message.from.map(a=>a.name?`${a.name} <${a.address}>`:a.address).join(', '));text('Кому: '+message.to.map(a=>a.address).join(', '));if(message.cc.length)text('Копия: '+message.cc.map(a=>a.address).join(', '));text('Получено: '+message.received_at);
   if(message.body_format==='html')text('HTML показан как текст.');const body=document.createElement('pre');body.textContent=message.body;body.style.whiteSpace='pre-wrap';this.#root.append(body);
   if(message.body_truncated)text('Текст письма сокращён источником.');
   if(!message.attachment_metadata_included)text('Сведения о вложениях недоступны.');
   for(const attachment of message.attachments){text(`Вложение: ${attachment.filename??'(без имени)'} (${attachment.size} байт)`);if(attachment.kind==='reference')text('Внешняя ссылка: скачивание недоступно.');else if(this.saveAttachment)button(`Скачать ${attachment.filename??'вложение'}`,()=>void this.downloadAttachment(message.message_id,attachment.attachment_id));}
  }
 }
 if(this.receipt.enabled)button('Показать черновики писем',()=>void this.listDrafts());
 if(this.draftPage){for(const draft of this.draftPage.drafts)button(`${draft.subject} — ${draft.state==='pending'?'ожидает решения':draft.state==='approved'?'согласован':'отклонён'}`,()=>void this.loadDraft(draft.id));if(this.draftPage.next_cursor)button('Ещё черновики',()=>void this.listDrafts(true));else if(!this.draftPage.drafts.length)text('Черновиков писем нет.');}
 const draftLabel=document.createElement('label');draftLabel.textContent='ID черновика от агента';const draftInput=document.createElement('input');draftInput.setAttribute('aria-label',draftLabel.textContent);draftInput.value=this.draftId;draftInput.disabled=this.busy;draftLabel.append(draftInput);this.#root.append(draftLabel);
 button('Открыть черновик письма',()=>void this.loadDraft(draftInput.value.trim()));
 if(this.draft){
  text('Черновик письма','h3');text(`Агент: ${this.draft.agent_id}`);text('Кому: '+this.draft.content.to.join(', '));if(this.draft.content.cc?.length)text('Копия: '+this.draft.content.cc.join(', '));text('Тема: '+this.draft.content.subject);
  if(this.draft.content.reply){text('Ответ на письмо: '+this.draft.content.reply.subject);text('Исходное письмо: '+this.draft.content.reply.internet_message_id);text('Ответ использует сохранённую цепочку исходного письма. Адресаты показаны выше.');}
  const body=document.createElement('pre');body.textContent=this.draft.content.body;body.style.whiteSpace='pre-wrap';this.#root.append(body);
  for(const [index,file] of (this.draft.content.attachments??[]).entries()){text(`Файл ${index+1}: ${file.filename} · ${atob(file.content_base64).length} байт · ${file.content_type}`);text('SHA-256: '+file.sha256);if(this.saveAttachment)button(`Проверить файл ${index+1}: ${file.filename}`,()=>void this.downloadDraftAttachment(index));}
  text('Состояние: '+({pending:'ожидает решения',approved:'согласован',rejected:'отклонён'}[this.draft.state]));
  text('Решение относится к показанным адресатам, тексту и вложениям. Отправка выполняется отдельно.');
  if(this.draft.delivery)text(this.draft.delivery.state==='accepted'?'Провайдер принял письмо.':'Результат отправки неизвестен. Проверьте почтовый ящик перед созданием нового письма.');
  else if(this.draft.state==='approved'&&this.receipt.enabled&&['google','microsoft','apple','yandex','imap'].includes(this.receipt.provider)&&this.send)button('Отправить согласованное письмо',()=>void this.sendDraft());
  if(this.draft.state==='pending'&&this.receipt.enabled){button('Согласовать текст письма',()=>void this.decideDraft(true));button('Отклонить письмо',()=>void this.decideDraft(false));}
 }
 button('Показать моих агентов',()=>void this.listAgents());
 for(const agent of this.agents)button(`${agent.agent_principal_id}${agent.revoked?' (отозван)':''}`,()=>void this.select(agent.agent_principal_id));
 if(this.cursor)button('Ещё агенты',()=>void this.listAgents(true));
 if(this.grant){text(`Агент: ${this.principal}. Разрешение чтения ${this.grant.enabled?'сохранено':this.grant.revision===0?'не выдавалось':'отозвано'}.`);text('Фактическое чтение также требует действующих прав проекта и подключения.');if(this.grant.enabled)button('Отозвать чтение почты',()=>void this.decide(false));else if(this.grant.connection_enabled&&!this.agents.some(agent=>agent.agent_principal_id===this.principal&&agent.revoked))button('Разрешить чтение почты',()=>void this.decide(true));}
 }
}
