import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MnemosAccount,type AccountStorage} from './account-session.ts';
const human={subject:{tenant_id:'org',user_id:'human'}};
function storage():AccountStorage{const map=new Map<string,unknown>();return {get:<T>(key:string)=>structuredClone(map.get(key)) as T|undefined,put:(key,value)=>{map.set(key,structuredClone(value))},delete:key=>{map.delete(key)}}}
test('saved cancellation survives new account/session, stale tabs cannot replace pending terms, receipt replay has no HTTP',async()=>{
 const store=storage();let cancels=0;
 const fetcher:typeof fetch=async(url,init)=>{
  if(String(url).endsWith('/whoami'))return Response.json(human);
  assert(String(url).endsWith('/absence-cancellation'));
  assert.deepEqual(JSON.parse(String(init?.body)),{expected_revision:2});cancels++;
  if(cancels===1)throw new Error('lost reply');
  return Response.json({request_id:'source',revision:3,completed:true});
 };
 let account=new MnemosAccount(store,'https://memory.example',fetcher);await account.connect('human-token');let session=account.session();
 const record=await session.saveAbsenceAction('project','source',{kind:'cancel',revision:2},'');
 await assert.rejects(session.saveAbsenceAction('project','source',{kind:'cancel',revision:4},''));
 await assert.rejects(session.executeSavedAbsenceAction('source',record.id));
 account=new MnemosAccount(store,'https://memory.example',fetcher);session=account.session();
 assert.deepEqual(await session.readSavedAbsenceAction('source'),record);
 const completed=await session.executeSavedAbsenceAction('source',record.id);assert(completed.receipt);assert.equal(cancels,2);
 assert.deepEqual(await session.executeSavedAbsenceAction('source',record.id),completed);assert.equal(cancels,2);
 await assert.rejects(session.saveAbsenceAction('project','source',{kind:'cancel',revision:4},''));
 const next=await session.saveAbsenceAction('project','source',{kind:'cancel',revision:4},record.id);assert.notEqual(next.id,record.id);
 await assert.rejects(session.executeSavedAbsenceAction('source',record.id));assert.equal(cancels,2);
 account.disconnect();await assert.rejects(session.readSavedAbsenceAction('source'));await assert.rejects(session.executeSavedAbsenceAction('source',next.id));
});

test('disconnect while cancellation is in flight leaves retry terms and suppresses receipt',async()=>{
 let finish!:(r:Response)=>void;
 const account=new MnemosAccount(storage(),'https://memory.example',async url=>String(url).endsWith('/whoami')?Response.json(human):new Promise(resolve=>{finish=resolve}));
 await account.connect('human-token');const session=account.session();
 const record=await session.saveAbsenceAction('project','source',{kind:'cancel',revision:2},'');
 const pending=session.executeSavedAbsenceAction('source',record.id);await new Promise(resolve=>setTimeout(resolve,0));account.disconnect();
 finish(Response.json({request_id:'source',revision:3,completed:true}));await assert.rejects(pending);
});
