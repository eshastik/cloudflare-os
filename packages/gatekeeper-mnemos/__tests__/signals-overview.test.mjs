import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:'export {SignalsOverview} from "./app/signals-overview.ts";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {SignalsOverview}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
test('Shared overview preserves gaps, freshness and source navigation; refresh drops revoked data',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');let revoked=false,opened;
 const api={listProjects:async()=>({projects:['measured','missing','denied'].map(id=>({id,name:id}))}),readPublishedProjectSignals:async project=>{
  if(project==='denied'||revoked)throw Error('denied');
  if(project==='missing')return {project_id:project,publication:{enabled:false}};
  return {project_id:project,publication:{enabled:true,source_request_id:'saved'},snapshot:{project_id:project,request_id:'saved',collected_at:'2026-09-10T12:00:00Z',assessment:{state:'insufficient',assessed_at:'2026-09-10T12:05:00Z',findings:[{purpose:'Users',state:'stale',source_id:'corp',value:0,unit:'users'}]}}};
 }};
 const view=new SignalsOverview(root,api,()=>{},p=>{opened=p;});await view.load();
 assert.match(root.textContent,/Данных недостаточно/);assert.match(root.textContent,/Измерение устарело/);assert.match(root.textContent,/0 users/);assert.match(root.textContent,/Источник: corp/);assert.match(root.textContent,/Общая оценка не опубликована/);assert.match(root.textContent,/Оценка недоступна/);
 [...root.querySelectorAll('button')].find(b=>b.textContent==='Оценка и источники: measured').click();assert.equal(opened,'measured');
 const refreshed=new SignalsOverview(root,api,()=>{},()=>{});await refreshed.load();revoked=true;await refreshed.load();assert.doesNotMatch(root.textContent,/Источник: corp/);assert.doesNotMatch(root.textContent,/0 users/);assert.equal(root.textContent.match(/Оценка недоступна/g).length,3);
 dom.window.close();delete globalThis.document;
});
