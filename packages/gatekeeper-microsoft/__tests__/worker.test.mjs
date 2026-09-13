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
  if(path==='/calendars')return user.listCalendars();
  if(path==='/calendar-select'){const selected=await user.getCalendarReadSource('calendar-id');this.ctx.storage.kv.put('calendar',selected.source);return {selected:true}}
  if(path==='/calendar-writer'){const selected=await user.getCalendarWriteSource('calendar-id');this.ctx.storage.kv.put('calendar-writer',selected.source);return {selected:true}}
  if(path==='/calendar-create')return this.ctx.storage.kv.get('calendar-writer').create({title:'Meeting',start:'2026-09-11T10:00:00.000Z',end:'2026-09-11T11:00:00.000Z',description:'Notes',location:'Room',attendees:[]});
  if(path==='/calendar-read')return this.ctx.storage.kv.get('calendar').readWindow({time_min:'2026-09-10T00:00:00Z',time_max:'2026-09-12T00:00:00Z',limit:2});
  if(path==='/folders')return user.listMailFolders('');
  if(path==='/select'){const selected=await user.getMailReadSource('folder:inbox-id');this.ctx.storage.kv.put('source',selected.source);return {selected:true}}
  if(path==='/sender'){const selected=await user.getMailSendSource('folder:inbox-id');this.ctx.storage.kv.put('sender',selected.source);return {selected:true}}
  if(path==='/send')return this.ctx.storage.kv.get('sender').send({to:['recipient@example.test'],subject:'Approved',body:'Body'});
  if(path==='/read'){const result=await this.ctx.storage.kv.get('source').readSelection({limit:2});return {messages:JSON.parse(result.messages_json),provider:result.provider}}
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
}catch(error){return new Response(error.message,{status:409})}}}`;
test('real Worker OAuth completion retries, persisted account/source survives restart, and revoke blocks reads',async()=>{
 const persist=await mkdtemp(join(tmpdir(),'microsoft-worker-'));let exchanges=0,identity='123',downloads=0,authMode='ok',sendScope=false,sends=0,creates=0;
 const options={resourcePersistencePath:persist,workers:[{
  name:'harness',modules:true,script:harness,compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage'],
  durableObjects:{STORE:{className:'Store',useSQLite:true}},serviceBindings:{VENDOR:{name:'microsoft',entrypoint:'GatekeeperVendor'},HTTP:'microsoft'},
 },{
  name:'microsoft',modules:true,scriptPath:fileURLToPath(new URL('../dist/microsoft.js',import.meta.url)),compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage'],
  bindings:{BASE_URL:'https://os.example/microsoft',CLIENT_ID:'client',CLIENT_SECRET:'fixture-secret',TENANT_ID:'organizations'},durableObjects:{ACCOUNTS:{className:'UserAccount',useSQLite:true}},
  outboundService:async request=>{
   const url=new URL(request.url);
   if(url.hostname==='login.microsoftonline.com'){
    exchanges++;assert.equal(request.method,'POST');
    return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',token_type:'Bearer',expires_in:3600,scope:'User.Read Mail.Read Calendars.Read'+(sendScope?' Mail.Send Calendars.ReadWrite':'')});
   }
   if(url.pathname==='/v1.0/me/calendars/calendar-id/events'){assert.equal(request.method,'POST');assert.equal((await request.json()).subject,'Meeting');creates++;return Response.json({id:'event-id'},{status:201});}
   if(url.pathname==='/v1.0/me/sendMail'){assert.equal(url.hostname,'graph.microsoft.com');assert.equal(request.method,'POST');assert.equal(request.headers.get('Authorization'),'Bearer fixture-access');sends++;return new Response(null,{status:202});}
   assert.equal(url.hostname,'graph.microsoft.com');assert.equal(request.method,'GET');
   assert.equal(request.headers.get('Authorization'),'Bearer fixture-access');
   if(authMode==='transient')return new Response(null,{status:503});
   if(authMode==='revoked')return new Response(null,{status:401});
   if(url.pathname==='/v1.0/me')return Response.json({id:identity,displayName:'Example'});
   if(url.pathname==='/v1.0/me/calendars')return Response.json({value:[{id:'calendar-id',name:'Team'}]});
   if(url.pathname==='/v1.0/me/calendars/calendar-id')return Response.json({id:'calendar-id',name:'Team'});
   if(url.pathname==='/v1.0/me/calendars/calendar-id/calendarView')return Response.json({value:[{id:'event',subject:'Meeting',body:{contentType:'text',content:'Notes'},start:{dateTime:'2026-09-11T10:00:00',timeZone:'UTC'},end:{dateTime:'2026-09-11T11:00:00',timeZone:'UTC'},originalStartTimeZone:'UTC',originalEndTimeZone:'UTC',isAllDay:false,isCancelled:false,type:'singleInstance'}]});
   if(url.pathname==='/v1.0/me/mailFolders')return Response.json({value:[{id:'inbox-id',displayName:'Inbox',childFolderCount:0}]});
   if(url.pathname==='/v1.0/me/mailFolders/inbox-id')return Response.json({id:'inbox-id',displayName:'Inbox'});
   if(url.pathname==='/v1.0/me/mailFolders/inbox-id/messages')return Response.json({value:[{id:'message-id',parentFolderId:'inbox-id',changeKey:'v1'}]});
   assert.equal(url.pathname,'/v1.0/me/messages/message-id');downloads++;
   return Response.json({id:'message-id',parentFolderId:'inbox-id',changeKey:'v1',conversationId:'thread',receivedDateTime:'2026-09-11T00:00:00Z',subject:'Fixture',from:{emailAddress:{address:'sender@example.test'}},toRecipients:[],ccRecipients:[],body:{contentType:'text',content:'Fixture mail'},hasAttachments:false});
  }
 }]};
 // Forward the public callback through an actual service binding, preserving its public URL.
 options.workers[0].script=harness.replace(" const path=new URL(request.url).pathname;"," const path=new URL(request.url).pathname;\n if(path.startsWith('/microsoft/'))return env.HTTP.fetch(request);");
 let mf=new Miniflare(options);
 const call=path=>mf.dispatchFetch('https://os.example'+path);
 const authorize=async start=>{
  const initial=await mf.dispatchFetch(start,{redirect:'manual'});assert.equal(initial.status,302);
  const auth=new URL(initial.headers.get('location'));assert.equal(auth.hostname,'login.microsoftonline.com');
  const callback=new URL('https://os.example/microsoft/oauth');callback.search=new URLSearchParams({code:'fixture-code',state:auth.searchParams.get('state')});return callback.toString();
 };
 try{
  const start=await (await call('/connect')).json();const callback=await authorize(start.url);
  assert.equal((await mf.dispatchFetch(callback)).status,400);assert.equal(exchanges,1);
  assert.equal((await mf.dispatchFetch(callback)).status,200);assert.equal(exchanges,1,'Completion retry must not exchange code again');
  assert.equal((await (await call('/describe')).json()).uniqueName,'123');
  assert.deepEqual(await (await call('/folders')).json(),{folders:[{id:'inbox-id',name:'Inbox',hasChildren:false}],truncated:false});
  {const selected=await call('/select');assert.equal(selected.status,200,await selected.text());}
  const first=await (await call('/read')).json();assert.equal(first.provider,'microsoft');assert.equal(first.messages[0].body,'Fixture mail');
  assert.deepEqual(await (await call('/calendars')).json(),{calendars:[{id:'calendar-id',name:'Team'}],truncated:false});
  assert.equal((await call('/calendar-select')).status,200);
  const calendar=await (await call('/calendar-read')).json();assert.equal(JSON.parse(calendar.events_json)[0].summary,'Meeting');
  assert.equal((await call('/calendar-writer')).status,409);assert.equal(creates,0);
  assert.equal((await call('/sender')).status,409);assert.equal(sends,0);
  await mf.dispose();mf=new Miniflare(options);
  assert.deepEqual(await (await call('/calendar-read')).json(),calendar);
  assert.deepEqual(await (await call('/read')).json(),first);assert.equal(downloads,2);
  assert.equal((await call('/revoke')).status,200);assert.equal((await call('/read')).status,409);assert.equal(downloads,2);assert.equal((await call('/folders')).status,409);assert.equal((await call('/calendars')).status,409);assert.equal((await call('/calendar-read')).status,409);
  sendScope=true;
  identity='999';let again=await (await call('/reconnect')).json();assert.equal((await mf.dispatchFetch(await authorize(again.url))).status,400);
  identity='123';again=await (await call('/reconnect')).json();assert.equal((await mf.dispatchFetch(await authorize(again.url))).status,200);
  assert.equal((await call('/read')).status,409,'Old source cannot revive after reconnect');
  assert.equal((await call('/calendar-read')).status,409);assert.equal((await call('/calendar-select')).status,200);assert.equal((await call('/calendar-read')).status,200);
  {const selected=await call('/select');assert.equal(selected.status,200,await selected.text());}assert.equal((await call('/read')).status,200);
  assert.equal((await (await call('/counts')).json()).restored,true);
  assert.equal((await call('/calendar-writer')).status,200);
  assert.equal((await call('/sender')).status,200);await mf.dispose();mf=new Miniflare(options);
  assert.deepEqual(await (await call('/calendar-create')).json(),{event_id:'event-id'});assert.equal(creates,1);
  assert.deepEqual(await (await call('/send')).json(),{accepted:true});assert.equal(sends,1);
  authMode='transient';assert.equal((await call('/read')).status,409);assert.equal((await call('/describe')).status,200);assert.equal((await (await call('/counts')).json()).expired,false);
  authMode='ok';assert.equal((await call('/read')).status,200);
  authMode='revoked';assert.equal((await call('/read')).status,409);
  await call('/revoke');assert.equal((await call('/calendar-create')).status,409);assert.equal(creates,1);assert.equal((await call('/send')).status,409);assert.equal(sends,1);


 }finally{await mf.dispose();await rm(persist,{recursive:true,force:true});}
});
