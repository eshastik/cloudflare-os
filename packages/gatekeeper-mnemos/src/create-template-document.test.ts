import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MnemosAccount,MnemosAccountSession,type AccountStorage} from './account-session.ts';
import {MnemosAPI} from './mnemos-api.ts';
import {createTemplateDocument} from './create-template-document.ts';

function fixture(){
 const values=new Map<string,unknown>();const storage:AccountStorage={get:<T>(k:string)=>structuredClone(values.get(k)) as T|undefined,put:(k,v)=>{values.set(k,structuredClone(v));},delete:k=>{values.delete(k);}};
 const form={template_id:'form',revision:5,title:'Форма',kind:'document',purpose:'Подготовить ТЗ',project_id:'source',node_id:'original',source_head:'a'.repeat(64),content_type:'application/vnd.cloudflareos.document+json',user_id:'human',agent_id:'',created_at:'2026-10-04T00:00:00Z'};
 const references=[{template_id:'form',revision:5},{template_id:'method',revision:3}];
 const input={project:'target',form:references[0],references,requestId:'once',name:'ТЗ.cfdoc'};
 const bodies:unknown[]=[];let lost=true;let revoked=false;let heads=0;
 const fetcher:typeof fetch=async(url,init)=>{
  const path=new URL(String(url)).pathname;
  if(path.endsWith('/whoami'))return Response.json({subject:{tenant_id:'org',user_id:'human'}});
  if(revoked)return new Response(null,{status:403});
  if(path.endsWith('/work-template-selections/read'))return Response.json({materials:references.map(reference=>({reference,personal:reference.template_id==='form'?form:{...form,template_id:'method',revision:3,kind:'guidance'}}))});
  if(path.endsWith('/draft/state')){heads++;return Response.json({personal_exists:true,personal_head:(heads===1?'b':'e').repeat(64),shared_head:'d'.repeat(64)});}
  if(init?.method==='GET')return Response.json(form);
  assert(path.endsWith('/work-templates/form/documents'));bodies.push(JSON.parse(String(init?.body)));
  if(lost){lost=false;throw new Error('lost reply');}
  return Response.json({node_id:'copy',head:'c'.repeat(64),template_id:'form',template_revision:5,source_head:form.source_head});
 };
 return {storage,fetcher,input,bodies,heads:()=>heads,revoke:()=>{revoked=true;}};
}

test('создание формы сохраняет весь набор и прежнюю голову после потери ответа',async()=>{
 const f=fixture();let account=new MnemosAccount(f.storage,'https://memory.example',f.fetcher);await account.connect('human-token');
 await assert.rejects(createTemplateDocument(account.session(),f.input),/Mnemos request failed/);
 account=new MnemosAccount(f.storage,'https://memory.example',f.fetcher);
 const result=await createTemplateDocument(account.session(),f.input);
 assert.equal(result.document.node_id,'copy');assert.equal(result.contentType,'application/vnd.cloudflareos.document+json');
 assert.deepEqual(f.bodies[0],f.bodies[1]);assert.deepEqual((f.bodies[1] as any).references,f.input.references);assert.equal(f.heads(),1);
 await createTemplateDocument(account.session(),f.input);assert.equal(f.bodies.length,3);
 await assert.rejects(createTemplateDocument(account.session(),{...f.input,name:'Другое имя'}));assert.equal(f.bodies.length,3);
 f.revoke();await assert.rejects(createTemplateDocument(account.session(),f.input));assert.equal(f.bodies.length,3);
});

test('форма вне набора не запускает создание',async()=>{
 const f=fixture();const account=new MnemosAccount(f.storage,'https://memory.example',f.fetcher);await account.connect('human-token');
 await assert.rejects(createTemplateDocument(account.session(),{...f.input,references:[f.input.references[1]]}));
 assert.equal(f.heads(),0);assert.equal(f.bodies.length,0);
});


test('агент не переиспользует сохранённое намерение человека',async()=>{
 const f=fixture();const account=new MnemosAccount(f.storage,'https://memory.example',f.fetcher);await account.connect('human-token');
 const human=account.session();const saved=await human.saveTemplateAction('target',{kind:'create',template:'form',input:{request_id:'human-only',revision:5,project_id:'target',parent_id:'',name:'Личная форма',expected_head:'b'.repeat(64),message:'Личный запрос'}},'');
 const agent=new MnemosAccountSession(new MnemosAPI('https://memory.example',async()=>'agent-token',f.fetcher),()=>true,f.storage,'binding-agent');
 assert.equal(await agent.readSavedTemplateAction('target'),null);
 await assert.rejects(createTemplateDocument(agent,f.input));
 const agentSaved=await agent.readSavedTemplateAction('target');assert.equal(agentSaved?.action.kind,'create');
 assert.deepEqual(await human.readSavedTemplateAction('target'),saved);
 assert.equal((f.bodies[0] as any).request_id,'once');
});
