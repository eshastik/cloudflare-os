import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({stdin:{contents:'export {MnemosAPI,MEMORY_UNAVAILABLE_ERROR,QUERY_CAPACITY_ERROR} from "./src/mnemos-api.ts";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {MnemosAPI,MEMORY_UNAVAILABLE_ERROR,QUERY_CAPACITY_ERROR}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('only bounded known memory refusal becomes actionable; remote details stay private',async()=>{
 for(const [status,body,expected] of [[409,{code:'agent.memory_unavailable',message:'private diagnostic'},MEMORY_UNAVAILABLE_ERROR],[403,{code:'agent.memory_unavailable'},'Mnemos request failed'],[409,{code:'other',message:'private diagnostic'},'Mnemos request failed'],[409,{code:'agent.memory_unavailable',message:'x'.repeat(2000)},'Mnemos request failed']]){
  const api=new MnemosAPI('https://api.example',async()=>'token',async()=>Response.json(body,{status}));
  await assert.rejects(()=>api.runTeamBudgetMember('project','proposal','binding'),error=>error.status===status&&error.message===expected);
 }
});

test('only typed query admission refusal is exposed as platform capacity',async()=>{
 for(const [status,code,expected] of [[429,'external_db.query_busy',QUERY_CAPACITY_ERROR],[403,'external_db.query_busy','Mnemos request failed'],[429,'other','Mnemos request failed']]){
  const api=new MnemosAPI('https://api.example',async()=>'token',async()=>Response.json({code,message:'private upstream detail'},{status}));
  await assert.rejects(()=>api.assessProjectSignals('project',{requirements:[],queries:[]}),error=>error.status===status&&error.message===expected);
 }
});
