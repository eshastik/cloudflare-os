import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const harness=`import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
export class Store extends DurableObject {
 async complete(user){this.ctx.storage.kv.put('user',user);let count=this.ctx.storage.kv.get('count')||0;this.ctx.storage.kv.put('count',count+1);if(!count)throw Error('lost completion ACK')}
 async restored(){this.ctx.storage.kv.put('restored',true)}
 async expired(){this.ctx.storage.kv.put('expired',true)}
 async run(path){
  const user=this.ctx.storage.kv.get('user');
  if(path==='/describe')return user.describe();
  if(path==='/select'){const selected=await user.getDriveImportSource('disk:/plan.docx');this.ctx.storage.kv.put('source',selected.source);return {selected:true}}
  if(path==='/read'){const result=await this.ctx.storage.kv.get('source').read();return {sha256:result.sha256,size:result.bytes.length,provider:result.provider}}
  if(path==='/revoke'){await user.revoke();return {revoked:true}}
  if(path==='/reconnect')return user.reconnect();
  return {count:this.ctx.storage.kv.get('count'),restored:this.ctx.storage.kv.get('restored')||false,expired:this.ctx.storage.kv.get('expired')||false};
 }
}
export class Callback extends WorkerEntrypoint {
 #store(){return this.ctx.exports.Store.get(this.ctx.exports.Store.idFromName('owner'))}
 async complete(user){await this.#store().complete(user)}
 async credentialsRestored(){await this.#store().restored()}
 async credentialsExpired(){await this.#store().expired()}
}
export default {async fetch(request,env,ctx){try{
 const path=new URL(request.url).pathname;
 if(path==='/connect')return Response.json(await env.VENDOR.connectAccount(ctx.exports.Callback({props:{}})));
 return Response.json(await ctx.exports.Store.get(ctx.exports.Store.idFromName('owner')).run(path));
}catch{return new Response('rejected',{status:409})}}}`;
test('real Worker OAuth completion retries, persisted account/source survives restart, and revoke blocks reads',async()=>{
 const persist=await mkdtemp(join(tmpdir(),'yandex-worker-'));let exchanges=0,identity='123',downloads=0,authMode='ok';
 const options={resourcePersistencePath:persist,workers:[{
  name:'harness',modules:true,script:harness,compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage'],
  durableObjects:{STORE:{className:'Store',useSQLite:true}},serviceBindings:{VENDOR:{name:'yandex',entrypoint:'GatekeeperVendor'},HTTP:'yandex'},
 },{
  name:'yandex',modules:true,scriptPath:fileURLToPath(new URL('../dist/yandex.js',import.meta.url)),compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage'],
  bindings:{BASE_URL:'https://os.example/yandex',CLIENT_ID:'client',CLIENT_SECRET:'fixture-secret'},durableObjects:{ACCOUNTS:{className:'UserAccount',useSQLite:true}},
  outboundService:async request=>{
   const url=new URL(request.url);
   if(url.hostname==='oauth.yandex.ru'){exchanges++;assert.equal(request.method,'POST');if(authMode==='revoked')return Response.json({error:'invalid_grant',error_description:'private provider details'},{status:400});return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600})}
   if(url.hostname==='login.yandex.ru')return Response.json({id:identity,display_name:'Example'});
   if(url.hostname==='cloud-api.yandex.net'){
    assert.equal(request.method,'GET');assert.equal(request.headers.get('Authorization'),'OAuth fixture-access');
    if(authMode==='transient')return new Response(null,{status:503});
    if(authMode==='revoked')return new Response(null,{status:401});
    if(url.pathname.endsWith('/download'))return Response.json({href:'https://downloader.disk.yandex.ru/disk/signed',method:'GET',templated:false});
    return Response.json({path:'disk:/plan.docx',name:'plan.docx',type:'file',mime_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',modified:'2026-09-11T00:00:00Z',size:3,md5:'900150983cd24fb0d6963f7d28e17f72'});
   }
   assert.equal(url.hostname,'downloader.disk.yandex.ru');assert.equal(request.headers.get('Authorization'),null);downloads++;return new Response('abc');
  }
 }]};
 // Forward the public callback through an actual service binding, preserving its public URL.
 options.workers[0].script=harness.replace(" const path=new URL(request.url).pathname;"," const path=new URL(request.url).pathname;\n if(path.startsWith('/yandex/'))return env.HTTP.fetch(request);");
 let mf=new Miniflare(options);
 const call=path=>mf.dispatchFetch('https://os.example'+path);
 const authorize=async start=>{
  const initial=await mf.dispatchFetch(start,{redirect:'manual'});assert.equal(initial.status,302);
  const auth=new URL(initial.headers.get('location'));assert.equal(auth.hostname,'oauth.yandex.ru');
  const callback=new URL('https://os.example/yandex/oauth');callback.search=new URLSearchParams({code:'fixture-code',state:auth.searchParams.get('state')});return callback.toString();
 };
 try{
  const start=await (await call('/connect')).json();const callback=await authorize(start.url);
  assert.equal((await mf.dispatchFetch(callback)).status,400);assert.equal(exchanges,1);
  assert.equal((await mf.dispatchFetch(callback)).status,200);assert.equal(exchanges,1,'Completion retry must not exchange code again');
  assert.equal((await (await call('/describe')).json()).uniqueName,'123');
  assert.equal((await call('/select')).status,200);
  const first=await (await call('/read')).json();assert.equal(first.size,3);assert.equal(first.provider,'yandex-disk');assert.equal(first.sha256,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  await mf.dispose();mf=new Miniflare(options);
  assert.deepEqual(await (await call('/read')).json(),first);assert.equal(downloads,2);
  assert.equal((await call('/revoke')).status,200);assert.equal((await call('/read')).status,409);assert.equal(downloads,2);
  identity='999';let again=await (await call('/reconnect')).json();assert.equal((await mf.dispatchFetch(await authorize(again.url))).status,400);
  identity='123';again=await (await call('/reconnect')).json();assert.equal((await mf.dispatchFetch(await authorize(again.url))).status,200);
  assert.equal((await call('/read')).status,409,'Old source cannot revive after reconnect');
  assert.equal((await call('/select')).status,200);assert.equal((await call('/read')).status,200);
  assert.equal((await (await call('/counts')).json()).restored,true);
  authMode='transient';assert.equal((await call('/read')).status,409);assert.equal((await call('/describe')).status,200);assert.equal((await (await call('/counts')).json()).expired,false);
  authMode='ok';assert.equal((await call('/read')).status,200);
  authMode='revoked';assert.equal((await call('/read')).status,409);assert.equal((await call('/describe')).status,409);
  const deadline=Date.now()+5000;let notified=false;
  while(Date.now()<deadline){notified=(await (await call('/counts')).json()).expired;if(notified)break;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(notified,true,'Worker alarm must notify Workshop of definitive expiry');

 }finally{await mf.dispose();await rm(persist,{recursive:true,force:true});}
});
