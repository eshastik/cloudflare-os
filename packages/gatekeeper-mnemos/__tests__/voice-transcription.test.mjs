import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const compiled=await build({stdin:{contents:'export {VoiceTranscriptionFlow} from "./app/voice-transcription.ts";export {VoiceTransfer} from "./src/voice-transfer.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {VoiceTranscriptionFlow,VoiceTransfer}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const source={request_id:'source',project_id:'project',media_type:'audio/wav',size_bytes:3,sha256:'ab'.repeat(32)};
test('Voice flow retries identical budget terms and rechecks approval before dispatch',async()=>{
 let lose=true,state='approved',runs=0,proposal;const writes=[];
 const values=new Map(),storage={get:k=>structuredClone(values.get(k)),put:(k,v)=>values.set(k,structuredClone(v))};let coordinator=new VoiceTransfer(storage,'https://storage.test');
 const api={whoAmI:async()=>{},readVoiceSource:async()=>source,readProjectBudget:async()=>({project_id:'project',revision:1}),createTeamBudget:async(project,input)=>{writes.push(structuredClone(input));proposal={id:'budget',project_id:project,user_id:'owner',agent_id:'',state,proposal:structuredClone(input)};if(lose){lose=false;throw Error('lost ack');}return proposal;},readTeamBudget:async()=>({...proposal,state}),runTeamBudgetMember:async(project,budget,binding)=>{assert.equal(project,'project');assert.equal(budget,'budget');assert.equal(binding,'agent');runs++;return {state:'completed'};}};
 api.prepareVoiceTranscription=(id,revision,binding,limit)=>coordinator.prepareTranscription(api,id,revision,binding,limit);api.resumeVoiceTranscription=(id,revision)=>coordinator.resumeTranscription(api,id,revision);
 let flow=new VoiceTranscriptionFlow(api,source,0);await assert.rejects(flow.create('agent','100000'));coordinator=new VoiceTransfer(storage,'https://storage.test');flow=new VoiceTranscriptionFlow(api,source,0);await flow.resume();assert.deepEqual(writes[0],writes[1]);await assert.rejects(flow.create('different','1'));assert.equal(writes.length,2);
 state='revoked';await assert.rejects(flow.run());assert.equal(runs,0);state='approved';await flow.run();assert.equal(runs,1);
 proposal.proposal.task=JSON.stringify({...JSON.parse(proposal.proposal.task),source_request_id:'other'});await assert.rejects(flow.run());assert.equal(runs,1);
});
test('Reopened voice budget must match the exact source and target revision',async()=>{
 const task={kind:'mnemos.voice.transcription.v1',source_request_id:'source',original_sha256:source.sha256,audio_format:'wav',expected_revision:0};
 const proposal={id:'saved',project_id:'project',user_id:'owner',agent_id:'',state:'approved',proposal:{task:JSON.stringify(task),members:[{binding_id:'agent'}]}};
 const api={readTeamBudget:async()=>proposal};const flow=new VoiceTranscriptionFlow(api,source,0);await flow.load('saved');assert.equal(flow.proposal.id,'saved');
 await assert.rejects(new VoiceTranscriptionFlow(api,source,1).load('saved'));proposal.proposal.tracker={node_id:'tracker'};await assert.rejects(flow.load('saved'));
});
