import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const built=await build({stdin:{contents:'export {CorporateUpdates} from "./src/corporate-update.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});const {CorporateUpdates}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('update recovers one durable request after lost response and rechecks even successful replay',async()=>{
 const data=new Map(),storage={get:k=>structuredClone(data.get(k)),put:(k,v)=>data.set(k,structuredClone(v)),delete:k=>data.delete(k)};let uploads=0,prepare=0,deny=false;const calls=[];
 const shown={target_node_id:'card',target_head:'before',current_sha256:'a'.repeat(64),incoming_node_id:'source',incoming_head:'incoming',incoming_sha256:'b'.repeat(64),plan:{source_changed:true,local_changed:true,conflicts:[],content:'PRIVATE CONTENT MUST NOT ENTER KV'},resolution:{current_sha256:'a'.repeat(64),incoming_sha256:'b'.repeat(64),title_choice:'local'}};
 const api={prepareBitrixRecordUpdate:async()=>{prepare++;return {...shown,preview_id:'receipt'};},beginNativeUpload:async(p,size,checksum)=>({url:'https://objects.example/upload',method:'PUT',content_length:size,checksum_header:'x-amz-checksum-sha256',checksum_value:checksum,upload_id:'upload'}),checkPrivateVersionRead:async()=>{if(deny)throw Error('revoked');},applyCorporateUpdate:async(...args)=>{calls.push(args);if(deny)throw Error('revoked');if(calls.length===1)throw Error('response lost after server commit');return {node_id:'card',head:'saved'};}};
 const fetcher=async()=>{uploads++;return new Response('',{status:200});};let update=new CorporateUpdates(storage,'https://objects.example',fetcher);
 const prepared=await update.prepare(api,'p',shown);assert.equal(prepared.state,'prepared');await assert.rejects(update.execute(api,prepared.id));
 update=new CorporateUpdates(storage,'https://objects.example',fetcher);assert.equal((await update.recover(api,'p','card')).state,'unconfirmed');
 const result=await update.execute(api,prepared.id);assert.equal(result.state,'updated');assert.deepEqual(calls[0],calls[1]);assert.equal(uploads,1);assert.equal(prepare,1);
 assert(!JSON.stringify([...data]).includes(shown.plan.content));assert.equal((await update.prepare(api,'p',shown)).id,prepared.id);
 deny=true;await assert.rejects(update.execute(api,prepared.id));assert.equal(calls.length,3);await assert.rejects(update.recover(api,'p','card'));
});
test('changed preview is refused before upload and unresolved conflicts never prepare',async()=>{
 let uploads=0;const shown={target_node_id:'card',target_head:'before',current_sha256:'a',incoming_node_id:'source',incoming_head:'new',incoming_sha256:'b',plan:{source_changed:true,local_changed:true,conflicts:[],content:'original'}};
 const api={prepareBitrixRecordUpdate:async()=>({...shown,preview_id:'receipt',plan:{...shown.plan,content:'changed'}}),beginNativeUpload:async()=>{uploads++;}};
 const update=new CorporateUpdates({get:()=>undefined,put:()=>assert.fail('unexpected persistence'),delete:()=>{}},'https://objects.example');await assert.rejects(update.prepare(api,'p',shown));assert.equal(uploads,0);await assert.rejects(update.prepare(api,'p',{...shown,plan:{...shown.plan,conflicts:[{field:'title'}]}}));
});
