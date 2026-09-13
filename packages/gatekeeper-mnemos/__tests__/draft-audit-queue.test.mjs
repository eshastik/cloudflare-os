import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
async function load(file){const built=await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));}
const {DraftAuditQueue}=await load('src/draft-audit-queue.ts');const {AccountAlarms}=await load('src/account-alarms.ts');
function storage(){const rows=new Map();return {get:key=>structuredClone(rows.get(key)),put:(key,value)=>rows.set(key,structuredClone(value)),delete:key=>rows.delete(key),list:({prefix,limit,startAfter=''})=>[...rows].filter(([k])=>k.startsWith(prefix)&&k>startAfter).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit)};}
const event={kind:'mail',draft_id:'draft',event_id:'mail:draft:approved',phase:'approved',tenant_id:'tenant',owner_id:'owner',actor:'owner',on_behalf_of:'',connection_id:'selected',sha256:'a'.repeat(64),observed_at:'2026-09-12T10:00:00.000Z'};
test('pending queue survives unavailable receiver, pins original destination and keeps concurrent append',async()=>{
 const s=storage();let down=true,posts=0,scheduled=0,append=false;const origins=[];
 const create=()=>new DraftAuditQueue(s,(kind,origin)=>{origins.push(origin);return 's'.repeat(40)},async(url,init)=>{
  posts++;if(down)throw Error('offline');const e=JSON.parse(init.body);
  if(append){append=false;create().capture('https://other.test',()=>scheduled++).put('mailDraft:draft',{audit_events:[event,{...event,event_id:'mail:draft:attempted',phase:'attempted'}]});}
  return Response.json({event_id:e.event_id});
 });
 create().capture('https://original.test',()=>scheduled++).put('mailDraft:draft',{audit_events:[event]});
 assert.equal(await create().drain(),true);down=false;append=true;
 assert.equal(await create().drain(),true);assert.equal(await create().drain(),false);
 assert.equal(posts,3);assert.ok(origins.every(o=>o==='https://original.test'));assert.equal(scheduled,2);
 assert.equal(s.get('mailDraft:draft').audit_events.length,2);
});
test('failed enqueue prevents canonical transition; failed canonical write leaves only previous evidence',async()=>{
 const s=storage();s.put('mailDraft:draft',{state:'pending'});
 for(const failedPrefix of ['draftAuditPending:','mailDraft:']){
  const wrapped={...s,put:(key,v)=>{if(key.startsWith(failedPrefix))throw Error('storage failure');s.put(key,v)}};
  const q=new DraftAuditQueue(wrapped,()=> 's'.repeat(40));
  assert.throws(()=>q.capture('https://mnemos.test',()=>{}).put('mailDraft:draft',{state:'approved',audit_events:[event]}));
  assert.equal(s.get('mailDraft:draft').state,'pending');
 }
});
test('audit deadline neither replaces nor clears login deadline',async()=>{
 const s=storage();let at;const a=new AccountAlarms(s,{setAlarm:async value=>{at=value},deleteAlarm:async()=>{at=undefined}});
 await a.schedule('login',300);await a.schedule('audit',100);assert.equal(at,100);assert.equal(a.due('login',100),false);assert.equal(a.due('audit',100),true);
 await a.reschedule('audit',400);assert.equal(at,300);await a.clear('login');assert.equal(at,400);
 await a.schedule('audit',500);assert.equal(at,400);await a.clear('audit');assert.equal(at,undefined);
});
