import test from 'node:test';import assert from 'node:assert/strict';
import {MailSelections} from './mail-selection.ts';import {CalendarSelections} from './calendar-selection.ts';import {ConnectionAuditQueue} from './connection-audit-queue.ts';
import type {MailReadSource,CalendarReadSource} from '@gadgets/workshop-shared/gatekeeper';
for(const kind of ['mail','calendar'] as const)test(kind+': first durable selection delivers despite failed second write and never duplicates on recovery',async()=>{
 const rows=new Map<string,unknown>();let fail=true;const events:unknown[]=[];
 const raw={get:<T>(key:string)=>rows.get(key) as T|undefined,put:(key:string,value:unknown)=>{if(fail&&key.startsWith(kind+'Selection:'))throw Error('fixture second write');rows.set(key,value)},delete:(key:string)=>{rows.delete(key)},list:<T>(o:{prefix:string;limit:number;startAfter?:string})=>[...rows].filter(([k])=>k.startsWith(o.prefix)&&(!o.startAfter||k>o.startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,o.limit) as [string,T][]};
 const queue=new ConnectionAuditQueue(raw,()=> 's'.repeat(40),async(url,init)=>{assert(String(url).endsWith('/'+kind+'-selection'));const e=JSON.parse(String(init?.body));events.push(e);return Response.json({event_id:e.event_id})});
 const storage=queue.capture('https://memory.example',()=>{}),owner={tenant:'tenant',owner:'human',epoch:'private-epoch'};
 const source={metadata:async()=>({provider:'google',query:'private-query',calendar_id:'private-calendar',title:'private-title',time_zone:'UTC'}),validate:async()=>{}};
 const prepare=()=>kind==='mail'?new MailSelections(storage).prepare(owner,'project','request','private-capability',source as Fetcher<MailReadSource>,async()=>{}):new CalendarSelections(storage).prepare(owner,'project','request','private-capability',source as Fetcher<CalendarReadSource>,async()=>{});
 await assert.rejects(prepare(),/second write/);assert.equal(queue.hasPending(),true);await queue.drain();assert.equal(events.length,1);assert.equal(queue.hasPending(),false);
 assert(!JSON.stringify(events).includes('private-'));assert.equal((events[0] as {project_id:string}).project_id,'project');
 fail=false;const a=await prepare(),b=await prepare();assert.deepEqual(a,b);assert.equal(a.selection_id,(events[0] as {account_id:string}).account_id);
 await queue.drain();assert.equal(events.length,1);
});
