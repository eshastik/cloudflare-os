import {test} from 'node:test';import assert from 'node:assert/strict';
import {MnemosAccount} from './account-session.ts';import {LocalOperationStorage} from './local-operation-storage.ts';
test('bulk session pins inventory, recovers a lost response and rejects revoked access',async()=>{
 const values=new Map<string,unknown>();const raw={get:<T>(k:string)=>structuredClone(values.get(k)) as T|undefined,put:(k:string,v:unknown)=>{values.set(k,structuredClone(v));},delete:(k:string)=>{values.delete(k);}};
 let visible=true,write=true,drop=true,inventories=0;const posts:string[]=[];
 const account=new MnemosAccount(new LocalOperationStorage(raw,raw),'https://memory.test',async(url,init)=>{
  const path=new URL(String(url)).pathname;
  if(path==='/v1/whoami')return Response.json({subject:{tenant_id:'tenant',user_id:'owner'}});
  if(path==='/v1/projects')return Response.json({projects:visible?[{id:'p',name:'P'}]:[]});
  if(path==='/v1/index/reindex-inventory'){inventories++;assert.deepEqual(JSON.parse(String(init?.body)),{project_ids:['p'],history:true});return Response.json({captured_at:'2026-09-13T00:00:00Z',entries:[{project_id:'p',node_id:'n',revision:3}]});}
  assert.equal(init?.method,'POST');assert.match(path,/revisions\/3\/reindex-requests/);
  if(!write)return new Response('',{status:403});posts.push(path);if(drop){drop=false;throw Error('lost response');}
  return Response.json({node_id:'n',revision:3,replayed:true,generation:2,changed:true,segments:1,vectorized:0,policy_class:'bulkdata',policy_alert:false,policy_why:'',embed_tokens:0,embed_micro_usd:0,notes:null});
 });
 await account.connect('private-token');let session=account.session();
 const batch=await session.prepareReindexBatch(['p'],true);assert.equal(inventories,1);assert.equal(posts.length,0);
 assert.equal((values.get('reindexBatch:current') as any).connection_audit.at(-1).operation_kind,'reindexBatch');
 const chunk=[...values].find(([k])=>k.startsWith('reindexBatchChunk:'))![1] as any;assert.equal(chunk.connection_audit.at(-1).operation_kind,'reindexBatchChunk');
 await assert.rejects(session.executeReindexBatch(batch.id));session.dispose();session=account.session();
 assert.equal((await session.prepareReindexBatch(['p'],false,true)).id,batch.id);assert.equal(inventories,1);
 visible=false;await assert.rejects(session.readReindexBatch());await assert.rejects(session.executeReindexBatch(batch.id));assert.equal(posts.length,1);
 visible=true;write=false;await assert.rejects(session.executeReindexBatch(batch.id));assert.equal((await session.readReindexBatch())?.next,0);
 write=true;const completed=await session.executeReindexBatch(batch.id);assert.equal(completed.next,1);assert.equal(completed.changed,1);assert.equal(posts[0],posts[1]);
 await session.executeReindexBatch(batch.id);assert.equal(posts.length,2);
 account.disconnect();await assert.rejects(session.readReindexBatch());await assert.rejects(session.executeReindexBatch(batch.id));session.dispose();
});
