import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const compiled=await build({entryPoints:['app/calendar-connections.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {CalendarConnectionsView}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
test('Calendar UI uses displayed grant versions and reloads after a lost write response',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');
 let receipt={connection_id:'connection',project_id:'project',provider:'google',calendar_id:'calendar',revision:1,enabled:true};
 let grant={connection_id:'connection',principal_id:'agent',connection_revision:1,connection_enabled:true,revision:0,enabled:false};const writes=[];let lost=true;
 const api={readCalendarConnection:async()=>receipt,listAgentConnections:async()=>({connections:[{agent_principal_id:'agent',revoked:false}]}),readCalendarGrantState:async()=>grant,setCalendarReadGrant:async(id,decision)=>{writes.push({id,...decision});grant={...grant,revision:grant.revision+1,enabled:decision.enabled};if(lost){lost=false;throw Error('lost response');}return {revision:grant.revision};},disableCalendarConnection:async(id,expected)=>{assert.equal(id,'connection');assert.equal(expected,1);receipt={...receipt,revision:2,enabled:false};return {disabled:true};}};
 const view=new CalendarConnectionsView(root,api,()=>{});await view.load('connection');await view.listAgents();await view.select('agent');assert.match(root.textContent,/не выдавалось/);
 await view.decide(true);assert.equal(writes.length,1);assert.match(root.textContent,/Результат не подтверждён/);await view.decide(true);assert.equal(writes.length,1);
 await view.load('connection');await view.select('agent');assert.match(root.textContent,/Разрешение чтения сохранено/);await view.decide(false);assert.deepEqual(writes[1],{id:'connection',principal_id:'agent',connection_revision:1,expected_revision:1,enabled:false});
 await view.disable();assert.match(root.textContent,/Подключение отключено/);assert(!root.textContent.includes('Разрешить чтение календаря'));
 dom.window.close();delete globalThis.document;
});

test('calendar proposal displays exact UTC instants and attendees; lost decision ACK clears the review',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');let writes=0;
 let draft={id:'draft',connection_id:'connection',agent_id:'agent',content:{title:'Meeting',start:'2026-09-11T10:00:00.000Z',end:'2026-09-11T11:00:00.000Z',description:'<script>bad()</script>',location:'Room',attendees:['person@example.test']},sha256:'a'.repeat(64),state:'pending'};
 const api={readCalendarConnection:async()=>({connection_id:'connection',calendar_id:'calendar',provider:'google',enabled:true}),listCalendarDrafts:async()=>({drafts:[{id:draft.id,title:'Meeting',state:'pending',agent_id:'agent'}]}),readCalendarDraft:async()=>structuredClone(draft),decideCalendarDraft:async(id,hash,approved)=>{assert.equal(id,draft.id);assert.equal(hash,draft.sha256);assert(approved);writes++;draft={...draft,state:'approved'};throw Error('lost ACK')}};
 try{const view=new CalendarConnectionsView(root,api,()=>{});await view.load('connection');await view.listDrafts();assert(root.textContent.includes('Meeting'));await view.openDraft('draft');assert(root.textContent.includes('Начало (UTC): '+draft.content.start));assert(root.textContent.includes('person@example.test'));assert.equal(root.querySelector('script'),null);assert.equal(root.querySelector('pre').textContent,draft.content.description);await view.decideDraft(true);await view.decideDraft(true);assert.equal(writes,1);assert.equal(root.querySelector('pre'),null);await view.load('connection');await view.openDraft('draft');assert(!root.textContent.includes('Согласовать встречу'));}finally{dom.window.close();delete globalThis.document;}
});

for(const provider of ['google','microsoft','yandex','apple','caldav'])test(provider+' meeting creation is explicit; lost ACK clears action and recovered event cannot create twice',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');let calls=0;
 let draft={id:'draft',connection_id:'connection',agent_id:'agent',content:{title:'Meeting',start:'2026-09-11T10:00:00.000Z',end:'2026-09-11T11:00:00.000Z',description:'Discuss',location:'Room',attendees:['person@example.test']},sha256:'a'.repeat(64),state:'approved'};
 const api={checkCalDAVScheduling:async id=>({calendar_id:id,available:true}),readCalendarConnection:async()=>({connection_id:'connection',calendar_id:'team',provider,enabled:true}),readCalendarDraft:async()=>structuredClone(draft)};
 const create=async(id,sha)=>{calls++;assert.equal(id,draft.id);assert.equal(sha,draft.sha256);draft={...draft,execution:{state:'created',event_id:'event-1'}};throw Error('lost ACK')};
 try{
  const view=new CalendarConnectionsView(root,api,()=>{},create);await view.load('connection');await view.openDraft('draft');assert.match(root.textContent,/передаст приглашения календарному сервису/);assert.equal(calls,0);
  await view.createDraft();assert.match(root.textContent,/Результат не подтверждён/);await view.createDraft();assert.equal(calls,1);
  await view.load('connection');await view.openDraft('draft');assert.match(root.textContent,/Событие создано. ID: event-1/);assert(!root.textContent.includes('Создать встречу и отправить приглашения'));await view.createDraft();assert.equal(calls,1);
  draft={...draft,execution:{state:'attempted'}};await view.openDraft('draft');assert.match(root.textContent,/повтор отключён/);await view.createDraft();assert.equal(calls,1);
 }finally{dom.window.close();delete globalThis.document;}
});

test('unsupported CalDAV invitations keep the approved proposal without starting an execution',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let writes=0,checks=0;
 const draft={id:'draft',connection_id:'connection',agent_id:'agent',state:'approved',sha256:'hash',content:{title:'Invite',start:'2026-09-11T10:00:00.000Z',end:'2026-09-11T11:00:00.000Z',description:'Description',location:'Room',attendees:['person@example.test']}};
 const api={readCalendarConnection:async()=>({connection_id:'connection',calendar_id:'team',provider:'caldav',enabled:true}),readCalendarDraft:async()=>structuredClone(draft),checkCalDAVScheduling:async id=>{checks++;return {calendar_id:id,available:false}}};
 const view=new CalendarConnectionsView(root,api,()=>{},async()=>{writes++;return {state:'created',event_id:'event'}});
 try{await view.load('connection');await view.openDraft('draft');assert.equal(checks,1);assert.match(root.textContent,/не подтверждает поддержку приглашений/);assert(!root.textContent.includes('Создать встречу и отправить приглашения'));await view.createDraft();assert.equal(writes,0);assert.equal(draft.execution,undefined);
 draft.content.attendees=[];await view.openDraft('draft');assert.equal(checks,1);assert([...root.querySelectorAll('button')].some(b=>b.textContent==='Создать встречу'));assert(!root.textContent.includes('отправить приглашения'));
 }finally{dom.window.close();delete globalThis.document;}
});

test('owner calendar catalog paginates and opens a selected connection without typing its ID',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');const calls=[];
 const first={connection_id:'first',project_id:'project',provider:'google',calendar_id:'team',revision:1,enabled:true};
 const second={...first,connection_id:'second',provider:'caldav',calendar_id:'personal',enabled:false};let denied=false;
 const api={listCalendarConnections:async cursor=>{calls.push(cursor);if(denied)throw Error('revoked');return cursor?{connections:[second]}:{connections:[first],next_cursor:'first'};},readCalendarConnection:async id=>{calls.push(id);return second;}};
 const view=new CalendarConnectionsView(root,api,()=>{});
 try{await view.listConnections();assert(root.textContent.includes('google · project · team'));await view.listConnections(true);assert(root.textContent.includes('caldav · project · personal (отключён)'));const button=[...root.querySelectorAll('button')].find(x=>x.textContent.includes('caldav ·'));button.click();await new Promise(r=>setTimeout(r,0));assert.equal(root.querySelector('[aria-label="ID подключения календаря"]').value,'second');assert(root.textContent.includes('Подключение отключено'));assert.deepEqual(calls,['','first','second']);denied=true;await view.listConnections();assert(!root.textContent.includes('personal'));assert(root.textContent.includes('Результат не подтверждён'));}finally{dom.window.close();delete globalThis.document;}
});
