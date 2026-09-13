import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({stdin:{contents:'export {TrackerCreation} from "./src/tracker-creation.ts"; export {MnemosAPI} from "./src/mnemos-api.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {TrackerCreation,MnemosAPI}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const setup={title:'Launch tracker',stages:[{id:'spec',name:'Specification',department:'Product'},{id:'build',name:'Build',department:'Engineering'}],transitions:[{from:'spec',to:'build'}]};
test('tracker creation survives reconstruction and replays exact coordinates after lost POST',async()=>{
 const values=new Map();const storage={get:key=>structuredClone(values.get(key)),put:(key,value)=>values.set(key,structuredClone(value)),delete:key=>values.delete(key)};
 let heads=0,uploads=0,puts=0,denied=false;const requests=[];
 const api={listPrivateDocuments:async()=>{if(denied)throw Error("revoked");return {documents:[]};},draftState:async()=>{if(denied)throw Error('revoked');return {};},openDraft:async()=>{heads++;return {head:'a'.repeat(64)};},beginNativeUpload:async(project,size,checksum)=>{uploads++;return {url:'https://storage.example/upload',method:'PUT',content_length:size,checksum_header:'x-amz-checksum-sha256',checksum_value:checksum,upload_id:'saved-upload'};},createPrivateDocument:async(project,input)=>{requests.push(structuredClone(input));if(requests.length===1)throw Error('lost POST');return {node_id:'tracker',head:'b'.repeat(64)};},readDraftDocument:async()=>({exists:true})};
 const fetcher=async function(url,options){assert.equal(this,undefined);puts++;assert.equal(url.origin,'https://storage.example');assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,undefined);const artifact=JSON.parse(new TextDecoder().decode(options.body));assert.equal(artifact.format,'mnemos.task-tracker');assert.deepEqual(artifact.tasks,[]);assert.deepEqual(artifact.transitions,setup.transitions);return new Response('',{status:200});};
 let creation=new TrackerCreation(storage,'https://storage.example',fetcher);const saved=await creation.save(api,'project',setup,'');await assert.rejects(()=>creation.execute(api,'project',saved.id));assert.equal(requests.length,1);
 await assert.rejects(()=>creation.save(api,'project',{...setup,title:'Replacement'},saved.id));
 creation=new TrackerCreation(storage,'https://storage.example',fetcher);const restored=await creation.read(api,'project');assert.equal(restored.upload,'saved-upload');assert.equal(restored.attempted,true);
 const result=await creation.execute(api,'project',restored.id);assert.equal(result.result.node_id,'tracker');assert.deepEqual(requests[1],requests[0]);assert.equal(heads,1);assert.equal(uploads,1);assert.equal(puts,1);
 await creation.execute(api,'project',restored.id);assert.equal(requests.length,2);denied=true;await assert.rejects(()=>creation.execute(api,'project',restored.id));
});
test('invalid stages and transitions never prepare a request',async()=>{
 let calls=0;const storage={get:()=>undefined,put:()=>{calls++;},delete:()=>{}};const creation=new TrackerCreation(storage,'https://storage.example');const api={draftState:async()=>{calls++;}};
 for(const invalid of [{...setup,stages:[]},{...setup,stages:[setup.stages[0],setup.stages[0]]},{...setup,transitions:[{from:'spec',to:'missing'}]},{...setup,transitions:[{from:'spec',to:'spec'}]}])await assert.rejects(()=>creation.save(api,'project',invalid,''));assert.equal(calls,0);
});

test('document API accepts the tracker MIME without permitting arbitrary formats',async()=>{
 let calls=0;const api=new MnemosAPI('https://api.example',async()=> 'token',async(url,options)=>{calls++;assert.equal(JSON.parse(options.body).content_type,'application/vnd.mnemos.task-tracker+json');return Response.json({node_id:'tracker',head:'b'.repeat(64)});});
 const request={request_id:'stable',expected_head:'a'.repeat(64),parent_id:'',name:'Tracker',content_type:'application/vnd.mnemos.task-tracker+json',upload_id:'upload',message:'Create'};
 assert.equal((await api.createPrivateDocument('project',request)).node_id,'tracker');assert.equal(calls,1);await assert.rejects(()=>api.createPrivateDocument('project',{...request,content_type:'application/x-unsupported-tracker'}));assert.equal(calls,1);
});

test('reading the creation journal does not require draft WRITE',async()=>{
 let reads=0;const creation=new TrackerCreation({get:()=>undefined,put:()=>{throw Error('unexpected write');},delete:()=>{}},'https://storage.example');
 const api={listPrivateDocuments:async()=>{reads++;return {documents:[]};},draftState:async()=>{throw Error('WRITE denied');}};
 assert.equal(await creation.read(api,'project'),null);assert.equal(reads,1);await assert.rejects(()=>creation.save(api,'project',setup,''));
});

test('creation can be prepared before the first draft branch exists',async()=>{
 const values=new Map();const creation=new TrackerCreation({get:k=>values.get(k),put:(k,v)=>values.set(k,v),delete:k=>values.delete(k)},'https://storage.example');
 const api={listPrivateDocuments:async()=>({documents:[]}),draftState:async()=>{throw Error('branch.not_found');}};
 const prepared=await creation.save(api,'project',setup,'');assert.equal(prepared.setup.title,setup.title);assert.equal(values.size,1);assert.equal(prepared.head,undefined);
});
