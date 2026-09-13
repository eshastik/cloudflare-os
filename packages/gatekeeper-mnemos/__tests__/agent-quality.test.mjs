import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const built=await build({entryPoints:['app/agent-quality.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {projectQuality,AgentQuality}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('quality counts latest decisions once, separates unknown telemetry and does not divide team cost by members',async()=>{
 let denied=false,duplicate=false;
 const api={
  listTeamBudgets:async(p,cursor)=>({proposals:cursor?[{id:duplicate?'first':'rework',member_count:1}]:[{id:'first',member_count:3}],next_cursor:cursor?'':'next'}),
  readTeamBudget:async(project,id)=>({id,project_id:project,created_at:'2026-09-10T10:00:00Z',proposal:{rework:id==='rework'?{}:undefined,members:(id==='first'?['accepted','pending','hidden']:['changes']).map(binding_id=>({binding_id}))}}),
  readTeamResultReview:async(p,id,binding)=>{
   if(denied||binding==='hidden')throw Error('not authorized');
   if(binding==='pending')return {state:'unreviewed',revision:0};
   const state=binding==='accepted'?'accepted':'changes_requested';return {state,revision:4,review:{revision:4,decision:state,created_at:'2026-09-10T12:00:00Z'}};
  },
  readTeamBudgetUsage:async(project,id)=>{if(id==='rework')throw Error('unknown runtime');return {project_id:project,proposal_id:id,accounting_basis:'rated_tokens',actual_usd_micros:'9007199254740993'};},
 };
 let s=await projectQuality(api,'project');assert.equal(s.accepted,1);assert.equal(s.changes,1);assert.equal(s.unreviewed,1);assert.equal(s.unavailable,1);assert.equal(s.reworks,1);assert.equal(s.cost,'9007199254740993');assert.equal(s.costUnavailable,1);assert.deepEqual(s.decisionHours,[2,2]);
 duplicate=true;s=await projectQuality(api,'project');assert.equal(s.complete,false);assert.equal(s.proposals,1);assert.equal(s.accepted,1);assert.equal(s.cost,'9007199254740993');
 denied=true;s=await projectQuality(api,'project');assert.equal(s.accepted+s.changes,0);assert.equal(s.unreviewed,0);assert.equal(s.unavailable,3);assert.equal(s.decisionHours.length,0);
});

test('unavailable quality clears previous totals and never displays unknown spending as zero',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let denied=false;
 const api={listTeamBudgets:async()=>{if(denied)throw Error('denied');return {proposals:[{id:'one',member_count:1}]};},readTeamBudget:async()=>({id:'one',project_id:'project',created_at:'2026-09-10T10:00:00Z',proposal:{members:[{binding_id:'agent'}]}}),readTeamResultReview:async()=>({state:'unreviewed',revision:0}),readTeamBudgetUsage:async()=>{throw Error('unknown external usage');}};
 const view=new AgentQuality(root,api,[],()=>{},()=>{});await view.load('project');assert.match(root.textContent,/Расходы неизвестны/);assert.match(root.textContent,/Доля принятия неизвестна/);assert.doesNotMatch(root.textContent,/0 USD/);
 denied=true;await view.load('project');assert.match(root.textContent,/Свод недоступен/);assert.doesNotMatch(root.textContent,/Заявок:|Принято:/);dom.window.close();delete globalThis.document;
});

const comparisonBuild=await build({entryPoints:['app/memory-comparison.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {compareMemoryRuns,MemoryComparison,memoryCurrency}=await import('data:text/javascript;base64,'+Buffer.from(comparisonBuild.outputFiles[0].text).toString('base64'));
const {createHash}=await import('node:crypto');
const sha=s=>createHash('sha256').update(s).digest('hex');
function comparisonFixture(){
 const state={denied:false,wrongReview:false,missing:false,differentModel:false,differentTask:false};
 const api={
  readTeamBudget:async(project,id)=>({id,project_id:project,proposal:{task:state.differentTask&&id==='b'?'different':'same task',criteria:'same criteria',members:[{binding_id:'agent',role:'developer'}]}}),
  readTeamBudgetMember:async(p,id)=>{if(state.denied)throw Error('revoked');return {request_id:id,state:'completed',result:{content:id}};},
  readTeamMemberInputs:async(p,id)=>({request_id:id,checkpoint_found:!state.missing,input_manifest_sha256:sha(id),model_inputs:[{task_start:true,input_sha256:sha(id),model_id:state.differentModel&&id==='b'?'other':'model'}],input_manifest:state.missing?null:{format_version:1,model_id:state.differentModel&&id==='b'?'other':'model',message_sha256:sha(id),system_prompt_sha256:sha('prompt'),tool_catalog_sha256:sha('tools'),limits_sha256:sha('limits'),memory_context_sha256:sha(id),memory:{enabled:true,head:sha(id)}}}),
  readTeamResultReview:async(p,id)=>({state:id==='a'?'accepted':'changes_requested',revision:1,review:{revision:1,decision:id==='a'?'accepted':'changes_requested',runtime_request_id:state.wrongReview?'foreign':id,result_sha256:sha(id)}}),
  readTeamBudgetUsage:async()=>{throw Error('unreported');},
 };
 return {state,api};
}
const refs=[{proposal:'a',binding:'agent',label:'First'},{proposal:'b',binding:'agent',label:'Second'}];
test('memory comparison detects reviewed deterioration but exposes changed envelopes and missing telemetry',async()=>{
 const {state,api}=comparisonFixture();
 let r=await compareMemoryRuns(api,'project',...refs);
 assert.equal(r.regression,true);assert.equal(r.memoryChanged,true);assert.equal(r.runs[0].cost,undefined);
 assert.deepEqual(r.differences,['полный запрос, включая служебные поля']);
 state.differentModel=true;state.differentTask=true;r=await compareMemoryRuns(api,'project',...refs);
 assert.equal(r.regression,false);assert.ok(r.differences.includes('модель'));assert.ok(r.differences.includes('текст задачи'));
 state.wrongReview=true;r=await compareMemoryRuns(api,'project',...refs);assert.equal(r.regression,false);assert.equal(r.runs[0].decision,'unknown');
 state.missing=true;r=await compareMemoryRuns(api,'project',...refs);assert.equal(r.memoryChanged,undefined);assert.match(r.differences.join(),/неизвестны/);
 await assert.rejects(compareMemoryRuns(api,'project',refs[0],refs[0]));
});
test('memory comparison refresh removes private outputs after access revocation',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;
 try{
  const {state,api}=comparisonFixture(),root=document.querySelector('main');
  const view=new MemoryComparison(root,api,'project',refs);await view.compare();
  assert.match(root.textContent,/Сигнал ухудшения/);assert.match(root.textContent,/Расходы всей заявки: неизвестны/);
  assert.equal(root.querySelectorAll('pre').length,2);
  state.denied=true;await view.compare();assert.match(root.textContent,/Сравнение недоступно/);assert.equal(root.querySelectorAll('pre').length,0);assert.doesNotMatch(root.textContent,/Сигнал ухудшения/);
  view.dispose();assert.equal(root.textContent,'');
 }finally{dom.window.close();delete globalThis.document;}
});

const telemetryBuild=await build({entryPoints:['app/task-telemetry.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {taskTelemetry}=await import('data:text/javascript;base64,'+Buffer.from(telemetryBuild.outputFiles[0].text).toString('base64'));
test('task telemetry requires a complete correlated journal and distinguishes old unknown categories from zero searches',async()=>{
 const events=[
  {sequence:'1',event_id:'start',created_at:'2026-09-11T00:00:00Z',kind:'task_started'},
  {sequence:'2',event_id:'call',created_at:'2026-09-11T00:00:01Z',kind:'tool_called',tool_category:'search'},
  {sequence:'3',event_id:'failed',created_at:'2026-09-11T00:00:02Z',kind:'tool_failed',tool_category:'search',duration_ms:17},
  {sequence:'4',event_id:'end',created_at:'2026-09-11T00:00:03Z',kind:'task_completed'},
 ];
 let wrong=false,legacy=false,incomplete=false,denied=false;
 const api={readTeamMemberActivity:async(p,bindingProposal,binding,after)=>{
  if(denied)throw Error('revoked');
  return {project_id:p,proposal_id:bindingProposal,binding_id:binding,request_id:wrong?'foreign':'request',state:'completed',checkpoint_found:true,events:(after==='0'?events.slice(0,2):events.slice(2,incomplete?3:4)).map(e=>legacy?{...e,tool_category:undefined,duration_ms:undefined}:e),next_sequence:after==='0'?'2':null};
 }};
 const read=()=>taskTelemetry(api,'project','proposal','binding','request');
 assert.deepEqual(await read(),{calls:1,failures:1,accessDenied:0,unclassifiedErrors:1,searches:1,searchFailures:1,searchMs:17,elapsedMs:3000});
 events[2].failure_kind='access_denied';assert.equal((await read()).accessDenied,1);delete events[2].failure_kind;
 legacy=true;let t=await read();assert.equal(t.searches,undefined);assert.equal(t.searchMs,undefined);assert.equal(t.failures,1);
 incomplete=true;assert.equal(await read(),undefined);incomplete=false;wrong=true;assert.equal(await read(),undefined);wrong=false;denied=true;assert.equal(await read(),undefined);
});

test('comparison serializes owned reads when both runs use the same credential binding',async()=>{
 const {api}=comparisonFixture();const read=api.readTeamBudgetMember;let active=false;
 api.readTeamBudgetMember=async(...args)=>{
  assert.equal(active,false,'parallel credential refresh invalidates an in-flight read');active=true;
  try{await new Promise(resolve=>setTimeout(resolve,1));return await read(...args);}finally{active=false;}
 };
 assert.equal((await compareMemoryRuns(api,'project',...refs)).regression,true);
});


test('memory currency uses document digest instead of unrelated branch changes and preserves unavailable states',()=>{
 const m={memory:{enabled:true,project_id:'p',node_id:'n',head:sha('old branch'),document_sha256:sha('same document')}};
 const current={revision:8,project_id:'p',node_id:'n',head:sha('other document edited'),sha256:sha('same document')};
 assert.match(memoryCurrency(m,current),/Содержимое памяти совпадает/);
 assert.match(memoryCurrency(m,{...current,sha256:sha('changed')}),/Содержимое памяти изменилось/);
 assert.match(memoryCurrency(m,{...current,node_id:'other'}),/другой источник/);
 assert.match(memoryCurrency(m,{...current,node_id:'',project_id:''}),/Сейчас память отключена/);
 assert.match(memoryCurrency(m,undefined),/недоступна или не проверена/);
});

const apiBuild=await build({entryPoints:['src/mnemos-api.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {MnemosAPI}=await import('data:text/javascript;base64,'+Buffer.from(apiBuild.outputFiles[0].text).toString('base64'));
test('current memory version rechecks selection and access after ticket without returning body or signed URL',async()=>{
 let changed=false,denied=false,reads=0;
 const head=sha('head'),body=sha('body');
 const api=new MnemosAPI('https://mnemos.example',async()=>'private-token',async(input)=>{
  const url=String(input);
  if(url.endsWith('/v1/personal-memory/context')){
   reads++;if(denied&&reads%2===0)return new Response('{}',{status:403});
   return Response.json({revision:changed&&reads%2===0?2:1,project_id:'p',node_id:'n',document:{head,node_id:'n',exists:true,conflicted:false,content_type:'application/vnd.cloudflareos.document+json',terms:[]}});
  }
  assert.ok(url.endsWith('/draft/nodes/n/download'));
  return Response.json({head,node_id:'n',term_index:0,sha256_hex:body,url:'https://private-storage/?secret=ticket'});
 });
 assert.deepEqual(await api.readPersonalMemoryVersion(),{revision:1,project_id:'p',node_id:'n',head,sha256:body});
 changed=true;await assert.rejects(api.readPersonalMemoryVersion());changed=false;denied=true;await assert.rejects(api.readPersonalMemoryVersion());
});
