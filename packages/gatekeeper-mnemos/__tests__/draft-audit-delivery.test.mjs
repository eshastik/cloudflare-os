import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const built=await build({entryPoints:['src/draft-audit-delivery.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {DraftAuditDelivery}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const event={event_id:'mail:draft:approved',kind:'mail',draft_id:'draft',connection_id:'mail',tenant_id:'tenant',owner_id:'owner',actor:'owner',on_behalf_of:'',sha256:'a'.repeat(64),phase:'approved',observed_at:'2026-09-12T10:00:00.000Z'};
function storage(){const rows=new Map();return {get:key=>rows.get(key),put:(key,v)=>rows.set(key,v)};}
test('lost acknowledgement retries identical event; restart skips only acknowledged bytes',async()=>{
 const saved=storage();let calls=0;const bodies=[];
 const request=async(url,init)=>{calls++;bodies.push(init.body);assert.equal(url,'https://mnemos.test/v1/internal/draft-audit/mail');assert.equal(init.redirect,'manual');if(calls===1)throw Error('lost response after commit');return Response.json({event_id:event.event_id});};
 const create=()=>new DraftAuditDelivery(saved,'https://mnemos.test','s'.repeat(40),request);
 await assert.rejects(create().deliver('mail',[event]));await create().deliver('mail',[event]);await create().deliver('mail',[event]);
 assert.equal(calls,2);assert.equal(bodies[0],bodies[1]);await assert.rejects(create().deliver('mail',[{...event,sha256:'b'.repeat(64)}]));assert.equal(calls,2);
});
test('bad or oversized receipt never acknowledges; wrong kind never reaches transport',async()=>{
 for(const response of [()=>Response.json({event_id:'different'}),()=>new Response('x'.repeat(2049)),()=>new Response('',{status:503}),()=>new Response('',{status:302,headers:{Location:'https://untrusted.test'}})]){
  let calls=0;const saved=storage(),create=()=>new DraftAuditDelivery(saved,'https://mnemos.test','s'.repeat(40),async()=>{calls++;return response();});
  await assert.rejects(create().deliver('mail',[event]));await assert.rejects(create().deliver('mail',[event]));assert.equal(calls,2);
  await assert.rejects(create().deliver('calendar',[event]));assert.equal(calls,2);
 }
});
