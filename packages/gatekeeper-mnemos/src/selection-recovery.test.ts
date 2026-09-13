import test from 'node:test';
import assert from 'node:assert/strict';
import {MailSelections} from './mail-selection.ts';
import {CalendarSelections} from './calendar-selection.ts';
import type {MailReadSource,CalendarReadSource} from '@gadgets/workshop-shared/gatekeeper';
const owner={tenant:'tenant',owner:'owner',epoch:'epoch'};
for(const kind of ['mail','calendar'] as const){
 test(kind+': interrupted publication recovers the same ID after fresh authorization',async()=>{
  const rows=new Map<string,unknown>();let fail=true,revoked=false,ownerRevoked=false;
  const storage={get:<T>(key:string)=>rows.get(key) as T|undefined,put:(key:string,value:unknown)=>{if(fail&&key.startsWith(kind+'Selection:'))throw Error('fixture second write');rows.set(key,value);},delete:(key:string)=>{rows.delete(key)}};
  const source={validate:async()=>{if(revoked)throw Error('source revoked')},metadata:async()=>({provider:'google',query:'label:team',calendar_id:'calendar',title:'Team',time_zone:'UTC'})};
  const prepare=()=>kind==='mail'?new MailSelections(storage).prepare(owner,'project','request','source',source as Fetcher<MailReadSource>,validate):new CalendarSelections(storage).prepare(owner,'project','request','source',source as Fetcher<CalendarReadSource>,validate);
  async function validate(){if(ownerRevoked)throw Error('owner revoked')}
  await assert.rejects(prepare(),/second write/);assert.equal(rows.size,1);
  const frozen=[...rows.values()][0] as {id:string};fail=false;
  revoked=true;await assert.rejects(prepare(),/source revoked/);assert.equal(rows.size,1);revoked=false;
  ownerRevoked=true;await assert.rejects(prepare(),/owner revoked/);assert.equal(rows.size,1);ownerRevoked=false;
  const [a,b]=await Promise.all([prepare(),prepare()]);assert.equal(a.selection_id,frozen.id);assert.deepEqual(a,b);assert.equal(rows.size,2);
  const store=kind==='mail'?new MailSelections(storage):new CalendarSelections(storage);
  assert.equal((await store.resolve(a.selection_id,{...owner,project:'project',request:'request'},()=>owner.epoch)).id,frozen.id);
  const address=kind+'Selection:'+frozen.id;const good=rows.get(address) as object;rows.set(address,{...good,owner:'foreign'});
  await assert.rejects(prepare(),/changed/);assert.equal((rows.get(address) as {owner:string}).owner,'foreign');
 });
}

for(const kind of ['page','reply'] as const){
 test(kind+': interrupted mail coordinate write is repaired without replacing its identity',async()=>{
  const {MailPages}=await import('./mail-pages.ts');const {MailReplies}=await import('./mail-replies.ts');
  const rows=new Map<string,unknown>();let fail=true;const prefix=kind==='page'?'mailPage:':'mailReply:';
  const storage={get:<T>(key:string)=>rows.get(key) as T|undefined,put:(key:string,value:unknown)=>{if(fail&&key.startsWith(prefix))throw Error('fixture coordinate write');rows.set(key,value);},delete:(key:string)=>{rows.delete(key)}};
  const scope={...owner,selection:'selection'},input={limit:2};
  const message={message_id:'message',internet_message_id:'<message@example.test>',subject:'Team'};
  const save=()=>kind==='page'?new MailPages(storage).save(scope,input,'provider-cursor'):new MailReplies(storage).capture(scope,message);
  await assert.rejects(save(),/coordinate write/);assert.equal(rows.size,1);const frozen=[...rows.values()][0] as {id:string};fail=false;
  await save();assert.equal(rows.size,2);assert.equal((rows.get(prefix+frozen.id) as {id:string}).id,frozen.id);
  if(kind==='page')assert.equal(new MailPages(storage).resolve(scope,{...input,cursor:frozen.id}),'provider-cursor');
  else assert.equal(new MailReplies(storage).resolve(scope,frozen.id).message_id,'message');
  rows.set(prefix+frozen.id,{id:'foreign'});await assert.rejects(save(),/changed/);assert.deepEqual(rows.get(prefix+frozen.id),{id:'foreign'});
 });
}
