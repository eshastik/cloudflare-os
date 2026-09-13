import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const built=await build({entryPoints:['app/agent-answers.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {AgentAnswers}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('answers respect ownership, explicit sharing and revocation without treating missing costs as zero',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;
 const root=document.querySelector('main');let owner=true,revoked=false,shared=false,privateReads=0;
 const proposal={id:'request',proposal:{task:'Question',criteria:'Evidence',members:[{binding_id:'agent',role:'Analyst'}]}};
 const api={
  listTeamBudgets:async()=>({proposals:[{id:'request',created_at:'2026-09-10T20:00:00Z',member_count:1}]}),
  readTeamBudget:async()=>{if(revoked)throw Error('denied');return proposal;},
  listAgentConnections:async()=>({connections:owner?[{binding_id:'agent',managed_runtime:true,revoked:false}]:[]}),
  readTeamBudgetMember:async()=>{privateReads++;assert.ok(owner);return {state:'completed',result:{content:'Private answer'}};},
  readTeamResultReview:async()=>({state:'accepted'}),
  readTeamResultContribution:async()=>({state:shared?'shared':'withdrawn',content:'Team answer'}),
  readTeamBudgetUsage:async()=>{throw Error('unavailable');},
 };
 const view=new AgentAnswers(root,api,[],()=>{});await view.load('project');await view.open('request');
 assert.match(root.textContent,/Private answer/);assert.match(root.textContent,/Принят/);assert.match(root.textContent,/Учёт расходов недоступен/);assert.doesNotMatch(root.textContent,/0 USD/);
 owner=false;await view.open('request');assert.equal(privateReads,1);assert.doesNotMatch(root.textContent,/Private answer|Team answer/);assert.match(root.textContent,/не передан/);
 shared=true;await view.open('request');assert.match(root.textContent,/Team answer/);assert.equal(privateReads,1);
 revoked=true;await view.open('request');assert.doesNotMatch(root.textContent,/Team answer|Private answer/);assert.match(root.textContent,/Ответы недоступны/);
 dom.window.close();delete globalThis.document;
});
