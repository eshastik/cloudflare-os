import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {JSDOM} from 'jsdom';
const built=await build({stdin:{contents:'export {ReindexBatchView} from "./app/reindex-batch.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {ReindexBatchView}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const batch={id:'b',projects:['p'],history:true,captured_at:'2026-09-13T00:00:00Z',total:2,next:0,changed:0,failed:0,tokens:0,micro_usd:0};
function setup(api){const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');return {root,view:new ReindexBatchView(root,api,[{id:'p',name:'<script>P</script>'}],()=>{}),click:label=>{const b=[...root.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(b,label);b.click();}};}
const tick=()=>new Promise(r=>setTimeout(r,0));
test('read/prepare do not execute, errors stop without automatic retry, recovery uses saved batch',async()=>{
 let current=null,calls=0;const a=setup({readReindexBatch:async()=>current,prepareReindexBatch:async()=>current=batch,executeReindexBatch:async id=>{assert.equal(id,'b');calls++;throw Error('lost');}});
 await a.view.load();a.click('Создать план пересчёта');await tick();assert.equal(calls,0);assert.equal(a.root.querySelector('script'),null);
 a.click('Запустить / продолжить проход');await tick();assert.equal(calls,1);assert.match(a.root.textContent,/Проход остановлен/);
 await a.view.load();assert.equal(calls,1);a.click('Запустить / продолжить проход');await tick();assert.equal(calls,2);
});
test('pause or close lets the current request finish but prevents the next one',async()=>{
 for(const control of ['Пауза после текущего файла','Закрыть массовый пересчёт']){
  let resolve,calls=0;const a=setup({readReindexBatch:async()=>batch,executeReindexBatch:()=>{calls++;return new Promise(r=>resolve=r);}});
  await a.view.load();a.click('Запустить / продолжить проход');a.click(control);resolve({...batch,next:1,changed:1});await tick();assert.equal(calls,1);
  if(control.startsWith('Закрыть'))assert.equal(a.root.textContent,'');else assert.match(a.root.textContent,/Обработано 1 из 2/);
 }
});
test('completed pass with unchanged indexes does not claim full success',async()=>{
 const a=setup({readReindexBatch:async()=>({...batch,next:2,changed:1,failed:1})});await a.view.load();assert.match(a.root.textContent,/часть индексов не изменена/);assert.doesNotMatch(a.root.textContent,/Проход завершён/);
});
