import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {JSDOM} from 'jsdom';
const built=await build({stdin:{contents:'export {ReindexView} from "./app/reindex.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {ReindexView}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const request={node:'a'.repeat(32),revision:2,request_id:'b'.repeat(32)};
function setup(api){const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');return {root,view:new ReindexView(root,api,request.node,'<script>file</script>',()=>{}),click:label=>[...root.querySelectorAll('button')].find(b=>b.textContent===label).click()};}
const tick=()=>new Promise(r=>setTimeout(r,0));
test('human must execute explicitly; lost answer is not retried; reload restores request',async()=>{
 let calls=0;const a=setup({prepareReindex:async()=>request,executeReindex:async(node,key)=>{assert.equal(key,request.request_id);calls++;throw Error('lost');}});
 await a.view.load();assert.equal(calls,0);assert.equal(a.root.querySelector('script'),null);
 a.click('Выполнить / восстановить пересчёт');await tick();assert.equal(calls,1);assert.match(a.root.textContent,/Результат не подтверждён/);
 await a.view.load();assert.equal(calls,1);a.click('Выполнить / восстановить пересчёт');await tick();assert.equal(calls,2);
});
test('stale receipt is not success and a closed screen ignores late loading',async()=>{
 const a=setup({prepareReindex:async()=>({...request,result:{changed:false,segments:0,vectorized:0,embed_micro_usd:0,notes:null}})});
 await a.view.load();assert.match(a.root.textContent,/Индекс не изменён/);assert.doesNotMatch(a.root.textContent,/Пересчёт завершён/);
 let resolve;const b=setup({prepareReindex:()=>new Promise(r=>resolve=r)});const pending=b.view.load();b.click('Закрыть пересчёт');resolve(request);await pending;assert.equal(b.root.textContent,'');
});
