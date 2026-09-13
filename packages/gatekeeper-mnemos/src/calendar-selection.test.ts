import test from 'node:test';
import assert from 'node:assert/strict';
import {CalendarSelections} from './calendar-selection.ts';
import type {CalendarReadSource} from '@gadgets/workshop-shared/gatekeeper';
function fixture() {
 const records = new Map<string,unknown>();
 const storage = {get:<T>(key:string)=>records.get(key) as T|undefined, put:<T>(key:string,value:T)=>{records.set(key,value);},delete:(key:string)=>{records.delete(key);}};
 let live=true;
 const source={metadata:async()=>({provider:'google',calendar_id:'calendar',title:'Team',time_zone:'Europe/Moscow'}),validate:async()=>{if(!live)throw Error('revoked');}} as Fetcher<CalendarReadSource>;
 return {records,store:new CalendarSelections(storage),source,revoke:()=>{live=false;}};
}
const owner={tenant:'tenant',owner:'owner',epoch:'epoch'};
test('Calendar preparation persists one source and exact concurrent retries converge',async()=>{
 const f=fixture();const args=[owner,'project','request','source-key',f.source,async()=>{}] as const;
 const [a,b]=await Promise.all([f.store.prepare(...args),f.store.prepare(...args)]);
 assert.deepEqual(a,b);assert.equal(f.records.size,2);assert.deepEqual(await f.store.prepare(...args),a);
 const stored=f.records.get('calendarSelection:'+a.selection_id) as {source:unknown};assert.equal(stored.source,f.source);
 await assert.rejects(f.store.prepare(owner,'project','request','other-source',f.source,async()=>{}),/changed/);
 f.revoke();await assert.rejects(f.store.prepare(...args),/revoked/);
});
test('Owner or source revocation during preparation stores no selection',async()=>{
 for(const mode of ['owner','source']){
  const f=fixture();let checks=0;
  const validate=async()=>{checks++;if(mode==='owner'&&checks>1)throw Error('owner revoked');if(mode==='source')f.revoke();};
  await assert.rejects(f.store.prepare(owner,'project','request','source-key',f.source,validate),/revoked/);assert.equal(f.records.size,0);
 }
});
