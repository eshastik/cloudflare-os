import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const built=await build({entryPoints:['src/calendar-drafts.ts'],bundle:true,platform:'node',format:'esm',write:false});const {CalendarDrafts}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const context={tenant:'tenant',owner:'owner',epoch:'epoch',connection:'calendar',agent:'agent'};
const content={title:'Meeting',start:'2026-09-11T13:00:00+03:00',end:'2026-09-11T14:00:00+03:00',description:'Discuss',location:'Room',attendees:['person@example.test']};
function fixture(){const rows=new Map();return ()=>new CalendarDrafts({get:key=>structuredClone(rows.get(key)),put:(key,value)=>rows.set(key,structuredClone(value))});}
test('timezone instants, immutable attendees and exact human decisions survive restart',async()=>{
 const create=fixture(),validate=async()=>{},draft=await create().stage(context,'request',content,validate);assert.equal(draft.content.start,'2026-09-11T10:00:00.000Z');assert.deepEqual(await create().stage(context,'request',content,validate),draft);
 for(const changed of [{...content,attendees:['other@example.test']},{...content,start:'2026-09-11T13:30:00+03:00'}])await assert.rejects(create().stage(context,'request',changed,validate));
 await assert.rejects(create().decide(draft.id,context,'0'.repeat(64),true,validate));
 await create().decide(draft.id,context,draft.sha256,true,validate);assert.equal((await create().stage(context,'request',content,validate)).state,'approved');await assert.rejects(create().decide(draft.id,context,draft.sha256,false,validate));
});
test('ambiguous/invalid dates, reverse intervals and injected fields fail before authorization IO',async()=>{
 const create=fixture();let checks=0;const validate=async()=>{checks++};
 for(const proposal of [{...content,start:'2026-09-11T13:00:00'},{...content,start:'2026-02-30T13:00:00Z'},{...content,end:content.start},{...content,start:'2026-09-11T24:00:00Z'},{...content,organizer:'other@example.test'},{...content,attendees:['a@b.test\r\n']}])await assert.rejects(create().stage(context,'request',proposal,validate));assert.equal(checks,0);
});
test('owner/epoch isolation, current revoke and opposite concurrent decisions protect the proposal',async()=>{
 const create=fixture(),validate=async()=>{},draft=await create().stage(context,'request',content,validate);
 for(const owner of [{...context,owner:'other'},{...context,epoch:'new'},{...context,tenant:'other'}])await assert.rejects(create().read(draft.id,owner,validate));
 await assert.rejects(create().decide(draft.id,context,draft.sha256,true,async()=>{throw Error('revoked')}));
 const results=await Promise.allSettled([true,false].map(value=>create().decide(draft.id,context,draft.sha256,value,validate)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});

test('exact approved creation is single-attempt across overlapping calls and restart; agent retries see the event',async()=>{
 const queue=fixture(),check=async()=>{},draft=await queue().stage(context,'request',content,check);
 let calls=0;let release;const waiting=new Promise(resolve=>{release=resolve});
 const create=async shown=>{calls++;assert.deepEqual(shown,draft.content);await waiting;return {event_id:'event-1'}};
 await assert.rejects(queue().dispatch(draft.id,context,draft.sha256,check,create));assert.equal(calls,0);
 await queue().decide(draft.id,context,draft.sha256,true,check);
 await assert.rejects(queue().dispatch(draft.id,context,'0'.repeat(64),check,create));
 await assert.rejects(queue().dispatch(draft.id,context,draft.sha256,async()=>{throw Error('revoked')},create));assert.equal(calls,0);
 const first=queue().dispatch(draft.id,context,draft.sha256,check,create);
 while(calls===0)await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(queue().dispatch(draft.id,context,draft.sha256,check,create),/unconfirmed/);
 release();assert.equal((await first).execution.event_id,'event-1');
 assert.equal((await queue().dispatch(draft.id,context,draft.sha256,check,create)).execution.event_id,'event-1');
 assert.deepEqual((await queue().stage(context,'request',content,check)).execution,{state:'created',event_id:'event-1'});assert.equal(calls,1);
});
test('lost provider acknowledgement remains unconfirmed after restart and cannot be replayed',async()=>{
 const queue=fixture(),check=async()=>{},draft=await queue().stage(context,'request',content,check);await queue().decide(draft.id,context,draft.sha256,true,check);let calls=0;
 const create=async()=>{calls++;throw Error('private provider failure')};
 await assert.rejects(queue().dispatch(draft.id,context,draft.sha256,check,create),error=>/unconfirmed/.test(error.message)&&!error.message.includes('private'));
 await assert.rejects(queue().dispatch(draft.id,context,draft.sha256,check,create),/unconfirmed/);assert.equal(calls,1);
 assert.deepEqual((await queue().stage(context,'request',content,check)).execution,{state:'attempted'});
});
