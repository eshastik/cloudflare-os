import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const built=await build({stdin:{contents:'export {OperationAuditView} from "./app/operation-audit.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {OperationAuditView}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const event={id:'151',tenant_id:'tenant',actor:'agent',on_behalf_of:'manager',action:'git.file.read',resource:'["project","connection","10"]',subject:'attempt',allowed:false,reason:'requested',at:'2026-09-09T20:00:00Z',prev_hash:'',hash:'hash'};
test('Audit UI shows scoped pages and separate actors, clears data after access denial',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');const calls=[];let allowed=true;
 const api={readOperationAudit:async after=>{calls.push(after);if(!allowed)throw Error('denied');return {events:after===0?[]:[{...event,resource:'<img src=x> confidential'}],checkpoint:{sequence:250,hash:'head'},next:after===0?0:151,truncated:true};}};
 const view=new OperationAuditView(root,api,()=>{});await view.load();assert.deepEqual(calls,[0,150]);assert(root.textContent.includes('Исполнитель: agent · От имени: manager'));assert.equal(root.querySelector('img'),null);
 const input=root.querySelector('input');input.value='absent';[...root.querySelectorAll('button')].find(b=>b.textContent==='Применить фильтр').click();assert(root.textContent.includes('подходящих событий нет'));assert.equal(calls.length,2);assert(root.textContent.includes('Следующая страница'));
 allowed=false;await view.load(151);assert(!root.textContent.includes('confidential'));assert(!root.textContent.includes('Исполнитель: agent'));assert(root.textContent.includes('административные права'));
});
test('Audit UI does not restore a closed view after an outstanding response',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let release;const api={readOperationAudit:async()=>new Promise(resolve=>release=resolve)};
 const view=new OperationAuditView(root,api,()=>{root.textContent='dashboard';});const pending=view.load(0);
 [...root.querySelectorAll('button')].find(b=>b.textContent==='Закрыть журнал').click();release({events:[event],checkpoint:{sequence:151,hash:'head'},next:151,truncated:false});await pending;assert.equal(root.textContent,'dashboard');
});
