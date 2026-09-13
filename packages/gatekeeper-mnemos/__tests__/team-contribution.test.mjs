import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';

const compiled=await build({stdin:{contents:'export {TeamBudgetView} from "./app/team-budget.ts"',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {TeamBudgetView}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('lost sharing response retries exact terms; withdrawal never reads runtime',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 const root=document.querySelector('main');
 const proposal={id:'proposal',state:'approved',proposal:{task:'task',criteria:'criteria',members:[{binding_id:'owned',role:'writer'}],estimate_usd_micros:'1',limit_usd_micros:'2'}};
 let current={state:'unshared',revision:0}, reads=0,posts=[];
 const api={
  readProjectBudget:async()=>({owner_id:'human',revision:1}),listTeamBudgets:async()=>({proposals:[{...proposal,member_count:1,limit_usd_micros:'2'}]}),
  readTeamBudget:async()=>proposal,listAgentConnections:async()=>({connections:[{binding_id:'owned',runtime_id:'runtime',revoked:false}]}),
  readTeamResultContribution:async()=>current,
  readTeamResultReview:async()=>({state:'accepted',revision:3,review:{runtime_request_id:'request',result_sha256:'hash'}}),
  readTeamBudgetMember:async()=>{reads++;return {state:'completed',request_id:'request',result:{content:'accepted text'}}},
  recordTeamResultContribution:async(_p,_q,_b,input)=>{
   posts.push(structuredClone(input));current={...input,revision:input.expected_revision+1};
   if(posts.length===1)throw new Error('lost response');return current;
  },
 };
 const view=new TeamBudgetView(root,api,'project',()=>{});await view.load();
 const click=(text)=>{const b=[...root.querySelectorAll('button')].find(b=>b.textContent===text||b.textContent.endsWith(text));assert(b,text);b.click()};
 const settle=async()=>{for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,1));if(![...root.querySelectorAll('button')].every(b=>b.disabled))return}assert.fail('UI stayed busy')};
 click('proposal');await settle();click('Передать результат команде owned');await settle();
 assert.equal(posts.length,1);assert.equal(reads,1);
 click('Повторить передачу/отзыв owned');await settle();
 assert.deepEqual(posts[1],posts[0]);assert.equal(reads,1);assert(root.textContent.includes('accepted text'));
 click('Отозвать общую часть owned');await settle();
 assert.equal(reads,1);assert.equal(posts[2].state,'withdrawn');assert.equal(posts[2].content,'');assert.equal(posts[2].expected_revision,1);
 assert(!root.textContent.includes('accepted text'));
 dom.window.close();delete globalThis.document;
});


test('new proposal for the same agent cannot inherit the previous result or acceptance',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 const root=document.querySelector('main');
 const old={id:'old',state:'approved',proposal:{task:'old task',criteria:'old criteria',members:[{binding_id:'owned',role:'writer'}],estimate_usd_micros:'1',limit_usd_micros:'2'}};
 const api={
  readProjectBudget:async()=>({owner_id:'human',revision:1}),
  listTeamBudgets:async()=>({proposals:[{...old,member_count:1,limit_usd_micros:'2'}]}),
  readTeamBudget:async()=>old,listAgentConnections:async()=>({connections:[{binding_id:'owned',runtime_id:'runtime',revoked:false}]}),
  readTeamResultReview:async()=>({state:'accepted',revision:1,review:{comment:'old acceptance',user_id:'human'}}),
  readTeamBudgetMember:async()=>({state:'completed',request_id:'old-request',result:{content:'old completed result'}}),
  createTeamBudget:async(_project,proposal)=>({id:'new',state:'approved',proposal}),
 };
 const view=new TeamBudgetView(root,api,'project',()=>{});await view.load();
 const click=async(text)=>{const b=[...root.querySelectorAll('button')].find(b=>b.textContent===text||b.textContent.endsWith(text));assert(b,text);b.click();for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,1));if(![...root.querySelectorAll('button')].every(b=>b.disabled))return}assert.fail('UI stayed busy')};
 try {
  await click('old');await click('Проверить результат owned');await click('Общая приёмка owned');
  assert(root.textContent.includes('old completed result'));assert(root.textContent.includes('old acceptance'));
  await click('Новая заявка команды');
  const values={'Задача команды':'new task','Критерии результата команды':'new criteria','Участники команды: ID подключения | роль':'owned | writer','Ожидаемая стоимость команды, USD':'0.001','Предел расходов команды, USD':'0.7'};
  for(const [label,value]of Object.entries(values)){const field=root.querySelector(`[aria-label="${label}"]`);assert(field,label);field.value=value;field.dispatchEvent(new dom.window.Event('input'));}
  await click('Сохранить заявку команды');
  assert(root.textContent.includes('Заявка new.'));assert(root.textContent.includes('new task'));
  assert(!root.textContent.includes('old completed result'));assert(!root.textContent.includes('old acceptance'));assert(!root.textContent.includes('Результат принят.'));
  assert(![...root.querySelectorAll('button')].some(b=>b.textContent==='Принять или вернуть результат owned'));
 } finally {dom.window.close();delete globalThis.document;}
});
