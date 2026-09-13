import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
const temporalURL=import.meta.resolve('temporal-polyfill');
import {readFileSync} from 'node:fs';
const compile=name=>ts.transpileModule(readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const moduleURL=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const authURL=moduleURL(compile('auth-retry.ts'));
const {calendarEventFromGoogle,GoogleCalendarApi,calendarEventOverlaps,calendarEventSortKey}=await import(moduleURL(compile('calendar-api.ts').replace('"temporal-polyfill"',JSON.stringify(temporalURL)).replace('"./auth-retry"',JSON.stringify(authURL))));
const timed={id:'event',summary:'Meeting',start:{dateTime:'2026-09-10T12:00:00+03:00',timeZone:'Europe/Moscow'},end:{dateTime:'2026-09-10T13:00:00+03:00',timeZone:'Europe/Moscow'}};
test('Missing and invalid event times never become epoch or local-worker times',()=>{
 for(const start of [undefined,{},null,{dateTime:'not-a-date'},{dateTime:'2026-09-10T12:00:00'},{date:'2026-02-30'},{date:'2026-09-10',dateTime:'2026-09-10T12:00:00Z'}])assert.throws(()=>calendarEventFromGoogle({...timed,start}));
 assert.throws(()=>calendarEventFromGoogle({...timed,end:undefined}));
 const event=calendarEventFromGoogle(timed);assert.equal(event.start.dateTime.toISOString(),'2026-09-10T09:00:00.000Z');assert.equal(event.start.timeZone,'Europe/Moscow');
 const allDay=calendarEventFromGoogle({id:'all-day',start:{date:'2026-09-10'},end:{date:'2026-09-11'}});assert.deepEqual(allDay.start,{kind:'date',date:'2026-09-10'});assert.deepEqual(allDay.end,{kind:'date',date:'2026-09-11'});
 assert.throws(()=>calendarEventFromGoogle({id:'deleted',status:'cancelled'}),/cancelled/);
});
test('Window listing skips cancelled tombstones and detects repeating pagination',async()=>{
 const original=globalThis.fetch;let calls=0;let looping=false;
 globalThis.fetch=async url=>{assert.equal(new URL(url).origin,'https://www.googleapis.com');calls++;const response=looping?{items:[],nextPageToken:'repeat'}:calls===1?{items:[{id:'deleted',status:'cancelled'}],nextPageToken:'next'}:{items:[timed]};return new Response(JSON.stringify(response),{headers:{'Content-Type':'application/json'}});};
 try{const api=new GoogleCalendarApi(async()=> 'test-only-token');const options={timeMin:new Date('2026-09-10T00:00:00Z'),timeMax:new Date('2026-09-11T00:00:00Z')};const events=await api.listEvents('selected-calendar',options);assert.equal(events.length,1);assert.equal(events[0].id,'event');assert.equal(calls,2);looping=true;calls=0;await assert.rejects(api.listEvents('selected-calendar',options),/repeated a page token/);assert.equal(calls,2);}finally{globalThis.fetch=original;}
});
test('Calendar discovery includes shared calendars with reader access',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>{const request=new URL(url);assert.equal(request.searchParams.get('minAccessRole'),'reader');return new Response(JSON.stringify({items:[{id:'shared',summary:'Read-only team calendar',accessRole:'reader'}]}));};
 try{const result=await new GoogleCalendarApi(async()=> 'test-only-token').listCalendars();assert.equal(result[0].id,'shared');assert.equal(result[0].accessRole,'reader');}finally{globalThis.fetch=original;}
});

test('All-day overlap and ordering use the calendar day through DST and midnight gaps',()=>{
 const day=(date,end)=>({id:'all-day',title:'Day',status:'confirmed',start:{kind:'date',date},end:{kind:'date',date:end}});
 const moscow=day('2026-09-10','2026-09-11');assert(calendarEventOverlaps(moscow,new Date('2026-09-09T21:30:00Z'),new Date('2026-09-09T22:00:00Z'),'Europe/Moscow'));assert(!calendarEventOverlaps(moscow,new Date('2026-09-10T21:00:00Z'),new Date('2026-09-10T22:00:00Z'),'Europe/Moscow'));assert.equal(calendarEventSortKey(moscow,'Europe/Moscow'),Date.parse('2026-09-09T21:00:00Z'));
 const spring=day('2026-03-08','2026-03-09'),fall=day('2026-11-01','2026-11-02');
 assert.equal(calendarEventSortKey(day('2026-03-09','2026-03-10'),'America/New_York')-calendarEventSortKey(spring,'America/New_York'),23*3600000);
 assert.equal(calendarEventSortKey(day('2026-11-02','2026-11-03'),'America/New_York')-calendarEventSortKey(fall,'America/New_York'),25*3600000);
 assert.equal(calendarEventSortKey(day('2018-11-04','2018-11-05'),'America/Sao_Paulo'),Date.parse('2018-11-04T03:00:00Z'));
 assert.throws(()=>calendarEventSortKey(moscow,'invalid/zone'));
});
test('Offset-free times use their declared zone and refuse ambiguous or nonexistent wall times',()=>{
 const event=calendarEventFromGoogle({...timed,start:{dateTime:'2026-09-10T12:00:00',timeZone:'Europe/Moscow'}});assert.equal(event.start.dateTime.toISOString(),'2026-09-10T09:00:00.000Z');
 for(const dateTime of ['2026-03-08T02:30:00','2026-11-01T01:30:00'])assert.throws(()=>calendarEventFromGoogle({...timed,start:{dateTime,timeZone:'America/New_York'}}));
 assert.throws(()=>calendarEventFromGoogle({...timed,start:{dateTime:'2026-02-30T12:00:00Z'}}));
});

const {createApprovedGoogleCalendar}=await import(moduleURL(compile('calendar-create.ts')));
test('approved meeting maps exact content to one Google event POST with invitations; failure is not retried',async t=>{
 const content={title:'Meeting',start:'2026-09-11T10:00:00.000Z',end:'2026-09-11T11:00:00.000Z',description:'Discuss',location:'Room',attendees:['person@example.test']};
 let calls=0,fail=false;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  calls++;const target=new URL(url);assert.equal(target.origin,'https://www.googleapis.com');assert.equal(target.pathname,'/calendar/v3/calendars/team%40example.test/events');assert.equal(target.searchParams.get('sendUpdates'),'all');assert.equal(init.method,'POST');
  assert.deepEqual(JSON.parse(init.body),{summary:content.title,start:{dateTime:content.start,timeZone:'UTC'},end:{dateTime:content.end,timeZone:'UTC'},description:content.description,location:content.location,attendees:[{email:'person@example.test'}]});
  return fail?new Response('private provider details',{status:503}):Response.json({...timed,id:'created-event'});
 });
 const api=new GoogleCalendarApi(async()=> 'fixture-token');
 await assert.rejects(createApprovedGoogleCalendar(api,'team@example.test',{...content,organizer:'spoof'},async()=>{}));
 await assert.rejects(createApprovedGoogleCalendar(api,'team@example.test',content,async()=>{throw Error('revoked')}));assert.equal(calls,0);
 assert.deepEqual(await createApprovedGoogleCalendar(api,'team@example.test',content,async()=>{}),{event_id:'created-event'});assert.equal(calls,1);
 fail=true;await assert.rejects(createApprovedGoogleCalendar(api,'team@example.test',content,async()=>{}),error=>error.message==='Calendar creation outcome is unconfirmed.');assert.equal(calls,2);
});
