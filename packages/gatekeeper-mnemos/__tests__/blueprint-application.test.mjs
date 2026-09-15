import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';

test('общий Blueprint копируется по точной версии, повтор не создаёт копию, отзыв запрещает чтение', async()=>{
 const head='a'.repeat(64), saved='b'.repeat(64), source='c'.repeat(64);
 let creates=0, denied=false, promotions=0, proposal;
 const scopes=[{scope_id:"department",revision:2,level:"department",parent_id:"organization",reader_group_id:"department-readers",name:"Отдел",enabled:true,approvers:["reviewer"]},{scope_id:"finance",revision:1,level:"group",parent_id:"department",reader_group_id:"finance-readers",name:"Группа",enabled:true,approvers:["reviewer"]},{scope_id:"organization",revision:1,level:"organization",parent_id:"",reader_group_id:"",name:"Компания",enabled:true,approvers:["reviewer"]}];
 const mime='application/vnd.mnemos.blueprint-template+json';
 const mf=new Miniflare({workers:[{
   name:'mnemos',modules:true,modulesRules:[{type:'Text',include:['**/*.txt']}],
   scriptPath:fileURLToPath(new URL('../dist/mnemos.js',import.meta.url)),
   compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage','nodejs_compat'],
   bindings:{MNEMOS_API_ORIGIN:'https://memory.example',MNEMOS_STORAGE_ORIGIN:'https://objects.example'},
   durableObjects:{ACCOUNTS:{className:'UserAccount',useSQLite:true}},
   outboundService:async request=>{
     assert.equal(request.headers.get('Authorization'),'Bearer fixture-human-token');
     const url=new URL(request.url), path=url.pathname;
     if(path==='/v1/whoami')return Response.json({subject:{tenant_id:'org',user_id:'alice'}});
     if(path==='/v1/template-scopes')return Response.json({scopes});
     if(path==='/v1/template-scopes/department/templates/contract')return new Response(null,{status:404});
     if(path==='/v1/template-promotions/scoped'){
       promotions++;const body=await request.json();assert.equal(body.source_scope_id,'finance');assert.equal(body.source_revision,3);assert.equal(body.target_scope_id,'department');assert.equal(body.target_scope_revision,2);
       proposal={...body,proposal_id:'promotion',user_id:'alice',agent_id:'',source_owner_id:'author',source_scope_revision:3,template_id:'source-template',template_revision:2,created_at:'2026-09-15T00:00:00Z',scope_path:[scopes[0],scopes[2]]};return Response.json(proposal);
     }
     if(path==='/v1/template-promotions/promotion')return Response.json({proposal});
     if(path==='/v1/projects/project/draft/open')return Response.json({head});
     if(path==='/v1/template-scopes/finance/templates/contract'){
       assert.equal(url.searchParams.get('revision'),'3');
       return Response.json({scope_id:'finance',template_key:'contract',revision:3,proposal_id:'proposal',approved_by:'reviewer',approved_at:'2026-09-15T00:00:00Z',source:{template_id:'source-template',revision:2,title:'Договор',kind:'document',purpose:'Договор клиента',project_id:'source-project',node_id:'source-node',source_head:source,content_type:mime,user_id:'author',agent_id:'',created_at:'2026-09-15T00:00:00Z'}});
     }
     if(path==='/v1/template-scopes/finance/templates/contract/documents'){
       creates++;const body=await request.json();assert.equal(body.revision,3);assert.equal(body.project_id,'project');
       return Response.json({node_id:'copy',head:saved,scope_id:'finance',template_key:'contract',template_revision:3,source_head:source});
     }
     if(path.endsWith('/download')){
       assert.equal(path,`/v1/projects/project/nodes/copy/private-versions/${saved}/download`);
       if(denied)return new Response(null,{status:403});
       return Response.json({url:'https://objects.example/copy',method:'GET',size_bytes:12,sha256_hex:'d'.repeat(64),node_id:'copy',head:saved,term_index:0,content_type:mime});
     }
     throw new Error('Неожиданный запрос: '+path);
   }
 },{
   name:'driver',modules:true,compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage','nodejs_compat'],
   durableObjects:{ACCOUNTS:{className:'UserAccount',scriptName:'mnemos',useSQLite:true}},
   script:`export default {async fetch(request,env){
     const account=env.ACCOUNTS.get(env.ACCOUNTS.idFromName('owner'));await account.acceptVerifiedCredential('fixture-human-token');
     using frame=await account.startAppUi();const input=await request.json();
     try {if(input.promote)return Response.json(await frame.blueprintTemplates.selector.promote('finance','contract',3,'Полезно всему отделу','22222222-2222-4222-8222-222222222222'));const result=await frame.blueprintTemplates.selector.apply('finance','contract',input.revision||3,'project','Договор.mnemos-template','11111111-1111-4111-8111-111111111111');return Response.json(result)}
     catch{return new Response('denied',{status:403})}
   }};`
 }]});
 try{
   const driver=await mf.getWorker('driver');
   const call=(body={})=>driver.fetch('https://driver.test',{method:'POST',body:JSON.stringify(body)});
   assert.equal((await call()).status,200);assert.equal((await call()).status,200);assert.equal(creates,1);
   assert.equal((await call({revision:4})).status,403);assert.equal(creates,1);
   denied=true;assert.equal((await call()).status,403);assert.equal(creates,1);
   denied=false;assert.equal((await call({promote:true})).status,200);assert.equal((await call({promote:true})).status,200);assert.equal(promotions,1);
 }finally{await mf.dispose()}
});
