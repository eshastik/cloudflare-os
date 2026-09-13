import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalOperationStorage} from './local-operation-storage.ts';
import {ConnectionAuditQueue} from './connection-audit-queue.ts';
function fixture(){
 const rows=new Map<string,unknown>([['mnemosAccountOwner',{tenant:'tenant',user:'human'}]]);let refused='';
 const storage={get:<T>(key:string)=>structuredClone(rows.get(key)) as T|undefined,
  put:(key:string,value:unknown)=>{if(key===refused)throw Error('injected storage failure');rows.set(key,structuredClone(value));},delete:(key:string)=>{rows.delete(key)},
  list:<T>(o:{prefix:string;limit:number;startAfter?:string})=>[...rows].filter(([key])=>key.startsWith(o.prefix)&&(!o.startAfter||key>o.startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,o.limit).map(([key,value])=>[key,structuredClone(value)] as [string,T])};
 const sent:any[]=[];let offline=true;
 const reopen=()=>{const queue=new ConnectionAuditQueue(storage,()=> 's'.repeat(40),async(url,init)=>{
  assert.equal(String(url),'https://operation.test/v1/internal/connection-audit/local-operation');
  const body=String(init?.body);assert(!body.includes('private-content'));const e=JSON.parse(body);
  if(offline)return new Response('',{status:503});sent.push(e);return Response.json({event_id:e.event_id});
 });return {queue,operations:new LocalOperationStorage(storage,queue.capture('https://operation.test',()=>{}))}};
 return {storage,rows,sent,reopen,refuse:(key:string)=>{refused=key},online:()=>{offline=false}};
}
test('all operation families preserve legacy values, canonical hashes and retained delete history',async()=>{
 for(const key of ['corporateTaskCreation:x','corporateUpdate:x','corporateWorkflowCreation:x','driveImportCapture:x',
 'resourceMapCreation:x','resourceMapEdit:x','teamDocumentCreation:x','trackerCreation:x','trackerEdit:x','gitRegistrations','mnemosManagedTaskRequest','mnemosManagedAgentRequest','mnemosTaskHistory:x','voiceUpload:x','voiceBudget:x','voiceCommandBudget:x','telegramVoice:x','telegramVoiceTransfer:x','telegramVoiceSettings:x','telegramDelivery:channel:job:0000000000000001','telegramInbox:123:epoch:update:1']){
  const f=fixture(),legacy={request:'id',source:'private-content',attempted:false};f.storage.put(key,legacy);
  let {operations,queue}=f.reopen();assert.deepEqual(operations.get(key),legacy);
  const changed={...legacy,attempted:true};operations.put(key,changed);
  const record=f.storage.get<any>(key);assert.equal(record.connection_audit.length,1);
  operations.put(key,{attempted:true,source:'private-content',request:'id'});assert.equal(f.storage.get<any>(key).connection_audit.length,1);
  const returned=operations.get<any>(key);returned.source='changed caller';assert.equal(operations.get<any>(key).source,'private-content');
  operations.delete(key);assert.equal(operations.get(key),undefined);assert(!JSON.stringify(f.storage.get(key)).includes('private-content'));
  operations.delete(key);assert.equal(f.storage.get<any>(key).connection_audit.length,2);
  await queue.drain();assert.equal(f.sent.length,0);f.online();({queue,operations}=f.reopen());await queue.drain();
  assert.deepEqual(f.sent.map(e=>e.phase),['saved','deleted']);assert.equal(f.sent[0].after_sha256,f.sent[1].before_sha256);
  assert.equal(operations.get(key),undefined);assert.equal(queue.hasPending(),false);
  operations.put(key,changed);assert.equal(f.storage.get<any>(key).audit_account_id,record.audit_account_id);
  f.storage.put('mnemosAccountOwner',{tenant:'tenant',user:'foreign'});assert.throws(()=>operations.get(key));assert.throws(()=>operations.put(key,legacy));
 }
});
test('queue or canonical failure prevents state transition; bounded history reserves a deletion',()=>{
 const f=fixture(),{operations}=f.reopen(),key='trackerEdit:x';
 for(const fail of ['connectionAuditPending:'+key,key]){f.refuse(fail);assert.throws(()=>operations.put(key,{attempted:false}));assert.equal(f.storage.get(key),undefined);f.refuse('');}
 for(let i=0;i<127;i++)operations.put(key,{attempt:i});assert.throws(()=>operations.put(key,{attempt:128}),/backlog/);
 operations.delete(key);assert.equal(operations.get(key),undefined);assert.equal(f.storage.get<any>(key).connection_audit.length,128);
 assert.throws(()=>operations.put('trackerEdit:bad',new Date()),/Unsupported/);assert.equal(f.storage.get('trackerEdit:bad'),undefined);
});
test('listing unwraps operation records and skips tombstones without hiding later records',()=>{
 const f=fixture(),{operations}=f.reopen();operations.put('driveImportCapture:a',{input:'a'});operations.delete('driveImportCapture:a');
 operations.put('driveImportCapture:b',{input:'b'});f.storage.put('driveImportCapture:c',{input:'c'});
 assert.deepEqual([...operations.list({prefix:'driveImportCapture:',limit:2})],[['driveImportCapture:b',{input:'b'}],['driveImportCapture:c',{input:'c'}]]);
 operations.put('driveImportSourceIndex:p',{cursor:'derived'});assert.deepEqual(f.storage.get('driveImportSourceIndex:p'),{cursor:'derived'});
});

test('Bot ownership is resolved from trusted connection state; routing indexes stay ordinary records',()=>{
 const f=fixture();f.storage.delete('mnemosAccountOwner');
 let owner={tenant:'tenant',user:'human'};
 const operations=new LocalOperationStorage(f.storage,f.storage,()=>owner);
 const key='telegramDelivery:channel:job:0000000000000001';
 operations.put(key,{source:{message:'private-content'},state:'pending'});
 assert.equal(f.storage.get<any>(key).connection_audit[0].owner_id,'human');
 for(const index of ['telegramDelivery:channel:latest','telegramDelivery:channel:message:1','telegramDelivery:channel:pending:1','telegramVoicePending:scope:1','voiceCommandLatest:source']){
  operations.put(index,1);assert.equal(f.storage.get(index),1);
 }
 owner={...owner,user:'foreign'};assert.throws(()=>operations.get(key),/owner changed/);
 assert.throws(()=>operations.put(key,{state:'done'}),/owner changed/);
});

test('Voice upload audit refusal prevents upstream I/O and recovery retains the original request',async()=>{
 const {VoiceTransfer}=await import('./voice-transfer.ts');
 const f=fixture(),bytes=new TextEncoder().encode('private-content');let tickets=0,uploads=0;
 const hash=await crypto.subtle.digest('SHA-256',bytes),checksum=Buffer.from(hash).toString('base64');
 const api={whoAmI:async()=>({}),beginVoiceUpload:async()=>{tickets++;return {upload_id:'upload',url:'https://objects.test/upload',method:'PUT',content_length:bytes.length,checksum_header:'x-amz-checksum-sha256',checksum_value:checksum}},importVoiceSource:async()=>({request_id:'request',project_id:'project',sha256:Buffer.from(hash).toString('hex'),size_bytes:bytes.length})};
 let {operations}=f.reopen();let transfer=new VoiceTransfer(operations,'https://objects.test',async()=>{uploads++;return new Response('ok')});
 f.refuse('connectionAuditPending:voiceUpload:request');
 await assert.rejects(transfer.upload(api as any,'request','project','audio/ogg',bytes));assert.equal(tickets,0);assert.equal(uploads,0);
 f.refuse('');await transfer.upload(api as any,'request','project','audio/ogg',bytes);
 ({operations}=f.reopen());transfer=new VoiceTransfer(operations,'https://objects.test',async()=>{uploads++;return new Response('ok')});
 await transfer.upload(api as any,'request','project','audio/ogg',bytes);assert.equal(tickets,1);assert.equal(uploads,1);
 f.online();await f.reopen().queue.drain();assert.equal(f.sent.length,2);
 assert.equal(f.sent[0].after_sha256,f.sent[1].before_sha256);
});

test('A failed voice execution enqueue rolls back its dedup pointer, job, audit and pending index',async()=>{
 const {TelegramDelivery}=await import('./telegram-delivery.ts');
 for(const failed of ['connectionAuditPending:telegramDelivery:channel:job:0000000000000002','telegramDelivery:channel:job:0000000000000002','telegramDelivery:channel:pending:0000000000000002']){
  const f=fixture(),parent='telegramDelivery:channel:job:0000000000000001';
  f.storage.put(parent,{mode:'voice',voiceReview:{revision:1,hash:'a'.repeat(64),source:'source'}});
  const transaction=<T>(callback:()=>T):T=>{const snapshot=structuredClone(f.rows);try{return callback();}catch(error){f.rows.clear();for(const [key,value] of snapshot)f.rows.set(key,value);throw error;}};
  const audit=f.reopen().queue;
  const operations=new LocalOperationStorage(f.storage,audit.capture('https://operation.test',()=>{}),undefined,transaction);
  const delivery=()=>new TelegramDelivery(operations,'channel',42,{authorize:async()=>{},arm:async()=>{},send:async()=>{throw Error('unexpected send')},client:{} as any});
  const input={update:2,message:2,sender:42,text:'/voice_execute 1 1 '+'a'.repeat(64)};
  const before=structuredClone(f.rows);f.refuse(failed);
  await assert.rejects(delivery().enqueue(input));assert.deepEqual(f.rows,before);
  f.refuse('');await delivery().enqueue(input);
  const saved=operations.get<any>('telegramDelivery:channel:job:0000000000000002');
  assert.equal(saved.mode,'voice_confirm');assert.equal(saved.executeOnConfirmation,true);
  await delivery().enqueue(input);
  assert.equal(f.storage.get<any>('telegramDelivery:channel:job:0000000000000002').connection_audit.length,1);
 }
});
test('Git registration cannot call upstream without an audited attempt and recovers a lost local result',async()=>{
 const {GitRegistrations}=await import('./git-registration.ts');
 const f=fixture();let {operations}=f.reopen(),controller=new GitRegistrations(operations),posts=0;
 const setup={provider:'github' as const,api_base:'https://git.example',name:'private-content'};let id='';
 const result=()=>({...setup,connection_id:id,owner_id:'human',account_id:'upstream',account_login:'owner',revision:1,enabled:true});
 const api={listGitConnections:async()=>({connections:[]}),readGitConnection:async()=>result(),registerGitConnection:async()=>{posts++;f.refuse('gitRegistrations');return result()}};
 id=(await controller.save(api,setup)).id;
 f.refuse('connectionAuditPending:gitRegistrations');await assert.rejects(controller.execute(api,id,'private-content-token',false));assert.equal(posts,0);
 f.refuse('');await assert.rejects(controller.execute(api,id,'private-content-token',false));assert.equal(posts,1);f.refuse('');
 ({operations}=f.reopen());controller=new GitRegistrations(operations);
 await assert.rejects(controller.execute(api,id,'private-content-token',false),/explicitly retry/);assert.equal(posts,1);
 await controller.inspect(api,id);assert.equal((await controller.list(api))[0].completed,true);
 assert(!JSON.stringify([...f.rows.values()]).includes('private-content-token'));
 f.online();const {queue}=f.reopen();await queue.drain();assert.equal(f.sent.length,3);
 assert.equal(new Set(f.sent.map(e=>e.account_id)).size,1);
});
