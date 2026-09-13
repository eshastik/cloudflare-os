import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';

// Fixture provider is a real persistent Worker entrypoint. No external account is used.
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
  return Response.json(await account.acceptCalendarReadSource('project','request','fixture-source',ctx.exports.Source({props:{}})));
 }
 if(action==='/read'){try{return Response.json(await account.readCalendarWindow(await request.json()))}catch(error){return new Response(error.message,{status:500})}}
 if(action==='/list'){try{return Response.json(await account.listCalendarDrafts((await request.json()).connection))}catch{return new Response('denied',{status:403})}}
 if(action==='/review'){try{return Response.json(await account.readCalendarDraft((await request.json()).id))}catch{return new Response('denied',{status:403})}}
 if(action==='/decide'){try{const value=await request.json();return Response.json(await account.decideCalendarDraft(value.id,value.sha256,value.approved))}catch{return new Response('denied',{status:403})}}
 if(action==='/create'){try{const value=await request.json();const selected=await account.prepareCalendarDraftCreate(value.id,value.sha256);if(selected.calendar_id!=='team')throw Error('wrong calendar');return Response.json(await account.createCalendarDraft(value.id,value.sha256,value.sourceKey??selected.sourceKey,ctx.exports.Source({props:{}})))}catch{return new Response('denied',{status:403})}}
 if(action==='/revoke'){await account.revoke();return new Response('ok')}
 return new Response('missing',{status:404});
}}`;

test('calendar bridge retains a Worker source across restart and rejects revoked owner',async()=>{
 const state=await mkdtemp(join(tmpdir(),'mnemos-calendar-'));
 const token='fixture-service-credential-32-characters';
 const auditEvents=new Map(),selectionEvents=new Map();
 const options={resourcePersistencePath:state,workers:[
  {name:'harness',modules:true,script:harness,compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage', 'nodejs_compat'],durableObjects:{ACCOUNTS:{className:'UserAccount',scriptName:'mnemos',useSQLite:true}}},
  {name:'mnemos',modules:true,scriptPath:fileURLToPath(new URL('../dist/mnemos.js',import.meta.url)),modulesRules:[{type:'Text',include:['**/*.txt']}],compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage', 'nodejs_compat'],bindings:{MNEMOS_API_ORIGIN:'https://memory.example',MNEMOS_LOGIN_CONFIG:JSON.stringify({callbackUrl:'https://workshop.example/gatekeeper/mnemos/oauth'}),MNEMOS_CALENDAR_BRIDGE_TOKEN:token},outboundService:async request=>{
   const path=new URL(request.url).pathname;
   if(path==='/v1/internal/connection-audit/calendar-selection'){
    assert.equal(request.headers.get('Authorization'),'Bearer '+token);const e=await request.json();assert.equal(e.phase,'selected');assert.equal(e.project_id,'project');assert.equal(e.owner_id,'owner');
    const previous=selectionEvents.get(e.event_id);if(previous)assert.deepEqual(previous,e);selectionEvents.set(e.event_id,e);return Response.json({event_id:e.event_id});
   }
   if(path==='/v1/internal/draft-audit/calendar'){
    assert.equal(request.headers.get('Authorization'),'Bearer '+token);
    const event=await request.json();assert.equal(event.kind,'calendar');assert.equal(event.tenant_id,'tenant');assert.equal(event.owner_id,'owner');
    const previous=auditEvents.get(event.event_id);if(previous)assert.deepEqual(event,previous);auditEvents.set(event.event_id,event);
    return Response.json({event_id:event.event_id});
   }if(path.startsWith('/v1/calendar-connections/'))return Response.json({connection_id:path.split('/').at(-1),project_id:'project',provider:'google',calendar_id:'team',enabled:true,revision:1});
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
  const read={selection_id:selected.selection_id,tenant_id:'tenant',owner_id:'owner',project_id:'project',connection_id:connection.connection_id,calendar_id:'team',time_min:'2026-09-10T00:00:00Z',time_max:'2026-09-11T00:00:00Z',limit:1};
  assert.equal((await call('read',read)).status,200);
  const draft={selection_id:selected.selection_id,tenant_id:'tenant',owner_id:'owner',project_id:'project',connection_id:connection.connection_id,calendar_id:'team',agent_principal_id:'agent',request_id:'draft-request',content:{title:'Meeting',start:'2026-09-11T13:00:00+03:00',end:'2026-09-11T14:00:00+03:00',description:'Full description',location:'Room',attendees:['person@example.test']}};
  const responseDraft=await call('draft',draft);assert.equal(responseDraft.status,200);const receipt=await responseDraft.json();
  assert.equal((await call('draft',{...draft,owner_id:'other'})).status,403);assert.equal((await call('draft',{...draft,calendar_id:'other'})).status,403);
  assert.equal((await call('draft',{...draft,content:{...draft.content,title:'Changed'}})).status,403);
  await mf.dispose();mf=new Miniflare(options);
  const afterRestart=await call('read',read);assert.equal(afterRestart.status,200,await (await mf.dispatchFetch('https://fixture/read',{method:'POST',body:JSON.stringify(read)})).text());assert.deepEqual((await afterRestart.json()).events,[{id:'event'}]);
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
  const created=await human('create',{id:shown.id,sha256:shown.sha256});assert.equal(created.status,200);assert.deepEqual(await created.json(),{state:'created',event_id:'fixture-event'});
  await mf.dispose();mf=new Miniflare(options);
  assert.deepEqual((await (await call('draft',draft)).json()).execution,{state:'created',event_id:'fixture-event'});
  assert.deepEqual(await (await human('create',{id:shown.id,sha256:shown.sha256})).json(),{state:'created',event_id:'fixture-event'});
  await mf.dispatchFetch('https://fixture/revoke');
  assert.equal((await human('create',{id:shown.id,sha256:shown.sha256})).status,403);
  assert.equal((await call('read',read)).status,403);
  assert.equal((await call('draft',draft)).status,403);assert.equal((await human('review',{id:receipt.draft_id})).status,403);

  for(let attempt=0;attempt<100&&(auditEvents.size<4||selectionEvents.size<1);attempt++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.deepEqual([...auditEvents.values()].map(e=>e.phase).sort(),['staged','approved','attempted','created'].sort());
  assert.equal([...auditEvents.values()].find(e=>e.phase==='staged').actor,'agent');
  assert.equal([...auditEvents.values()].find(e=>e.phase==='approved').actor,'owner');
  assert.equal(selectionEvents.size,1);
 }finally{await mf.dispose();await rm(state,{recursive:true,force:true})}
});
