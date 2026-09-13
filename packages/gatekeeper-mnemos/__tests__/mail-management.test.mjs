import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const compiled=await build({entryPoints:['app/mail-connections.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {MailConnectionsView}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
test('Mail UI uses displayed grant versions and reloads after a lost write response',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');
 let receipt={connection_id:'connection',project_id:'project',provider:'google',query_sha256:'mail',revision:1,enabled:true};
 let grant={connection_id:'connection',principal_id:'agent',connection_revision:1,connection_enabled:true,revision:0,enabled:false};const writes=[];let lost=true;
 const api={readMailConnection:async()=>receipt,listAgentConnections:async()=>({connections:[{agent_principal_id:'agent',revoked:false}]}),readMailGrantState:async()=>grant,setMailReadGrant:async(id,decision)=>{writes.push({id,...decision});grant={...grant,revision:grant.revision+1,enabled:decision.enabled};if(lost){lost=false;throw Error('lost response');}return {revision:grant.revision};},disableMailConnection:async(id,expected)=>{assert.equal(id,'connection');assert.equal(expected,1);receipt={...receipt,revision:2,enabled:false};return {disabled:true};}};
 const view=new MailConnectionsView(root,api,()=>{});await view.load('connection');await view.listAgents();await view.select('agent');assert.match(root.textContent,/не выдавалось/);
 await view.decide(true);assert.equal(writes.length,1);assert.match(root.textContent,/Результат не подтверждён/);await view.decide(true);assert.equal(writes.length,1);
 await view.load('connection');await view.select('agent');assert.match(root.textContent,/Разрешение чтения сохранено/);await view.decide(false);assert.deepEqual(writes[1],{id:'connection',principal_id:'agent',connection_revision:1,expected_revision:1,enabled:false});
 await view.disable();assert.match(root.textContent,/Подключение отключено/);assert(!root.textContent.includes('Разрешить чтение почты'));
 dom.window.close();delete globalThis.document;
});

test('Mail review displays literal full content and never retries approval without re-reading after loss',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');
 let draft={id:'draft',connection_id:'connection',agent_id:'agent',content:{to:['person@example.test'],subject:'Subject',body:'<script>unsafe()</script>\nFull body'},sha256:'a'.repeat(64),state:'pending'};let writes=0;
 const api={readMailConnection:async()=>({connection_id:'connection',project_id:'project',provider:'google',enabled:true}),readMailDraft:async()=>structuredClone(draft),decideMailDraft:async(id,hash,approved)=>{assert.equal(id,draft.id);assert.equal(hash,draft.sha256);assert.equal(approved,true);writes++;draft={...draft,state:'approved'};throw Error('lost ACK')}};
 const view=new MailConnectionsView(root,api,()=>{});
 try{
  await view.load('connection');await view.loadDraft('draft');assert.equal(root.querySelector('pre').textContent,draft.content.body);assert.equal(root.querySelector('script'),null);
  await view.decideDraft(true);assert.equal(writes,1);assert.equal(root.querySelector('pre'),null);await view.decideDraft(true);assert.equal(writes,1);
  await view.load('connection');await view.loadDraft('draft');assert.match(root.textContent,/согласован/);assert(!root.textContent.includes('Согласовать текст письма'));
 }finally{dom.window.close();delete globalThis.document}
});

test('owner opens a listed draft without copying an ID and clears list on connection failure',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');let fail=false;
 const draft={id:'draft',connection_id:'connection',agent_id:'agent',content:{to:['a@example.test'],cc:['copy@example.test'],subject:'Proposal',body:'Full text'},sha256:'a'.repeat(64),state:'pending'};
 const api={readMailConnection:async()=>{if(fail)throw Error('revoked');return {connection_id:'connection',provider:'google',project_id:'project',enabled:true}},listMailDrafts:async(id)=>{assert.equal(id,'connection');return {drafts:[{id:draft.id,agent_id:'agent',state:'pending',subject:draft.content.subject}]}},readMailDraft:async(id)=>{assert.equal(id,draft.id);return draft}};
 try{const view=new MailConnectionsView(root,api,()=>{});await view.load('connection');await view.listDrafts();const open=[...root.querySelectorAll('button')].find(b=>b.textContent==='Proposal — ожидает решения');assert(open);open.click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(root.querySelector('pre').textContent,'Full text');assert(root.textContent.includes('Копия: copy@example.test'));fail=true;await view.load('connection');assert(!root.textContent.includes('Proposal'));}finally{dom.window.close();delete globalThis.document;}
});

for(const provider of ['google','microsoft','apple','yandex','imap'])test(provider+' send uses the displayed approved digest and lost acknowledgement requires re-reading, never resending',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');let sends=0;
 let draft={id:'draft',connection_id:'connection',agent_id:'agent',content:{to:['a@example.test'],cc:['copy@example.test'],subject:'Proposal',body:'Full text'},sha256:'a'.repeat(64),state:'approved'};
 const api={readMailConnection:async()=>({connection_id:'connection',provider,project_id:'project',enabled:true}),readMailDraft:async()=>structuredClone(draft)};
 try{const view=new MailConnectionsView(root,api,()=>{},async(id,hash)=>{assert.equal(id,draft.id);assert.equal(hash,draft.sha256);sends++;draft={...draft,delivery:{state:'accepted',message_id:'sent'}};throw Error('lost ACK')});
 await view.load('connection');await view.loadDraft('draft');assert(root.textContent.includes('Отправить согласованное письмо'));await view.sendDraft();await view.sendDraft();assert.equal(sends,1);assert(!root.textContent.includes('Отправить согласованное письмо'));
 await view.load('connection');await view.loadDraft('draft');assert(root.textContent.includes('Провайдер принял письмо.'));assert(!root.textContent.includes('Отправить согласованное письмо'));await view.sendDraft();assert.equal(sends,1);
 }finally{dom.window.close();delete globalThis.document;}
});

for(const provider of ['google','microsoft','yandex','imap'])test(provider+' mailbox keeps filters across empty pages and renders HTML literally',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');let deny=false;const calls=[];
 const receipt={connection_id:'connection',project_id:'project',provider,query_sha256:'a'.repeat(64),enabled:true};
 const message={message_id:'mail',subject:'Found',from:[{name:'Sender',address:'sender@example.test'}],to:[{address:'owner@example.test'}],cc:[],received_at:'2026-09-11T10:00:00Z',body:'<img src="https://external.test/track"><script>unsafe()</script>',body_format:'html',body_truncated:true,attachment_metadata_included:true,attachments:[{filename:'contract.pdf',size:12}]};
 const api={readMailConnection:async()=>receipt,readMailMessages:async(project,connection,query)=>{assert.equal(project,'project');assert.equal(connection,'connection');if(deny)throw Error('revoked');calls.push(structuredClone(query));return {provider,query_sha256:receipt.query_sha256,messages:query.cursor?[message]:[],truncated:!query.cursor,...(!query.cursor?{next_cursor:'opaque-page'}:{})}}};
 try{const view=new MailConnectionsView(root,api,()=>{});await view.load('connection');
 const search=root.querySelector('[aria-label="Поиск в теме и тексте"]');search.value='contract';search.dispatchEvent(new dom.window.Event('input'));await view.readMessages();assert.match(root.textContent,/Продолжите поиск/);
 const changed=root.querySelector('[aria-label="Поиск в теме и тексте"]');changed.value='changed';changed.dispatchEvent(new dom.window.Event('input'));
 await view.readMessages(true);assert.deepEqual(calls,[{limit:5,search:{text:'contract'}},{limit:5,search:{text:'contract'},cursor:'opaque-page'}]);
 [...root.querySelectorAll('button')].find(b=>b.textContent==='Found — sender@example.test').click();assert.equal(root.querySelector('pre').textContent,message.body);assert.equal(root.querySelector('img,script'),null);assert.match(root.textContent,/сокращён/);assert.match(root.textContent,/contract.pdf/);
 deny=true;await view.readMessages();assert.equal(root.querySelector('pre'),null);assert(!root.textContent.includes('Found'));assert(!root.textContent.includes('Следующая страница писем'));
 }finally{dom.window.close();delete globalThis.document;}
});

test('mailbox close fences an in-flight read and mismatched connection result is withheld',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');let resolve;
 const receipt={connection_id:'connection',project_id:'project',provider:'imap',query_sha256:'a'.repeat(64),enabled:true};
 const api={readMailConnection:async()=>receipt,readMailMessages:()=>new Promise(r=>{resolve=r})};
 try{const view=new MailConnectionsView(root,api,()=>{});await view.load('connection');const pending=view.readMessages();[...root.querySelectorAll('button')].find(b=>b.textContent==='Закрыть почтовое подключение').click();resolve({provider:'imap',query_sha256:receipt.query_sha256,messages:[],truncated:false});await pending;assert.equal(root.textContent,'');
 const mismatch=new MailConnectionsView(root,{...api,readMailMessages:async()=>({provider:'google',query_sha256:receipt.query_sha256,messages:[{subject:'foreign'}],truncated:false})},()=>{});await mismatch.load('connection');await mismatch.readMessages();assert(!root.textContent.includes('foreign'));assert.match(root.textContent,/не подтверждён/);
 }finally{dom.window.close();delete globalThis.document;}
});

test('attachment download uses selected page and file ID, and exposes only verified bytes to host',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');const bytes=new Uint8Array([0,255,1]);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');let saved=0;
 const receipt={connection_id:'connection',project_id:'project',provider:'imap',query_sha256:'a'.repeat(64),enabled:true};const file={attachment_id:'mime:1',filename:'same.bin',kind:'file',sha256:hash,size:3};const message={message_id:'mail',subject:'Files',from:[],to:[],cc:[],body:'Body',received_at:'',attachments:[{...file,attachment_id:'mime:0'},file]};
 const api={readMailConnection:async()=>receipt,readMailMessages:async(p,c,q)=>{assert.equal(p,'project');assert.equal(c,'connection');if(!q.attachment)return {...receipt,messages:[message],truncated:false};assert.equal(q.attachment.attachment_id,'mime:1');assert.equal(q.attachment.expected_sha256,hash);return {...receipt,messages:[],truncated:false,attachment:{message_id:'mail',attachment_id:'mime:1',offset:0,total_size:3,sha256:hash,content_base64:Buffer.from(bytes).toString('base64'),complete:true}}}};
 try{const view=new MailConnectionsView(root,api,()=>{},undefined,async(actual,name)=>{assert.deepEqual(actual,bytes);assert.equal(name,'same.bin');saved++});await view.load('connection');await view.readMessages();await view.downloadAttachment('mail','mime:1');assert.equal(saved,1);assert.match(root.textContent,/Файл проверен/);}finally{dom.window.close();delete globalThis.document;}
});

test('owner catalogue follows its cursor and opens a selected connection without entering an ID',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');let fail=false;const calls=[];const connection={connection_id:'chosen',project_id:'project',provider:'imap',enabled:true};
 const api={listMailConnections:async cursor=>{calls.push(cursor);if(fail)throw Error('revoked');return {connections:cursor?[connection]:[{...connection,connection_id:'disabled',enabled:false}],...(!cursor?{next_cursor:'opaque'}:{})}},readMailConnection:async id=>{assert.equal(id,'chosen');return connection}};
 try{const view=new MailConnectionsView(root,api,()=>{});await view.listConnections();assert.match(root.textContent,/отключено/);await view.listConnections(true);assert.deepEqual(calls,['','opaque']);[...root.querySelectorAll('button')].find(b=>b.textContent==='imap · project · chosen').click();await new Promise(r=>setTimeout(r,0));assert.match(root.textContent,/Показать письма/);fail=true;await view.listConnections();assert(!root.textContent.includes('chosen'));assert.match(root.textContent,/не подтверждён/);}finally{dom.window.close();delete globalThis.document;}
});

test('review shows attached bytes before approval and allows checking exact file',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');const bytes=Buffer.from([0,255]),sha256=(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');const file={filename:'Смета.bin',content_type:'application/octet-stream',content_base64:bytes.toString('base64'),sha256};const draft={id:'draft',connection_id:'connection',agent_id:'agent',sha256:'a'.repeat(64),state:'pending',content:{to:['bob@example.test'],subject:'Files',body:'Body',attachments:[file]}};let saved=0;
 const api={readMailConnection:async()=>({connection_id:'connection',project_id:'project',provider:'imap',enabled:true}),readMailDraft:async()=>draft};
 try{const view=new MailConnectionsView(root,api,()=>{},undefined,async(data,name)=>{assert.deepEqual(Buffer.from(data),bytes);assert.equal(name,file.filename);saved++});await view.load('connection');await view.loadDraft('draft');assert(root.textContent.includes(sha256));assert(root.textContent.includes('Смета.bin · 2 байт'));await view.downloadDraftAttachment(0);assert.equal(saved,1);}finally{dom.window.close();delete globalThis.document;}
});
