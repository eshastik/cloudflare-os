import {test} from 'node:test';import assert from 'node:assert/strict';
import {MnemosAccount} from './account-session.ts';import {LocalOperationStorage} from './local-operation-storage.ts';
test('centroid intent survives response loss and session recreation, fences revocation and stale keys',async()=>{
 const values=new Map<string,unknown>();const raw={get:<T>(k:string)=>structuredClone(values.get(k)) as T|undefined,put:(k:string,v:unknown)=>{values.set(k,structuredClone(v));},delete:(k:string)=>{values.delete(k);}};
 let visible=true,drop=true;const posts:string[]=[];
 const account=new MnemosAccount(new LocalOperationStorage(raw,raw),'https://memory.test',async(url,init)=>{
  const path=new URL(String(url)).pathname;
  if(path==='/v1/whoami')return Response.json({subject:{tenant_id:'t',user_id:'owner'}});
  if(path==='/v1/projects')return Response.json({projects:visible?[{id:'p',name:'P'}]:[]});
  assert.equal(init?.method,'POST');posts.push(path);if(drop){drop=false;throw Error('lost');}
  return Response.json({project_id:'p',request_id:path.split('/').at(-1),replayed:true,changed:true,documents:2,excluded:1,embed_tokens:4,embed_micro_usd:6});
 });
 await account.connect('private-token');let session=account.session();const request=await session.prepareCentroid('p');assert.equal(posts.length,0);
 assert.equal((values.get('centroidRequest:p') as any).connection_audit.at(-1).operation_kind,'centroidRequest');
 await assert.rejects(session.executeCentroid('p',request.request_id));session.dispose();session=account.session();assert.deepEqual(await session.prepareCentroid('p',true),request);
 const completed=await session.executeCentroid('p',request.request_id);assert.equal(completed.result.replayed,true);assert.equal(posts[0],posts[1]);
 visible=false;await assert.rejects(session.prepareCentroid('p'));await assert.rejects(session.executeCentroid('p',request.request_id));assert.equal(posts.length,2);
 visible=true;const next=await session.prepareCentroid('p',true);assert.notEqual(next.request_id,request.request_id);await assert.rejects(session.executeCentroid('p',request.request_id));assert.equal(posts.length,2);
 account.disconnect();await assert.rejects(session.executeCentroid('p',next.request_id));session.dispose();
});
