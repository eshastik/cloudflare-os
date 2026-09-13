import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const built=await build({stdin:{contents:'export {BusinessOverview} from "./app/business-overview.ts";export {decodeBusinessDataset} from "./src/business-analytics.ts";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {BusinessOverview,decodeBusinessDataset}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const data={format:'mnemos.business-dataset',format_version:1,organization:'Test company',observed_at:'2026-09-10T10:00:00Z',employees:[{id:'alice',name:'Alice',department:'Engineering'},{id:'bob',name:'Bob',department:null}],clients:null,coverage:{employees:'partial',clients:'unknown'}};
test('business dataset preserves missing data and refuses ambiguous identities',()=>{
 assert.equal(decodeBusinessDataset(JSON.stringify(data)).clients,null);
 assert.throws(()=>decodeBusinessDataset(JSON.stringify({...data,employees:[data.employees[0],data.employees[0]]})));
 assert.throws(()=>decodeBusinessDataset(JSON.stringify({...data,coverage:{employees:'complete',clients:'complete'}})));
 assert.throws(()=>decodeBusinessDataset(JSON.stringify({...data,observed_at:'2026-09-10T10:00:00'})));
 assert.deepEqual(decodeBusinessDataset(JSON.stringify({...data,clients:[],coverage:{employees:'partial',clients:'complete'}})).clients,[]);
});
test('business report pins the source version and clears stale or revoked information',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let denied=false,changed=false,reads=0;
 const api={listPrivateDocuments:async()=>({documents:[]}),readDraftDocument:async()=>{if(denied)throw Error('revoked');reads++;return {exists:true,conflicted:false,content_type:'application/json',head:changed&&reads%2===0?'b':'a',terms:[{present:true,negative:false}]};}};
 const view=new BusinessOverview(root,api,[],()=>{},async(project,node,head)=>{assert.equal(project,'project');assert.equal(head,'a');return JSON.stringify(data);});
 await view.load('project');await view.open('source','Report');assert.match(root.textContent,/Engineering: 1/);assert.match(root.textContent,/Отдел не указан: 1/);assert.match(root.textContent,/Клиенты: данные отсутствуют/);assert.match(root.textContent,/частичный/);
 changed=true;reads=0;await view.open('source','Report');assert.doesNotMatch(root.textContent,/Engineering/);assert.match(root.textContent,/Отчёт не получен/);
 changed=false;await view.open('source','Report');denied=true;await view.open('source','Report');assert.doesNotMatch(root.textContent,/Test company/);assert.match(root.textContent,/Отчёт не получен/);
 dom.window.close();delete globalThis.document;
});
