import {test} from 'node:test';import assert from 'node:assert/strict';
import {MnemosAccount} from './account-session.ts';
test('policy management uses the authenticated account, encoded note and revocation fence',async()=>{
 const values=new Map<string,unknown>(),id='a'.repeat(32),calls:string[]=[];
 const account=new MnemosAccount({get:<T>(k:string)=>structuredClone(values.get(k)) as T|undefined,put:(k,v)=>{values.set(k,structuredClone(v))},delete:k=>{values.delete(k)}},'https://memory.test',async(url,init)=>{
  assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer private-token');const path=new URL(String(url)).pathname;
  if(path==='/v1/whoami')return Response.json({subject:{tenant_id:'tenant',user_id:'owner'}});calls.push(path);
  if(path==='/v1/admin/policy-alerts')return Response.json({alerts:[],next:'',truncated:false});
  assert.equal(path,'/v1/admin/policy-alerts/'+id+'/review');assert.equal(init?.method,'POST');assert.deepEqual(JSON.parse(String(init?.body)),{note:'Проверено'});return Response.json({reviewed:true});
 });
 await account.connect('private-token');const session=account.session();
 assert.deepEqual(await session.policyAlerts(),{alerts:[],next:'',truncated:false});assert.deepEqual(await session.reviewPolicyAlert(id,'Проверено'),{reviewed:true});
 await assert.rejects(session.reviewPolicyAlert(id,'я'.repeat(2049)));assert.equal(calls.length,2);
 account.disconnect();await assert.rejects(session.policyAlerts());await assert.rejects(session.reviewPolicyAlert(id,'Проверено'));assert.equal(calls.length,2);session.dispose();
});
