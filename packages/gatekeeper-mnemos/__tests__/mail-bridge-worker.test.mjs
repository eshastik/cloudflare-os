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
 async send(content){if(content.subject!=='Review')throw Error('changed');return {message_id:'sent-message'}}
 async metadata(){return {provider:'google',query:'label:team'}}
 async readSelection(){return {provider:'google',query:'label:team',messages_json:'[{"message_id":"message"}]',truncated:false}}
}
export default {async fetch(request,env,ctx){
 const account=env.ACCOUNTS.get(env.ACCOUNTS.idFromName('mail-owner'));
 const action=new URL(request.url).pathname;
 if(action==='/prepare'){
  await account.acceptVerifiedCredential('fixture-human-token',Date.now()+900000);
  return Response.json(await account.acceptMailReadSource('project','request','fixture-source',ctx.exports.Source({props:{}})));
 }
 if(action==='/read'){try{return Response.json(await account.readMailSelection(await request.json()))}catch(error){return new Response(error.message,{status:500})}}
 if(action==='/list'){try{const input=await request.json();return Response.json(await account.listMailDrafts(input.connection,input.cursor))}catch{return new Response('denied',{status:403})}}
 if(action==='/send'){try{const input=await request.json();return Response.json(await account.sendMailDraft(input.id,input.sha256,input.sourceKey,ctx.exports.Source({props:{}})))}catch{return new Response('denied',{status:403})}}
 if(action==='/review'){try{return Response.json(await account.readMailDraft((await request.json()).id))}catch{return new Response('denied',{status:403})}}
 if(action==='/decide'){try{const input=await request.json();return Response.json(await account.decideMailDraft(input.id,input.sha256,input.approved))}catch{return new Response('denied',{status:403})}}
 if(action==='/revoke'){await account.revoke();return new Response('ok')}
 return new Response('missing',{status:404});
}}`;

test('mail bridge retains a Worker source across restart and rejects revoked owner',async()=>{
 const state=await mkdtemp(join(tmpdir(),'mnemos-mail-'));
 const token='fixture-service-credential-32-characters';
 const auditEvents=new Map(),selectionEvents=new Map();
 const options={resourcePersistencePath:state,workers:[
  {name:'harness',modules:true,script:harness,compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage', 'nodejs_compat'],durableObjects:{ACCOUNTS:{className:'UserAccount',scriptName:'mnemos',useSQLite:true}}},
  {name:'mnemos',modules:true,scriptPath:fileURLToPath(new URL('../dist/mnemos.js',import.meta.url)),modulesRules:[{type:'Text',include:['**/*.txt']}],compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage', 'nodejs_compat'],bindings:{MNEMOS_API_ORIGIN:'https://memory.example',MNEMOS_LOGIN_CONFIG:JSON.stringify({callbackUrl:'https://workshop.example/gatekeeper/mnemos/oauth'}),MNEMOS_MAIL_BRIDGE_TOKEN:token,MNEMOS_CALENDAR_BRIDGE_TOKEN:token},outboundService:async request=>{
   const path=new URL(request.url).pathname;
   if(path==='/v1/internal/connection-audit/mail-selection'){
    assert.equal(request.headers.get('Authorization'),'Bearer '+token);const e=await request.json();assert.equal(e.phase,'selected');assert.equal(e.project_id,'project');assert.equal(e.owner_id,'owner');
    const previous=selectionEvents.get(e.event_id);if(previous)assert.deepEqual(previous,e);selectionEvents.set(e.event_id,e);return Response.json({event_id:e.event_id});
   }
   if(path==='/v1/internal/draft-audit/mail'){
    assert.equal(request.headers.get('Authorization'),'Bearer '+token);
    const event=await request.json();assert.equal(event.kind,'mail');assert.equal(event.tenant_id,'tenant');assert.equal(event.owner_id,'owner');
    const previous=auditEvents.get(event.event_id);if(previous)assert.deepEqual(event,previous);auditEvents.set(event.event_id,event);
    return Response.json({event_id:event.event_id});
   }
   if(path.startsWith('/v1/mail-connections/'))return Response.json({connection_id:path.split('/').at(-1),project_id:'project',provider:'google',enabled:true,revision:1});
   assert.equal(path,'/v1/whoami');
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
   return worker.fetch('https://workshop.example/gatekeeper/mnemos/oauth/mail-bridge/'+suffix,{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify(body)});
  };
  assert.equal((await call('resolve',input,'wrong-credential')).status,403);
  const resolved=await call('resolve',input);assert.equal(resolved.status,200);const connection=await resolved.json();
  const read={selection_id:selected.selection_id,tenant_id:'tenant',owner_id:'owner',project_id:'project',connection_id:connection.connection_id,query_sha256:connection.query_sha256,limit:1};
  assert.equal((await call('read',read)).status,200);
  const {limit,...coordinates}=read;
  const draft={...coordinates,agent_principal_id:'agent',request_id:'draft-request',content:{to:['review@example.test'],subject:'Review',body:'Draft text'}};
  assert.equal((await call('draft',draft,'wrong')).status,403);
  const staged=await call('draft',draft);assert.equal(staged.status,200);const receipt=await staged.json();assert.equal(receipt.state,'pending');assert.equal(receipt.connection_id,connection.connection_id);
  assert.equal((await call('draft',{...draft,owner_id:'other'})).status,403);
  assert.equal((await call('draft',{...draft,content:{...draft.content,body:'changed'}})).status,403);
  await mf.dispose();mf=new Miniflare(options);
  assert.deepEqual(await (await call('draft',draft)).json(),receipt);
  const list=()=>mf.dispatchFetch('https://fixture/list',{method:'POST',body:JSON.stringify({connection:connection.connection_id})});
  assert.deepEqual((await (await list()).json()).drafts,[{id:receipt.draft_id,agent_id:'agent',state:'pending',subject:'Review'}]);
  const review=await mf.dispatchFetch('https://fixture/review',{method:'POST',body:JSON.stringify({id:receipt.draft_id})});assert.equal(review.status,200);const shown=await review.json();assert.equal(shown.content.body,'Draft text');assert.equal(shown.context,undefined);
  const decide=body=>mf.dispatchFetch('https://fixture/decide',{method:'POST',body:JSON.stringify(body)});
  assert.equal((await decide({id:receipt.draft_id,sha256:'0'.repeat(64),approved:true})).status,403);
  const decision={id:receipt.draft_id,sha256:shown.sha256,approved:true};
  const send=sourceKey=>mf.dispatchFetch('https://fixture/send',{method:'POST',body:JSON.stringify({...decision,sourceKey})});
  assert.equal((await send('fixture-source')).status,403); // still pending

  assert.equal((await decide(decision)).status,200);assert.equal((await decide(decision)).status,200);
  assert.equal((await decide({...decision,approved:false})).status,403);
  assert.equal((await send('wrong-source')).status,403);
  assert.deepEqual(await (await send('fixture-source')).json(),{state:'accepted',message_id:'sent-message'});
  const refreshed=await (await call('draft',draft)).json();assert.equal(refreshed.state,'approved');assert.deepEqual(refreshed.delivery,{state:'accepted',message_id:'sent-message'});
  await mf.dispose();mf=new Miniflare(options);
  assert.deepEqual(await (await send('fixture-source')).json(),{state:'accepted',message_id:'sent-message'});

  const afterRestart=await call('read',read);assert.equal(afterRestart.status,200,await (await mf.dispatchFetch('https://fixture/read',{method:'POST',body:JSON.stringify(read)})).text());assert.deepEqual((await afterRestart.json()).messages,[{message_id:'message'}]);
  assert.equal((await call('read',{...read,owner_id:'other'})).status,403);
  await mf.dispatchFetch('https://fixture/revoke');
  assert.equal((await list()).status,403);
  assert.equal((await send('fixture-source')).status,403);
  assert.equal((await call('read',read)).status,403);
  assert.equal((await call('draft',draft)).status,403);
  assert.equal((await mf.dispatchFetch('https://fixture/review',{method:'POST',body:JSON.stringify({id:receipt.draft_id})})).status,403);

  for(let attempt=0;attempt<100&&(auditEvents.size<4||selectionEvents.size<1);attempt++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.deepEqual([...auditEvents.values()].map(e=>e.phase).sort(),['staged','approved','attempted','accepted'].sort());
  assert.equal([...auditEvents.values()].find(e=>e.phase==='staged').actor,'agent');
  assert.equal([...auditEvents.values()].find(e=>e.phase==='approved').actor,'owner');
  assert.equal(selectionEvents.size,1);
 }finally{await mf.dispose();await rm(state,{recursive:true,force:true})}
});
