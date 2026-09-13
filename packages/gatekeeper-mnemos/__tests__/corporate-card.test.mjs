import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const built=await build({stdin:{contents:'export {CorporateCards} from "./src/corporate-card.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {CorporateCards}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const sum=async b=>Buffer.from(await crypto.subtle.digest('SHA-256',b)).toString('hex');
test('card edit keeps source and relationships, rejects stale versions and withholds revoked reads',async()=>{
 const original={format:'mnemos.corporate-record',format_version:1,id:'card',kind:'company',title:'Client',notes:'',source_id:'portal',source_entity_id:'1',source_record:'{"large":9007199254740993}',source_references:[{from_kind:'company',from_id:'1',field:'ASSIGNED_BY_ID',to_kind:'person',to_id:'10',resolved:false}],access_mapping:'unmapped'};
 let bytes=new TextEncoder().encode(JSON.stringify(original)),head='a'.repeat(64),allowed=true,uploads=0,writes=0,uploaded;
 const api={readDraftDocument:async()=>({head,exists:true,conflicted:false,content_type:'application/json'}),beginDraftDownload:async()=>({head,node_id:'n',term_index:0,url:'https://objects.test/get',method:'GET',size_bytes:bytes.length,sha256_hex:await sum(bytes)}),checkPrivateVersionRead:async()=>{if(!allowed)throw Error('revoked');},beginNativeUpload:async(p,size,checksum)=>{uploads++;return {upload_id:'u',url:'https://objects.test/put',method:'PUT',content_length:size,checksum_header:'x-amz-checksum-sha256',checksum_value:checksum};},saveDraftDocument:async(p,n,u,expected)=>{writes++;assert.equal(expected,head);bytes=uploaded;head='b'.repeat(64);return {head};}};
 const cards=new CorporateCards('https://objects.test',async function(url,init){assert.equal(this,undefined);assert.equal(init.redirect,'manual');assert(!init.headers?.Authorization);if(init.method==='PUT'){uploaded=init.body;return new Response('');}return new Response(bytes);});
 const view=await cards.read(api,'p','n');assert.equal(view.title,'Client');assert(!JSON.stringify(view).includes('9007199254740993'));
 await cards.save(api,'p','n',view.head,'Edited','Local notes');
 const edited=JSON.parse(new TextDecoder().decode(bytes));assert.deepEqual({...edited,title:original.title,notes:original.notes},original);
 await assert.rejects(cards.save(api,'p','n',view.head,'Stale',''));assert.equal(uploads,1);assert.equal(writes,1);
 allowed=false;await assert.rejects(cards.read(api,'p','n'));await assert.rejects(cards.save(api,'p','n',head,'Denied',''));assert.equal(writes,1);
});
test('card reader rejects cross-origin tickets and oversized bodies without exposing content',async()=>{
 const head='a'.repeat(64);let fetches=0;
 const api={readDraftDocument:async()=>({head,exists:true,content_type:'application/json'}),beginDraftDownload:async()=>({head,node_id:'n',term_index:0,url:'https://attacker.test/get',method:'GET',size_bytes:1,sha256_hex:'0'.repeat(64)})};
 const cards=new CorporateCards('https://objects.test',async()=>{fetches++;return new Response('too large');});
 await assert.rejects(cards.read(api,'p','n'));assert.equal(fetches,0);
 api.beginDraftDownload=async()=>({head,node_id:'n',term_index:0,url:'https://objects.test/get',method:'GET',size_bytes:1,sha256_hex:'0'.repeat(64)});
 await assert.rejects(cards.read(api,'p','n'));assert.equal(fetches,1);
});
test('ambiguous source members are refused and a lost write response is never retried',async()=>{
 const base={format:'mnemos.corporate-record',format_version:1,id:'card',kind:'company',title:'Client',notes:'',source_id:'portal',source_entity_id:'1',source_record:'{}',source_references:[],access_mapping:'unmapped'};
 let bytes=new TextEncoder().encode(JSON.stringify(base).replace('"notes":""','"notes":"","notes":"hidden"')),writes=0;
 const head='a'.repeat(64),api={readDraftDocument:async()=>({head,exists:true,content_type:'application/json'}),beginDraftDownload:async()=>({head,node_id:'n',term_index:0,url:'https://objects.test/get',method:'GET',size_bytes:bytes.length,sha256_hex:await sum(bytes)}),checkPrivateVersionRead:async()=>{},beginNativeUpload:async(p,size,checksum)=>({upload_id:'u',url:'https://objects.test/put',method:'PUT',content_length:size,checksum_header:'x-amz-checksum-sha256',checksum_value:checksum}),saveDraftDocument:async()=>{writes++;throw Error('response lost');}};
 const cards=new CorporateCards('https://objects.test',async(url,init)=>new Response(init.method==='PUT'?'':bytes));
 await assert.rejects(cards.read(api,'p','n'),e=>!e.message.includes('hidden'));assert.equal(writes,0);
 bytes=new TextEncoder().encode(JSON.stringify(base));
 await assert.rejects(cards.save(api,'p','n',head,'Edited',''));assert.equal(writes,1);
});
