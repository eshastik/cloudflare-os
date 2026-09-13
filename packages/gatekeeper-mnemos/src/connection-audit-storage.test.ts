import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ConnectionAuditStorage} from './connection-audit-storage.ts';

for(const protocol of ['imap','caldav','webdav'] as const){
 test(protocol+': state and evidence fail together, removal keeps no credential',()=>{
  const data=new Map<string,unknown>();let refuse=false;
  const raw={get:<T>(key:string)=>structuredClone(data.get(key)) as T|undefined,
   put:(key:string,value:unknown)=>{if(refuse)throw Error('fixture storage refusal');data.set(key,structuredClone(value));},delete:(key:string)=>{data.delete(key);}};
  const key=protocol+'Account:'+crypto.randomUUID();
  const record={id:key.split(':')[1],owner:{tenant:'tenant',owner:'human',epoch:'private-epoch'},generation:crypto.randomUUID(),enabled:false,credential:{username:'private-name',password:'private-password'},serverKey:'private-server',mailbox:'private-folder'};
  let storage=new ConnectionAuditStorage(raw,protocol);
  refuse=true;assert.throws(()=>storage.put(key,record));assert.equal(data.has(key),false);
  refuse=false;storage.put(key,record);
  const initial=structuredClone(data.get(key));
  refuse=true;assert.throws(()=>storage.put(key,{...record,enabled:true}));assert.deepEqual(data.get(key),initial);
  refuse=false;storage.put(key,{...record,enabled:true});
  const enabled=structuredClone(data.get(key));
  refuse=true;assert.throws(()=>storage.delete(key));assert.deepEqual(data.get(key),enabled);
  refuse=false;storage.delete(key);
  storage=new ConnectionAuditStorage(raw,protocol);assert.equal(storage.get(key),undefined);
  const tombstone=raw.get<{connection_audit:Array<{phase:string;event_id:string}>}>(key)!;
  assert.deepEqual(tombstone.connection_audit.map(e=>e.phase),['connecting','enabled','removed']);
  assert.equal(new Set(tombstone.connection_audit.map(e=>e.event_id)).size,3);
  assert.equal(JSON.stringify(tombstone).includes('private-'),false);
  storage.delete(key);assert.deepEqual(data.get(key),tombstone);
  assert.throws(()=>storage.put(key,{...record,owner:{...record.owner,owner:'foreign'}}),/owner changed/);
  assert.deepEqual(data.get(key),tombstone);
  storage.put(key,{...record,generation:crypto.randomUUID()});storage.discard(key);
  assert.deepEqual(raw.get<typeof tombstone>(key)!.connection_audit.map(e=>e.phase),['connecting','enabled','removed','connecting','failed']);
 });
 test(protocol+': legacy removal records only the observed removal',()=>{
  const data=new Map<string,unknown>();const raw={get:<T>(key:string)=>data.get(key) as T|undefined,put:(key:string,value:unknown)=>{data.set(key,value);},delete:(key:string)=>{data.delete(key);}};
  const key=protocol+'Account:'+crypto.randomUUID();raw.put(key,{id:key.split(':')[1],owner:{tenant:'tenant',owner:'human',epoch:'old'},generation:'old',enabled:true,credential:{password:'old-secret'}});
  new ConnectionAuditStorage(raw,protocol).delete(key);
  const events=raw.get<{connection_audit:Array<{phase:string}>}>(key)!.connection_audit;
  assert.deepEqual(events.map(e=>e.phase),['removed']);assert.equal(JSON.stringify(data.get(key)).includes('old-secret'),false);
 });
}
