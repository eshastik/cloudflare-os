import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ReindexBatches,validReindexInventory} from './reindex-batch.ts';
import type {ReindexRequest,ReindexResult} from './reindex.ts';

function fixture(){
 const values=new Map<string,unknown>();let fail=(key:string)=>false;
 const storage={get:<T>(key:string)=>structuredClone(values.get(key)) as T|undefined,
 put:(key:string,value:unknown)=>{if(fail(key))throw Error('disk failure');values.set(key,structuredClone(value));},
 delete:(key:string)=>{values.delete(key);}};
 return {storage,values,setFailure:(fn:typeof fail)=>{fail=fn;}};
}
const inventory=(count:number)=>({captured_at:'2026-09-13T00:00:00Z',entries:Array.from({length:count},(_,n)=>({project_id:'p',node_id:'node'+n,revision:3}))});
function receipt(request:ReindexRequest,changed=true):ReindexResult {
 return {node_id:request.node,revision:request.revision,replayed:false,generation:2,changed,segments:1,vectorized:0,policy_class:'bulkdata',policy_alert:false,policy_why:'',embed_tokens:2,embed_micro_usd:3,notes:null};
}
test('resumes fixed requests across chunks and retains failed outcomes',()=>{
 const f=fixture();let store=new ReindexBatches(f.storage);const batch=store.prepare(['p'],false,inventory(35));
 for(let n=0;n<35;n++){
  const step=store.next(batch.id);assert.ok(step.request);assert.equal(step.request.node,'node'+n);
  store=new ReindexBatches(f.storage);assert.deepEqual(store.next(batch.id),step);
  assert.equal(store.prepare(['p'],false,inventory(40),true).id,batch.id);
  store.complete(batch.id,n,step.request,receipt(step.request,n!==32));
 }
 const done=store.next(batch.id);assert.equal(done.request,undefined);
 assert.deepEqual([done.batch.next,done.batch.changed,done.batch.failed,done.batch.tokens,done.batch.micro_usd],[35,34,1,70,105]);
 assert.equal(store.prepare(['p'],false,inventory(40)).id,batch.id);
 assert.notEqual(store.prepare(['p'],false,inventory(40),true).id,batch.id);
});
test('partial plan creation never exposes a header',()=>{
 const f=fixture(),store=new ReindexBatches(f.storage);f.setFailure(k=>k.endsWith(':1'));
 assert.throws(()=>store.prepare(['p'],false,inventory(35)),/disk failure/);assert.equal(store.current(),undefined);
 f.setFailure(()=>false);assert.equal(store.prepare(['p'],false,inventory(35)).total,35);
});
test('stored outcome recovers a failed cursor write without another request or duplicate cost',()=>{
 const f=fixture(),store=new ReindexBatches(f.storage),batch=store.prepare(['p'],false,inventory(2));
 const {request}=store.next(batch.id);assert.ok(request);
 f.setFailure(k=>k==='reindexBatch:current');
 assert.throws(()=>store.complete(batch.id,0,request,receipt(request)),/disk failure/);
 f.setFailure(()=>false);const reopened=new ReindexBatches(f.storage),recovered=reopened.next(batch.id);
 assert.equal(recovered.request,undefined);assert.equal(recovered.batch.next,1);assert.equal(recovered.batch.micro_usd,3);
 assert.equal(reopened.complete(batch.id,0,request,receipt(request)).micro_usd,3);
 assert.equal(reopened.next(batch.id).request?.node,'node1');
});
test('a failed outcome write and invalid receipt retain the original request',()=>{
 const f=fixture(),store=new ReindexBatches(f.storage),batch=store.prepare(['p'],false,inventory(1));
 const {request}=store.next(batch.id);assert.ok(request);
 assert.throws(()=>store.complete(batch.id,0,request,{...receipt(request),revision:4}),/Invalid/);
 f.setFailure(k=>k.startsWith('reindexBatchChunk:'));
 assert.throws(()=>store.complete(batch.id,0,request,receipt(request)),/disk failure/);
 assert.deepEqual(new ReindexBatches(f.storage).next(batch.id).request,request);
});
test('two live sessions cannot acquire the same batch step',()=>{
 const f=fixture(),one=new ReindexBatches(f.storage),two=new ReindexBatches(f.storage);
 const release=one.acquire('concurrent-test');assert.throws(()=>two.acquire('concurrent-test'),/already running/);
 release();two.acquire('concurrent-test')();
});
test('inventory rejects foreign projects, ambiguous versions and invalid metadata',()=>{
 assert.equal(validReindexInventory(inventory(2),['p'],false),true);
 for(const invalid of [{...inventory(1),captured_at:''},{...inventory(1),entries:[{project_id:'other',node_id:'a',revision:1}]},
 {...inventory(1),entries:[{project_id:'p',node_id:'a',revision:0}]},
 {...inventory(1),entries:[{project_id:'p',node_id:'a',revision:1},{project_id:'p',node_id:'a',revision:1}]}]){
  assert.equal(validReindexInventory(invalid,['p'],true),false);
 }
 const versions={...inventory(1),entries:[{project_id:'p',node_id:'a',revision:1},{project_id:'p',node_id:'a',revision:3}]};
 assert.equal(validReindexInventory(versions,['p'],false),false);assert.equal(validReindexInventory(versions,['p'],true),true);
});
