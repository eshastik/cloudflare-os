import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const result=await build({entryPoints:['src/mail-drafts.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {MailDrafts,listMailDrafts}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const context={tenant:'tenant',owner:'alice',epoch:'epoch',connection:'mail',agent:'agent'};
const content={to:['person@example.test'],subject:'Review',body:'Proposed reply'};
function fixture(){const rows=new Map();return {create:()=>new MailDrafts({get:key=>structuredClone(rows.get(key)),put:(key,value)=>rows.set(key,structuredClone(value))})};}
test('exact draft and decision survive restart; changed requests and opposite decisions conflict',async()=>{
 const f=fixture(),validate=async()=>{},draft=await f.create().stage(context,'request',content,validate);
 assert.deepEqual(await f.create().stage(context,'request',content,validate),draft);
 await assert.rejects(f.create().stage(context,'request',{...content,body:'changed'},validate));
 await assert.rejects(f.create().decide(draft.id,context,'0'.repeat(64),true,validate));
 const approved=await f.create().decide(draft.id,context,draft.sha256,true,validate);assert.equal(approved.state,'approved');
 assert.deepEqual(await f.create().stage(context,'request',content,validate),approved);
 await assert.rejects(f.create().decide(draft.id,context,draft.sha256,false,validate));
});
test('owner/epoch, revocation and concurrent decisions fence stored content',async()=>{
 const f=fixture(),validate=async()=>{},draft=await f.create().stage(context,'request',content,validate);
 for(const owner of [{...context,owner:'bob'},{...context,epoch:'new'},{...context,tenant:'other'}])await assert.rejects(f.create().read(draft.id,owner,validate));
 await assert.rejects(f.create().decide(draft.id,context,draft.sha256,true,async()=>{throw Error('revoked')}));
 const results=await Promise.allSettled([true,false].map(v=>f.create().decide(draft.id,context,draft.sha256,v,validate)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 draft.content.body='mutated';assert.equal((await f.create().read(draft.id,context,validate)).content.body,content.body);
});
test('recipient and header injection errors are rejected before IO',async()=>{
 const f=fixture();let calls=0;const validate=async()=>{calls++};
 for(const proposal of [{...content,to:['a@b.test\r\nBcc: secret@x.test']},{...content,subject:'A\nB'},{...content,to:['a@-bad.test']},{...content,to:[]},{...content,body:'x'.repeat(256*1024+1)},{...content,from:'spoof@example.test'}])await assert.rejects(f.create().stage(context,'request',proposal,validate));
 assert.equal(calls,0);
});
test('dispatch requires exact approval and never resends an uncertain attempt after restart',async()=>{
 const f=fixture(),validate=async()=>{},draft=await f.create().stage(context,'dispatch',content,validate);let sends=0;
 const send=async()=>{sends++;throw Error('private provider details')};
 await assert.rejects(f.create().dispatch(draft.id,context,draft.sha256,validate,send));assert.equal(sends,0);
 await f.create().decide(draft.id,context,draft.sha256,true,validate);
 await assert.rejects(f.create().dispatch(draft.id,context,'0'.repeat(64),validate,send));assert.equal(sends,0);
 await assert.rejects(f.create().dispatch(draft.id,context,draft.sha256,validate,send),/unconfirmed/);assert.equal(sends,1);
 await assert.rejects(f.create().dispatch(draft.id,context,draft.sha256,validate,send),/unconfirmed/);assert.equal(sends,1);
 assert.equal((await f.create().read(draft.id,context,validate)).delivery.state,'attempted');
});
test('concurrent dispatch calls accept one provider receipt and exact retries recover without sending',async()=>{
 const f=fixture(),validate=async()=>{},draft=await f.create().stage(context,'dispatch',content,validate);
 await f.create().decide(draft.id,context,draft.sha256,true,validate);let release,sends=0;
 const send=async(body,key)=>{assert.deepEqual(body,content);assert.equal(key,draft.id);sends++;await new Promise(resolve=>{release=resolve});return {message_id:'provider-message'}};
 const first=f.create().dispatch(draft.id,context,draft.sha256,validate,send);await new Promise(resolve=>setTimeout(resolve,0));
 await assert.rejects(f.create().dispatch(draft.id,context,draft.sha256,validate,send),/unconfirmed/);release();const accepted=await first;
 assert.deepEqual(accepted.delivery,{state:'accepted',message_id:'provider-message'});
 assert.deepEqual(await f.create().dispatch(draft.id,context,draft.sha256,validate,send),accepted);assert.equal(sends,1);
 await assert.rejects(f.create().dispatch(draft.id,context,draft.sha256,async()=>{throw Error('revoked')},send));assert.equal(sends,1);
});

test('draft listing pages existing records, isolates owner/epoch/connection and revalidates before returning',async()=>{
 const rows=new Map(),storage={get:key=>structuredClone(rows.get(key)),put:(key,value)=>rows.set(key,structuredClone(value)),list:({prefix,limit,startAfter=''})=>[...rows].filter(([key])=>key.startsWith(prefix)&&key>startAfter).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit)};
 const drafts=new MailDrafts(storage),validate=async()=>{};
 for(let i=0;i<53;i++)await drafts.stage(i<50?{...context,owner:'other'}:context,'req'+i,{...content,subject:'Subject '+i},validate);
 for(const change of [{tenant:'other'},{epoch:'other'},{connection:'other'}])await drafts.stage({...context,...change},crypto.randomUUID(),content,validate);
 let cursor='',ids=[];do{const page=await listMailDrafts(storage,context,context.connection,cursor,validate);assert(page.drafts.every(d=>d.subject.startsWith('Subject ')&&!('content' in d)));ids.push(...page.drafts.map(d=>d.id));cursor=page.next_cursor??'';}while(cursor);
 assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);
 let checks=0;await assert.rejects(listMailDrafts(storage,context,context.connection,'',async()=>{if(++checks===2)throw Error('revoked')}));
 await assert.rejects(listMailDrafts(storage,context,context.connection,'mailDraftRequest:private',validate));
});

test('provider acceptance without message ID persists and cannot cause a second send',async()=>{
 const f=fixture(),validate=async()=>{},draft=await f.create().stage(context,'no-id',content,validate);await f.create().decide(draft.id,context,draft.sha256,true,validate);let sends=0;
 const send=async()=>{sends++;return {accepted:true}};
 const result=await f.create().dispatch(draft.id,context,draft.sha256,validate,send);assert.deepEqual(result.delivery,{state:'accepted'});
 assert.deepEqual(await f.create().dispatch(draft.id,context,draft.sha256,validate,send),result);assert.equal(sends,1);
});

test('files are immutable approved content; changed bytes cannot reuse a request',async()=>{
 const file={filename:'Смета.bin',content_type:'application/octet-stream',content_base64:'AA==',sha256:(await import('node:crypto')).createHash('sha256').update(Buffer.from([0])).digest('hex')};const f=fixture(),validate=async()=>{};const draft=await f.create().stage(context,'files',{...content,attachments:[file]},validate);assert.deepEqual(draft.content.attachments,[file]);
 for(const changed of [{...file,filename:'other.bin'},{...file,content_base64:'AQ==',sha256:(await import('node:crypto')).createHash('sha256').update(Buffer.from([1])).digest('hex')}])await assert.rejects(f.create().stage(context,'files',{...content,attachments:[changed]},validate));
 await f.create().decide(draft.id,context,draft.sha256,true,validate);let sends=0;await f.create().dispatch(draft.id,context,draft.sha256,validate,async sent=>{sends++;assert.deepEqual(sent.attachments,[file]);return {accepted:true}});await f.create().dispatch(draft.id,context,draft.sha256,validate,async()=>{sends++;throw Error()});assert.equal(sends,1);
});
