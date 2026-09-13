import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
for(const kind of ['mail','calendar']){
 const built=await build({entryPoints:[`src/${kind}-drafts.ts`],bundle:true,platform:'node',format:'esm',write:false});
 const module=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const Drafts=module[kind==='mail'?'MailDrafts':'CalendarDrafts'];
 const context={tenant:'tenant',owner:'owner',agent:'agent',connection:'selected',epoch:'private-epoch'};
 const content=kind==='mail'?{to:['person@example.test'],subject:'Private subject',body:'Private body'}:{title:'Private meeting',start:'2026-09-12T10:00:00Z',end:'2026-09-12T11:00:00Z',description:'Private body',location:'Private room',attendees:['person@example.test']};
 test(`${kind}: durable audit survives partial index write and retries without another external effect`,async()=>{
  const rows=new Map();let fail=false,calls=0;
  const create=()=>new Drafts({get:key=>structuredClone(rows.get(key)),put:(key,value)=>{if(fail&&key.startsWith(kind+'DraftRequest:'))throw Error('index write failed');rows.set(key,structuredClone(value));}});
  const validate=async()=>{};
  const draft=await create().stage(context,'stable',content,validate);
  fail=true;await assert.rejects(create().decide(draft.id,context,draft.sha256,true,validate));fail=false;
  const approved=await create().stage(context,'stable',content,validate);
  assert.equal(approved.state,'approved');assert.deepEqual(approved.audit_events.map(e=>e.phase),['staged','approved']);
  assert.deepEqual((await create().decide(draft.id,context,draft.sha256,true,validate)).audit_events,approved.audit_events);
  const result=await create().dispatch(draft.id,context,draft.sha256,validate,async()=>{
   calls++;const saved=await create().read(draft.id,context,validate);
   assert.equal(saved.audit_events.at(-1).phase,'attempted');
   return kind==='mail'?{accepted:true}:{event_id:'event'};
  });
  const repeated=await create().dispatch(draft.id,context,draft.sha256,validate,async()=>{calls++;throw Error('must not resend');});
  assert.equal(calls,1);assert.deepEqual(repeated.audit_events,result.audit_events);
  assert.deepEqual(result.audit_events.map(e=>e.phase),['staged','approved','attempted',kind==='mail'?'accepted':'created']);
  assert.equal(new Set(result.audit_events.map(e=>e.event_id)).size,4);
  assert.equal(result.audit_events[0].actor,'agent');assert.equal(result.audit_events[1].actor,'owner');
  const serialized=JSON.stringify(result.audit_events);
  for(const secret of ['Private','person@example.test','private-epoch'])assert.equal(serialized.includes(secret),false);
 });
 test(`${kind}: uncertain delivery retains attempted audit and never retries IO`,async()=>{
  const rows=new Map(),storage={get:key=>structuredClone(rows.get(key)),put:(key,v)=>rows.set(key,structuredClone(v))};
  const create=()=>new Drafts(storage),validate=async()=>{};
  const draft=await create().stage(context,'uncertain',content,validate);await create().decide(draft.id,context,draft.sha256,true,validate);
  let calls=0;const send=async()=>{calls++;throw Error('response lost');};
  await assert.rejects(create().dispatch(draft.id,context,draft.sha256,validate,send));
  await assert.rejects(create().dispatch(draft.id,context,draft.sha256,validate,send));
  assert.equal(calls,1);assert.equal((await create().read(draft.id,context,validate)).audit_events.at(-1).phase,'attempted');
 });
 test(`${kind}: existing decisions do not acquire invented historical audit`,async()=>{
  const rows=new Map(),storage={get:key=>structuredClone(rows.get(key)),put:(key,v)=>rows.set(key,structuredClone(v))};
  const create=()=>new Drafts(storage),validate=async()=>{};
  const draft=await create().stage(context,'legacy',content,validate);await create().decide(draft.id,context,draft.sha256,true,validate);
  for(const [key,value] of rows){delete value.audit_events;rows.set(key,value);}
  const repeated=await create().decide(draft.id,context,draft.sha256,true,validate);assert.equal(repeated.audit_events,undefined);
  const done=await create().dispatch(draft.id,context,draft.sha256,validate,async()=>kind==='mail'?{accepted:true}:{event_id:'event'});
  assert.deepEqual(done.audit_events.map(e=>e.phase),['attempted',kind==='mail'?'accepted':'created']);
 });

}
