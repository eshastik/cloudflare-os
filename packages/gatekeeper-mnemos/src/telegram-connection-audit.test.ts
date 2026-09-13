import {test} from 'node:test';import assert from 'node:assert/strict';
import {saveTelegramConnection} from './telegram-connection-audit.ts';
test('Telegram transition evidence is atomic, retry-stable, secret-free and survives removal',()=>{
 const values=new Map<string,unknown>();let fail=false;
 const storage={get:<T>(key:string)=>structuredClone(values.get(key)) as T|undefined,put:<T>(key:string,value:T)=>{if(fail)throw Error('write failed');values.set(key,structuredClone(value));},delete:(key:string)=>{values.delete(key);}};
 const owner={tenant:'tenant',user:'human'},record={account:'private-account',request:'private-request',binding:'private-binding',accountEpoch:'private-epoch',token:'private-token',secret:'private-webhook-secret',ready:false,pairing:{epoch:'pair-epoch',code:'private-code'}};
 saveTelegramConnection(storage,record,owner);const original=structuredClone(values.get('connection'));
 fail=true;assert.throws(()=>saveTelegramConnection(storage,{...record,ready:true},owner));assert.deepEqual(values.get('connection'),original);fail=false;
 saveTelegramConnection(storage,record,owner);assert.deepEqual(values.get('connection'),original);
 const ready={...record,ready:true};saveTelegramConnection(storage,ready,owner);
 const candidate={...ready,pairing:{...ready.pairing,candidate:42}};
 saveTelegramConnection(storage,candidate,owner);saveTelegramConnection(storage,candidate,owner);
 saveTelegramConnection(storage,{...ready,token:''},owner);
 const saved=storage.get<{connection_audit:Array<{phase:string}>;token:string}>('connection')!;
 assert.equal(saved.token,'');assert.deepEqual(saved.connection_audit.map(e=>e.phase),['connecting','ready','pairing-candidate','removed']);assert.ok(!JSON.stringify(saved.connection_audit).includes('private-'));
 assert.throws(()=>saveTelegramConnection(storage,ready,{...owner,user:'other'}),/owner changed/);
 // A stale caller must not reintroduce events already acknowledged by delivery.
 const current=storage.get<Record<string,unknown>>('connection')!;storage.put('connection',{...current,connection_audit:[]});
 saveTelegramConnection(storage,{...ready,token:''},owner);assert.deepEqual(storage.get<{connection_audit:unknown[]}>('connection')!.connection_audit,[]);
});

test('An offline audit backlog blocks new setup but still permits disabling ingress and its grant',()=>{
 const values=new Map<string,unknown>();
 const storage={get:<T>(key:string)=>structuredClone(values.get(key)) as T|undefined,put:<T>(key:string,value:T)=>{values.set(key,structuredClone(value));},delete:(key:string)=>{values.delete(key);}};
 const owner={tenant:'tenant',user:'human'};
 const record={account:'account',request:'request',binding:'binding',accountEpoch:'epoch',token:'secret',ready:true,pairing:{epoch:'pair'},channel:{id:'channel',registered:true,disabled:false}};
 for(let i=0;i<124;i++)saveTelegramConnection(storage,{...record,request:String(i)},owner);
 const before=structuredClone(values.get('connection'));
 assert.throws(()=>saveTelegramConnection(storage,{...record,request:'next'},owner),/backlog full/);
 assert.deepEqual(values.get('connection'),before);
 const removed={...record,request:'123',token:''};
 saveTelegramConnection(storage,removed,owner);
 saveTelegramConnection(storage,{...removed,channel:{...record.channel,registered:false,disabled:true}},owner);
 const saved=storage.get<typeof record&{connection_audit:Array<{phase:string}>}>('connection')!;
 assert.equal(saved.token,'');assert.equal(saved.channel.disabled,true);
 assert.equal(saved.connection_audit.length,126);
 assert.deepEqual(saved.connection_audit.slice(-2).map(e=>e.phase),['removed','revoked']);
});
