import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const built=await build({stdin:{contents:'export {PlatformSignalInboxView} from "./app/platform-signal-inbox.ts"; export {validSignalInbox} from "./src/platform-signal-inbox.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {PlatformSignalInboxView,validSignalInbox}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const page=()=>({items:[{id:'9007199254740993',key:'external.read',state:'firing',reason:'check_failed',observed_at:null,created_at:'2026-09-12T00:00:00Z',read_at:null}],unread:1,next_before:''});
function setup(api){const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');const view=new PlatformSignalInboxView(root,api,()=>{});const close=()=>[...root.querySelectorAll('button')].find(x=>x.textContent==='Закрыть уведомления').click();return {root,view,close};}
test('private contents clear on revocation and closing ignores pending response',async()=>{
 let fail=false;const a=setup({platformSignalInbox:async()=>{if(fail)throw Error('403');return page();}});
 try{await a.view.load();assert.match(a.root.textContent,/Тревога/);fail=true;await a.view.load();assert.doesNotMatch(a.root.textContent,/Тревога/);assert.match(a.root.textContent,/недоступны/);}finally{a.close();}
 let resolve;const b=setup({platformSignalInbox:()=>new Promise(r=>resolve=r)});const pending=b.view.load();b.close();resolve(page());await pending;assert.equal(b.root.textContent,'');
});
test('acknowledgment preserves the full integer ID and displays returned read state',async()=>{
 const a=setup({platformSignalInbox:async()=>page(),readPlatformSignalNotification:async id=>{assert.equal(id,'9007199254740993');const result=page();result.items[0].read_at='2026-09-12T00:01:00Z';result.unread=0;return result;}});
 try{await a.view.load();await a.view.mark('9007199254740993');assert.match(a.root.textContent,/Непрочитанных: 0/);assert.match(a.root.textContent,/Прочитано/);}finally{a.close();}
});
test('inbox validator rejects duplicated IDs, fake states and broken cursors',()=>{
 assert.equal(validSignalInbox(page()),true);
 const duplicate=page();duplicate.items.push({...duplicate.items[0]});assert.equal(validSignalInbox(duplicate),false);
 const malformed=page();malformed.items[0].state='ok';assert.equal(validSignalInbox(malformed),false);
 const cursor=page();cursor.next_before='1';assert.equal(validSignalInbox(cursor),false);
});
