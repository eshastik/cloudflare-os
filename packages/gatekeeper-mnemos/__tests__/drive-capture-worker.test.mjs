import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
const size=5*1024*1024;
const hash=createHash('sha256').update(Buffer.alloc(size,97)).digest('hex');
const head='a'.repeat(64),created='b'.repeat(64);
const harness=`import {WorkerEntrypoint} from 'cloudflare:workers';
export class Source extends WorkerEntrypoint {
 async validate(){const out=await fetch('https://source.example/validate');if(!out.ok)throw Error('revoked')}
 async read(){await fetch('https://source.example/read');return {provider:'google-drive',fileId:'file',sourceVersion:'1',sourceName:'я'.repeat(200),sourceMimeType:'application/octet-stream',contentType:'application/octet-stream',exported:false,bytes:new Uint8Array(${size}).fill(97),sha256:'${hash}'}}
}
export default {async fetch(request,env,ctx){
 const account=env.ACCOUNTS.get(env.ACCOUNTS.idFromName('drive-owner'));
 await account.acceptVerifiedCredential('fixture-human',Date.now()+900000);
 if(new URL(request.url).pathname==='/review'){
  using frame=await account.startAppUi();
  try{
   using review=await frame.nativeWrites.selector.reviewOfficeUpdate('project','target',new URL(request.url).searchParams.get('source')||'node','cloudflareos.document','${created}','${hash}');
   return Response.json(await review.describe());
  }catch(error){return new Response(error.message,{status:409})}
 }
 try{return Response.json(await account.captureDriveImport('project','request','account/file','file',ctx.exports.Source({props:{}})))}
 catch(error){return new Response(error.message,{status:503})}
}}`;
test('Worker receiver uploads a source over 4 MiB and recovers a lost create reply without rereading Drive',async()=>{
 let reads=0,uploads=0,sourceLive=true,denyRead=false,serverVerified=false;const posts=[];const operationEvents=new Map(),bridgeToken='s'.repeat(40);
 const mf=new Miniflare({workers:[
  {name:'harness',modules:true,script:harness,compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage', 'nodejs_compat'],durableObjects:{ACCOUNTS:{className:'UserAccount',scriptName:'mnemos',useSQLite:true}},outboundService:async request=>{
   const path=new URL(request.url).pathname;if(path==='/read')reads++;return new Response('',{status:sourceLive?200:403});
  }},
  {name:'mnemos',modules:true,scriptPath:fileURLToPath(new URL('../dist/mnemos.js',import.meta.url)),modulesRules:[{type:'Text',include:['**/*.txt']}],compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage', 'nodejs_compat'],bindings:{MNEMOS_CALENDAR_BRIDGE_TOKEN:bridgeToken,MNEMOS_DRIVE_ORIGIN_KEY:'public-fixture-key-for-drive-origin-v1',MNEMOS_API_ORIGIN:'https://memory.example',MNEMOS_STORAGE_ORIGIN:'https://storage.example'},outboundService:async request=>{
   const url=new URL(request.url);
   if(url.pathname.startsWith('/v1/internal/connection-audit/')){
    assert.equal(request.headers.get('Authorization'),'Bearer '+bridgeToken);
    const e=await request.json();
    if(e.protocol==='local-operation'){
     assert.equal(e.operation_kind,'driveImportCapture');assert.equal(e.owner_id,'owner');assert.equal(e.tenant_id,'tenant');
     assert.deepEqual(Object.keys(e).sort(),['account_id','after_sha256','before_sha256','event_id','observed_at','operation_kind','owner_id','phase','protocol','resource_sha256','tenant_id']);
     if(operationEvents.has(e.event_id))assert.deepEqual(operationEvents.get(e.event_id),e);operationEvents.set(e.event_id,e);
    }else assert.equal(e.protocol,'account');
    return Response.json({event_id:e.event_id});
   }
   if(url.origin==='https://storage.example'){
    assert.equal(request.method,'PUT');assert.equal(request.headers.get('Authorization'),null);
    const bytes=await request.arrayBuffer();assert.equal(bytes.byteLength,size);assert.equal(createHash('sha256').update(new Uint8Array(bytes)).digest('hex'),hash);uploads++;return new Response('');
   }
   assert.equal(url.origin,'https://memory.example');assert.equal(request.headers.get('Authorization'),'Bearer fixture-human');
   if(url.pathname==='/v1/whoami')return Response.json({subject:{tenant_id:'tenant',user_id:'owner'}});
   if(url.pathname.endsWith('/draft/open'))return Response.json({head});
   if(url.pathname==='/v1/uploads'){
    const body=await request.json();assert.equal(body.size_bytes,size);
    return Response.json({url:'https://storage.example/source',method:'PUT',upload_id:'upload',content_length:size,checksum_header:'x-amz-checksum-sha256',checksum_value:body.checksum_sha256},{status:201});
   }
   if(url.pathname.endsWith('/draft/create')){
    const body=await request.json();posts.push(body);
    const [payload,signature]=body.drive_origin_proof.split('.');const bytes=Buffer.from(payload,'base64url');
    assert.equal(signature,createHmac('sha256','public-fixture-key-for-drive-origin-v1').update('mnemos.drive-origin.v1\0').update(bytes).digest('base64url'));
    const claim=JSON.parse(bytes);assert.equal(claim.tenant,'tenant');assert.equal(claim.owner,'owner');assert.equal(claim.project,'project');assert.equal(claim.request,body.request_id);assert.equal(claim.upload,body.upload_id);assert.equal(claim.expected_head,body.expected_head);assert.equal(claim.sha256,hash);assert.equal(claim.size,size);assert.match(claim.source_binding,/^[a-f0-9]{64}$/);
    assert.ok(Buffer.byteLength(body.name)<=200);assert.equal(body.content_type,'application/octet-stream');
    if(posts.length===1)return new Response('',{status:503});return Response.json({node_id:'node',head:created},{status:201});
   }
   const baseline={source_node_id:'node',source_head:created,source_sha256:hash,output_sha256:'c'.repeat(64),unsupported:[]};
   if(url.pathname.endsWith('/draft/nodes/target'))return Response.json({node_id:'target',head:created,terms:[{metadata:{name:'Copy.cfdoc'}}]});
   if(url.pathname.endsWith('/office-origin'))return Response.json(baseline);
   if(url.pathname.endsWith('/access'))return Response.json({node_id:url.pathname.includes('/nodes/unknown/')?'unknown':'node',head:created});
   if(url.pathname.endsWith('/office/update-comparison')){
    const body=await request.json();
    return Response.json({drive_source_verified:serverVerified,node_id:'target',head:created,current_sha256:'c'.repeat(64),outcome:'source_unchanged',baseline,incoming:{preview_id:'converted',source_node_id:body.source_node_id,source_head:created,source_sha256:hash,sha256_hex:'c'.repeat(64),content_type:'application/vnd.cloudflareos.document+json',method:'GET',size_bytes:4,unsupported:[],url:'https://storage.example/preview'}});
   }
   if(url.pathname.endsWith('/draft/nodes/node'))return denyRead?new Response('',{status:403}):Response.json({node_id:'node',head:created,exists:true});
   throw Error('Unexpected fixture route');
  }}
 ]});
 try{
  const first=await mf.dispatchFetch('https://fixture/capture');assert.equal(first.status,503);const firstError=await first.text();
  assert.equal(posts.length,1,JSON.stringify({reads,uploads,firstError}));
  sourceLive=false;
  const second=await mf.dispatchFetch('https://fixture/capture');assert.equal(second.status,200,second.status===200?'':await second.text());const receipt=await second.json();
  assert.equal(receipt.head,created);assert.equal(receipt.source.sha256,hash);assert.equal(receipt.source.sourceName,'я'.repeat(200));assert.equal(receipt.source.bytes,undefined);
  assert.equal(reads,1);assert.equal(uploads,1);assert.deepEqual(posts[1],posts[0]);
  const matching=await mf.dispatchFetch('https://fixture/review');
  assert.equal(matching.status,200,matching.status===200?'':await matching.text());
  assert.equal((await matching.json()).outcome,'source_unchanged');
  const foreign=await mf.dispatchFetch('https://fixture/review?source=unknown');
  assert.equal(foreign.status,409);assert.match(await foreign.text(),/same captured Drive file and account/);
  serverVerified=true;
  const shared=await mf.dispatchFetch('https://fixture/review?source=unknown');assert.equal(shared.status,200,'server-verified shared source must not require the second human local index');
  denyRead=true;assert.equal((await mf.dispatchFetch('https://fixture/capture')).status,503);
  for(let i=0;i<100&&operationEvents.size<5;i++)await new Promise(r=>setTimeout(r,50));
  const events=[...operationEvents.values()];assert(events.length>=5,'preparation, upload, attempt and result audited');
  assert.equal(new Set(events.map(e=>e.account_id)).size,1);
  for(let i=1;i<events.length;i++)assert.equal(events[i-1].after_sha256,events[i].before_sha256);
 }finally{await mf.dispose()}
});
