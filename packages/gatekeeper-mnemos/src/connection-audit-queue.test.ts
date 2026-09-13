import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionAuditStorage} from './connection-audit-storage.ts';
import {ConnectionAuditQueue} from './connection-audit-queue.ts';
function fixture(){
 const rows=new Map<string,unknown>();let refuse='';
 const storage={get:<T>(key:string)=>structuredClone(rows.get(key)) as T|undefined,put:(key:string,value:unknown)=>{if(key===refuse)throw Error('fixture failure');rows.set(key,structuredClone(value));},delete:(key:string)=>{rows.delete(key);},list:<T>(o:{prefix:string;limit:number;startAfter?:string})=>[...rows].filter(([k])=>k.startsWith(o.prefix)&&(!o.startAfter||k>o.startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,o.limit).map(([k,v])=>[k,structuredClone(v)] as [string,T])};
 const record={id:crypto.randomUUID(),owner:{tenant:'tenant',owner:'human',epoch:'private-epoch'},generation:crypto.randomUUID(),enabled:false,credential:{password:'private-password'}};
 return {rows,storage,record,key:'imapAccount:'+record.id,refuse:(key:string)=>{refuse=key}};
}
test('pinning, exact ack, restart, lost local ack and concurrent append preserve events',async()=>{
 const f=fixture();let allowed=true,mode='offline',calls=0;const sent:string[]=[];
 let account:ConnectionAuditStorage;
 const create=()=>new ConnectionAuditQueue(f.storage,origin=>{assert.equal(origin,'https://original.test');if(!allowed)throw Error('origin removed');return 's'.repeat(40);},async(url,init)=>{
  calls++;assert.equal(String(url),'https://original.test/v1/internal/connection-audit/imap');assert.equal(init?.redirect,'manual');assert(init?.signal);const bytes=String(init?.body);sent.push(bytes);const event=JSON.parse(bytes);
  if(mode==='offline')return new Response('',{status:503});
  if(mode==='wrong')return Response.json({event_id:'wrong'});
  if(mode==='extra')return Response.json({event_id:event.event_id,extra:true});
  if(mode==='large')return new Response(' '.repeat(2049));
  if(mode==='concurrent')account.put(f.key,{...f.record,enabled:true});
  if(mode==='local-failure')f.refuse(f.key);
  return Response.json({event_id:event.event_id});
 });
 let queue=create();account=new ConnectionAuditStorage(queue.capture('https://original.test',()=>{}),'imap');account.put(f.key,f.record);
 for(mode of ['offline','wrong','extra','large']){assert.equal(await queue.drain(),true);assert.equal((f.storage.get<any>(f.key)).connection_audit.length,1)}
 allowed=false;const before=calls;await queue.drain();assert.equal(calls,before);allowed=true;
 // Reopening with a different current origin must retain the original destination.
 queue=create();account=new ConnectionAuditStorage(queue.capture('https://new.test',()=>{}),'imap');mode='concurrent';await queue.drain();
 assert.deepEqual(f.storage.get<any>(f.key).connection_audit.map((e:any)=>e.phase),['enabled']);
 mode='local-failure';await queue.drain();f.refuse('');assert.equal(f.storage.get<any>(f.key).connection_audit.length,1);
 mode='ok';queue=create();await queue.drain();assert.equal(sent.at(-1),sent.at(-2));assert.equal(queue.hasPending(),false);
 account.delete(f.key);assert(!JSON.stringify(f.storage.get(f.key)).includes('private-'));await queue.drain();assert.equal(queue.hasPending(),false);
 assert.deepEqual(f.storage.get<any>(f.key).connection_audit,[]);
 assert.throws(()=>account.put(f.key,{...f.record,owner:{...f.record.owner,owner:'foreign'}}),/owner changed/);
});
test('queue refusal fences canonical state; bounded rounds serve healthy accounts',async()=>{
 const f=fixture();const calls:string[]=[];
 const queue=new ConnectionAuditQueue(f.storage,()=> 's'.repeat(40),async(_url,init)=>{const e=JSON.parse(String(init?.body));calls.push(e.account_id);return e.account_id===f.record.id?new Response('',{status:503}):Response.json({event_id:e.event_id})});
 const account=new ConnectionAuditStorage(queue.capture('https://original.test',()=>{}),'imap');
 f.refuse('connectionAuditPending:'+f.key);assert.throws(()=>account.put(f.key,f.record));assert.equal(f.rows.has(f.key),false);f.refuse('');
 account.put(f.key,f.record);
 for(let i=0;i<8;i++){const r={...f.record,id:crypto.randomUUID()};account.put('imapAccount:'+r.id,r)}
 await queue.drain();assert.equal(calls.length,5);await queue.drain();assert.equal(calls.length,9);
 assert.equal([...f.rows.keys()].filter(k=>k.startsWith('connectionAuditPending:')).length,1);
});
test('offline backlog bounds new connections while reserving removal and strips secrets',()=>{
 const f=fixture(),account=new ConnectionAuditStorage(f.storage,'imap');
 for(let i=0;i<125;i++)account.put(f.key,{...f.record,generation:crypto.randomUUID()});
 assert.throws(()=>account.put(f.key,f.record),/backlog full/);account.put(f.key,{...f.record,enabled:true});account.delete(f.key);
 assert.equal(f.storage.get<any>(f.key).connection_audit.length,127);assert(!JSON.stringify(f.storage.get(f.key)).includes('private-'));
});

test('account history survives disconnect and restart without exporting credentials', async () => {
 const {MnemosAccount}=await import('./account-session.ts');
 const f=fixture();let offline=true;const sent:any[]=[];
 const create=()=>new ConnectionAuditQueue(f.storage,()=> 's'.repeat(40),async(url,init)=>{
  assert.equal(String(url),'https://account.test/v1/internal/connection-audit/account');
  const body=String(init?.body);assert(!body.includes('private-token'));
  const e=JSON.parse(body);if(offline)return new Response('',{status:503});
  sent.push(e);return Response.json({event_id:e.event_id});
 });
 let queue=create();let account=new MnemosAccount(queue.capture('https://account.test',()=>{}),'https://account.test',async()=>Response.json({subject:{tenant_id:'tenant',user_id:'human'}}));
 await account.connect('private-token');account.disconnect();
 assert.equal(f.storage.get<any>('mnemosCredential').token,'');
 assert.deepEqual(f.storage.get<any>('mnemosCredential').connection_audit.map((e:any)=>e.phase),['connected','disconnected']);
 assert.equal(await queue.drain(),true);
 queue=create();offline=false;assert.equal(await queue.drain(),false);
 assert.deepEqual(sent.map(e=>e.phase),['connected','disconnected']);
 assert.equal(sent[0].account_id,sent[1].account_id);
 assert(sent.every(e=>e.owner_id==='human'&&e.tenant_id==='tenant'));
 const saved=f.storage.get<any>('mnemosCredential');assert.equal(saved.token,'');assert.deepEqual(saved.connection_audit,[]);
 account=new MnemosAccount(queue.capture('https://account.test',()=>{}),'https://account.test',async()=>Response.json({subject:{tenant_id:'tenant',user_id:'other'}}));
 await assert.rejects(account.connect('foreign-token'));assert.deepEqual(f.storage.get('mnemosCredential'),saved);
});

test('recovery keys and their event survive write failures, retry delivery and legacy reads',async()=>{
 const {recoveryKey,recoveryKeyNames}=await import('./recovery-key.ts');
 for(const purpose of ['native-creation-key','office-update-key'] as const){
  const f=fixture(),name=recoveryKeyNames[purpose];f.storage.put('mnemosAccountOwner',{tenant:'tenant',user:'human'});
  let offline=true;const received:any[]=[];
  const reopen=()=>new ConnectionAuditQueue(f.storage,()=> 's'.repeat(40),async(url,init)=>{
   assert.equal(String(url),'https://recovery.test/v1/internal/connection-audit/'+purpose);
   const e=JSON.parse(String(init?.body));assert.deepEqual(Object.keys(e).sort(),['account_id','event_id','observed_at','owner_id','phase','protocol','tenant_id']);
   if(offline)return new Response('',{status:503});received.push(e);return Response.json({event_id:e.event_id});
  });
  let queue=reopen();const storage=queue.capture('https://recovery.test',()=>{});
  for(const failing of ['connectionAuditPending:'+name,name]){
   f.refuse(failing);assert.throws(()=>recoveryKey(storage,purpose,true));assert.equal(f.storage.get(name),undefined);f.refuse('');
  }
  const key=recoveryKey(storage,purpose,true),saved=f.storage.get<any>(name);
  assert.deepEqual(recoveryKey(storage,purpose,true),key);assert.equal(saved.connection_audit.length,1);
  await queue.drain();assert.equal(received.length,0);
  offline=false;queue=reopen();await queue.drain();assert.equal(received.length,1);assert.equal(received[0].event_id,saved.connection_audit[0].event_id);
  assert.equal(received[0].owner_id,'human');assert.equal(received[0].phase,'created');
  assert.deepEqual(recoveryKey(storage,purpose,false),key);assert.equal(queue.hasPending(),false);
  f.storage.put('mnemosAccountOwner',{tenant:'tenant',user:'foreign'});assert.throws(()=>recoveryKey(storage,purpose,false));
  const legacy=fixture();legacy.storage.put(name,key);assert.deepEqual(recoveryKey(legacy.storage,purpose,true),key);assert(legacy.storage.get(name) instanceof Uint8Array);assert.equal(legacy.rows.size,1);
 }
});
