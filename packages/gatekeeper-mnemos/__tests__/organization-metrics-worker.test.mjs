import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';

test('real Worker exposes separate authorized organization summaries and revokes retained readers',async()=>{
 const reads=[];
 const mf=new Miniflare({workers:[{
  name:'mnemos',modules:true,modulesRules:[{type:'Text',include:['**/*.txt']}],scriptPath:fileURLToPath(new URL('../dist/mnemos.js',import.meta.url)),compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage','nodejs_compat'],bindings:{MNEMOS_API_ORIGIN:'https://memory.example'},durableObjects:{ACCOUNTS:{className:'UserAccount',useSQLite:true}},
  outboundService:async request=>{
   const credential=request.headers.get('Authorization');assert.ok(['Bearer org-a','Bearer org-b','Bearer denied'].includes(credential));
   const tenant=credential==='Bearer org-a'?'a':'b';const path=new URL(request.url).pathname;
   if(path==='/v1/whoami')return Response.json({subject:{tenant_id:tenant,user_id:'same-human'},tenant_name:'Organization '+tenant});
   assert.equal(path,'/v1/platform/metrics');reads.push(tenant);
   if(credential==='Bearer denied')return new Response('',{status:403});
   const count=tenant==='a'?2:0;
   return Response.json({shared_publications:count,human_logins_24h:0,authenticated_users_24h:0,workspace_activity:null,recorded_at:'2026-09-12T12:00:00Z',organization_work:{first_publication_at:count?'2026-09-12T11:00:00Z':null,first_acceptance_at:null,observed_at:'2026-09-12T12:00:00Z',periods:[1,7,30].map(days=>({days,publications:count,projects:count,has_completed_publication:count>0,accepted_requests:0,accepted_request_projects:0,completed_projects:count,has_completed_work:count>0}))}});
  }
 },{name:'driver',modules:true,compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage','nodejs_compat'],durableObjects:{ACCOUNTS:{className:'UserAccount',scriptName:'mnemos',useSQLite:true}},script:`export default {async fetch(request,env){
  const summaries=[],denials=[];
  for(const token of ['org-a','org-b','denied']){
   const account=env.ACCOUNTS.get(env.ACCOUNTS.idFromName(token));await account.acceptVerifiedCredential(token);const frame=await account.startAppUi();
   try{summaries.push(await frame.organizationMetrics.read())}catch{denials.push(token)}
   await account.revoke();let revoked=false;try{await frame.organizationMetrics.read()}catch{revoked=true}if(!revoked)throw Error('retained reader bypassed revoke');
   frame.organizationMetrics[Symbol.dispose]();frame.agentConsent[Symbol.dispose]();frame.ui[Symbol.dispose]();
  }
  return Response.json({summaries,denials})
 }}`} ]});
 try{
  const driver=await mf.getWorker('driver');const response=await driver.fetch('https://driver.example/');assert.equal(response.status,200);const result=await response.json();
  assert.deepEqual(result.denials,['denied']);assert.deepEqual(result.summaries.map(s=>[s.tenantId,s.periods[0].completedProjects]),[['a',2],['b',0]]);
  assert.ok(result.summaries.every(s=>s.origin==='https://memory.example'&&!('subject' in s)));assert.deepEqual(reads,['a','b','b']);
 }finally{await mf.dispose()}
});

test('profiled Worker accounts keep identical tenant/user IDs distinct across API installations',async()=>{
 const config={iamOrigin:'https://iam.example',authorizationEndpoint:'https://provider.example/auth',tokenEndpoint:'https://provider.example/token',clientId:'client',clientSecret:'secret',iamClientSecret:'s'.repeat(40),callbackUrl:'https://workshop.example/callback'};
 const origins=[];
 const mf=new Miniflare({workers:[{
  name:'mnemos',modules:true,modulesRules:[{type:'Text',include:['**/*.txt']}],scriptPath:fileURLToPath(new URL('../dist/mnemos.js',import.meta.url)),compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage','nodejs_compat'],bindings:{MNEMOS_API_ORIGIN:'https://one.example',MNEMOS_LOGIN_CONFIG:JSON.stringify(config),MNEMOS_LOGIN_PROFILES:JSON.stringify([{id:'second',name:'Second',apiOrigin:'https://two.example',config}])},durableObjects:{ACCOUNTS:{className:'UserAccount',useSQLite:true}},outboundService:async request=>{
   const url=new URL(request.url);
   if(url.origin==='https://iam.example'){assert.equal(url.pathname,'/v1/session/request');return Response.json({state:'state',nonce:'nonce',expires_in_ms:300000})}
   assert.ok(['https://one.example','https://two.example'].includes(url.origin));assert.equal(url.pathname,'/v1/whoami');origins.push(url.origin);
   assert.equal(request.headers.get('Authorization'),'Bearer fixture');return Response.json({subject:{tenant_id:'same-tenant',user_id:'same-user'},tenant_name:'Same label'});
  }
 },{name:'driver',modules:true,compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage','nodejs_compat'],durableObjects:{ACCOUNTS:{className:'UserAccount',scriptName:'mnemos',useSQLite:true}},script:`export default {async fetch(request,env){
  const names=[];
  for(const profile of ['default','second']){
   const account=env.ACCOUNTS.get(env.ACCOUNTS.idFromName(profile));const nonce=await account.prepareBrowserLogin();await account.startBrowserLogin(nonce,profile);await account.acceptVerifiedCredential('fixture');
   names.push((await account.connectionIdentity()).connectionName);await account.revoke();
  }
  return Response.json(names)
 }}`} ]});
 try{const driver=await mf.getWorker('driver');const response=await driver.fetch('https://driver.example');assert.equal(response.status,200);assert.deepEqual(await response.json(),[JSON.stringify(['same-tenant','same-user']),JSON.stringify(['https://two.example','same-tenant','same-user'])]);assert.ok(origins.includes('https://one.example')&&origins.includes('https://two.example'))}finally{await mf.dispose()}
});
