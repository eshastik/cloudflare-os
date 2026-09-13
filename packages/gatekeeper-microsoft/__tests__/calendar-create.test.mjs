import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const code=ts.transpileModule(readFileSync(new URL('../src/calendar-create.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createApprovedOutlookCalendar:create}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const content={title:'Meeting',start:'2026-09-11T10:00:00.000Z',end:'2026-09-11T11:00:00.000Z',description:'Full text',location:'Room',attendees:['person@example.test']};
const token=async()=> 'fixture-token',validate=async()=>{};
test('creates in the selected calendar with exact UTC instants, plain body and attendees; returns immutable event ID',async()=>{
 let calls=0;
 const result=await create('calendar/id=',content,token,validate,async(url,init)=>{
  calls++;assert.equal(url,'https://graph.microsoft.com/v1.0/me/calendars/calendar%2Fid%3D/events');assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');assert.match(init.headers.Prefer,/ImmutableId/);
  assert.deepEqual(JSON.parse(init.body),{subject:content.title,body:{contentType:'Text',content:content.description},start:{dateTime:'2026-09-11T10:00:00.000',timeZone:'UTC'},end:{dateTime:'2026-09-11T11:00:00.000',timeZone:'UTC'},location:{displayName:'Room'},attendees:[{emailAddress:{address:'person@example.test'},type:'required'}]});
  return Response.json({id:'event/id='},{status:201});
 });assert.deepEqual(result,{event_id:'event/id='});assert.equal(calls,1);
});
test('invalid content and consent lost on token refresh fail before write; uncertain responses never retry',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json({id:'event'},{status:201})};
 for(const body of [{...content,organizer:'other'},{...content,start:'2026-09-11T10:00:00'},{...content,end:content.start},{...content,attendees:['bad\r\n@example.test']}])await assert.rejects(create('calendar',body,token,validate,fetcher));
 let check=0;await assert.rejects(create('calendar',content,token,async()=>{if(++check===2)throw Error('revoked')},fetcher));assert.equal(calls,0);
 for(const response of [()=>new Response('private details',{status:503}),()=>new Response(null,{status:302}),()=>new Response(null,{status:401}),()=>Response.json({},{status:201}),()=>new Response('x'.repeat(256*1024+1),{status:201}),()=>new Response(new ReadableStream({start(c){c.error(Error('private details'))}}),{status:201})]){
  calls=0;await assert.rejects(create('calendar',content,token,validate,async()=>{calls++;return response()}),error=>error.message==='Calendar creation outcome is unconfirmed.');assert.equal(calls,1);
 }
});
