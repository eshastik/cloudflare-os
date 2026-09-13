import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:'export {TeamDocumentCreation} from "./src/team-document-creation.ts"',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {TeamDocumentCreation}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
function fixture(){
 const map=new Map();const storage={get:k=>structuredClone(map.get(k)),put:(k,v)=>map.set(k,structuredClone(v))};
 const source='a'.repeat(64);let reads=0,uploads=0,posts=[],denied=false,changed=false;
 const api={
  readTeamBudget:async()=>{if(denied)throw Error('denied')},
  readTeamResultDraft:async()=>{reads++;return {source:{snapshot_sha256:changed?'b'.repeat(64):source,all_parts_shared:true},document:{format:'cloudflareos.document',formatVersion:1,document:{blocks:[]}}}},
  openDraft:async()=>({head:'head'}),
  beginNativeUpload:async(_p,size,sum)=>{uploads++;return {url:'https://storage.example/object',method:'PUT',upload_id:'upload',checksum_header:'x-amz-checksum-sha256',checksum_value:sum,content_length:size}},
  createPrivateDocument:async(_p,input)=>{posts.push(input);if(posts.length===1)throw Error('lost response');return {node_id:'node',head:'created'}},
  readDraftDocument:async()=>{if(denied)throw Error('denied');return {exists:true}},
 };
 return {api,storage,source,get reads(){return reads},get uploads(){return uploads},posts,deny:()=>denied=true,change:()=>changed=true};
}
test('restart replays lost creation response without uploading or rebuilding source',async()=>{
 const f=fixture();let fetched=0;const fetcher=async function(_url,init){assert.equal(init.redirect,'manual');assert.equal(this,undefined,'fetch must not receive coordinator as receiver');fetched++;return new Response('')};
 await assert.rejects(new TeamDocumentCreation(f.storage,'https://storage.example',fetcher).create(f.api,'project','proposal',f.source));
 assert.equal(f.uploads,1);assert.equal(fetched,1);const reads=f.reads;f.change();
 const creator=new TeamDocumentCreation(f.storage,'https://storage.example',fetcher);
 assert.deepEqual(await creator.create(f.api,'project','proposal',f.source),{node_id:'node',head:'created'});
 assert.deepEqual(f.posts[1],f.posts[0]);assert.equal(f.reads,reads);assert.equal(f.uploads,1);
 f.deny();await assert.rejects(creator.create(f.api,'project','proposal',f.source));assert.equal(f.posts.length,2);
});
test('changed source and foreign upload origin cannot create a document',async()=>{
 const f=fixture();f.change();const fetcher=async()=>assert.fail('network call');
 await assert.rejects(new TeamDocumentCreation(f.storage,'https://storage.example',fetcher).create(f.api,'project','proposal',f.source));assert.equal(f.uploads,0);
 const g=fixture();const begin=g.api.beginNativeUpload;g.api.beginNativeUpload=async(...args)=>({...await begin(...args),url:'https://foreign.example/object'});
 await assert.rejects(new TeamDocumentCreation(g.storage,'https://storage.example',fetcher).create(g.api,'project','proposal',g.source));assert.equal(g.posts.length,0);
});
