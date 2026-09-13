import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const compile=name=>ts.transpileModule(readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const oauthURL=url(compile('oauth.ts'));
const {MicrosoftOAuth,MicrosoftCredentialRejected}=await import(oauthURL);
const {MicrosoftAccount}=await import(url(compile('account.ts').replace("'./oauth.ts'",JSON.stringify(oauthURL)).replace('"./oauth.ts"',JSON.stringify(oauthURL))));
const config={clientId:'client',clientSecret:'server-only-secret',tenant:'organizations',redirectUri:'https://os.example/gatekeeper/microsoft/oauth'};
function fixture(){
 const records=new Map();const storage={get:key=>structuredClone(records.get(key)),put:(key,value)=>records.set(key,structuredClone(value))};
 const state={identity:'account',calls:[],scope:'User.Read Mail.Read Calendars.Read',hook:async()=>{},error:undefined,status:200,version:0};
 const oauth=new MicrosoftOAuth(config,async(endpoint,init)=>{
  assert.equal(init.redirect,'manual');state.calls.push({endpoint,init});await state.hook(endpoint);
  if(endpoint==='https://login.microsoftonline.com/organizations/oauth2/v2.0/token'){
   assert.equal(init.method,'POST');const body=new URLSearchParams(init.body);assert.equal(body.get('client_secret'),config.clientSecret);assert(body.get('scope').includes('Mail.Read'));assert.equal(body.get('scope').includes('Calendars.ReadWrite'),body.get('grant_type')==='authorization_code'||records.get('account')?.grant?.calendarWrite===true);
   if(body.get('grant_type')==='authorization_code'){assert.equal(body.get('redirect_uri'),config.redirectUri);assert.match(body.get('code_verifier'),/^[a-f0-9]{64}$/);}
   if(state.error)return Response.json({error:state.error,error_description:'private details'},{status:state.status});
   state.version++;return Response.json({token_type:'Bearer',access_token:'access-'+state.version,refresh_token:'refresh-'+state.version,expires_in:3600,...(state.scope===undefined?{}:{scope:state.scope})});
  }
  assert.equal(endpoint,'https://graph.microsoft.com/v1.0/me?$select=id,displayName');assert.match(init.headers.Authorization,/^Bearer access-/);
  return Response.json({id:state.identity,displayName:'Example owner'});
 });
 const create=()=>new MicrosoftAccount(storage,oauth);
 const begin=async account=>new URL(await account.begin(account.start(),'a'.repeat(64)));
 const finish=(account,link)=>account.finish('one-use-code',link.searchParams.get('state').split(':')[1]);
 return {state,records,create,begin,finish,oauth};
}
test('Microsoft PKCE/state survive restart and cannot be replayed or change the account owner',async()=>{
 const f=fixture(),account=f.create(),initial=account.start();const link=new URL(await account.begin(initial,'a'.repeat(64)));
 assert.equal(link.origin,'https://login.microsoftonline.com');assert.equal(link.pathname,'/organizations/oauth2/v2.0/authorize');assert.equal(link.searchParams.get('code_challenge_method'),'S256');assert(!link.toString().includes(config.clientSecret));assert.equal(link.searchParams.has('code_verifier'),false);
 const verifier=f.records.get('account').flow.verifier;const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));assert.equal(link.searchParams.get('code_challenge'),Buffer.from(digest).toString('base64url'));
 await assert.rejects(account.begin(initial,'a'.repeat(64)));await assert.rejects(account.finish('code','wrong'));assert.equal(f.state.calls.length,0);
 const restored=f.create();await f.finish(restored,link);await assert.rejects(f.finish(restored,link));const generation=restored.generation();assert.equal(await restored.token(),'access-1');assert(!JSON.stringify(restored.describe()).includes('access-'));
 f.state.identity='other';await assert.rejects(f.finish(restored,await f.begin(restored)),/same Microsoft account/);assert.equal(restored.describe().id,'account');restored.validate(generation);
 restored.revoke();assert.throws(()=>restored.validate(generation));assert.equal(f.records.get('account').grant,undefined);
 f.state.identity='account';await f.finish(restored,await f.begin(restored));assert.throws(()=>restored.validate(generation));
});
test('concurrent refresh replaces one pair and revoke during exchange cannot restore it',async()=>{
 const f=fixture(),account=f.create();await f.finish(account,await f.begin(account));const generation=account.generation();f.records.get('account').grant.expiresAt=0;
 assert.deepEqual(await Promise.all([account.token(),account.token(),account.token()]),['access-2','access-2','access-2']);assert.equal(f.records.get('account').grant.refreshToken,'refresh-2');account.validate(generation);
 f.records.get('account').grant.expiresAt=0;f.state.hook=async endpoint=>{if(endpoint.endsWith('/token'))account.revoke()};await assert.rejects(account.token());assert.equal(f.records.get('account').grant,undefined);
 const g=fixture(),newAccount=g.create(),link=await g.begin(newAccount);g.state.hook=async endpoint=>{if(endpoint.endsWith('/token'))newAccount.revoke()};await assert.rejects(g.finish(newAccount,link));assert.equal(g.records.get('account').grant,undefined);
});
test('scope, expiration and refresh refusal are bounded without exposing provider diagnostics',async()=>{
 for(const scope of [undefined,'User.Read Mail.Read Calendars.Read','https%3A%2F%2Fgraph.microsoft.com%2Fuser.read https://graph.microsoft.com/mail.read https://graph.microsoft.com/calendars.read']){
  const f=fixture();f.state.scope=scope;const a=f.create();await f.finish(a,await f.begin(a));assert.equal(a.describe().id,'account');
 }
 const f=fixture(),a=f.create();f.state.scope='User.Read';await assert.rejects(f.finish(a,await f.begin(a)));assert.equal(f.records.get('account').grant,undefined);
 f.state.scope='User.Read Mail.Read Calendars.Read';let link=await f.begin(a);f.records.get('account').flow.expiresAt=0;const before=f.state.calls.length;await assert.rejects(f.finish(a,link));assert.equal(f.state.calls.length,before);
 await f.finish(a,await f.begin(a));f.records.get('account').grant.expiresAt=0;f.state.error='invalid_grant';f.state.status=400;
 await assert.rejects(a.token(),error=>error instanceof MicrosoftCredentialRejected&&!error.message.includes('private'));assert.equal(f.records.get('account').grant,undefined);
});
test('provider redirects, oversized and broken bodies never leak data or yield credentials',async()=>{
 for(const response of [()=>new Response(null,{status:302,headers:{Location:'https://foreign.invalid'}}),()=>new Response('x'.repeat(65537)),()=>new Response(new ReadableStream({start(c){c.error(Error('server-only-secret'))}}))]){
  let calls=0;const oauth=new MicrosoftOAuth(config,async()=>{calls++;return response()});await assert.rejects(oauth.exchange('code','a'.repeat(64)),error=>!error.message.includes('server-only-secret')&&!error.message.includes('foreign.invalid'));assert.equal(calls,1);
 }
 for(const tenant of ['../common','evil.example','common?redirect=bad'])assert.throws(()=>new MicrosoftOAuth({...config,tenant}));
});

test('Mail.Send is tracked from provider consent; refreshing a legacy read grant never requests new send authority',async()=>{
 const f=fixture(),account=f.create(),link=await f.begin(account);assert(link.searchParams.get('scope').includes('Mail.Send'));
 await f.finish(account,link);assert.equal(account.canSend(),false);
 f.records.get('account').grant.expiresAt=0;await account.token();let call=f.state.calls.filter(x=>x.endpoint.endsWith('/token')).at(-1);assert(!new URLSearchParams(call.init.body).get('scope').includes('Mail.Send'));
 f.state.scope+=' Mail.Send';await f.finish(account,await f.begin(account));assert.equal(f.create().canSend(),true);
 f.records.get('account').grant.expiresAt=0;await account.token();call=f.state.calls.filter(x=>x.endpoint.endsWith('/token')).at(-1);assert(new URLSearchParams(call.init.body).get('scope').includes('Mail.Send'));
 f.state.scope='User.Read Mail.Read Calendars.Read';f.records.get('account').grant.expiresAt=0;await account.token();assert.equal(account.canSend(),false);
});

test('calendar write requires returned consent; legacy refresh stays read-only and lost write scope disables creation',async()=>{
 const f=fixture(),a=f.create(),link=await f.begin(a);assert(link.searchParams.get('scope').includes('Calendars.ReadWrite'));
 await f.finish(a,link);assert.equal(a.canCreateCalendar(),false);
 f.records.get('account').grant.expiresAt=0;await a.token();let call=f.state.calls.filter(x=>x.endpoint.endsWith('/token')).at(-1);assert(!new URLSearchParams(call.init.body).get('scope').includes('Calendars.ReadWrite'));
 f.state.scope='User.Read Mail.Read Calendars.ReadWrite';await f.finish(a,await f.begin(a));assert.equal(f.create().canCreateCalendar(),true);assert.equal(a.canSend(),false);
 f.records.get('account').grant.expiresAt=0;await a.token();call=f.state.calls.filter(x=>x.endpoint.endsWith('/token')).at(-1);assert(new URLSearchParams(call.init.body).get('scope').includes('Calendars.ReadWrite'));
 f.state.scope='User.Read Mail.Read Calendars.Read';f.records.get('account').grant.expiresAt=0;await a.token();assert.equal(a.canCreateCalendar(),false);
 f.state.scope=undefined;await f.finish(a,await f.begin(a));assert.equal(a.canCreateCalendar(),false);
});
