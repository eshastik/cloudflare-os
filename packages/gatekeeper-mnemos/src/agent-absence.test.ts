import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MnemosAPI} from './mnemos-api.ts';
test('absence consent preserves revision, limits body and never retries failed write',async()=>{
 const calls: {url:string;init?:RequestInit}[]=[];let fail=false;
 const api=new MnemosAPI('https://memory.example',async()=>'owner-token',async(url,init)=>{calls.push({url:String(url),init});return fail?new Response('',{status:409}):Response.json({revision:3})});
 const input={local_binding_id:'local',managed_binding_id:'managed',starts_at:'2026-09-10T00:00:00Z',ends_at:'2026-09-12T00:00:00Z',expected_revision:2,enabled:false,owner_id:'forged'};
 await api.readAgentAbsence('a/b');await api.setAgentAbsence('a/b',input);
 assert.equal(calls[0].init?.method,'GET');assert.equal(calls[1].url,'https://memory.example/v1/projects/a%2Fb/agent-absence');
 const {owner_id:_,...expected}=input;assert.deepEqual(JSON.parse(String(calls[1].init?.body)),expected);
 assert.equal(new Headers(calls[1].init?.headers).get('Authorization'),'Bearer owner-token');
 fail=true;await assert.rejects(api.setAgentAbsence('a/b',input));assert.equal(calls.length,3);
 for(const change of [{expected_revision:-1},{ends_at:input.starts_at},{starts_at:'bad'},{managed_binding_id:'local'}])assert.throws(()=>api.setAgentAbsence('a/b',{...input,...change}));
 assert.equal(calls.length,3);
});

test('absence task actions use exact routes and bodies; status is read only',async()=>{
 const calls:{url:string;init?:RequestInit}[]=[];
 const api=new MnemosAPI('https://memory.example',async()=>'caller-token',async(url,init)=>{calls.push({url:String(url),init});return Response.json({})});
 await api.createAbsenceTask('source');await api.readAbsenceTask('source');await api.dispatchAbsenceTask('source','budget');await api.cancelAbsenceTask('source',7);await api.readAbsenceRuntime('source','binding');
 assert.deepEqual(calls.map(c=>[new URL(c.url).pathname,c.init?.method,c.init?.body?JSON.parse(String(c.init.body)):null]),[
  ['/v1/collaborations/source/absence-task','POST',{}],['/v1/collaborations/source/absence-task','GET',null],
  ['/v1/collaborations/source/absence-dispatch','POST',{proposal_id:'budget'}],['/v1/collaborations/source/absence-cancellation','POST',{expected_revision:7}],
  ['/v1/collaborations/source/absence-task/binding/runtime','GET',null],
 ]);
 for(const c of calls)assert.equal(new Headers(c.init?.headers).get('Authorization'),'Bearer caller-token');
 assert.throws(()=>api.cancelAbsenceTask('source',0));assert.equal(calls.length,5);
});
