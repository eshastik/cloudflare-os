import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const code=ts.transpileModule(readFileSync(new URL('../src/calendar-source.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {SelectedOutlookCalendar}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const window={time_min:'2026-09-10T00:00:00Z',time_max:'2026-09-12T00:00:00Z',limit:2};
function fixture(t){
 const state={live:true,mode:'ok',calls:[],identityCalls:0,body:'Meeting notes'};
 t.mock.method(globalThis,'fetch',async(input,init)=>{
  const url=new URL(input);state.calls.push(url.pathname);assert.equal(url.origin,'https://graph.microsoft.com');assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,'Bearer token');assert.match(init.headers.Prefer,/timezone="UTC"/);
  if(url.pathname==='/v1.0/me'){state.identityCalls++;return Response.json({id:state.mode==='foreign'||state.mode==='changed'&&state.identityCalls>1?'foreign':'owner'})}
  if(url.pathname==='/v1.0/me/calendars/calendar')return Response.json({id:state.mode==='calendar-changed'?'foreign':'calendar',name:'Team'});
  assert.equal(url.pathname,'/v1.0/me/calendars/calendar/calendarView');assert.equal(url.searchParams.get('startDateTime'),window.time_min.replace('Z','.000Z'));assert.equal(url.searchParams.get('$top'),'2');
  if(state.mode==='revoked')state.live=false;
  if(state.mode==='refused')return new Response('private diagnostics',{status:403});
  if(state.mode==='redirect')return new Response(null,{status:302,headers:{Location:'https://foreign.invalid'}});
  const event={id:'event',subject:'Weekly meeting',body:{contentType:'text',content:state.body},start:{dateTime:state.mode==='date'?'2026-02-30T21:00:00.0000000':'2026-09-10T21:00:00.0000000',timeZone:state.mode==='zone'?'Russian Standard Time':'UTC'},end:{dateTime:'2026-09-11T21:00:00.0000000',timeZone:'UTC'},isAllDay:true,isCancelled:false,originalStartTimeZone:'Russian Standard Time',originalEndTimeZone:'Russian Standard Time',type:'occurrence',seriesMasterId:'series'};
  return Response.json({value:state.mode==='duplicate'?[event,event]:[event],'@odata.nextLink':'https://foreign.invalid/not-followed'});
 });
 return {state,reader:new SelectedOutlookCalendar('calendar','owner',async()=>'token',async()=>{if(!state.live)throw Error('private revoke')})};
}
test('Outlook calendar retains recurrence and all-day UTC interval without following pages',async t=>{
 const {state,reader}=fixture(t);assert.deepEqual(await reader.metadata(),{provider:'microsoft',calendar_id:'calendar',title:'Team',time_zone:'UTC'});
 state.body='😀'.repeat(16001);const result=await reader.readWindow(window),event=JSON.parse(result.events_json)[0];
 assert.equal(result.truncated,true);assert.equal(event.start.dateTime,'2026-09-10T21:00:00.000Z');assert.equal(event.all_day,true);assert.equal(event.original_start_time_zone,'Russian Standard Time');assert.equal(event.series_master_id,'series');assert.equal(event.description_truncated,true);assert.equal(Array.from(event.description).length,16000);
 assert.equal(reader.createEvent,undefined);assert.equal(reader.send,undefined);
});
test('Outlook calendar refuses invalid window, account changes, bad dates, wrong zones and revocation',async t=>{
 const {state,reader}=fixture(t);
 for(const input of [{...window,limit:101},{...window,time_min:'2026-02-30T00:00:00Z'},{...window,time_max:'2028-01-01T00:00:00Z'},{...window,calendar:'foreign'},{...window,time_max:window.time_min}])await assert.rejects(reader.readWindow(input));
 assert.equal(state.calls.length,0);
 for(const mode of ['foreign','changed','calendar-changed','revoked','refused','redirect','date','zone','duplicate']){state.mode=mode;state.live=true;state.identityCalls=0;await assert.rejects(reader.readWindow(window),error=>error.message==='Selected Outlook calendar is unavailable or changed.')}
});
test('calendar discovery follows only its own collection and rejects partial results after revocation',async t=>{
 let mode='ok',live=true,calls=0;
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(input);assert.equal(url.origin,'https://graph.microsoft.com');
  if(url.pathname==='/v1.0/me')return Response.json({id:'owner'});
  calls++;assert.equal(url.pathname,'/v1.0/me/calendars');
  if(mode==='revoke')live=false;
  if(url.searchParams.has('$skiptoken'))return Response.json({value:[{id:'second',name:'Second'}]});
  return Response.json({value:[{id:'first',name:'First'}],'@odata.nextLink':mode==='foreign'?'https://foreign.invalid/calendars':mode==='other'?'https://graph.microsoft.com/v1.0/me/messages':'https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=next'});
 });
 const reader=new SelectedOutlookCalendar('root','owner',async()=>'token',async()=>{if(!live)throw Error('revoked')});
 assert.deepEqual(await reader.listCalendars(),{calendars:[{id:'first',name:'First'},{id:'second',name:'Second'}],truncated:false});
 for(mode of ['foreign','other','revoke']){calls=0;live=true;await assert.rejects(reader.listCalendars());assert.equal(calls,1)}
});
