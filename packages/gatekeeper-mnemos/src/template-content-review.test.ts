import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MnemosAccount,type AccountStorage} from './account-session.ts';
import {validTemplatePromotionReview} from './work-templates.ts';
const scope={scope_id:'team',revision:3,level:'group' as const,parent_id:'org',reader_group_id:'readers',name:'Команда',enabled:true,approvers:['publisher'],review_requirements:[{domain_id:'finance',approvers:['reviewer']}]};
const proposal={proposal_id:'q',request_id:'propose',user_id:'author',agent_id:'',source_owner_id:'author',template_id:'t',template_revision:1,target_scope_id:'team',target_scope_revision:3,template_key:'form',expected_catalogue_revision:0,message:'Проверить',scope_path:[scope],created_at:'2026-10-04T00:00:00Z'};
const input={request_id:'stable',approved:true,comment:'Проверено'};
const receipt={...input,proposal_id:'q',scope_id:'team',domain_id:'finance',reviewer_id:'reviewer',created_at:proposal.created_at};
function storage():AccountStorage{const m=new Map<string,unknown>();return {get:<T>(k:string)=>structuredClone(m.get(k)) as T|undefined,put:(k,v)=>{m.set(k,structuredClone(v));},delete:k=>{m.delete(k);}};}
test('согласование сохраняет точный запрос после потери ответа и восстановления аккаунта',async()=>{
 const store=storage(),bodies:unknown[]=[];let attempts=0;const fetcher:typeof fetch=async(url,init)=>{if(String(url).endsWith('/whoami'))return Response.json({subject:{tenant_id:'org',user_id:'reviewer'}});if(init?.method==='PUT'){bodies.push(JSON.parse(String(init.body)));if(++attempts===1)throw Error('lost');return Response.json(receipt);}return Response.json({proposal});};
 let account=new MnemosAccount(store,'https://memory.example',fetcher);await account.connect('token');let session=account.session();await session.saveTemplateContentDecision('q','team','finance',input);await assert.rejects(session.executeSavedTemplateContentDecision('q','team','finance'));
 account=new MnemosAccount(store,'https://memory.example',fetcher);session=account.session();await assert.rejects(session.saveTemplateContentDecision('q','team','finance',{...input,approved:false}));const result=await session.executeSavedTemplateContentDecision('q','team','finance');assert.deepEqual(result.receipt,receipt);assert.deepEqual(bodies,[input,input]);await session.executeSavedTemplateContentDecision('q','team','finance');assert.equal(bodies.length,2);
});
test('ответы согласующих проверяются по области, направлению, автору и повтору',()=>{
 assert.equal(validTemplatePromotionReview({proposal,content_decisions:[receipt]}),true);for(const change of [{scope_id:'other'},{domain_id:'other'},{reviewer_id:'author'},{reviewer_id:'publisher'},{proposal_id:'other'},{approved:undefined}])assert.equal(validTemplatePromotionReview({proposal,content_decisions:[{...receipt,...change}]}),false);assert.equal(validTemplatePromotionReview({proposal,content_decisions:[receipt,receipt]}),false);assert.equal(validTemplatePromotionReview(JSON.parse(JSON.stringify({proposal,content_decisions:[null]}))),false);
});
test('подменённое подтверждение не сохраняется как результат',async()=>{
 const store=storage();const fetcher:typeof fetch=async(url,init)=>String(url).endsWith('/whoami')?Response.json({subject:{tenant_id:'org',user_id:'reviewer'}}):Response.json(init?.method==='PUT'?{...receipt,request_id:'other'}:{proposal});const account=new MnemosAccount(store,'https://memory.example',fetcher);await account.connect('token');const session=account.session();await session.saveTemplateContentDecision('q','team','finance',input);await assert.rejects(session.executeSavedTemplateContentDecision('q','team','finance'));assert.equal((await session.readSavedTemplateContentDecision('q','team','finance'))?.receipt,undefined);
});

test('отключение аккаунта во время согласования сохраняет намерение без подтверждения',async()=>{
 const store=storage();let finish!:(r:Response)=>void;let started!:()=>void;const requestStarted=new Promise<void>(resolve=>{started=resolve;});const account=new MnemosAccount(store,'https://memory.example',async(url,init)=>{if(String(url).endsWith('/whoami'))return Response.json({subject:{tenant_id:'org',user_id:'reviewer'}});if(init?.method==='PUT')return new Promise(resolve=>{finish=resolve;started();});return Response.json({proposal});});await account.connect('token');const session=account.session();const saved=await session.saveTemplateContentDecision('q','team','finance',input);const pending=session.executeSavedTemplateContentDecision('q','team','finance');await requestStarted;account.disconnect();finish(Response.json(receipt));await assert.rejects(pending);await account.connect('new-token');assert.deepEqual(await account.session().readSavedTemplateContentDecision('q','team','finance'),saved);
});
