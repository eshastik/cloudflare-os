import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LoginProfiles,organizationAccountName} from './login-profiles.ts';
import type {AccountStorage} from './account-session.ts';
import {BrowserLoginBinding,handleBrowserLogin} from './browser-login.ts';
const config={iamOrigin:'https://iam.example',authorizationEndpoint:'https://provider.example/auth',tokenEndpoint:'https://provider.example/token',clientId:'cloudflare',clientSecret:'provider-secret',iamClientSecret:'s'.repeat(40),callbackUrl:'https://gatekeeper.example/callback'};
function storage():AccountStorage{const m=new Map<string,unknown>();return {get:<T>(k:string)=>m.get(k) as T|undefined,put:(k,v)=>{m.set(k,v)},delete:k=>{m.delete(k)}}}
const extras=JSON.stringify([{id:'second',name:'Вторая <организация>',apiOrigin:'https://second-api.example',storageOrigin:'https://second-storage.example',config:{...config,iamOrigin:'https://second-iam.example'}}]);
test('operator profiles pin selection, preserve old accounts and reject removed profiles',()=>{
 const kv=storage(),profiles=new LoginProfiles(kv,JSON.stringify(config),extras);
 assert.deepEqual(profiles.choices().map(p=>p.id),['default','second']);assert.throws(()=>profiles.select());assert.throws(()=>profiles.select('https://evil.example'));
 profiles.select('second');assert.deepEqual(profiles.origins('https://first-api.example'),{apiOrigin:'https://second-api.example',storageOrigin:'https://second-storage.example'});assert.equal(profiles.config().iamOrigin,'https://second-iam.example');assert.throws(()=>profiles.select('default'));
 const reconnected=new LoginProfiles(kv,JSON.stringify(config),extras);reconnected.select();assert.equal(reconnected.choices().length,1);assert.equal(reconnected.config().iamOrigin,'https://second-iam.example');
 assert.throws(()=>new LoginProfiles(kv,JSON.stringify(config)).config());
 const old=storage();old.put('mnemosAccountOwner',{tenant:'existing',user:'alice'});const legacy=new LoginProfiles(old,JSON.stringify(config),extras);assert.deepEqual(legacy.choices().map(p=>p.id),['default']);assert.throws(()=>legacy.select('second'));
 for(const list of [[{id:'default',name:'x',config}],[{id:'extra',name:'x',config:{...config,callbackUrl:'https://other.example/callback'}}]])assert.throws(()=>new LoginProfiles(storage(),JSON.stringify(config),JSON.stringify(list)));
});
test('organization choice validates nonce, escapes labels and consumes only selected start',async()=>{
 const kv=storage(),binding=new BrowserLoginBinding(kv),nonce=binding.prepare(),id='a'.repeat(64),profiles=new LoginProfiles(kv,JSON.stringify(config),extras);let starts=0;
 const account={async loginOrganizations(n:string){binding.check(n);return profiles.choices()},async startBrowserLogin(n:string,p?:string){binding.check(n);profiles.select(p);starts++;return {url:'https://provider.example/auth',browserNonce:binding.start(n)}},async completeBrowserLogin(){}};
 const base=config.callbackUrl+'/start/'+id+'/'+nonce;
 const choose=await handleBrowserLogin(new Request(base),config.callbackUrl,()=>account);assert.equal(choose.status,200);const html=await choose.text();assert.ok(html.includes('Вторая &lt;организация&gt;'));assert.ok(!html.includes('provider-secret')&&!html.includes('second-iam.example'));assert.equal(starts,0);
 assert.equal((await handleBrowserLogin(new Request(base+'?organization=unknown'),config.callbackUrl,()=>account)).status,403);assert.equal(starts,0);
 assert.equal((await handleBrowserLogin(new Request(base+'?organization=second&organization=default'),config.callbackUrl,()=>account)).status,400);
 const selected=await handleBrowserLogin(new Request(base+'?organization=second'),config.callbackUrl,()=>account);assert.equal(selected.status,302);assert.equal(starts,1);
 assert.equal((await handleBrowserLogin(new Request(base),config.callbackUrl,()=>account)).status,403);
});

test('account identity keeps legacy primary keys and separates identical tenants on other servers',()=>{
 const primary='https://one.example';
 assert.equal(organizationAccountName(primary,primary,'org','alice'),JSON.stringify(['org','alice']));
 assert.notEqual(organizationAccountName(primary,primary,'org','alice'),organizationAccountName(primary,'https://two.example','org','alice'));
 assert.notEqual(organizationAccountName(primary,'https://two.example','org','alice'),organizationAccountName(primary,'https://three.example','org','alice'));
 assert.notEqual(organizationAccountName(primary,'https://two.example','org','alice'),organizationAccountName(primary,'https://two.example','org','bob'));
});
