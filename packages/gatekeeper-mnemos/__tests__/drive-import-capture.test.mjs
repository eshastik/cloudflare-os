import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:'export {DriveImportCapture} from "./src/drive-import-capture.ts"',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {DriveImportCapture}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const input={project:'project',request:'request',sourceKey:'owned-account/file',fileId:'file'};
function fixture(){
 const map=new Map();const storage={get:k=>structuredClone(map.get(k)),put:(k,v)=>map.set(k,structuredClone(v))};
 const snapshot={provider:'google-drive',fileId:'file',sourceVersion:'1',sourceName:'Team.txt',sourceMimeType:'text/plain',contentType:'text/plain',exported:false,bytes:new TextEncoder().encode('abc'),sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'};
 const state={reads:0,uploads:0,posts:[],lost:true,denied:false,sourceLive:true,target:'https://storage.example/object',duringUpload(){}};
 const source={validate:async()=>{if(!state.sourceLive)throw Error('source revoked')},read:async()=>{state.reads++;return structuredClone(snapshot)}};
 const api={openDraft:async()=>({head:'head'}),beginImportUpload:async(_p,size,sum)=>({url:state.target,method:'PUT',upload_id:'upload',content_length:size,checksum_header:'x-amz-checksum-sha256',checksum_value:sum}),createPrivateDocument:async(_p,request)=>{state.posts.push(request);if(state.lost){state.lost=false;throw Error('lost response')}return {node_id:'node',head:'created'}},readDraftDocument:async()=>{if(state.denied)throw Error('denied');return {exists:true}}};
 const fetcher=async function(url,init){assert.equal(this,undefined);assert.equal(url.origin,'https://storage.example');assert.equal(init.method,'PUT');assert.equal(init.redirect,'manual');assert.equal(new TextDecoder().decode(init.body),'abc');state.uploads++;state.duringUpload();return new Response('')};
 return {storage,state,source,api,snapshot,create:()=>new DriveImportCapture(storage,'https://storage.example',fetcher)};
}
test('Lost creation reply is replayed after restart without downloading a changed source or creating another upload',async()=>{
 const f=fixture();await assert.rejects(f.create().capture(f.api,input,f.source),/lost/);
 f.snapshot.sourceVersion='2';f.state.sourceLive=false;
 const receipt=await f.create().capture(f.api,input,f.source);
 assert.equal(receipt.source.sourceVersion,'1');assert.equal(receipt.source.sha256,f.snapshot.sha256);assert.equal(receipt.source.bytes,undefined);
 assert.equal(f.state.reads,1);assert.equal(f.state.uploads,1);assert.deepEqual(f.state.posts[1],f.state.posts[0]);
 await assert.rejects(f.create().capture(f.api,{...input,fileId:'other'},f.source),/changed/);
 f.state.denied=true;await assert.rejects(f.create().capture(f.api,input,f.source),/denied/);
});
test('Source revoke after upload prevents creation, and changed retry cannot reuse the old upload',async()=>{
 const f=fixture();f.state.duringUpload=()=>{f.state.sourceLive=false};
 await assert.rejects(f.create().capture(f.api,input,f.source),/revoked/);assert.equal(f.state.posts.length,0);
 f.state.sourceLive=true;f.snapshot.sourceVersion='2';
 await assert.rejects(f.create().capture(f.api,input,f.source),/changed/);assert.equal(f.state.posts.length,0);assert.equal(f.state.uploads,1);
});
test('Wrong source hash and off-origin upload ticket stop before uploading any bytes',async()=>{
 const f=fixture();const hash=f.snapshot.sha256;f.snapshot.sha256='0'.repeat(64);
 await assert.rejects(f.create().capture(f.api,input,f.source),/checksum/);assert.equal(f.state.uploads,0);
 f.snapshot.sha256=hash;f.state.target='https://other.example/object';
 await assert.rejects(f.create().capture(f.api,input,f.source),/ticket/);assert.equal(f.state.uploads,0);assert.equal(f.state.posts.length,0);
});

test('Update provenance survives restart and separates the same file ID across accounts',async()=>{
 const f=fixture();
 f.api.createPrivateDocument=async(_project,request)=>({node_id:request.request_id,head:'captured-'+request.request_id});
 const capture=async(request,sourceKey=input.sourceKey,fileId=input.fileId)=>{
  f.snapshot.fileId=fileId;
  const receipt=await f.create().capture(f.api,{...input,request,sourceKey,fileId},f.source);
  return {source_node_id:receipt.node_id,source_head:receipt.head,source_sha256:receipt.source.sha256};
 };
 const first=await capture('first');f.snapshot.sourceVersion='2';
 const next=await capture('next'),otherAccount=await capture('other-account','another-account/file'),otherFile=await capture('other-file',input.sourceKey,'another-file');
 const coordinator=f.create();
 assert.doesNotThrow(()=>coordinator.validateUpdateSource(input.project,first,next));
 for(const mismatch of [otherAccount,otherFile,{...next,source_head:'edited'},{...next,source_sha256:'0'.repeat(64)},{...next,source_node_id:'unknown'}]){
  assert.throws(()=>coordinator.validateUpdateSource(input.project,first,mismatch),/same captured/);
  assert.throws(()=>coordinator.validateUpdateSource(input.project,mismatch,first),/same captured/);
 }
 // Existing local uploads have no external identity; they remain ordinary Office updates.
 assert.doesNotThrow(()=>coordinator.validateUpdateSource(input.project,{...first,source_node_id:'local-a'},{...next,source_node_id:'local-b'}));
});

test('Legacy receipt indexing resumes after interruption without refetching or accepting another account',()=>{
 const f=fixture(),records=new Map();let pages=0;
 f.storage.list=({prefix,startAfter,limit})=>{
  pages++;if(pages===2)throw Error('interrupted migration');return new Map([...records].filter(([key])=>key.startsWith(prefix)&&(!startAfter||key>startAfter)).sort(([a],[b])=>a<b?-1:a>b?1:0).slice(0,limit));
 };
 for(let i=0;i<205;i++){
  const request=String(i).padStart(3,'0'),node='node-'+request;
  records.set('driveImportCapture:'+JSON.stringify([input.project,request]),{input:{...input,request,sourceKey:i===204?'other-account/file':input.sourceKey},result:{node_id:node,head:'head-'+request,source:{...f.snapshot,sizeBytes:3}}});
 }
 const version=i=>({source_node_id:'node-'+i,source_head:'head-'+i,source_sha256:f.snapshot.sha256});
 const initial=f.create();
 assert.throws(()=>initial.validateUpdateSource(input.project,version('000'),version('203')),/interrupted migration/);
 const restarted=f.create();
 assert.doesNotThrow(()=>restarted.validateUpdateSource(input.project,version('000'),version('203')));
 assert.equal(pages,4);assert.equal(f.state.reads,0);assert.equal(f.state.uploads,0);assert.equal(f.state.posts.length,0);
 assert.throws(()=>f.create().validateUpdateSource(input.project,version('000'),version('204')),/same captured/);
 assert.throws(()=>f.create().validateUpdateSource(input.project,version('000'),version('missing')),/same captured/);
 assert.equal(pages,4,'Completed migration must not rescan the project');
});

for(const [provider,label] of [['yandex-disk','Yandex Disk'],['webdav','WebDAV']])test(provider+' snapshots preserve provider provenance',async()=>{
 const f=fixture();f.state.lost=false;f.snapshot.provider=provider;
 const receipt=await f.create().capture(f.api,input,f.source);
 assert.equal(receipt.source.provider,provider);assert.equal(f.state.posts[0].content_type,'application/octet-stream');
 assert.match(f.state.posts[0].message,new RegExp('Capture '+label+' source'));assert.equal(f.state.uploads,1);
});


test('Large source histories bound each review and never treat incomplete indexing as local uploads',()=>{
 const f=fixture(),records=new Map();let pages=0;
 f.storage.list=({prefix,startAfter,limit})=>{
  pages++;return new Map([...records].filter(([key])=>key.startsWith(prefix)&&(!startAfter||key>startAfter)).sort(([a],[b])=>a<b?-1:a>b?1:0).slice(0,limit));
 };
 for(let i=0;i<1205;i++){
  const request=String(i).padStart(4,'0');
  records.set('driveImportCapture:'+JSON.stringify([input.project,request]),{input:{...input,request,sourceKey:i===1204?'other-account/file':input.sourceKey},result:{node_id:'node-'+request,head:'head-'+request,source:{...f.snapshot,sizeBytes:3}}});
 }
 const version=i=>({source_node_id:'node-'+i,source_head:'head-'+i,source_sha256:f.snapshot.sha256});
 assert.throws(()=>f.create().validateUpdateSource(input.project,version('1203'),version('1204')),/recovery is incomplete/);
 assert.equal(pages,10);
 assert.throws(()=>f.create().validateUpdateSource(input.project,version('1203'),version('1204')),/same captured/);
 assert.equal(pages,13);
 assert.doesNotThrow(()=>f.create().validateUpdateSource(input.project,version('0000'),version('1203')));
 assert.equal(pages,13);
 assert.equal(f.state.reads,0);assert.equal(f.state.uploads,0);assert.equal(f.state.posts.length,0);
});


test('Source proof is frozen before creation and reused after coordinator restart',async()=>{
 const f=fixture();let issued=0;const issue=async value=>{issued++;assert.equal(value.input.request,input.request);assert.equal(value.origin.sha256,f.snapshot.sha256);assert.equal(value.head,'head');assert.equal(value.upload,'upload');return 'frozen-source-proof';};
 await assert.rejects(f.create().capture(f.api,input,f.source,issue),/lost/);
 assert.equal(issued,1);assert.equal(f.state.posts[0].drive_origin_proof,'frozen-source-proof');
 f.state.sourceLive=false;await f.create().capture(f.api,input,f.source,async()=>{throw Error('must not resign replay')});assert.deepEqual(f.state.posts[1],f.state.posts[0]);assert.equal(f.state.reads,1);
});
