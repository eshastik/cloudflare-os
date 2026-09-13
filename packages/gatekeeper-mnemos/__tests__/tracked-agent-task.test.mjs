import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({stdin:{contents:'export {MnemosAccountSession} from "./src/account-session.ts";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {MnemosAccountSession}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('selected tracker is persisted in exact task input, retries cannot switch it or budget another project',async()=>{
 const values=new Map(),storage={get:k=>structuredClone(values.get(k)),put:(k,v)=>values.set(k,structuredClone(v)),delete:k=>values.delete(k)};
 let denied=false,checks=0;
 const api={readDraftDocument:async(p,n)=>({node_id:n,head:'a'.repeat(64),exists:true,conflicted:false,content_type:'application/vnd.mnemos.task-tracker+json'}),listAgentConnections:async()=>({connections:[{binding_id:'binding',agent_principal_id:'agent',managed_runtime:true,revoked:false}]}),checkTrackerAssignee:async(p,n,h,a)=>{checks++;assert.equal(a,'agent');if(denied)throw Error('agent cannot read tracker');}};
 let session=new MnemosAccountSession(api,()=>true,storage);
 const request=await session.prepareTrackedAgentTask('binding','Prepare delivery plan','Dependencies and checks','project','tracker');assert.equal(request.tracker.original_message,'Prepare delivery plan');assert(request.message.includes('"node_id":"tracker"'));assert(request.message.includes('in_progress'));assert(request.message.includes('blocked'));
 session=new MnemosAccountSession(api,()=>true,storage);assert.deepEqual(await session.prepareTrackedAgentTask('binding','Prepare delivery plan','Dependencies and checks','project','tracker'),request);
 await assert.rejects(()=>session.prepareTrackedAgentTask('binding','Prepare delivery plan','Dependencies and checks','project','other'));await assert.rejects(()=>session.budgetSavedAgentTask(request.request_id,'other-project','1','2'));
 denied=true;await assert.rejects(()=>session.prepareTrackedAgentTask('binding','Prepare delivery plan','Dependencies and checks','project','tracker'));assert.deepEqual(session.managedTaskRequest(),request);assert.equal(checks,4);
});
test('denied tracker selection saves no task; plain task does not look for a tracker',async()=>{
 const values=new Map(),storage={get:k=>values.get(k),put:(k,v)=>values.set(k,v),delete:k=>values.delete(k)};
 const session=new MnemosAccountSession({readDraftDocument:async()=>{throw Error('denied');}},()=>true,storage);
 await assert.rejects(()=>session.prepareTrackedAgentTask('binding','Task','Criteria','project','tracker'));assert.equal(values.size,0);
 const plain=session.prepareAgentTask('binding','Task','Criteria');assert.equal(plain.tracker,undefined);assert.equal(plain.message,'Task');
});
test('budget terms retain tracker selection across lost response and reject a changed server echo',async()=>{
 const values=new Map(),storage={get:k=>structuredClone(values.get(k)),put:(k,v)=>values.set(k,structuredClone(v)),delete:k=>values.delete(k)};
 let calls=0,wrong=true;const sent=[];
 const api={
  readDraftDocument:async(p,n)=>({node_id:n,head:'a'.repeat(64),exists:true,conflicted:false,content_type:'application/vnd.mnemos.task-tracker+json'}),
  listAgentConnections:async()=>({connections:[{binding_id:'binding',agent_principal_id:'actual-agent',managed_runtime:true,revoked:false}]}),
  checkTrackerAssignee:async()=>{},readProjectBudget:async()=>({revision:1}),
  createTeamBudget:async(project,input)=>{sent.push(structuredClone(input));calls++;if(calls===1)throw Error('lost reply');return {project_id:project,id:'proposal',proposal:{...input,tracker:wrong?{node_id:'other'}:input.tracker}};},
  readTeamBudgetMember:async()=>({request_id:'runtime-task',state:'unconfirmed'}),
  readTeamResultReview:async()=>({state:'unreviewed',revision:0}),
 };
 let session=new MnemosAccountSession(api,()=>true,storage);
 const draft=await session.prepareTrackedAgentTask('binding','Task','Criteria','project','selected');
 await assert.rejects(()=>session.budgetSavedAgentTask(draft.request_id,'project','1','2'));
 assert.deepEqual(sent[0].tracker,{node_id:'selected'});
 assert.equal(sent[0].tracker.agent_id,undefined);
 session=new MnemosAccountSession(api,()=>true,storage);
 await assert.rejects(()=>session.budgetSavedAgentTask(draft.request_id,'project','1','2'));
 assert.equal(session.managedTaskRequest().team_budget,undefined);
 wrong=false;const result=await session.budgetSavedAgentTask(draft.request_id,'project','1','2');
 assert.deepEqual(sent[0],sent[1]);assert.deepEqual(sent[1],sent[2]);
 assert.equal(result.tracker.node_id,'selected');assert.equal(result.request_id,'runtime-task');
});
