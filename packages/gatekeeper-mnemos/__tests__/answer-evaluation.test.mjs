import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createHash} from 'node:crypto';import {JSDOM} from 'jsdom';
const compile=async(entry)=>{const b=await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));};
const {decodeAnswerEvaluation,evaluateAnswer}=await compile('src/answer-evaluation.ts');const {AnswerEvaluation}=await compile('app/answer-evaluation.ts');
const sha=s=>createHash('sha256').update(s).digest('hex');
const source={id:'policy',project_id:'p',node_id:'n',head:sha('version'),sha256:sha('document')};
const sample={format:'mnemos.answer-evaluation',version:1,revision:'v1',target:{project_id:'p',proposal_id:'proposal',binding_id:'agent',request_id:'request',result_sha256:sha('IRIS-731'),input_manifest_sha256:sha('inputs')},sources:[source],context:[{id:'required-policy',source_id:'policy',kind:'selected_memory',status:'present'}],claims:[{id:'code',quote:'IRIS-731',verdict:'supported',source_ids:['policy']}],access:[{id:'read',expected:'allow',observed:'unknown'}]};
function fixture(){
 const state={denied:false,wrongResult:false,wrongInputs:false,memorySha:source.sha256};
 const api={
  readTeamBudgetMember:async()=>({request_id:'request',state:'completed',result:{content:state.wrongResult?'different':'IRIS-731'}}),
  readTeamMemberInputs:async()=>({request_id:'request',checkpoint_found:true,input_manifest_sha256:sha(state.wrongInputs?'different':'inputs'),input_manifest:{memory:{enabled:true,project_id:'p',node_id:'n',document_sha256:state.memorySha}},model_inputs:[]}),
  readPrivateVersionDigest:async()=>{if(state.denied)throw Error('revoked');return source;},
 };return {api,state};
}
test('assessment binds exact answer, input and source and overrides incorrect selected-memory labels',async()=>{
 const set=decodeAnswerEvaluation(JSON.stringify(sample)),{api,state}=fixture();let r=await evaluateAnswer(api,set);
 assert.equal(r.context_complete,true);assert.equal(r.support_rate,1);assert.equal(r.unknown_access,1);assert.equal(r.assessed_access,0);
 state.memorySha=sha('corrupted');r=await evaluateAnswer(api,set);assert.equal(r.context[0].status,'outdated');assert.equal(r.context_complete,false);
 state.wrongResult=true;await assert.rejects(evaluateAnswer(api,set));state.wrongResult=false;state.wrongInputs=true;await assert.rejects(evaluateAnswer(api,set));state.wrongInputs=false;state.denied=true;await assert.rejects(evaluateAnswer(api,set));
});
test('invalid and unsupported annotations cannot manufacture verifiable claims or tool observations',async()=>{
 for(const changed of [
  {...sample,claims:[...sample.claims,{...sample.claims[0],id:'duplicate-quote'}]},
  {...sample,claims:[{...sample.claims[0],source_ids:[]}]},
  {...sample,context:[{...sample.context[0],kind:'tool_output'}]},
 ])assert.throws(()=>decodeAnswerEvaluation(JSON.stringify(changed)));
 const {api}=fixture();await assert.rejects(evaluateAnswer(api,{...sample,claims:[{...sample.claims[0],quote:'absent claim'}]}));
 const unknown=await evaluateAnswer(api,{...sample,context:[],claims:[{...sample.claims[0],verdict:'unknown'}]});assert.equal(unknown.context_complete,null);assert.equal(unknown.support_rate,null);assert.equal(unknown.unknown_claims,1);
});
test('UI removes prior assessment when a referenced source loses access',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;
 try{const {api,state}=fixture();api.listPrivateDocuments=async()=>({documents:[]});api.readDraftDocument=async()=>({exists:true,conflicted:false,content_type:'application/json',head:sha('assessment')});
 const root=document.querySelector('main'),view=new AnswerEvaluation(root,api,[],()=>{},async()=>JSON.stringify(sample));await view.load('p');await view.run('assessment');assert.match(root.textContent,/100.0%/);assert.match(root.textContent,/IRIS-731/);
 state.denied=true;await view.run('assessment');assert.match(root.textContent,/Оценка недоступна/);assert.doesNotMatch(root.textContent,/100.0%|IRIS-731/);
 }finally{dom.window.close();delete globalThis.document;}
});
