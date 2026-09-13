import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const compiled=await build({entryPoints:['app/calendar-events.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {CalendarEventsView}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const connection={connection_id:'connection',project_id:'project',calendar_id:'calendar',enabled:true};
const result={calendar_id:'calendar',time_zone:'Europe/Moscow',truncated:true,events:[
 {id:'google',title:'Google date',start:{kind:'date',date:'2026-09-12'},end:{kind:'date',date:'2026-09-13'},description:'<img src="https://example.test/track" onerror="bad()">'},
 {id:'graph',summary:'Outlook cancelled',start:{kind:'dateTime',dateTime:'2026-09-12T08:00:00Z',timeZone:'UTC'},end:{kind:'dateTime',dateTime:'2026-09-12T09:00:00Z'},status:'cancelled',description_truncated:true},
 {id:'caldav',summary:'CalDAV meeting',location:'Room',start:{kind:'dateTime',dateTime:'2026-09-12T08:00:00Z'},end:{kind:'dateTime',dateTime:'2026-09-12T09:00:00Z'}}]};
function setup(api){const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');const view=new CalendarEventsView(root,api,connection);return {dom,root,view};}
test('selected UTC window, provider shapes, literal descriptions, partial results and revoked access',async()=>{
 let allowed=true,calls=0;const {dom,root,view}=setup({readCalendarEvents:async(p,c,q)=>{calls++;assert.equal(p,'project');assert.equal(c,'connection');assert.deepEqual(q,{time_min:'2026-09-12T00:00:00.000Z',time_max:'2026-09-13T00:00:00.000Z',limit:100});if(!allowed)throw Error('revoked');return result;}});
 try{await view.read('2026-09-12T00:00','2026-09-13T00:00');for(const title of ['Google date','Outlook cancelled','CalDAV meeting','Событие отменено','только часть событий','конца не включается','Описание сокращено'])assert(root.textContent.includes(title));assert.equal(root.querySelector('img'),null);assert(root.textContent.includes('<img src='));allowed=false;await view.read();assert(root.textContent.includes('События недоступны'));assert(!root.textContent.includes('CalDAV meeting'));assert.equal(calls,2);}finally{dom.window.close();delete globalThis.document;}
});
test('invalid date window makes no request; closing discards a late result',async()=>{
 let resolve,calls=0;const {dom,root,view}=setup({readCalendarEvents:()=>{calls++;return new Promise(r=>resolve=r);}});
 try{await view.read('2026-02-30T00:00','2026-03-01T00:00');await view.read('2026-09-12T00:00','2026-09-11T00:00');assert.equal(calls,0);const pending=view.read('2026-09-12T00:00','2026-09-13T00:00');view.dispose();resolve(result);await pending;assert(!root.textContent.includes('Google date'));assert.equal(document.querySelector('main'),null);}finally{dom.window.close();delete globalThis.document;}
});
test('calendar mismatch clears results; empty complete window is not a provider error',async()=>{
 let value={...result,truncated:false,events:[]};const {dom,root,view}=setup({readCalendarEvents:async()=>value});
 try{await view.read('2026-09-12T00:00','2026-09-13T00:00');assert(root.textContent.includes('событий нет'));value={...result,calendar_id:'foreign'};await view.read();assert(root.textContent.includes('События недоступны'));assert(!root.textContent.includes('Google date'));}finally{dom.window.close();delete globalThis.document;}
});
