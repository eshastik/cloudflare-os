import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {JSDOM} from 'jsdom';
const built=await build({stdin:{contents:'export {UploadUsageView} from "./app/upload-usage.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {UploadUsageView}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('usage clears stale counters on failure and ignores a response after closing',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');
 let fail=false,resolve;
 const view=new UploadUsageView(root,{uploadUsage:async()=>{if(fail)throw Error('offline');return {active:2,concurrent_limit:32,cleanup_pending:1,reserved_bytes:9,request_rate:{limit:10,used:3,resets_at:"2026-09-13T06:00:00Z"}};}},()=>{root.textContent='Home';});
 await view.load();assert.match(root.textContent,/2 из 32/);assert.match(root.textContent,/3 из 10/);assert.match(root.textContent,/ожидает уборки: 1/);
 fail=true;await view.load();assert.match(root.textContent,/Не удалось/);assert.doesNotMatch(root.textContent,/2 из 32/);
 const late=new UploadUsageView(root,{uploadUsage:()=>new Promise(r=>{resolve=r;})},()=>{root.textContent='Home';});
 const loading=late.load();[...root.querySelectorAll('button')].find(b=>b.textContent==='Назад').click();
 resolve({active:7,concurrent_limit:32,cleanup_pending:0,reserved_bytes:0});await loading;assert.equal(root.textContent,'Home');
});
test('rate refusal has an actionable message and clears counters',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');
 const view=new UploadUsageView(root,{uploadUsage:async()=>{throw Error('Request rate limit exceeded');}},()=>{});
 await view.load();assert.match(root.textContent,/Достигнут лимит частоты запросов/);assert.match(root.textContent,/следующего минутного окна/);assert.doesNotMatch(root.textContent,/Занято слотов/);
});
