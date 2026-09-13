import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
const id='12345678-1234-4234-8234-123456789abc';
const harness=`export default {async fetch(request,env){const a=env.ACCOUNTS.get(env.ACCOUNTS.idFromName('owner'));const path=new URL(request.url).pathname;
 if(path==='/connect'){await a.acceptVerifiedCredential('fixture-human',Date.now()+900000);return Response.json(await a.connectWebDAVAccount({request:'${id}',server:'corp-fixture',username:'private-user',password:'private-password'}));}
 if(path==='/remove'){await a.removeWebDAVAccount('${id}');await a.revoke();return new Response('ok');}
 return new Response('missing',{status:404});}}`;
test('production account alarm delivers retained local connection events after Worker restart and revoke',async()=>{
 const state=await mkdtemp(join(tmpdir(),'mnemos-connection-audit-'));const token='s'.repeat(40);let offline=true,attempts=0;const events=new Map();
 const options={resourcePersistencePath:state,workers:[{name:'harness',modules:true,script:harness,compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage','nodejs_compat'],durableObjects:{ACCOUNTS:{className:'UserAccount',scriptName:'mnemos',useSQLite:true}}},
 {name:'mnemos',modules:true,scriptPath:fileURLToPath(new URL('../dist/mnemos.js',import.meta.url)),modulesRules:[{type:'Text',include:['**/*.txt']}],compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage','nodejs_compat'],bindings:{MNEMOS_API_ORIGIN:'https://memory.example',MNEMOS_CALENDAR_BRIDGE_TOKEN:token,MNEMOS_LOGIN_CONFIG:JSON.stringify({callbackUrl:'https://workshop.example/gatekeeper/mnemos/oauth'}),MNEMOS_WEBDAV_SERVERS:JSON.stringify([{id:'corp-fixture',title:'Fixture',url:'https://dav.example/root/'}])},outboundService:async request=>{
  const url=new URL(request.url);
  if(url.host==='dav.example'){assert.equal(request.method,'PROPFIND');return new Response('<d:multistatus xmlns:d="DAV:"><d:response><d:href>/root/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>',{status:207})}
  if(url.pathname==='/v1/whoami'){assert.equal(request.headers.get('Authorization'),'Bearer fixture-human');return Response.json({subject:{tenant_id:'tenant',user_id:'owner'}})}
  assert(['/v1/internal/connection-audit/webdav','/v1/internal/connection-audit/account'].includes(url.pathname));assert.equal(request.headers.get('Authorization'),'Bearer '+token);attempts++;if(offline)return new Response('',{status:503});
  const e=await request.json();if(e.protocol==='webdav')assert.equal(e.account_id,id);else assert.match(e.account_id,/^[0-9a-f-]{36}$/);assert.equal(e.owner_id,'owner');assert.equal(e.tenant_id,'tenant');assert(!JSON.stringify(e).includes('private-'));
  if(events.has(e.event_id))assert.deepEqual(e,events.get(e.event_id));events.set(e.event_id,e);return Response.json({event_id:e.event_id});
 }}]};
 let mf=new Miniflare(options);
 const waitFor=async(predicate)=>{for(let i=0;i<100&&!predicate();i++)await new Promise(r=>setTimeout(r,50));assert(predicate(),'expected production alarm delivery')};
 try{
  const connected=await mf.dispatchFetch('https://fixture/connect');assert.equal(connected.status,200);assert.equal((await connected.json()).enabled,true);
  await waitFor(()=>attempts>0);assert.equal(events.size,0);await mf.dispose();offline=false;mf=new Miniflare(options);
  assert.equal((await mf.dispatchFetch('https://fixture/remove')).status,200);await waitFor(()=>events.size===5);
  assert.deepEqual([...events.values()].filter(e=>e.protocol==='webdav').map(e=>e.phase),['connecting','enabled','removed']);
  const accountEvents=[...events.values()].filter(e=>e.protocol==='account');
  assert.deepEqual(accountEvents.map(e=>e.phase),['connected','disconnected']);
  assert.equal(accountEvents[0].account_id,accountEvents[1].account_id);
  assert(!JSON.stringify([...events.values()]).includes('fixture-human'));
 }finally{await mf.dispose();await rm(state,{recursive:true,force:true})}
});
