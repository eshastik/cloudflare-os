import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:'export {AbsenceTaskView} from "./app/absence-task.ts"; export {AbsenceActions} from "./src/absence-actions.ts"',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {AbsenceTaskView,AbsenceActions}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('absence task keeps exact budget and dispatch on lost response; requester cannot read private result',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 const root=document.querySelector('main'),source={request_id:'source',project_id:'project',requester_user_id:'requester',requester_agent_id:'',target_user_id:'owner',title:'Title',description:'Exact description',criteria:'Exact criteria',role:'coexecutor'};
 let task={request_id:'source',project_id:'project',owner_id:'owner',managed_binding_id:'managed',local_binding_id:'local',state:'queued',revision:1,runtime_request_id:'attempt',binding_id:'',budget_proposal_id:''};
 let prepares=0,runtimeReads=0;const budgets=[],dispatches=[];
 const api={
  readAbsenceTask:async()=>task,
  createAbsenceTask:async()=>{prepares++;return task},
  readProjectBudget:async()=>({project_id:'project',revision:4}),
  createTeamBudget:async(project,input)=>{assert.equal(project,'project');budgets.push(structuredClone(input));if(budgets.length===1)throw new Error('lost');return {id:'budget',project_id:project,proposal:input,state:'approved'}},
  readTeamBudget:async()=>({project_id:'project',state:'approved',proposal:{absence_request_id:'source'}}),
  dispatchAbsenceTask:async(request,proposal)=>{dispatches.push([request,proposal]);task={...task,state:'completed',revision:5,binding_id:'managed',budget_proposal_id:'budget'};if(dispatches.length===1)throw new Error('lost');return {request_id:request,runtime_request_id:'attempt',state:'completed',result:{content:'private'}}},
  readAbsenceRuntime:async()=>{runtimeReads++;throw new Error('private')},
 };
 const storage=new Map();const actions=new AbsenceActions({get:key=>storage.get(key),put:(key,value)=>storage.set(key,value)},api,()=>{},new AbortController().signal);
 Object.assign(api,{readSavedAbsenceAction:request=>actions.read(request),saveAbsenceAction:(...args)=>actions.save(...args),executeSavedAbsenceAction:(...args)=>actions.execute(...args)});
 let view=new AbsenceTaskView(root,api,source,'requester',()=>{});
 const b=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
 const click=text=>{assert(b(text),text);b(text).click()};
 const settle=async()=>{const end=Date.now()+1000;while([...root.querySelectorAll('button')].every(b=>b.disabled)){assert(Date.now()<end,'busy timeout');await new Promise(r=>setTimeout(r,1))}};
 const fill=(label,value)=>{const e=root.querySelector(`[aria-label="${label}"]`);e.value=value;e.dispatchEvent(new dom.window.Event('input'))};
 try{
  await view.load();assert.equal(prepares,0);assert.equal(runtimeReads,0);
  fill('Оценка стоимости, USD','0.01');fill('Лимит стоимости, USD','0.02');click('Предложить бюджет замещения');await settle();
  assert.equal(budgets.length,1);view=new AbsenceTaskView(root,api,source,'requester',()=>{});await view.load();assert.equal(budgets.length,1);click('Повторить действие с теми же условиями');await settle();assert.deepEqual(budgets[1],budgets[0]);
  assert.equal(budgets[0].task,'Title\n\nExact description');assert.equal(budgets[0].criteria,source.criteria);assert.equal(budgets[0].absence_request_id,'source');assert.deepEqual(budgets[0].members,[{binding_id:'managed',role:'coexecutor'}]);
  click('Перечитать общую задачу');await settle();click('Запустить заместителя');await settle();
  click('Перечитать общую задачу');await settle();assert(!b('Прочитать частный результат'));assert.equal(dispatches.length,1);
  click('Повторить действие с теми же условиями');await settle();assert.deepEqual(dispatches,[['source','budget'],['source','budget']]);assert.equal(runtimeReads,0);assert(!root.textContent.includes('private'));
 }finally{dom.window.close();delete globalThis.document}
});

test('owner cancellation retries observed revision after task changes; revoked read clears private result',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');
 let task={request_id:'source',project_id:'project',owner_id:'owner',state:'claimed',revision:2,runtime_request_id:'attempt',binding_id:'managed',budget_proposal_id:'budget'};
 let revoked=false;const cancels=[];
 const api={readAbsenceTask:async()=>{if(revoked)throw new Error('revoked');return task},readAbsenceRuntime:async()=>({request_id:'attempt',state:'completed',result:{content:'<script>private text</script>'}}),cancelAbsenceTask:async(request,revision)=>{cancels.push([request,revision]);task={...task,state:'queued',revision:4};if(cancels.length===1)throw new Error('lost');return {request_id:request,revision:3,completed:true}}};
 const storage=new Map();const actions=new AbsenceActions({get:key=>storage.get(key),put:(key,value)=>storage.set(key,value)},api,()=>{},new AbortController().signal);
 Object.assign(api,{readSavedAbsenceAction:request=>actions.read(request),saveAbsenceAction:(...args)=>actions.save(...args),executeSavedAbsenceAction:(...args)=>actions.execute(...args)});
 const view=new AbsenceTaskView(root,api,{request_id:'source',project_id:'project',requester_user_id:'requester',title:'Title'},'owner',()=>{});
 const b=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
 const settle=async()=>{const end=Date.now()+1000;while([...root.querySelectorAll('button')].every(b=>b.disabled)){assert(Date.now()<end);await new Promise(r=>setTimeout(r,1))}};
 try{
  await view.load();b('Прочитать частный результат').click();await settle();assert(root.textContent.includes('private text'));assert.equal(root.querySelectorAll('script').length,0);
  revoked=true;await view.load();assert(!root.textContent.includes('private text'));revoked=false;await view.load();
  b('Отменить назначение до старта').click();await settle();await view.load();b('Повторить действие с теми же условиями').click();await settle();assert.deepEqual(cancels,[['source',2],['source',2]]);
 }finally{dom.window.close();delete globalThis.document}
});

test('selected sharing survives reopening without reading or copying private runtime output',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');
 const task={request_id:'source',project_id:'project',owner_id:'owner',state:'completed',revision:8,runtime_request_id:'attempt',binding_id:'managed',result_sha256:'a'.repeat(64)};
 const source={request_id:'source',project_id:'project',title:'Task',requester_user_id:'requester'};const sent=[];let runtimeReads=0;
 const api={readAbsenceTask:async()=>task,readAbsenceRuntime:async()=>{runtimeReads++;return {result:{content:'whole private response'}}},shareAgentAbsenceResult:async(...args)=>{sent.push(args.slice(0,5));if(sent.length===1)throw new Error('lost reply');return {sequence:3,kind:'result',absence_runtime_request_id:'attempt',absence_result_sha256:task.result_sha256}}};
 const store=new Map();const actions=new AbsenceActions({get:key=>store.get(key),put:(key,value)=>store.set(key,value)},api,()=>{},new AbortController().signal);
 Object.assign(api,{readSavedAbsenceAction:request=>actions.read(request),saveAbsenceAction:(...args)=>actions.save(...args),executeSavedAbsenceAction:(...args)=>actions.execute(...args)});
 let view=new AbsenceTaskView(root,api,source,'owner',()=>{});
 const b=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
 const settle=async()=>{const end=Date.now()+1000;while([...root.querySelectorAll('button')].every(b=>b.disabled)){assert(Date.now()<end);await new Promise(r=>setTimeout(r,1))}};
 try{
  await view.load();const field=root.querySelector('[aria-label="Выбранный текст для участников"]');assert.equal(field.value,'');field.value='Only selected summary';field.dispatchEvent(new dom.window.Event('input'));
  b('Передать выбранный результат').click();await settle();assert.equal(sent.length,1);assert.equal(runtimeReads,0);
  view=new AbsenceTaskView(root,api,source,'owner',()=>{});await view.load();assert.equal(sent.length,1);assert(!b('Передать выбранный результат'));
  b('Повторить действие с теми же условиями').click();await settle();assert.deepEqual(sent[1],sent[0]);assert.deepEqual(sent[0],['source','managed','attempt',task.result_sha256,'Only selected summary']);assert.equal(runtimeReads,0);assert(root.textContent.includes('сообщение 3'));
  const completed=actions.read('source');await actions.execute('source',completed.id);assert.equal(sent.length,2);
 }finally{dom.window.close();delete globalThis.document}
});
