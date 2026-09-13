import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'mnemos-caldav-tests-'));test.after(()=>rm(dir,{recursive:true,force:true}));
const compile=async name=>{const outfile=join(dir,name+'.mjs');await build({entryPoints:['src/'+name+'.ts'],bundle:true,platform:'browser',format:'esm',outfile});return import(pathToFileURL(outfile).href)};
const {CalDAVClient}=await compile('client');const {caldavTransport}=await compile('transport');const {approvedCalendarData,readCalendarData}=await compile('events');
import {davFixture,origin,server,content} from './fixture.mjs';
const calendar=origin+'/calendars/me/team/',credential={username:'owner@example.test',password:'private-app-password'};
function fixture(){const {state,fetcher}=davFixture(approvedCalendarData);return {state,client:()=>new CalDAVClient(server,credential,async()=>{if(!state.live)throw Error('revoked')},fetcher)}}
test('real DAV XML discovery, expanded read and conditional creation preserve approved content',async()=>{
 const f=fixture();assert.deepEqual(await f.client().listCalendars(),[{url:calendar,title:'Team',timezone:''}]);
 const result=await f.client().readWindow(calendar,{time_min:'2026-09-11T00:00:00Z',time_max:'2026-09-12T00:00:00Z',limit:10});assert.equal(result.events[0].description,content.description);assert.equal(result.events[0].start.dateTime,content.start);assert.equal(result.truncated,false);
 const created=await f.client().create(calendar,content);assert.match(created.event_id,/^[a-f0-9-]{36}$/);assert.equal(f.state.writes.length,1);const events=readCalendarData(f.state.writes[0]);assert.equal(events.length,1);assert.equal(events[0].description,content.description);assert.match(f.state.writes[0],/ORGANIZER:mailto:owner@example.test/);assert.match(f.state.writes[0],/ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:person@example.test/);
});
test('foreign discovery cannot receive credentials; revoke, unselected calendar and missing scheduling block PUT',async()=>{
 const f=fixture();f.state.foreign=true;await assert.rejects(f.client().listCalendars());assert.equal(f.state.writes.length,0);
 f.state.foreign=false;f.state.live=false;const before=f.state.calls.length;await assert.rejects(f.client().listCalendars());assert.equal(f.state.calls.length,before);
 f.state.live=true;await assert.rejects(f.client().create(origin+'/calendars/other/',content));assert.equal(f.state.writes.length,0);
 f.state.scheduling=false;await assert.rejects(f.client().create(calendar,content));assert.equal(f.state.writes.length,0);
 f.state.scheduling=true;f.state.writeStatus=503;await assert.rejects(f.client().create(calendar,content));assert.equal(f.state.writes.length,1);
});
test('transport bounds XML, rejects entities and rechecks revocation after the response',async()=>{
 for(const body of ['<!DOCTYPE x [<!ENTITY x "payload">]><x/>','x'.repeat(2*1024*1024+1)]){let calls=0;const t=caldavTransport(server,credential,async()=>{},async()=>{calls++;return new Response(body,{status:207})});await assert.rejects(t.fetch(origin,{method:'PROPFIND'}));assert.equal(calls,1);}
 let live=true;const t=caldavTransport(server,credential,async()=>{if(!live)throw Error('private details')},async()=>{live=false;return new Response('data',{status:207})});await assert.rejects(t.fetch(origin,{method:'PROPFIND'}),error=>error.message==='CalDAV request unavailable.');
});
test('all-day and expanded recurrence identity survive parsing; floating or unexpanded data is refused',()=>{
 const wrap=value=>'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:series\r\n'+value+'\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
 const day=readCalendarData(wrap('DTSTART;VALUE=DATE:20260911\r\nDTEND;VALUE=DATE:20260912'))[0];assert.deepEqual(day.start,{kind:'date',date:'2026-09-11'});
 const event=readCalendarData(wrap('DTSTART:20260911T100000Z\r\nDTEND:20260911T110000Z\r\nRECURRENCE-ID:20260911T100000Z'))[0];assert.equal(event.recurrence_id,'2026-09-11T10:00:00Z');
 for(const extra of ['DTSTART:20260911T100000\r\nDTEND:20260911T110000','DTSTART:20260911T100000Z\r\nDTEND:20260911T110000Z\r\nRRULE:FREQ=DAILY'])assert.throws(()=>readCalendarData(wrap(extra)));
 assert.throws(()=>approvedCalendarData({...content,start:'2026-09-11T10:00:00.001Z'},'11111111-1111-4111-8111-111111111111','owner@example.test'),/whole-second/);
});

test('iCloud discovery permits its shard host, but rejects suffix spoofs and other ports before credentials leave',async()=>{
 let calls=0;const t=caldavTransport({url:'https://caldav.icloud.com',origins:['https://caldav.icloud.com'],icloud:true},credential,async()=>{},async url=>{calls++;assert.equal(new URL(url).hostname,'p43-caldav.icloud.com');return new Response(null,{status:200})});
 await t.fetch('https://p43-caldav.icloud.com/principal/',{method:'PROPFIND'});
 for(const url of ['https://p43-caldav.icloud.com.foreign.invalid/','https://p43-caldav.icloud.com:8443/','http://p43-caldav.icloud.com/'])await assert.rejects(t.fetch(url,{method:'PROPFIND'}));assert.equal(calls,1);
});

test('invitation availability is read-only and is rechecked when creating',async()=>{
 const f=fixture();assert.deepEqual(await f.client().scheduling(calendar),{available:true});assert.equal(f.state.writes.length,0);
 f.state.scheduling=false;assert.deepEqual(await f.client().scheduling(calendar),{available:false});await assert.rejects(f.client().create(calendar,content));assert.equal(f.state.writes.length,0);
 await f.client().create(calendar,{...content,attendees:[]});assert.equal(f.state.writes.length,1);
 f.state.live=false;await assert.rejects(f.client().scheduling(calendar));
});
