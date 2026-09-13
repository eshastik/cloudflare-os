import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:'export * from "./src/account.ts";export * from "./src/oauth.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {YandexAccount,YandexOAuth,YandexCredentialRejected}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
function fixture(){
 const records=new Map();const storage={get:key=>structuredClone(records.get(key)),put:(key,value)=>records.set(key,structuredClone(value)),delete:key=>records.delete(key)};
 const state={identity:'123',calls:[],scope:undefined,beforeResponse:async()=>{},fail:false,tokenError:undefined,tokenStatus:400};
 const oauth=new YandexOAuth({clientId:'client',clientSecret:'client-secret',redirectUri:'https://os.example/gatekeeper/yandex/oauth'},async(url,init)=>{
  assert.equal(init.redirect,'manual');state.calls.push({url,init});await state.beforeResponse(url);
  if(state.fail)throw Error('transport secret: client-secret');
  if(url==='https://oauth.yandex.ru/token'){
   if(state.tokenError)return Response.json({error:state.tokenError,error_description:'private provider details'},{status:state.tokenStatus});
   assert.equal(init.method,'POST');const form=new URLSearchParams(init.body);assert.equal(form.get('client_secret'),'client-secret');
   if(form.get('grant_type')==='authorization_code')assert.match(form.get('code_verifier'),/^[a-f0-9]{64}$/);
   return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer',...(state.scope===undefined?{}:{scope:state.scope})});
  }
  assert.equal(url,'https://login.yandex.ru/info?format=json');assert.equal(init.headers.Authorization,'OAuth fixture-access');
  return Response.json({id:state.identity,display_name:'Example'});
 });
 const create=()=>new YandexAccount(storage,oauth);
 const begin=async(account)=>{const init=account.start();return new URL(await account.begin(init,'a'.repeat(64)))};
 const finish=async(account,url)=>account.finish('fixture-code',url.searchParams.get('state').split(':')[1]);
 return {state,records,create,begin,finish};
}
test('one-use initiation and PKCE state survive restart; credentials never enter the authorization URL',async()=>{
 const f=fixture(),account=f.create(),initial=account.start();
 const url=new URL(await account.begin(initial,'a'.repeat(64)));
 assert.equal(url.origin,'https://oauth.yandex.ru');assert.equal(url.searchParams.get('scope'),'login:info cloud_api:disk.read');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(url.searchParams.has('client_secret'),false);assert.equal(url.searchParams.has('code_verifier'),false);
 await assert.rejects(account.begin(initial,'a'.repeat(64)));await assert.rejects(account.finish('code','wrong'));assert.equal(f.state.calls.length,0);
 const restored=f.create();assert.deepEqual(await f.finish(restored,url),{id:'123',displayName:'Example'});
 await assert.rejects(f.finish(restored,url));assert.equal(await restored.token(),'fixture-access');assert.equal(f.state.calls.length,2);
 assert.equal(JSON.stringify(restored.describe()).includes('fixture-access'),false);
});
test('reconnect rejects a different owner and revoked source generations never revive',async()=>{
 const f=fixture(),account=f.create();await f.finish(account,await f.begin(account));const generation=account.generation();
 f.state.identity='999';await assert.rejects(f.finish(account,await f.begin(account)),/same Yandex account/);assert.equal(account.describe().id,'123');account.validate(generation);
 account.revoke();assert.throws(()=>account.validate(generation));await assert.rejects(account.token());
 f.state.identity='123';await f.finish(account,await f.begin(account));assert.throws(()=>account.validate(generation));
});
test('revocation during exchange prevents late credentials from being saved',async()=>{
 const f=fixture(),account=f.create(),url=await f.begin(account);
 f.state.beforeResponse=async endpoint=>{if(endpoint.endsWith('/token'))account.revoke()};
 await assert.rejects(f.finish(account,url),/account changed/);assert.equal(f.records.has('grant'),false);
});
test('concurrent refresh runs once and preserves the source generation',async()=>{
 const f=fixture(),account=f.create();await f.finish(account,await f.begin(account));const generation=account.generation();
 f.records.get('grant').expiresAt=0;
 assert.deepEqual(await Promise.all([account.token(),account.token()]),['fixture-access','fixture-access']);
 assert.equal(f.state.calls.filter(call=>new URLSearchParams(call.init.body).get('grant_type')==='refresh_token').length,1);account.validate(generation);
 f.records.get('grant').expiresAt=0;f.state.beforeResponse=async endpoint=>{if(endpoint.endsWith('/token'))account.revoke()};
 await assert.rejects(account.token());assert.equal(f.records.has('grant'),false);
});
test('expired state, missing scopes and transport errors do not expose secrets or install credentials',async()=>{
 const f=fixture(),account=f.create(),url=await f.begin(account);f.records.get('flow').expiresAt=0;
 await assert.rejects(f.finish(account,url));assert.equal(f.state.calls.length,0);
 f.state.scope='login:info';await assert.rejects(f.finish(account,await f.begin(account)),/read access/);assert.equal(f.records.has('grant'),false);
 f.state.fail=true;
 await assert.rejects(f.finish(account,await f.begin(account)),error=>!error.message.includes('client-secret')&&error.cause===undefined);
});

test('only a definitive refresh refusal is classified as expired credentials',async()=>{
 for(const [code,status,definitive] of [['invalid_grant',400,true],['invalid_client',400,false],['invalid_grant',503,false]]){
  const f=fixture(),account=f.create();await f.finish(account,await f.begin(account));f.records.get('grant').expiresAt=0;
  f.state.tokenError=code;f.state.tokenStatus=status;
  await assert.rejects(account.token(),error=>(error instanceof YandexCredentialRejected)===definitive&&!error.message.includes('private provider details'));
 }
});
