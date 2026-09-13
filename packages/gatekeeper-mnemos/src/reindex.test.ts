import {test} from 'node:test';import assert from 'node:assert/strict';
import {MnemosAccount} from './account-session.ts';
import {LocalOperationStorage} from './local-operation-storage.ts';
test('reindex survives lost response and session recreation, retains version/key, and fences revocation',async()=>{
 const values=new Map<string,unknown>();
 const raw={get:<T>(k:string)=>structuredClone(values.get(k)) as T|undefined,put:(k:string,v:unknown)=>{values.set(k,structuredClone(v));},delete:(k:string)=>{values.delete(k);}};
 const storage=new LocalOperationStorage(raw,raw),node='a'.repeat(32);let latest=2,posts=0,drop=true,deny=false;
 const paths:string[]=[];
 const account=new MnemosAccount(storage,'https://memory.test',async(url,init)=>{
  assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer private-token');const path=new URL(String(url)).pathname;
  if(path==='/v1/whoami')return Response.json({subject:{tenant_id:'tenant',user_id:'owner'}});
  if(deny)return new Response('',{status:403});
  if(path===`/v1/nodes/${node}/revisions`)return Response.json({revisions:[1,latest],through:latest,next_after:latest,truncated:false});
  assert.equal(init?.method,'POST');paths.push(path);posts++;if(drop){drop=false;throw Error('response lost');}
  return Response.json({node_id:node,revision:2,generation:3,changed:true,replayed:true,segments:1,vectorized:0,policy_class:'bulkdata',policy_alert:false,policy_why:'',embed_tokens:0,embed_micro_usd:0,notes:null});
 });
 await account.connect('private-token');let session=account.session();
 const request=await session.prepareReindex(node);assert.equal(posts,0);assert.equal(request.revision,2);
 const saved=values.get('reindexRequest:'+node) as {connection_audit:Array<{operation_kind:string}>};assert.equal(saved.connection_audit.at(-1)?.operation_kind,'reindexRequest');
 await assert.rejects(session.executeReindex(node,request.request_id));session.dispose();latest=3;session=account.session();
 assert.deepEqual(await session.prepareReindex(node,true),request);
 const completed=await session.executeReindex(node,request.request_id);assert.equal(completed.result.replayed,true);assert.equal(paths[0],paths[1]);
 assert.equal((await session.prepareReindex(node)).request_id,request.request_id);
 const next=await session.prepareReindex(node,true);assert.equal(next.revision,3);assert.notEqual(next.request_id,request.request_id);
 await assert.rejects(session.executeReindex(node,request.request_id));assert.equal(posts,2);
 deny=true;await assert.rejects(session.prepareReindex(node));account.disconnect();await assert.rejects(session.executeReindex(node,next.request_id));assert.equal(posts,2);session.dispose();
});
