import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:'export {projectExpenses} from "./app/budget-overview.ts";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {projectExpenses}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
test('Expense overview preserves missing data, pages and exact microdollar sums without duplicate accounting',async()=>{
 let fail=false,duplicate=false,foreign=false,detailDenied=false;
 const api={readTeamBudget:async(project,id)=>{if(detailDenied)throw Error('private');return {id,project_id:project,proposal:{members:[{binding_id:'same-agent',role:id==='first'?'Analyst':'Reviewer'},{binding_id:'same-agent',role:'Analyst'}]}};},listTeamBudgets:async(project,cursor)=>({proposals:[{id:cursor?(duplicate?'first':'second'):'first',user_id:cursor?'second-owner':'first-owner'}],next_cursor:cursor?'':'page2'}),readTeamBudgetUsage:async(project,id)=>{
  if(fail&&id==='second')throw Error('no access');
  return {project_id:foreign?'other':project,proposal_id:id,actual_usd_micros:id==='first'?'9007199254740993':'7',reserved_usd_micros:'1',accounting_basis:'rated_tokens'};
 }};
 let row=await projectExpenses(api,'project','Name');assert.equal(row.known,'9007199254741000');assert.equal(row.reserved,'2');assert.equal(row.complete,true);assert.equal(row.requesters.length,2);assert.equal(row.requesters[0].known,'9007199254740993');assert.equal(row.requesters[1].known,'7');assert.equal(row.requesters[1].user,'second-owner');
 assert.equal(row.agents.length,1);assert.equal(row.agents[0].proposals,2);assert.deepEqual(row.agents[0].roles,['Analyst','Reviewer']);
 detailDenied=true;row=await projectExpenses(api,'project','Name');assert.equal(row.agents.length,0);assert.equal(row.agentsUnavailable,2);assert.equal(row.known,'9007199254741000');detailDenied=false;
 fail=true;row=await projectExpenses(api,'project','Name');assert.equal(row.complete,false);assert.equal(row.unavailable,1);assert.equal(row.known,'9007199254740993');assert.equal(row.requesters[1].unavailable,1);assert.equal(row.requesters[1].known,'0');
 fail=false;duplicate=true;row=await projectExpenses(api,'project','Name');assert.equal(row.complete,false);assert.equal(row.proposals,1);assert.equal(row.requesters.length,1);assert.equal(row.known,'9007199254740993');
 duplicate=false;foreign=true;row=await projectExpenses(api,'project','Name');assert.equal(row.complete,false);assert.equal(row.unavailable,2);assert.equal(row.known,'0');
});
