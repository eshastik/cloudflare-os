import {davFixture,origin} from '../../caldav-client/__tests__/fixture.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';

// Full CalDAV protocol through the real account and persisted Worker capabilities.
const fixtureCalendar=()=> 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:fixture-read-event\r\nDTSTART:20260911T100000Z\r\nDTEND:20260911T110000Z\r\nSUMMARY:Team meeting\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
const harness=`import {WorkerEntrypoint} from 'cloudflare:workers';
export class Source extends WorkerEntrypoint {
 async validate() {}
 async create(content){if(content.title!=='Meeting'||content.start!=='2026-09-11T10:00:00.000Z')throw Error('wrong content');return {event_id:'fixture-event'}}
 async metadata(){return {provider:'google',calendar_id:'team',title:'Team',time_zone:'UTC'}}
 async readWindow(){return {calendar_id:'team',time_zone:'UTC',events_json:'[{"id":"event"}]',truncated:false}}
}
export default {async fetch(request,env,ctx){
 const account=env.ACCOUNTS.get(env.ACCOUNTS.idFromName('calendar-owner'));
 const action=new URL(request.url).pathname;
 if(action==='/prepare'){
  await account.acceptVerifiedCredential('fixture-human-token',Date.now()+900000);
  const connected=await account.connectCalDAVAccount({request:'11111111-1111-4111-8111-111111111111',server:'corp-fixture',username:'owner@example.test',password:'private-app-password'});
  const selected=await account.caldavReadSource(connected.calendars[0].id);
  return Response.json(await account.acceptCalendarReadSource('project','request',selected.sourceKey,selected.source));
 }
 if(action==='/cancel-login'){await account.alarm();return new Response('ok')}
 if(action==='/read'){try{return Response.json(await account.readCalendarWindow(await request.json()))}catch(error){return new Response(error.message,{status:500})}}
 if(action==='/list'){try{return Response.json(await account.listCalendarDrafts((await request.json()).connection))}catch{return new Response('denied',{status:403})}}
 if(action==='/review'){try{return Response.json(await account.readCalendarDraft((await request.json()).id))}catch{return new Response('denied',{status:403})}}
 if(action==='/decide'){try{const value=await request.json();return Response.json(await account.decideCalendarDraft(value.id,value.sha256,value.approved))}catch{return new Response('denied',{status:403})}}
 if(action==='/create'){try{const value=await request.json();const selected=await account.prepareCalendarDraftCreate(value.id,value.sha256);const writer=await account.caldavWriteSource(selected.calendar_id);return Response.json(await account.createCalendarDraft(value.id,value.sha256,value.sourceKey??selected.sourceKey,writer.source))}catch{return new Response('denied',{status:403})}}
 if(action==='/revoke'){await account.revoke();return new Response('ok')}
 return new Response('missing',{status:404});
}}`;

test('CalDAV account, source and approved creation survive Worker restart; repeat never writes twice and revoke fences both paths',async()=>{
 const fixture=davFixture(fixtureCalendar);
 const state=await mkdtemp(join(tmpdir(),'mnemos-calendar-'));
 const token='fixture-service-credential-32-characters';
 const options={resourcePersistencePath:state,workers:[
  {name:'harness',modules:true,script:harness,compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage', 'nodejs_compat'],durableObjects:{ACCOUNTS:{className:'UserAccount',scriptName:'mnemos',useSQLite:true}}},
  {name:'mnemos',modules:true,scriptPath:fileURLToPath(new URL('../dist/mnemos.js',import.meta.url)),modulesRules:[{type:'Text',include:['**/*.txt']}],compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage', 'nodejs_compat'],bindings:{MNEMOS_API_ORIGIN:'https://memory.example',MNEMOS_LOGIN_CONFIG:JSON.stringify({callbackUrl:'https://workshop.example/gatekeeper/mnemos/oauth'}),MNEMOS_CALENDAR_BRIDGE_TOKEN:token,MNEMOS_CALDAV_SERVERS:JSON.stringify([{id:'corp-fixture',title:'Fixture',url:origin,origins:[origin]}])},outboundService:async request=>{
   if(new URL(request.url).origin===origin)return fixture.fetcher(request.url,{method:request.method,headers:request.headers,body:['GET','OPTIONS'].includes(request.method)?undefined:await request.text(),redirect:'manual'});
   const path=new URL(request.url).pathname;if(path.startsWith('/v1/calendar-connections/'))return Response.json({connection_id:path.split('/').at(-1),project_id:'project',provider:'google',calendar_id:'team',enabled:true,revision:1});
   assert.equal(new URL(request.url).pathname,'/v1/whoami');
   assert.equal(request.headers.get('Authorization'),'Bearer fixture-human-token');
   return Response.json({subject:{tenant_id:'tenant',user_id:'owner'}});
  }}
 ]};
 let mf=new Miniflare(options);
 try{
  const response=await mf.dispatchFetch('https://fixture/prepare');assert.equal(response.status,200);const selected=await response.json();
  const input={selection_id:selected.selection_id,tenant_id:'tenant',owner_id:'owner',project_id:'project',request_id:'request'};
  const call=async(suffix,body,credential=token)=>{
   const worker=await mf.getWorker('mnemos');
   return worker.fetch('https://workshop.example/gatekeeper/mnemos/oauth/calendar-bridge/'+suffix,{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify(body)});
  };
  assert.equal((await call('resolve',input,'wrong-credential')).status,403);
  const resolved=await call('resolve',input);assert.equal(resolved.status,200);const connection=await resolved.json();
  const read={selection_id:selected.selection_id,tenant_id:'tenant',owner_id:'owner',project_id:'project',connection_id:connection.connection_id,calendar_id:connection.calendar_id,time_min:'2026-09-10T00:00:00Z',time_max:'2026-09-11T00:00:00Z',limit:1};
  assert.equal((await call('read',read)).status,200);
  const draft={selection_id:selected.selection_id,tenant_id:'tenant',owner_id:'owner',project_id:'project',connection_id:connection.connection_id,calendar_id:connection.calendar_id,agent_principal_id:'agent',request_id:'draft-request',content:{title:'Meeting',start:'2026-09-11T13:00:00+03:00',end:'2026-09-11T14:00:00+03:00',description:'Full description',location:'Room',attendees:['person@example.test']}};
  const responseDraft=await call('draft',draft);assert.equal(responseDraft.status,200);const receipt=await responseDraft.json();
  assert.equal((await call('draft',{...draft,owner_id:'other'})).status,403);assert.equal((await call('draft',{...draft,calendar_id:'other'})).status,403);
  assert.equal((await call('draft',{...draft,content:{...draft.content,title:'Changed'}})).status,403);
  await mf.dispose();mf=new Miniflare(options);
  const afterRestart=await call('read',read);assert.equal(afterRestart.status,200,await (await mf.dispatchFetch('https://fixture/read',{method:'POST',body:JSON.stringify(read)})).text());assert.equal((await afterRestart.json()).events[0].id,'fixture-read-event');
  assert.equal((await call('read',{...read,owner_id:'other'})).status,403);
  assert.deepEqual(await (await call('draft',draft)).json(),receipt);
  const human=(path,body)=>mf.dispatchFetch('https://fixture/'+path,{method:'POST',body:JSON.stringify(body)});
  const page=await (await human('list',{connection:connection.connection_id})).json();assert.equal(page.drafts[0].id,receipt.draft_id);
  const shown=await (await human('review',{id:receipt.draft_id})).json();assert.equal(shown.content.start,'2026-09-11T10:00:00.000Z');assert.equal(shown.context,undefined);
  assert.equal((await human('create',{id:shown.id,sha256:shown.sha256})).status,403);
  assert.equal((await human('decide',{id:shown.id,sha256:'0'.repeat(64),approved:true})).status,403);
  assert.equal((await human('decide',{id:shown.id,sha256:shown.sha256,approved:true})).status,200);
  assert.equal((await (await call('draft',draft)).json()).state,'approved');
  assert.equal((await human('create',{id:shown.id,sha256:shown.sha256,sourceKey:'substituted'})).status,403);
  const created=await human('create',{id:shown.id,sha256:shown.sha256});assert.equal(created.status,200);const outcome=await created.json();assert.equal(outcome.state,'created');assert.match(outcome.event_id,/^[a-f0-9-]{36}$/);assert.equal(fixture.state.writes.length,1);
  await mf.dispose();mf=new Miniflare(options);
  assert.deepEqual((await (await call('draft',draft)).json()).execution,outcome);
  assert.deepEqual(await (await human('create',{id:shown.id,sha256:shown.sha256})).json(),outcome);
  assert.equal(fixture.state.writes.length,1);
  await mf.dispatchFetch('https://fixture/revoke');
  assert.equal((await human('create',{id:shown.id,sha256:shown.sha256})).status,403);
  assert.equal((await call('read',read)).status,403);
  assert.equal((await call('draft',draft)).status,403);assert.equal((await human('review',{id:receipt.draft_id})).status,403);
 }finally{await mf.dispose();await rm(state,{recursive:true,force:true})}
});
