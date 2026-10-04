import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MnemosAccount,type AccountStorage} from './account-session.ts';
import {checkedTemplateReferences,type WorkTemplateReference} from './work-template-selection.ts';
function storage():AccountStorage{const map=new Map<string,unknown>();return {get:<T>(key:string)=>map.get(key) as T|undefined,put:(key,value)=>{map.set(key,value);},delete:key=>{map.delete(key);}};}
const refs:WorkTemplateReference[]=[{template_id:'method',revision:3},{scope_id:'department',template_key:'form',revision:5}];
const source={template_id:'method',revision:3,title:'Методика',kind:'guidance',purpose:'Подготовить ТЗ',project_id:'source',node_id:'doc',source_head:'a'.repeat(64),content_type:'text/markdown',user_id:'author',agent_id:'',created_at:'2026-10-04T00:00:00Z'};
const selection=()=>({materials:[{reference:refs[0],personal:source},{reference:refs[1],scoped:{scope_id:'department',template_key:'form',revision:5,proposal_id:'proposal',approved_by:'reviewer',approved_at:'2026-10-04T00:00:00Z',source:{...source,revision:11,kind:'document'}}}]});

test('набор сохраняет версии каталога отдельно от версии источника',async()=>{
 const bodies:unknown[]=[];const account=new MnemosAccount(storage(),'https://memory.example',async(url,init)=>{
  if(String(url).endsWith('/whoami'))return Response.json({subject:{tenant_id:'org',user_id:'person'}});
  assert.equal(String(url),'https://memory.example/v1/work-template-selections/read');assert.equal(init?.method,'POST');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer token');bodies.push(JSON.parse(String(init?.body)));return Response.json(selection());
 });await account.connect('token');const out=await account.session().readWorkTemplateSelection(refs);
 assert.deepEqual(bodies,[{references:refs}]);assert.equal(out.materials[1].scoped?.revision,5);assert.equal(out.materials[1].scoped?.source.revision,11);
});
test('неполный, смешанный, переставленный или подменённый ответ отвергается',async()=>{
 let mode='partial';const account=new MnemosAccount(storage(),'https://memory.example',async(url)=>{
  if(String(url).endsWith('/whoami'))return Response.json({subject:{tenant_id:'org',user_id:'person'}});
  const out=selection();
  if(mode==='partial')out.materials.pop();
  if(mode==='reordered')out.materials.reverse();
  if(mode==='wrong')out.materials[1].scoped!.revision=6;
  if(mode==='mixed')out.materials[1].personal=source;
  if(mode==='ref')out.materials[1].reference={scope_id:'department',template_key:'form',revision:6};
  return Response.json(out);
 });await account.connect('token');const session=account.session();
 for(mode of ['partial','reordered','wrong','mixed','ref'])await assert.rejects(session.readWorkTemplateSelection(refs));
});
test('неверный набор не отправляется в сеть, включая границу16/17',async()=>{
 let calls=0;const account=new MnemosAccount(storage(),'https://memory.example',async()=>{calls++;return Response.json({subject:{tenant_id:'org',user_id:'person'}});});await account.connect('token');const session=account.session();
 for(const value of [[],new Array(1),[{template_id:'method',revision:0}],[refs[0],refs[0]],[{template_id:'method',scope_id:'scope',revision:1}],[{template_id:'method',revision:1,owner_id:'other'}],Array.from({length:17},(_,i)=>({template_id:'method-'+i,revision:1}))]){
  assert.throws(()=>checkedTemplateReferences(value));
 }
 assert.equal(checkedTemplateReferences(Array.from({length:16},(_,i)=>({template_id:'method-'+i,revision:1}))).length,16);
 await assert.rejects(session.readWorkTemplateSelection([]));assert.equal(calls,1);
});
test('отзыв подключения подавляет запоздавший ответ',async()=>{
 let finish!:(response:Response)=>void;let started!:()=>void;const reading=new Promise<void>(resolve=>{started=resolve;});
 const account=new MnemosAccount(storage(),'https://memory.example',async(url)=>{
  if(String(url).endsWith('/whoami'))return Response.json({subject:{tenant_id:'org',user_id:'person'}});
  started();return new Promise(resolve=>{finish=resolve;});
 });await account.connect('token');const session=account.session();const pending=session.readWorkTemplateSelection(refs);await reading;account.disconnect();finish(Response.json(selection()));await assert.rejects(pending);await assert.rejects(session.readWorkTemplateSelection(refs));
});
